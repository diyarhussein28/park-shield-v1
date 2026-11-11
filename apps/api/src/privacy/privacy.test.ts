import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import {
  createHarness,
  lastMail,
  mailbox,
  resetState,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';
import { PrivacyService } from './privacy.service';

let h: Harness;
let crypto: FieldCrypto;
beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const OWNER = 'owner@example.de';

async function owner() {
  const s = await subscribe(h, OWNER);
  const v = (
    await h.app.inject({
      method: 'POST',
      url: '/v1/vehicles',
      headers: s.headers,
      payload: { nickname: 'Der Blaue', plate: 'K-AB 1234', color: 'Blau' },
    })
  ).json();
  const t = await h.db
    .selectFrom('qr_tokens')
    .select('code_enc')
    .where('id', '=', v.decal.tokenId)
    .executeTakeFirstOrThrow();
  const code = crypto.decrypt(t.code_enc);
  await h.app.inject({
    method: 'POST',
    url: `/v1/scan/${code}/alerts`,
    remoteAddress: '198.51.100.1',
    payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', type: 'custom', message: 'Licht an' },
  });
  return { s, v, code };
}
const staleSignIn = () =>
  sql`UPDATE sessions SET created_at = now() - interval '20 minutes'`.execute(h.db);
const post = (s: Session, url: string) => h.app.inject({ method: 'POST', url, headers: s.headers });

describe('data export (US-32, OW-12)', () => {
  it('needs a sign-in within the last 15 minutes', async () => {
    const { s } = await owner();
    await staleSignIn();
    const r = await post(s, '/v1/me/export');
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: 'reauth_required', minutes: 15 });
    expect((await post(s, '/v1/me/export.pdf')).statusCode).toBe(401);
  });

  it('exports everything about the person as JSON, decrypted, and logs the request', async () => {
    const { s } = await owner();
    await subscribe(h, 'other@example.de');
    const r = await post(s, '/v1/me/export');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toContain('parkshield-daten.json');
    const data = r.json();
    expect(data.account.email).toBe(OWNER);
    expect(data.vehicles).toEqual([
      expect.objectContaining({ nickname: 'Der Blaue', plate: 'K-AB 1234', color: 'Blau' }),
    ]);
    expect(data.alerts[0]).toMatchObject({ type: 'custom', message: 'Licht an' });
    expect(data.subscriptions[0]).toMatchObject({ plan: 'plus', status: 'active' });
    expect(JSON.stringify(data)).not.toContain('other@example.de');
    // Nothing that identifies scanners.
    expect(JSON.stringify(data)).not.toMatch(/scanner_ref|block_ref|198\.51/);
    const dsr = await h.db
      .selectFrom('data_subject_requests')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(dsr).toMatchObject({
      type: 'access_export',
      status: 'completed',
      verification_method: 'session_reauth',
    });
  });

  it('also as a PDF', async () => {
    const { s } = await owner();
    const r = await post(s, '/v1/me/export.pdf');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(r.rawPayload.toString('latin1')).toContain('K-AB 1234');
  });
});

