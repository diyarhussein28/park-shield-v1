import type { Translate } from '@parkshield/i18n';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { error?: string; retryAfterSeconds?: number } | null,
  ) {
    super(body?.error ?? `HTTP ${status}`);
  }
}

function csrfToken(): string | undefined {
  const m = /(?:^|;\s*)ps_csrf=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]!) : undefined;
}

export function hasSession(): boolean {
  return typeof document !== 'undefined' && csrfToken() !== undefined;
}

/** Browser calls to the same-origin /v1 API, with the double-submit CSRF header. */
export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const csrf = csrfToken();
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    credentials: 'same-origin',
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => null)) as T | null;
  if (!res.ok) throw new ApiError(res.status, data as ApiError['body']);
  return data as T;
}

/** POSTs and saves the response as a file (data export). Throws ApiError like api(). */
export async function downloadPost(path: string, filename: string): Promise<void> {
  const csrf = csrfToken();
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: csrf ? { 'x-csrf-token': csrf } : {},
  });
  if (!res.ok) {
    throw new ApiError(res.status, (await res.json().catch(() => null)) as ApiError['body']);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** User-facing message for an API error. */
export function errorText(err: unknown, t: Translate): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      const minutes = Math.max(1, Math.ceil((err.body?.retryAfterSeconds ?? 60) / 60));
      return t('auth.rateLimited', { minutes });
    }
    if (err.body?.error === 'captcha_failed') return t('auth.captchaFailed');
    if (err.body?.error === 'promo_invalid') return t('checkout.promoInvalid');
    if (err.body?.error === 'already_subscribed') return t('checkout.already');
  }
  return t('auth.genericError');
}
