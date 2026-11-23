import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { sql } from 'kysely';
import { BillingService } from '../billing/billing.service';
import { RenewalsService } from '../billing/renewals.service';
import { EXTRAORDINARY_TOPIC } from '../legal/cancellations.service';
import { WITHDRAWAL_TOPIC, WithdrawalsService } from '../legal/withdrawals.service';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { DB, ENV } from '../core/tokens';
import { AccessReviewService } from '../ops/access-review.service';
import { AuditStreamService } from '../ops/audit.service';
import { DsrService } from '../ops/dsr.service';
import { ProviderHealthService } from '../ops/provider-health.service';
import { PrivacyService } from '../privacy/privacy.service';
import { DispatchService } from '../notifications/dispatch.service';
import {
  OwnerReminderService,
  REMIND_TOPIC,
  SMS_ESCALATE_TOPIC,
} from '../notifications/owner-reminder.service';
import { OrdersService, PRINT_TOPIC } from '../orders/orders.service';
import { WelcomePrintReminderService } from '../orders/welcome-print-reminder.service';
import { STORE_SYNC_TOPIC, StoreSyncService, type SyncHint } from '../billing/store-sync.service';
import { RemindersService } from '../preferences/reminders.service';
import { DISPATCH_TOPIC, FOLLOWUP_TOPIC } from '../scan/scan.service';
import { AlertMediaService } from '../alert-media/alert-media.service';
import { WELCOME_LETTER_TOPIC } from '../letters/trigger';
import { WelcomeLettersService } from '../letters/welcome-letters.service';
import { CUSTOMER_EMAIL_TOPIC } from '../profile/email-change.service';
import { OutboxService } from './outbox.service';
import { SchedulerService } from './scheduler.service';
import {
  PAYMENT_ATTACHMENT_TOPIC,
  PAYMENT_NOTIFY_TOPIC,
  PaymentNotifyService,
} from '../billing/payment-notify.service';

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
    @Inject(RemindersService) private readonly reminders: RemindersService,
    @Inject(PrivacyService) private readonly privacy: PrivacyService,
    @Inject(DsrService) private readonly dsr: DsrService,
    @Inject(AuditStreamService) private readonly audit: AuditStreamService,
    @Inject(ProviderHealthService) private readonly health: ProviderHealthService,
    @Inject(AccessReviewService) private readonly access: AccessReviewService,
    @Inject(WithdrawalsService) private readonly withdrawals: WithdrawalsService,
    @Inject(RenewalsService) private readonly renewals: RenewalsService,
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(AlertMediaService) private readonly media: AlertMediaService,
    @Inject(WelcomeLettersService) private readonly letters: WelcomeLettersService,
    @Inject(PaymentNotifyService) private readonly paymentNotify: PaymentNotifyService,
    @Inject(OwnerReminderService) private readonly ownerReminders: OwnerReminderService,
    @Inject(StoreSyncService) private readonly storeSync: StoreSyncService,
    @Inject(WelcomePrintReminderService) private readonly welcomePrint: WelcomePrintReminderService,
  ) {}

  onApplicationBootstrap() {
    this.outbox.register(PRINT_TOPIC, (p) => this.orders.submitToPrinter(String(p.orderId)));
    this.outbox.register(DISPATCH_TOPIC, (p) => this.dispatch.dispatch(String(p.alertId)));
    this.outbox.register(FOLLOWUP_TOPIC, (p) => this.dispatch.followup(String(p.alertId)));
    this.outbox.register(REMIND_TOPIC, (p) => this.dispatch.remind(String(p.alertId)));
    this.outbox.register(SMS_ESCALATE_TOPIC, (p) => this.dispatch.escalateSms(String(p.alertId)));
    // § 356a BGB: match, end, refund, revoke codes. Idempotent, so retries are safe.
    this.outbox.register(WITHDRAWAL_TOPIC, (p) => this.withdrawals.process(String(p.id)));
    // Extraordinary cancellations wait in the ops review queue (legal requests); nothing else to do.
    this.outbox.register(EXTRAORDINARY_TOPIC, async () => {});
    // Welcome letter once paid and the first vehicle is registered (either order). Idempotent.
    this.outbox.register(WELCOME_LETTER_TOPIC, async (p) => {
      const r = await this.letters.check(String(p.userId));
      // A payment mail may still wait for this letter as its attachment.
      if (r === 'created') await this.paymentNotify.letterCreated(String(p.userId));
    });
    // payment@ (2026-11-22): the notification, and the letter attachment when it had to wait.
    this.outbox.register(PAYMENT_NOTIFY_TOPIC, (p) => this.paymentNotify.send(String(p.id)));
    this.outbox.register(PAYMENT_ATTACHMENT_TOPIC, (p) =>
      this.paymentNotify.sendAttachment(String(p.id)),
    );
    // A5: RevenueCat events (stored once by the webhook); the subscriber from the REST API is the truth.
    this.outbox.register(STORE_SYNC_TOPIC, async (p) => {
      await this.storeSync.sync(String(p.userId), p.hint as SyncHint | undefined);
    });
    // Konto → „E-Mail ändern“: the Stripe customer follows the account's e-mail (idempotent).
    this.outbox.register(CUSTOMER_EMAIL_TOPIC, (p) =>
      this.billing.syncCustomerEmail(String(p.userId)),
    );
    this.outbox.start();
    // B1: push reminders for the welcome print after 1 and 3 days.
    this.scheduler.every({
      name: 'welcome_print.remind',
      everyMs: HOUR,
      quiet: true,
      run: () => this.welcomePrint.sweep(),
    });
    this.scheduler.every({
      name: 'subscriptions.expire',
      everyMs: HOUR,
      run: () => this.billing.expireEnded(),
    });
    // Renewal reminders and the monthly switch after the first term (§ 309 Nr. 9 BGB).
    this.scheduler.every({
      name: 'renewals',
      everyMs: HOUR,
      quiet: true,
      run: () => this.renewals.runAll(),
    });
    // US-29/US-30: idempotent, so hourly runs simply catch up on whatever is due.
    this.scheduler.every({
      name: 'reminders',
      everyMs: HOUR,
      quiet: true,
      run: () => this.reminders.runAll(),
    });
    // US-33: the retention schedule (docs 04 §retention): the rules in one SQL function, plus the
    // alert photo rule (30 days: key, file, row), which needs the file system and so lives in code.
    this.scheduler.every({
      name: 'retention',
      everyMs: HOUR,
      run: async () => {
        await sql`SELECT run_retention()`.execute(this.db);
        // Counts only: no tokens, no owner or alert ids in the log.
        return { photos: await this.media.purgeExpired() };
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
    // Escalation (2026-11-21): reminder push after 10 min, one SMS after 30 min. The due times are in
    // the database; these sweeps pick them up within seconds and recover anything a stopped worker
    // missed, well within the ±60 s the spec allows.
    this.scheduler.every({
      name: 'alerts.remind',
      everyMs: 5_000,
      quiet: true,
      run: () => this.ownerReminders.sweep(),
    });
    this.scheduler.every({
      name: 'alerts.sms_escalate',
      everyMs: 5_000,
      quiet: true,
      run: () => this.ownerReminders.sweepSms(),
    });
  }
}
