import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { OrdersView, type OrderList } from './orders';

export const dynamic = 'force-dynamic';

const FILTERS = ['open', 'attention', 'shipped', 'returned', 'all'] as const;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const me = await requireStaff();
  const { filter: raw } = await searchParams;
  const filter = FILTERS.find((f) => f === raw) ?? 'open';
  const res = await opsServer<OrderList>(`/ops/v1/orders?filter=${filter}`);
  return <OrdersView me={me} filter={filter} data={res.data} />;
}
