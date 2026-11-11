import { describe, expect, it, vi } from 'vitest';
import {
  TwilioWhatsAppSender,
  twilioSignature,
  validTwilioSignature,
  type ContentSids,
} from './twilio-whatsapp';

const SIDS: ContentSids = {
  'ps_alert:de': 'HXalertde',
  'ps_test:en': 'HXtesten',
  'ps_otp:de': 'HXotpde',
};

function sender(
  statusCallback: string | null = 'https://parkshield.de/v1/webhooks/twilio/whatsapp',
) {
  const fetch = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 }),
  );
  const s = new TwilioWhatsAppSender(
    'AC1',
    'secret',
    '+4915100000000',
    SIDS,
    statusCallback,
    fetch,
  );
  const form = () => new URLSearchParams(String(fetch.mock.calls[0]![1]!.body));
  return { s, fetch, form };
}

describe('Twilio WhatsApp sender', () => {
  it('sends an alert template with body variables and the reply payloads as button ids', async () => {
    const { s, fetch, form } = sender();
    const buttons = ['ack:tok:coming', 'ack:tok:in_30_min', 'ack:tok:not_nearby'];
    await expect(
      s.sendTemplate({
        to: '4915123456789',
        template: 'ps_alert',
        lang: 'de',
        params: ['Fahrzeug versperrt Ausfahrt', 'Der Blaue'],
        buttons,
      }),
    ).resolves.toEqual({ messageId: 'SM123' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect((init!.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('AC1:secret').toString('base64')}`,
    );
    const f = form();
    expect(f.get('To')).toBe('whatsapp:+4915123456789');
    expect(f.get('From')).toBe('whatsapp:+4915100000000');
    expect(f.get('ContentSid')).toBe('HXalertde');
    expect(JSON.parse(f.get('ContentVariables')!)).toEqual({
      1: 'Fahrzeug versperrt Ausfahrt',
      2: 'Der Blaue',
      3: buttons[0],
      4: buttons[1],
      5: buttons[2],
    });
    expect(f.get('StatusCallback')).toBe('https://parkshield.de/v1/webhooks/twilio/whatsapp');
  });

  it('fills inert button ids when a message has no reply links, and skips local callbacks', async () => {
    const { s, form } = sender('http://localhost:3000/v1/webhooks/twilio/whatsapp');
    await s.sendTemplate({
      to: '+491511',
      template: 'ps_test',
      lang: 'en',
      params: ['ParkShield'],
    });
    expect(JSON.parse(form().get('ContentVariables')!)).toEqual({
      1: 'ParkShield',
      2: 'noop:0',
      3: 'noop:1',
      4: 'noop:2',
    });
    expect(form().has('StatusCallback')).toBe(false);
  });

  it('sends the code as the only variable of the authentication template', async () => {
    const { s, form } = sender();
    await s.sendTemplate({ to: '491511', template: 'ps_otp', lang: 'de', params: ['123456'] });
    expect(JSON.parse(form().get('ContentVariables')!)).toEqual({ 1: '123456' });
  });

  it('fails clearly without a template SID and on Twilio errors', async () => {
    const { s } = sender();
    await expect(
      s.sendTemplate({ to: '491511', template: 'ps_followup', lang: 'en', params: ['a', 'b'] }),
    ).rejects.toThrow(/No Twilio template SID for ps_followup \(en\)/);
    const failing = new TwilioWhatsAppSender(
      'AC1',
      'secret',
      '+49151',
      SIDS,
      null,
      (async () => new Response(JSON.stringify({ code: 63016 }), { status: 400 })) as typeof fetch,
    );
    await expect(
      failing.sendTemplate({ to: '491511', template: 'ps_otp', lang: 'de', params: ['1'] }),
    ).rejects.toThrow('Twilio send failed with HTTP 400 (63016)');
  });
});

describe('X-Twilio-Signature', () => {
  // Worked example from twilio.com/docs/usage/security ("Explore the algorithm yourself").
  const url = 'https://example.com/myapp.php?foo=1&bar=2';
  const params = {
    Digits: '1234',
    To: '+18005551212',
    From: '+14158675310',
    Caller: '+14158675310',
    CallSid: 'CA1234567890ABCDE',
  };

  it('matches the published example', () => {
    expect(twilioSignature('12345', url, params)).toBe('L/OH5YylLD5NRKLltdqwSvS0BnU=');
  });

  it('accepts only the right signature', () => {
    const sig = twilioSignature('12345', url, params);
    expect(validTwilioSignature('12345', url, params, sig)).toBe(true);
    expect(validTwilioSignature('12345', url, { ...params, Digits: '9' }, sig)).toBe(false);
    expect(validTwilioSignature('other', url, params, sig)).toBe(false);
    expect(validTwilioSignature('12345', url, params, undefined)).toBe(false);
    expect(validTwilioSignature('', url, params, sig)).toBe(false);
  });
});
