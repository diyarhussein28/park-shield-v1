import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { ReviewQueue, type ReviewData } from './review';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const me = await requireStaff();
  const res = await opsServer<ReviewData>('/ops/v1/abuse/reviews');
  return <ReviewQueue me={me} initial={res.data} />;
}
