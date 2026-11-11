import {
  Global,
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { Logger } from 'pino';
import type { Env } from '../config/env';
import type { DB as Database } from '../db/types.generated';
import { FieldCrypto } from './crypto';
import { CRYPTO, DB, ENV, LOGGER, VALKEY } from './tokens';

export type Db = Kysely<Database>;
const POOL_MAX = 10;

@Global()
@Module({})
export class CoreModule implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Opens the whole pool before the first request. Measured in the load test (US-45): a process that
   * starts during a burst otherwise opens connections one by one and builds a seconds-long backlog.
   */
  async onApplicationBootstrap() {
    if (this.env.NODE_ENV === 'test') return; // every test file boots apps; they need no warm pool
    await Promise.all(
      Array.from({ length: POOL_MAX }, () => sql`SELECT 1`.execute(this.db).catch(() => undefined)),
    );
  }

  static forRoot(env: Env, logger: Logger): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: ENV, useValue: env },
        { provide: LOGGER, useValue: logger },
        { provide: CRYPTO, useFactory: () => FieldCrypto.fromEnv(process.env, env.BIDX_KEY) },
        {
          provide: DB,
          useFactory: () => {
            const pool = new pg.Pool({
              connectionString: env.DATABASE_URL,
              max: POOL_MAX,
              // Keep connections warm: a new PostgreSQL backend costs ~400 ms on Windows (and a
              // few ms on Linux). The default 10 s idle timeout made every burst reconnect.
              idleTimeoutMillis: 5 * 60_000,
              keepAlive: true,
            });
            // Chaos drill (US-45): when PostgreSQL restarts or fails over, idle connections emit
            // "error". Without a listener that event would crash the whole process; the pool
            // drops the broken client by itself and the next query opens a new one.
            pool.on('error', (err) =>
              logger.warn({ err: err.message }, 'database connection lost'),
            );
            return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
          },
        },
        {
          provide: VALKEY,
          useFactory: () => new Redis(env.VALKEY_URL, { maxRetriesPerRequest: null }),
        },
      ],
      exports: [ENV, LOGGER, DB, VALKEY, CRYPTO],
    };
  }

  async onApplicationShutdown() {
    await this.db.destroy();
    this.valkey.disconnect();
  }
}
