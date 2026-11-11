import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { WordListsEditor, type Versions } from './editor';

export const dynamic = 'force-dynamic';

export default async function WordListsPage() {
  const me = await requireStaff();
  const res = await opsServer<Versions>('/ops/v1/abuse/word-lists');
  return <WordListsEditor me={me} initial={res.data} />;
}
