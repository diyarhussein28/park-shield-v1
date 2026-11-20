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

const SALT_TIMEOUT_MS = 300;

/**
 * Pseudonymous scanner references (02-architecture §5). Both are computed from the truncated IP
 * (/24, IPv6 /64) and the User-Agent on the server; nothing is read from or stored on the device
 * (§25 TDDDG). The daily salt is random and lives only in Valkey, so references from different days
 * cannot be linked even by someone holding every server secret. While Valkey does not answer, the salt
 * of the day is derived from SESSION_SECRET instead (abuse protection §2: alerts never wait for Valkey);
 * those references only differ from the normal ones for the length of the outage.
 */
@Injectable()
export class ScannerRefService {
  private readonly blockKey: Buffer;
  private readonly blockKeyPrevious: Buffer;
  private readonly fallbackKey: Buffer;

  constructor(
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(ENV) env: Env,
  ) {
    this.blockKey = Buffer.from(env.BLOCK_KEY_CURRENT, 'base64');
    this.blockKeyPrevious = Buffer.from(env.BLOCK_KEY_PREVIOUS, 'base64');
    // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- key derived from env.SESSION_SECRET, nothing hard-coded
    this.fallbackKey = hmac(Buffer.from(env.SESSION_SECRET, 'base64'), 'scanner-ref-fallback');
  }

  private async dailySalt(): Promise<Buffer> {
    const day = new Date().toISOString().slice(0, 10);
    const key = `scanref:salt:${day}`;
    const fromValkey = async () => {
      // Expires shortly after the UTC day ends; SET NX makes concurrent first requests agree on one salt.
      await this.valkey.set(key, randomBytes(32).toString('base64'), 'EX', 26 * 3600, 'NX');
      return Buffer.from((await this.valkey.get(key))!, 'base64');
    };
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        fromValkey(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('valkey timeout')), SALT_TIMEOUT_MS);
        }),
      ]);
    } catch {
      return hmac(this.fallbackKey, `scanner-ref:${day}`);
    } finally {
      clearTimeout(timer);
    }
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
