import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildOpsApp } from '../apps';
import { loadEnv } from '../config/env';
import type { FieldCrypto } from '../core/crypto';
import { createLogger } from '../core/logger';
import { SettingsService } from '../core/settings.service';
import { CRYPTO } from '../core/tokens';
import { DispatchService } from '../notifications/dispatch.service';
import { PrivacyService } from '../privacy/privacy.service';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import {
  createHarness,
  lastMail,
  mailbox,
  resetState,
  setSetting,
  subscribe,
  type Harness,
} from '../test/harness';
import { DsrService } from './dsr.service';
import { StaffService } from './staff.service';

let h: Harness;
let ops: NestFastifyApplication;
let staff: StaffService;
let crypto: FieldCrypto;

beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
  const env = loadEnv({
    BREVO_API_KEY: '',
    STRIPE_SECRET_KEY: '',
    D360_API_KEY: '',
    PRINT_PARTNER: '',
  });
  ops = await buildOpsApp(env, createLogger(env));
  await ops.init();
  await ops.getHttpAdapter().getInstance().ready();
  staff = ops.get(StaffService);
});
afterAll(async () => {
  await ops.close();
  await h.close();
});
beforeEach(() => resetState(h));

type Staff = { userId: string; headers: Record<string, string> };
async function staffAs(email: string, roles: string[]): Promise<Staff> {
  const { userId } = await staff.invite(null, { email, name: email.split('@')[0]!, roles });
  const s = await staff.createSession(userId, 'Chrome · Windows');
  return {
    userId,
    headers: { cookie: `ps_ops_session=${s.token}; ps_ops_csrf=${s.csrf}`, 'x-csrf-token': s.csrf },
  };
}
const get = (s: Staff, url: string) => ops.inject({ method: 'GET', url, headers: s.headers });
const post = (s: Staff, url: string, payload: unknown = {}) =>
  ops.inject({ method: 'POST', url, headers: s.headers, payload: payload as object });

let ip = 1;
async function customer(email = 'kunde@example.de', nickname = 'Der Blaue') {
  const s = await subscribe(h, email);
  const v = (
    await h.app.inject({
      method: 'POST',
      url: '/v1/vehicles',
      headers: s.headers,
      payload: { nickname, plate: 'K-AB 1234', color: 'Blau' },
    })
  ).json();
  const t = await h.db
    .selectFrom('qr_tokens')
    .select(['code_enc', 'code_hint'])
    .where('id', '=', v.decal.tokenId)
    .executeTakeFirstOrThrow();
  const user = await h.db
    .selectFrom('users')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirstOrThrow();
  return { s, v, userId: user.id, code: crypto.decrypt(t.code_enc), hint: t.code_hint };
}
const scan = (
  code: string,
  payload: Record<string, unknown> = { type: 'lights_on' },
  from = `198.51.${100 + (ip++ % 100)}.7`,
) =>
  h.app.inject({
    method: 'POST',
    url: `/v1/scan/${code}/alerts`,
    remoteAddress: from,
    payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', ...payload },
  });
const audit = (action: string) =>
  h.db
    .selectFrom('audit_logs')
    .select(['actor_id', 'is_read', 'entity_id'])
    .where('action', '=', action)
    .orderBy('id', 'desc')
    .execute();

