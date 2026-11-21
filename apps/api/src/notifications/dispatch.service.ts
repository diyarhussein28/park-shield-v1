import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import type { Env } from '../config/env';
import { fakeProviders } from '../config/env';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { SettingsService } from '../core/settings.service';
import { CRYPTO, DB, ENV, LOGGER } from '../core/tokens';
import type { ChannelType } from '../db/types.generated';
import { EntitlementService } from '../billing/entitlements.service';
import { APP_PUSH, SMS, type AppPushSender, type SmsSender } from '../providers/ports';
import { PreferencesService } from '../preferences/preferences.service';
import { AckService, type ReplyLinks } from './ack.service';
import { FairUseService } from './fair-use.service';
import { type OrderableChannel } from './channel-order';
import { APP_ALERT_CATEGORY, appPushText } from './push-texts';
import { smsLinkText } from './sms-texts';

/** GSM-7 safe hint for the SMS of an alert whose content is hidden (Protected Mode). */
const SMS_HIDDEN = {
  de: 'Nachricht von nicht bestaetigtem Absender',
  en: 'Message from an unconfirmed sender',
} as const;
import { ViewTokenService } from '../alert-media/view-token.service';

/** NT-06: a subscription/device is removed after "gone" or this many consecutive failures. */
export const PUSH_MAX_FAILURES = 5;
const PUSH_TTL_SECONDS = 2 * 3600;
const DONE = ['sent', 'delivered', 'read'] as const;

type AlertRow = NonNullable<Awaited<ReturnType<DispatchService['load']>>>;
/** sent: delivered to the provider now; already: in an earlier attempt; unavailable: not set up. */
type Outcome = 'sent' | 'already' | 'failed' | 'suppressed' | 'unavailable';
type Kind = 'alert' | 'test' | 'followup' | 'reminder' | 'escalation';
export type PlanChannels = readonly OrderableChannel[];

/**
 * App-only alerts (owner decision 2026-11-21): every alert goes to the ParkShield app by FCM push, and
 * nowhere else at first. No e-mail, ever, for an alert. Without a reaction, the reminder push and then
 * one SMS to the owner's verified number follow (OwnerReminderService). `plan` is kept for callers.
 */
export function planChannels(_plan?: string | null): PlanChannels {
  return ['native_push'];
}

interface Message {
  kind: Kind;
  token: string;
  links: ReplyLinks;
  /**
   * The view page of the alert (`/v/<token>`): type, time, message, photos, "Ich komme". Every e-mail
   * and SMS carries this link only; no photo is ever attached or embedded.
   */
  viewUrl: string;
  /**
   * Reminders are sent again on purpose: a delivery counts as "already" only when it was queued after
   * this moment (the reminder's start).
   */
  since?: Date;
}

/**
 * Delivers an alert to the owner (US-22, NT-01, tiered notifications) and the owner reminder. Kill
 * switches (NT-12) suppress a channel, quiet hours mute the owner (urgent alerts pass, US-26), fair use
 * meters SMS (NT-05). Every notification carries the "Ich komme" action.
 *
 * Idempotent: a replayed outbox event never notifies a channel (or push device) twice. When a channel
 * failed, the error is rethrown so the outbox retries with backoff; delivered channels are skipped.
 */
