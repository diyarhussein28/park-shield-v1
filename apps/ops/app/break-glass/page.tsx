import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { BreakGlassView, type BgList } from './break-glass-view';

export const dynamic = 'force-dynamic';

export default async function BreakGlassPage() {
  const me = await requireStaff();
  const res = await opsServer<BgList>('/ops/v1/break-glass');
  return <BreakGlassView me={me} initial={res.data ?? { requests: [] }} />;
}
