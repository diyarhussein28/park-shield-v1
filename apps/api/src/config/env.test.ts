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
});