@Injectable()
export class DispatchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(APP_PUSH) private readonly appPush: AppPushSender,
    @Inject(SMS) private readonly sms: SmsSender,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(AckService) private readonly ack: AckService,
    @Inject(PreferencesService) private readonly preferences: PreferencesService,
    @Inject(FairUseService) private readonly fairUse: FairUseService,
    @Inject(ViewTokenService) private readonly viewTokens: ViewTokenService,
    @Inject(EntitlementService) private readonly entitlements: EntitlementService,
  ) {}

  private load(alertId: string) {
    return this.db
      .selectFrom('alerts as a')
      .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .innerJoin('users as u', 'u.id', 'v.owner_user_id')
      .innerJoin('alert_types as t', 't.code', 'a.alert_type')
      .select([
        'a.id',
        'a.status',
        'a.is_test',
        'a.severity',
        'a.alert_type',
        'a.custom_message_enc',
        'a.content_hidden',
        'a.created_at',
        'a.expires_at',
        'a.followup_sent_at',
        'a.scanner_waiting_at',
        'a.owner_reply',
        'a.reminded_at',
        'a.sms_sent_at',
        'a.vehicle_id',
        'v.nickname',
        'u.id as userId',
        'u.email',
        'u.preferred_lang',
        't.label_de',
        't.label_en',
        (eb) =>
          eb
            .exists(
              eb
                .selectFrom('alert_media as m')
                .select('m.id')
                .whereRef('m.alert_id', '=', 'a.id')
                .where('m.deleted_at', 'is', null),
            )
            .as('hasPhotos'),
      ])
      .where('a.id', '=', alertId)
      .executeTakeFirst();
  }

  /** App push only (2026-11-21); the SMS is sent by the escalation, never with the alert. */
  private channelsFor(_userId: string): OrderableChannel[] {
    return [...planChannels()];
  }

  async dispatch(alertId: string): Promise<void> {
    const alert = await this.load(alertId);
    if (!alert || !['dispatched', 'delivered'].includes(alert.status)) return;
    if (alert.expires_at < new Date()) return;

    // US-26: quiet hours and "sensitive spot" mute the owner's notifications (urgent alerts pass). The
    // alert is kept and recorded as suppressed (it shows in the history); escalation still applies.
    const muted = await this.preferences.muteReason({
      userId: alert.userId,
      vehicleId: alert.vehicle_id,
      severity: alert.severity,
      isTest: alert.is_test,
    });
    if (muted) {
      const already = await this.db
        .selectFrom('alert_deliveries')
        .select('id')
        .where('alert_id', '=', alert.id)
        .where('suppressed_reason', '=', muted)
        .executeTakeFirst();
      if (!already) {
        await this.record({
          alertId: alert.id,
          channel: 'native_push',
          provider: 'none',
          status: 'suppressed',
          reason: muted,
        });
      }
      return;
    }

    const token = await this.ack.tokenFor(alert.id, alert.expires_at);
    const msg: Message = {
      kind: alert.is_test ? 'test' : 'alert',
      token,
      links: this.ack.links(token),
      viewUrl: this.viewTokens.urlFor(alert.id),
    };
    const { outcomes, errors } = await this.deliver(alert, msg, this.channelsFor(alert.userId));

    if (outcomes.includes('sent')) {
      await this.db
        .updateTable('alerts')
        .set({ status: 'delivered' })
        .where('id', '=', alertId)
        .where('status', '=', 'dispatched')
        .execute();
    }
    // Retry while one channel of the plan still has to be retried; delivered ones are skipped then.
    if (errors.length) throw errors[0];
    if (!outcomes.some((o) => o === 'sent' || o === 'already')) {
      // No app device (or push off): the app shows a warning; the SMS follows after 30 minutes.
      this.logger.warn({ outcomes }, 'alert not delivered by push: no device or push off');
    }
  }

  /**
   * Reminder push (2026-11-21): no reaction after `escalation.reminder_minutes` (10). Push only, also
   * for test alerts; never during quiet hours. "Seen" does not count, only a reaction (the sweeper
   * already checked the stop conditions).
   */
  async remind(alertId: string): Promise<void> {
    const alert = await this.load(alertId);
    if (!alert?.reminded_at || alert.owner_reply !== null) return;
    if (!['dispatched', 'delivered'].includes(alert.status)) return;
    if (alert.expires_at < new Date()) return;
    const muted = await this.preferences.muteReason({
      userId: alert.userId,
      vehicleId: alert.vehicle_id,
      severity: alert.severity,
      isTest: alert.is_test,
    });
    if (muted) return;

    const token = await this.ack.tokenFor(alert.id, alert.expires_at);
    const msg: Message = {
      kind: 'reminder',
      token,
      links: this.ack.links(token),
      viewUrl: this.viewTokens.urlFor(alert.id),
      since: alert.reminded_at,
    };
    const { errors } = await this.deliver(alert, msg, ['native_push']);
    if (errors.length) throw errors[0];
  }

  /**
   * The single escalation SMS (2026-11-21): no reaction after `escalation.sms_minutes` (30). One SMS per
   * alert, to the owner's verified number, GSM-7 and ≤ 160 characters with the view link. Never during
   * quiet hours (owner decision: not even for urgent alerts), never for tests, counted against the
   * monthly safety cap `sms.monthly_cap`; when the cap is reached it is logged and shown in the app.
   */
  async escalateSms(alertId: string): Promise<void> {
    const alert = await this.load(alertId);
    if (!alert?.sms_sent_at || alert.is_test) return;
    const muted = await this.preferences.quietHours(alert.userId, alert.vehicle_id);
    if (muted) {
      if (!(await this.alreadySent(alert.id, 'sms', { since: undefined } as Message, undefined, true)))
        await this.record({
          alertId: alert.id,
          channel: 'sms',
          provider: 'none',
          status: 'suppressed',
          reason: 'quiet_hours',
        });
      return;
    }
    const token = await this.ack.tokenFor(alert.id, alert.expires_at);
    const msg: Message = {
      kind: 'escalation',
      token,
      links: this.ack.links(token),
      viewUrl: this.viewTokens.urlFor(alert.id),
    };
    const { errors } = await this.deliver(alert, msg, ['sms']);
    if (errors.length) throw errors[0];
  }

  /** NT-09: one reminder with fresh reply buttons after "Ich warte noch", fastest channel first. */
  async followup(alertId: string): Promise<void> {
    const alert = await this.load(alertId);
    if (!alert || alert.followup_sent_at || !alert.scanner_waiting_at) return;
    if (alert.status !== 'acknowledged' || alert.expires_at < new Date()) return;
    const token = await this.ack.renew(alert.id, alert.expires_at);
    const msg: Message = {
      kind: 'followup',
      token,
      links: this.ack.links(token),
      viewUrl: this.viewTokens.urlFor(alert.id),
      since: alert.scanner_waiting_at,
    };
    const { outcomes, errors } = await this.deliver(alert, msg, ['native_push'], true);
    if (!outcomes.includes('sent') && errors.length) throw errors[0];
    await this.db
      .updateTable('alerts')
      .set({ followup_sent_at: sql`now()` })
      .where('id', '=', alertId)
      .where('followup_sent_at', 'is', null)
      .execute();
  }

  /** Push for a new chat message from the scanner (the app is closed or in the background). */
  async chatMessage(alertId: string): Promise<void> {
    const alert = await this.load(alertId);
    if (!alert) return;
    const devices = await this.db
      .selectFrom('user_devices')
      .select(['id', 'fcm_token', 'locale', 'failed_count'])
      .where('user_id', '=', alert.userId)
      .execute();
    await Promise.all(
      devices.map(async (d) => {
        const lang = d.locale ?? alert.preferred_lang;
        const text = appPushText(lang, 'chat');
        const r = await this.appPush.send({
          token: d.fcm_token,
          ...text,
          data: { alertId: alert.id, kind: 'chat' },
          urgent: true,
          ttlSeconds: 600,
          collapseKey: `chat-${alert.id}`,
        });
        if (!r.ok) await this.deviceFailed(alert, d, r.invalidToken);
      }),
    );
  }

  /** Whether the owner can be reached by push at all (a registered app device). */
  async hasPushDevice(userId: string): Promise<boolean> {
    const app = await this.db
      .selectFrom('user_devices')
      .select('id')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return Boolean(app);
  }

  /**
   * Sends on every channel in `order`. With `firstOnly` (the NT-09 follow-up) it stops at the first
   * channel that worked; otherwise every channel gets the message (tiered notifications: at once).
   */
  private async deliver(
    alert: AlertRow,
    msg: Message,
    order: readonly OrderableChannel[],
    firstOnly = false,
  ) {
    const outcomes: Outcome[] = [];
    const errors: unknown[] = [];
    const dead = await this.failedLater(alert.id);
    for (const channel of order) {
      // The provider accepted it, then reported it undeliverable (e.g. an SMS number that no longer exists):
      // sending there again would fail the same way, so the next channel gets its turn.
      if (dead.has(channel)) continue;
      let outcome: Outcome;
      try {
        // Only app push and the escalation SMS exist for alerts (2026-11-21).
        outcome =
          channel === 'native_push'
            ? await this.sendAppPush(alert, msg)
            : channel === 'sms'
              ? await this.sendSms(alert, msg)
              : 'unavailable';
      } catch (err) {
        errors.push(err);
        outcome = 'failed';
      }
      outcomes.push(outcome);
      if (firstOnly && (outcome === 'sent' || outcome === 'already')) break;
    }
    return { outcomes, errors };
  }

  // --- channels --------------------------------------------------------------------------------

  private async enabled(channel: ChannelType): Promise<boolean> {
    const v = await this.settings.get<unknown>(`channels.${channel}.enabled`, true);
    return v === true || v === 'true';
  }

  /** Owner channels whose message the provider accepted but later reported as failed (webhook). */
  private async failedLater(alertId: string): Promise<Set<ChannelType>> {
    const rows = await this.db
      .selectFrom('alert_deliveries')
      .select('channel')
      .distinct()
      .where('alert_id', '=', alertId)
      .where('recipient', '=', 'owner')
      .where('status', '=', 'failed')
      .where('provider_message_id', 'is not', null)
      .execute();
    return new Set(rows.map((r) => r.channel));
  }

  /** A delivery of this message on this channel (and device) exists already. */
  private async alreadySent(
    alertId: string,
    channel: ChannelType,
    msg: Message,
    providerMessageId?: string,
    includeSuppressed = false,
  ) {
    let q = this.db
      .selectFrom('alert_deliveries')
      .select('id')
      .where('alert_id', '=', alertId)
      .where('recipient', '=', 'owner')
      .where('channel', '=', channel)
      .where('status', 'in', includeSuppressed ? [...DONE, 'suppressed'] : [...DONE]);
    if (providerMessageId) q = q.where('provider_message_id', '=', providerMessageId);
    if (msg.since) q = q.where('queued_at', '>=', msg.since);
    return Boolean(await q.executeTakeFirst());
  }

  private async record(input: {
    alertId: string;
    channel: ChannelType;
    provider: string;
    status: 'queued' | 'suppressed';
    reason?: string;
    providerMessageId?: string;
    costMicros?: number;
  }) {
    const previous = await this.db
      .selectFrom('alert_deliveries')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('alert_id', '=', input.alertId)
      .where('channel', '=', input.channel)
      .executeTakeFirstOrThrow();
    return this.db
      .insertInto('alert_deliveries')
      .values({
        alert_id: input.alertId,
        recipient: 'owner',
        channel: input.channel,
        provider: input.provider,
        status: input.status,
        suppressed_reason: input.reason ?? null,
        provider_message_id: input.providerMessageId ?? null,
        attempt: Number(previous.n) + 1,
        cost_micros_eur: input.costMicros ?? 0,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  private async finish(
    id: string,
    result: { ok: true; messageId?: string } | { ok: false; error: string },
  ) {
    await this.db
      .updateTable('alert_deliveries')
      .set(
        result.ok
          ? {
              status: 'sent',
              sent_at: sql`now()`,
              ...(result.messageId ? { provider_message_id: result.messageId } : {}),
            }
          : { status: 'failed', error_code: result.error.slice(0, 64) },
      )
      .where('id', '=', id)
      .execute();
  }

  /**
   * Template values. In Protected Mode (content_hidden) the free text of an unconfirmed sender is not
   * even decrypted here, so no channel can carry it; templates show a hint instead (abuse protection §4).
   */
  private alertValues(alert: AlertRow) {
    const hidden = alert.content_hidden && alert.custom_message_enc !== null;
    const message =
      alert.custom_message_enc && !hidden ? this.crypto.decrypt(alert.custom_message_enc) : '';
    return {
      nickname: alert.nickname,
      type: alert.preferred_lang === 'en' ? alert.label_en : alert.label_de,
      hasMessage: hidden ? 'hidden' : message ? 'yes' : 'no',
      message,
      hidden,
    };
  }

  /**
   * Native app (FCM, iOS via APNs). The payload carries a generic text and ids only: no scanner text, no
   * photo, no plate, no nickname, no name (FCM is a Google service). The app loads the rest from our API.
   */
  private async sendAppPush(alert: AlertRow, msg: Message): Promise<Outcome> {
    const devices = await this.db
      .selectFrom('user_devices')
      .select(['id', 'fcm_token', 'locale', 'failed_count'])
      .where('user_id', '=', alert.userId)
      .execute();
    if (!devices.length) return 'unavailable';
    const provider = fakeProviders(this.env).fcm ? 'dev' : 'fcm';
    if (!(await this.enabled('native_push'))) {
      await this.record({
        alertId: alert.id,
        channel: 'native_push',
        provider,
        status: 'suppressed',
        reason: 'kill_switch',
      });
      return 'suppressed';
    }
    const results = await Promise.all(
      devices.map(async (d): Promise<Outcome> => {
        // The device id marks the delivery, so each device is notified at most once per message.
        const marker = `dev:${d.id}`;
        if (await this.alreadySent(alert.id, 'native_push', msg, marker)) return 'already';
        const delivery = await this.record({
          alertId: alert.id,
          channel: 'native_push',
          provider,
          status: 'queued',
          providerMessageId: marker,
        });
        const lang = d.locale ?? alert.preferred_lang;
        const r = await this.appPush.send({
          token: d.fcm_token,
          ...appPushText(lang, msg.kind === 'escalation' ? 'reminder' : msg.kind),
          // Generic: the alert id and the kind of message only (no type, text, photo, plate, name).
          data: { alertId: alert.id, kind: msg.kind },
          category: APP_ALERT_CATEGORY,
          urgent: alert.severity === 'urgent' || msg.kind !== 'alert',
          ttlSeconds: PUSH_TTL_SECONDS,
          collapseKey: `alert-${alert.id}`,
        });
        if (r.ok) {
          // The marker stays the provider message id: it is what makes a replay skip this device.
          await this.finish(delivery.id, { ok: true });
          await this.db
            .updateTable('user_devices')
            .set({ failed_count: 0 })
            .where('id', '=', d.id)
            .execute();
          return 'sent';
        }
        await this.finish(delivery.id, { ok: false, error: r.error });
        await this.deviceFailed(alert, d, r.invalidToken);
        return 'failed';
      }),
    );
    // Push errors are counted per device (NT-06) and never thrown: a retry would count them twice.
    if (results.includes('sent')) return 'sent';
    if (results.includes('already')) return 'already';
    return 'failed';
  }

  /** NT-06 for app devices: FCM said the token is gone, or too many failures in a row. */
  private async deviceFailed(
    alert: Pick<AlertRow, 'userId'>,
    d: { id: string; failed_count: number },
    invalidToken: boolean,
  ) {
    if (invalidToken || d.failed_count + 1 >= PUSH_MAX_FAILURES) {
      const removed = await this.db
        .deleteFrom('user_devices')
        .where('id', '=', d.id)
        .executeTakeFirst();
      if (Number(removed.numDeletedRows)) {
        this.logger.info({ why: invalidToken ? 'gone' : 'failures' }, 'app device removed');
      }
      return;
    }
    await this.db
      .updateTable('user_devices')
      .set({ failed_count: sql`failed_count + 1` })
      .where('id', '=', d.id)
      .where('user_id', '=', alert.userId)
      .execute();
  }

  /**
   * NT-07: the escalation SMS, one GSM-7 segment with the view link (the page has the details, photos
   * and "Ich komme"). At most one per alert, metered against the monthly cap (US-27).
   */
  private async sendSms(alert: AlertRow, msg: Message): Promise<Outcome> {
    const channel = await this.db
      .selectFrom('contact_channels')
      .select(['address_enc'])
      .where('user_id', '=', alert.userId)
      .where('type', '=', 'sms')
      .where('is_enabled', '=', true)
      .where('verified_at', 'is not', null)
      .where('opted_in_at', 'is not', null)
      .executeTakeFirst();
    if (!channel?.address_enc) return 'unavailable';
    const provider = fakeProviders(this.env).sms ? 'dev' : 'twilio';
    if (await this.alreadySent(alert.id, 'sms', msg)) return 'already';
    if (!(await this.enabled('sms'))) {
      await this.record({
        alertId: alert.id,
        channel: 'sms',
        provider,
        status: 'suppressed',
        reason: 'kill_switch',
      });
      return 'suppressed';
    }
    // Never more than one SMS per alert, also if the outbox replays the event.
    const { n } = await this.db
      .selectFrom('alert_deliveries')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('alert_id', '=', alert.id)
      .where('recipient', '=', 'owner')
      .where('channel', '=', 'sms')
      .where('status', 'in', ['queued', ...DONE])
      .executeTakeFirstOrThrow();
    if (Number(n) >= 1) return 'already';
    const owner = { id: alert.userId, email: alert.email, lang: alert.preferred_lang };
    if (!(await this.fairUse.reserve(owner, 'sms'))) {
      this.logger.info({ tag: 'sms_cap' }, 'escalation SMS skipped: monthly SMS cap reached');
      await this.record({
        alertId: alert.id,
        channel: 'sms',
        provider,
        status: 'suppressed',
        reason: 'fair_use',
      });
      return 'suppressed';
    }
    const cost = Number(await this.settings.get('sms.cost_micros', 100_000));
    const delivery = await this.record({
      alertId: alert.id,
      channel: 'sms',
      provider,
      status: 'queued',
      costMicros: cost,
    });
    const values = this.alertValues(alert);
    const kind = msg.kind === 'alert' ? (alert.hasPhotos ? 'photos' : 'alert') : msg.kind;
    // Abuse protection §4: never the free text of an unconfirmed sender, only that there is one.
    const subject = values.hidden
      ? `${values.type}. ${SMS_HIDDEN[alert.preferred_lang]}`
      : values.type;
    try {
      const { messageId } = await this.sms.send({
        to: this.crypto.decrypt(channel.address_enc),
        body: smsLinkText(alert.preferred_lang, kind, subject, values.nickname, msg.viewUrl),
        tag: `sms_${msg.kind}`,
      });
      await this.finish(delivery.id, { ok: true, messageId });
      return 'sent';
    } catch (err) {
      await this.finish(delivery.id, { ok: false, error: String(err) });
      await this.fairUse.release(alert.userId, 'sms');
      throw err;
    }
  }
}
