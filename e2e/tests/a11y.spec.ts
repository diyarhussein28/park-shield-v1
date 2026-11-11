import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import {
  linkIn,
  OPS_URL,
  ownerWithActiveDecal,
  settleAnimations,
  sql,
  staffBrowser,
  uniqueEmail,
  waitForMail,
} from './helpers';

/**
 * US-45 accessibility audit (WCAG 2.2 AA, SC-12): every page, German at desktop width and English on a
 * 320 px screen (WCAG 1.4.10 reflow; also covers 200 % zoom), plus text spacing, reduced motion and
 * keyboard-only runs of the main flows. Pages that need a link token are checked in their
 * "invalid link" state.
 */
const WEB_PUBLIC = [
  '/',
  '/anmelden',
  '/anmelden/link',
  '/business',
  '/business/bestaetigen',
  '/impressum',
  '/datenschutz',
  '/agb',
  '/widerruf',
  '/barrierefreiheit',
  '/sicherheit',
  '/kuendigen',
  '/hilfe',
  '/hilfe/push-auf-dem-iphone',
  '/hilfe/kontakt',
  '/aktivieren',
  '/antwort',
  '/notfallkontakt',
  '/konto-loeschen-abbrechen',
  '/datenschutz-anfrage',
];
const WEB_ACCOUNT = [
  '/konto',
  '/konto/fahrzeuge',
  '/konto/benachrichtigungen',
  '/konto/notfallkontakte',
  '/konto/verlauf',
  '/konto/zustellung',
  '/konto/daten',
];
const OPS = [
  '/',
  '/kunden',
  '/break-glass',
  '/datenschutz',
  '/missbrauch',
  '/missbrauch/pruefung',
  '/missbrauch/woerter',
  '/mitarbeitende',
  '/mitarbeitende/pruefung',
  '/bestellungen',
  '/partner',
  '/gutscheine',
  '/einstellungen',
  '/einstellungen/anbieter',
  '/audit',
];
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function audit(page: Page, url: string, problems: string[]) {
  const res = await page.goto(url);
  await page.waitForLoadState('networkidle');
  const where = `${new URL(page.url()).host}${url} [${page.viewportSize()?.width}px ${await page.evaluate(() => document.documentElement.lang)}]`;
  if (!res || res.status() >= 500) problems.push(`${where}: HTTP ${res?.status()}`);
  // Scroll-revealed sections (landing page) stay transparent until seen: scroll through once so
  // axe checks them too, then wait for the fade-ins to finish.
  await page.evaluate(async () => {
    if (!document.querySelector('[data-reveal]')) return;
    for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 1200));
  });
  await settleAnimations(page);
  const results = await new AxeBuilder({ page })
    .withTags([...WCAG, 'best-practice'])
    // Content outside landmarks: the Next.js dev indicator only exists in `next dev`.
    .exclude('nextjs-portal')
    .analyze();
  for (const v of results.violations)
    problems.push(
      `${where}: ${v.id} – ${v.help} (${v.nodes
        .map((n) => n.target.join(' '))
        .slice(0, 3)
        .join(' | ')})`,
    );
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  if (scroll > client) problems.push(`${where}: page is ${scroll}px wide on a ${client}px screen`);
}

async function signedInContext(
  browser: Browser,
  locale: string,
  viewport: { width: number; height: number },
  cookiesFrom: Page,
) {
  const ctx = await browser.newContext({ locale, viewport });
  await ctx.addCookies(await cookiesFrom.context().cookies());
  return ctx.newPage();
}

