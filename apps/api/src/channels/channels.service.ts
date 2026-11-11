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
import { WHATSAPP, type WhatsAppSender } from '../providers/ports';
import { allowedPushEndpoint } from '../providers/push';

const OTP_TTL = 600;
const OTP_ATTEMPTS = 5;
export const WHATSAPP_CONSENT_VERSION = '2026-11';

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

const maskPhone = (e164: string) => `${e164.slice(0, 3)} ••• ${e164.slice(-4)}`;

@Injectable()
export class ChannelsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(ENV) private readonly env: Env,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(WHATSAPP) private readonly whatsapp: WhatsAppSender,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async overview(user: AuthContext) {
    const [devices, wa] = await Promise.all([
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
        .selectFrom('contact_channels')
        .select(['address_enc', 'verified_at', 'is_enabled'])
        .where('user_id', '=', user.userId)
        .where('type', '=', 'whatsapp')
        .where('verified_at', 'is not', null)
        .executeTakeFirst(),
    ]);
    return {
      // US-22: normal alerts try channels in this order and stop at the first that works.
      order: await channelOrder(this.db, this.settings, user.userId),
      email: { address: user.email },
      push: { publicKey: this.env.VAPID_PUBLIC_KEY, devices },
      whatsapp: wa?.address_enc
        ? {
            phone: maskPhone(this.crypto.decrypt(wa.address_enc)),
            verifiedAt: wa.verified_at,
            enabled: wa.is_enabled,
          }
        : null,
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

  // --- WhatsApp (US-21) -----------------------------------------------------------------------

  async startWhatsApp(user: AuthContext, phoneInput: string): Promise<{ phone: string }> {
    const phone = normalizePhone(phoneInput);
    if (!phone) throw new BadRequestException({ error: 'phone_invalid' });
    await this.limits.enforce('whatsapp.otp_user', user.userId);
    await this.limits.enforce('whatsapp.otp_phone', this.crypto.blindIndex(phone).toString('hex'));
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.valkey.set(
      `wa:otp:${user.userId}`,
      JSON.stringify({ phone, codeHash: sha256(code).toString('hex'), attempts: 0 }),
      'EX',
      OTP_TTL,
    );
    await this.whatsapp.sendTemplate({
      to: phone.slice(1),
      template: 'ps_otp',
      lang: user.preferredLang,
      params: [code],
    });
    return { phone: maskPhone(phone) };
  }

  /** Verifies the code, records the opt-in (Art. 6(1)(a)) and sends a test message. */
  async verifyWhatsApp(user: AuthContext, code: string): Promise<void> {
    const key = `wa:otp:${user.userId}`;
    const raw = await this.valkey.get(key);
    if (!raw) throw new BadRequestException({ error: 'code_expired' });
    const pending = JSON.parse(raw) as { phone: string; codeHash: string; attempts: number };
    const ok = timingSafeEqual(Buffer.from(pending.codeHash, 'hex'), sha256(code.trim()));
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
    // Keep WhatsApp where the owner's order puts it (US-22).
    const order = await channelOrder(this.db, this.settings, user.userId);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('contact_channels')
        .where('user_id', '=', user.userId)
        .where('type', '=', 'whatsapp')
        .execute();
      await trx
        .insertInto('contact_channels')
        .values({
          user_id: user.userId,
          type: 'whatsapp',
          address_enc: this.crypto.encrypt(pending.phone),
          address_bidx: this.crypto.blindIndex(pending.phone),
          key_version: this.crypto.keyVersion,
          priority: order.indexOf('whatsapp') + 1,
          verified_at: sql`now()`,
          opted_in_at: sql`now()`,
        })
        .execute();
      await trx
        .insertInto('consents')
        .values({
          user_id: user.userId,
          purpose: 'whatsapp',
          doc_version: WHATSAPP_CONSENT_VERSION,
        })
        .execute();
    });
    await this.whatsapp.sendTemplate({
      to: pending.phone.slice(1),
      template: 'ps_test',
      lang: user.preferredLang,
      params: ['ParkShield'],
    });
  }

  async unlinkWhatsApp(userId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('contact_channels')
        .where('user_id', '=', userId)
        .where('type', '=', 'whatsapp')
        .execute();
      await trx
        .updateTable('consents')
        .set({ withdrawn_at: sql`now()` })
        .where('user_id', '=', userId)
        .where('purpose', '=', 'whatsapp')
        .where('withdrawn_at', 'is', null)
        .execute();
    });
  }
}
