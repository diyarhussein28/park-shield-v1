import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FieldCrypto, randomCrockford, randomToken, sha256 } from './crypto';

const k1 = randomBytes(32);
const k2 = randomBytes(32);
const bidx = randomBytes(32);

describe('FieldCrypto', () => {
  it('round-trips and uses the documented envelope', () => {
    const c = new FieldCrypto(new Map([[1, k1]]), bidx);
    const blob = c.encrypt('K-AB 1234');
    expect(blob[0]).toBe(1);
    expect(blob.length).toBe(1 + 12 + 16 + Buffer.byteLength('K-AB 1234'));
    expect(c.decrypt(blob)).toBe('K-AB 1234');
  });

  it('uses a fresh IV for every encryption', () => {
    const c = new FieldCrypto(new Map([[1, k1]]), bidx);
    expect(c.encrypt('same').equals(c.encrypt('same'))).toBe(false);
  });

  it('writes with the newest key and still reads older versions (rotation)', () => {
    const old = new FieldCrypto(new Map([[1, k1]]), bidx).encrypt('Köln');
    const rotated = new FieldCrypto(
      new Map([
        [1, k1],
        [2, k2],
      ]),
      bidx,
    );
    expect(rotated.keyVersion).toBe(2);
    expect(rotated.encrypt('x')[0]).toBe(2);
    expect(rotated.decrypt(old)).toBe('Köln');
  });

  it('rejects tampered ciphertext', () => {
    const c = new FieldCrypto(new Map([[1, k1]]), bidx);
    const blob = c.encrypt('secret');
    blob[blob.length - 1]! ^= 1;
    expect(() => c.decrypt(blob)).toThrow();
  });

  it('never accepts a truncated (shorter) authentication tag', () => {
    const c = new FieldCrypto(new Map([[1, k1]]), bidx);
    const blob = c.encrypt('');
    // Empty plaintext: the blob ends with the 16-byte tag; cutting it leaves a 4-byte "tag".
    expect(() => c.decrypt(blob.subarray(0, 1 + 12 + 4))).toThrow('ciphertext too short');
  });

  it('builds a normalised, keyed blind index', () => {
    const c = new FieldCrypto(new Map([[1, k1]]), bidx);
    expect(c.blindIndex(' Jonas@Example.de ').equals(c.blindIndex('jonas@example.de'))).toBe(true);
    const other = new FieldCrypto(new Map([[1, k1]]), randomBytes(32));
    expect(c.blindIndex('a').equals(other.blindIndex('a'))).toBe(false);
  });
});

describe('random secrets', () => {
  it('tokens carry 256 bits and are URL-safe', () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256(t)).toHaveLength(32);
  });

  it('Crockford codes use the unambiguous alphabet only', () => {
    for (let i = 0; i < 200; i++) expect(randomCrockford(10)).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
  });
});
