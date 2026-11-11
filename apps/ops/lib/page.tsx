import { redirect } from 'next/navigation';
import { opsServer, type StaffMe } from './server';

/** Signed-in staff for a server page; redirects to sign-in after the 30-min idle timeout. */
export async function requireStaff(): Promise<StaffMe> {
  const me = await opsServer<StaffMe>('/ops/v1/me');
  if (me.status === 401 || !me.data) redirect('/anmelden');
  return me.data;
}
