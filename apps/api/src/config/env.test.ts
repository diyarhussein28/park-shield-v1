import { describe, expect, it } from 'vitest';
import { envSchema, fakeProviders, isTestEnvironment, loadEnv } from './env';

/** 32 bytes, base64: required in real production since the abuse protection (phone hashes). */
const PHONE_PEPPER = Buffer.alloc(32, 7).toString('base64');

/** Every provider key real production needs (FCM included since the native app). */
const PROD = {
  NODE_ENV: 'production',
  APP_ENV: 'production',
  PHONE_PEPPER,
  MAIL_PROVIDER: 'brevo',
  BREVO_API_KEY: 'k',
  FRIENDLY_CAPTCHA_API_KEY: 'k',
  FRIENDLY_CAPTCHA_SITEKEY: 's',
  FRIENDLY_CAPTCHA_ENDPOINT: 'eu',
  STRIPE_SECRET_KEY: 'k',
  TWILIO_ACCOUNT_SID: 'AC1',
  TWILIO_AUTH_TOKEN: 't',
  TWILIO_SMS_FROM: 'ParkShield',
  FCM_PROJECT_ID: 'parkshield',
  FCM_CLIENT_EMAIL: 'push@parkshield.iam.gserviceaccount.com',
  FCM_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----',
  PRINT_PARTNER: 'p',
  AUDIT_BUCKET: 'b',
  ZAMMAD_TOKEN: 't',
} as const;

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

  it('starts in real production with every provider key', () => {
    expect(loadEnv(PROD).MAIL_PROVIDER).toBe('brevo');
  });

  it('uses the EU captcha endpoint by default and refuses global in real production', () => {
    expect(loadEnv({ FRIENDLY_CAPTCHA_ENDPOINT: '' as never }).FRIENDLY_CAPTCHA_ENDPOINT).toBe(
      'eu',
    );
    expect(() => loadEnv({ ...PROD, FRIENDLY_CAPTCHA_ENDPOINT: 'global' })).toThrow(
      /FRIENDLY_CAPTCHA_ENDPOINT must be "eu"/,
    );
  });

  it('needs an SMS sender and the key of the chosen e-mail provider in real production', () => {
    expect(() => loadEnv({ ...PROD, TWILIO_SMS_FROM: '' })).toThrow(
      /Missing provider keys in production: sms/,
    );
    expect(() => loadEnv({ ...PROD, MAIL_PROVIDER: 'sendgrid' })).toThrow(
      /Missing provider keys in production: mail/,
    );
    expect(
      loadEnv({ ...PROD, MAIL_PROVIDER: 'sendgrid', SENDGRID_API_KEY: 'SG' }).MAIL_PROVIDER,
    ).toBe('sendgrid');
  });

  it('needs the Firebase service account for app push in real production', () => {
    expect(() => loadEnv({ ...PROD, FCM_PRIVATE_KEY: '' })).toThrow(
      /Missing provider keys in production: fcm/,
    );
    const env = envSchema.parse({ ...process.env, FCM_PROJECT_ID: '' });
    expect(fakeProviders(env).fcm).toBe(true);
  });

  it('knows no WhatsApp setting any more', () => {
    const keys = Object.keys(envSchema.shape);
    expect(keys.filter((k) => /WHATSAPP|D360|TWILIO_CONTENT/.test(k))).toEqual([]);
    expect(Object.keys(fakeProviders(loadEnv()))).not.toContain('whatsapp');
  });

  it('starts in real production with manual printing and support by e-mail', () => {
    const env = loadEnv({
      ...PROD,
      PRINT_PARTNER: 'manual',
      SUPPORT_PROVIDER: 'email',
      SUPPORT_EMAIL: 'contact@park-shield.de',
      ZAMMAD_TOKEN: '',
    });
    expect(env.SUPPORT_PROVIDER).toBe('email');
    expect(() =>
      loadEnv({ ...PROD, PRINT_PARTNER: 'manual', SUPPORT_PROVIDER: 'email', SUPPORT_EMAIL: '' }),
    ).toThrow(/Missing provider keys in production: support/);
  });
});