describe('Customer 360 and delivery trace (US-35, AD-03/04/05)', () => {
  it('finds customers by e-mail or code hint, shows everything masked, and logs every view as a read', async () => {
    const c = await customer();
    const support = await staffAs('support@parkshield.de', ['support']);
    expect(
      (await get(support, `/ops/v1/customers?q=${encodeURIComponent('kunde@')}`)).json()
        .customers[0].id,
    ).toBe(c.userId);
    expect(
      (await get(support, `/ops/v1/customers?q=${c.hint.toLowerCase()}`)).json().customers[0].id,
    ).toBe(c.userId);

    const view = await get(support, `/ops/v1/customers/${c.userId}`);
    expect(view.statusCode).toBe(200);
    const data = view.json();
    expect(data.vehicles[0]).toMatchObject({ nickname: 'Der Blaue', plateMasked: 'K-•• ••34' });
    expect(data.vehicles[0].decals[0]).toMatchObject({ codeHint: c.hint });
    expect(data.subscriptions[0]).toMatchObject({ plan: 'plus', status: 'active' });
    expect(JSON.stringify(data)).not.toContain('K-AB 1234');
    expect(JSON.stringify(data)).not.toContain(c.code);
    const reads = await audit('customer.view');
    expect(reads[0]).toEqual({ actor_id: support.userId, is_read: true, entity_id: c.userId });

    const fulfillment = await staffAs('lager@parkshield.de', ['fulfillment']);
    expect((await get(fulfillment, `/ops/v1/customers/${c.userId}`)).statusCode).toBe(403);
  });

  it('the trace shows every attempt with reasons and cost, never the free text', async () => {
    const c = await customer();
    const a = (await scan(c.code, { type: 'custom', message: 'Geheime Nachricht' })).json();
    await h.app.get(DispatchService).dispatch(a.alertId);
    const support = await staffAs('support@parkshield.de', ['support']);
    const r = await get(support, `/ops/v1/alerts/${a.alertId}/trace`);
    expect(r.statusCode).toBe(200);
    const t = r.json();
    expect(t.alert).toMatchObject({ customerId: c.userId, type: 'custom', hasMessage: true });
    expect(t.deliveries).toEqual([
      expect.objectContaining({ recipient: 'owner', channel: 'email', status: 'sent', costEur: 0 }),
    ]);
    expect(JSON.stringify(t)).not.toContain('Geheime');
    expect((await audit('alert.trace'))[0]?.is_read).toBe(true);
  });
});

