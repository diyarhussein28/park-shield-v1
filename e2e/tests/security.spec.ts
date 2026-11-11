import { expect, test, type Page } from '@playwright/test';
import { OPS_URL, signUp, staffBrowser, uniqueEmail } from './helpers';

/** Collects CSP violations the browser reports while the page runs. */
function watchCsp(page: Page) {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to (execute|load|apply|connect)/i.test(m.text()))
      violations.push(m.text().slice(0, 200));
  });
  return violations;
}

test('strict CSP on the web and ops apps: pages hydrate, nothing is blocked (US-45, ASVS 14.4)', async ({
  page,
  request,
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'headers do not depend on the device');
  test.setTimeout(120_000);
  const violations = watchCsp(page);

  for (const path of ['/', '/hilfe', '/anmelden', '/sicherheit']) {
    const res = await page.goto(path);
    const csp = res!.headers()['content-security-policy'] ?? '';
    expect(csp, path).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp, path).toContain("frame-ancestors 'none'");
    expect(res!.headers()['x-frame-options'], path).toBe('DENY');
  }
  // Interactive after hydration: the search filters the help articles.
  await page.goto('/hilfe');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Hilfe durchsuchen').fill('iPhone');
  await expect(page.getByText(/1 Treffer/)).toBeVisible();

  await signUp(page, request, uniqueEmail('csp')); // the whole sign-in flow, client-side, under CSP

  const scanner = await request.get('/s/0000000000');
  expect(scanner.headers()['content-security-policy']).toContain("default-src 'none'");

  const txt = await request.get('/.well-known/security.txt');
  expect(await txt.text()).toContain('Contact: mailto:security@parkshield.de');

  const ops = await staffBrowser(browser, 'admin', ['admin']);
  const opsViolations = watchCsp(ops);
  const res = await ops.goto(`${OPS_URL}/einstellungen`);
  expect(res!.headers()['content-security-policy']).toContain("connect-src 'self'");
  await ops.waitForLoadState('networkidle');
  await ops
    .getByRole('button', { name: /^Verlauf/ })
    .first()
    .click();
  await expect(ops.getByText(/Noch nie geändert|·/).first()).toBeVisible();

  expect(violations).toEqual([]);
  expect(opsViolations).toEqual([]);
});
