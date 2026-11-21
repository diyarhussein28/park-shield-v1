import { expect, test, type Browser } from '@playwright/test';
import { API_URL, expectAccessible, ownerWithActiveDecal, uniqueEmail } from './helpers';

/**
 * §25 TDDDG / abuse protection §0: the scanner page must not read or write anything on the device.
 * Every storage API is wrapped before the page's own script runs and each access is recorded.
 */
const RECORD_STORAGE = () => {
  const touched: string[] = [];
  (window as unknown as { __touched: string[] }).__touched = touched;
  const watch = (target: object, prop: string, label: string) => {
    const d =
      Object.getOwnPropertyDescriptor(target, prop) ??
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), prop);
    if (!d) return;
    Object.defineProperty(target, prop, {
      configurable: true,
      get() {
        touched.push(`${label}:get`);
        return d.get ? d.get.call(this) : d.value;
      },
      ...(d.set || 'value' in d
        ? {
            set(v: unknown) {
              touched.push(`${label}:set`);
              if (d.set) d.set.call(this, v);
            },
          }
        : {}),
    });
  };
  watch(window, 'localStorage', 'localStorage');
  watch(window, 'sessionStorage', 'sessionStorage');
  watch(window, 'indexedDB', 'indexedDB');
  watch(window, 'caches', 'caches');
  watch(Document.prototype, 'cookie', 'cookie');
};

async function scanner(browser: Browser, url: string) {
  const ctx = await browser.newContext({ locale: 'de-DE' });
  await ctx.addInitScript(RECORD_STORAGE);
  const page = await ctx.newPage();
  const setCookies: string[] = [];
  page.on('response', (r) => {
    const c = r.headers()['set-cookie'];
    if (c) setCookies.push(`${r.url()}: ${c}`);
  });
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  const touched = () =>
    page.evaluate(() => (window as unknown as { __touched: string[] }).__touched);
  return { ctx, page, setCookies, touched };
}

test('the scanner page touches no cookie and no storage API, also across a reload', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(120_000);
  const url = await ownerWithActiveDecal(page, request, uniqueEmail('nostorage'));
  const s = await scanner(browser, url);
  await s.page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await s.page.getByRole('button', { name: 'Warnung senden' }).click();
  // „Gesendet" is only a moment before „benachrichtigt": wait for the status block itself.
  await expect(s.page.getByRole('heading', { name: 'Status Ihrer Warnung' })).toBeVisible();
  // The status survives a reload through the URL fragment, not through storage.
  await s.page.reload();
  await expect(s.page.getByRole('heading', { name: 'Status Ihrer Warnung' })).toBeVisible();
  expect(await s.touched()).toEqual([]);
  expect(s.setCookies).toEqual([]);
  expect(await s.ctx.cookies()).toEqual([]);
  await s.ctx.close();
});

test('Protected Mode: optional phone check on the scanner page, content shown after confirming', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(120_000);
  const url = await ownerWithActiveDecal(page, request, uniqueEmail('protect'));
  // ownerWithActiveDecal ends on the vehicle page.
  await page.getByRole('button', { name: 'Schutzmodus einschalten' }).click();
  await expect(page.getByText('Der Schutzmodus ist an, bis Sie ihn ausschalten.')).toBeVisible();
  await expectAccessible(page);

  const s = await scanner(browser, url);
  await expect(
    s.page.getByText('Optional: Bestätigen Sie Ihre Handynummer', { exact: false }),
  ).toBeVisible();
  await expectAccessible(s.page);
  await s.page.getByRole('button', { name: 'Handynummer bestätigen' }).click();
  const phone = `0151${String(Date.now()).slice(-8)}`;
  await s.page.getByLabel('Ihre Handynummer').fill(phone);
  await s.page.getByRole('button', { name: 'Code per SMS senden' }).click();
  await expect(s.page.getByLabel('Code aus der SMS')).toBeVisible();
  const { messages } = (await (await request.get(`${API_URL}/v1/dev/sms`)).json()) as {
    messages: { to: string; body: string; tag: string }[];
  };
  const sms = messages.find((m) => m.tag === 'sms_verify' && m.to.endsWith(phone.slice(-8)))!;
  await s.page.getByLabel('Code aus der SMS').fill(/(\d{6})/.exec(sms.body)![1]!);
  await s.page.getByRole('button', { name: 'Bestätigen', exact: true }).click();
  await expect(s.page.getByText('Nummer bestätigt.', { exact: false })).toBeVisible();
  await s.page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await s.page.getByRole('button', { name: 'Warnung senden' }).click();
  // „Gesendet" is only a moment before „benachrichtigt": wait for the status block itself.
  await expect(s.page.getByRole('heading', { name: 'Status Ihrer Warnung' })).toBeVisible();
  expect(await s.touched()).toEqual([]);
  await s.ctx.close();

  await page.goto('/konto/verlauf');
  await expect(page.getByText('Bestätigte Handynummer').first()).toBeVisible();
});
