import { createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env';
import { ENV, VALKEY } from '../core/tokens';

export interface ScannerRefs {
  /** Same scanner across all vehicles, today only (rate limits, patterns, same-day global blocks). */
  scannerRef: Buffer;
  /** Same scanner for this one vehicle (30-day blocks after an owner's report, OW-08). */
  blockRef: Buffer;
  /** blockRef under the previous block key, so blocks survive a key rotation. */
  blockRefPrevious: Buffer;
}

const hmac = (key: Buffer, ...parts: string[]) =>
  createHmac('sha256', key).update(parts.join('|')).digest();

/**
 * Pseudonymous scanner references (02-architecture §5). Both are computed from the truncated IP and the
 * User-Agent on the server; nothing is read from or stored on the device (§25 TDDDG). The daily salt is
 * random and lives only in Valkey, so references from different days cannot be linked.
 */
@Injectable()
export class ScannerRefService {
  private readonly blockKey: Buffer;
  private readonly blockKeyPrevious: Buffer;

  constructor(
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(ENV) env: Env,
  ) {
    this.blockKey = Buffer.from(env.BLOCK_KEY_CURRENT, 'base64');
    this.blockKeyPrevious = Buffer.from(env.BLOCK_KEY_PREVIOUS, 'base64');
  }

  private async dailySalt(): Promise<Buffer> {
    const key = `scanref:salt:${new Date().toISOString().slice(0, 10)}`;
    // Expires shortly after the UTC day ends; SET NX makes concurrent first requests agree on one salt.
    await this.valkey.set(key, randomBytes(32).toString('base64'), 'EX', 26 * 3600, 'NX');
    return Buffer.from((await this.valkey.get(key))!, 'base64');
  }

  async compute(ipPrefix: string, userAgent: string, tokenId: string): Promise<ScannerRefs> {
    const ua = userAgent.slice(0, 300);
    return {
      scannerRef: hmac(await this.dailySalt(), ipPrefix, ua),
      blockRef: hmac(this.blockKey, ipPrefix, ua, tokenId),
      blockRefPrevious: hmac(this.blockKeyPrevious, ipPrefix, ua, tokenId),
    };
  }
}
