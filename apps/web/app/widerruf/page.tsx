import { LegalPage } from '@/components/legal-page';
import { legalContext } from '@/lib/api-server';

export const metadata = { title: 'Widerrufsbelehrung' };

export default async function Page() {
  return <LegalPage slug="widerruf" context={await legalContext()} />;
}
