import { join } from 'node:path';
import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { fakeProviders, isTestEnvironment, repoRoot, type Env } from '../config/env';
import { LOGGER, VALKEY } from '../core/tokens';
import { DevCaptcha, FriendlyCaptcha } from './captcha';
import { FakePayments } from './fake-payments';
import { FakePrintPartner } from './fake-print';
import { BrevoMailer, DevMailer } from './mailer';
import { LocalAuditBucket, S3AuditBucket } from './audit-bucket';
import {
  AUDIT_BUCKET,
  CAPTCHA,
  MAILER,
  PAYMENTS,
  PRINT,
  PUSH,
  SUPPORT_DESK,
  WHATSAPP,
} from './ports';
import { DevSupportDesk, ZammadDesk } from './support-desk';
import { VapidPushSender } from './push';
import { Dialog360Sender, DevWhatsAppSender } from './whatsapp';
import { StripePayments } from './stripe-payments';

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
              : new BrevoMailer(env.BREVO_API_KEY, env.MAIL_FROM),
        },
        {
          provide: CAPTCHA,
          useFactory: () =>
            fakes.captcha
              ? new DevCaptcha()
              : new FriendlyCaptcha(env.FRIENDLY_CAPTCHA_API_KEY, env.FRIENDLY_CAPTCHA_SITEKEY),
        },
        {
          provide: PAYMENTS,
          inject: [VALKEY],
          useFactory: (valkey: Redis) =>
            fakes.payments
              ? new FakePayments(valkey, env.WEB_BASE_URL)
              : new StripePayments(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET, {
                  plus: env.STRIPE_PRICE_PLUS_YEARLY,
                  premium: env.STRIPE_PRICE_PREMIUM_YEARLY,
                }),
        },
        {
          provide: PRINT,
          useFactory: () => {
            if (!fakes.print) throw new Error(`Unknown PRINT_PARTNER "${env.PRINT_PARTNER}"`);
            return new FakePrintPartner(
              env.PRINT_OUTBOX_DIR || join(repoRoot(), '.local', 'print-outbox'),
            );
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
          provide: WHATSAPP,
          inject: [VALKEY, LOGGER],
          useFactory: (valkey: Redis, logger: Logger) =>
            fakes.whatsapp
              ? new DevWhatsAppSender(valkey, logger)
              : new Dialog360Sender(env.D360_API_KEY, env.D360_BASE_URL),
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
          inject: [VALKEY, LOGGER],
          useFactory: (valkey: Redis, logger: Logger) =>
            fakes.support
              ? new DevSupportDesk(valkey, logger)
              : new ZammadDesk(env.ZAMMAD_URL, env.ZAMMAD_TOKEN, env.ZAMMAD_GROUP),
        },
      ],
      exports: [MAILER, CAPTCHA, PAYMENTS, PRINT, PUSH, WHATSAPP, AUDIT_BUCKET, SUPPORT_DESK],
    };
  }
}
