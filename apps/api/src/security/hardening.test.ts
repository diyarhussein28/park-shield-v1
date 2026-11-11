import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildOpsApp } from '../apps';
import { loadEnv } from '../config/env';
import { createLogger } from '../core/logger';
import { allowedPushEndpoint } from '../providers/push';
import { createHarness, resetState, subscribe, type Harness } from '../test/harness';
import { publicRoutesForIdor } from './route-list';

let h: Harness;
let ops: NestFastifyApplication;

beforeAll(async () => {
  h = await createHarness();
  const env = loadEnv({
    BREVO_API_KEY: '',
    STRIPE_SECRET_KEY: '',
    D360_API_KEY: '',
    PRINT_PARTNER: '',
  });
  ops = await buildOpsApp(env, createLogger(env));
  await ops.init();
  await ops.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await ops.close();
  await h.close();
});
beforeEach(() => resetState(h));

describe('response headers (ASVS 14.4)', () => {
  it('every API response is nosniff, not cacheable, not frameable and has a deny-all CSP', async () => {
    for (const app of [h.app, ops]) {
      for (const url of ['/v1/health', '/v1/nope', '/ops/v1/health', '/ops/v1/me']) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.headers['x-content-type-options'], url).toBe('nosniff');
        expect(res.headers['cache-control'], url).toBe('no-store');
        expect(res.headers['x-frame-options'], url).toBe('DENY');
        expect(res.headers['content-security-policy'], url).toBe(
          "default-src 'none'; frame-ancestors 'none'",
        );
        expect(res.headers['x-powered-by'], url).toBeUndefined();
      }
    }
  });

  it('errors never contain stack traces or internals', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-link',
      headers: { 'content-type': 'application/json' },
      payload: '{"email": ',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toMatch(/at \w+ \(|node_modules|\.ts:\d+/);
  });
});

describe('outbound requests (ASVS 12.6.1, SSRF)', () => {
  it('push endpoints from browsers must belong to a real push service', () => {
    const prod = (u: string) => allowedPushEndpoint(u, false);
    expect(prod('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(prod('https://web.push.apple.com/QGx')).toBe(true);
    for (const bad of [
      'http://127.0.0.1:4000/v1/dev/push/x',
      'https://169.254.169.254/latest/meta-data',
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evil.example/fcm.googleapis.com',
      'https://10.0.0.5/push',
      'file:///etc/passwd',
      'not a url',
    ])
      expect(prod(bad), bad).toBe(false);
  });
});

describe('production configuration (ASVS 14.1)', () => {
  it('refuses to start in production while a provider would be faked', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'production', APP_ENV: 'production', STRIPE_SECRET_KEY: '' }),
    ).toThrow(/Missing provider keys in production: .*payments/);
  });
});

describe('anti-automation on sign-in (ASVS 2.2.1)', () => {
  it('limits completing a sign-in per network: magic link and passkey', async () => {
    const ip = '203.0.113.77';
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      const res = await h.app.inject({
        method: 'POST',
        url: i % 2 ? '/v1/auth/magic-link/consume' : '/v1/auth/passkey/login/options',
        remoteAddress: ip,
        payload: i % 2 ? { token: 'x'.repeat(43) } : {},
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 60)).not.toContain(429);
    expect(statuses[60]).toBe(429);
    // Another network is unaffected.
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: '/v1/auth/passkey/login/options',
          remoteAddress: '198.51.100.9',
        })
      ).statusCode,
    ).toBe(200);
  });

  it('limits staff sign-in and invitation attempts per peer', async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (
        await ops.inject({
          method: 'POST',
          url: i % 2 ? '/ops/v1/auth/invite/view' : '/ops/v1/auth/login/options',
          remoteAddress: '10.20.0.50',
          payload: i % 2 ? { token: 'y'.repeat(43) } : {},
        })
      ).statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('customers cannot reach each other’s data (ASVS 4.2.1, IDOR)', () => {
  it('another customer’s vehicle id answers 404 on every vehicle route', async () => {
    const a = await subscribe(h, 'a@example.de');
    const b = await subscribe(h, 'b@example.de');
    const v = (
      await h.app.inject({
        method: 'POST',
        url: '/v1/vehicles',
        headers: a.headers,
        payload: { nickname: 'Von A', plate: 'K-AA 1111' },
      })
    ).json();
    const routes = publicRoutesForIdor().filter((r) => r.path.startsWith('/v1/vehicles/:id'));
    expect(routes.length).toBeGreaterThan(10);
    for (const r of routes) {
      const res = await h.app.inject({
        method: r.method as 'GET',
        url: r.path.replace(':id', v.id),
        headers: b.headers,
        ...(r.method === 'GET' ? {} : { payload: {} }),
      });
      // 400 is the body check running first; it never reaches the vehicle. Never 2xx.
      expect([400, 404], `${r.method} ${r.path}`).toContain(res.statusCode);
    }
    const mine = await h.app.inject({
      method: 'GET',
      url: `/v1/vehicles/${v.id}`,
      headers: a.headers,
    });
    expect(mine.statusCode).toBe(200);
  });
});
