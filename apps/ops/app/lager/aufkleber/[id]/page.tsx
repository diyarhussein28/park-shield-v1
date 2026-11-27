import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { StickerDetail, type StickerData } from './sticker';

export const dynamic = 'force-dynamic';

/** One in-house stock sticker: write, check and lock its NFC chip (2026-11-27, phase 2). */
export default async function StickerPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  const { id } = await params;
  const res = await opsServer<StickerData>(`/ops/v1/stickers/${encodeURIComponent(id)}`);
  if (res.status === 404 || res.status === 400) notFound();
  return <StickerDetail me={me} id={id} initial={res.data} />;
}
