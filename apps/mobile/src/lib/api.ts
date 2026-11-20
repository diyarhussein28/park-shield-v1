import { API_URL } from './config';
import { getSession } from './session';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { error?: string; [k: string]: unknown } | null,
  ) {
    super(body?.error ?? `HTTP ${status}`);
  }
}

/** Called when the API says the session is gone (expired, revoked): back to sign-in. */
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

/**
 * JSON requests to the ParkShield API with the session as bearer token (no cookies, so no CSRF token
 * is needed). Every response that is not 2xx throws ApiError.
 */
export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const token = init.auth === false ? null : await getSession();
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      accept: 'application/json',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => null)) as T | null;
  if (res.status === 401 && token) onUnauthorized?.();
  if (!res.ok) throw new ApiError(res.status, data as ApiError['body']);
  return data as T;
}

/** Headers for media requests (expo-image streams the photo with them; nothing is written to disk). */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getSession();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export const mediaUrl = (alertId: string, mediaId: string) =>
  `${API_URL}/v1/app/alerts/${alertId}/media/${mediaId}`;
