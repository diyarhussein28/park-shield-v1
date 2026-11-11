import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { AccessReview, type ReviewData } from './review';

export const dynamic = 'force-dynamic';

export default async function AccessReviewPage() {
  const me = await requireStaff();
  const res = await opsServer<ReviewData>('/ops/v1/staff/review');
  return <AccessReview me={me} initial={res.data} />;
}
