import { defineConfig, devices } from '@playwright/test';

// Expects the stack to be running (`npm run dev` locally; CI starts the built apps first).
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Locally the browsers share the machine with two `next dev` servers, both APIs and PostgreSQL;
  // more than four workers starve them and tests time out.
  workers: process.env.CI ? undefined : 4,
  // Locally the apps run in `next dev`, which compiles routes on demand; 5 s is too tight under load.
  expect: { timeout: 10_000 },
  // Most tests sign up, pay and add a vehicle first: ~15 s alone, ~30 s while the suite runs.
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
    locale: 'de-DE',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
});
