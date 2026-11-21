import { randomInt, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { sql } from 'kysely';
// "max" metadata: the default set cannot tell mobile from landline numbers.
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import type { AuthContext } from '../auth/session.service';
import { isTestEnvironment, type Env } from '../config/env';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { sha256 } from '../core/crypto';
import { RateLimitService } from '../core/rate-limit.service';
import { SettingsService } from '../core/settings.service';
import {
  channelOrder,
  ORDERABLE,
  saveChannelOrder,
  type OrderableChannel,
} from '../notifications/channel-order';
import { CRYPTO, DB, ENV, VALKEY } from '../core/tokens';
import { smsLinkedText, smsOtpText } from '../notifications/sms-texts';
import { SMS, type SmsSender } from '../providers/ports';
import { PHONE_VERIFIER, type PhoneVerifier } from '../providers/phone-verify';
import { DEFAULT_VERIFY_COUNTRIES } from '../abuse/phone';
import { allowedPushEndpoint } from '../providers/push';

const OTP_TTL = 600;
const OTP_ATTEMPTS = 5;
export const SMS_CONSENT_VERSION = '2026-11';

/** The channel linked to a phone number after a one-time code (NT-07). WhatsApp was removed. */
export type PhoneChannel = 'sms';
const OTP_KEY = 'phone:otp';
const CONSENT_VERSION = { sms: SMS_CONSENT_VERSION } as const;

export type Platform = 'ios' | 'android' | 'desktop';

export function platformOf(userAgent: string | undefined): Platform {
  const ua = userAgent ?? '';
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/** E.164 with country default DE; returns null for anything that is not a valid mobile-capable number. */
export function normalizePhone(input: string): string | null {
  const p = parsePhoneNumberFromString(input.trim(), 'DE');
  if (!p?.isValid()) return null;
  const type = p.getType();
  if (!type || !['MOBILE', 'FIXED_LINE_OR_MOBILE'].includes(type)) return null;
  return p.number;
}

export const maskPhone = (e164: string) => `${e164.slice(0, 3)} ••• ${e164.slice(-4)}`;

@Injectable()
export class ChannelsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(ENV) private readonly env: Env,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(SMS) private readonly sms: SmsSender,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(PHONE_VERIFIER) private readonly verifier: PhoneVerifier,
  ) {}

  private async linkedPhone(userId: string, type: PhoneChannel) {
    const row = await this.db
      .selectFrom('contact_channels')
      .select(['address_enc', 'verified_at', 'is_enabled'])
      .where('user_id', '=', userId)
      .where('type', '=', type)
      .where('verified_at', 'is not', null)
      .executeTakeFirst();
    return row?.address_enc
      ? {
          phone: maskPhone(this.crypto.decrypt(row.address_enc)),
          verifiedAt: row.verified_at,
          enabled: row.is_enabled,
        }
      : null;
  }

  async overview(user: AuthContext) {
    const [devices, appDevices, sms] = await Promise.all([
      this.db
        .selectFrom('push_subscriptions')
        .select([
          'id',
          'platform',
          'device_label as label',
          'created_at as createdAt',
          'last_ok_at as lastOkAt',
        ])
        .where('user_id', '=', user.userId)
        .orderBy('created_at')
        .execute(),
      this.db
        .selectFrom('user_devices')
        .select(['id', 'platform', 'app_version as appVersion', 'last_seen_at as lastSeenAt'])
        .where('user_id', '=', user.userId)
        .orderBy('created_at')
        .execute(),
      this.linkedPhone(user.userId, 'sms'),
    ]);
    return {
      // US-22: normal alerts try channels in this order and stop at the first that works.
      order: await channelOrder(this.db, this.settings, user.userId),
      email: { address: user.email },
      push: { publicKey: this.env.VAPID_PUBLIC_KEY, devices },
      // The native app's devices (FCM). Managed by the app itself (register on login, remove on logout).
      app: { devices: appDevices },
      sms,
      available: await this.available(),
    };
  }

  async saveOrder(userId: string, order: OrderableChannel[]): Promise<OrderableChannel[]> {
    if (new Set(order).size !== order.length || order.length !== ORDERABLE.length) {
      throw new BadRequestException({ error: 'order_invalid' });
    }
    await saveChannelOrder(this.db, userId, order);
    return channelOrder(this.db, this.settings, userId);
  }

  // --- Web Push (US-20) -----------------------------------------------------------------------

  async registerPush(
    userId: string,
    input: { endpoint: string; p256dh: string; auth: string; label?: string },
    userAgent: string | undefined,
  ) {
    if (!allowedPushEndpoint(input.endpoint, isTestEnvironment(this.env))) {
      throw new BadRequestException({ error: 'push_endpoint_not_allowed' });
    }
    // An endpoint belongs to one browser profile; if it was registered by someone else, it moves.
    const row = await this.db
      .insertInto('push_subscriptions')
      .values({
        user_id: userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        platform: platformOf(userAgent),
        device_label: input.label?.slice(0, 60) ?? null,
      })
      .onConflict((oc) =>
        oc.column('endpoint').doUpdateSet({
          user_id: userId,
          p256dh: input.p256dh,
          auth: input.auth,
          platform: platformOf(userAgent),
          device_label: input.label?.slice(0, 60) ?? null,
          failed_count: 0,
        }),
      )
      .returning(['id', 'platform'])
      .executeTakeFirstOrThrow();
    return row;
  }

  async removePush(userId: string, id: string): Promise<void> {
    const r = await this.db
      .deleteFrom('push_subscriptions')
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!Number(r.numDeletedRows)) throw new NotFoundException();
  }

  // --- SMS (NT-07) ---------------------------------------------------------------------------

  /** Sends a one-time code to the number; nothing is stored in PostgreSQL before it is confirmed. */
  /** Kill switches (AD-15) also decide which phone channels can be set up right now. */
  async available(): Promise<Record<PhoneChannel, boolean>> {
    const on = async (c: PhoneChannel) => {
      const v = await this.settings.get<unknown>(`channels.${c}.enabled`, true);
      return v === true || v === 'true';
    };
    return { sms: await on('sms') };
  }

  /**
   * Sends one code by SMS to the number; nothing is stored in PostgreSQL before it is confirmed. The
   * owner's number is required (escalation SMS): mobile numbers from the allowed countries only
   * (setting `owner_phone.countries`, DE + EU by default). With Twilio Verify configured, Lookup checks
   * the line type and Verify sends and checks the code; without it ParkShield sends its own code.
   */
  async startPhone(
    user: AuthContext,
    channels: PhoneChannel | PhoneChannel[],
    phoneInput: string,
  ): Promise<{ phone: string; via: PhoneChannel }> {
    const wanted = [...new Set(Array.isArray(channels) ? channels : [channels])];
    const phone = normalizePhone(phoneInput);
    if (!phone) throw new BadRequestException({ error: 'phone_invalid' });
    const available = await this.available();
    if (!wanted.length || wanted.some((c) => !available[c])) {
      throw new BadRequestException({ error: 'channel_unavailable' });
    }
    const countries = await this.settings.get<string[]>(
      'owner_phone.countries',
      DEFAULT_VERIFY_COUNTRIES,
    );
    const country = parsePhoneNumberFromString(phone)?.country ?? null;
    if (!country || !countries.includes(country))
      throw new BadRequestException({ error: 'phone_country' });
    const via: PhoneChannel = 'sms';
    await this.limits.enforce(`${via}.otp_user`, user.userId);
    await this.limits.enforce(`${via}.otp_phone`, this.crypto.blindIndex(phone).toString('hex'));
    if (this.verifier.available) {
      // Twilio Lookup: landlines and VoIP numbers cannot receive the escalation SMS reliably.
      const { lineType } = await this.verifier.lookup(phone);
      if (lineType !== 'mobile') throw new BadRequestException({ error: 'phone_not_mobile' });
      await this.valkey.set(
        `${OTP_KEY}:${user.userId}`,
        JSON.stringify({ phone, channels: wanted, verify: true, attempts: 0 }),
        'EX',
        OTP_TTL,
      );
      await this.verifier.start(phone, user.preferredLang);
      return { phone: maskPhone(phone), via };
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.valkey.set(
      `${OTP_KEY}:${user.userId}`,
      JSON.stringify({
        phone,
        channels: wanted,
        codeHash: sha256(code).toString('hex'),
        attempts: 0,
      }),
      'EX',
      OTP_TTL,
    );
    await this.sms.send({
      to: phone,
      body: smsOtpText(user.preferredLang, code, this.env.WEB_BASE_URL),
      tag: 'sms_otp',
    });
    return { phone: maskPhone(phone), via };
  }

  /** Verifies the code, records the opt-in per channel (Art. 6(1)(a)) and sends a first message. */
  async verifyPhone(user: AuthContext, code: string): Promise<{ channels: PhoneChannel[] }> {
    const key = `${OTP_KEY}:${user.userId}`;
    const raw = await this.valkey.get(key);
    if (!raw) throw new BadRequestException({ error: 'code_expired' });
    const pending = JSON.parse(raw) as {
      phone: string;
      channels: PhoneChannel[];
      codeHash?: string;
      verify?: boolean;
      attempts: number;
    };
    const ok = pending.verify
      ? /^\d{4,10}$/.test(code.trim()) && (await this.verifier.check(pending.phone, code.trim()))
      : timingSafeEqual(Buffer.from(pending.codeHash ?? '', 'hex'), sha256(code.trim()));
    if (!ok) {
      pending.attempts += 1;
      if (pending.attempts >= OTP_ATTEMPTS) await this.valkey.del(key);
      else await this.valkey.set(key, JSON.stringify(pending), 'KEEPTTL');
      throw new BadRequestException({
        error: 'code_wrong',
        attemptsLeft: Math.max(0, OTP_ATTEMPTS - pending.attempts),
      });
    }
    await this.valkey.del(key);
    for (const channel of pending.channels) await this.link(user.userId, channel, pending.phone);
    if (pending.channels.includes('sms')) {
      await this.sms.send({
        to: pending.phone,
        body: smsLinkedText(user.preferredLang),
        tag: 'sms_linked',
      });
    }
    return { channels: pending.channels };
  }

  private async link(userId: string, channel: PhoneChannel, phone: string): Promise<void> {
    // Keep the channel where the owner's order puts it (US-22).
    const order = await channelOrder(this.db, this.settings, userId);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('contact_channels')
        .where('user_id', '=', userId)
        .where('type', '=', channel)
        .execute();
      await trx
        .insertInto('contact_channels')
        .values({
          user_id: userId,
          type: channel,
          address_enc: this.crypto.encrypt(phone),
          address_bidx: this.crypto.blindIndex(phone),
          key_version: this.crypto.keyVersion,
          priority: order.indexOf(channel) + 1,
          verified_at: sql`now()`,
          opted_in_at: sql`now()`,
        })
        .execute();
      await trx
        .insertInto('consents')
        .values({ user_id: userId, purpose: channel, doc_version: CONSENT_VERSION[channel] })
        .execute();
    });
  }

  async unlinkPhone(userId: string, channel: PhoneChannel): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('contact_channels')
        .where('user_id', '=', userId)
        .where('type', '=', channel)
        .execute();
      await trx
        .updateTable('consents')
        .set({ withdrawn_at: sql`now()` })
        .where('user_id', '=', userId)
        .where('purpose', '=', channel)
        .where('withdrawn_at', 'is', null)
        .execute();
    });
  }
}
