import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import type { CustomerView } from '../customer-360';
import { RefundTool, type RefundList } from './refund-tool';

export const dynamic = 'force-dynamic';

export default async function RefundPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ abo?: string; bestellung?: string }>;
}) {
  const me = await requireStaff();
  const { id } = await params;
  const { abo, bestellung } = await searchParams;
  const customer = await opsServer<CustomerView>(`/ops/v1/customers/${encodeURIComponent(id)}`);
  if (!customer.data) notFound();
  const sub = customer.data.subscriptions.find((s) => s.id === abo) ?? null;
  const order = customer.data.orders.find((o) => o.id === bestellung) ?? null;
  if (!sub && !order) notFound();
  const query = sub ? `subscriptionId=${sub.id}` : `orderId=${order!.id}`;
  const refunds = await opsServer<RefundList>(`/ops/v1/refunds?${query}`);
  return (
    <RefundTool
      me={me}
      customer={{ id, email: customer.data.customer.email }}
      subscription={sub}
      order={order}
      initial={refunds.data}
    />
  );
}
