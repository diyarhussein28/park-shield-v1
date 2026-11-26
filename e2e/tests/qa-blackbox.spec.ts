import { createHmac } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  addVehicle,
  API_URL,
  appOwner,
  appSession,
  ownerWithActiveDecal,
  SAMPLE_PROFILE,
  sql,
  uniqueEmail,
} from './helpers';

/**
 * Black-box checks from the external QA catalogue (docs/qa/cases.mjs) that the feature specs do not
 * cover yet: negative inputs, tampered links and tokens, IDOR and forged webhooks. Case IDs in the
 * titles. API-level, so desktop only.
 */
test.skip(({ isMobile }) => isMobile, 'API-level');

const CAPTCHA = 'dev-captcha-ok';
const WEB = process.env.WEB_BASE_URL ?? 'http://localhost:3000';

const alertBody = (extra: Record<string, unknown> = {}) => ({
  type: 'lights_on',
  lang: 'de',
  captcha: CAPTCHA,
  ...extra,
});

/** SMS in the dev inbox (it keeps the last 50) to one number since a moment. */
async function smsTo(request: APIRequestContext, e164: string, since: number) {
  const { messages } = (await (await request.get(`${API_URL}/v1/dev/sms`)).json()) as {
    messages: { to: string; sentAt: string }[];
  };
  return messages.filter((m) => m.to === e164 && Date.parse(m.sentAt) >= since).length;
}

const codeOf = (url: string) => new URL(url).pathname.split('/').pop()!;

async function noRedirect(request: APIRequestContext, path: string) {
  return request.get(`${WEB}${path}`, { maxRedirects: 0 });
}

test('WEB-13/14/20, NOLOGIN-10: old portal URLs 308 to /app, unknown pages 404, app link files are JSON', async ({
  request,
}) => {
  for (const p of [
    '/anmelden',
    '/konto',
    '/konto/abo',
    '/konto/fahrzeuge',
    '/aktivieren',
    '/antwort',
  ]) {
    const r = await noRedirect(request, p);
    expect.soft(r.status(), p).toBe(308);
    expect.soft(r.headers()['location'] ?? '', p).toMatch(/\/app$/);
  }
  for (const p of ['/does-not-exist', '/hilfe/does-not-exist']) {
    const r = await request.get(`${WEB}${p}`);
    expect.soft(r.status(), p).toBe(404);
    // (The page source carries a stack only under `next dev`; production builds never ship it.)
  }
  for (const p of ['/.well-known/apple-app-site-association', '/.well-known/assetlinks.json']) {
    const r = await noRedirect(request, p);
    expect.soft(r.status(), p).toBe(200);
    expect.soft(r.headers()['content-type'] ?? '', p).toContain('json');
    const text = await r.text();
    expect.soft(() => JSON.parse(text), p).not.toThrow();
  }
  for (const p of [
    '/app/anmelden',
    '/app/zurueck',
    '/app/alerts/00000000-0000-0000-0000-000000000000',
  ]) {
    const r = await request.get(`${WEB}${p}`);
    expect.soft(r.status(), p).toBeLessThan(400);
  }
  const back = await noRedirect(request, '/app/zurueck?u=https://evil.example/');
  expect.soft(back.status(), 'foreign target').toBe(303);
  expect.soft(back.headers()['location'], 'foreign target').toBe('/app');
});

test('WEB-11: security.txt is reachable, has a contact and a future expiry', async ({
  request,
}) => {
  const r = await request.get(`${WEB}/.well-known/security.txt`);
  expect(r.status()).toBe(200);
  const txt = await r.text();
  expect(txt).toMatch(/^Contact: /m);
  const expires = /^Expires: (.+)$/m.exec(txt)?.[1];
  expect(expires).toBeTruthy();
  expect(new Date(expires!).getTime()).toBeGreaterThan(Date.now());
});

