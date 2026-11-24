import type { FastifyReply } from 'fastify';
import type { Env } from '../config/env';

/** Plain names: local development and the CI run on http://localhost. */
export const SESSION_COOKIE = 'ps_session';
export const CSRF_COOKIE = 'ps_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const SESSION_TTL_DAYS = 30;

/**
 * ASVS 3.4.4: on an https production origin the session and CSRF cookies carry the `__Host-` prefix.
 * The browser then only accepts them with `Secure`, `Path=/` and no `Domain`, so no other host (a
 * subdomain such as ops. or test., or a plain-http page) can set or overwrite them (no session
 * fixation through a sibling host). Browsers refuse `__Host-` cookies on plain http, which is why
 * local development and the CI run (http://localhost) keep the plain names.
 */
export const HOST_PREFIX = '__Host-';

export interface CookieSet {
  session: string;
  csrf: string;
  secure: boolean;
  /** The other spelling (plain while prefixed): cleared at sign-in and sign-out, never read. */
  legacy: { session: string; csrf: string } | null;
}

export function hostPrefixed(env: Pick<Env, 'NODE_ENV'>, baseUrl: string): boolean {
  return env.NODE_ENV === 'production' && baseUrl.startsWith('https://');
}

function cookieSet(
  env: Pick<Env, 'NODE_ENV'>,
  baseUrl: string,
  names: { session: string; csrf: string },
): CookieSet {
  const secure = env.NODE_ENV === 'production';
  if (!hostPrefixed(env, baseUrl)) return { ...names, secure, legacy: null };
  return {
    session: HOST_PREFIX + names.session,
    csrf: HOST_PREFIX + names.csrf,
    secure: true,
    legacy: names,
  };
}

/** The owner portal's cookies (website origin `WEB_BASE_URL`, which proxies `/v1` to the API). */
export const sessionCookies = (env: Pick<Env, 'NODE_ENV' | 'WEB_BASE_URL'>) =>
  cookieSet(env, env.WEB_BASE_URL, { session: SESSION_COOKIE, csrf: CSRF_COOKIE });

/** The back office's cookies (ops origin `OPS_BASE_URL`). */
export const opsCookies = (env: Pick<Env, 'NODE_ENV' | 'OPS_BASE_URL'>) =>
  cookieSet(env, env.OPS_BASE_URL, { session: 'ps_ops_session', csrf: 'ps_ops_csrf' });

type SameSite = 'lax' | 'strict';

export function writeCookies(
  reply: FastifyReply,
  names: CookieSet,
  value: { token: string; csrf: string; expiresAt?: Date },
  sameSite: SameSite,
): void {
  const base = {
    path: '/',
    sameSite,
    secure: names.secure,
    ...(value.expiresAt ? { expires: value.expiresAt } : {}),
  };
  reply.setCookie(names.session, value.token, { ...base, httpOnly: true });
  reply.setCookie(names.csrf, value.csrf, { ...base, httpOnly: false });
  // Switching to the prefix: an old plain cookie must not linger next to the new one.
  if (names.legacy) {
    reply.clearCookie(names.legacy.session, { path: '/' });
    reply.clearCookie(names.legacy.csrf, { path: '/' });
  }
}

export function eraseCookies(reply: FastifyReply, names: CookieSet, sameSite: SameSite): void {
  const base = { path: '/', sameSite, secure: names.secure };
  reply.clearCookie(names.session, base);
  reply.clearCookie(names.csrf, base);
  if (names.legacy) {
    reply.clearCookie(names.legacy.session, { path: '/' });
    reply.clearCookie(names.legacy.csrf, { path: '/' });
  }
}

// SameSite=Lax, not Strict: users following links from e-mails and notifications must stay signed in
// (02-architecture §9.2). CSRF is covered by the double-submit token checked in CsrfGuard.
export function setSessionCookies(
  reply: FastifyReply,
  session: { token: string; csrf: string; expiresAt: Date },
  env: Pick<Env, 'NODE_ENV' | 'WEB_BASE_URL'>,
): void {
  writeCookies(reply, sessionCookies(env), session, 'lax');
}

export function clearSessionCookies(
  reply: FastifyReply,
  env: Pick<Env, 'NODE_ENV' | 'WEB_BASE_URL'>,
): void {
  eraseCookies(reply, sessionCookies(env), 'lax');
}
