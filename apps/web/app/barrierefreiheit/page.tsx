import { LegalPage } from '@/components/legal-page';
import { pageMetadata } from '@/lib/meta';

export const generateMetadata = () => pageMetadata('meta.barrierefreiheit');

export default function Page() {
  return <LegalPage slug="barrierefreiheit" />;
}
