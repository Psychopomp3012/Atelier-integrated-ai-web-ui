import Fastify, { type FastifyInstance } from 'fastify';
import { registerCorsPlugin } from './plugins/cors.plugin.js';
import { registerSensiblePlugin } from './plugins/sensible.plugin.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { agentRoutes } from './modules/agent/agent.routes.js';
import { sandboxRoutes } from './modules/sandbox/sandbox.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { quotaRoutes } from './modules/quota/quota.routes.js';
import { createErrorResponse } from './utils/response.util.js';
import { isAppError } from './utils/error.util.js';
import { logger } from './utils/logger.util.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // We use our structured logger utility
    bodyLimit: 25 * 1024 * 1024, // 25MB to support image and file attachments
  });

  // Register foundational plugins
  await registerCorsPlugin(app);
  await registerSensiblePlugin(app);

  // Modular domain routes
  await app.register(healthRoutes);
  await app.register(agentRoutes);
  await app.register(sandboxRoutes);
  await app.register(authRoutes);
  await app.register(quotaRoutes);

  // Centralized scalable error handler
  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      return reply.status(error.statusCode).send(
        createErrorResponse(error.code, error.message, error.details)
      );
    }

    logger.error('Unhandled application exception', error);

    return reply.status(500).send(
      createErrorResponse('INTERNAL_SERVER_ERROR', 'An unexpected error occurred')
    );
  });

  return app;
}
