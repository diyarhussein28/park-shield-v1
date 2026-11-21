import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PLAN_LIMIT_DEFAULTS, type PlanCode } from '@parkshield/shared';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB } from '../core/tokens';

export interface PlanLimits {
  vehicles: number;
  /** Monthly safety cap for escalation SMS (setting `sms.monthly_cap`). */
  sms_per_month: number;
  included_decals: number;
}

export interface Entitlement {
  subscriptionId: string;
  plan: PlanCode;
  limits: PlanLimits;
}

/**
 * What a customer may use right now. One all-inclusive plan (owner decision 2026-11-21): every
 * feature is available while the subscription is active (or past due in its grace period); there is
 * no plan gating. No feature access before a successful payment (US-06).
 */
@Injectable()
export class EntitlementService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async limits(): Promise<PlanLimits> {
    return {
      vehicles: Number(await this.settings.get('limits.vehicles', PLAN_LIMIT_DEFAULTS.vehicles)),
      sms_per_month: Number(
        await this.settings.get('sms.monthly_cap', PLAN_LIMIT_DEFAULTS.smsPerMonth),
      ),
      included_decals: PLAN_LIMIT_DEFAULTS.includedDecals,
    };
  }

  async current(userId: string): Promise<Entitlement | null> {
    const row = await this.db
      .selectFrom('subscriptions as s')
      .select(['s.id', 's.plan'])
      .where('s.user_id', '=', userId)
      .where('s.status', 'in', ['active', 'past_due'])
      .executeTakeFirst();
    if (!row) return null;
    return { subscriptionId: row.id, plan: row.plan, limits: await this.limits() };
  }

  /** "Subscription active" is the only feature check. */
  async require(userId: string): Promise<Entitlement> {
    const e = await this.current(userId);
    if (!e) throw new ForbiddenException({ error: 'subscription_required' });
    return e;
  }
}
