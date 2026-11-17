import { createHmac } from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import type { Env } from '../config/env';

/** The long-lived pepper (secrets store). Locally, without one, a key derived from BIDX_KEY. */
export function phonePepper(env: Pick<Env, 'PHONE_PEPPER' | 'BIDX_KEY'>): Buffer {
  if (env.PHONE_PEPPER) return Buffer.from(env.PHONE_PEPPER, 'base64');
  return createHmac('sha256', Buffer.from(env.BIDX_KEY, 'base64')).update('phone-pepper').digest();
}

/** phoneHash = HMAC-SHA256(phone_pepper, E.164). The number itself is never stored. */
export const phoneHash = (pepper: Buffer, e164: string): Buffer =>
  createHmac('sha256', pepper).update(e164).digest();

/** E.164 with Germany as the default country, or null for anything that is not a valid number. */
export function parseScannerPhone(input: string): string | null {
  const p = parsePhoneNumberFromString(input.trim(), 'DE');
  return p?.isValid() ? p.number : null;
}

/** DE + the other EU member states (ISO 3166-1 alpha-2); ops can change it (abuse.verify_countries). */
export const DEFAULT_VERIFY_COUNTRIES = [
  'DE',
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
];
