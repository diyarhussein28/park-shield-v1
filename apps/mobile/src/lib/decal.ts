import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { authHeaders } from './api';
import { API_URL } from './config';

/** The free print-at-home PDF (OW-04), downloaded with the session into a temporary file. */
async function withDecalPdf(vehicleId: string, use: (file: File) => Promise<void>): Promise<void> {
  const res = await fetch(`${API_URL}/v1/vehicles/${vehicleId}/decal.pdf`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const file = new File(Paths.cache, `parkshield-aufkleber-${Date.now()}.pdf`);
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
export async function shareDecalPdf(vehicleId: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('sharing_unavailable');
  await withDecalPdf(vehicleId, (file) =>
    Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' }),
  );
}

/** „Drucken“: the system print dialog with the PDF (AirPrint / Android print service). */
export async function printDecalPdf(vehicleId: string): Promise<void> {
  await withDecalPdf(vehicleId, (file) => Print.printAsync({ uri: file.uri }));
}
