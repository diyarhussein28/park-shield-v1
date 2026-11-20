import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { authHeaders, mediaUrl } from './api';

/**
 * "Speichern": the only way a photo leaves the app. Downloaded with the session into a temporary file,
 * handed to the gallery, and the temporary file is deleted again at once.
 */
export async function savePhoto(alertId: string, mediaId: string, position: number): Promise<void> {
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) throw new Error('permission');
  const res = await fetch(mediaUrl(alertId, mediaId), { headers: await authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const file = new File(Paths.cache, `parkshield-foto-${position}-${Date.now()}.jpg`);
  try {
    file.write(new Uint8Array(await res.arrayBuffer()));
    await MediaLibrary.saveToLibraryAsync(file.uri);
  } finally {
    if (file.exists) file.delete();
  }
}
