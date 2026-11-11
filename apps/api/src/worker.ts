import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './apps';
import { loadEnv } from './config/env';
import { createLogger, PinoNestLogger } from './core/logger';

async function bootstrap() {
  const env = loadEnv();
  const logger = createLogger(env).child({ app: 'worker' });
  const ctx = await NestFactory.createApplicationContext(WorkerModule.forRoot(env, logger), {
    logger: new PinoNestLogger(logger),
  });
  ctx.enableShutdownHooks();
  logger.info('worker started');
}

void bootstrap();
