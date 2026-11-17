import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Encrypted alert photos on the local disk (ALERT_MEDIA_DIR). File names are random UUIDs; nothing in a
 * path refers to an alert, vehicle, plate or owner. The directory is outside every web root, never
 * served statically, and excluded from server backups (infra/single/README.md).
 */
export class MediaStore {
  constructor(private readonly dir: string) {}

  private path(storageKey: string): string {
    // The key always comes from our own database, but a path is never built from anything else.
    if (!NAME.test(storageKey)) throw new Error('invalid storage key');
    return join(this.dir, storageKey);
  }

  async write(storageKey: string, blob: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(this.path(storageKey), blob, { mode: 0o600, flag: 'wx' });
  }

  read(storageKey: string): Promise<Buffer> {
    return readFile(this.path(storageKey));
  }

  /** Idempotent: a file that is already gone counts as deleted. */
  async remove(storageKey: string): Promise<void> {
    await rm(this.path(storageKey), { force: true });
  }

  /** Files older than `minAgeMs` (for the orphan sweep); an absent directory has none. */
  async listOlderThan(minAgeMs: number): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const cutoff = Date.now() - minAgeMs;
    const old: string[] = [];
    for (const name of names) {
      if (!NAME.test(name)) continue;
      const s = await stat(join(this.dir, name)).catch(() => null);
      if (s && s.mtimeMs < cutoff) old.push(name);
    }
    return old;
  }
}
