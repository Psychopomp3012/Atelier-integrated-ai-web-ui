import { buildApp } from './app.js';
import { envConfig } from './config/env.config.js';
import { logger } from './utils/logger.util.js';

async function startServer(): Promise<void> {
  try {
    const app = await buildApp();

    await app.listen({
      port: envConfig.PORT,
      host: envConfig.HOST,
    });

    logger.info(`🚀 Fastify backend service running at http://${envConfig.HOST}:${envConfig.PORT}`, {
      env: envConfig.NODE_ENV,
      port: envConfig.PORT,
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

void startServer();
