export class OpsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { error?: string } | null,
  ) {
    super(body?.error ?? `HTTP ${status}`);
  }
}

function csrf(): string | undefined {
  const m = /(?:^|;\s*)ps_ops_csrf=([^;]+)/.exec(document.cookie);
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
