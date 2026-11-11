import { notFound } from 'next/navigation';
import { DesignSystem } from './design-system';

export const metadata = { title: 'Design system', robots: { index: false } };

export default function DesignPage() {
  if (process.env.APP_ENV === 'production') notFound();
  return <DesignSystem />;
}
