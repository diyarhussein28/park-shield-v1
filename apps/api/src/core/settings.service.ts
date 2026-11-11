import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Db } from './core.module';
import { DB, VALKEY } from './tokens';

const TTL_MS = 30_000; // safety net; changes normally arrive instantly via the channel below
export const SETTINGS_CHANNEL = 'settings:changed';

/**
 * Runtime settings from app_settings (AD-14). Never hard-code limits or switches (hard rule 6).
 * Whoever changes a setting publishes on SETTINGS_CHANNEL, so every API and worker process reloads at once.
 */
@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
  private cache = new Map<string, unknown>();
  private loadedAt = 0;
  private subscriber: Redis | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VALKEY) private readonly valkey: Redis,
  ) {}

  async onModuleInit() {
    this.subscriber = this.valkey.duplicate();
    this.subscriber.on('message', () => this.invalidate());
    await this.subscriber.subscribe(SETTINGS_CHANNEL);
  }

  async onModuleDestroy() {
    this.subscriber?.disconnect();
  }

  private async refresh(): Promise<void> {
    if (Date.now() - this.loadedAt < TTL_MS) return;
    const rows = await this.db.selectFrom('app_settings').select(['key', 'value']).execute();
    this.cache = new Map(rows.map((r) => [r.key, r.value]));
    this.loadedAt = Date.now();
  }

  async get<T>(key: string, fallback: T): Promise<T> {
    await this.refresh();
    return this.cache.has(key) ? (this.cache.get(key) as T) : fallback;
  }

  private readonly listeners: (() => void)[] = [];

  /** Other caches that must reload together with the settings (e.g. filter word lists). */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  invalidate(): void {
    this.loadedAt = 0;
    for (const l of this.listeners) l();
  }

  /** Tells every process to reload (call after writing app_settings). */
  async broadcastChange(): Promise<void> {
    this.invalidate();
    await this.valkey.publish(SETTINGS_CHANNEL, '1');
  }
}
