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
  'POST /v1/auth/passkey/login/options': { kind: 'rate', limits: ['auth.ip'] },
  'POST /v1/auth/passkey/login/verify': { kind: 'rate', limits: ['auth.ip'] },
  'POST /v1/billing/cancel-request': {
    kind: 'rate',
    limits: ['cancel.ip', 'cancel.email'],
    captcha: true,
  },
  'POST /v1/webhooks/stripe': { kind: 'signed', what: 'Stripe-Signature (HMAC over the raw body)' },
  'POST /v1/webhooks/whatsapp/:secret': { kind: 'signed', what: 'shared secret in the path' },
  'POST /v1/business-waitlist': {
    kind: 'rate',
    limits: ['waitlist.ip', 'waitlist.email'],
    captcha: true,
  },
  'POST /v1/business-waitlist/confirm': { kind: 'token', what: 'double opt-in token, 256 bit' },
  'GET /v1/scan/:code': { kind: 'rate', limits: ['scan.not_found'] },
  'POST /v1/scan/:code/alerts': {
    kind: 'rate',
    limits: ['alert.scanner_vehicle', 'alert.scanner_global', 'alert.vehicle'],
    captcha: true,
  },
  'POST /v1/scan/:code/report-fake': { kind: 'rate', limits: ['report.fake_ip'], captcha: true },
  'POST /v1/alerts/:id/waiting': { kind: 'token', what: 'status token from the scan, 256 bit' },
  'GET /v1/alerts/:id/status': { kind: 'token', what: 'status token from the scan, 256 bit' },
  'POST /v1/ack/preview': { kind: 'token', what: 'HMAC reply token' },
  'POST /v1/ack': { kind: 'token', what: 'HMAC reply token' },
  'POST /v1/emergency-contact-invitations/view': { kind: 'token', what: 'consent token, 256 bit' },
  'POST /v1/emergency-contact-invitations/decide': {
    kind: 'token',
    what: 'consent token, 256 bit',
  },
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
