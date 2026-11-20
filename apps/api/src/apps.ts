import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Logger } from 'pino';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { CsrfGuard, SessionGuard } from './auth/guards';
import { PasskeyService, StaffPasskeyService } from './auth/passkey.service';
import { HistoryController } from './history/history.controller';
import { HistoryService } from './history/history.service';
import { WordListsService } from './moderation/word-lists.service';
import { AbuseService } from './ops/abuse.service';
import { BreakGlassService } from './ops/break-glass.service';
import { CustomersService } from './ops/customers.service';
import { DsrService } from './ops/dsr.service';
import { OpsAuthController } from './ops/ops-auth.controller';
import {
  OpsAbuseController,
  OpsBreakGlassController,
  OpsCustomersController,
  OpsDsrController,
} from './ops/ops-tools.controller';
import { OpsStaffController } from './ops/ops-staff.controller';
import {
  OpsAuditController,
  OpsCustomerSummaryController,
  OpsLegalRequestsController,
  OpsOrdersController,
  OpsPartnersController,
  OpsPromoController,
  OpsRefundsController,
  OpsSettingsController,
} from './ops/ops-back-office.controller';
import { AuditStreamService, AuditViewService } from './ops/audit.service';
import { AccessReviewService } from './ops/access-review.service';
import { FulfilmentService } from './ops/fulfilment.service';
import { PromoService } from './ops/promo.service';
import { ProviderHealthService } from './ops/provider-health.service';
import { SettingsAdminService } from './ops/settings-admin.service';
import { RefundsService } from './billing/refunds.service';
import { SupportController } from './support/support.controller';
import { SupportService } from './support/support.service';
import { StaffGuard } from './ops/staff.guard';
import { StaffService } from './ops/staff.service';
import { PrivacyController } from './privacy/privacy.controller';
import { PrivacyService } from './privacy/privacy.service';
import { SessionService } from './auth/session.service';
import { BillingController, StripeWebhookController } from './billing/billing.controller';
import { BillingService } from './billing/billing.service';
import { fakeProviders, isTestEnvironment, type Env } from './config/env';
import { CoreModule } from './core/core.module';
import { GeoService } from './core/geo.service';
import { createHttpApp } from './core/http';
import fastifyMultipart from '@fastify/multipart';
import {
  AlertViewController,
  PortalAlertMediaController,
} from './alert-media/alert-media.controller';
import { AlertMediaService } from './alert-media/alert-media.service';
import { MULTIPART_OPTIONS } from './alert-media/multipart';
import { ViewTokenService } from './alert-media/view-token.service';
import { RateLimitService } from './core/rate-limit.service';
import { SettingsService } from './core/settings.service';
import { DevController } from './dev/dev.controller';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { MailService } from './mail/mail.service';
import { OpsHealthController } from './ops/ops-health.controller';
import { OpsOverviewController, OverviewService } from './ops/overview.service';
import { ProvidersModule } from './providers/providers.module';
import { EntitlementService } from './billing/entitlements.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { TokensService } from './vehicles/tokens.service';
import { TagsService } from './vehicles/tags.service';
import { CancellationsService } from './legal/cancellations.service';
import { ConsentsService } from './legal/consents.service';
import { LegalController } from './legal/legal.controller';
import { LegalTextsService } from './legal/legal-texts.service';
import { WithdrawalsService } from './legal/withdrawals.service';
import { RenewalsService } from './billing/renewals.service';
import { LegalRequestsService } from './ops/legal-requests.service';
import { ClaimController, VehiclesController } from './vehicles/vehicles.controller';
import { VehiclesService } from './vehicles/vehicles.service';
import { ChannelsController, TwilioWebhookController } from './channels/channels.controller';
import { ChannelsService } from './channels/channels.service';
import {
  ContactLinkController,
  EmergencyContactInvitationsController,
  EmergencyContactsController,
  EscalationSettingsController,
} from './contacts/emergency-contacts.controller';
import { EmergencyContactsService } from './contacts/emergency-contacts.service';
import { ContactLinkService } from './contacts/contact-link.service';
import { AppAuthController, AppController } from './app/app.controller';
import { EmailAuthController } from './auth/email-auth.controller';
import { AppAlertsService } from './app/app-alerts.service';
import { DevicesService } from './app/devices.service';
import { ChatGateway } from './chat/chat.gateway';
import { ChatService } from './chat/chat.service';
import { OwnerReminderService } from './notifications/owner-reminder.service';
import { SmsStatusService } from './notifications/sms-status.service';
import { AckController } from './notifications/ack.controller';
import { AckService } from './notifications/ack.service';
import { DispatchService } from './notifications/dispatch.service';
import { EscalationService } from './notifications/escalation.service';
import { FairUseService } from './notifications/fair-use.service';
import { PreferencesController } from './preferences/preferences.controller';
import { PreferencesService } from './preferences/preferences.service';
import { RemindersService } from './preferences/reminders.service';
import { ScanController } from './scan/scan.controller';
import { ScanService } from './scan/scan.service';
import { ScannerRefService } from './scan/scanner-ref.service';
import { PhoneBansService } from './abuse/phone-bans.service';
import { ProtectionService } from './abuse/protection.service';
import { ScannerVerificationService } from './abuse/verification.service';
import { CompanyService } from './letters/company.service';
import {
  COMPANY_IMAGE_MULTIPART,
  OpsLettersController,
  PortalDocumentsController,
} from './letters/letters.controller';
import { QrExportService } from './letters/qr-export.service';
import { WelcomeLettersService } from './letters/welcome-letters.service';
import { OutboxService } from './worker/outbox.service';
import { SchedulerService } from './worker/scheduler.service';
import { WorkerBootstrap } from './worker/worker.bootstrap';

