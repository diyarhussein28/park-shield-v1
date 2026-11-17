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
import { MailService } from '../mail/mail.service';
import {
  PUSH,
  SMS,
  WHATSAPP,
  type PushSender,
  type SmsSender,
  type WhatsAppSender,
} from '../providers/ports';
import { PreferencesService } from '../preferences/preferences.service';
import { AckService, OWNER_REPLIES, type ReplyLinks } from './ack.service';
import { FairUseService } from './fair-use.service';
import { channelOrder, type OrderableChannel } from './channel-order';
import { pushText, REPLY_LABELS, REPLY_SENT, type PushKind } from './push-texts';
import { smsPhotoText, smsText } from './sms-texts';
import { ViewTokenService } from '../alert-media/view-token.service';

/** NT-06: a subscription is removed after HTTP 404/410 or this many consecutive failures. */
export const PUSH_MAX_FAILURES = 5;
const PUSH_TTL_SECONDS = 2 * 3600;
const DONE = ['sent', 'delivered', 'read'] as const;

type AlertRow = NonNullable<Awaited<ReturnType<DispatchService['load']>>>;
/** sent: delivered to the provider now; already: in an earlier attempt; unavailable: not set up. */
type Outcome = 'sent' | 'already' | 'failed' | 'suppressed' | 'unavailable';
type Kind = 'alert' | 'test' | 'followup';

interface Message {
  kind: Kind;
  token: string;
  links: ReplyLinks;
  /** false for reminders: they are sent again on purpose, so earlier deliveries do not count. */
  dedupe: boolean;
  /**
   * Phase 2: the one view link of an alert with photos (`/v/<token>`). Every channel carries this link
   * only; no photo is ever attached or embedded.
   */
  viewUrl?: string;
}

/** Order for the NT-09 reminder: fastest first, regardless of cost. */
const FASTEST: OrderableChannel[] = ['webpush', 'whatsapp', 'sms', 'email'];

/**
 * Delivers an alert to the owner (US-22, NT-01). Normal alerts go through the owner's channel order
 * (cheapest first by default) and stop at the first channel that worked; on failure the next one is
 * tried. Urgent alerts and tests go to every enabled channel at once. Kill switches (NT-12) suppress a
 * channel and move on. Every notification carries the reply buttons (NT-02, OW-16).
 *
 * Idempotent: a replayed outbox event never notifies a channel (or push device) twice. When nothing
 * could be delivered, the error is rethrown so the outbox retries with backoff.
 */
