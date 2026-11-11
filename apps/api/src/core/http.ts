import { randomUUID } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Logger } from 'pino';
import { PinoNestLogger } from './logger';

export async function createHttpApp(
  rootModule: unknown,
  logger: Logger,
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    loggerInstance: logger,
    // Only Caddy and the Next.js server (loopback / private network) may set X-Forwarded-For;
    // a client-supplied header must never decide the IP used for rate limits.
    trustProxy: ['127.0.0.1', '::1', '10.0.0.0/8'],
    genReqId: () => randomUUID(),
    bodyLimit: 64 * 1024,
  });
  const app = await NestFactory.create<NestFastifyApplication>(rootModule as never, adapter, {
    logger: new PinoNestLogger(logger),
    rawBody: true, // Stripe webhook signatures are computed over the raw body
  });
  await app.register(fastifyCookie as never);
  // ASVS 14.4: every API response, including errors. Caddy serves /v1 straight from here and adds HSTS.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (_req, reply, payload) => {
      reply.header('x-content-type-options', 'nosniff');
      reply.header('x-frame-options', 'DENY');
      reply.header('referrer-policy', 'no-referrer');
      reply.header('cross-origin-resource-policy', 'same-origin');
      // Not on PDFs: a 'none' policy stops the browser's built-in PDF viewer.
      if (!String(reply.getHeader('content-type') ?? '').startsWith('application/pdf'))
        reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
      // Account data must never sit in a shared or browser cache.
      if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
      return payload;
    });
  // Encrypted Web Push bodies (aes128gcm) for the local push receiver in DevController.
  app
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) =>
      done(null, body),
    );
  app.enableShutdownHooks();
  return app;
}
