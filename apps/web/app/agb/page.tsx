import { LegalPage } from '@/components/legal-page';
import { legalContext } from '@/lib/api-server';

export const metadata = { title: 'AGB' };

export default async function Page() {
  return <LegalPage slug="agb" context={await legalContext()} />;
}
