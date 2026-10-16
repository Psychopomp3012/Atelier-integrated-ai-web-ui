import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { antigravityQuotaService } from './antigravity-quota.service.js';
import { codexQuotaService } from './codex-quota.service.js';
import { createSuccessResponse } from '../../utils/response.util.js';
import { tokenUtil } from '../../utils/token.util.js';
import { authService, getStableUserId } from '../auth/auth.service.js';
import type { RecordTurnInput } from './quota.types.js';

export const quotaRoutes: FastifyPluginAsync = async (fastify) => {
  const handleAntigravityQuota = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { userEmail?: string; sessionId?: string };
    const authHeader = request.headers.authorization;
    let userId: string | undefined;
    let userEmail = query?.userEmail;

    if (authHeader && authHeader.startsWith('Bearer ')) {
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

  fastify.get('/api/v1/quota/antigravity', handleAntigravityQuota);
  fastify.get('/api/v1/quota/gemini', handleAntigravityQuota);

  fastify.post('/api/v1/quota/antigravity/record', handleAntigravityRecord);
  fastify.post('/api/v1/quota/gemini/record', handleAntigravityRecord);

  fastify.get('/api/v1/quota/codex', async (request, reply) => {
    const query = request.query as { userEmail?: string; sessionId?: string };
    const authHeader = request.headers.authorization;
    let userId: string | undefined;
    let userEmail = query?.userEmail;

    if (authHeader && authHeader.startsWith('Bearer ')) {
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

  fastify.post('/api/v1/quota/codex/record', async (request, reply) => {
    const body = request.body as RecordTurnInput;
    if (!body?.model) {
      return reply.status(400).send({ success: false, error: 'Model is required' });
    }
    const updated = await codexQuotaService.recordTurn(body);
    return reply.status(200).send(createSuccessResponse(updated));
  });
};
