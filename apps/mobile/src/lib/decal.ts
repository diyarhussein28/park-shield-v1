import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { authHeaders } from './api';
import { API_URL } from './config';

/**
 * „Druckvorlage herunterladen": the free print-at-home PDF (OW-04), downloaded with the session into a
 * temporary file and handed to the share sheet (save to Files, AirDrop, print, mail). The temporary
 * file is deleted again afterwards.
 */
export async function shareDecalPdf(vehicleId: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('sharing_unavailable');
  const res = await fetch(`${API_URL}/v1/vehicles/${vehicleId}/decal.pdf`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const file = new File(Paths.cache, `parkshield-aufkleber-${Date.now()}.pdf`);
  try {
    file.write(new Uint8Array(await res.arrayBuffer()));
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  } finally {
    if (file.exists) file.delete();
  }
}
