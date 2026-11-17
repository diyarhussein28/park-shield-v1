import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Logger } from 'pino';
import type { Env } from '../config/env';
import { RateLimitService } from '../core/rate-limit.service';
import { SettingsService } from '../core/settings.service';
import { ENV, LOGGER } from '../core/tokens';
import { PHONE_VERIFIER, type PhoneVerifier } from '../providers/phone-verify';
import { PhoneBansService } from './phone-bans.service';
import { DEFAULT_VERIFY_COUNTRIES, parseScannerPhone, phoneHash, phonePepper } from './phone';

export { DEFAULT_VERIFY_COUNTRIES };
import { ProtectionService } from './protection.service';

/** The neutral answer for every blocked or banned sender (abuse protection §3): never names a block. */
export const NOT_DELIVERABLE = {
  error: 'not_deliverable',
  message: 'Ihre Nachricht konnte nicht zugestellt werden.',
} as const;

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

interface Token {
  tokenId: string;
  vehicleId: string;
}

/**
 * Optional phone confirmation of a scanner while a vehicle is in Protected Mode (abuse protection §4).
 * Lookup accepts mobile numbers from allowed countries only; Verify sends the code. The result is a
 * short-lived signed token that the scanner page keeps in memory (no cookie, no storage) and sends with
 * the alert. Only HMAC(pepper, number) ever leaves this service.
 */
@Injectable()
export class ScannerVerificationService {
  private readonly pepper: Buffer;
  private readonly signKey: Buffer;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(PHONE_VERIFIER) private readonly verifier: PhoneVerifier,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ProtectionService) private readonly protection: ProtectionService,
    @Inject(PhoneBansService) private readonly bans: PhoneBansService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.pepper = phonePepper(env);
    this.signKey = createHmac('sha256', Buffer.from(env.SESSION_SECRET, 'base64'))
      .update('scanner-verification')
      .digest();
  }

  get available(): boolean {
    return this.verifier.available;
  }

  hash(e164: string): Buffer {
    return phoneHash(this.pepper, e164);
  }

  private phone(input: string): string {
    const e164 = parseScannerPhone(input);
    if (!e164) throw new BadRequestException({ error: 'phone_invalid' });
    return e164;
  }

  /** Captcha is checked by the controller first; then limits, ban, Lookup, country limit, SMS. */
  async start(token: Token, input: string, lang: 'de' | 'en', scannerRef: Buffer): Promise<void> {
    if (!this.verifier.available)
      throw new ConflictException({ error: 'verification_unavailable' });
    if (!(await this.protection.isActive(token.vehicleId)))
      throw new ConflictException({ error: 'not_needed' });
    const e164 = this.phone(input);
    const hash = this.hash(e164);
    // Same order as for alerts: bans before limits (abuse protection §3).
    if (await this.bans.isBanned(hash, token.vehicleId))
      throw new ForbiddenException(NOT_DELIVERABLE);
    await this.limits.enforce('verify.otp_scanner', scannerRef.toString('hex'));
    await this.limits.enforce('verify.otp_phone', hash.toString('hex'));

    const { lineType, country } = await this.verifier.lookup(e164);
    const allowed = await this.settings.get<string[]>(
      'abuse.verify_countries',
      DEFAULT_VERIFY_COUNTRIES,
    );
    if (!country || !allowed.includes(country))
      throw new UnprocessableEntityException({ error: 'phone_country' });
    // VoIP, landline and unknown types are refused: they are cheap to obtain in bulk.
    if (lineType !== 'mobile')
      throw new UnprocessableEntityException({ error: 'phone_not_mobile' });
    await this.limits.enforce('verify.otp_country', country);
    await this.verifier.start(e164, lang);
    this.logger.info({ country }, 'scanner phone verification started');
  }

  async check(
    token: Token,
    input: string,
    code: string,
  ): Promise<{ verification: string; expiresAt: Date }> {
    if (!this.verifier.available)
      throw new ConflictException({ error: 'verification_unavailable' });
    const e164 = this.phone(input);
    const hash = this.hash(e164);
    await this.limits.enforce('verify.check_phone', hash.toString('hex'));
    if (!(await this.verifier.check(e164, code)))
      throw new UnprocessableEntityException({ error: 'code_invalid' });
    if (await this.bans.isBanned(hash, token.vehicleId))
      throw new ForbiddenException(NOT_DELIVERABLE);
    const minutes = Number(await this.settings.get('abuse.verification_minutes', 30));
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    const payload = b64url(
      JSON.stringify({ t: token.tokenId, h: hash.toString('hex'), e: expiresAt.getTime() }),
    );
    return { verification: `${payload}.${this.sign(payload)}`, expiresAt };
  }

  private sign(payload: string): string {
    return b64url(createHmac('sha256', this.signKey).update(payload).digest());
  }

  /** The phone hash of a valid, unexpired token for this decal; null for anything else. */
  verifiedHash(verification: string | undefined, tokenId: string): Buffer | null {
    if (!verification) return null;
    const [payload, sig] = verification.split('.');
    if (!payload || !sig) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const v = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
        t?: string;
        h?: string;
        e?: number;
      };
      if (v.t !== tokenId || typeof v.e !== 'number' || v.e < Date.now()) return null;
      if (!v.h || !/^[0-9a-f]{64}$/.test(v.h)) return null;
      return Buffer.from(v.h, 'hex');
    } catch {
      return null;
    }
  }
}
