import { AlertView } from './alert-view';
import { pageMetadata } from '@/lib/meta';

// The link comes from the owner's notification: never indexed, never cached, no referrer (global).
export const generateMetadata = () =>
  pageMetadata('meta.alertPhotos', { robots: { index: false, follow: false } });
export const dynamic = 'force-dynamic';

/** Phase 2 alert photos: one view link per alert, the same in every channel (`/v/<token>`). */
export default async function AlertViewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AlertView token={token} />;
}
