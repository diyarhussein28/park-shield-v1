import { expect, test } from '@playwright/test';
import { API_URL, appOwner, expectAccessible, uniqueEmail, waitForMail } from './helpers';

/**
 * Konto → „E-Mail-Adresse ändern“ (2026-11-24; the website portal moved into the app the same day):
 * the code goes to the new address, the account keeps the old one until it is confirmed, the old one
 * gets a notice. Driven through the owner API exactly as the app calls it.
 */
test('the owner changes the e-mail address with a code sent to the new address', async ({
  request,
}) => {
  const email = uniqueEmail('mailwechsel');
  const next = uniqueEmail('neue-adresse');
  const owner = await appOwner(request, email, { pay: false });
  const profile = async () =>
    (
      (await (
        await request.get(`${API_URL}/v1/me/profile`, { headers: owner.headers })
      ).json()) as {
        email: string;
      }
    ).email;
  expect(await profile()).toBe(email);

  const same = await request.post(`${API_URL}/v1/me/email/change`, {
    headers: owner.headers,
    data: { email },
  });
  expect(same.status()).toBe(400);
  expect(await same.json()).toMatchObject({ error: 'email_unchanged' });

  const start = await request.post(`${API_URL}/v1/me/email/change`, {
    headers: owner.headers,
    data: { email: next },
  });
  expect(start.status(), await start.text()).toBeLessThan(300);
  const mail = await waitForMail(request, next, 'email_change_code');
  // Until the code is confirmed the account keeps the old address.
  expect(await profile()).toBe(email);
  const code = /\b(\d{6})\b/.exec(mail.text)![1]!;
  const verify = await request.post(`${API_URL}/v1/me/email/change/verify`, {
    headers: owner.headers,
    data: { code },
  });
  expect(verify.status(), await verify.text()).toBeLessThan(300);
  expect(await profile()).toBe(next);
  await waitForMail(request, email, 'email_changed');
});

/** The danger line „In echter Gefahr: 110 … 112 …“ has both numbers as tap-to-call links. */
test('the scanner page links 110 and 112 for calling', async ({ page }) => {
  await page.goto('/s/0000000000');
  const danger = page.locator('.danger');
  await expect(danger).toContainText('In echter Gefahr');
  await expect(danger.locator('a[href="tel:110"]')).toHaveText('110');
  await expect(danger.locator('a[href="tel:112"]')).toHaveText('112');
  await expectAccessible(page);
});
