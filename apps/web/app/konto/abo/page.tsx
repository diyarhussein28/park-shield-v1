import { redirect } from 'next/navigation';
import {
  serverApi,
  type CreditNote,
  type InvoiceSummary,
  type Me,
  type SubscriptionSummary,
} from '@/lib/api-server';
import { AboView } from './abo-view';

export const metadata = { title: 'Abo und Konto', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AboPage() {
  const me = await serverApi<Me>('/v1/me');
  if (me.status === 401 || !me.data) redirect('/anmelden');
  const [sub, invoices, credit] = await Promise.all([
    serverApi<{ subscription: SubscriptionSummary | null }>('/v1/billing/subscription'),
    serverApi<{ invoices: InvoiceSummary[] }>('/v1/billing/invoices'),
    serverApi<{ creditNotes: CreditNote[] }>('/v1/billing/credit-notes'),
  ]);
  return (
    <AboView
      me={me.data}
      subscription={sub.data?.subscription ?? null}
      invoices={invoices.data?.invoices ?? []}
      creditNotes={credit.data?.creditNotes ?? []}
    />
  );
}
