import { join } from 'node:path';
import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { fakeProviders, isTestEnvironment, repoRoot, type Env } from '../config/env';
import { LOGGER, VALKEY } from '../core/tokens';
import { DevCaptcha, FriendlyCaptcha } from './captcha';
import { FakePayments } from './fake-payments';
import { FakePrintPartner } from './fake-print';
import { BrevoMailer, DevMailer, MailjetMailer, SendGridMailer } from './mailer';
import { LocalAuditBucket, S3AuditBucket } from './audit-bucket';
import {
  APP_PUSH,
  AUDIT_BUCKET,
  CAPTCHA,
  MAILER,
  PAYMENTS,
  PRINT,
  PUSH,
  SMS,
  SUPPORT_DESK,
  type Mailer,
} from './ports';
import { DevSupportDesk, EmailSupportDesk, ZammadDesk } from './support-desk';
import { VapidPushSender } from './push';
import { DevAppPushSender, FcmSender } from './fcm';
import { StripePayments } from './stripe-payments';
import { DevSmsSender, TwilioSmsSender, twilioSmsWebhookUrl } from './twilio-sms';
import {
  DevPhoneVerifier,
  DisabledPhoneVerifier,
  PHONE_VERIFIER,
  TwilioPhoneVerifier,
} from './phone-verify';

@Global()
@Module({})
export class ProvidersModule {
  static forRoot(env: Env): DynamicModule {
    const fakes = fakeProviders(env);
    return {
      module: ProvidersModule,
      providers: [
        {
          provide: MAILER,
          inject: [VALKEY, LOGGER],
          useFactory: (valkey: Redis, logger: Logger) =>
            fakes.mail
              ? new DevMailer(valkey, logger)
              : env.MAIL_PROVIDER === 'mailjet'
                ? new MailjetMailer(env.MAILJET_API_KEY, env.MAILJET_SECRET_KEY, env.MAIL_FROM)
                : env.MAIL_PROVIDER === 'sendgrid'
                  ? new SendGridMailer(env.SENDGRID_API_KEY, env.MAIL_FROM, env.SENDGRID_REGION)
                  : new BrevoMailer(env.BREVO_API_KEY, env.MAIL_FROM),
        },
        {
          provide: CAPTCHA,
          useFactory: () =>
            fakes.captcha
              ? new DevCaptcha()
              : new FriendlyCaptcha(
                  env.FRIENDLY_CAPTCHA_API_KEY,
                  env.FRIENDLY_CAPTCHA_SITEKEY,
                  env.FRIENDLY_CAPTCHA_ENDPOINT,
                ),
        },
        {
          provide: PAYMENTS,
          inject: [VALKEY],
          useFactory: (valkey: Redis) =>
            fakes.payments
              ? new FakePayments(valkey, env.WEB_BASE_URL)
              : new StripePayments(
                  env.STRIPE_SECRET_KEY,
                  env.STRIPE_WEBHOOK_SECRET,
                  env.STRIPE_PRICE_YEARLY,
                  env.STRIPE_PRICE_MONTHLY,
                ),
        },
        {
          provide: PRINT,
          useFactory: () => {
            const dir = env.PRINT_OUTBOX_DIR || join(repoRoot(), '.local', 'print-outbox');
            if (fakes.print) return new FakePrintPartner(dir);
            if (env.PRINT_PARTNER === 'manual') return new FakePrintPartner(dir, 'PRINT');
            throw new Error(`Unknown PRINT_PARTNER "${env.PRINT_PARTNER}"`);
          },
        },
        {
          provide: PUSH,
          useFactory: () =>
            new VapidPushSender(
              env.VAPID_SUBJECT,
              env.VAPID_PUBLIC_KEY,
              env.VAPID_PRIVATE_KEY,
              isTestEnvironment(env),
            ),
        },
        {
          provide: APP_PUSH,
          inject: [VALKEY, LOGGER],
          useFactory: (valkey: Redis, logger: Logger) =>
            fakes.fcm
              ? new DevAppPushSender(valkey, logger)
              : new FcmSender(env.FCM_PROJECT_ID, env.FCM_CLIENT_EMAIL, env.FCM_PRIVATE_KEY),
        },
        {
          provide: SMS,
          inject: [VALKEY, LOGGER],
          useFactory: (valkey: Redis, logger: Logger) =>
            fakes.sms
              ? new DevSmsSender(valkey, logger)
              : new TwilioSmsSender(
                  env.TWILIO_ACCOUNT_SID,
                  env.TWILIO_AUTH_TOKEN,
                  env.TWILIO_SMS_FROM,
                  twilioSmsWebhookUrl(env),
                ),
        },
        {
          // Abuse protection §4: real Twilio Verify when configured; otherwise a local fake in test
          // environments and "not available" in production (never a fake there).
          provide: PHONE_VERIFIER,
          inject: [VALKEY, LOGGER],
          useFactory: (valkey: Redis, logger: Logger) =>
            env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID
              ? new TwilioPhoneVerifier(
                  env.TWILIO_ACCOUNT_SID,
                  env.TWILIO_AUTH_TOKEN,
                  env.TWILIO_VERIFY_SERVICE_SID,
                )
              : isTestEnvironment(env)
                ? new DevPhoneVerifier(valkey, logger)
                : new DisabledPhoneVerifier(),
        },
        {
          provide: AUDIT_BUCKET,
          useFactory: () =>
            fakes.auditBucket
              ? new LocalAuditBucket(
                  env.AUDIT_BUCKET_DIR || join(repoRoot(), '.local', 'audit-bucket'),
                )
              : new S3AuditBucket({
                  endpoint: env.S3_ENDPOINT,
                  region: env.S3_REGION,
                  accessKey: env.S3_ACCESS_KEY,
                  secretKey: env.S3_SECRET_KEY,
                  bucket: env.AUDIT_BUCKET,
                }),
        },
        {
          provide: SUPPORT_DESK,
          inject: [VALKEY, LOGGER, MAILER],
          useFactory: (valkey: Redis, logger: Logger, mailer: Mailer) =>
            fakes.support
              ? new DevSupportDesk(valkey, logger)
              : env.SUPPORT_PROVIDER === 'email'
                ? new EmailSupportDesk(mailer, env.SUPPORT_EMAIL)
                : new ZammadDesk(env.ZAMMAD_URL, env.ZAMMAD_TOKEN, env.ZAMMAD_GROUP),
        },
      ],
      exports: [
        MAILER,
        CAPTCHA,
        PAYMENTS,
        PRINT,
        PUSH,
        APP_PUSH,
        SMS,
        PHONE_VERIFIER,
        AUDIT_BUCKET,
        SUPPORT_DESK,
      ],
    };
  }
}
