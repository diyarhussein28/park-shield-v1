import { isTestEnvironment, type Env } from '../config/env';

/** Where the app is reached when no (allowed) return address was sent: the app's own scheme. */
export const DEFAULT_SIGN_IN_RETURN = 'parkshield://auth/callback';

const EXPO_GO = /^exps?:\/\/[\w.-]+(:\d{1,5})?\/--\/auth\/callback$/;

/**
 * The app's return address for the bridge page (`/auth/open`). Only exact addresses of this app are
 * accepted: its scheme, its Universal Link on the website, and Expo Go's `exp://<host>:<port>/--/…`
 * where test helpers may exist (never in real production). Anything else falls back to the default,
 * so the bridge page can never become an open redirect.
 */
export function signInReturn(
  requested: string | undefined,
  env: Pick<Env, 'NODE_ENV' | 'APP_ENV' | 'WEB_BASE_URL'>,
): string {
  if (!requested) return DEFAULT_SIGN_IN_RETURN;
  const allowed = [
    DEFAULT_SIGN_IN_RETURN,
    `${env.WEB_BASE_URL.replace(/\/$/, '')}/app/auth/callback`,
  ];
  if (allowed.includes(requested)) return requested;
  if (isTestEnvironment(env) && EXPO_GO.test(requested)) return requested;
  return DEFAULT_SIGN_IN_RETURN;
}
