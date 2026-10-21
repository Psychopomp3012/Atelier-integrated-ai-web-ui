import dns from 'node:dns';

// Prioritize IPv4 over IPv6 to prevent ISP PMTU blackholing and 60s DEADLINE_EXCEEDED gRPC hangs on Google Cloud Firestore endpoints
dns.setDefaultResultOrder('ipv4first');

import { buildApp } from './app.js';
import { envConfig } from './config/env.config.js';
import { logger } from './utils/logger.util.js';

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection detected', reason);
});

process.on('uncaughtException', (error) => {
  if (error && typeof error === 'object' && ('code' in error && (error.code === 'EIO' || error.code === 'EPIPE'))) {
    return;
  }
  logger.error('Uncaught Exception detected', error);
});

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
