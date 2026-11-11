import { serverApi, type SubscriptionSummary } from '@/lib/api-server';
import { CancelFlow } from './cancel-flow';

export const metadata = { title: 'Verträge hier kündigen' };
export const dynamic = 'force-dynamic';

export default async function CancelPage() {
  const sub = await serverApi<{ subscription: SubscriptionSummary | null }>(
    '/v1/billing/subscription',
  );
  const live = sub.status === 200 ? sub.data?.subscription : null;
  return (
    <CancelFlow
      signedInContract={live && !live.cancelAtPeriodEnd ? (live.contractNo ?? '') : null}
    />
  );
}