@Injectable()
export class DispatchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(PUSH) private readonly push: PushSender,
    @Inject(WHATSAPP) private readonly whatsapp: WhatsAppSender,
    @Inject(SMS) private readonly sms: SmsSender,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(AckService) private readonly ack: AckService,
    @Inject(PreferencesService) private readonly preferences: PreferencesService,
    @Inject(FairUseService) private readonly fairUse: FairUseService,
    @Inject(ViewTokenService) private readonly viewTokens: ViewTokenService,
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
        'a.custom_message_enc',
        'a.content_hidden',
        'a.expires_at',
        'a.followup_sent_at',
        'a.scanner_waiting_at',
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

  async dispatch(alertId: string): Promise<void> {
    const alert = await this.load(alertId);
    if (!alert || !['dispatched', 'delivered'].includes(alert.status)) return;
    if (alert.expires_at < new Date()) return;

    // US-26: quiet hours and "sensitive spot" mute the owner's notifications. The alert is kept and
    // recorded as suppressed (it shows in the history); escalation to a contact still applies.
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
        const [first] = await channelOrder(this.db, this.settings, alert.userId);
        await this.record({
          alertId: alert.id,
          channel: first ?? 'email',
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
      dedupe: true,
      ...(alert.hasPhotos ? { viewUrl: this.viewTokens.urlFor(alert.id) } : {}),
    };
    const everywhere = alert.severity === 'urgent' || alert.is_test;
    const order = await channelOrder(this.db, this.settings, alert.userId);
    const { outcomes, errors } = await this.deliver(alert, msg, order, everywhere);

    if (outcomes.includes('sent')) {
      await this.db
        .updateTable('alerts')
        .set({ status: 'delivered' })
        .where('id', '=', alertId)
        .where('status', '=', 'dispatched')
        .execute();
    }
    const reached = outcomes.some((o) => o === 'sent' || o === 'already');
    // Retry when nothing reached the owner, or (urgent) when one channel still has to be retried.
    if (errors.length && (everywhere || !reached)) throw errors[0];
    if (!reached && !errors.length) {
      this.logger.warn(
        { outcomes },
        'alert not delivered: every channel switched off or unavailable',
      );
    }
  }

  /** NT-09: one reminder with fresh reply buttons on the fastest channel that works. */
  async followup(alertId: string): Promise<void> {
    const alert = await this.load(alertId);
    if (!alert || alert.followup_sent_at || !alert.scanner_waiting_at) return;
    if (alert.status !== 'acknowledged' || alert.expires_at < new Date()) return;
    const token = await this.ack.renew(alert.id, alert.expires_at);
    const msg: Message = { kind: 'followup', token, links: this.ack.links(token), dedupe: false };
    const { outcomes, errors } = await this.deliver(alert, msg, FASTEST, false);
    if (!outcomes.includes('sent') && errors.length) throw errors[0];
    await this.db
      .updateTable('alerts')
      .set({ followup_sent_at: sql`now()` })
      .where('id', '=', alertId)
      .where('followup_sent_at', 'is', null)
      .execute();
  }

  private async deliver(
    alert: AlertRow,
    msg: Message,
    order: OrderableChannel[],
    everywhere: boolean,
  ) {
    const outcomes: Outcome[] = [];
    const errors: unknown[] = [];
    for (const channel of order) {
      let outcome: Outcome;
      try {
        outcome =
          channel === 'webpush'
            ? await this.sendPush(alert, msg)
            : channel === 'email'
              ? await this.sendEmail(alert, msg)
              : channel === 'sms'
                ? await this.sendSms(alert, msg)
                : await this.sendWhatsApp(alert, msg);
      } catch (err) {
        errors.push(err);
        outcome = 'failed';
      }
      outcomes.push(outcome);
      if (!everywhere && (outcome === 'sent' || outcome === 'already')) break;
    }
    return { outcomes, errors };
  }

  // --- channels --------------------------------------------------------------------------------

  private async enabled(channel: ChannelType): Promise<boolean> {
    const v = await this.settings.get<unknown>(`channels.${channel}.enabled`, true);
    return v === true || v === 'true';
  }

  private async alreadySent(alertId: string, channel: ChannelType, providerMessageId?: string) {
    let q = this.db
      .selectFrom('alert_deliveries')
      .select('id')
      .where('alert_id', '=', alertId)
      .where('recipient', '=', 'owner')
      .where('channel', '=', channel)
      .where('status', 'in', [...DONE]);
    if (providerMessageId) q = q.where('provider_message_id', '=', providerMessageId);
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

  private replyButtons(alert: AlertRow, links: ReplyLinks) {
    const labels = REPLY_LABELS[alert.preferred_lang];
    return OWNER_REPLIES.map((r) => ({ label: labels[r], url: links[r] }));
  }

  private async sendEmail(alert: AlertRow, msg: Message): Promise<Outcome> {
    const provider = fakeProviders(this.env).mail ? 'dev' : this.env.MAIL_PROVIDER;
    if (msg.dedupe && (await this.alreadySent(alert.id, 'email'))) return 'already';
    if (!(await this.enabled('email'))) {
      await this.record({
        alertId: alert.id,
        channel: 'email',
        provider,
        status: 'suppressed',
        reason: 'kill_switch',
      });
      return 'suppressed';
    }
    const delivery = await this.record({
      alertId: alert.id,
      channel: 'email',
      provider,
      status: 'queued',
    });
    const template = {
      alert: 'alert_received',
      test: 'alert_test',
      followup: 'alert_followup',
    } as const;
    const values = (({ hidden: _hidden, ...v }) => v)(this.alertValues(alert));
    try {
      // Phase 2: with photos the main button opens the view page ("Fotos ansehen"); no attachment and
      // no embedded image. "Missbrauch melden" is a plain link to the same page.
      await this.mail.send(
        msg.viewUrl
          ? {
              to: alert.email,
              template: 'alert_received_photos',
              locale: alert.preferred_lang,
              values,
              actionUrl: msg.viewUrl,
              replies: this.replyButtons(alert, msg.links),
              links: [
                {
                  label: alert.preferred_lang === 'en' ? 'Report abuse' : 'Missbrauch melden',
                  url: `${msg.viewUrl}?melden=1`,
                },
              ],
            }
          : {
              to: alert.email,
              template: template[msg.kind],
              locale: alert.preferred_lang,
              values,
              actionUrl: `${this.env.WEB_BASE_URL}/konto`,
              replies: this.replyButtons(alert, msg.links),
            },
      );
    } catch (err) {
      await this.finish(delivery.id, { ok: false, error: String(err) });
      throw err;
    }
    await this.finish(delivery.id, { ok: true });
    return 'sent';
  }

  private async sendPush(alert: AlertRow, msg: Message): Promise<Outcome> {
    const devices = await this.db
      .selectFrom('push_subscriptions')
      .select(['id', 'endpoint', 'p256dh', 'auth', 'device_label', 'platform', 'failed_count'])
      .where('user_id', '=', alert.userId)
      .execute();
    if (!devices.length) return 'unavailable';
    if (!(await this.enabled('webpush'))) {
      await this.record({
        alertId: alert.id,
        channel: 'webpush',
        provider: 'vapid',
        status: 'suppressed',
        reason: 'kill_switch',
      });
      return 'suppressed';
    }
    const values = this.alertValues(alert);
    const pushKind: PushKind = msg.kind;
    const text = pushText(
      alert.preferred_lang,
      pushKind,
      values.type,
      values.nickname,
      values.hidden,
    );
    const labels = REPLY_LABELS[alert.preferred_lang];
    const payload = JSON.stringify({
      ...text,
      lang: alert.preferred_lang,
      url: msg.viewUrl ?? msg.links.page,
      tag: `alert-${alert.id}`,
      // The service worker posts the reply directly when an action button is tapped (OW-16).
      token: msg.token,
      // Most browsers show two actions; the third reply is on the page the notification opens.
      actions: (['coming', 'not_nearby', 'in_30_min'] as const).map((action) => ({
        action,
        title: labels[action],
      })),
      replied: REPLY_SENT[alert.preferred_lang],
    });
    const urgent = alert.severity === 'urgent' || msg.kind === 'followup';

    const results = await Promise.all(
      devices.map(async (d): Promise<Outcome> => {
        // The subscription id marks the device, so each device is notified at most once per alert.
        const marker = `sub:${d.id}`;
        if (msg.dedupe && (await this.alreadySent(alert.id, 'webpush', marker))) return 'already';
        const delivery = await this.record({
          alertId: alert.id,
          channel: 'webpush',
          provider: 'vapid',
          status: 'queued',
          providerMessageId: marker,
        });
        const { statusCode } = await this.push.send(d, payload, {
          ttlSeconds: PUSH_TTL_SECONDS,
          urgency: urgent ? 'high' : 'normal',
        });
        if (statusCode >= 200 && statusCode < 300) {
          await this.finish(delivery.id, { ok: true });
          await this.db
            .updateTable('push_subscriptions')
            .set({ last_ok_at: sql`now()`, failed_count: 0 })
            .where('id', '=', d.id)
            .execute();
          return 'sent';
        }
        await this.finish(delivery.id, { ok: false, error: `http_${statusCode}` });
        const gone = statusCode === 404 || statusCode === 410;
        if (gone || d.failed_count + 1 >= PUSH_MAX_FAILURES) {
          await this.removeDevice(alert, d, gone ? 'gone' : 'failures');
        } else {
          await this.db
            .updateTable('push_subscriptions')
            .set({ failed_count: sql`failed_count + 1` })
            .where('id', '=', d.id)
            .execute();
        }
        return 'failed';
      }),
    );
    // Push errors are counted per device (NT-06) and never thrown: a retry would count them twice.
    if (results.includes('sent')) return 'sent';
    if (results.includes('already')) return 'already';
    return 'failed';
  }

  /** NT-06: remove the subscription and tell the owner by e-mail how to turn push back on. */
  private async removeDevice(
    alert: AlertRow,
    d: { id: string; device_label: string | null; platform: string | null },
    why: 'gone' | 'failures',
  ) {
    const removed = await this.db
      .deleteFrom('push_subscriptions')
      .where('id', '=', d.id)
      .executeTakeFirst();
    if (!Number(removed.numDeletedRows)) return;
    this.logger.info({ why }, 'push subscription removed');
    const names =
      alert.preferred_lang === 'en'
        ? { ios: 'your iPhone', android: 'your Android phone', desktop: 'your computer' }
        : { ios: 'Ihrem iPhone', android: 'Ihrem Android-Gerät', desktop: 'Ihrem Computer' };
    const device =
      d.device_label ?? names[(d.platform as keyof typeof names) ?? 'desktop'] ?? names.desktop;
    await this.mail
      .send({
        to: alert.email,
        template: 'push_removed',
        locale: alert.preferred_lang,
        values: { device },
        actionUrl: `${this.env.WEB_BASE_URL}/konto/benachrichtigungen`,
      })
      .catch((err: unknown) => this.logger.warn({ err: String(err) }, 'push_removed mail failed'));
  }

  private async sendWhatsApp(alert: AlertRow, msg: Message): Promise<Outcome> {
    if (this.env.WHATSAPP_PROVIDER === 'off') return 'unavailable';
    const channel = await this.db
      .selectFrom('contact_channels')
      .select(['address_enc'])
      .where('user_id', '=', alert.userId)
      .where('type', '=', 'whatsapp')
      .where('is_enabled', '=', true)
      .where('verified_at', 'is not', null)
      .where('opted_in_at', 'is not', null)
      .executeTakeFirst();
    if (!channel?.address_enc) return 'unavailable';
    const provider = fakeProviders(this.env).whatsapp ? 'dev' : this.env.WHATSAPP_PROVIDER;
    if (msg.dedupe && (await this.alreadySent(alert.id, 'whatsapp'))) return 'already';
    if (!(await this.enabled('whatsapp'))) {
      await this.record({
        alertId: alert.id,
        channel: 'whatsapp',
        provider,
        status: 'suppressed',
        reason: 'kill_switch',
      });
      return 'suppressed';
    }
    // US-27: above the monthly fair-use limit, skip WhatsApp; the alert falls through to Push and e-mail.
    const owner = { id: alert.userId, email: alert.email, lang: alert.preferred_lang };
    if (!(await this.fairUse.reserve(owner, 'whatsapp'))) {
      await this.record({
        alertId: alert.id,
        channel: 'whatsapp',
        provider,
        status: 'suppressed',
        reason: 'fair_use',
      });
      return 'suppressed';
    }
    const cost = Number(await this.settings.get('whatsapp.cost_micros', 55_000));
    const delivery = await this.record({
      alertId: alert.id,
      channel: 'whatsapp',
      provider,
      status: 'queued',
      costMicros: cost,
    });
    const values = this.alertValues(alert);
    const template = { alert: 'ps_alert', test: 'ps_test', followup: 'ps_followup' } as const;
    // Phase 2: an approved template with a URL button to /v/{{token}}. No mediaUrl: photos stay on our
    // server. Without that template (not approved yet) the alert goes out as before.
    const withPhotos =
      Boolean(msg.viewUrl) && this.whatsapp.supports('ps_alert_photos', alert.preferred_lang);
    try {
      const { messageId } = await this.whatsapp.sendTemplate({
        to: this.crypto.decrypt(channel.address_enc).replace(/^\+/, ''),
        template: withPhotos ? 'ps_alert_photos' : template[msg.kind],
        lang: alert.preferred_lang,
        params:
          msg.kind === 'test' && !withPhotos ? [values.nickname] : [values.type, values.nickname],
        // Quick-reply buttons in template order: Ich komme · In ca. 30 Min · Bin nicht in der Nähe.
        buttons: OWNER_REPLIES.map((r) => `ack:${msg.token}:${r}`),
        ...(withPhotos ? { urlButton: msg.viewUrl!.split('/v/')[1]! } : {}),
      });
      await this.finish(delivery.id, { ok: true, messageId });
      return 'sent';
    } catch (err) {
      await this.finish(delivery.id, { ok: false, error: String(err) });
      await this.fairUse.release(alert.userId, 'whatsapp');
      throw err;
    }
  }

  /** NT-07: plain-text SMS with the reply-page link (no buttons). Metered like WhatsApp (US-27). */
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
    if (msg.dedupe && (await this.alreadySent(alert.id, 'sms'))) return 'already';
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
    const owner = { id: alert.userId, email: alert.email, lang: alert.preferred_lang };
    if (!(await this.fairUse.reserve(owner, 'sms'))) {
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
    try {
      const { messageId } = await this.sms.send({
        to: this.crypto.decrypt(channel.address_enc),
        // Phase 2: with photos one GSM-7 segment with the view link (the page also has the replies).
        body: msg.viewUrl
          ? smsPhotoText(alert.preferred_lang, values.type, values.nickname, msg.viewUrl)
          : smsText(
              alert.preferred_lang,
              msg.kind,
              values.type,
              values.nickname,
              msg.links.page,
              values.hidden,
            ),
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
