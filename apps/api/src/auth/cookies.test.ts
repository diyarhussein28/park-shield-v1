import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import {
  clearSessionCookies,
  opsCookies,
  sessionCookies,
  setSessionCookies,
  writeCookies,
} from './cookies';
import { CsrfGuard, SessionGuard } from './guards';
import type { SessionService } from './session.service';

const env = (over: Partial<Env>) =>
  ({
    NODE_ENV: 'production',
    WEB_BASE_URL: 'https://park-shield.de',
    OPS_BASE_URL: 'https://ops.park-shield.de',
    ...over,
  }) as Env;

function fakeReply() {
  const set: { name: string; opts: Record<string, unknown> }[] = [];
  const cleared: string[] = [];
  const reply = {
    setCookie: vi.fn((name: string, _v: string, opts: Record<string, unknown>) =>
      set.push({ name, opts }),
    ),
    clearCookie: vi.fn((name: string) => cleared.push(name)),
  } as unknown as FastifyReply;
  return { reply, set, cleared };
}

function ctx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('__Host- cookie prefix (ASVS 3.4.4)', () => {
  it('uses the prefix only on an https production origin', () => {
    expect(sessionCookies(env({}))).toMatchObject({
      session: '__Host-ps_session',
      csrf: '__Host-ps_csrf',
      secure: true,
      legacy: { session: 'ps_session', csrf: 'ps_csrf' },
    });
    expect(opsCookies(env({}))).toMatchObject({
      session: '__Host-ps_ops_session',
      csrf: '__Host-ps_ops_csrf',
    });
    // CI and local development run on http://localhost: browsers refuse __Host- cookies there.
    expect(sessionCookies(env({ WEB_BASE_URL: 'http://localhost:3000' }))).toMatchObject({
      session: 'ps_session',
      csrf: 'ps_csrf',
      secure: true,
      legacy: null,
    });
    expect(sessionCookies(env({ NODE_ENV: 'development' }))).toMatchObject({
      session: 'ps_session',
      secure: false,
    });
  });

  it('sets Secure, Path=/ and no Domain, and clears the old plain cookies', () => {
    const { reply, set, cleared } = fakeReply();
    const expiresAt = new Date(Date.now() + 86_400_000);
    setSessionCookies(reply, { token: 't'.repeat(43), csrf: 'c'.repeat(43), expiresAt }, env({}));
    expect(set.map((s) => s.name)).toEqual(['__Host-ps_session', '__Host-ps_csrf']);
    for (const s of set) {
      expect(s.opts).toMatchObject({ path: '/', secure: true, sameSite: 'lax' });
      expect(s.opts).not.toHaveProperty('domain');
    }
    expect(set[0]!.opts.httpOnly).toBe(true);
    expect(set[1]!.opts.httpOnly).toBe(false);
    expect(cleared).toEqual(['ps_session', 'ps_csrf']);

    const out = fakeReply();
    clearSessionCookies(out.reply, env({}));
    expect(out.cleared).toEqual(['__Host-ps_session', '__Host-ps_csrf', 'ps_session', 'ps_csrf']);

    const ops = fakeReply();
    writeCookies(ops.reply, opsCookies(env({})), { token: 'a', csrf: 'b' }, 'strict');
    expect(ops.set.map((s) => [s.name, s.opts.sameSite])).toEqual([
      ['__Host-ps_ops_session', 'strict'],
      ['__Host-ps_ops_csrf', 'strict'],
    ]);
  });

  it('the guards read only the prefixed cookies in production', async () => {
    const resolve = vi.fn(async (token?: string) =>
      token === 'good' ? ({ userId: 'u' } as never) : null,
    );
    const guard = new SessionGuard({ resolve } as unknown as SessionService, env({}));
    await expect(
      guard.canActivate(ctx({ cookies: { '__Host-ps_session': 'good' }, headers: {} })),
    ).resolves.toBe(true);
    // A plain cookie (e.g. planted by a sibling host) is not a session.
    await expect(
      guard.canActivate(ctx({ cookies: { ps_session: 'good' }, headers: {} })),
    ).rejects.toThrow();

    const csrf = new CsrfGuard(new Reflector(), env({}));
    const post = (cookies: Record<string, string>, header?: string) =>
      ctx({
        method: 'POST',
        cookies,
        headers: header ? { 'x-csrf-token': header } : {},
      });
    expect(
      csrf.canActivate(post({ '__Host-ps_session': 's', '__Host-ps_csrf': 'tok' }, 'tok')),
    ).toBe(true);
    expect(() =>
      csrf.canActivate(post({ '__Host-ps_session': 's', ps_csrf: 'tok' }, 'tok')),
    ).toThrow();
  });
});
