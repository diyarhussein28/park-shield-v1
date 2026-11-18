import { notFound } from 'next/navigation';
import type { LettersView } from '@/components/welcome-letters';
import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { Customer360, type CustomerView } from './customer-360';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  const { id } = await params;
  const path = `/ops/v1/customers/${encodeURIComponent(id)}`;
  const [res, letters] = await Promise.all([
    opsServer<CustomerView>(path),
    me.permissions.includes('letters.print')
      ? opsServer<LettersView>(`${path}/welcome-letters`)
      : Promise.resolve({ data: null }),
  ]);
  if (!res.data) notFound();
  return <Customer360 me={me} data={res.data} letters={letters.data} />;
}
