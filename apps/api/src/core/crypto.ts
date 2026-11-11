import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

export const sha256 = (value: string | Buffer): Buffer =>
  createHash('sha256').update(value).digest();

/** 256-bit random secret, URL-safe. Only its SHA-256 is ever stored (hard rule 1). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Field ciphertext layout: [key version (1)] [IV (12)] [GCM tag (16)] [ciphertext]. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Crockford Base32 string with 5 random bits per character (decal codes, contract numbers). */
export function randomCrockford(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CROCKFORD[bytes[i]! & 31];
  return out;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * Application-level field encryption (02-architecture §5):
 * `[key version 1B][IV 12B][tag 16B][ciphertext]`, AES-256-GCM. New writes use the highest key version;
 * older versions stay readable until a background job re-encrypts them.
 */
export class FieldCrypto {
  private readonly current: number;

  constructor(
    private readonly keys: ReadonlyMap<number, Buffer>,
    private readonly bidxKey: Buffer,
  ) {
    if (!keys.size) throw new Error('FieldCrypto needs at least one data key');
    for (const [v, k] of keys) {
      if (k.length !== 32) throw new Error(`DATA_KEY_V${v} must be 32 bytes`);
      if (v < 1 || v > 255) throw new Error(`invalid key version ${v}`);
    }
    this.current = Math.max(...keys.keys());
  }

  static fromEnv(env: NodeJS.ProcessEnv, bidxKeyB64: string): FieldCrypto {
    const keys = new Map<number, Buffer>();
    for (const [name, value] of Object.entries(env)) {
      const m = /^DATA_KEY_V(\d+)$/.exec(name);
      if (m && value) keys.set(Number(m[1]), Buffer.from(value, 'base64'));
    }
    return new FieldCrypto(keys, Buffer.from(bidxKeyB64, 'base64'));
  }

  get keyVersion(): number {
    return this.current;
  }

  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.current)!, iv, {
      authTagLength: TAG_BYTES,
    });
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([this.current]), iv, cipher.getAuthTag(), ct]);
  }

  decrypt(blob: Buffer): string {
    const version = blob[0]!;
    const key = this.keys.get(version);
    if (!key) throw new Error(`unknown data key version ${version}`);
    // Fixed 16-byte tag: a truncated blob must fail, never verify against a shorter (forgeable) tag.
    if (blob.length < 1 + IV_BYTES + TAG_BYTES) throw new Error('ciphertext too short');
    const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(1, 13), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(blob.subarray(13, 29));
    return Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]).toString('utf8');
  }

  /** Equality-lookup index: HMAC-SHA256(key, normalize(value)). */
  blindIndex(
    value: string,
    normalize: (v: string) => string = (v) => v.trim().toLowerCase(),
  ): Buffer {
    return createHmac('sha256', this.bidxKey).update(normalize(value)).digest();
  }
}