test.describe('accessibility audit (US-45)', () => {
  test.skip(({ isMobile }) => isMobile, 'the sweep sets its own viewports; one project is enough');

  for (const [locale, viewport] of [
    ['de-DE', { width: 1280, height: 900 }],
    ['en-GB', { width: 320, height: 720 }],
  ] as const)
    test(`every page passes axe (WCAG 2.2 AA and best practice): ${locale} at ${viewport.width} px`, async ({
      page,
      request,
      browser,
    }) => {
      test.setTimeout(900_000);
      await sweep(page, request, browser, locale, viewport);
    });

  async function sweep(
    page: Page,
    request: APIRequestContext,
    browser: Browser,
    locale: string,
    viewport: { width: number; height: number },
  ) {
    const email = uniqueEmail('a11y');
    const scanUrl = await ownerWithActiveDecal(page, request, email);
    const [v] = await sql(
      `SELECT v.id AS vehicle, u.id AS user, (SELECT a.id FROM alerts a WHERE a.vehicle_id = v.id LIMIT 1) AS alert
         FROM vehicles v JOIN users u ON u.id = v.owner_user_id WHERE u.email = $1`,
      [email],
    );
    const account = [...WEB_ACCOUNT, `/konto/fahrzeuge/${v.vehicle}`];
    const ops = [
      ...OPS,
      `/kunden/${v.user}`,
      `/kunden/${v.user}/erstattung?abo=x`,
      `/warnungen/${v.alert}`,
    ];
    const problems: string[] = [];
    const anon = await (await browser.newContext({ locale, viewport })).newPage();
    for (const url of [...WEB_PUBLIC, new URL(scanUrl).pathname]) await audit(anon, url, problems);
    const owner = await signedInContext(browser, locale, viewport, page);
    for (const url of account) await audit(owner, url, problems);
    const staff = await staffBrowser(browser, 'a11y', ['superadmin', 'admin'], {
      locale,
      viewport,
    });
    for (const url of ops) await audit(staff, `${OPS_URL}${url}`, problems);
    await anon.context().close();
    await owner.context().close();
    await staff.context().close();
    expect(problems).toEqual([]);
  }

  test('text spacing (WCAG 1.4.12) and reduced motion (2.3.3) hold on every public page', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext({
      locale: 'de-DE',
      viewport: { width: 320, height: 720 },
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    const problems: string[] = [];
    for (const url of WEB_PUBLIC) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await page.addStyleTag({
        content:
          '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }',
      });
      const r = await page.evaluate(() => {
        const moving = [...document.querySelectorAll('*')].filter((e) => {
          const s = getComputedStyle(e);
          const secs = (v: string) =>
            Math.max(
              ...v.split(',').map((x) => parseFloat(x) * (x.trim().endsWith('ms') ? 0.001 : 1)),
            );
          return secs(s.animationDuration) > 0.01 || secs(s.transitionDuration) > 0.01;
        }).length;
        return {
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
          moving,
        };
      });
      if (r.scroll > r.client)
        problems.push(`${url}: ${r.scroll}px wide with WCAG text spacing on 320 px`);
      if (r.moving) problems.push(`${url}: ${r.moving} elements still animate with reduced motion`);
    }
    await ctx.close();
    expect(problems).toEqual([]);
  });

  test('keyboard only: skip link, visible focus, sign-in and sending an alert', async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext({ locale: 'de-DE' });
    const page = await ctx.newPage();
    const tabTo = async (name: string | RegExp, role: 'button' | 'link' | 'textbox' = 'button') => {
      const target = page.getByRole(role, { name });
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press('Tab');
        if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) {
          // WCAG 2.4.7 / 2.4.13: the focused control shows a visible indicator.
          const outline = await target.evaluate((el) => {
            const s = getComputedStyle(el);
            return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2;
          });
          expect(outline, `focus indicator on ${String(name)}`).toBe(true);
          return;
        }
      }
      throw new Error(`could not reach ${String(name)} with Tab`);
    };

    await page.goto('/anmelden');
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Zum Inhalt springen' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);

    const email = uniqueEmail('keys');
    await tabTo('E-Mail-Adresse', 'textbox');
    await page.keyboard.type(email);
    await page.keyboard.press('Enter');
    await expect(page.getByText('Fast geschafft!')).toBeVisible({ timeout: 15_000 });
    const mail = await waitForMail(request, email, 'magic_link');
    await page.goto(linkIn(mail));
    await page.waitForLoadState('networkidle');
    await tabTo('Anmelden');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/konto$/, { timeout: 30_000 });

    // The scanner page, as a stranger using only the keyboard.
    const owner = await browser.newContext({ locale: 'de-DE' });
    const ownerPage = await owner.newPage();
    const scanUrl = await ownerWithActiveDecal(ownerPage, request, uniqueEmail('keyscan'));
    await owner.close();
    await page.goto(scanUrl);
    await tabTo('Licht brennt noch');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Status Ihrer Warnung' })).toBeVisible({
      timeout: 15_000,
    });
    await ctx.close();
  });
});
