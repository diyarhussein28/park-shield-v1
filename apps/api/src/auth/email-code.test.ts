import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, linkToken, mailbox, resetState, type Harness } from '../test/harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const EXPO_GO = 'exp://192.168.178.25:8082/--/auth/callback';

async function request(email: string, redirectUri?: string) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/auth/email/request',
    payload: { email, locale: 'de', ...(redirectUri ? { redirectUri } : {}) },
  });
  expect(res.statusCode).toBe(202);
  const mail = (await mailbox(h)).find((m) => m.to === email && m.tag === 'sign_in_code')!;
  expect(mail).toBeTruthy();
  const code = /\b(\d{6})\b/.exec(mail.text)![1]!;
  const rid = /[#&]r=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
  return { mail, code, token: linkToken(mail), rid };
}

const verifyCode = (email: string, code: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/auth/email/verify-code',
    payload: { email, code, platform: 'ios' },
  });
const verifyLink = (token: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/auth/email/verify-link',
    payload: { token, platform: 'android' },
  });

describe('sign-in by 6-digit code (Expo Go, any e-mail app)', () => {
  it('the e-mail carries a code and an https bridge link; the right code signs in', async () => {
    const { mail, code } = await request('code-ok@example.de');
    expect(mail.text).toMatch(/\/auth\/open#t=/);
    expect(mail.text).toContain(code);
    const res = await verifyCode('code-ok@example.de', code);
    expect(res.statusCode).toBe(200);
    const me = await h.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${res.json().token}` },
    });
    expect(me.json().email).toBe('code-ok@example.de');
  });

  it('code and link are one-time together: using one invalidates the other', async () => {
    const a = await request('both-a@example.de');
    expect((await verifyCode('both-a@example.de', a.code)).statusCode).toBe(200);
    expect((await verifyLink(a.token)).statusCode).toBe(401);

    const b = await request('both-b@example.de');
    expect((await verifyLink(b.token)).statusCode).toBe(200);
    const again = await verifyCode('both-b@example.de', b.code);
    expect(again.statusCode).toBe(400);
  });

  it('five wrong attempts spend the code; then even the right one is refused', async () => {
    const { code } = await request('wrong5@example.de');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      const r = await verifyCode('wrong5@example.de', wrong);
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe('code_invalid');
    }
    const fifth = await verifyCode('wrong5@example.de', wrong);
    expect(fifth.json().error).toBe('code_expired');
    const right = await verifyCode('wrong5@example.de', code);
    expect(right.statusCode).toBe(400);
    expect(right.json().error).toBe('code_expired');
  });

  it('answers never reveal whether an address has an account', async () => {
    const unknown = await verifyCode('nobody-here@example.de', '123456');
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toEqual({ error: 'code_invalid' });
  });

  it('only a 6-digit code is accepted', async () => {
    const r = await verifyCode('shape@example.de', '12ab');
    expect(r.statusCode).toBe(400);
  });
});

describe('the return address (bridge page → app)', () => {
  it('an allowlisted Expo Go address is kept server-side and found by its id', async () => {
    const { rid, mail } = await request('return-ok@example.de', EXPO_GO);
    expect(mail.text).not.toContain('exp://');
    const r = await h.app.inject({ method: 'GET', url: `/v1/auth/email/return/${rid}` });
    expect(r.json()).toEqual({ url: EXPO_GO });
  });

  it('any other address is ignored and the app default is used', async () => {
    const { rid } = await request('return-evil@example.de', 'https://evil.example/auth/callback');
    const r = await h.app.inject({ method: 'GET', url: `/v1/auth/email/return/${rid}` });
    expect(r.json()).toEqual({ url: 'parkshield://auth/callback' });
  });

  it('looking up the return address does not use up the link (no sign-in on GET)', async () => {
    const { rid, token } = await request('prefetch@example.de', EXPO_GO);
    await h.app.inject({ method: 'GET', url: `/v1/auth/email/return/${rid}` });
    await h.app.inject({ method: 'GET', url: `/v1/auth/email/return/${rid}` });
    expect((await verifyLink(token)).statusCode).toBe(200);
  });

  it('an unknown id answers 404', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/v1/auth/email/return/AAAAAAAAAAAAAAAAAAAAAA',
    });
    expect(r.statusCode).toBe(404);
  });
});
