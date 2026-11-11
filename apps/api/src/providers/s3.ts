import { createHash, createHmac } from 'node:crypto';

const sha256Hex = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) =>
  createHmac('sha256', key).update(data).digest();
const rfc3986 = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export interface SigV4Input {
  method: string;
  url: URL;
  headers: Record<string, string>;
  /** Hex SHA-256 of the body ("UNSIGNED-PAYLOAD" is not used: every body is signed). */
  payloadHash: string;
  region: string;
  accessKey: string;
  secretKey: string;
  now: Date;
}

/**
 * AWS Signature Version 4 for S3 (also Hetzner Object Storage and MinIO). Returns the headers to send,
 * including host, x-amz-date, x-amz-content-sha256 and authorization.
 */
export function signV4(input: SigV4Input): Record<string, string> {
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const all: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v])),
    host: input.url.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(all).sort();
  const canonicalHeaders = names
    .map((n) => `${n}:${all[n]!.trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = names.join(';');
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const path = input.url.pathname
    .split('/')
    .map((seg) => rfc3986(decodeURIComponent(seg)))
    .join('/');
  const canonical = [
    input.method,
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
  // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- SigV4 key derivation; the secret is passed in from env
  const key = hmac(
    // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- SigV4 key derivation; the secret is passed in from env
    hmac(hmac(hmac(`AWS4${input.secretKey}`, day), input.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return {
    ...all,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export interface S3Config {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

/** Minimal path-style S3 client: HEAD, GET, PUT and ListObjectsV2 are all the audit stream needs. */
export class S3Client {
  constructor(private readonly cfg: S3Config) {}

  url(key = '', query: Record<string, string> = {}): URL {
    const u = new URL(
      `${this.cfg.endpoint.replace(/\/$/, '')}/${this.cfg.bucket}${key ? `/${key.split('/').map(rfc3986).join('/')}` : ''}`,
    );
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u;
  }

  async request(
    method: 'GET' | 'HEAD' | 'PUT',
    url: URL,
    body?: Buffer,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const signed = signV4({
      method,
      url,
      headers,
      payloadHash: sha256Hex(body ?? ''),
      region: this.cfg.region,
      accessKey: this.cfg.accessKey,
      secretKey: this.cfg.secretKey,
      now: new Date(),
    });
    const { host: _host, ...send } = signed;
    return fetch(url, { method, headers: send, body: body ? new Uint8Array(body) : undefined });
  }
}

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};
export const xmlText = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos);/g, (e) => XML_ENTITIES[e]!);
