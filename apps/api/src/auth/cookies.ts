import type { FastifyReply } from 'fastify';

export const SESSION_COOKIE = 'ps_session';
export const CSRF_COOKIE = 'ps_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const SESSION_TTL_DAYS = 30;

// SameSite=Lax, not Strict: users following links from e-mails and notifications must stay signed in
// (02-architecture §9.2). CSRF is covered by the double-submit token checked in CsrfGuard.
export function setSessionCookies(
  reply: FastifyReply,
  session: { token: string; csrf: string; expiresAt: Date },
  secure: boolean,
): void {
  const base = { path: '/', sameSite: 'lax' as const, secure, expires: session.expiresAt };
  reply.setCookie(SESSION_COOKIE, session.token, { ...base, httpOnly: true });
  reply.setCookie(CSRF_COOKIE, session.csrf, { ...base, httpOnly: false });
}

export function clearSessionCookies(reply: FastifyReply, secure: boolean): void {
  const base = { path: '/', sameSite: 'lax' as const, secure };
  reply.clearCookie(SESSION_COOKIE, base);
  reply.clearCookie(CSRF_COOKIE, base);
}