describe('account deletion (US-32)', () => {
  const remove = (s: Session) =>
    h.app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: s.headers,
      payload: { confirm: true },
    });
  const cancelToken = async () => {
    const mail = await lastMail(h, 'deletion_requested');
    return /#t=([A-Za-z0-9_-]+)/.exec(mail!.text)![1]!;
  };

  it('needs confirmation and a fresh sign-in', async () => {
    const { s } = await owner();
    expect(
      (await h.app.inject({ method: 'DELETE', url: '/v1/me', headers: s.headers, payload: {} }))
        .statusCode,
    ).toBe(400);
    await staleSignIn();
    expect((await remove(s)).json().error).toBe('reauth_required');
  });

  it('revokes the codes at once, signs out everywhere, and schedules deletion in 24 h', async () => {
    const { s, code } = await owner();
    const r = await remove(s);
    expect(r.statusCode).toBe(200);
    expect(new Date(r.json().deletionDueAt).getTime() - Date.now()).toBeGreaterThan(
      23.9 * 3600_000,
    );
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${code}` })).statusCode).toBe(404);
    expect(
      (await h.app.inject({ method: 'GET', url: '/v1/me', headers: s.headers })).statusCode,
    ).toBe(401);
    expect((await lastMail(h, 'deletion_requested'))?.to).toBe(OWNER);
    const steps = await h.db
      .selectFrom('dsr_processor_steps')
      .select(['processor', 'status', 'automated'])
      .orderBy('processor')
      .execute();
    expect(steps).toEqual([
      { processor: '360dialog', status: 'not_applicable', automated: false },
      { processor: 'brevo', status: 'pending', automated: true },
      { processor: 'parkshield_db', status: 'pending', automated: true },
      { processor: 'print_partner', status: 'not_applicable', automated: false },
      { processor: 'sentry', status: 'done', automated: true },
      { processor: 'stripe', status: 'pending', automated: true },
      { processor: 'zammad', status: 'pending', automated: false },
    ]);
  });

  it('can be cancelled within 24 h with the e-mailed link; codes stay revoked', async () => {
    const { s } = await owner();
    await remove(s);
    const token = await cancelToken();
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: '/v1/me/deletion/cancel',
          payload: { token: 'x'.repeat(65) },
        })
      ).statusCode,
    ).toBe(404);
    const ok = await h.app.inject({
      method: 'POST',
      url: '/v1/me/deletion/cancel',
      payload: { token },
    });
    expect(ok.statusCode).toBe(200);
    const u = await h.db
      .selectFrom('users')
      .select(['status', 'deletion_due_at'])
      .where('email', '=', OWNER)
      .executeTakeFirstOrThrow();
    expect(u).toEqual({ status: 'active', deletion_due_at: null });
    expect(
      (await h.db.selectFrom('qr_tokens').select('status').executeTakeFirstOrThrow()).status,
    ).toBe('revoked');
    expect(
      (await h.app.inject({ method: 'POST', url: '/v1/me/deletion/cancel', payload: { token } }))
        .statusCode,
    ).toBe(404);
  });

  it('after 24 h: Stripe customer deleted, then the account and all its data; the request stays open for manual steps', async () => {
    const { s } = await owner();
    await remove(s);
    const privacy = h.app.get(PrivacyService);
    expect(await privacy.processDue()).toBe(0); // grace period
    await sql`UPDATE users SET deletion_due_at = now() - interval '1 minute'`.execute(h.db);
    expect(await privacy.processDue()).toBe(1);
    expect(
      await h.db.selectFrom('users').select('id').where('email', '=', OWNER).executeTakeFirst(),
    ).toBeUndefined();
    expect(await h.db.selectFrom('vehicles').selectAll().execute()).toHaveLength(0);
    expect(await h.db.selectFrom('alerts').selectAll().execute()).toHaveLength(0);
    expect((await mailbox(h)).some((m) => m.tag === 'account_deleted' && m.to === OWNER)).toBe(
      true,
    );
    const steps = await h.db
      .selectFrom('dsr_processor_steps')
      .select(['processor', 'status', 'evidence_ref'])
      .execute();
    expect(steps.find((x) => x.processor === 'stripe')).toMatchObject({
      status: 'done',
      evidence_ref: expect.stringContaining('fake-deleted:cus_fake_'),
    });
    expect(steps.find((x) => x.processor === 'parkshield_db')?.status).toBe('done');
    const dsr = await h.db
      .selectFrom('data_subject_requests')
      .select(['user_id', 'status', 'email_bidx'])
      .executeTakeFirstOrThrow();
    expect(dsr).toMatchObject({ user_id: null, status: 'in_progress' }); // Zammad is a manual step (US-37)
    expect(dsr.email_bidx).toHaveLength(32);
    expect(await privacy.processDue()).toBe(0);
  });
});
