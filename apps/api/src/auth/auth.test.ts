import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha256 } from '../core/crypto';
import { SettingsService } from '../core/settings.service';
import {
  createHarness,
  linkToken,
  mailbox,
  requestLink,
  resetState,
  sessionFrom,
  signIn,
  UA_IPHONE,
  UA_WINDOWS_CHROME,
  type Harness,
} from '../test/harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

describe('magic link sign-up and login (US-05)', () => {
  it('sends a single-use link carried in the URL fragment', async () => {
    const res = await requestLink(h, 'Jonas@Example.de');
    expect(res.statusCode).toBe(202);
    const [mail] = await mailbox(h);
    expect(mail!.to).toBe('jonas@example.de');
    expect(mail!.tag).toBe('magic_link');
    expect(mail!.text).toMatch(/\/anmelden\/link#t=[A-Za-z0-9_-]{43}/);

    const token = linkToken(mail!);
    const stored = await h.db
      .selectFrom('magic_link_tokens')
      .select('token_hash')
      .executeTakeFirstOrThrow();
    expect(stored.token_hash.equals(sha256(token))).toBe(true); // only the hash is stored

    const first = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-link/consume',
      payload: { token },
    });
    expect(first.statusCode).toBe(200);
    const cookies = Object.fromEntries(first.cookies.map((c) => [c.name, c]));
    expect(cookies.ps_session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookies.ps_csrf?.httpOnly).toBeFalsy();

    const second = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-link/consume',
      payload: { token },
    });
    expect(second.statusCode).toBe(401);
  });

  it('rejects an expired link', async () => {
    await requestLink(h, 'late@example.de');
    const token = linkToken((await mailbox(h))[0]!);
    await sql`UPDATE magic_link_tokens SET expires_at = now() - interval '1 second'`.execute(h.db);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-link/consume',
      payload: { token },
    });
    expect(res.statusCode).toBe(401);
  });

  it('needs a solved captcha', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-link',
      payload: { email: 'bot@example.de', captcha: 'wrong' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'captcha_failed' });
  });

  it('allows 5 links per hour per address', async () => {
    for (let i = 0; i < 5; i++)
      expect((await requestLink(h, 'spam@example.de')).statusCode).toBe(202);
    const sixth = await requestLink(h, 'spam@example.de');
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().retryAfterSeconds).toBeGreaterThan(3000);
    expect((await requestLink(h, 'other@example.de')).statusCode).toBe(202);
  });

  it('reads limits from app_settings, applied immediately (hard rule 6)', async () => {
    await h.db
      .insertInto('app_settings')
      .values({
        key: 'ratelimit.magic_link.email',
        value: JSON.stringify({ max: 1, windowSeconds: 60 }),
      })
      .execute();
    await h.app.get(SettingsService).broadcastChange();
    expect((await requestLink(h, 'tight@example.de')).statusCode).toBe(202);
    const second = await requestLink(h, 'tight@example.de');
    expect(second.statusCode).toBe(429);
    expect(second.json().retryAfterSeconds).toBeLessThanOrEqual(60);
    await h.db.deleteFrom('app_settings').where('key', '=', 'ratelimit.magic_link.email').execute();
    await h.app.get(SettingsService).broadcastChange();
  });

  it('answers identically for new and existing addresses', async () => {
    await signIn(h, 'known@example.de');
    const known = await requestLink(h, 'known@example.de');
    const unknown = await requestLink(h, 'unknown@example.de');
    expect([known.statusCode, known.body]).toEqual([unknown.statusCode, unknown.body]);
  });

  it('e-mails the owner on sign-in from a new device, not on the first or a known one', async () => {
    await signIn(h, 'aylin@example.de', UA_WINDOWS_CHROME);
    await signIn(h, 'aylin@example.de', UA_WINDOWS_CHROME);
    expect((await mailbox(h)).filter((m) => m.tag === 'new_device')).toHaveLength(0);
    await signIn(h, 'aylin@example.de', UA_IPHONE);
    const alerts = (await mailbox(h)).filter((m) => m.tag === 'new_device');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.text).toContain('Safari · iOS');
    const devices = await h.db.selectFrom('sessions').select('user_agent').execute();
    expect(devices.map((d) => d.user_agent)).not.toContain(UA_IPHONE); // only the coarse label is kept
  });
});

describe('session and CSRF', () => {
  it('protects /v1/me', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    const s = await signIn(h, 'me@example.de');
    const me = await h.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: s.cookie } });
    expect(me.json()).toMatchObject({ email: 'me@example.de', preferredLang: 'de', passkeys: [] });
  });

  it('rejects state-changing requests without the CSRF token', async () => {
    const s = await signIn(h, 'csrf@example.de');
    const bad = await h.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { cookie: s.cookie, 'x-csrf-token': 'forged' },
      payload: { preferredLang: 'en' },
    });
    expect(bad.statusCode).toBe(403);
    const good = await h.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: s.headers,
      payload: { preferredLang: 'en' },
    });
    expect(good.statusCode).toBe(200);
  });

  it('logout revokes the session', async () => {
    const s = await signIn(h, 'bye@example.de');
    const out = await h.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: s.headers });
    expect(out.statusCode).toBe(200);
    expect(
      (await h.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: s.cookie } }))
        .statusCode,
    ).toBe(401);
    expect(sessionFrom(out).cookie).toContain('ps_session=;');
  });

  it('removes never-verified sign-ups after 24 h (data minimisation)', async () => {
    await requestLink(h, 'ghost@example.de');
    await signIn(h, 'real@example.de');
    await sql`UPDATE users SET created_at = now() - interval '25 hours'`.execute(h.db);
    await sql`SELECT run_retention()`.execute(h.db);
    const emails = (await h.db.selectFrom('users').select('email').execute()).map((u) => u.email);
    expect(emails).toEqual(['real@example.de']);
  });
});

describe('passkeys', () => {
  it('issues registration options for a signed-in user and login options anonymously', async () => {
    const s = await signIn(h, 'pk@example.de');
    const reg = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/passkey/register/options',
      headers: s.headers,
    });
    expect(reg.statusCode).toBe(200);
    expect(reg.json()).toMatchObject({
      rp: { name: 'ParkShield', id: 'localhost' },
      user: { name: 'pk@example.de' },
    });
    const login = await h.app.inject({ method: 'POST', url: '/v1/auth/passkey/login/options' });
    expect(login.json()).toMatchObject({
      challengeId: expect.any(String),
      options: { rpId: 'localhost' },
    });
  });

  it('rejects an assertion for an unknown challenge or credential', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/passkey/login/verify',
      payload: { challengeId: 'nope', response: { id: 'AAAA', type: 'public-key' } },
    });
    expect(res.statusCode).toBe(401);
  });
});
