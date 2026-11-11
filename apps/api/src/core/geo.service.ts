import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { open, type Reader, type Response } from 'maxmind';

/**
 * IP → country only (SC-13), from DB-IP "IP to Country Lite" (CC BY 4.0, attributed in the privacy
 * policy). The full address is used for this single lookup and never stored; only the two-letter code
 * is kept with the alert, for 24 hours.
 */
@Injectable()
export class GeoService implements OnModuleInit {
  private reader: Reader<Response> | null = null;

  async onModuleInit() {
    // Resolve from the app's working directory: works the same under SWC/CommonJS and Vitest/ESM.
    const pkg = createRequire(join(process.cwd(), 'index.js')).resolve(
      '@ip-location-db/dbip-country-mmdb/package.json',
    );
    this.reader = await open<Response>(join(dirname(pkg), 'dbip-country.mmdb'));
  }

  country(ip: string | undefined): string | null {
    if (!ip || !this.reader) return null;
    const address = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    try {
      const hit = this.reader.get(address) as { country_code?: string } | null;
      return hit?.country_code && /^[A-Z]{2}$/.test(hit.country_code) ? hit.country_code : null;
    } catch {
      return null;
    }
  }
}
