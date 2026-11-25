import { LegalPage } from '@/components/legal-page';
import { pageMetadata } from '@/lib/meta';

export const generateMetadata = () => pageMetadata('meta.sicherheit');

export default function Page() {
  return <LegalPage slug="sicherheit" />;
}
