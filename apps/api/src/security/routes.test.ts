import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env';
import { RATE_LIMITS, type RateLimitName } from '../core/rate-limit.service';
import { DevController } from '../dev/dev.controller';
import { publicRoutes as routesOf } from './route-list';

/**
 * Every public-API route without a customer session, and what protects it (ASVS 2.2.1, 4.1, 11.1).
 * A new unauthenticated route fails this test until it is listed here with its control.
 */
type Control =
  | { kind: 'rate'; limits: RateLimitName[]; captcha?: true }
  | { kind: 'token'; what: string }
  | { kind: 'signed'; what: string }
  | { kind: 'static' };
const PUBLIC: Record<string, Control> = {
  'GET /v1/health': { kind: 'static' },
  'GET /v1/ready': { kind: 'static' },
  'GET /v1/plans': { kind: 'static' },
  'POST /v1/auth/magic-link': {
    kind: 'rate',
    limits: ['magic_link.ip', 'magic_link.email'],
    captcha: true,
  },
  'POST /v1/auth/magic-link/consume': { kind: 'rate', limits: ['auth.ip'] },
  // The native app has no captcha widget; the same per-network and per-address limits apply.
  'POST /v1/app/auth/magic-link': { kind: 'rate', limits: ['magic_link.ip', 'magic_link.email'] },
  'POST /v1/app/auth/consume': { kind: 'rate', limits: ['auth.ip'] },
  // App sign-in by e-mail: code (5 tries per code + per network) and the bridge page's link.
  'POST /v1/auth/email/request': { kind: 'rate', limits: ['magic_link.ip', 'magic_link.email'] },
  'POST /v1/auth/email/verify-code': { kind: 'rate', limits: ['auth.code_ip'] },
  'POST /v1/auth/email/verify-link': { kind: 'rate', limits: ['auth.ip'] },
  'GET /v1/auth/email/return/:rid': { kind: 'rate', limits: ['auth.ip'] },
  'POST /v1/auth/passkey/login/options': { kind: 'rate', limits: ['auth.ip'] },
  'POST /v1/auth/passkey/login/verify': { kind: 'rate', limits: ['auth.ip'] },
  // § 312k / § 356a BGB: no captcha or login before a cancellation or withdrawal; IP-hash limit only.
  'POST /v1/legal/cancellations': { kind: 'rate', limits: ['cancel.ip'] },
  'POST /v1/legal/cancellations/revoke': { kind: 'token', what: 'revoke token, 256 bit' },
  'POST /v1/legal/withdrawals': { kind: 'rate', limits: ['withdrawal.ip'] },
  'GET /v1/legal/context': { kind: 'static' },
  'GET /v1/legal/checkout-texts': { kind: 'static' },
  'POST /v1/webhooks/stripe': { kind: 'signed', what: 'Stripe-Signature (HMAC over the raw body)' },
  'POST /v1/webhooks/twilio/sms': {
    kind: 'signed',
    what: 'X-Twilio-Signature (HMAC-SHA1 with the auth token)',
  },
  'GET /v1/scan/:code': { kind: 'rate', limits: ['scan.not_found'] },
  'POST /v1/scan/:code/alerts': {
    kind: 'rate',
    limits: [
      'alert.scanner_vehicle',
      'alert.scanner_vehicle_day',
      'alert.scanner_global',
      'alert.vehicle',
      'alert.phone_vehicle',
      'alert.phone_vehicle_day',
    ],
    captcha: true,
  },
  'POST /v1/scan/:code/verify/start': {
    kind: 'rate',
    limits: ['verify.otp_scanner', 'verify.otp_phone', 'verify.otp_country'],
    captcha: true,
  },
  'POST /v1/scan/:code/verify/check': { kind: 'rate', limits: ['verify.check_phone'] },
  'POST /v1/scan/:code/report-fake': { kind: 'rate', limits: ['report.fake_ip'], captcha: true },
  'POST /v1/alerts/:id/waiting': { kind: 'token', what: 'status token from the scan, 256 bit' },
  'GET /v1/alerts/:id/status': { kind: 'token', what: 'status token from the scan, 256 bit' },
  // Phase 2 alert photos: the owner's view link (HMAC token, 256 bit) plus a limit per network.
  'GET /v1/alerts/view/:token': { kind: 'rate', limits: ['alert_view.ip'] },
  'GET /v1/alerts/media/:mediaId': { kind: 'rate', limits: ['alert_view.ip'] },
  'POST /v1/alerts/view/:token/report-abuse': { kind: 'rate', limits: ['alert_view.ip'] },
  'POST /v1/ack/preview': { kind: 'token', what: 'HMAC reply token' },
  'POST /v1/ack': { kind: 'token', what: 'HMAC reply token' },
  'POST /v1/emergency-contact-invitations/view': { kind: 'token', what: 'consent token, 256 bit' },
  'POST /v1/emergency-contact-invitations/decide': {
    kind: 'token',
    what: 'consent token, 256 bit',
  },
  'POST /v1/emergency-contact-invitations/accept': {
    kind: 'token',
    what: 'consent token, 256 bit',
  },
  'POST /v1/emergency-contact-invitations/decline': {
    kind: 'token',
    what: 'consent token, 256 bit',
  },
  // A trusted contact's escalation link (/k/…): "Ich komme" and opt-out.
  'POST /v1/contacts/alert/preview': { kind: 'token', what: 'HMAC contact link token, 256 bit' },
  'POST /v1/contacts/alert/ack': { kind: 'token', what: 'HMAC contact link token, 256 bit' },
  'POST /v1/contacts/opt-out': { kind: 'token', what: 'HMAC contact link token, 256 bit' },
  'POST /v1/me/dsr/confirm': { kind: 'token', what: 'HMAC request token' },
  'POST /v1/me/deletion/cancel': { kind: 'token', what: 'HMAC request token' },
  'GET /v1/claim/:code': { kind: 'rate', limits: ['scan.not_found'] },
  'POST /v1/support/contact': {
    kind: 'rate',
    limits: ['support.ip', 'support.email'],
    captcha: true,
  },
};

describe('public API surface (US-45, ASVS 2.2 / 4.1 / 11.1)', () => {
  const env = loadEnv();

  it('every route without a session is listed with the control that protects it', () => {
    const open = routesOf(env)
      .filter((r) => !r.session && r.controller !== DevController)
      .map((r) => r.route)
      .sort();
    expect(open).toEqual(Object.keys(PUBLIC).sort());
    for (const c of Object.values(PUBLIC))
      if (c.kind === 'rate') for (const l of c.limits) expect(RATE_LIMITS[l], l).toBeDefined();
  });

  it('the local dev helpers are never registered in production', () => {
    const prod = { ...env, NODE_ENV: 'production' as const };
    expect(routesOf(prod).some((r) => r.controller === DevController)).toBe(false);
    expect(
      routesOf({ ...env, NODE_ENV: 'development' }).some((r) => r.controller === DevController),
    ).toBe(true);
  });
});
