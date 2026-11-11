import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB } from '../core/tokens';

export interface WordLists {
  insults: { de: string[]; en: string[] };
  threats: { de: string[]; en: string[] };
}

const TTL_MS = 60_000;

const clean = (list: unknown): string[] =>
  Array.isArray(list)
    ? [
        ...new Set(
          list
            .map((w) => String(w).trim().toLowerCase())
            .filter((w) => w.length >= 2 && w.length <= 40),
        ),
      ].sort()
    : [];

/**
 * Filter word lists (AD-10), versioned in filter_word_lists. The newest version is live everywhere
 * within seconds (settings change broadcast) and at most a minute (cache TTL).
 */
@Injectable()
export class WordListsService {
  private cache: { version: number; words: WordLists } | null = null;
  private loadedAt = 0;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {
    settings.onChange(() => {
      this.loadedAt = 0;
    });
  }

  private parse(words: unknown): WordLists {
    const w = (words ?? {}) as Partial<
      Record<'insults' | 'threats', Partial<Record<'de' | 'en', unknown>>>
    >;
    return {
      insults: { de: clean(w.insults?.de), en: clean(w.insults?.en) },
      threats: { de: clean(w.threats?.de), en: clean(w.threats?.en) },
    };
  }

  async current(): Promise<{ version: number; words: WordLists } | null> {
    if (this.cache && Date.now() - this.loadedAt < TTL_MS) return this.cache;
    const row = await this.db
      .selectFrom('filter_word_lists')
      .select(['version', 'words'])
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
    this.cache = row ? { version: row.version, words: this.parse(row.words) } : null;
    this.loadedAt = Date.now();
    return this.cache;
  }

  /** The lists in the shape filterText() takes; undefined falls back to the built-in defaults. */
  async forFilter(): Promise<{ insults?: string[]; threats?: string[] }> {
    const c = await this.current();
    if (!c) return {};
    return {
      insults: [...c.words.insults.de, ...c.words.insults.en],
      threats: [...c.words.threats.de, ...c.words.threats.en],
    };
  }

  async versions() {
    const rows = await this.db
      .selectFrom('filter_word_lists as l')
      .leftJoin('users as u', 'u.id', 'l.created_by')
      .select(['l.version', 'l.words', 'l.note', 'l.created_at', 'u.email as createdBy'])
      .orderBy('l.version', 'desc')
      .limit(50)
      .execute();
    return rows.map((r) => ({
      version: r.version,
      words: this.parse(r.words),
      note: r.note,
      createdAt: r.created_at,
      createdBy: r.createdBy,
    }));
  }

  async publish(staffId: string, words: WordLists, note: string) {
    const parsed = this.parse(words);
    if (!parsed.insults.de.length && !parsed.insults.en.length) {
      throw new BadRequestException({ error: 'lists_empty' });
    }
    const row = await this.db
      .insertInto('filter_word_lists')
      .values({ words: JSON.stringify(parsed), note: note.slice(0, 200), created_by: staffId })
      .returning('version')
      .executeTakeFirstOrThrow();
    await this.settings.broadcastChange();
    return row.version;
  }

  /** Rollback = publish an old version again, so the history stays complete. */
  async rollback(staffId: string, version: number) {
    const old = await this.db
      .selectFrom('filter_word_lists')
      .select('words')
      .where('version', '=', version)
      .executeTakeFirst();
    if (!old) throw new NotFoundException();
    return this.publish(staffId, this.parse(old.words), `Rollback to version ${version}`);
  }
}