const sharedProviders = [HealthService, RateLimitService, SettingsService, MailService, GeoService];
const domainProviders = [
  ViewTokenService,
  AlertMediaService,
  BillingService,
  EntitlementService,
  TokensService,
  TagsService,
  LegalTextsService,
  ConsentsService,
  CancellationsService,
  WithdrawalsService,
  RenewalsService,
  VehiclesService,
  OrdersService,
  ScannerRefService,
  ProtectionService,
  PhoneBansService,
  ScannerVerificationService,
  ScanService,
  DispatchService,
  ChannelsService,
  SmsStatusService,
  EscalationService,
  OwnerReminderService,
  ChatService,
  ContactLinkService,
  AppAlertsService,
  DevicesService,
  AckService,
  EmergencyContactsService,
  PreferencesService,
  FairUseService,
  RemindersService,
  SessionService,
  HistoryService,
  PrivacyService,
  WordListsService,
  RefundsService,
  CompanyService,
  WelcomeLettersService,
  QrExportService,
];

/** Ops back-office services (api-ops; the worker uses some of them for its jobs). */
const opsProviders = [
  StaffService,
  CustomersService,
  BreakGlassService,
  DsrService,
  AbuseService,
  FulfilmentService,
  PromoService,
  SettingsAdminService,
  ProviderHealthService,
  AuditStreamService,
  AuditViewService,
  AccessReviewService,
  OverviewService,
  LegalRequestsService,
];

/** Public API: scanner, owner portal, webhooks. Never registers ops routes (AD-01). */
@Module({})
export class PublicAppModule {
  static forRoot(env: Env, logger: Logger): DynamicModule {
    const fakes = Object.values(fakeProviders(env)).some(Boolean);
    const devRoutes = fakes && isTestEnvironment(env);
    return {
      module: PublicAppModule,
      imports: [CoreModule.forRoot(env, logger), ProvidersModule.forRoot(env)],
      controllers: [
        HealthController,
        AuthController,
        BillingController,
        StripeWebhookController,
        LegalController,
        VehiclesController,
        OrdersController,
        ScanController,
        ChannelsController,
        PreferencesController,
        TwilioWebhookController,
        AckController,
        EmergencyContactsController,
        EmergencyContactInvitationsController,
        EscalationSettingsController,
        ContactLinkController,
        AppAuthController,
        EmailAuthController,
        AppController,
        HistoryController,
        AlertViewController,
        PortalAlertMediaController,
        PrivacyController,
        ClaimController,
        SupportController,
        PortalDocumentsController,
        ...(devRoutes ? [DevController] : []),
      ],
      providers: [
        ...sharedProviders,
        ...domainProviders,
        SupportService,
        SessionGuard,
        AuthService,
        PasskeyService,
        // Live chat (Socket.io on the public API's HTTP server) and its timeout sweeper.
        SchedulerService,
        ChatGateway,
        { provide: APP_GUARD, useClass: CsrfGuard },
      ],
    };
  }
}

/** api-ops: ops routes only, bound to the WireGuard interface in production. */
@Module({})
export class OpsAppModule {
  static forRoot(env: Env, logger: Logger): DynamicModule {
    return {
      module: OpsAppModule,
      imports: [CoreModule.forRoot(env, logger), ProvidersModule.forRoot(env)],
      controllers: [
        OpsHealthController,
        OpsAuthController,
        OpsStaffController,
        OpsCustomersController,
        OpsBreakGlassController,
        OpsDsrController,
        OpsAbuseController,
        OpsCustomerSummaryController,
        OpsOrdersController,
        OpsPartnersController,
        OpsRefundsController,
        OpsPromoController,
        OpsSettingsController,
        OpsAuditController,
        OpsOverviewController,
        OpsLegalRequestsController,
        OpsLettersController,
      ],
      providers: [
        ...sharedProviders,
        ...domainProviders,
        ...opsProviders,
        StaffPasskeyService,
        // Fails closed: every ops route must declare its access policy (US-34).
        { provide: APP_GUARD, useClass: StaffGuard },
      ],
    };
  }
}

@Module({})
export class WorkerModule {
  static forRoot(env: Env, logger: Logger): DynamicModule {
    return {
      module: WorkerModule,
      imports: [CoreModule.forRoot(env, logger), ProvidersModule.forRoot(env)],
      providers: [
        ...sharedProviders,
        ...domainProviders,
        StaffService,
        DsrService,
        ProviderHealthService,
        AuditStreamService,
        AccessReviewService,
        OutboxService,
        SchedulerService,
        WorkerBootstrap,
      ],
    };
  }
}

export async function buildPublicApp(env: Env, logger: Logger) {
  const app = await createHttpApp(PublicAppModule.forRoot(env, logger), logger);
  // Scanner alerts with photos (Phase 2): memory storage, at most 2 files of 500 KB each.
  await app.register(fastifyMultipart as never, MULTIPART_OPTIONS);
  // Live chat: Socket.io on the same HTTP server (path /v1/socket.io).
  app.get(ChatGateway).attach(app.getHttpServer());
  return app;
}

export async function buildOpsApp(env: Env, logger: Logger) {
  const app = await createHttpApp(OpsAppModule.forRoot(env, logger), logger);
  // Logo and signature upload for letters: one image of at most 512 KB.
  await app.register(fastifyMultipart as never, COMPANY_IMAGE_MULTIPART);
  return app;
}
