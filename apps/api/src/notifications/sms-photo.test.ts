import { describe, expect, it } from 'vitest';
import { isGsm7, SMS_SEGMENT_MAX, smsPhotoText, toGsm7 } from './sms-texts';

/** The alert_types seed (db/migrations/20261109000000_schema_v3.sql); ops may edit them at runtime. */
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

const TOKEN = 'AbC123dEf456gHi789jKl012mNo345pQr678sTu901v'; // 43 chars, like a real view token
const URLS = [`https://park-shield.de/v/${TOKEN}`, `https://parkshield.de/v/${TOKEN}`];
const NICKNAMES = ['', 'Der Blaue', 'Größter Übermütiger Ölfass-Bus von Jürgen ♥', 'x'.repeat(40)];
const UMLAUT = /[äöüßÄÖÜ]/;

describe('SMS for alerts with photos: one GSM-7 segment', () => {
  it('fits every alert type, language and nickname into 160 GSM-7 characters with the link', () => {
    for (const lang of ['de', 'en'] as const) {
      for (const type of LABELS[lang]) {
        for (const nickname of NICKNAMES) {
          for (const url of URLS) {
            const text = smsPhotoText(lang, type, nickname, url);
            expect(text.length, text).toBeLessThanOrEqual(SMS_SEGMENT_MAX);
            expect(isGsm7(text), text).toBe(true);
            expect(UMLAUT.test(text), text).toBe(false);
            // The link always survives intact (without the https:// prefix).
            expect(text.endsWith(url.replace('https://', '')), text).toBe(true);
          }
        }
      }
    }
  });

  it('reads like the example and keeps the type', () => {
    expect(smsPhotoText('de', 'Fahrzeug versperrt Ausfahrt', '', URLS[0]!)).toBe(
      `ParkShield: Fahrzeug versperrt Ausfahrt. Fotos & Antwort: park-shield.de/v/${TOKEN}`,
    );
    expect(smsPhotoText('de', 'Beschädigung / Parkschaden entdeckt', 'Der Blaue', URLS[0]!)).toBe(
      `ParkShield: Beschaedigung / Parkschaden entdeckt (Der Blaue). Fotos & Antwort: park-shield.de/v/${TOKEN}`,
    );
  });

  it('shortens an overly long type edited in ops instead of using a second segment', () => {
    const text = smsPhotoText('en', 'A'.repeat(200), 'Nick', URLS[0]!);
    expect(text.length).toBeLessThanOrEqual(SMS_SEGMENT_MAX);
    expect(text).toContain(TOKEN);
  });

  it('throws when even the shortest variant cannot fit (fails in tests, not in production)', () => {
    expect(() => smsPhotoText('de', 'Typ', '', `https://${'d'.repeat(140)}.de/v/${TOKEN}`)).toThrow(
      /one segment/,
    );
  });

  it('transliterates umlauts and strips characters outside GSM-7', () => {
    expect(toGsm7('Größe „Ä“ – €5 {x} 🚗\nÜber')).toBe('Groesse "Ae" - 5 x Ueber');
  });
});
