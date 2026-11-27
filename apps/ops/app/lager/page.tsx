import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import type { Batches } from '../partner/partners';
import { StockView } from './stock';

export const dynamic = 'force-dynamic';

/** In-house NFC sticker stock (2026-11-27, docs/nfc-sticker-plan.md). */
export default async function StockPage() {
  const me = await requireStaff();
  const batches = await opsServer<Batches>('/ops/v1/batches');
  return <StockView me={me} batches={batches.data} />;
}
