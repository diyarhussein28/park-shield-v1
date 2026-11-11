import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { ZammadSummary, type Summary } from './summary';

export const dynamic = 'force-dynamic';

export default async function ZammadSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const me = await requireStaff();
  const { email = '' } = await searchParams;
  const res = await opsServer<Summary>(
    `/ops/v1/customers/summary?email=${encodeURIComponent(email)}`,
  );
  return <ZammadSummary me={me} data={res.data} />;
}
