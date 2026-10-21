import Fastify, { type FastifyInstance } from 'fastify';
import { registerCorsPlugin } from './plugins/cors.plugin.js';
import { registerSensiblePlugin } from './plugins/sensible.plugin.js';
import { registerSwaggerPlugin } from './plugins/swagger.plugin.js';
import { agentRoutes } from './modules/agent/agent.routes.js';
import { sandboxRoutes } from './modules/sandbox/sandbox.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { quotaRoutes } from './modules/quota/quota.routes.js';
import { sessionRoutes } from './modules/session/session.routes.js';
import { createErrorResponse } from './utils/response.util.js';
import { isAppError } from './utils/error.util.js';
import { logger } from './utils/logger.util.js';
import { timingLogger } from './utils/timing.util.js';
import { tokenUtil } from './utils/token.util.js';
import { cliAuthService } from './modules/auth/cli-auth.service.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // We use our structured logger utility
    bodyLimit: 25 * 1024 * 1024, // 25MB to support image and file attachments
  });

  // Register foundational plugins
  await registerCorsPlugin(app);
  await registerSensiblePlugin(app);
  await registerSwaggerPlugin(app);

  // Rate limiting to prevent API abuse
  const { default: rateLimit } = await import('@fastify/rate-limit');
  await app.register(rateLimit, {
    max: 500,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1', '::1'],
  });

  // Centralized API logging into test_suite/app_debug.log (excluding preflight OPTIONS)
  app.addHook('onRequest', async (request) => {
    // Resolve authenticated user early if Bearer token is provided
    let reqUserId = request.userId;
    if (!reqUserId && request.headers.authorization?.startsWith('Bearer ')) {
      const token = request.headers.authorization.substring(7).trim();
      const verified = tokenUtil.verifyJwt(token);
      if (verified.valid && verified.payload?.sub) {
        reqUserId = verified.payload.sub;
        request.userId = reqUserId;
        request.userEmail = verified.payload.email;
        request.token = token;
      }
    }

    // Log mutative or long-running operations when they start so operations are tracked even if interrupted
    if (request.method !== 'GET' && request.method !== 'OPTIONS' && (request.url.startsWith('/api/') || request.url.startsWith('/oauth'))) {
      logger.info(`[API Request] ${request.method} ${request.url}`, {
        reqId: request.id,
        userId: reqUserId,
      });
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    if ((request.url.startsWith('/api/') || request.url.startsWith('/oauth')) && request.method !== 'OPTIONS') {
      const durationMs = Math.round(reply.elapsedTime);
      timingLogger.logTiming('API Route', `${request.method} ${request.url} -> ${reply.statusCode}`, durationMs, {
        reqId: request.id,
        userId: request.userId,
      });

      // Suppress noisy routine status checks from flooding app_debug.log
      if (request.url.startsWith('/api/v1/auth/cli/status') && reply.statusCode === 200) {
        return;
      }
      logger.info(`[API] ${request.method} ${request.url} -> ${reply.statusCode} (${durationMs}ms)`, {
        reqId: request.id,
        userId: request.userId,
      });
    }
  });

  // Centralized scalable error handler registered before routes
  app.setErrorHandler((error: any, request, reply) => {
    if (isAppError(error)) {
      if (error.statusCode >= 400) {
        logger.error(`[AppError ${error.code}] ${error.message}`, error, {
          reqId: request.id,
          userId: request.userId,
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
    const code = (error.code === 'FST_ERR_VALIDATION' || statusCode === 400)
      ? 'VALIDATION_ERROR'
      : (error.code || (statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR'));

    logger.error(`[HTTP ${statusCode}] Unhandled application exception: ${error.message}`, error, {
      reqId: request.id,
      userId: request.userId,
      url: request.url,
      method: request.method,
      code,
      stack: error.stack,
    });

    return reply.status(statusCode).send(
      createErrorResponse(code, error.message || 'An unexpected error occurred', error.validation || error.details)
    );
  });

  // Modular domain routes
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
