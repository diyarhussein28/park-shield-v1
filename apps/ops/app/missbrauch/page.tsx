import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { AbuseCentre, type Blocks, type Patterns, type Reports } from './abuse-centre';

export const dynamic = 'force-dynamic';

export default async function AbusePage() {
  const me = await requireStaff();
  const [patterns, reports, blocks] = await Promise.all([
    opsServer<Patterns>('/ops/v1/abuse/patterns'),
    opsServer<Reports>('/ops/v1/abuse/reports?status=open'),
    opsServer<Blocks>('/ops/v1/abuse/blocks'),
  ]);
  return (
    <AbuseCentre me={me} patterns={patterns.data} reports={reports.data} blocks={blocks.data} />
  );
}
