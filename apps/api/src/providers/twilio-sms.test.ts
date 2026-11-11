import { describe, expect, it, vi } from 'vitest';
import { SendGridMailer } from './mailer';
import { smsSender, TwilioSmsSender } from './twilio-sms';
import { smsOtpText, smsText } from '../notifications/sms-texts';

const created = () =>
  vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 }),
  );

describe('Twilio SMS sender', () => {
  it('accepts a Messaging Service, a number or an alphanumeric sender ID', () => {
    expect(smsSender('MG' + 'a'.repeat(32))).toEqual({
      MessagingServiceSid: 'MG' + 'a'.repeat(32),
    });
    expect(smsSender('+4915100000000')).toEqual({ From: '+4915100000000' });
    expect(smsSender('ParkShield')).toEqual({ From: 'ParkShield' });
    expect(() => smsSender('ParkShieldDE1')).toThrow(/max\. 11/);
    expect(() => smsSender('12345')).toThrow();
  });

  it('posts the text with basic auth and only an https status callback', async () => {
    const fetch = created();
    const s = new TwilioSmsSender(
      'AC1',
      'secret',
      'ParkShield',
      'https://p.de/v1/webhooks/twilio/sms',
      fetch,
    );
    await expect(
      s.send({ to: '+4915123456789', body: 'Hallo', tag: 'sms_alert' }),
    ).resolves.toEqual({
      messageId: 'SM123',
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect((init!.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('AC1:secret').toString('base64')}`,
    );
    const form = new URLSearchParams(String(init!.body));
    expect(Object.fromEntries(form)).toEqual({
      To: '+4915123456789',
      Body: 'Hallo',
      From: 'ParkShield',
      StatusCallback: 'https://p.de/v1/webhooks/twilio/sms',
    });

    const local = created();
    await new TwilioSmsSender('AC1', 's', '+4915100000000', 'http://localhost:3000/x', local).send({
      to: '4915123',
      body: 'x',
      tag: 't',
    });
    const f = new URLSearchParams(String(local.mock.calls[0]![1]!.body));
    expect(f.get('To')).toBe('+4915123');
    expect(f.has('StatusCallback')).toBe(false);
  });

  it('fails clearly on Twilio errors', async () => {
    const failing = new TwilioSmsSender(
      'AC1',
      's',
      'ParkShield',
      null,
      (async () => new Response(JSON.stringify({ code: 21608 }), { status: 400 })) as typeof fetch,
    );
    await expect(failing.send({ to: '+49151', body: 'x', tag: 't' })).rejects.toThrow(
      'Twilio SMS failed with HTTP 400 (21608)',
    );
  });
});

describe('SMS texts', () => {
  it('keeps typographic quotes and line breaks out of the text', () => {
    expect(smsText('de', 'alert', 'Licht an', '„Der\nBlaue“', 'https://p.de/antwort#t=x')).toBe(
      'ParkShield: Licht an ("Der Blaue"). Bitte antworten: https://p.de/antwort#t=x',
    );
  });

  it('adds the WebOTP line only for a public https origin', () => {
    expect(smsOtpText('en', '123456', 'https://parkshield.de')).toMatch(
      /code: 123456\..*\n\n@parkshield\.de #123456$/s,
    );
    expect(smsOtpText('de', '123456', 'http://localhost:3000')).not.toContain('@');
  });
});

describe('SendGrid mailer', () => {
  it('sends text before html, without tracking, on the EU host when asked', async () => {
    const fetch = vi.fn(
      async (_u: string | URL | Request, _i?: RequestInit) => new Response(null, { status: 202 }),
    );
    await new SendGridMailer('SG.key', 'ParkShield <hallo@parkshield.de>', 'eu', fetch).send({
      to: 'a@example.de',
      subject: 'Betreff',
      text: 'Text',
      html: '<p>Text</p>',
      tag: 'magic_link',
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.eu.sendgrid.com/v3/mail/send');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer SG.key');
    const body = JSON.parse(String(init!.body));
    expect(body.from).toEqual({ name: 'ParkShield', email: 'hallo@parkshield.de' });
    expect(body.content.map((c: { type: string }) => c.type)).toEqual(['text/plain', 'text/html']);
    expect(body.tracking_settings.click_tracking.enable).toBe(false);
    expect(body.tracking_settings.open_tracking.enable).toBe(false);
  });

  it('throws on errors', async () => {
    const m = new SendGridMailer(
      'k',
      'a@b.de',
      'global',
      (async () => new Response(null, { status: 401 })) as typeof fetch,
    );
    await expect(
      m.send({ to: 'x@y.de', subject: 's', text: 't', html: 'h', tag: 't' }),
    ).rejects.toThrow('SendGrid send failed with HTTP 401');
  });
});
