import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { AuditBucket } from './ports';
import { S3Client, xmlText, type S3Config } from './s3';

/**
 * The Object Lock bucket (Terraform: minio_s3_bucket.audit, COMPLIANCE mode). Each object is written
 * once with a retention date; until then nobody, root credentials included, can delete or change it.
 */
export class S3AuditBucket implements AuditBucket {
  private readonly s3: S3Client;

  constructor(cfg: S3Config) {
    this.s3 = new S3Client(cfg);
  }

  async put(key: string, body: Buffer, retainUntil: Date): Promise<'created' | 'exists'> {
    const url = this.s3.url(key);
    // nosemgrep: ajinabraham.njsscan.crypto.crypto_node.node_md5 -- Content-MD5 header that S3 requires for Object Lock uploads; not a security hash
    const md5 = createHash('md5').update(body);
    const head = await this.s3.request('HEAD', url);
    if (head.ok) {
      // A retried batch after a crash: the identical object is already there.
      if (head.headers.get('etag')?.replace(/"/g, '') === md5.copy().digest('hex')) return 'exists';
      throw new Error(`audit object ${key} exists with different content`);
    }
    if (head.status !== 404) throw new Error(`audit bucket HEAD ${head.status}`);
    const res = await this.s3.request('PUT', url, body, {
      'content-type': 'application/x-ndjson',
      'content-md5': md5.digest('base64'),
      'x-amz-object-lock-mode': 'COMPLIANCE',
      'x-amz-object-lock-retain-until-date': retainUntil.toISOString(),
    });
    if (!res.ok) throw new Error(`audit bucket PUT ${res.status}: ${await res.text()}`);
    return 'created';
  }

  async get(key: string): Promise<Buffer | null> {
    const res = await this.s3.request('GET', this.s3.url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`audit bucket GET ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.s3.request(
        'GET',
        this.s3.url('', {
          'list-type': '2',
          prefix,
          ...(token ? { 'continuation-token': token } : {}),
        }),
      );
      if (!res.ok) throw new Error(`audit bucket LIST ${res.status}`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(xmlText(m[1]!));
      const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
      token = next ? xmlText(next[1]!) : undefined;
    } while (token);
    return keys.sort();
  }
}

/**
 * Local stand-in (.local/audit-bucket): files are created exclusively and then made read-only,
 * which mimics write-once storage closely enough for development and tests.
 */
export class LocalAuditBucket implements AuditBucket {
  constructor(private readonly dir: string) {}

  private path(key: string) {
    if (key.includes('..')) throw new Error('invalid audit key');
    return join(this.dir, ...key.split('/'));
  }

  async put(key: string, body: Buffer): Promise<'created' | 'exists'> {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    try {
      await writeFile(file, body, { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if ((await readFile(file)).equals(body)) return 'exists';
      throw new Error(`audit object ${key} exists with different content`, { cause: err });
    }
    await chmod(file, 0o444);
    return 'created';
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async list(prefix: string): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir, { recursive: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    return entries
      .map((e) => relative(this.dir, join(this.dir, e)).split(sep).join('/'))
      .filter((k) => k.endsWith('.jsonl') && k.startsWith(prefix))
      .sort();
  }
}
