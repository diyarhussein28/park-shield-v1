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
        WHATSAPP_PROVIDER: '360dialog',
        TWILIO_ACCOUNT_SID: 'AC1',
        TWILIO_AUTH_TOKEN: 't',
        TWILIO_SMS_FROM: 'ParkShield',
        FRIENDLY_CAPTCHA_ENDPOINT: 'global',
      }),
    ).toThrow(/FRIENDLY_CAPTCHA_ENDPOINT must be "eu"/);
  });

  it('needs an SMS sender and the key of the chosen e-mail provider in real production', () => {
    const prod = {
      NODE_ENV: 'production',
      APP_ENV: 'production',
      FRIENDLY_CAPTCHA_API_KEY: 'k',
      FRIENDLY_CAPTCHA_SITEKEY: 's',
      STRIPE_SECRET_KEY: 'k',
      WHATSAPP_PROVIDER: '360dialog',
      D360_API_KEY: 'k',
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_AUTH_TOKEN: 't',
      PRINT_PARTNER: 'p',
      AUDIT_BUCKET: 'b',
      ZAMMAD_TOKEN: 't',
      FRIENDLY_CAPTCHA_ENDPOINT: 'eu',
    } as const;
    expect(() => loadEnv({ ...prod, BREVO_API_KEY: 'k', TWILIO_SMS_FROM: '' })).toThrow(
      /Missing provider keys in production: sms/,
    );
    expect(() =>
      loadEnv({ ...prod, MAIL_PROVIDER: 'sendgrid', BREVO_API_KEY: 'k', TWILIO_SMS_FROM: 'X' }),
    ).toThrow(/Missing provider keys in production: mail/);
    expect(
      loadEnv({ ...prod, MAIL_PROVIDER: 'sendgrid', SENDGRID_API_KEY: 'SG', TWILIO_SMS_FROM: 'X' })
        .MAIL_PROVIDER,
    ).toBe('sendgrid');
  });

  it('uses Twilio for WhatsApp by default and needs every template SID in real production', () => {
    expect(loadEnv({ WHATSAPP_PROVIDER: '' as never }).WHATSAPP_PROVIDER).toBe('twilio');
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        BREVO_API_KEY: 'k',
        FRIENDLY_CAPTCHA_API_KEY: 'k',
        FRIENDLY_CAPTCHA_SITEKEY: 's',
        STRIPE_SECRET_KEY: 'k',
        WHATSAPP_PROVIDER: 'twilio',
        TWILIO_ACCOUNT_SID: 'AC1',
        TWILIO_AUTH_TOKEN: 't',
        TWILIO_WHATSAPP_FROM: '+4915100000000',
        TWILIO_SMS_FROM: 'ParkShield',
        TWILIO_CONTENT_PS_ALERT_DE: 'HX1',
        TWILIO_CONTENT_PS_ALERT_EN: '',
        PRINT_PARTNER: 'p',
        AUDIT_BUCKET: 'b',
        ZAMMAD_TOKEN: 't',
      }),
    ).toThrow(/Missing Twilio template SIDs: .*TWILIO_CONTENT_PS_ALERT_EN/);
  });
});
