import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { isTestEnvironment, type Env } from '../config/env';

/**
 * Paying inside the native app: Stripe only returns to https pages, so it is sent to the website's
 * bounce page `/app/zurueck`, which hands the result back to the app (`parkshield://zurueck?…`).
 * The app names its own return address; only the app's scheme is accepted (Expo Go's `exp://` too,
 * in test environments), so the bounce page can never become an open redirect.
 */
export const AppReturn = z.string().trim().max(300).optional();

export function isAllowedAppReturn(url: string, env: Pick<Env, 'NODE_ENV' | 'APP_ENV'>): boolean {
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored allowlist pattern without nested quantifiers, input capped at 300 chars
  if (/^parkshield:\/\/[\w\-./]*(\?[\w\-.=&%]*)?$/.test(url)) return true;
  // Expo Go (development of the app) only where test helpers may exist, never in real production.
  return (
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored allowlist pattern without nested quantifiers, input capped at 300 chars
    isTestEnvironment(env) && /^exps?:\/\/[\w\-.:]+(\/[\w\-./]*)?(\/--\/[\w\-./]*)?$/.test(url)
  );
}

export type ReturnKind = 'checkout' | 'order' | 'portal';

/**
 * Where Stripe sends the customer back. Without `appReturn` (the website) the given web URLs; with it,
 * the bounce page, which adds `result` (and for a checkout Stripe's session id) and opens the app.
 */
export function returnUrls(
  env: Pick<Env, 'NODE_ENV' | 'APP_ENV' | 'WEB_BASE_URL'>,
  kind: ReturnKind,
  appReturn: string | undefined,
  web: { success: string; cancel: string },
): { success: string; cancel: string } {
  if (!appReturn) return web;
  if (!isAllowedAppReturn(appReturn, env)) {
    throw new BadRequestException({ error: 'app_return_invalid' });
  }
  const base = `${env.WEB_BASE_URL}/app/zurueck?to=${kind}&u=${encodeURIComponent(appReturn)}`;
  return {
    // Stripe fills in {CHECKOUT_SESSION_ID} itself (only in a checkout's success URL).
    success: `${base}&result=success${kind === 'checkout' ? '&session_id={CHECKOUT_SESSION_ID}' : ''}`,
    cancel: `${base}&result=canceled`,
  };
}