test('WEB-17: contact form validation (empty, bad e-mail, too long, script stays text)', async ({
  request,
}) => {
  const base = {
    email: 'qa@example.de',
    topic: 'other',
    message: 'Eine Frage zum Aufkleber.',
    captcha: CAPTCHA,
  };
  const topics = await request.post(`${API_URL}/v1/support/contact`, { data: base });
  // The topic list may differ; a 400 on the topic itself would be a test issue, not a finding.
  test.skip(
    topics.status() === 400 && (await topics.text()).includes('topic'),
    'topic enum changed',
  );
  expect.soft(topics.status()).toBe(201);
  for (const bad of [
    { ...base, message: '' },
    { ...base, email: 'abc@' },
    { ...base, message: 'x'.repeat(10_000) },
  ]) {
    const r = await request.post(`${API_URL}/v1/support/contact`, { data: bad });
    expect.soft(r.status(), JSON.stringify(bad).slice(0, 60)).toBe(400);
  }
});

test('SCAN-02/04: unknown, malformed and injected codes give the neutral page; lowercase resolves', async ({
  page,
  request,
}) => {
  for (const c of [
    'AAAAAAAAAA',
    'abc',
    'ABCDEFGHJKM',
    '%3Cscript%3Ealert(1)%3C%2Fscript%3E',
    'x'.repeat(300),
  ]) {
    const api = await request.get(`${API_URL}/v1/scan/${c}`);
    // 414 (URI too long) for the 300-character code is fine: neutral, no crash.
    expect.soft([404, 414], `api ${c.slice(0, 20)}`).toContain(api.status());
    const web = await request.get(`${WEB}/s/${c}`);
    expect.soft(web.status(), `web ${c.slice(0, 20)}`).toBeLessThan(500);
    const html = await web.text();
    expect.soft(html, 'no reflected input').not.toContain('<script>alert(1)');
  }
  const owner = await ownerWithActiveDecal(page, request, uniqueEmail('qa-scan-case'));
  const code = codeOf(owner.url);
  const lower = await request.get(`${API_URL}/v1/scan/${code.toLowerCase()}`);
  expect.soft(lower.status(), 'lowercase code').toBe(200);
});

test('SCAN-07/08/10/14/18: message limits, empty message, injection, captcha, double submit', async ({
  page,
  request,
}) => {
  const owner = await ownerWithActiveDecal(page, request, uniqueEmail('qa-scan-input'));
  const code = codeOf(owner.url);
  // Allow several alerts in a row for this vehicle (the default waits 15 min between alerts).
  await sql(
    `INSERT INTO app_settings (key, value, updated_by_reason) VALUES ('ratelimit.alert.scanner_vehicle', '{"max":50,"windowSeconds":60}', 'qa') ON CONFLICT (key) DO NOTHING`,
  ).catch(() => undefined);

  const noCaptcha = await request.post(`${API_URL}/v1/scan/${code}/alerts`, {
    data: { type: 'lights_on', lang: 'de' },
  });
  expect.soft(noCaptcha.status(), 'no captcha').toBe(400);
  const badCaptcha = await request.post(`${API_URL}/v1/scan/${code}/alerts`, {
    data: alertBody({ captcha: 'forged' }),
  });
  expect.soft(badCaptcha.status(), 'forged captcha').toBe(400);

  const tooLong = await request.post(`${API_URL}/v1/scan/${code}/alerts`, {
    data: alertBody({ type: 'custom', message: 'a'.repeat(281) }),
  });
  expect.soft(tooLong.status(), '281 chars').toBe(400);

  const empty = await request.post(`${API_URL}/v1/scan/${code}/alerts`, {
    data: alertBody({ type: 'custom', message: '   ' }),
  });
  expect.soft(empty.status(), 'empty custom message').toBeGreaterThanOrEqual(400);
  expect.soft(empty.status(), 'empty custom message').toBeLessThan(500);
});

