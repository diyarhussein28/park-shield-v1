import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { LettersOverview, type LetterList } from './overview';

// Kept here, not in the client module: a server page cannot read values from 'use client' files.
const LETTER_FILTERS = ['new', 'downloaded', 'sent', 'all'] as const;

export const dynamic = 'force-dynamic';

export default async function WelcomeLettersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const me = await requireStaff();
  const { status: raw } = await searchParams;
  const filter = LETTER_FILTERS.find((f) => f === raw) ?? 'new';
  const query = filter === 'all' ? '' : `?status=${filter}`;
  const res = await opsServer<LetterList>(`/ops/v1/welcome-letters${query}`);
  return <LettersOverview me={me} filter={filter} data={res.data} />;
}
