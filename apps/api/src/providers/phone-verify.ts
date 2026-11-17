import { randomInt } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { sha256 } from '../core/crypto';
import { DEV_SMS_KEY } from './twilio-sms';

export const PHONE_VERIFIER = Symbol('PHONE_VERIFIER');

export type LineType = 'mobile' | 'landline' | 'voip' | 'other' | 'unknown';

/**
 * Optional phone check of a scanner in Protected Mode (abuse protection §4): Twilio Lookup decides
 * whether the number is a mobile number, Twilio Verify sends and checks the one-time code. ParkShield
 * never stores the number; Twilio keeps the verification record as its DPA says (LEGAL_REVIEW.md).
 */
export interface PhoneVerifier {
  /** False when no provider is configured in production: the scanner page then offers no check. */
  readonly available: boolean;
  lookup(e164: string): Promise<{ lineType: LineType; country: string | null }>;
  start(e164: string, lang: 'de' | 'en'): Promise<void>;
  /** True only for a correct, unexpired code. */
  check(e164: string, code: string): Promise<boolean>;
}

/** Twilio line types (Lookup v2, line_type_intelligence) mapped to what the check accepts. */
export function lineTypeOf(type: string | null | undefined): LineType {
  switch (type) {
    case 'mobile':
      return 'mobile';
    case 'landline':
    case 'fixedLine':
      return 'landline';
    case 'fixedVoip':
    case 'nonFixedVoip':
    case 'voip':
      return 'voip';
    case null:
    case undefined:
    case 'unknown':
      return 'unknown';
    default:
      return 'other';
  }
}

export class TwilioPhoneVerifier implements PhoneVerifier {
  readonly available = true;

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly serviceSid: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private request(url: string, form?: URLSearchParams) {
    return this.fetchImpl(url, {
      method: form ? 'POST' : 'GET',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
  }

  async lookup(e164: string) {
    const res = await this.request(
      `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_type_intelligence`,
    );
    if (!res.ok) throw new Error(`Twilio Lookup failed with HTTP ${res.status}`);
    const body = (await res.json()) as {
      valid?: boolean;
      country_code?: string | null;
      line_type_intelligence?: { type?: string | null } | null;
    };
    if (body.valid === false) return { lineType: 'unknown' as const, country: null };
    return {
      lineType: lineTypeOf(body.line_type_intelligence?.type),
      country: body.country_code ?? null,
    };
  }

  async start(e164: string, lang: 'de' | 'en') {
    const res = await this.request(
      `https://verify.twilio.com/v2/Services/${encodeURIComponent(this.serviceSid)}/Verifications`,
      new URLSearchParams({ To: e164, Channel: 'sms', Locale: lang }),
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { code?: number };
      throw new Error(
        `Twilio Verify failed with HTTP ${res.status}${body.code ? ` (${body.code})` : ''}`,
      );
    }
  }

  async check(e164: string, code: string) {
    const res = await this.request(
      `https://verify.twilio.com/v2/Services/${encodeURIComponent(this.serviceSid)}/VerificationCheck`,
      new URLSearchParams({ To: e164, Code: code }),
    );
    // 404: no pending verification (expired, used up or never started).
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`Twilio VerificationCheck failed with HTTP ${res.status}`);
    const body = (await res.json()) as { status?: string };
    return body.status === 'approved';
  }
}

/** Production without a Verify service: Protected Mode simply hides content of every sender. */
export class DisabledPhoneVerifier implements PhoneVerifier {
  readonly available = false;
  lookup(): Promise<{ lineType: LineType; country: string | null }> {
    return Promise.reject(new Error('phone verification is not configured'));
  }
  start(): Promise<void> {
    return Promise.reject(new Error('phone verification is not configured'));
  }
  check(): Promise<boolean> {
    return Promise.reject(new Error('phone verification is not configured'));
  }
}

const DEV_CODE_KEY = 'dev:verify:';

/** Local and test fake: German mobile prefixes (015x–017x) are mobile, 032 is VoIP, the rest landline. */
export class DevPhoneVerifier implements PhoneVerifier {
  readonly available = true;

  constructor(
    private readonly valkey: Redis,
    private readonly logger: Logger,
  ) {}

  static countryOf(e164: string): string | null {
    const prefixes: [string, string][] = [
      ['+49', 'DE'],
      ['+43', 'AT'],
      ['+41', 'CH'],
      ['+33', 'FR'],
      ['+31', 'NL'],
      ['+1', 'US'],
    ];
    return prefixes.find(([p]) => e164.startsWith(p))?.[1] ?? null;
  }

  lookup(e164: string) {
    const lineType: LineType = /^\+491[5-7]/.test(e164)
      ? 'mobile'
      : /^\+4932/.test(e164)
        ? 'voip'
        : /^\+49/.test(e164)
          ? 'landline'
          : // Outside Germany the fake treats every number as mobile, so country rules can be tested.
            'mobile';
    return Promise.resolve({ lineType, country: DevPhoneVerifier.countryOf(e164) });
  }

  async start(e164: string, lang: 'de' | 'en') {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.valkey.set(`${DEV_CODE_KEY}${sha256(e164).toString('hex')}`, code, 'EX', 600);
    const body =
      lang === 'en'
        ? `Your ParkShield verification code: ${code}`
        : `Ihr ParkShield-Bestätigungscode: ${code}`;
    await this.valkey
      .multi()
      .lpush(
        DEV_SMS_KEY,
        JSON.stringify({
          to: e164,
          body,
          tag: 'sms_verify',
          messageId: `VEdev${code}`,
          sentAt: new Date().toISOString(),
        }),
      )
      .ltrim(DEV_SMS_KEY, 0, 49)
      .exec();
    this.logger.info({ tag: 'sms_verify' }, 'dev verification code stored in local inbox');
  }

  async check(e164: string, code: string) {
    const key = `${DEV_CODE_KEY}${sha256(e164).toString('hex')}`;
    const expected = await this.valkey.get(key);
    if (!expected || expected !== code) return false;
    await this.valkey.del(key);
    return true;
  }
}
