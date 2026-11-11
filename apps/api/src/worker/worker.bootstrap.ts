import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { sql } from 'kysely';
import { BillingService } from '../billing/billing.service';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { DB, ENV } from '../core/tokens';
import { AccessReviewService } from '../ops/access-review.service';
import { AuditStreamService } from '../ops/audit.service';
import { DsrService } from '../ops/dsr.service';
import { ProviderHealthService } from '../ops/provider-health.service';
import { PrivacyService } from '../privacy/privacy.service';
import { DispatchService } from '../notifications/dispatch.service';
import { ESCALATE_TOPIC, EscalationService } from '../notifications/escalation.service';
import { OrdersService, PRINT_TOPIC } from '../orders/orders.service';
import { RemindersService } from '../preferences/reminders.service';
import { DISPATCH_TOPIC, FOLLOWUP_TOPIC } from '../scan/scan.service';
import { OutboxService } from './outbox.service';
import { SchedulerService } from './scheduler.service';

const HOUR = 3_600_000;

/** Registers outbox handlers and periodic jobs, then starts processing. */
@Injectable()
export class WorkerBootstrap implements OnApplicationBootstrap {
  constructor(
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(DispatchService) private readonly dispatch: DispatchService,
    @Inject(EscalationService) private readonly escalation: EscalationService,
    @Inject(RemindersService) private readonly reminders: RemindersService,
    @Inject(PrivacyService) private readonly privacy: PrivacyService,
    @Inject(DsrService) private readonly dsr: DsrService,
    @Inject(AuditStreamService) private readonly audit: AuditStreamService,
    @Inject(ProviderHealthService) private readonly health: ProviderHealthService,
    @Inject(AccessReviewService) private readonly access: AccessReviewService,
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap() {
    this.outbox.register(PRINT_TOPIC, (p) => this.orders.submitToPrinter(String(p.orderId)));
    this.outbox.register(DISPATCH_TOPIC, (p) => this.dispatch.dispatch(String(p.alertId)));
    this.outbox.register(FOLLOWUP_TOPIC, (p) => this.dispatch.followup(String(p.alertId)));
    this.outbox.register(ESCALATE_TOPIC, (p) => this.escalation.run(String(p.alertId)));
    this.outbox.start();
    this.scheduler.every({
      name: 'subscriptions.expire',
      everyMs: HOUR,
      run: () => this.billing.expireEnded(),
    });
    // US-29/US-30: idempotent, so hourly runs simply catch up on whatever is due.
    this.scheduler.every({
      name: 'reminders',
      everyMs: HOUR,
      quiet: true,
      run: () => this.reminders.runAll(),
    });
    // US-33: the retention schedule (docs 04 §retention), all rules in one SQL function.
    this.scheduler.every({
      name: 'retention',
      everyMs: HOUR,
      run: async () => {
        await sql`SELECT run_retention()`.execute(this.db);
        return 'ok';
      },
    });
    // US-37: one reminder to the privacy team 7 days before a request's 30-day deadline.
    this.scheduler.every({
      name: 'dsr.remind',
      everyMs: HOUR,
      quiet: true,
      run: () => this.dsr.remindDueSoon(),
    });
    // US-32: accounts whose 24 h grace period is over: processor steps, then the database.
    this.scheduler.every({
      name: 'accounts.delete',
      everyMs: 10 * 60_000,
      quiet: true,
      run: () => this.privacy.processDue(),
    });
    // US-42: copy new audit rows to the Object Lock bucket, a few seconds behind live.
    this.scheduler.every({
      name: 'audit.stream',
      everyMs: 5_000,
      quiet: true,
      run: () => this.audit.flush(),
    });
    // US-41: provider health checks; the team gets a mail when one gets worse or recovers.
    this.scheduler.every({
      name: 'providers.health',
      everyMs: 5 * 60_000,
      quiet: true,
      run: () => this.health.evaluate(),
    });
    // US-45 monitoring: report in to Better Stack, but only while the queue keeps moving, so a worker
    // that runs but is stuck (database down, handlers failing) pages the on-call person too.
    if (this.env.HEARTBEAT_URL_WORKER) {
      this.scheduler.every({
        name: 'heartbeat',
        everyMs: 60_000,
        quiet: true,
        run: async () => {
          const { n } = await this.db
            .selectFrom('outbox_events')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .where('processed_at', 'is', null)
            .where('attempts', '<', 10)
            .where('available_at', '<', sql<Date>`now() - interval '2 minutes'`)
            .executeTakeFirstOrThrow();
          if (Number(n) > 0) return `stuck: ${n} events older than 2 min`;
          await fetch(this.env.HEARTBEAT_URL_WORKER, { signal: AbortSignal.timeout(10_000) });
          return 'ok';
        },
      });
    }
    // US-45 permission review: inactive staff lose their roles; a weekly reminder while a review is due.
    this.scheduler.every({
      name: 'staff.expire',
      everyMs: 6 * HOUR,
      run: () => this.access.expireInactive(),
    });
    this.scheduler.every({
      name: 'staff.review_remind',
      everyMs: 6 * HOUR,
      quiet: true,
      run: () => this.access.remindDue(),
    });
    // Escalations fall due at escalate_at; the sweeper picks them up within seconds (02-arch §3 step 8).
    this.scheduler.every({
      name: 'alerts.escalate',
      everyMs: 5_000,
      quiet: true,
      run: () => this.escalation.sweep(),
    });
  }
}
