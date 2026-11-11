import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const OPS_URL = process.env.OPS_BASE_URL ?? 'http://localhost:3001';
const API_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
// Next.js dev tools render inside <nextjs-portal> in dev mode only; checks cover the app's own content.
const DEV_OVERLAY = 'nextjs-portal';

test('API is ready (PostgreSQL + Valkey)', async ({ request }) => {
  const res = await request.get(`${API_URL}/v1/ready`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ ready: true });
});

test('language follows Accept-Language and switches without a reload (US-03)', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto('/design');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Design system');

  await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 42));
  await page.getByRole('button', { name: 'Deutsch' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Designsystem');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(42);
  await ctx.close();
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`design system has no WCAG 2.2 AA violations (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/design');
    await page.getByLabel(/E-Mail-Adresse/).fill('not-an-email');
    await expect(page.getByText('Bitte geben Sie eine gültige E-Mail-Adresse ein.')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .exclude(DEV_OVERLAY)
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
}

test('touch targets are at least 48 px (SC-12)', async ({ page }) => {
  await page.goto('/design');
  const buttons = await page.locator('header, main').getByRole('button').all();
  expect(buttons.length).toBeGreaterThan(5);
  for (const button of buttons) {
    const box = await button.boundingBox();
    expect(box, (await button.textContent()) ?? '').not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(48);
  }
});

test('ops app asks for a passkey sign-in (US-34)', async ({ page }) => {
  await page.goto(OPS_URL);
  await expect(page).toHaveURL(/\/anmelden$/);
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mit Passkey anmelden' })).toBeVisible();
});
