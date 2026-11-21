import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

/**
 * The owner's own photo of the car (Stage 4.2): kept on this device only, never uploaded. The picked
 * image is copied into the app's document directory (the picker's URI is a temporary cache file) and
 * a small JSON index in the same directory maps vehicle id → file. Each new photo gets a new file name,
 * which doubles as the cache-busting key, so a change shows at once. A missing file (new phone,
 * reinstall, removed) falls back to the illustration.
 */
const INDEX = 'vehicle-photos.json';
const ID = /^[0-9a-f-]{36}$/i;

type Index = Record<string, string>;

function indexFile() {
  return new File(Paths.document, INDEX);
}

function readIndex(): Index {
  try {
    const f = indexFile();
    if (!f.exists) return {};
    const parsed = JSON.parse(f.textSync()) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Index) : {};
  } catch {
    return {};
  }
}

function writeIndex(index: Index) {
  const f = indexFile();
  if (!f.exists) f.create();
  f.writeSync(JSON.stringify(index));
}

/** The stored photo of a vehicle (a file:// URI in the document directory), or null. */
export function vehiclePhoto(vehicleId: string): string | null {
  const name = readIndex()[vehicleId];
  if (!name) return null;
  const f = new File(Paths.document, name);
  return f.exists ? f.uri : null;
}

/**
 * Opens the system photo picker (no permission prompt with the modern pickers), copies the chosen
 * image into the document directory and remembers it. Returns the new URI, or null when cancelled.
 */
export async function pickVehiclePhoto(vehicleId: string): Promise<string | null> {
  if (!ID.test(vehicleId)) throw new Error('invalid_vehicle');
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [4, 3],
    quality: 0.8,
    exif: false,
  });
  const asset = r.canceled ? null : r.assets?.[0];
  if (!asset) return null;
  const ext = /\.(png|heic|webp)$/i.exec(asset.uri)?.[1]?.toLowerCase() ?? 'jpg';
  const name = `vehicle-${vehicleId}-${Date.now()}.${ext}`;
  const target = new File(Paths.document, name);
  await new File(asset.uri).copy(target);
  const index = readIndex();
  const old = index[vehicleId];
  index[vehicleId] = name;
  writeIndex(index);
  if (old && old !== name) deleteQuietly(old);
  return target.uri;
}

/** „Foto entfernen“: the file and its entry go; the illustration shows again. */
export function removeVehiclePhoto(vehicleId: string): void {
  const index = readIndex();
  const name = index[vehicleId];
  if (!name) return;
  delete index[vehicleId];
  writeIndex(index);
  deleteQuietly(name);
}

function deleteQuietly(name: string) {
  try {
    const f = new File(Paths.document, name);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}
