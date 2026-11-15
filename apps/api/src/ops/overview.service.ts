import { Controller, Get, Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import { DB } from '../core/tokens';
import { StaffOnly } from './access';
import { CurrentStaff } from './staff.guard';
import { StaffService, type StaffContext } from './staff.service';

/** One count per area; null where the staff member lacks the permission for that area. */
export interface Overview {
  customers: { total: number; activeSubscriptions: number; newLast7Days: number } | null;
  alerts: {
    today: number;
    last7Days: number;
    urgentLast7Days: number;
    unanswered7Days: number;
  } | null;
  dsr: { open: number; dueSoon: number } | null;
  abuse: { openReports: number } | null;
  review: { pending: number } | null;
  orders: { toProduce: number; inProduction: number } | null;
  breakGlass: { waitingForApproval: number } | null;
  providers: { warnings: number; critical: number } | null;
}

const n = (v: unknown) => Number(v ?? 0);

/**
 * Start page of the ops app: counts only (no personal data), each area only when the staff member
 * holds that area's permission, so the dashboard never shows more than the pages behind it.
 */
@Injectable()
export class OverviewService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(StaffService) private readonly staff: StaffService,
  ) {}

  async overview(by: StaffContext): Promise<Overview> {
    const can = (p: string) => by.permissions.has(p);
    const one = async <T>(q: ReturnType<typeof sql<T>>) => (await q.execute(this.db)).rows[0];

    const [customers, alerts, dsr, abuse, review, orders, breakGlass, providers] =
      await Promise.all([
        can('customer.read_masked')
          ? one(sql<Record<string, unknown>>`
              SELECT (SELECT count(*) FROM users WHERE kind = 'customer') AS total,
                     (SELECT count(DISTINCT user_id) FROM subscriptions WHERE status = 'active') AS active,
                     (SELECT count(*) FROM users WHERE kind = 'customer'
                        AND created_at > now() - interval '7 days') AS recent`)
          : null,
        can('alerts.read_metadata')
          ? one(sql<Record<string, unknown>>`
              SELECT count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Berlin')
                                                         AT TIME ZONE 'Europe/Berlin') AS today,
                     count(*) AS week,
                     count(*) FILTER (WHERE severity = 'urgent') AS urgent,
                     count(*) FILTER (WHERE status IN ('dispatched', 'delivered', 'escalated', 'expired')
                                        AND is_test = false) AS unanswered
                FROM alerts WHERE created_at > now() - interval '7 days' AND status <> 'blocked'`)
          : null,
        can('dsr.process')
          ? one(sql<Record<string, unknown>>`
              SELECT count(*) AS open,
                     count(*) FILTER (WHERE due_at < now() + interval '7 days') AS due
                FROM data_subject_requests
               WHERE status IN ('received', 'awaiting_identity', 'in_progress')`)
          : null,
        can('abuse.moderate')
          ? one(sql<Record<string, unknown>>`
              SELECT count(*) AS open FROM abuse_reports WHERE status = 'open'`)
          : null,
        can('moderation.review')
          ? one(sql<Record<string, unknown>>`
              SELECT count(*) AS pending FROM moderation_reviews m JOIN alerts a ON a.id = m.alert_id
               WHERE m.decision IS NULL AND a.custom_message_enc IS NOT NULL`)
          : null,
        can('orders.manage')
          ? one(sql<Record<string, unknown>>`
              SELECT count(*) FILTER (WHERE status = 'paid') AS paid,
                     count(*) FILTER (WHERE status = 'in_production') AS production
                FROM decal_orders`)
          : null,
        can('pii.decrypt_approve')
          ? one(sql<Record<string, unknown>>`
              SELECT count(*) AS waiting FROM break_glass_requests
               WHERE status = 'requested' AND requester_id <> ${by.userId}`)
          : null,
        can('settings.edit')
          ? one(sql<Record<string, unknown>>`
              SELECT count(*) FILTER (WHERE level = 'warning') AS warning,
                     count(*) FILTER (WHERE level = 'critical') AS critical
                FROM provider_health_alerts`)
          : null,
      ]);

    await this.staff.auditRead(by.userId, 'ops.overview_view', 'overview', null);
    return {
      customers: customers
        ? {
            total: n(customers.total),
            activeSubscriptions: n(customers.active),
            newLast7Days: n(customers.recent),
          }
        : null,
      alerts: alerts
        ? {
            today: n(alerts.today),
            last7Days: n(alerts.week),
            urgentLast7Days: n(alerts.urgent),
            unanswered7Days: n(alerts.unanswered),
          }
        : null,
      dsr: dsr ? { open: n(dsr.open), dueSoon: n(dsr.due) } : null,
      abuse: abuse ? { openReports: n(abuse.open) } : null,
      review: review ? { pending: n(review.pending) } : null,
      orders: orders ? { toProduce: n(orders.paid), inProduction: n(orders.production) } : null,
      breakGlass: breakGlass ? { waitingForApproval: n(breakGlass.waiting) } : null,
      providers: providers
        ? { warnings: n(providers.warning), critical: n(providers.critical) }
        : null,
    };
  }
}

/** Any signed-in staff member; the service limits each area to its permission. */
@Controller('ops/v1')
export class OpsOverviewController {
  constructor(@Inject(OverviewService) private readonly overview: OverviewService) {}

  @Get('overview')
  @StaffOnly()
  get(@CurrentStaff() me: StaffContext) {
    return this.overview.overview(me);
  }
}
