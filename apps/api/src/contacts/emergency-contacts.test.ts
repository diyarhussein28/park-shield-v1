import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  lastMail,
  mailbox,
  resetState,
  setSetting,
  signIn,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const OWNER = 'owner@example.de';

const invite = (s: Session, payload: Record<string, unknown>) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/emergency-contacts',
    headers: s.headers,
    payload: { name: 'Kim', email: 'kim@example.de', ownerName: 'Jonas', ...payload },
  });
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

describe('inviting an emergency contact (US-24, OW-07)', () => {
  it('sends an invitation, shows it as pending for 14 days, and never stores the address in clear', async () => {
    const s = await subscribe(h, OWNER);
    const res = await invite(s, {});
    expect(res.statusCode).toBe(201);
    const mail = await lastMail(h, 'ec_invite');
    expect(mail?.to).toBe('kim@example.de');
    expect(mail?.subject).toBe('Jonas möchte Sie als Notfallkontakt bei ParkShield');

    const { contacts, limit, ownerName } = await list(s);
    expect(limit).toBe(1);
    expect(ownerName).toBe('Jonas');
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ name: 'Kim', email: 'k•••@example.de', status: 'pending' });
    const days = (new Date(contacts[0].expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    const row = await h.db.selectFrom('emergency_contacts').selectAll().executeTakeFirstOrThrow();
    expect(row.address_enc.toString('latin1')).not.toContain('kim@');
    expect(row.consent_token_hash).toHaveLength(32);
  });

  it('enforces the plan limit; declined invitations do not count and can be re-sent', async () => {
    const s = await subscribe(h, OWNER);
    await invite(s, {});
    const second = await invite(s, { name: 'Alex', email: 'alex@example.de' });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: 'contact_limit', limit: 1, plan: 'plus' });

    expect((await decide(await invitationToken('kim@example.de'), 'decline')).json()).toEqual({
      status: 'declined',
    });
    expect((await invite(s, { name: 'Alex', email: 'alex@example.de' })).statusCode).toBe(201);
    await setSetting(h, 'limits.plus.emergency_contacts', 2);
    expect((await invite(s, {})).statusCode).toBe(201); // Kim again, after declining
  });

  it('rejects inviting yourself, duplicates, other people’s vehicles, and accounts without a plan', async () => {
    const s = await subscribe(h, OWNER);
    expect((await invite(s, { email: 'Owner@Example.de' })).json().error).toBe('contact_is_self');
    await setSetting(h, 'limits.plus.emergency_contacts', 3);
    await invite(s, {});
    expect((await invite(s, { email: 'KIM@example.de' })).json().error).toBe('contact_exists');
    const other = await subscribe(h, 'other@example.de');
    const v = (
      await h.app.inject({
        method: 'POST',
        url: '/v1/vehicles',
        headers: other.headers,
        payload: { nickname: 'Fremd', plate: 'B-XY 1' },
      })
    ).json();
    expect((await invite(s, { email: 'x@example.de', vehicleId: v.id })).statusCode).toBe(404);
    const free = await signIn(h, 'free@example.de');
    expect((await invite(free, {})).statusCode).toBe(403);
  });

  it('limits how many invitations one account can send', async () => {
    const s = await subscribe(h, OWNER);
    await setSetting(h, 'limits.plus.emergency_contacts', 10);
    for (let i = 0; i < 5; i++) {
      expect((await invite(s, { email: `p${i}@example.de` })).statusCode).toBe(201);
    }
    const sixth = await invite(s, { email: 'p6@example.de' });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().limit).toBe('contact.invite');
  });
});

describe('the contact decides (US-24)', () => {
  it('accepts once; the owner is told; the contact can withdraw later and is deleted', async () => {
    const s = await subscribe(h, OWNER);
    await invite(s, {});
    const token = await invitationToken('kim@example.de');
    expect((await view(token)).json()).toMatchObject({
      contactName: 'Kim',
      ownerName: 'Jonas',
      status: 'pending',
      vehicleNickname: null,
    });
    expect((await decide(token, 'accept')).json()).toEqual({ status: 'confirmed' });
    expect((await lastMail(h, 'ec_decided'))?.subject).toBe('Kim ist jetzt Ihr Notfallkontakt');
    expect((await decide(token, 'accept')).statusCode).toBe(409);
    expect((await list(s)).contacts[0].status).toBe('confirmed');

    expect((await decide(token, 'withdraw')).json()).toEqual({ status: 'removed' });
    expect(await h.db.selectFrom('emergency_contacts').selectAll().execute()).toHaveLength(0);
    expect((await view(token)).statusCode).toBe(404);
    const mails = (await mailbox(h)).filter((m) => m.tag === 'ec_decided');
    expect(mails[0]?.subject).toBe('Kim ist nicht mehr Ihr Notfallkontakt');
  });

  it('cannot withdraw before accepting, and unknown links are rejected', async () => {
    const s = await subscribe(h, OWNER);
    await invite(s, {});
    const token = await invitationToken('kim@example.de');
    expect((await decide(token, 'withdraw')).statusCode).toBe(409);
    expect((await view('x'.repeat(43))).statusCode).toBe(404);
  });

  it('unanswered and declined invitations are deleted after 14 days', async () => {
    const s = await subscribe(h, OWNER);
    await setSetting(h, 'limits.plus.emergency_contacts', 3);
    await invite(s, {});
    await invite(s, { name: 'Alex', email: 'alex@example.de' });
    await invite(s, { name: 'Sam', email: 'sam@example.de' });
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
    const s = await subscribe(h, OWNER);
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
