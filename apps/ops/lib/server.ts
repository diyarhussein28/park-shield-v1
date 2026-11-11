import { cookies } from 'next/headers';

const API = `http://${process.env.OPS_API_HOST ?? '127.0.0.1'}:${process.env.OPS_API_PORT ?? '4001'}`;

export interface StaffMe {
  email: string;
  name: string | null;
  roles: string[];
  permissions: string[];
  sessionExpiresAt: string;
}

/** Server-side call to api-ops with the staff cookies of the incoming request. */
export async function opsServer<T>(path: string): Promise<{ status: number; data: T | null }> {
  const cookie = (await cookies()).toString();
  try {
    const res = await fetch(`${API}${path}`, {
      headers: cookie ? { cookie } : {},
      cache: 'no-store',
    });
    return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
  } catch {
    return { status: 503, data: null };
  }
}
