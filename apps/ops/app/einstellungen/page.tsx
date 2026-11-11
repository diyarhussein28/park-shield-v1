import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { SettingsView, type SettingsData } from './settings';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const me = await requireStaff();
  const res = await opsServer<SettingsData>('/ops/v1/settings');
  return <SettingsView me={me} initial={res.data} />;
}
