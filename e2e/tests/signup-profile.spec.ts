import { expect, test } from '@playwright/test';
import {
  API_URL,
  appSession,
  payPlan,
  SAMPLE_PROFILE,
  smsCodeFor,
  uniqueEmail,
  uniqueMobile,
} from './helpers';

/**
 * Sign-up before payment (docs/app-redesign.md §6/§7, single plan 2026-11-21): a new account gives
 * name and postal address, then verifies a mobile number, before the checkout is possible; the API
 * refuses the checkout without them. Since 2026-11-24 only the app signs up, through this API.
 */
test('a new account completes name, address and a verified mobile number before the checkout', async ({
  request,
}) => {
  const email = uniqueEmail('profil');
  const app = await appSession(request, email);
  const { immediateStart, terms } = (await (
    await request.get(`${API_URL}/v1/legal/checkout-texts?locale=de`)
  ).json()) as { immediateStart: { version: number }; terms: { version: number } };
  const checkout = () =>
    request.post(`${API_URL}/v1/billing/checkout`, {
      headers: app.headers,
      data: {
        immediateStart: true,
        immediateStartVersion: immediateStart.version,
        termsVersion: terms.version,
      },
    });

  const me = (await (
    await request.get(`${API_URL}/v1/me/profile`, { headers: app.headers })
  ).json()) as {
    complete: boolean;
    newAccount: boolean;
    phoneVerified: boolean;
  };
  expect(me).toMatchObject({ complete: false, newAccount: true, phoneVerified: false });
  const noProfile = await checkout();
  expect(noProfile.status()).toBe(409);
  expect(await noProfile.json()).toMatchObject({ error: 'profile_incomplete' });

  const badPostcode = await request.put(`${API_URL}/v1/me/profile`, {
    headers: app.headers,
    data: { ...SAMPLE_PROFILE, postalCode: '5066' },
  });
  expect(badPostcode.status()).toBe(400);
  const saved = await request.put(`${API_URL}/v1/me/profile`, {
    headers: app.headers,
    data: SAMPLE_PROFILE,
  });
  expect(saved.status(), await saved.text()).toBe(200);

  // The mobile number is required (escalation SMS): no checkout until it is verified.
  const noPhone = await checkout();
  expect(noPhone.status()).toBe(409);
  expect(await noPhone.json()).toMatchObject({ error: 'phone_required' });

  // A landline cannot receive the SMS.
  const landline = await request.post(`${API_URL}/v1/channels/phone`, {
    headers: app.headers,
    data: { phone: '0221 1234567', channels: ['sms'], consent: true },
  });
  expect(landline.status()).toBe(400);
  expect(await landline.json()).toMatchObject({ error: 'phone_not_mobile' });

  const phone = uniqueMobile();
  const start = await request.post(`${API_URL}/v1/channels/phone`, {
    headers: app.headers,
    data: { phone, channels: ['sms'], consent: true },
  });
  expect(start.status(), await start.text()).toBe(200);
  const verified = await request.post(`${API_URL}/v1/channels/phone/verify`, {
    headers: app.headers,
    data: { code: await smsCodeFor(request, phone) },
  });
  expect(verified.status()).toBe(200);
  await payPlan(request, { email, ...app, phone });
});
