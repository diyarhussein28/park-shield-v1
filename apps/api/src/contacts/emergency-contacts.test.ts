import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  lastMail,
  mailbox,
  makePremium,
  resetState,
  signIn,
  smsInbox,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';
import { EmergencyContactsService } from './emergency-contacts.service';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const OWNER = 'owner@example.de';

/** A PREMIUM owner: trusted contacts and escalation are PREMIUM only. */
async function premium(email = OWNER): Promise<Session> {
  const s = await subscribe(h, email);
  await makePremium(h, email);
  return s;
}

let phoneSeq = 10;
const invite = (s: Session, payload: Record<string, unknown>) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/app/emergency-contacts',
    headers: s.headers,
    payload: {
      name: 'Kim',
      phone: '0151 11111111',
      email: 'kim@example.de',
      ownerName: 'Jonas',
      ...payload,
    },
  });
const nextPhone = () => `0151 2222${String(phoneSeq++).padStart(4, '0')}`;
const list = (s: Session) =>
  h.app
    .inject({ method: 'GET', url: '/v1/emergency-contacts', headers: s.headers })
    .then((r) => r.json());

async function invitationToken(to: string) {
  const mail = (await mailbox(h)).find((m) => m.tag === 'ec_invite' && m.to === to);
  const m = /\/notfallkontakt#t=([A-Za-z0-9_-]+)/.exec(mail?.text ?? '');
  if (!m) throw new Error(`no invitation for ${to}`);
  return m[1]!;
}
const view = (token: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/emergency-contact-invitations/view',
    payload: { token },
  });
const decide = (token: string, decision: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/emergency-contact-invitations/decide',
    payload: { token, decision },
  });

