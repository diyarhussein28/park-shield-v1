import { LegalPage } from '@/components/legal-page';
import { legalContext } from '@/lib/api-server';
import { pageMetadata } from '@/lib/meta';

export const generateMetadata = () => pageMetadata('meta.widerruf');

export default async function Page() {
  return <LegalPage slug="widerruf" context={await legalContext()} />;
}
