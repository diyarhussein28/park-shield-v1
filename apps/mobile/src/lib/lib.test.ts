import * as Notifications from 'expo-notifications';
import { api, setUnauthorizedHandler } from './api';
import { tokenFromLink } from './auth';
import { minutesSince } from './chat';
import { ACK_ACTION } from './config';
import { format, messages } from './i18n';
import { looksPersonal } from './personal';
import { handleResponse, requestPermission } from './push';
import { clearSession, setSession } from './session';

const ok = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);

beforeEach(async () => {
  global.fetch = jest.fn(() => ok({}));
  await clearSession();
});

const ALERT = '3f1e6a3c-1b2d-4c5e-8f90-1a2b3c4d5e6f';
const response = (actionIdentifier: string, data: Record<string, unknown> = { alertId: ALERT }) =>
  ({
    actionIdentifier,
    notification: { request: { content: { data } } },
  }) as unknown as Notifications.NotificationResponse;

describe('i18n', () => {
  it('German and English have the same keys and no empty text', () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.de).sort());
    for (const v of [...Object.values(messages.de), ...Object.values(messages.en)]) {
      expect(v.trim()).not.toBe('');
    }
  });

  it('formats values and plurals', () => {
    expect(format('{count, plural, one {# Foto} other {# Fotos}}', { count: 1 })).toBe('1 Foto');
    expect(format('{count, plural, one {# Foto} other {# Fotos}}', { count: 2 })).toBe('2 Fotos');
    expect(format('Hallo {name}', { name: 'Kim' })).toBe('Hallo Kim');
  });
});

describe('sign-in links', () => {
  const token = 'AbC123dEf456gHi789jKl012mNo345pQr678sTu901v';
  it('reads the token from the fragment of every link form', () => {
    expect(tokenFromLink(`https://park-shield.de/app/anmelden#t=${token}`)).toBe(token);
    expect(tokenFromLink(`parkshield://anmelden#t=${token}`)).toBe(token);
    expect(tokenFromLink(`parkshield://anmelden?t=${token}`)).toBe(token);
    expect(tokenFromLink('https://park-shield.de/app/anmelden')).toBeNull();
    expect(tokenFromLink(`https://park-shield.de/x#t=short`)).toBeNull();
    expect(tokenFromLink(null)).toBeNull();
  });
});

describe('API client', () => {
  it('sends the session as bearer token, never as a cookie', async () => {
    await setSession('session-token-0000000000000000000001');
    await api('/v1/app/alerts');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.test/v1/app/alerts');
    expect(init.headers.authorization).toBe('Bearer session-token-0000000000000000000001');
    expect(init.headers.cookie).toBeUndefined();
  });

  it('signs out when the API says the session is gone', async () => {
    await setSession('session-token-0000000000000000000001');
    const gone = jest.fn();
    setUnauthorizedHandler(gone);
    global.fetch = jest.fn(() => ok({ error: 'not_signed_in' }, 401));
    await expect(api('/v1/app/alerts')).rejects.toThrow('not_signed_in');
    expect(gone).toHaveBeenCalled();
  });
});

describe('push responses', () => {
  it('„Ich komme" on the notification acknowledges once and opens the alert', async () => {
    await setSession('session-token-0000000000000000000001');
    const open = jest.fn();
    expect(await handleResponse(response(ACK_ACTION), open)).toBe('acknowledged');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`https://api.test/v1/app/alerts/${ALERT}/ack`);
    expect(JSON.parse(init.body)).toEqual({ reply: 'coming' });
    expect(open).toHaveBeenCalledWith(ALERT);
  });

  it('a tap opens the alert without acknowledging; foreign data is ignored', async () => {
    const open = jest.fn();
    expect(await handleResponse(response(Notifications.DEFAULT_ACTION_IDENTIFIER), open)).toBe(
      'opened',
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(await handleResponse(response('x', { alertId: '../../v1/me' }), open)).toBe('ignored');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('an iOS remote push without `body` still opens its alert (ids from the raw payload)', async () => {
    const open = jest.fn();
    const remote = {
      actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
      notification: {
        request: {
          content: { data: null },
          trigger: { type: 'push', payload: { aps: {}, alertId: ALERT, type: 'blocking' } },
        },
      },
    } as unknown as Notifications.NotificationResponse;
    expect(await handleResponse(remote, open)).toBe('opened');
    expect(open).toHaveBeenCalledWith(ALERT);
  });

  it('iOS answering without its dialog is no refusal: no e-mail hint, the button stays', async () => {
    await setSession('session-token-0000000000000000000001');
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
    });
    expect(await requestPermission()).toBe('undetermined');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('a denied permission tells the API (e-mail hint) and keeps the banner state', async () => {
    await setSession('session-token-0000000000000000000001');
    expect(await requestPermission()).toBe('denied');
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.test/v1/app/push-denied');
  });
});

describe('chat helpers', () => {
  it('warns before personal data in owner messages', () => {
    expect(looksPersonal('Ruf mich an: 0151 23456789')).toBe(true);
    expect(looksPersonal('kim@example.de')).toBe(true);
    expect(looksPersonal('Ich wohne in der Hauptstraße 12')).toBe(true);
    expect(looksPersonal('Ich bin in 2 Minuten am Fahrzeug.')).toBe(false);
  });

  it('computes "zuletzt vor X Min."', () => {
    const now = Date.parse('2026-11-19T12:10:00Z');
    expect(minutesSince('2026-11-19T12:03:00Z', now)).toBe(7);
    expect(minutesSince(null, now)).toBeNull();
  });
});
