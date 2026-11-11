import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import { DB, VALKEY } from '../core/tokens';

export interface Readiness {
  ready: boolean;
  checks: { database: boolean; valkey: boolean };
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VALKEY) private readonly valkey: Redis,
  ) {}

  async readiness(): Promise<Readiness> {
    const [database, valkey] = await Promise.all([
      sql`SELECT 1`.execute(this.db).then(
        () => true,
        () => false,
      ),
      this.valkey.ping().then(
        (r) => r === 'PONG',
        () => false,
      ),
    ]);
    return { ready: database && valkey, checks: { database, valkey } };
  }
}
