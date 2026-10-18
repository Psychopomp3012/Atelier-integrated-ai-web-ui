import Fastify, { type FastifyInstance } from 'fastify';
import { registerCorsPlugin } from './plugins/cors.plugin.js';
import { registerSensiblePlugin } from './plugins/sensible.plugin.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { agentRoutes } from './modules/agent/agent.routes.js';
import { sandboxRoutes } from './modules/sandbox/sandbox.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { quotaRoutes } from './modules/quota/quota.routes.js';
import { sessionRoutes } from './modules/session/session.routes.js';
import { createErrorResponse } from './utils/response.util.js';
import { isAppError } from './utils/error.util.js';
import { logger } from './utils/logger.util.js';
import { cliAuthService } from './modules/auth/cli-auth.service.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // We use our structured logger utility
    bodyLimit: 25 * 1024 * 1024, // 25MB to support image and file attachments
  });

  // Register foundational plugins
  await registerCorsPlugin(app);
  await registerSensiblePlugin(app);

  // Rate limiting to prevent API abuse
  const { default: rateLimit } = await import('@fastify/rate-limit');
  await app.register(rateLimit, {
    max: 500,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1', '::1'],
  });

  // Centralized API logging into test_suite/app_debug.log (excluding preflight OPTIONS)
  app.addHook('onRequest', async (request) => {
    // Log mutative or long-running operations when they start so operations are tracked even if interrupted
    if (request.method !== 'GET' && request.method !== 'OPTIONS' && (request.url.startsWith('/api/') || request.url.startsWith('/oauth'))) {
      logger.info(`[API Request] ${request.method} ${request.url}`);
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    if ((request.url.startsWith('/api/') || request.url.startsWith('/oauth')) && request.method !== 'OPTIONS') {
      // Suppress noisy routine status checks from flooding app_debug.log
      if (request.url.startsWith('/api/v1/auth/cli/status') && reply.statusCode === 200) {
        return;
      }
      const durationMs = Math.round(reply.elapsedTime);
      logger.info(`[API] ${request.method} ${request.url} -> ${reply.statusCode} (${durationMs}ms)`);
    }
  });

  // Centralized scalable error handler registered before routes
  app.setErrorHandler((error: any, request, reply) => {
    if (isAppError(error)) {
      if (error.statusCode >= 400) {
        logger.error(`[AppError ${error.code}] ${error.message}`, error, {
          url: request.url,
          method: request.method,
          statusCode: error.statusCode,
          details: error.details,
        });
      }
      return reply.status(error.statusCode).send(
        createErrorResponse(error.code, error.message, error.details)
      );
    }

    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    const code = error.code || (statusCode === 400 ? 'VALIDATION_ERROR' : statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR');

    logger.error(`[HTTP ${statusCode}] Unhandled application exception: ${error.message}`, error, {
      url: request.url,
      method: request.method,
      code,
      stack: error.stack,
    });

    return reply.status(statusCode).send(
      createErrorResponse(code, error.message || 'An unexpected error occurred')
    );
  });

  // Modular domain routes
  await app.register(healthRoutes);
  await app.register(agentRoutes);
  await app.register(sandboxRoutes);
  await app.register(authRoutes);
  await app.register(quotaRoutes);
  await app.register(sessionRoutes);

  // Sync existing local CLI links to Firestore on startup if Firestore is available
  app.addHook('onReady', async () => {
    cliAuthService.syncLocalLinksToFirestore().catch(() => {});
  });

  return app;
}
