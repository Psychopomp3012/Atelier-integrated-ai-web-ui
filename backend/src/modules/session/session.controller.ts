import type { FastifyReply, FastifyRequest } from 'fastify';
import { sessionService } from './session.service.js';
import type { ChatSession } from './session.types.js';
import { tokenUtil } from '../../utils/token.util.js';
import { createSuccessResponse } from '../../utils/response.util.js';
import { AppError } from '../../utils/error.util.js';

export class SessionController {
  private getUserId(req: FastifyRequest): string {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const verified = tokenUtil.verifyJwt(token);
      if (verified.valid && verified.payload?.sub) {
        return verified.payload.sub;
      }
    }
    const query = req.query as { userId?: string };
    if (query?.userId && query.userId !== 'default_user') {
      return query.userId;
    }
    throw new AppError('Authentication required: Sign in to access personal chat sessions', 401, 'UNAUTHORIZED');
  }

  public async getSessions(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = this.getUserId(req);
    const sessions = await sessionService.getUserSessions(userId);
    return reply.status(200).send(createSuccessResponse(sessions));
  }

  public async saveSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = this.getUserId(req);
    const body = req.body as Partial<ChatSession>;
    if (!body || typeof body !== 'object') {
      throw new AppError('Session payload is required', 400, 'VALIDATION_ERROR');
    }

    const saved = await sessionService.saveUserSession(userId, body as ChatSession);
    return reply.status(200).send(createSuccessResponse(saved));
  }

  public async getSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = this.getUserId(req);
    const params = req.params as { id: string };
    if (!params?.id) {
      throw new AppError('Session ID is required', 400, 'VALIDATION_ERROR');
    }

    const session = await sessionService.getSessionById(userId, params.id);
    if (!session) {
      throw new AppError(`Session ${params.id} not found`, 404, 'NOT_FOUND');
    }
    return reply.status(200).send(createSuccessResponse(session));
  }

  public async deleteSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = this.getUserId(req);
    const params = req.params as { id: string };
    if (!params?.id) {
      throw new AppError('Session ID is required', 400, 'VALIDATION_ERROR');
    }

    const deleted = await sessionService.deleteUserSession(userId, params.id);
    return reply.status(200).send(createSuccessResponse({ success: deleted, sessionId: params.id }));
  }
}

export const sessionController = new SessionController();
