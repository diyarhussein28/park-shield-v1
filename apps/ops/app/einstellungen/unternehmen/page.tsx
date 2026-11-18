import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { CompanyForm, type CompanyView } from './company-form';

export const dynamic = 'force-dynamic';

export default async function CompanyPage() {
  const me = await requireStaff();
  const res = await opsServer<CompanyView>('/ops/v1/settings/company');
  return <CompanyForm me={me} initial={res.data} />;
}