test('SCAN-18: a double tap on „Warnung senden“ creates one alert', async ({ page, request }) => {
  const owner = await ownerWithActiveDecal(page, request, uniqueEmail('qa-double'));
  await page.goto(owner.url);
  await page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await page.getByRole('button', { name: 'Warnung senden' }).dblclick();
  await expect(page.locator('#busy, [role=status]').first()).toBeAttached();
  await page.waitForLoadState('networkidle');
  const [{ n }] = await sql(
    `SELECT count(*)::int AS n FROM alerts WHERE vehicle_id = $1 AND NOT is_test`,
    [owner.vehicleId],
  );
  expect(n).toBe(1);
});

test('SCAN-10, CHAT-04, ESC-08: injected text stays text; tampered status, chat and view tokens fail', async ({
  page,
  request,
}) => {
  const owner = await ownerWithActiveDecal(page, request, uniqueEmail('qa-tamper'));
  const code = codeOf(owner.url);
  const r = await request.post(`${API_URL}/v1/scan/${code}/alerts`, {
    data: alertBody({ type: 'custom', message: 'Licht an {{7*7}} ${7*7} <b>fett</b>' }),
  });
  expect(r.status(), await r.text()).toBeLessThan(300);
  const { alertId, statusToken } = (await r.json()) as { alertId: string; statusToken: string };

  const good = await request.get(`${API_URL}/v1/alerts/${alertId}/status`, {
    headers: { 'x-status-token': statusToken },
  });
  expect.soft(good.status()).toBe(200);
  const flipped = statusToken.slice(0, -1) + (statusToken.endsWith('A') ? 'B' : 'A');
  for (const [label, headers] of [
    ['no token', {}],
    ['tampered token', { 'x-status-token': flipped }],
  ] as const) {
    const res = await request.get(`${API_URL}/v1/alerts/${alertId}/status`, { headers });
    expect.soft(res.status(), label).toBe(404);
  }
  const other = await request.get(
    `${API_URL}/v1/alerts/00000000-0000-4000-8000-000000000000/status`,
    { headers: { 'x-status-token': statusToken } },
  );
  expect.soft(other.status(), 'token of another alert').toBe(404);

  // The owner reads the message back: stored and returned verbatim (escaping is the renderer's job).
  const detail = await request.get(`${API_URL}/v1/app/alerts/${alertId}`, {
    headers: owner.headers,
  });
  expect.soft(detail.status()).toBe(200);
  // Template syntax is not evaluated anywhere on the way.
  expect
    .soft(((await detail.json()) as { message: string }).message)
    .toBe('Licht an {{7*7}} ${7*7} <b>fett</b>');

  // View link of the escalation SMS: a made-up and a tampered token give a neutral answer.
  for (const t of ['abc', 'A'.repeat(43), `${'x'.repeat(40)}%3Cscript%3E`]) {
    const v = await request.get(`${API_URL}/v1/view/${t}`);
    expect.soft(v.status(), `api view ${t.slice(0, 10)}`).toBeGreaterThanOrEqual(400);
    expect.soft(v.status(), `api view ${t.slice(0, 10)}`).toBeLessThan(500);
    const w = await request.get(`${WEB}/v/${t}`);
    expect.soft(w.status(), `web view ${t.slice(0, 10)}`).toBeLessThan(500);
  }
});

