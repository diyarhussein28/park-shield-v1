import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import type { Partners } from '../partner/partners';
import { PromosView, type PromoList } from './promos';

export const dynamic = 'force-dynamic';

export default async function PromosPage() {
  const me = await requireStaff();
  const [promos, partners] = await Promise.all([
    opsServer<PromoList>('/ops/v1/promo-codes'),
    opsServer<Partners>('/ops/v1/partners'),
  ]);
  return <PromosView me={me} initial={promos.data} partners={partners.data?.partners ?? []} />;
}
