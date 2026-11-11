import 'reflect-metadata';
import { buildPublicApp } from './apps';
import { loadEnv } from './config/env';
import { createLogger } from './core/logger';

async function bootstrap() {
  const env = loadEnv();
  const logger = createLogger(env);
  const app = await buildPublicApp(env, logger);
  await app.listen(env.API_PORT, env.API_HOST);
  logger.info({ port: env.API_PORT }, 'public API listening');
}

void bootstrap();
