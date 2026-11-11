import { requireStaff } from '@/lib/page';
import { CustomerSearch } from './search';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  return <CustomerSearch me={await requireStaff()} />;
}
