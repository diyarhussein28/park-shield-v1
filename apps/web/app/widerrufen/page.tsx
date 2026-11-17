import { serverApi, type Me, type SubscriptionSummary } from '@/lib/api-server';
import { WithdrawFlow } from './withdraw-flow';

export const metadata = { title: 'Vertrag widerrufen' };
export const dynamic = 'force-dynamic';

/** § 356a BGB: reached from the "Vertrag widerrufen" button; signed-in owners get it pre-filled. */
export default async function WithdrawPage() {
  const [sub, me] = await Promise.all([
    serverApi<{ subscription: SubscriptionSummary | null }>('/v1/billing/subscription'),
    serverApi<Me>('/v1/me'),
  ]);
  const live = sub.status === 200 ? sub.data?.subscription : null;
  return (
    <WithdrawFlow
      prefill={
        live?.withdrawalOpenUntil && me.data
          ? { contractRef: live.contractNo ?? '', email: me.data.email }
          : null
      }
    />
  );
}
