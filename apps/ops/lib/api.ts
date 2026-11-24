export class OpsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { error?: string } | null,
  ) {
    super(body?.error ?? `HTTP ${status}`);
  }
}

/** `__Host-ps_ops_csrf` on https (apps/api/src/auth/cookies.ts), wins over a stale plain cookie. */
function csrf(): string | undefined {
  const m =
    /(?:^|;\s*)__Host-ps_ops_csrf=([^;]+)/.exec(document.cookie) ??
    /(?:^|;\s*)ps_ops_csrf=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]!) : undefined;
}

/** Browser calls to the same-origin ops API. A 401 means the 30-min session ended: back to sign-in. */
export async function opsApi<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = csrf();
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    credentials: 'same-origin',
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { 'x-csrf-token': token } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => null)) as T | null;
  if (res.status === 401 && !path.includes('/auth/')) {
    window.location.assign('/anmelden?abgelaufen=1');
  }
  if (!res.ok) throw new OpsApiError(res.status, data as OpsApiError['body']);
  return data as T;
}

/** POST that answers with a file (e.g. a combined PDF): saved through a temporary link. */
export async function opsDownload(
  path: string,
  body: unknown,
  fallbackName: string,
): Promise<void> {
  const token = csrf();
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- filename="..." header pattern is linear (negated class, no nesting)
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) },
    body: JSON.stringify(body),
  });
  if (res.status === 401) window.location.assign('/anmelden?abgelaufen=1');
  if (!res.ok) throw new OpsApiError(res.status, (await res.json().catch(() => null)) as null);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name ?? fallbackName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** multipart/form-data upload with the CSRF header (logo and signature images). */
export async function opsUpload<T>(path: string, form: FormData): Promise<T> {
  const token = csrf();
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: token ? { 'x-csrf-token': token } : {},
    body: form,
  });
  const data = (await res.json().catch(() => null)) as T | null;
  if (res.status === 401) window.location.assign('/anmelden?abgelaufen=1');
  if (!res.ok) throw new OpsApiError(res.status, data as OpsApiError['body']);
  return data as T;
}
