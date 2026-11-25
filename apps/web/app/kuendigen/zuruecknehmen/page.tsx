import { RevokeFlow } from './revoke-flow';
import { pageMetadata } from '@/lib/meta';

export const generateMetadata = () => pageMetadata('meta.kuendigenRevoke');

export default function RevokePage() {
  return <RevokeFlow />;
}
