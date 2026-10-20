import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { agentPromptLimiter } from './rate-limit.service.js';
import { createSuccessResponse } from '../../utils/response.util.js';
import { getClientKey, publicLimitHook } from '../../middleware/rate-limit.middleware.js';

export async function rateLimitRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/rate-limit/status', {
    schema: {
      tags: ['RateLimit'],
      summary: 'Inspect caller rate limit quota',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 6: Public Endpoints)\n🔓 **Auth**: Public / Client-Keyed\n\nReturns remaining token bucket capacity and seconds until refresh for calling client.',
      security: [{ bearerAuth: [] }, {}],
    },
    preHandler: [publicLimitHook],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const clientKey = getClientKey(req);
    const quota = agentPromptLimiter.getQuota(clientKey);

    reply.header('X-RateLimit-Limit', quota.limit);
    reply.header('X-RateLimit-Remaining', quota.remaining);
    reply.header('X-RateLimit-Reset', quota.resetTimestamp);

    return reply.status(200).send(
      createSuccessResponse({
        limit: quota.limit,
        remaining: quota.remaining,
        resetInSeconds: quota.resetInSeconds,
      })
    );
  });
}
