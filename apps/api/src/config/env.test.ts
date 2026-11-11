import { describe, expect, it } from 'vitest';
import { isTestEnvironment, loadEnv } from './env';

describe('test helpers are limited to dev, unit tests and CI', () => {
  it.each([
    ['development', 'local', true],
    ['test', 'local', true],
    ['production', 'ci', true], // CI end-to-end run: production build with fake providers
    ['production', 'production', false],
    ['production', 'staging', false],
  ] as const)('NODE_ENV=%s APP_ENV=%s → %s', (NODE_ENV, APP_ENV, expected) => {
    expect(isTestEnvironment({ NODE_ENV, APP_ENV })).toBe(expected);
  });

  it('refuses fake providers in real production', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'production', APP_ENV: 'production', BREVO_API_KEY: '' }),
    ).toThrow(/Missing provider keys in production/);
  });

  it('uses the EU captcha endpoint by default and refuses global in real production', () => {
    expect(loadEnv({ FRIENDLY_CAPTCHA_ENDPOINT: '' as never }).FRIENDLY_CAPTCHA_ENDPOINT).toBe(
      'eu',
    );
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        BREVO_API_KEY: 'k',
        FRIENDLY_CAPTCHA_API_KEY: 'k',
        FRIENDLY_CAPTCHA_SITEKEY: 's',
        STRIPE_SECRET_KEY: 'k',
        D360_API_KEY: 'k',
        PRINT_PARTNER: 'p',
        AUDIT_BUCKET: 'b',
        ZAMMAD_TOKEN: 't',
        FRIENDLY_CAPTCHA_ENDPOINT: 'global',
      }),
    ).toThrow(/FRIENDLY_CAPTCHA_ENDPOINT must be "eu"/);
  });
});
