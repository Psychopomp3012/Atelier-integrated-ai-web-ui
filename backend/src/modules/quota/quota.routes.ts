import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { antigravityQuotaService } from './antigravity-quota.service.js';
import { codexQuotaService } from './codex-quota.service.js';
import { createSuccessResponse } from '../../utils/response.util.js';
import { tokenUtil } from '../../utils/token.util.js';
import { authService, getStableUserId } from '../auth/auth.service.js';
import { requireAuth, optionalAuth } from '../../middleware/auth.middleware.js';
import {
  mutationLimitHook,
  readApiLimitHook,
} from '../../middleware/rate-limit.middleware.js';
import type { RecordTurnInput } from './quota.types.js';

export const quotaRoutes: FastifyPluginAsync = async (fastify) => {
  const handleAntigravityQuota = async (request: FastifyRequest, reply: FastifyReply) => {
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

    const stats = await antigravityQuotaService.getAntigravityQuota(userEmail, query?.sessionId, userId);
    return reply.status(200).send(createSuccessResponse(stats));
  };

  const handleAntigravityRecord = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as RecordTurnInput;
    if (!body?.model) {
      return reply.status(400).send({ success: false, error: 'Model is required' });
    }
    const updated = await antigravityQuotaService.recordTurn(body);
    return reply.status(200).send(createSuccessResponse(updated));
  };

  fastify.get('/api/v1/quota/antigravity', {
    schema: {
      tags: ['Quota'],
      summary: 'Get Google Antigravity quota stats',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 5: Read APIs)\n🔓 **Auth**: Optional (`Bearer <JWT>`)\n\nLive discovery of Antigravity subscription quotas, turn counts, and model reset windows.',
      security: [{ bearerAuth: [] }, {}],
      querystring: {
        type: 'object',
        properties: {
          userEmail: { type: 'string' },
          sessionId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    preValidation: [optionalAuth],
    preHandler: [readApiLimitHook],
  }, handleAntigravityQuota);

  fastify.get('/api/v1/quota/gemini', {
    schema: {
      tags: ['Quota'],
      summary: 'Get Google Gemini quota stats (alias)',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 5: Read APIs)\n🔓 **Auth**: Optional (`Bearer <JWT>`)\n\nAlias for /api/v1/quota/antigravity.',
      security: [{ bearerAuth: [] }, {}],
      querystring: {
        type: 'object',
        properties: {
          userEmail: { type: 'string' },
          sessionId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    preValidation: [optionalAuth],
    preHandler: [readApiLimitHook],
  }, handleAntigravityQuota);

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
  }, handleAntigravityRecord);

  fastify.post('/api/v1/quota/gemini/record', {
    schema: {
      tags: ['Quota'],
      summary: 'Record turn execution for Gemini (alias)',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nAlias for /api/v1/quota/antigravity/record.',
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
  }, handleAntigravityRecord);

  fastify.get('/api/v1/quota/codex', {
    schema: {
      tags: ['Quota'],
      summary: 'Get OpenAI Codex quota stats',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 5: Read APIs)\n🔓 **Auth**: Optional (`Bearer <JWT>`)\n\nLive discovery of Codex subscription turn counts and weekly rate limits.',
      security: [{ bearerAuth: [] }, {}],
      querystring: {
        type: 'object',
        properties: {
          userEmail: { type: 'string' },
          sessionId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    preValidation: [optionalAuth],
    preHandler: [readApiLimitHook],
  }, async (request, reply) => {
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

    const stats = await codexQuotaService.getCodexQuota(userEmail, query?.sessionId, userId);
    return reply.status(200).send(createSuccessResponse(stats));
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
