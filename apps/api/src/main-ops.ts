import 'reflect-metadata';
import { buildOpsApp } from './apps';
import { loadEnv } from './config/env';
import { createLogger } from './core/logger';

async function bootstrap() {
  const env = loadEnv();
  const logger = createLogger(env).child({ app: 'api-ops' });
  const app = await buildOpsApp(env, logger);
  await app.listen(env.OPS_API_PORT, env.OPS_API_HOST);
  logger.info({ host: env.OPS_API_HOST, port: env.OPS_API_PORT }, 'ops API listening');
}

void bootstrap();
