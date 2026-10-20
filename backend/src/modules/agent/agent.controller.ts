import type { FastifyReply, FastifyRequest } from 'fastify';
import { PromptExecutionInputSchema } from './agent.schema.js';
import { agentService } from './agent.service.js';
import { rateLimitService } from '../rate-limit/rate-limit.service.js';
import { createSuccessResponse, createErrorResponse } from '../../utils/response.util.js';
import { tokenUtil } from '../../utils/token.util.js';
import { authService } from '../auth/auth.service.js';
import { AppError } from '../../utils/error.util.js';
import { logger } from '../../utils/logger.util.js';

export class AgentController {
  private getClientKey(req: FastifyRequest): string {
    const authHeader = req.headers.authorization;
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
    const query = req.query as { userId?: string; sessionId?: string };
    let userId = req.userId;
    if (!userId && req.headers.authorization?.startsWith('Bearer ')) {
      const token = req.headers.authorization.slice(7);
      const verified = tokenUtil.verifyJwt(token);
      if (verified.valid && verified.payload) {
        userId = (verified.payload as any).userId || verified.payload.sub;
      }
      if (!userId) {
        const session = await authService.getSession(token);
        if (session?.user?.id) {
          userId = session.user.id;
        }
      }
    }
    const models = await agentService.getAvailableModels(userId, query?.sessionId);
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

    const targetSessionId = parseResult.data.sessionId || '';
    req.raw.on('close', () => {
      const active = targetSessionId ? agentService.getActiveExecution(targetSessionId) : undefined;
      if (active) {
        if (active.isExplicitlyStopped) {
          logger.info('[AGENT_STOP] Stream closed after explicit user stop request', {
            sessionId: targetSessionId,
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

