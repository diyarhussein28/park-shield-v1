import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { OrderDetail, type OrderData } from './order-detail';

export const dynamic = 'force-dynamic';

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  const { id } = await params;
  const res = await opsServer<OrderData>(`/ops/v1/orders/${encodeURIComponent(id)}`);
  if (res.status === 404 || res.status === 400) notFound();
  return <OrderDetail me={me} id={id} initial={res.data} />;
}
