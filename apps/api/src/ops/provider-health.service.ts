import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB, ENV } from '../core/tokens';
import { MailService } from '../mail/mail.service';

export type Level = 'ok' | 'warning' | 'critical' | 'unknown';
const RANK: Record<Level, number> = { unknown: 0, ok: 0, warning: 1, critical: 2 };

export interface HealthCheck {
  key: string;
  provider: 'whatsapp' | 'email' | 'webpush' | 'stripe' | 'print' | 'channels';
  level: Level;
  /** Short value for the screen, e.g. "3 / 120 (2.5 %)" or "RED". */
  value: string;
  since?: Date | null;
}

const pct = (failed: number, total: number) => (total ? (failed / total) * 100 : 0);
const rate = (failed: number, total: number) =>
  `${failed} / ${total}${total ? ` (${pct(failed, total).toFixed(1)} %)` : ''}`;

/**
 * US-41 / AD-16: provider health on one screen, from our own delivery records and the provider
 * events (Meta quality rating and templates, Stripe webhook failures). The worker runs `evaluate`
 * every five minutes and mails the team when a check gets worse, again after `renotify_hours`, and
 * when it recovers.
 */
@Injectable()
export class ProviderHealthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  private async latest(provider: string, metricLike: string) {
    return this.db
      .selectFrom('provider_status_events')
      .distinctOn('metric')
      .select(['metric', 'value', 'captured_at'])
      .where('provider', '=', provider)
      .where('metric', 'like', metricLike)
      .orderBy('metric')
      .orderBy('captured_at', 'desc')
      .execute();
  }

  private async failures(channel: 'whatsapp' | 'email') {
    const r = await this.db
      .selectFrom('alert_deliveries')
      .select((eb) => [
        eb.fn.countAll<string>().as('total'),
        eb.fn.countAll<string>().filterWhere('status', '=', 'failed').as('failed'),
      ])
      .where('channel', '=', channel)
      .where('status', '<>', 'suppressed')
      .where('queued_at', '>', sql<Date>`now() - interval '24 hours'`)
      .executeTakeFirstOrThrow();
    return { total: Number(r.total), failed: Number(r.failed) };
  }

  private level(failed: number, total: number, thresholdPct: number): Level {
    const p = pct(failed, total);
    if (p >= thresholdPct) return 'critical';
    if (p >= thresholdPct / 2) return 'warning';
    return 'ok';
  }

  async checks(): Promise<HealthCheck[]> {
    const t = {
      whatsapp: await this.settings.get('health.whatsapp_failure_pct', 5),
      email: await this.settings.get('health.email_failure_pct', 5),
      push: await this.settings.get('health.push_failure_pct', 10),
      stripe: await this.settings.get('health.stripe_webhook_failures', 1),
      printHours: await this.settings.get('health.print_stuck_hours', 24),
    };
    const checks: HealthCheck[] = [];

    const [quality] = await this.latest('360dialog', 'meta_quality_rating');
    checks.push({
      key: 'whatsapp.quality',
      provider: 'whatsapp',
      level: !quality
        ? 'unknown'
        : quality.value === 'RED'
          ? 'critical'
          : quality.value === 'YELLOW'
            ? 'warning'
            : 'ok',
      value: quality?.value ?? '–',
      since: quality?.captured_at ?? null,
    });
    const templates = await this.latest('360dialog', 'template_status:%');
    const bad = templates.filter((x) => ['PAUSED', 'DISABLED', 'REJECTED'].includes(x.value));
    checks.push({
      key: 'whatsapp.templates',
      provider: 'whatsapp',
      level: !templates.length
        ? 'unknown'
        : bad.length
          ? 'critical'
          : templates.some((x) => x.value === 'PENDING')
            ? 'warning'
            : 'ok',
      value: templates.length
        ? templates
            .map((x) => `${x.metric.slice('template_status:'.length)}: ${x.value}`)
            .join(', ')
        : '–',
    });
    const wa = await this.failures('whatsapp');
    checks.push({
      key: 'whatsapp.failures',
      provider: 'whatsapp',
      level: this.level(wa.failed, wa.total, t.whatsapp),
      value: rate(wa.failed, wa.total),
    });
    const mail = await this.failures('email');
    checks.push({
      key: 'email.failures',
      provider: 'email',
      level: this.level(mail.failed, mail.total, t.email),
      value: rate(mail.failed, mail.total),
    });

    // Push by platform: the delivery marks the device ("sub:<id>"); removed devices count as unknown.
    const push = await sql<{ platform: string; total: string; failed: string }>`
      SELECT coalesce(p.platform, 'unknown') AS platform, count(*) AS total,
             count(*) FILTER (WHERE d.status = 'failed') AS failed
        FROM alert_deliveries d
        LEFT JOIN push_subscriptions p ON 'sub:' || p.id::text = d.provider_message_id
       WHERE d.channel = 'webpush' AND d.status <> 'suppressed'
         AND d.queued_at > now() - interval '24 hours'
       GROUP BY 1 ORDER BY 1`.execute(this.db);
    const platforms = push.rows.map((r) => ({
      ...r,
      total: Number(r.total),
      failed: Number(r.failed),
    }));
    checks.push({
      key: 'webpush.failures',
      provider: 'webpush',
      level: platforms.reduce<Level>((worst, p) => {
        const l = this.level(p.failed, p.total, t.push);
        return RANK[l] > RANK[worst] ? l : worst;
      }, 'ok'),
      value: platforms.length
        ? platforms.map((p) => `${p.platform}: ${rate(p.failed, p.total)}`).join(', ')
        : '0 / 0',
    });

    const { n: hooks } = await this.db
      .selectFrom('provider_status_events')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('provider', '=', 'stripe')
      .where('metric', '=', 'webhook_failure')
      .where('captured_at', '>', sql<Date>`now() - interval '24 hours'`)
      .executeTakeFirstOrThrow();
    checks.push({
      key: 'stripe.webhooks',
      provider: 'stripe',
      level: Number(hooks) >= t.stripe ? 'critical' : 'ok',
      value: String(Number(hooks)),
    });

    const print = await this.db
      .selectFrom('decal_orders')
      .select((eb) => [
        eb.fn
          .countAll<string>()
          .filterWhere((w) =>
            w.and([
              w('status', '=', 'paid'),
              w('created_at', '<', sql<Date>`now() - make_interval(hours => ${t.printHours})`),
            ]),
          )
          .as('stuck'),
        eb.fn
          .countAll<string>()
          .filterWhere((w) =>
            w.and([
              w('status', '=', 'in_production'),
              w('created_at', '<', sql<Date>`now() - interval '5 days'`),
            ]),
          )
          .as('slow'),
      ])
      .executeTakeFirstOrThrow();
    const { n: retries } = await this.db
      .selectFrom('outbox_events')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('topic', '=', 'print.submit')
      .where('processed_at', 'is', null)
      .where('attempts', '>', 0)
      .executeTakeFirstOrThrow();
    const stuck = Number(print.stuck) + Number(retries);
    checks.push({
      key: 'print.files',
      provider: 'print',
      level: stuck ? 'critical' : Number(print.slow) ? 'warning' : 'ok',
      value: `${stuck} / ${Number(print.slow)}`,
    });

    const off: string[] = [];
    for (const c of ['webpush', 'email', 'whatsapp'] as const) {
      if ((await this.settings.get<unknown>(`channels.${c}.enabled`, true)) === false) off.push(c);
    }
    checks.push({
      key: 'channels.kill_switches',
      provider: 'channels',
      level: off.length ? 'warning' : 'ok',
      value: off.length ? off.join(', ') : '–',
    });
    return checks;
  }

  /** Worker job: one team mail per change of level (and a reminder while it stays bad). */
  async evaluate(): Promise<number> {
    const checks = await this.checks();
    const renotifyH = await this.settings.get('health.renotify_hours', 6);
    const changes: string[] = [];
    for (const c of checks) {
      if (c.level === 'unknown') continue;
      const prev = await this.db
        .selectFrom('provider_health_alerts')
        .selectAll()
        .where('check_key', '=', c.key)
        .executeTakeFirst();
      const prevLevel = (prev?.level ?? 'ok') as Level;
      const stale =
        c.level !== 'ok' &&
        prev?.notified_at &&
        prev.notified_at.getTime() < Date.now() - renotifyH * 3_600_000;
      const changed = prevLevel !== c.level;
      if (!changed && !stale) continue;
      // Recoveries are reported only if the bad state was reported before.
      const report = c.level !== 'ok' || (changed && prev?.notified_at);
      await this.db
        .insertInto('provider_health_alerts')
        .values({
          check_key: c.key,
          level: c.level,
          notified_at: report ? new Date() : null,
        })
        .onConflict((oc) =>
          oc.column('check_key').doUpdateSet({
            level: c.level,
            ...(changed ? { since: sql`now()` } : {}),
            notified_at: report ? new Date() : null,
          }),
        )
        .execute();
      if (report) changes.push(`${c.key}: ${c.level.toUpperCase()} (${c.value})`);
    }
    if (changes.length) {
      await this.mail.send({
        to: await this.settings.get('ops.alert_email', 'datenschutz@parkshield.de'),
        template: 'provider_health_alert',
        locale: 'de',
        values: { count: changes.length, list: changes.join(' · ') },
        actionUrl: `${this.env.OPS_BASE_URL}/einstellungen/anbieter`,
      });
    }
    return changes.length;
  }
}
