import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { Customer360, type CustomerView } from './customer-360';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  const { id } = await params;
  const res = await opsServer<CustomerView>(`/ops/v1/customers/${encodeURIComponent(id)}`);
  if (!res.data) notFound();
  return <Customer360 me={me} data={res.data} />;
}
