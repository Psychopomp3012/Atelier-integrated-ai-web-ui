import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { antigravityQuotaService } from './antigravity-quota.service.js';
import { codexQuotaService } from './codex-quota.service.js';
import { createSuccessResponse } from '../../utils/response.util.js';
import { tokenUtil } from '../../utils/token.util.js';
import { authService, getStableUserId } from '../auth/auth.service.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import {
  mutationLimitHook,
  readApiLimitHook,
} from '../../middleware/rate-limit.middleware.js';
import type { RecordTurnInput, UnifiedQuotaStats } from './quota.types.js';

async function resolveUserFromRequest(request: FastifyRequest): Promise<{ userId?: string; userEmail?: string }> {
  const query = request.query as { userEmail?: string; sessionId?: string; userId?: string };
  const authHeader = request.headers.authorization;
  let userId = request.userId || query?.userId;
  let userEmail = request.userEmail || query?.userEmail;

  if (!userId && authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const session = await authService.getSession(token);
    if (session?.user?.id) userId = session.user.id;
    if (session?.user?.email && !userEmail) userEmail = session.user.email;

    if (!userId) {
      const verified = tokenUtil.verifyJwt(token);
      if (verified.valid && verified.payload) {
        userId = (verified.payload as any).userId || verified.payload.sub;
        if (!userEmail && (verified.payload as any).email) {
          userEmail = (verified.payload as any).email;
        }
      }
    }
  }

  if (!userId && userEmail) {
    userId = getStableUserId(userEmail);
  }

  return { userId, userEmail };
}

export const quotaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/quota', {
    schema: {
      tags: ['Quota'],
      summary: 'Get unified quota stats for all linked AI CLIs',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 5: Read APIs)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nLive discovery of Antigravity and Codex subscription turn counts, limits, and reset windows in a single payload.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          userEmail: { type: 'string' },
          sessionId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth],
    preHandler: [readApiLimitHook],
  }, async (request, reply) => {
    const { userId, userEmail } = await resolveUserFromRequest(request);
    const query = request.query as { sessionId?: string };

    const [antigravity, codex] = await Promise.all([
      antigravityQuotaService.getAntigravityQuota(userEmail, query?.sessionId, userId),
      codexQuotaService.getCodexQuota(userEmail, query?.sessionId, userId),
    ]);

    const stats: UnifiedQuotaStats = {
      antigravity,
      codex,
    };

    return reply.status(200).send(createSuccessResponse(stats));
  });

  fastify.post('/api/v1/quota/antigravity/record', {
    schema: {
      tags: ['Quota'],
      summary: 'Record turn execution for Antigravity',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nIncrements usage turn count for specified model.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          model: { type: 'string', minLength: 1 },
          durationMs: { type: 'number' },
          tokens: { type: 'number' },
        },
        required: ['model'],
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth],
    preHandler: [mutationLimitHook],
  }, async (request, reply) => {
    const body = request.body as RecordTurnInput;
    if (!body?.model) {
      return reply.status(400).send({ success: false, error: 'Model is required' });
    }
    const updated = await antigravityQuotaService.recordTurn(body);
    return reply.status(200).send(createSuccessResponse(updated));
  });

  fastify.post('/api/v1/quota/codex/record', {
    schema: {
      tags: ['Quota'],
      summary: 'Record turn execution for Codex',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nIncrements usage turn count for specified Codex model.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          model: { type: 'string', minLength: 1 },
          durationMs: { type: 'number' },
          tokens: { type: 'number' },
        },
        required: ['model'],
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth],
    preHandler: [mutationLimitHook],
  }, async (request, reply) => {
    const body = request.body as RecordTurnInput;
    if (!body?.model) {
      return reply.status(400).send({ success: false, error: 'Model is required' });
    }
    const updated = await codexQuotaService.recordTurn(body);
    return reply.status(200).send(createSuccessResponse(updated));
  });
};
