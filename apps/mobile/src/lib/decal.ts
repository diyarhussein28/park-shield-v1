import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { authHeaders } from './api';
import { API_URL } from './config';

/**
 * The free self-print files (OW-04, „Selbst drucken – kostenlos“): the 80 × 80 mm PDF with cut marks,
 * a 300 dpi PNG and the SVG, each rendered by the API from the vehicle's current code.
 */
export type DecalFile = 'pdf' | 'png' | 'svg';

const FILES: Record<DecalFile, { path: string; mimeType: string; UTI: string; ext: string }> = {
  pdf: { path: 'decal.pdf', mimeType: 'application/pdf', UTI: 'com.adobe.pdf', ext: 'pdf' },
  png: { path: 'decal.png', mimeType: 'image/png', UTI: 'public.png', ext: 'png' },
  svg: {
    path: 'decal-download.svg',
    mimeType: 'image/svg+xml',
    UTI: 'public.svg-image',
    ext: 'svg',
  },
};

/** Downloads a decal file with the session into a temporary file, used, then deleted again. */
async function withDecalFile(
  vehicleId: string,
  kind: DecalFile,
  use: (file: File) => Promise<void>,
): Promise<void> {
  const res = await fetch(`${API_URL}/v1/vehicles/${vehicleId}/${FILES[kind].path}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const file = new File(Paths.cache, `parkshield-aufkleber-${Date.now()}.${FILES[kind].ext}`);
  try {
    file.write(new Uint8Array(await res.arrayBuffer()));
    await use(file);
  } finally {
    if (file.exists) file.delete();
  }
}

/**
 * „Teilen oder sichern“: the share sheet (save to Files or Photos, AirDrop, mail). The temporary file
 * is deleted again afterwards.
 */
export async function shareDecalFile(vehicleId: string, kind: DecalFile): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('sharing_unavailable');
  const { mimeType, UTI } = FILES[kind];
  await withDecalFile(vehicleId, kind, (file) => Sharing.shareAsync(file.uri, { mimeType, UTI }));
}

export const shareDecalPdf = (vehicleId: string) => shareDecalFile(vehicleId, 'pdf');

/** „Drucken“: the system print dialog with the PDF (AirPrint / Android print service). */
export async function printDecalPdf(vehicleId: string): Promise<void> {
  await withDecalFile(vehicleId, 'pdf', (file) => Print.printAsync({ uri: file.uri }));
}
