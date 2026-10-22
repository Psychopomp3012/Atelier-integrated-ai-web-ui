import type { FastifyReply, FastifyRequest } from 'fastify';
import { PromptExecutionInputSchema } from './agent.schema.js';
import { agentService } from './agent.service.js';
import { rateLimitService } from '../rate-limit/rate-limit.service.js';
import { createSuccessResponse, createErrorResponse } from '../../utils/response.util.js';
import { sandboxService } from '../sandbox/sandbox.service.js';
import { firestoreBackendService } from '../../services/firestore.service.js';
import { AppError } from '../../utils/error.util.js';
import { logger } from '../../utils/logger.util.js';

export class AgentController {
  private getClientKey(req: FastifyRequest): string {
    return req.userId ? `user:${req.userId}` : this.getFallbackClientKey(req);
  }

  private getFallbackClientKey(req: FastifyRequest): string {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return `user:${authHeader.slice(7)}`;
    }
    const forwarded = req.headers['x-forwarded-for'];
    const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.ip;
    return `ip:${ip || '127.0.0.1'}`;
  }

  public async getModels(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = req.userId;
    if (!userId) {
      throw new AppError('Authentication required: Missing or invalid Authorization Bearer token', 401, 'UNAUTHORIZED');
    }

    const models = await agentService.getAvailableModels(userId);
    return reply.status(200).send(createSuccessResponse(models));
  }

  public async executePromptStream(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const clientKey = this.getClientKey(req);
    const rateStatus = rateLimitService.getQuota(clientKey);

    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    const parseResult = PromptExecutionInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      reply.raw.writeHead(400, { 'Content-Type': 'application/json' });
      reply.raw.end(
        JSON.stringify(
          createErrorResponse('VALIDATION_ERROR', 'Validation failed', parseResult.error.format())
        )
      );
      return;
    }

    // Bind authenticated userId to prompt execution input
    if (req.userId) {
      parseResult.data.userId = req.userId;
    }

    // Phase 4: Endpoint Security & Resource Legitimacy Guard
    const targetUserId = req.userId;
    const targetSessionId = parseResult.data.sessionId;
    const targetSandboxId = parseResult.data.sandboxId;

    if (targetUserId && targetSessionId) {
      const isOwned = await firestoreBackendService.verifySessionOwnership(targetUserId, targetSessionId);
      if (!isOwned) {
        reply.raw.writeHead(403, { 'Content-Type': 'application/json' });
        reply.raw.end(
          JSON.stringify(
            createErrorResponse('UNAUTHORIZED_SESSION', 'Access denied: You do not own this session')
          )
        );
        return;
      }
    }

    const effectiveSandboxId = targetSandboxId || (targetSessionId ? sandboxService.getActiveSandboxId(targetSessionId, targetUserId) : null) || undefined;
    if (!effectiveSandboxId) {
      reply.raw.writeHead(400, { 'Content-Type': 'application/json' });
      reply.raw.end(
        JSON.stringify(
          createErrorResponse('NO_ACTIVE_SANDBOX', 'No cloud sandbox is attached to this session. Please select an active sandbox from the top bar before executing prompts.')
        )
      );
      return;
    }

    if (targetUserId) {
      try {
        await sandboxService.verifyAndReactivateSandbox(effectiveSandboxId, targetUserId, targetSessionId);
      } catch (sbErr: any) {
        reply.raw.writeHead(403, { 'Content-Type': 'application/json' });
        reply.raw.end(
          JSON.stringify(
            createErrorResponse('UNAUTHORIZED_RESOURCE', sbErr?.message || 'Access denied: You do not own this sandbox')
          )
        );
        return;
      }
    }

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendEvent = (event: string, data: any) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const streamSessionId = targetSessionId || '';
    req.raw.on('close', () => {
      const active = streamSessionId ? agentService.getActiveExecution(streamSessionId) : undefined;
      if (active) {
        if (active.isExplicitlyStopped) {
          logger.info('[AGENT_STOP] Stream closed after explicit user stop request', {
            sessionId: streamSessionId,
            executionId: active.executionId,
          });
        } else {
          active.isClientDisconnected = true;
          logger.info('[STREAM_DISCONNECT] Client HTTP stream closed prematurely (tab closed or reloaded). MicroVM execution will continue in background and response will be persisted to Firestore.', {
            sessionId: targetSessionId,
            executionId: active.executionId,
          });
        }
      }
    });

    try {
      await agentService.executePromptStream(parseResult.data, token, (event) => {
        if (reply.raw.destroyed || reply.raw.writableEnded) return;
        if (event.type === 'start') {
          sendEvent('start', { sessionId: event.sessionId, model: event.model });
        } else if (event.type === 'step') {
          sendEvent('step', event.step);
        } else if (event.type === 'token') {
          sendEvent('token', { token: event.token });
        } else if (event.type === 'done') {
          sendEvent('done', {
            ...event.response,
            codexQuota: event.codexQuota,
            geminiQuota: event.geminiQuota,
            sandboxUsage: event.sandboxUsage,
            rateLimit: {
              limit: rateStatus.limit,
              remaining: rateStatus.remaining,
              resetInSeconds: rateStatus.resetInSeconds,
            },
          });
        }
      });
    } catch (err: any) {
      logger.error('Prompt streaming execution failed', err, {
        sessionId: parseResult?.data?.sessionId,
        selectedModel: parseResult?.data?.selectedModel,
        promptPreview: parseResult?.data?.prompt?.slice(0, 50),
        errorMessage: err?.message,
        stack: err?.stack,
      });
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        sendEvent('error', {
          message: err?.message || 'Streaming failed',
          code: err?.code || 'EXECUTION_ERROR',
        });
      }
    } finally {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) {
        reply.raw.end();
      }
    }
  }

  public async stopExecution(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = req.body as { sessionId?: string };
    if (!body?.sessionId) {
      reply.status(400).send(createErrorResponse('VALIDATION_ERROR', 'sessionId is required to stop agent execution'));
      return;
    }
    const result = await agentService.stopAgentStream(body.sessionId);
    reply.status(200).send(createSuccessResponse(result));
  }
}

export const agentController = new AgentController();

