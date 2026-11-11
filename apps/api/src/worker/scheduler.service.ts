import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { LOGGER, VALKEY } from '../core/tokens';

interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
  /** Frequent jobs log only when they did something (a truthy result). */
  quiet?: boolean;
}

/**
 * Periodic jobs. A Valkey lock per job and interval keeps a job from running twice when several workers
 * are deployed; PostgreSQL stays the source of truth, so a missed run is simply caught up next time.
 */
@Injectable()
export class SchedulerService implements OnModuleDestroy {
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  every(job: Job): void {
    const tick = async () => {
      const lockMs = Math.max(job.everyMs - 1000, Math.floor(job.everyMs / 2));
      const lock = await this.valkey.set(`job:${job.name}`, '1', 'PX', lockMs, 'NX');
      if (!lock) return;
      try {
        const result = await job.run();
        if (!job.quiet || result) this.logger.info({ job: job.name, result }, 'job finished');
      } catch (err) {
        this.logger.error({ job: job.name, err: String(err) }, 'job failed');
      }
    };
    void tick();
    this.timers.push(setInterval(() => void tick(), job.everyMs));
  }

  onModuleDestroy() {
    for (const t of this.timers) clearInterval(t);
  }
}
