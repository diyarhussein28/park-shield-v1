import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import type { FakePayments } from '../providers/fake-payments';
import { PAYMENTS } from '../providers/ports';
import { BillingService } from '../billing/billing.service';
import {
  createHarness,
  mailbox,
  resetState,
  signIn,
  smsInbox,
  verifyPhone,
  type Harness,
  type Session,
} from '../test/harness';
import { maskEmail } from './email-change.service';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const post = (s: Session, url: string, payload: unknown = {}) =>
  h.app.inject({ method: 'POST', url, headers: s.headers, payload: payload as object });
const codeFrom = async (to: string) => {
  const mail = (await mailbox(h)).find((m) => m.tag === 'email_change_code' && m.to === to);
  if (!mail) throw new Error(`no code mail to ${to}`);
  return /(\d{6})/.exec(mail.subject)![1]!;
};
const userId = async (email: string) =>
  (await h.db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst())?.id;
const audit = async (id: string, action: string) =>
  h.db
    .selectFrom('audit_logs')
    .select(['action', 'meta'])
    .where('actor_id', '=', id)
    .where('action', '=', action)
    .execute();

describe('change e-mail (Konto)', () => {
  it('keeps the old address until the code from the new one is confirmed', async () => {
    const s = await signIn(h, 'alt@example.de');
    const id = (await userId('alt@example.de'))!;

    const start = await post(s, '/v1/me/email/change', { email: '  Neu@Example.de ' });
    expect(start.statusCode).toBe(200);
    expect(start.json()).toEqual({ email: 'neu@example.de', expiresInSeconds: 900 });
    // Nothing changed yet: the old address still signs in and is still on the account.
    expect(await userId('alt@example.de')).toBe(id);
    const mail = (await mailbox(h)).find((m) => m.tag === 'email_change_code')!;
    expect(mail.to).toBe('neu@example.de');
    expect(mail.text).toContain('Gültig für 15 Minuten');

    const right = await codeFrom('neu@example.de');
    const wrong = await post(s, '/v1/me/email/change/verify', {
      code: right === '000000' ? '111111' : '000000',
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toMatchObject({ error: 'code_wrong', attemptsLeft: 4 });
    expect(await userId('alt@example.de')).toBe(id);

    const ok = await post(s, '/v1/me/email/change/verify', {
      code: await codeFrom('neu@example.de'),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ email: 'neu@example.de' });
    expect(await userId('neu@example.de')).toBe(id);
    expect(await userId('alt@example.de')).toBeUndefined();

    // The session stays valid and now reads the new address.
    const profile = await h.app.inject({
      method: 'GET',
      url: '/v1/me/profile',
      headers: s.headers,
    });
    expect(profile.json()).toMatchObject({ email: 'neu@example.de' });

    // Security notice to the OLD address, with the new one masked only.
    const notice = (await mailbox(h)).find((m) => m.tag === 'email_changed')!;
    expect(notice.to).toBe('alt@example.de');
    expect(notice.text).toContain(maskEmail('neu@example.de'));
    expect(notice.text).not.toContain('neu@example.de');

    // Audit without any address; outbox event for the Stripe sync.
    const rows = await audit(id, 'user.email_changed');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.meta)).not.toContain('@');
    const events = await h.db
      .selectFrom('outbox_events')
      .select('payload')
      .where('topic', '=', 'billing.customer_email')
      .execute();
    expect(events.map((e) => e.payload)).toContainEqual({ userId: id });

    // The code is spent.
    const again = await post(s, '/v1/me/email/change/verify', {
      code: await codeFrom('neu@example.de'),
    });
    expect(again.json()).toMatchObject({ error: 'code_expired' });
  });

  it('refuses an address that another account uses, and the same address', async () => {
    await signIn(h, 'belegt@example.de');
    const s = await signIn(h, 'ich@example.de');
    const taken = await post(s, '/v1/me/email/change', { email: 'BELEGT@example.de' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toEqual({ error: 'email_taken' });
    const same = await post(s, '/v1/me/email/change', { email: 'ich@example.de' });
    expect(same.json()).toEqual({ error: 'email_unchanged' });
    const invalid = await post(s, '/v1/me/email/change', { email: 'kein-mail' });
    expect(invalid.statusCode).toBe(400);
    expect((await mailbox(h)).some((m) => m.tag === 'email_change_code')).toBe(false);
  });

  it('spends the code after 5 wrong tries and limits the code e-mails', async () => {
    const s = await signIn(h, 'versuch@example.de');
    await post(s, '/v1/me/email/change', { email: 'ziel@example.de' });
    const right = await codeFrom('ziel@example.de');
    const wrongCode = right === '123456' ? '654321' : '123456';
    for (let i = 0; i < 4; i++)
      expect(
        (await post(s, '/v1/me/email/change/verify', { code: wrongCode })).json(),
      ).toMatchObject({ error: 'code_wrong' });
    expect((await post(s, '/v1/me/email/change/verify', { code: wrongCode })).json()).toMatchObject(
      {
        error: 'code_expired',
      },
    );
    expect((await post(s, '/v1/me/email/change/verify', { code: right })).json()).toMatchObject({
      error: 'code_expired',
    });
    expect(await userId('versuch@example.de')).toBeDefined();

    // 5 code e-mails per hour per account (1 sent above).
    for (let i = 0; i < 4; i++)
      expect((await post(s, '/v1/me/email/change', { email: `z${i}@example.de` })).statusCode).toBe(
        200,
      );
    expect((await post(s, '/v1/me/email/change', { email: 'z9@example.de' })).statusCode).toBe(429);
  });

  it('cancelling drops the pending change', async () => {
    const s = await signIn(h, 'storno@example.de');
    await post(s, '/v1/me/email/change', { email: 'nie@example.de' });
    const code = await codeFrom('nie@example.de');
    const del = await h.app.inject({
      method: 'DELETE',
      url: '/v1/me/email/change',
      headers: s.headers,
    });
    expect(del.statusCode).toBe(200);
    expect((await post(s, '/v1/me/email/change/verify', { code })).json()).toMatchObject({
      error: 'code_expired',
    });
  });

  it('syncs the new address to the Stripe customer', async () => {
    const s = await signIn(h, 'kunde@example.de');
    const id = (await userId('kunde@example.de'))!;
    await h.db
      .updateTable('users')
      .set({ stripe_customer_id: 'cus_fake_sync' })
      .where('id', '=', id)
      .execute();
    await post(s, '/v1/me/email/change', { email: 'rechnung@example.de' });
    await post(s, '/v1/me/email/change/verify', { code: await codeFrom('rechnung@example.de') });
    await h.app.get(BillingService).syncCustomerEmail(id);
    const payments = h.app.get<FakePayments>(PAYMENTS);
    expect(await payments.customerEmail('cus_fake_sync')).toBe('rechnung@example.de');
  });
});

describe('change mobile number (Konto, SMS only)', () => {
  it('replaces the number in place after the SMS code and writes an audit entry without the number', async () => {
    const s = await signIn(h, 'nummer@example.de');
    const id = (await userId('nummer@example.de'))!;
    await verifyPhone(h, s, '+4915111111111');

    const start = await post(s, '/v1/channels/phone', {
      phone: '0151 22222222',
      channels: ['sms'],
      consent: true,
    });
    expect(start.statusCode).toBe(200);
    // The old number is still the linked one until the code is confirmed.
    const crypto = h.app.get<FieldCrypto>(CRYPTO);
    const linked = async () =>
      (
        await h.db
          .selectFrom('contact_channels')
          .select(['address_enc', 'address_bidx', 'verified_at', 'opted_in_at'])
          .where('user_id', '=', id)
          .where('type', '=', 'sms')
          .execute()
      ).map((r) => ({ ...r, phone: crypto.decrypt(r.address_enc!) }));
    expect((await linked()).map((r) => r.phone)).toEqual(['+4915111111111']);

    const sms = (await smsInbox(h)).find((m) => m.tag === 'sms_verify')!;
    expect(sms.to).toBe('+4915122222222');
    const code = /(\d{6})/.exec(sms.body)![1]!;
    const ok = await post(s, '/v1/channels/phone/verify', { code });
    expect(ok.statusCode).toBe(200);

    const after = await linked();
    expect(after).toHaveLength(1);
    expect(after[0]!.phone).toBe('+4915122222222');
    expect(after[0]!.address_bidx!.equals(crypto.blindIndex('+4915122222222'))).toBe(true);
    expect(after[0]!.verified_at).toBeTruthy();
    expect(after[0]!.opted_in_at).toBeTruthy();

    const rows = await audit(id, 'user.phone_changed');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.meta)).not.toMatch(/\d{6,}/);
  });
});
