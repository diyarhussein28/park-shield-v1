import type { LoggerService } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { pino, type DestinationStream, type Logger } from 'pino';
import type { Env } from '../config/env';

/**
 * No personal data in logs (hard rule 4): requests are logged by route *pattern* only, so decal codes and
 * tokens in URLs never reach the log, and IP addresses, headers and bodies are never serialised.
 */
export function createLogger(env: Pick<Env, 'NODE_ENV'>, destination?: DestinationStream): Logger {
  const pretty = env.NODE_ENV === 'development' && !destination;
  return pino(
    {
      level: env.NODE_ENV === 'test' && !destination ? 'silent' : 'info',
      base: undefined,
      serializers: {
        req: (req: FastifyRequest) => ({
          id: req.id,
          method: req.method,
          route: req.routeOptions?.url ?? '[unmatched]',
        }),
        res: (res: FastifyReply) => ({ statusCode: res.statusCode }),
      },
      transport: pretty ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
    },
    destination,
  );
}

export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}
  log(message: unknown, context?: string) {
    this.logger.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string) {
    this.logger.error({ context, trace }, String(message));
  }
  warn(message: unknown, context?: string) {
    this.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string) {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string) {
    this.logger.trace({ context }, String(message));
  }
}