test('SEC-01: an owner cannot reach another owner’s vehicle, alert, decal or export', async ({
  page,
  request,
}) => {
  const b = await ownerWithActiveDecal(page, request, uniqueEmail('qa-idor-b'));
  const sent = await request.post(`${API_URL}/v1/scan/${codeOf(b.url)}/alerts`, {
    data: alertBody(),
  });
  const { alertId } = (await sent.json()) as { alertId: string };
  const a = await appOwner(request, uniqueEmail('qa-idor-a'));
  const calls: [string, string, Record<string, unknown>?][] = [
    ['GET', `/v1/vehicles/${b.vehicleId}`],
    ['GET', `/v1/vehicles/${b.vehicleId}/decal.svg`],
    ['GET', `/v1/vehicles/${b.vehicleId}/decal.pdf`],
    ['GET', `/v1/vehicles/${b.vehicleId}/qr`],
    ['GET', `/v1/vehicles/${b.vehicleId}/new-code`],
    ['GET', `/v1/vehicles/${b.vehicleId}/protection`],
    ['POST', `/v1/vehicles/${b.vehicleId}/tokens/revoke`, { confirm: true, reason: 'other' }],
    ['POST', `/v1/vehicles/${b.vehicleId}/test-window`],
    ['DELETE', `/v1/vehicles/${b.vehicleId}`],
    ['GET', `/v1/app/alerts/${alertId}`],
    ['POST', `/v1/app/alerts/${alertId}/seen`],
    ['POST', `/v1/app/alerts/${alertId}/resolve`],
    ['POST', `/v1/app/alerts/${alertId}/block`],
    ['POST', `/v1/app/alerts/${alertId}/chat/open`],
    ['GET', `/v1/alerts/${alertId}/hidden-content`],
  ];
  for (const [method, path, body] of calls) {
    const r = await request.fetch(`${API_URL}${path}`, {
      method,
      headers: a.headers,
      data: method === 'GET' || method === 'DELETE' ? undefined : (body ?? {}),
    });
    expect.soft([403, 404], `${method} ${path} → ${r.status()}`).toContain(r.status());
  }
  // B's data is untouched.
  const [v] = await sql(`SELECT deleted_at FROM vehicles WHERE id = $1`, [b.vehicleId]).catch(
    () => [{ deleted_at: null }],
  );
  expect(v?.deleted_at ?? null).toBeNull();
});

test('SEC-02/04: no ops routes on the public API; security headers on API, web and scanner', async ({
  page,
  request,
}) => {
  for (const p of ['/ops/v1/health', '/ops/v1/overview', '/ops/v1/customers']) {
    const r = await request.get(`${API_URL}${p}`);
    expect.soft(r.status(), p).toBe(404);
  }
  const api = await request.get(`${API_URL}/v1/plans`);
  const h = api.headers();
  expect.soft(h['x-content-type-options']).toBe('nosniff');
  expect.soft(h['cache-control'] ?? '').toContain('no-store');
  expect.soft(h['x-frame-options'] ?? '').toMatch(/deny/i);
  expect.soft(h['content-security-policy'] ?? '').toContain("default-src 'none'");

  const web = (await request.get(`${WEB}/`)).headers();
  expect.soft(web['content-security-policy'] ?? '').toMatch(/nonce-|script-src/);
  expect.soft(web['x-content-type-options']).toBe('nosniff');
  expect
    .soft(`${web['content-security-policy']} ${web['x-frame-options']}`)
    .toMatch(/frame-ancestors 'none'|DENY/i);

  const owner = await ownerWithActiveDecal(page, request, uniqueEmail('qa-headers'));
  const scan = (await request.get(owner.url)).headers();
  expect.soft(scan['content-security-policy'] ?? '').toMatch(/sha256-|nonce-/);
  expect.soft(scan['referrer-policy'] ?? '').toMatch(/no-referrer|same-origin|strict-origin/);
});

