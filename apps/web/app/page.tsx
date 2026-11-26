import { Landing } from '@/components/landing';

// „Bin gleich zurück“ is listed on the home page only while the feature is on: a runtime setting of the
// server (VEHICLE_STATUS_ENABLED, the same variable the API reads), not a build-time one.
export const dynamic = 'force-dynamic';

export default function Home() {
  return <Landing beRightBack={process.env.VEHICLE_STATUS_ENABLED === 'true'} />;
}
