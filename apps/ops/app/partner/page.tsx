import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { PartnersView, type Batches, type Partners, type Promos } from './partners';

export const dynamic = 'force-dynamic';

export default async function PartnersPage() {
  const me = await requireStaff();
  const [partners, batches, promos] = await Promise.all([
    opsServer<Partners>('/ops/v1/partners'),
    opsServer<Batches>('/ops/v1/batches'),
    opsServer<Promos>('/ops/v1/promo-codes'),
  ]);
  return (
    <PartnersView me={me} partners={partners.data} batches={batches.data} promos={promos.data} />
  );
}
