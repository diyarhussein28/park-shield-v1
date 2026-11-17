import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { FieldCrypto } from '../core/crypto';

/** File layout: [format 1B = 1][IV 12B][GCM tag 16B][ciphertext]. */
const FORMAT = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Envelope encryption for alert photos: every file gets its own random AES-256-GCM key (the data
 * encryption key), and only that key, wrapped with the application data key (FieldCrypto, DATA_KEY_V<n>),
 * is stored in PostgreSQL. The storage key is bound as additional data, so a file cannot be swapped for
 * another one on disk. Deleting the wrapped key makes the file and every copy of it unreadable.
 */
export function encryptFile(
  plain: Buffer,
  storageKey: string,
  master: FieldCrypto,
): { blob: Buffer; wrappedKey: Buffer } {
  const dek = randomBytes(32);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', dek, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(storageKey, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const blob = Buffer.concat([Buffer.from([FORMAT]), iv, cipher.getAuthTag(), ct]);
  const wrappedKey = master.encrypt(dek.toString('base64'));
  dek.fill(0);
  return { blob, wrappedKey };
}

export function decryptFile(
  blob: Buffer,
  storageKey: string,
  wrappedKey: Buffer,
  master: FieldCrypto,
): Buffer {
  if (blob.length < 1 + IV_BYTES + TAG_BYTES || blob[0] !== FORMAT) {
    throw new Error('not an alert media file');
  }
  const dek = Buffer.from(master.decrypt(wrappedKey), 'base64');
  try {
    const decipher = createDecipheriv('aes-256-gcm', dek, blob.subarray(1, 1 + IV_BYTES), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(storageKey, 'utf8'));
    decipher.setAuthTag(blob.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(blob.subarray(1 + IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
  } finally {
    dek.fill(0);
  }
}
