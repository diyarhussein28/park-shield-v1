import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpsApp, buildPublicApp } from '../apps';
import { loadEnv } from '../config/env';
import { createLogger } from '../core/logger';

const lines: string[] = [];
const sink = new Writable({
  write(chunk, _enc, cb) {
    lines.push(String(chunk));
    cb();
  },
});

let pub: NestFastifyApplication;
let ops: NestFastifyApplication;

beforeAll(async () => {
  const env = loadEnv();
  const logger = createLogger(env, sink);
  pub = await buildPublicApp(env, logger);
  ops = await buildOpsApp(env, logger);
  await Promise.all([pub.init(), ops.init()]);
  await Promise.all([
    pub.getHttpAdapter().getInstance().ready(),
    ops.getHttpAdapter().getInstance().ready(),
  ]);
});

afterAll(async () => {
  await Promise.all([pub?.close(), ops?.close()]);
});

describe('public API', () => {
  it('reports liveness', async () => {
    const res = await pub.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('reports readiness of PostgreSQL and Valkey', async () => {
    const res = await pub.inject({ method: 'GET', url: '/v1/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ready: true, checks: { database: true, valkey: true } });
  });

  it('has no ops routes (AD-01)', async () => {
    const res = await pub.inject({ method: 'GET', url: '/ops/v1/health' });
    expect(res.statusCode).toBe(404);
  });
});

describe('api-ops', () => {
  it('serves ops routes', async () => {
    const res = await ops.inject({ method: 'GET', url: '/ops/v1/health' });
    expect(res.statusCode).toBe(200);
  });

  it('does not serve public routes', async () => {
    const res = await ops.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(404);
  });
});

describe('request logging (no personal data in logs)', () => {
  it('never logs tokens from the URL, IPs or headers', async () => {
    lines.length = 0;
    await pub.inject({
      method: 'GET',
      url: '/v1/scan/K7QX4M2R9T?ack=secret-ack-token',
      remoteAddress: '203.0.113.77',
      headers: { 'user-agent': 'Mozilla/5.0 Unique-UA', cookie: 'sid=abc123' },
    });
    const log = lines.join('');
    expect(log).toContain('"route":"/v1/scan/:code"'); // the pattern, never the decal code itself
    for (const secret of ['K7QX4M2R9T', 'secret-ack-token', '203.0.113', 'Unique-UA', 'abc123']) {
      expect(log).not.toContain(secret);
    }
  });

  it('logs unknown URLs as unmatched without their path', async () => {
    lines.length = 0;
    await pub.inject({ method: 'GET', url: '/v1/ack/Zm9vYmFyLXNlY3JldA' });
    const log = lines.join('');
    expect(log).toContain('"route":"[unmatched]"');
    expect(log).not.toContain('Zm9vYmFyLXNlY3JldA');
  });

  it('logs the route pattern for matched routes', async () => {
    lines.length = 0;
    await pub.inject({ method: 'GET', url: '/v1/health' });
    expect(lines.join('')).toContain('"route":"/v1/health"');
  });
});
