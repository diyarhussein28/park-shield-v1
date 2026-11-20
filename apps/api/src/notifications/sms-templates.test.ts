import { describe, expect, it } from 'vitest';
import { fcmBody } from '../providers/fcm';
import { appPushText, APP_ALERT_CATEGORY } from './push-texts';
import { isGsm7, SMS_SEGMENT_MAX, smsInviteText, smsLinkText, type LinkSmsKind } from './sms-texts';

const LABELS = {
  de: [
    'Fahrzeug versperrt Ausfahrt',
    'Licht brennt noch',
    'Fenster / Schiebedach offen',
    'Beschädigung / Parkschaden entdeckt',
    'Alarmanlage ausgelöst',
    'Abschleppen droht',
    'Eigene Nachricht',
  ],
  en: [
    'Vehicle is blocking an exit',
    'Lights are still on',
    'Window or sunroof open',
    'Damage / parking damage found',
    'Alarm is going off',
    'Vehicle is about to be towed',
    'Custom message',
  ],
} as const;

const T43 = 'AbC123dEf456gHi789jKl012mNo345pQr678sTu901v';
const URLS = [
  `https://park-shield.de/v/${T43}`,
  `https://park-shield.de/k/${T43}`,
  `https://park-shield.de/notfallkontakt#t=${T43}`,
  `http://localhost:3000/v/${T43}`,
];
const LABELS_VEHICLE = [
  '',
  'Blauer Golf',
  'Größter Übermütiger Ölfass-Bus von Jürgen ♥',
  'x'.repeat(40),
];
const KINDS: LinkSmsKind[] = [
  'alert',
  'photos',
  'reminder',
  'followup',
  'test',
  'escalation',
  'invite',
];

describe('every SMS template: one GSM-7 segment, at most 160 characters including the link', () => {
  it('fits all kinds, alert types, languages, vehicle labels and link forms', () => {
    let checked = 0;
    for (const lang of ['de', 'en'] as const) {
      for (const kind of KINDS) {
        for (const type of LABELS[lang]) {
          for (const label of LABELS_VEHICLE) {
            for (const url of URLS) {
              const text = smsLinkText(lang, kind, type, label, url);
              expect(text.length, text).toBeLessThanOrEqual(SMS_SEGMENT_MAX);
              expect(isGsm7(text), text).toBe(true);
              expect(text, text).toContain(url.replace(/^https:\/\//, ''));
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBe(2 * KINDS.length * 7 * LABELS_VEHICLE.length * URLS.length);
  });

  it('the invitation names the owner by first name, transliterated, and fits too', () => {
    for (const name of ['Jonas', 'Jürgen-Maximilian von Hohenzollern-Sigmaringen', '']) {
      for (const lang of ['de', 'en'] as const) {
        const t = smsInviteText(lang, name, `https://park-shield.de/notfallkontakt#t=${T43}`);
        expect(t.length, t).toBeLessThanOrEqual(SMS_SEGMENT_MAX);
        expect(isGsm7(t), t).toBe(true);
      }
    }
    expect(
      smsInviteText('de', 'Jürgen', `https://park-shield.de/notfallkontakt#t=${T43}`),
    ).toContain('Juergen moechte Sie als Vertrauensperson');
  });

  it('matches the example of the spec', () => {
    expect(
      smsLinkText(
        'de',
        'alert',
        'Ihr Fahrzeug blockiert eine Ausfahrt',
        '',
        'https://parkshield.de/v/AbC123',
      ),
    ).toBe('ParkShield: Ihr Fahrzeug blockiert eine Ausfahrt. Details: parkshield.de/v/AbC123');
  });
});

describe('app push payload (FCM is a Google service)', () => {
  it('carries a generic text and ids only; high priority and time-sensitive when urgent', () => {
    const body = fcmBody({
      token: 'device-token',
      ...appPushText('de', 'alert', 'Fahrzeug versperrt Ausfahrt'),
      data: { alertId: '00000000-0000-4000-8000-000000000000', type: 'blocking', kind: 'alert' },
      category: APP_ALERT_CATEGORY,
      urgent: true,
      ttlSeconds: 7200,
      collapseKey: 'alert-1',
    });
    expect(body.message.notification).toEqual({
      title: 'ParkShield',
      body: 'Neuer Alarm für Ihr Fahrzeug: Fahrzeug versperrt Ausfahrt',
    });
    expect(Object.keys(body.message.data).sort()).toEqual(['alertId', 'kind', 'type']);
    expect(body.message.android.priority).toBe('HIGH');
    expect(body.message.apns.headers['apns-priority']).toBe('10');
    expect(body.message.apns.payload.aps['interruption-level']).toBe('time-sensitive');
    expect(body.message.apns.payload.aps.category).toBe('PS_ALERT');
    // iOS: expo-notifications reads a remote notification's data from `body` only (tap, „Ich komme").
    expect(body.message.apns.payload.body).toEqual(body.message.data);
    // Critical alerts need an Apple entitlement and are never requested.
    expect(JSON.stringify(body)).not.toMatch(/critical/i);
  });
});
