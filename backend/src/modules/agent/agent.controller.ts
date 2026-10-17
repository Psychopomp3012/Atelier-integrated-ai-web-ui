import type { FastifyReply, FastifyRequest } from 'fastify';
import { PromptExecutionInputSchema } from './agent.schema.js';
import { agentService } from './agent.service.js';
import { rateLimitService } from '../rate-limit/rate-limit.service.js';
import { createSuccessResponse, createErrorResponse } from '../../utils/response.util.js';
import { tokenUtil } from '../../utils/token.util.js';
import { authService } from '../auth/auth.service.js';
import { AppError } from '../../utils/error.util.js';

export class AgentController {
  private getClientKey(req: FastifyRequest): string {
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
    const authHeader = req.headers.authorization;
    let userId = query?.userId;
    if (!userId && authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
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

  public async getQuota(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const clientKey = this.getClientKey(req);
    const quota = rateLimitService.getQuota(clientKey);

    reply.header('X-RateLimit-Limit', quota.limit);
    reply.header('X-RateLimit-Remaining', quota.remaining);
    reply.header('X-RateLimit-Reset', quota.resetTimestamp);

    return reply.status(200).send(
      createSuccessResponse(
        {
          limit: quota.limit,
          remaining: quota.remaining,
          resetInSeconds: quota.resetInSeconds,
        },
        undefined,
        {
          limit: quota.limit,
          remaining: quota.remaining,
          resetInSeconds: quota.resetInSeconds,
        }
      )
    );
  }

  public async executePrompt(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const clientKey = this.getClientKey(req);
    const rateStatus = rateLimitService.consume(clientKey);

    reply.header('X-RateLimit-Limit', rateStatus.limit);
    reply.header('X-RateLimit-Remaining', rateStatus.remaining);
    reply.header('X-RateLimit-Reset', rateStatus.resetTimestamp);

    if (!rateStatus.allowed) {
      reply.header('Retry-After', rateStatus.resetInSeconds);
      return reply.status(429).send(
        createErrorResponse(
          'RATE_LIMIT_EXCEEDED',
          `Rate limit exceeded. You have reached your quota of ${rateStatus.limit} requests per minute. Please wait ${rateStatus.resetInSeconds} seconds before sending another prompt.`,
          {
            limit: rateStatus.limit,
            remaining: 0,
            resetInSeconds: rateStatus.resetInSeconds,
            retryAfter: rateStatus.resetInSeconds,
          },
          {
            limit: rateStatus.limit,
            remaining: 0,
            resetInSeconds: rateStatus.resetInSeconds,
          }
        )
      );
    }

    const parseResult = PromptExecutionInputSchema.safeParse(req.body);

    if (!parseResult.success) {
      throw new AppError('Validation failed', 400, 'VALIDATION_ERROR', parseResult.error.format());
    }

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    const result = await agentService.executePrompt(parseResult.data, token);

    return reply.status(200).send(
      createSuccessResponse(result, undefined, {
        limit: rateStatus.limit,
        remaining: rateStatus.remaining,
        resetInSeconds: rateStatus.resetInSeconds,
      })
    );
  }

  public async executePromptStream(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const clientKey = this.getClientKey(req);
    const rateStatus = rateLimitService.consume(clientKey);

    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (!rateStatus.allowed) {
      reply.raw.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(rateStatus.resetInSeconds),
      });
      reply.raw.end(
        JSON.stringify(
          createErrorResponse(
            'RATE_LIMIT_EXCEEDED',
            `Rate limit exceeded. Please wait ${rateStatus.resetInSeconds} seconds.`,
            { retryAfter: rateStatus.resetInSeconds }
          )
        )
      );
      return;
    }

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
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        sendEvent('error', { message: err?.message || 'Streaming failed' });
      }
    } finally {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) {
        reply.raw.end();
      }
    }
  }
}

export const agentController = new AgentController();