describe('four-eyes break-glass (US-36, AD-06)', () => {
  it('request with reason and ticket, approval by someone else, 15 minutes, customer told once', async () => {
    const c = await customer();
    const support = await staffAs('support@parkshield.de', ['support']);
    const admin = await staffAs('admin@parkshield.de', ['admin']);
    const bad = await post(support, '/ops/v1/break-glass', {
      target: 'vehicles.plate',
      targetId: c.v.id,
      reason: 'zu kurz',
      ticketRef: 'ZM-1',
    });
    expect(bad.statusCode).toBe(400);
    const req = await post(support, '/ops/v1/break-glass', {
      target: 'vehicles.plate',
      targetId: c.v.id,
      reason: 'Abschleppdienst fragt nach Kennzeichen',
      ticketRef: 'ZM-1234',
    });
    expect(req.statusCode).toBe(201);
    const id = req.json().id;

    expect((await post(support, `/ops/v1/break-glass/${id}/reveal`)).json().error).toBe(
      'not_valid',
    );
    expect((await post(support, `/ops/v1/break-glass/${id}/approve`)).statusCode).toBe(403); // no approve permission
    const pending = (await get(admin, '/ops/v1/break-glass')).json().requests;
    expect(pending.find((r: { id: string }) => r.id === id)).toMatchObject({
      status: 'requested',
      requester: 'support@parkshield.de',
    });
    expect((await post(admin, `/ops/v1/break-glass/${id}/approve`)).statusCode).toBe(200);
    expect((await post(admin, `/ops/v1/break-glass/${id}/reveal`)).statusCode).toBe(404); // only the requester

    const first = await post(support, `/ops/v1/break-glass/${id}/reveal`);
    expect(first.json()).toMatchObject({ value: 'K-AB 1234' });
    const until = new Date(first.json().validUntil).getTime() - Date.now();
    expect(until).toBeGreaterThan(14 * 60_000);
    expect(until).toBeLessThanOrEqual(15 * 60_000 + 2000);
    await post(support, `/ops/v1/break-glass/${id}/reveal`);
    const notices = (await mailbox(h)).filter((m) => m.tag === 'break_glass_notice');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ to: 'kunde@example.de' });
    expect(notices[0]!.text).toContain('Kennzeichen');
    expect(notices[0]!.text).toContain('ZM-1234');
    expect((await audit('pii.decrypt')).filter((a) => a.actor_id === support.userId)).toHaveLength(
      2,
    );

    await sql`UPDATE break_glass_requests SET valid_until = now() - interval '1 second'`.execute(
      h.db,
    );
    expect((await post(support, `/ops/v1/break-glass/${id}/reveal`)).json().error).toBe(
      'not_valid',
    );
  });

  it('nobody approves their own request', async () => {
    const c = await customer();
    const admin = await staffAs('admin@parkshield.de', ['admin']);
    const id = (
      await post(admin, '/ops/v1/break-glass', {
        target: 'vehicles.plate',
        targetId: c.v.id,
        reason: 'Eigener Test der Freigabe',
        ticketRef: 'ZM-9',
      })
    ).json().id;
    const own = await post(admin, `/ops/v1/break-glass/${id}/approve`);
    expect(own.statusCode).toBe(403);
    expect(own.json().error).toBe('own_request');
    expect(
      (
        await post(admin, '/ops/v1/break-glass', {
          target: 'vehicles.plate',
          targetId: crypto.keyVersion ? '00000000-0000-4000-8000-000000000000' : '',
          reason: 'Nicht vorhandenes Feld',
          ticketRef: 'ZM-9',
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('GDPR queue (US-37, AD-11)', () => {
  it('erasure requested by e-mail: identity first, then processor steps; closes only when all are done', async () => {
    const c = await customer();
    const dpo = await staffAs('dsb@parkshield.de', ['admin']);
    const created = await post(dpo, '/ops/v1/dsr', { type: 'erasure', email: 'kunde@example.de' });
    expect(created.json()).toMatchObject({ accountFound: true });
    const id = created.json().id;
    const mail = await lastMail(h, 'dsr_verify');
    expect(mail?.to).toBe('kunde@example.de');

    expect(
      (
        await post(dpo, `/ops/v1/dsr/${id}/steps/zammad`, {
          status: 'done',
          evidence: 'Tickets gelöscht',
        })
      ).json().error,
    ).toBe('identity_not_verified');
    expect(
      (await post(dpo, `/ops/v1/dsr/${id}/resend`, { email: 'falsch@example.de' })).statusCode,
    ).toBe(400);

    // The person confirms from their mailbox: the erasure starts (24 h grace, codes revoked at once).
    const token = /#t=([A-Za-z0-9_-]+)/.exec(mail!.text)![1]!;
    expect(
      (
        await h.app.inject({ method: 'POST', url: '/v1/me/dsr/confirm', payload: { token } })
      ).json(),
    ).toEqual({ type: 'erasure' });
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${c.code}` })).statusCode).toBe(404);
    const detail = (await get(dpo, `/ops/v1/dsr/${id}`)).json();
    expect(detail.request).toMatchObject({
      status: 'in_progress',
      verificationMethod: 'email_link',
      accountStatus: 'pending_deletion',
    });

    for (const p of ['zammad', 'print_partner']) {
      const step = detail.steps.find((s: { processor: string }) => s.processor === p);
      if (step.status === 'pending') {
        expect(
          (
            await post(dpo, `/ops/v1/dsr/${id}/steps/${p}`, {
              status: 'done',
              evidence: 'Ticket ZM-77 gelöscht',
            })
          ).statusCode,
        ).toBe(200);
      }
    }
    expect(
      (
        await post(dpo, `/ops/v1/dsr/${id}/steps/parkshield_db`, {
          status: 'done',
          evidence: 'per Hand',
        })
      ).json().error,
    ).toBe('automated_step');
    const blocked = await post(dpo, `/ops/v1/dsr/${id}/close`);
    expect(blocked.json()).toMatchObject({
      error: 'steps_open',
      steps: expect.arrayContaining(['parkshield_db']),
    });

    await sql`UPDATE users SET deletion_due_at = now() - interval '1 minute' WHERE id = ${c.userId}`.execute(
      h.db,
    );
    await h.app.get(PrivacyService).processDue();
    const after = (await get(dpo, `/ops/v1/dsr/${id}`)).json();
    // Everything done: the worker already closed it.
    expect(after.request.status).toBe('completed');
    expect(after.request.email).toBeNull();
  });

  it('access request for an address without account; manual identity check; deadline reminder', async () => {
    const dpo = await staffAs('dsb@parkshield.de', ['admin']);
    const created = (
      await post(dpo, '/ops/v1/dsr', {
        type: 'access_export',
        email: 'unbekannt@example.de',
        note: 'Brief vom 3.8.',
      })
    ).json();
    expect(created.accountFound).toBe(false);
    expect(
      (await post(dpo, `/ops/v1/dsr/${created.id}/verify`, { note: 'Ausweiskopie geprüft' }))
        .statusCode,
    ).toBe(200);
    const d = (await get(dpo, `/ops/v1/dsr/${created.id}`)).json();
    expect(d.request.verificationMethod).toBe('manual');
    for (const s of d.steps.filter((x: { status: string }) => x.status === 'pending')) {
      await post(dpo, `/ops/v1/dsr/${created.id}/steps/${s.processor}`, {
        status: 'not_applicable',
        evidence: 'kein Kundenkonto',
      });
    }
    expect((await post(dpo, `/ops/v1/dsr/${created.id}/close`)).statusCode).toBe(200);

    const other = (
      await post(dpo, '/ops/v1/dsr', { type: 'objection', email: 'x@example.de' })
    ).json();
    await sql`UPDATE data_subject_requests SET due_at = now() + interval '5 days' WHERE id = ${other.id}`.execute(
      h.db,
    );
    const dsr = ops.get(DsrService);
    expect(await dsr.remindDueSoon()).toBeGreaterThanOrEqual(1);
    expect(await dsr.remindDueSoon()).toBe(0);
    expect((await lastMail(h, 'dsr_due_soon'))?.to).toBe('datenschutz@parkshield.de');
    const list = (await get(dpo, '/ops/v1/dsr')).json().requests;
    expect(list.find((r: { id: string }) => r.id === other.id)).toMatchObject({
      dueSoon: true,
      verified: false,
    });
    const support = await staffAs('support@parkshield.de', ['support']);
    expect((await get(support, '/ops/v1/dsr')).statusCode).toBe(403);
  });
});

describe('abuse centre (US-38, AD-08/09/10)', () => {
  it('flags a code with more than 10 alerts in an hour; revoking it on the owner’s behalf makes the replacement free', async () => {
    const c = await customer();
    for (let i = 0; i < 11; i++) expect((await scan(c.code)).statusCode).toBe(201);
    const mod = await staffAs('mod@parkshield.de', ['abuse_moderator', 'fulfillment']);
    const p = (await get(mod, '/ops/v1/abuse/patterns')).json();
    expect(p.busyCodes).toEqual([
      expect.objectContaining({ tokenId: c.v.decal.tokenId, alerts: 11, customerId: c.userId }),
    ]);

    expect(
      (
        await post(mod, `/ops/v1/abuse/tokens/${c.v.decal.tokenId}/revoke`, {
          reason: 'Foto des Aufklebers im Netz',
        })
      ).statusCode,
    ).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${c.code}` })).statusCode).toBe(404);
    expect((await lastMail(h, 'code_revoked_by_us'))?.to).toBe('kunde@example.de');
    const orders = (
      await h.app.inject({ method: 'GET', url: '/v1/orders', headers: c.s.headers })
    ).json();
    expect(orders.freeReplacements).toBe(1);
    const r = await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${c.v.id}/order-replacement`,
      headers: c.s.headers,
      payload: {
        address: {
          name: 'Jonas',
          line1: 'Domstraße 1',
          postalCode: '50667',
          city: 'Köln',
          country: 'DE',
        },
      },
    });
    expect(r.json().url).toContain('?order=paid');
    const order = await h.db
      .selectFrom('decal_orders')
      .select(['status', 'total_gross_cents', 'is_replacement'])
      .executeTakeFirstOrThrow();
    expect(order).toEqual({ status: 'paid', total_gross_cents: 0, is_replacement: true });
    const support = await staffAs('support@parkshield.de', ['support']);
    expect((await get(support, '/ops/v1/abuse/patterns')).statusCode).toBe(403);
  });

  it('flags a scanner who alerts many vehicles; a global block lasts until the end of the day', async () => {
    const a = await customer('a@example.de', 'A');
    const b = await customer('b@example.de', 'B');
    const c = await customer('c@example.de', 'C');
    const d = await customer('d@example.de', 'D');
    for (const x of [a, b, c])
      expect((await scan(x.code, { type: 'lights_on' }, '203.0.113.66')).statusCode).toBe(201);
    const mod = await staffAs('mod@parkshield.de', ['abuse_moderator']);
    const p = (await get(mod, '/ops/v1/abuse/patterns')).json();
    expect(p.roamingScanners).toHaveLength(1);
    const scanner = p.roamingScanners[0];
    expect(scanner).toMatchObject({ vehicles: 3, blocked: false });

    const blocked = await post(mod, '/ops/v1/abuse/blocks', {
      ref: scanner.ref,
      reason: 'pattern',
    });
    expect(blocked.statusCode).toBe(201);
    const hours = (new Date(blocked.json().expiresAt).getTime() - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(0);
    expect(hours).toBeLessThanOrEqual(24);
    expect(
      (await post(mod, '/ops/v1/abuse/blocks', { ref: scanner.ref, reason: 'pattern' })).statusCode,
    ).toBe(409);
    const silent = (await scan(d.code, { type: 'lights_on' }, '203.0.113.66')).json();
    const row = await h.db
      .selectFrom('alerts')
      .select('status')
      .where('id', '=', silent.alertId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('blocked');
    expect((await get(mod, '/ops/v1/abuse/blocks')).json().blocks[0]).toMatchObject({
      scope: 'global',
      reason: 'pattern',
    });
    const lift = await ops.inject({
      method: 'DELETE',
      url: '/ops/v1/abuse/blocks',
      headers: mod.headers,
      payload: { ref: scanner.ref, tokenId: null },
    });
    expect(lift.statusCode).toBe(200);
    expect((await audit('abuse.block_global'))[0]?.actor_id).toBe(mod.userId);
  });

  it('owner reports land in the queue and are handled', async () => {
    const c = await customer();
    const a = (await scan(c.code)).json();
    await h.app.inject({
      method: 'POST',
      url: `/v1/alerts/${a.alertId}/report`,
      headers: c.s.headers,
      payload: { reason: 'spam' },
    });
    const mod = await staffAs('mod@parkshield.de', ['abuse_moderator']);
    const open = (await get(mod, '/ops/v1/abuse/reports')).json().reports;
    expect(open).toEqual([
      expect.objectContaining({
        kind: 'owner_report',
        reason: 'spam',
        alertId: a.alertId,
        nickname: 'Der Blaue',
      }),
    ]);
    expect(
      (await post(mod, `/ops/v1/abuse/reports/${open[0].id}`, { status: 'actioned' })).statusCode,
    ).toBe(200);
    expect((await get(mod, '/ops/v1/abuse/reports?status=actioned')).json().reports).toHaveLength(
      1,
    );
  });

  it('review sample: moderators read blocked texts (logged) and the weekly false-positive rate follows', async () => {
    await setSetting(h, 'moderation.sample_rate', 1);
    const c = await customer();
    expect(
      (await scan(c.code, { type: 'custom', message: 'Du Idiot, park woanders' })).statusCode,
    ).toBe(422);
    const mod = await staffAs('mod@parkshield.de', ['abuse_moderator']);
    const q = (await get(mod, '/ops/v1/abuse/reviews')).json();
    expect(q.items).toEqual([
      expect.objectContaining({ rule: 'insult', text: 'Du Idiot, park woanders' }),
    ]);
    expect((await audit('moderation.review_view'))[0]?.is_read).toBe(true);
    expect(
      (await post(mod, `/ops/v1/abuse/reviews/${q.items[0].id}`, { decision: 'false_positive' }))
        .statusCode,
    ).toBe(200);
    const after = (await get(mod, '/ops/v1/abuse/reviews')).json();
    expect(after.items).toHaveLength(0);
    expect(after.week).toMatchObject({ reviewed: 1, falsePositive: 1, rate: 1 });
    const finance = await staffAs('fin@parkshield.de', ['finance']);
    expect((await get(finance, '/ops/v1/abuse/reviews')).statusCode).toBe(403);
  });

  it('word lists: a published version is used by the filter at once; rollback restores an old one', async () => {
    const mod = await staffAs('mod@parkshield.de', ['abuse_moderator']);
    const before = (await get(mod, '/ops/v1/abuse/word-lists')).json().versions[0];
    const words = structuredClone(before.words);
    words.insults.de.push('blödmann');
    const pub = await post(mod, '/ops/v1/abuse/word-lists', { words, note: 'Blödmann ergänzt' });
    expect(pub.statusCode).toBe(201);
    h.app.get(SettingsService).invalidate(); // the broadcast reaches the public API asynchronously
    const c = await customer();
    const res = await scan(c.code, { type: 'custom', message: 'Du Blödmann!' });
    expect(res.json()).toMatchObject({ error: 'message_blocked', reason: 'insult' });

    const rb = await post(mod, `/ops/v1/abuse/word-lists/${before.version}/rollback`);
    expect(rb.json().version).toBeGreaterThan(pub.json().version);
    h.app.get(SettingsService).invalidate();
    expect((await scan(c.code, { type: 'custom', message: 'Du Blödmann!' })).statusCode).toBe(201);
    const versions = (await get(mod, '/ops/v1/abuse/word-lists')).json().versions;
    expect(versions[0].note).toBe(`Rollback to version ${before.version}`);
  });
});