describe('inviting a trusted contact (PREMIUM, US-24, OW-07)', () => {
  it('invites by SMS and e-mail, pending for 14 days, never stores phone or address in clear', async () => {
    const s = await premium();
    const res = await invite(s, {});
    expect(res.statusCode).toBe(201);
    const mail = await lastMail(h, 'ec_invite');
    expect(mail?.to).toBe('kim@example.de');
    expect(mail?.subject).toBe('Jonas möchte Sie als Vertrauensperson bei ParkShield hinterlegen');
    expect(mail?.text).toContain('kein Kennzeichen');
    const sms = (await smsInbox(h)).find((m) => m.tag === 'sms_ec_invite')!;
    expect(sms.to).toBe('+4915111111111');
    expect(sms.body.length).toBeLessThanOrEqual(160);
    expect(sms.body).toMatch(/Jonas moechte Sie als Vertrauensperson/);
    expect(sms.body).toMatch(/notfallkontakt#t=[A-Za-z0-9_-]{43}$/);

    const { contacts, limit, ownerName, premium: isPremium } = await list(s);
    expect(isPremium).toBe(true);
    expect(limit).toBe(3);
    expect(ownerName).toBe('Jonas');
    expect(contacts[0]).toMatchObject({
      name: 'Kim',
      position: 1,
      email: 'k•••@example.de',
      phone: '+49 ••• 1111',
      status: 'pending',
    });
    const days = (new Date(contacts[0].expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    const row = await h.db.selectFrom('emergency_contacts').selectAll().executeTakeFirstOrThrow();
    expect(row.address_enc!.toString('latin1')).not.toContain('kim@');
    expect(row.phone_enc!.toString('latin1')).not.toContain('1111111');
    expect(row.consent_token_hash).toHaveLength(32);
  });

  it('PLUS cannot invite (403 premium_required); a phone is required', async () => {
    const plus = await subscribe(h, 'plus@example.de');
    const r = await invite(plus, {});
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('premium_required');
    const s = await premium();
    expect((await invite(s, { phone: undefined })).statusCode).toBe(400);
    expect((await invite(s, { phone: '0221 123456' })).json().error).toBe('phone_invalid');
  });

  it('up to 3 contacts; declined invitations do not count and can be re-sent', async () => {
    const s = await premium();
    await invite(s, {});
    await invite(s, { name: 'Alex', email: 'alex@example.de', phone: nextPhone() });
    await invite(s, { name: 'Sam', email: 'sam@example.de', phone: nextPhone() });
    const fourth = await invite(s, { name: 'Lou', email: 'lou@example.de', phone: nextPhone() });
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json()).toMatchObject({ error: 'contact_limit', limit: 3, plan: 'premium' });

    await decide(await invitationToken('kim@example.de'), 'decline');
    expect(
      (await invite(s, { name: 'Lou', email: 'lou@example.de', phone: nextPhone() })).statusCode,
    ).toBe(201);
  });

  it('the owner orders the contacts (1 → 2 → 3), and removing one renumbers the rest', async () => {
    const s = await premium();
    await invite(s, {});
    await invite(s, { name: 'Alex', email: 'alex@example.de', phone: nextPhone() });
    await invite(s, { name: 'Sam', email: 'sam@example.de', phone: nextPhone() });
    const ids = (await list(s)).contacts.map((c: { id: string }) => c.id);
    const reordered = await h.app.inject({
      method: 'PUT',
      url: '/v1/app/emergency-contacts/order',
      headers: s.headers,
      payload: { ids: [ids[2], ids[0], ids[1]] },
    });
    expect(reordered.json().contacts.map((c: { name: string }) => c.name)).toEqual([
      'Sam',
      'Kim',
      'Alex',
    ]);
    await h.app.inject({
      method: 'DELETE',
      url: `/v1/emergency-contacts/${ids[2]}`,
      headers: s.headers,
    });
    const after = (await list(s)).contacts;
    expect(after.map((c: { name: string; position: number }) => `${c.position}:${c.name}`)).toEqual(
      ['1:Kim', '2:Alex'],
    );
  });

  it('rejects inviting yourself, duplicates, other people’s vehicles, and accounts without a plan', async () => {
    const s = await premium();
    expect((await invite(s, { email: 'Owner@Example.de' })).json().error).toBe('contact_is_self');
    await invite(s, {});
    expect((await invite(s, { email: 'other@example.de' })).json().error).toBe('contact_exists');
    const other = await subscribe(h, 'other@example.de');
    const v = (
      await h.app.inject({
        method: 'POST',
        url: '/v1/vehicles',
        headers: other.headers,
        payload: { nickname: 'Fremd', plate: 'B-XY 1' },
      })
    ).json();
    expect(
      (await invite(s, { email: 'x@example.de', phone: nextPhone(), vehicleId: v.id })).statusCode,
    ).toBe(404);
    const free = await signIn(h, 'free@example.de');
    expect((await invite(free, {})).statusCode).toBe(403);
  });
});

describe('the contact decides (US-24)', () => {
  it('accepts once; the owner is told; the contact can withdraw later and is deleted', async () => {
    const s = await premium();
    await invite(s, {});
    const token = await invitationToken('kim@example.de');
    expect((await view(token)).json()).toMatchObject({
      contactName: 'Kim',
      ownerName: 'Jonas',
      status: 'pending',
      vehicleNickname: null,
    });
    const accept = await h.app.inject({
      method: 'POST',
      url: '/v1/emergency-contact-invitations/accept',
      payload: { token },
    });
    expect(accept.json()).toEqual({ status: 'confirmed' });
    expect((await lastMail(h, 'ec_decided'))?.subject).toBe('Kim ist jetzt Ihr Notfallkontakt');
    expect((await decide(token, 'accept')).statusCode).toBe(409);
    expect((await list(s)).contacts[0].status).toBe('confirmed');

    // The app now suggests switching escalation on (it stays off until the owner does).
    const esc = (
      await h.app.inject({ method: 'GET', url: '/v1/app/escalation', headers: s.headers })
    ).json();
    expect(esc).toMatchObject({
      available: true,
      enabled: false,
      suggestEnable: true,
      delayMinutes: 7,
    });

    expect((await decide(token, 'withdraw')).json()).toEqual({ status: 'removed' });
    expect(await h.db.selectFrom('emergency_contacts').selectAll().execute()).toHaveLength(0);
    expect((await view(token)).statusCode).toBe(404);
  });

  it('cannot withdraw before accepting, and unknown links are rejected', async () => {
    const s = await premium();
    await invite(s, {});
    const token = await invitationToken('kim@example.de');
    expect((await decide(token, 'withdraw')).statusCode).toBe(409);
    expect((await view('x'.repeat(43))).statusCode).toBe(404);
  });

  it('unanswered and declined invitations are deleted after 14 days', async () => {
    const s = await premium();
    await invite(s, {});
    await invite(s, { name: 'Alex', email: 'alex@example.de', phone: nextPhone() });
    await invite(s, { name: 'Sam', email: 'sam@example.de', phone: nextPhone() });
    await decide(await invitationToken('alex@example.de'), 'decline');
    await decide(await invitationToken('sam@example.de'), 'accept');
    await sql`UPDATE emergency_contacts SET consent_requested_at = now() - interval '15 days'`.execute(
      h.db,
    );
    await sql`SELECT run_retention()`.execute(h.db);
    const left = await h.db.selectFrom('emergency_contacts').select('display_name').execute();
    expect(left).toEqual([{ display_name: 'Sam' }]);
  });

  it('owners remove their own contacts only', async () => {
    const s = await premium();
    await invite(s, {});
    const id = (await list(s)).contacts[0].id;
    const other = await signIn(h, 'other@example.de');
    const del = (sess: Session) =>
      h.app.inject({
        method: 'DELETE',
        url: `/v1/emergency-contacts/${id}`,
        headers: sess.headers,
      });
    expect((await del(other)).statusCode).toBe(404);
    expect((await del(s)).statusCode).toBe(200);
    expect((await list(s)).contacts).toHaveLength(0);
  });
});

describe('downgrade PREMIUM → PLUS', () => {
  it('deactivates contacts and switches escalation off at once, restores them on re-upgrade, deletes after 30 days', async () => {
    const s = await premium();
    await invite(s, {});
    await decide(await invitationToken('kim@example.de'), 'accept');
    await h.db.updateTable('users').set({ escalation_enabled: true }).execute();
    const contacts = h.app.get(EmergencyContactsService);

    await h.db.updateTable('subscriptions').set({ plan: 'plus' }).execute();
    expect(await contacts.syncPlans()).toEqual({ deactivated: 1, restored: 0 });
    expect(await contacts.syncPlans()).toEqual({ deactivated: 0, restored: 0 }); // told once
    expect((await list(s)).contacts[0].status).toBe('deactivated');
    const owner = await h.db
      .selectFrom('users')
      .select('escalation_enabled')
      .executeTakeFirstOrThrow();
    expect(owner.escalation_enabled).toBe(false);
    const mail = await lastMail(h, 'ec_deactivated');
    expect(mail?.to).toBe(OWNER);
    expect(mail?.text).toContain('30 Tage');

    await h.db.updateTable('subscriptions').set({ plan: 'premium' }).execute();
    expect(await contacts.syncPlans()).toEqual({ deactivated: 0, restored: 1 });
    expect((await list(s)).contacts[0].status).toBe('confirmed');

    await h.db.updateTable('subscriptions').set({ plan: 'plus' }).execute();
    await contacts.syncPlans();
    await sql`UPDATE emergency_contacts SET deactivated_at = now() - interval '31 days'`.execute(
      h.db,
    );
    await sql`SELECT run_retention()`.execute(h.db);
    expect(await h.db.selectFrom('emergency_contacts').selectAll().execute()).toHaveLength(0);
  });
});
