import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB } from '../core/tokens';

export interface PlanLimits {
  vehicles: number;
  emergency_contacts: number;
  co_drivers: number;
  whatsapp_per_month: number;
  sms_per_month: number;
  voice_minutes_per_month: number;
  included_decals: number;
}

export interface Entitlement {
  subscriptionId: string;
  plan: 'plus' | 'premium' | 'business';
  limits: PlanLimits;
}

/** What a customer may use right now. No feature access before a successful payment (US-06). */
@Injectable()
export class EntitlementService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async current(userId: string): Promise<Entitlement | null> {
    const row = await this.db
      .selectFrom('subscriptions as s')
      .innerJoin('plans as p', 'p.code', 's.plan')
      .select(['s.id', 's.plan', 'p.limits'])
      .where('s.user_id', '=', userId)
      .where('s.status', 'in', ['active', 'past_due'])
      .executeTakeFirst();
    if (!row) return null;
    const limits = { ...(row.limits as unknown as PlanLimits) };
    for (const key of Object.keys(limits) as (keyof PlanLimits)[]) {
      limits[key] = await this.settings.get(`limits.${row.plan}.${key}`, limits[key]);
    }
    return { subscriptionId: row.id, plan: row.plan, limits };
  }

  async require(userId: string): Promise<Entitlement> {
    const e = await this.current(userId);
    if (!e) throw new ForbiddenException({ error: 'subscription_required' });
    return e;
  }
}
