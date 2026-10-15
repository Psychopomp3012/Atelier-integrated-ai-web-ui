import type { FastifyPluginAsync } from 'fastify';
import { geminiQuotaService } from './gemini-quota.service.js';
import { codexQuotaService } from './codex-quota.service.js';
import { createSuccessResponse } from '../../utils/response.util.js';
import type { RecordTurnInput } from './quota.types.js';

export const quotaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/quota/gemini', async (request, reply) => {
    const query = request.query as { userEmail?: string; sessionId?: string };
    const stats = await geminiQuotaService.getGeminiQuota(query?.userEmail, query?.sessionId);
    return reply.status(200).send(createSuccessResponse(stats));
  });

  fastify.post('/api/v1/quota/gemini/record', async (request, reply) => {
    const body = request.body as RecordTurnInput;
    if (!body?.model) {
      return reply.status(400).send({ success: false, error: 'Model is required' });
    }
    const updated = await geminiQuotaService.recordTurn(body);
    return reply.status(200).send(createSuccessResponse(updated));
  });

  fastify.get('/api/v1/quota/codex', async (request, reply) => {
    const query = request.query as { userEmail?: string; sessionId?: string };
    const stats = await codexQuotaService.getCodexQuota(query?.userEmail, query?.sessionId);
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