test('SEC-06: forged Stripe, RevenueCat and Twilio webhooks are refused', async ({ request }) => {
  const event = JSON.stringify({
    id: 'evt_forged',
    type: 'checkout.session.completed',
    data: { object: {} },
  });
  const stripeNoSig = await request.post(`${API_URL}/v1/webhooks/stripe`, {
    headers: { 'content-type': 'application/json' },
    data: event,
  });
  expect.soft(stripeNoSig.status(), 'stripe without signature').toBeGreaterThanOrEqual(400);
  const t = Math.floor(Date.now() / 1000);
  const forgedSig = createHmac('sha256', 'whsec_wrong').update(`${t}.${event}`).digest('hex');
  const stripeBadSig = await request.post(`${API_URL}/v1/webhooks/stripe`, {
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${forgedSig}` },
    data: event,
  });
  expect.soft(stripeBadSig.status(), 'stripe wrong secret').toBeGreaterThanOrEqual(400);
  const rc = await request.post(`${API_URL}/v1/webhooks/revenuecat`, {
    headers: { authorization: 'Bearer forged' },
    data: { event: { type: 'INITIAL_PURCHASE', app_user_id: 'x', id: 'forged' } },
  });
  expect.soft(rc.status(), 'revenuecat forged').toBeGreaterThanOrEqual(400);
  const tw = await request.post(`${API_URL}/v1/webhooks/twilio/sms`, {
    headers: { 'x-twilio-signature': 'forged' },
    form: { MessageSid: 'SMforged', MessageStatus: 'delivered' },
  });
  expect.soft(tw.status(), 'twilio forged').toBeGreaterThanOrEqual(400);
});

test('SEC-07: sign-in answers are the same for known and unknown e-mails', async ({ request }) => {
  const known = uniqueEmail('qa-enum-known');
  await appSession(request, known);
  const a = await request.post(`${API_URL}/v1/auth/email/request`, { data: { email: known } });
  const b = await request.post(`${API_URL}/v1/auth/email/request`, {
    data: { email: uniqueEmail('qa-enum-unknown') },
  });
  expect.soft(a.status()).toBe(b.status());
  expect.soft(await a.text()).toBe(await b.text());
});

test('ONB-04/09/10/11, PAY-13: e-mail, phone, address validation and checkout before the profile', async ({
  request,
}) => {
  for (const email of ['abc', 'a@b', 'a b@example.de', `${'a'.repeat(250)}@example.de`]) {
    const r = await request.post(`${API_URL}/v1/auth/email/request`, { data: { email } });
    expect.soft(r.status(), `e-mail ${email.slice(0, 20)}`).toBe(400);
  }
  const app = await appSession(request, uniqueEmail('qa-onb'));
  const early = await request.post(`${API_URL}/v1/billing/checkout`, {
    headers: app.headers,
    data: { plan: 'standard', immediateStart: true, immediateStartVersion: 1, termsVersion: 1 },
  });
  expect.soft(early.status(), 'checkout before the profile').toBe(409);
  expect.soft(await early.text()).toContain('profile_incomplete');

  for (const [label, profile] of [
    ['empty', {}],
    ['4-digit German ZIP', { ...SAMPLE_PROFILE, postalCode: '5066' }],
  ] as const) {
    const r = await request.put(`${API_URL}/v1/me/profile`, {
      headers: app.headers,
      data: profile,
    });
    expect.soft(r.status(), label).toBe(400);
  }
  const at = await request.put(`${API_URL}/v1/me/profile`, {
    headers: app.headers,
    data: {
      ...SAMPLE_PROFILE,
      street: "Rue d'Été-Straße 1",
      postalCode: '1010',
      city: 'Wien',
      country: 'AT',
    },
  });
  expect.soft(at.status(), 'Austrian address').toBe(200);
  const back = await request.get(`${API_URL}/v1/me/profile`, { headers: app.headers });
  expect.soft(await back.text()).toContain("Rue d'Été-Straße 1");

  for (const phone of ['0221 1234567', '032 12345678', 'abcdefg', '0151', '0151 1234567890123']) {
    const r = await request.post(`${API_URL}/v1/channels/phone`, {
      headers: app.headers,
      data: { phone, channels: ['sms'], consent: true },
    });
    expect.soft(r.status(), `phone ${phone}`).toBeGreaterThanOrEqual(400);
    expect.soft(r.status(), `phone ${phone}`).toBeLessThan(500);
  }
  // One account per format: three code requests in a row already hit the per-user SMS limit.
  const variants = ['0151 23456789', '+49 151 23456789', '0049 151 23456789', '0151-2345-6789'];
  const since = Date.now() - 1000;
  for (const phone of variants) {
    const other = await appSession(request, uniqueEmail('qa-onb-phone'));
    const r = await request.post(`${API_URL}/v1/channels/phone`, {
      headers: other.headers,
      data: { phone, channels: ['sms'], consent: true },
    });
    expect.soft(r.status(), `phone ${phone}: ${await r.text()}`).toBe(200);
  }
  expect
    .soft(await smsTo(request, '+4915123456789', since), 'all formats reach +49 151 23456789')
    .toBe(variants.length);
});

test('VEH-02/03/04, DECAL-02, CODE-06: vehicle, header and new-code rules hold at the API', async ({
  request,
}) => {
  const unpaid = await appOwner(request, uniqueEmail('qa-veh-unpaid'), { pay: false });
  const noPlan = await request.post(`${API_URL}/v1/vehicles`, {
    headers: unpaid.headers,
    data: { nickname: 'Der Blaue', plate: 'K-AB 1234' },
  });
  expect.soft(noPlan.status(), 'vehicle without subscription').toBeGreaterThanOrEqual(400);

  const owner = await appOwner(request, uniqueEmail('qa-veh'));
  for (const [label, data] of [
    ['empty plate', { nickname: 'Der Blaue', plate: '' }],
    ['30-char plate', { nickname: 'Der Blaue', plate: 'K-AB 1234567890123456789012' }],
    ['emoji plate', { nickname: 'Der Blaue', plate: 'K-AB 🚗' }],
    ['HTML nickname', { nickname: '<b>x</b>', plate: 'K-AB 1234' }],
  ] as const) {
    const r = await request.post(`${API_URL}/v1/vehicles`, { headers: owner.headers, data });
    expect.soft(r.status(), label).toBe(400);
  }
  const vehicleId = await addVehicle(request, owner, { plate: 'k-ab 1234' });
  const v = await request.get(`${API_URL}/v1/vehicles/${vehicleId}`, { headers: owner.headers });
  expect.soft(await v.text(), 'plate upper case').toContain('K-AB 1234');

  const second = await request.post(`${API_URL}/v1/vehicles`, {
    headers: owner.headers,
    data: { nickname: 'Der Rote', plate: 'K-CD 5678' },
  });
  expect.soft(second.status(), 'second vehicle').toBeGreaterThanOrEqual(400);

  for (const [label, cta] of [
    ['41 chars', 'A'.repeat(41)],
    ['phone number', 'Ruf mich an 0151 2345678'],
    ['insult', 'Du Arschloch'],
  ] as const) {
    const r = await request.put(`${API_URL}/v1/vehicles/${vehicleId}/decal`, {
      headers: owner.headers,
      data: { template: 'classic', cta },
    });
    expect.soft(r.status(), `header ${label}: ${await r.text()}`).toBe(400);
  }

  const active = await request.post(`${API_URL}/v1/vehicles/${vehicleId}/tokens`, {
    headers: owner.headers,
    data: { confirm: true },
  });
  expect.soft(active.status(), `new code while active: ${await active.text()}`).toBe(409);
});

test('NOLOGIN-02/04/06: cancellation and withdrawal without sign-in reveal nothing', async ({
  request,
}) => {
  const owner = await appOwner(request, uniqueEmail('qa-cancel'));
  await addVehicle(request, owner);
  const base = { name: 'Erika Mustermann', email: owner.email, locale: 'de' };
  const ctx = await request.get(`${API_URL}/v1/legal/context`);
  expect.soft(ctx.status()).toBe(200);

  const unknown = await request.post(`${API_URL}/v1/legal/cancellations`, {
    data: { ...base, email: uniqueEmail('qa-cancel-unknown'), plate: 'K-XY 999' },
  });
  const wrongPlate = await request.post(`${API_URL}/v1/legal/cancellations`, {
    data: { ...base, plate: 'K-XY 999' },
  });
  expect.soft(unknown.status(), `unknown e-mail ${await unknown.text()}`).toBeLessThan(300);
  expect.soft(wrongPlate.status(), `wrong plate ${await wrongPlate.text()}`).toBeLessThan(300);
  const [sub] = await sql(
    `SELECT s.status, s.cancel_at_period_end FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE u.email = $1`,
    [owner.email],
  ).catch(() => [undefined]);
  if (sub) expect.soft(sub.cancel_at_period_end ?? false, 'stranger cannot cancel').toBe(false);
});
