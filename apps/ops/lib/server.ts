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

/** GET /ops/v1/overview: counts per area, null where the staff member lacks the permission. */
export interface Overview {
  customers: { total: number; activeSubscriptions: number; newLast7Days: number } | null;
  alerts: {
    today: number;
    last7Days: number;
    urgentLast7Days: number;
    unanswered7Days: number;
  } | null;
  dsr: { open: number; dueSoon: number } | null;
  abuse: { openReports: number } | null;
  review: { pending: number } | null;
  orders: { toProduce: number; inProduction: number } | null;
  breakGlass: { waitingForApproval: number } | null;
  providers: { warnings: number; critical: number } | null;
  /** In-house NFC stickers ready to pack, and whether that is below `stock.low_threshold`. */
  stock?: { ready: number; low: boolean } | null;
}
