import fs from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SandboxExecuteInputSchema } from './sandbox.schema.js';
import { sandboxService } from './sandbox.service.js';
import { createSuccessResponse } from '../../utils/response.util.js';
import { AppError } from '../../utils/error.util.js';
import { envConfig } from '../../config/env.config.js';
import { tokenUtil } from '../../utils/token.util.js';
import { logger } from '../../utils/logger.util.js';
import { antigravityQuotaService } from '../quota/antigravity-quota.service.js';
import { codexQuotaService } from '../quota/codex-quota.service.js';
import { agentService } from '../agent/agent.service.js';

export class SandboxController {
  public async getTerminalLogs(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const logs = sandboxService.getTerminalLogs();
    return reply.status(200).send(createSuccessResponse(logs));
  }

  private extractUserId(req: FastifyRequest, _explicitUserId?: string): string | null {
    if (req.userId && req.userId !== 'default_user') {
      return req.userId;
    }
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const verified = tokenUtil.verifyJwt(authHeader.substring(7));
      if (verified.valid && verified.payload?.sub && verified.payload.sub !== 'default_user') {
        return verified.payload.sub;
      }
    }
    return null;
  }

  public async getFiles(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = req.query as { sessionId?: string; sandboxId?: string; userId?: string };
    const userId = this.extractUserId(req, query?.userId);
    if (!userId) {
      return reply.status(200).send(createSuccessResponse([]));
    }
    const sessionId = query?.sessionId || 'default';
    const sandboxId = query?.sandboxId;
    const files = await sandboxService.listFiles(sessionId, userId, sandboxId);
    return reply.status(200).send(createSuccessResponse(files));
  }

  public async getFileContent(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = req.query as { path?: string; sessionId?: string; sandboxId?: string; userId?: string };
    const userId = this.extractUserId(req, query?.userId);
    if (!userId) {
      throw new AppError('Authentication required: Sign in to inspect sandbox files', 401, 'UNAUTHORIZED');
    }
    const filePath = query?.path;
    if (!filePath) {
      throw new AppError('File path is required', 400, 'VALIDATION_ERROR');
    }
    const sessionId = query?.sessionId || 'default';
    const sandboxId = query?.sandboxId;
    try {
      const activeSb = sandboxId || sandboxService.getActiveSandboxId(sessionId, userId);
      if (!activeSb && !sandboxService.hasActiveSandbox(sessionId, userId)) {
        throw new AppError('No active sandbox VM is running for this session. Please click "Start Sandbox VM".', 404, 'NO_SANDBOX_RUNNING');
      }

      const ext = path.extname(filePath).toLowerCase().replace('.', '');
      const isRasterImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'].includes(ext);
      const isSvg = ext === 'svg';

      const content = await sandboxService.readFile(sessionId, filePath, undefined, sandboxId);

      if (isRasterImage) {
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        // content is already base64 from provider readFile
        const base64 = content.startsWith('data:') ? content.split(',')[1] : content;
        return reply.status(200).send(
          createSuccessResponse({
            path: filePath,
            content: `data:${mime};base64,${base64}`,
            dataUrl: `data:${mime};base64,${base64}`,
            isImage: true,
            isSvg: false,
            mimeType: mime,
            size: Buffer.byteLength(base64, 'base64'),
          })
        );
      }

      if (isSvg) {
        const base64 = Buffer.from(content, 'utf8').toString('base64');
        return reply.status(200).send(
          createSuccessResponse({
            path: filePath,
            content,
            dataUrl: `data:image/svg+xml;base64,${base64}`,
            isImage: true,
            isSvg: true,
            mimeType: 'image/svg+xml',
            size: Buffer.byteLength(content, 'utf8'),
          })
        );
      }

      return reply.status(200).send(createSuccessResponse({ path: filePath, content, isImage: false, isSvg: false }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AppError(msg, 404, 'FILE_NOT_FOUND');
    }
  }

  public async executeInSandbox(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parseResult = SandboxExecuteInputSchema.safeParse(req.body);

    if (!parseResult.success) {
      throw new AppError('Validation failed', 400, 'VALIDATION_ERROR', parseResult.error.format());
    }

    const result = await sandboxService.executeInSandbox(parseResult.data);
    return reply.status(200).send(createSuccessResponse(result));
  }

  public async getUsage(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = req.query as { userId?: string; activeSessionIds?: string };
    const userId = this.extractUserId(req, query?.userId);

    // Strict Multi-Tenant Isolation: Sandboxes belong ONLY to the user who created them.
    // If not authenticated or default_user, return empty quota with 0 sandboxes.
    if (!userId) {
      const max = envConfig.MAX_SANDBOXES_PER_USER ?? 3;
      return reply.status(200).send(createSuccessResponse({ used: 0, max, sandboxes: [] }));
    }

    await sandboxService.syncWithCloud(userId).catch(() => {});
    if (typeof query?.activeSessionIds === 'string') {
      const ids = query.activeSessionIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      sandboxService.syncActiveSessions(ids, userId);
    }
    const usage = sandboxService.getSandboxUsage(userId);
    return reply.status(200).send(createSuccessResponse(usage));
  }

  public async attachSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = req.body as { sessionId?: string; sandboxId?: string; userId?: string };
    if (!body?.sessionId || !body?.sandboxId) {
      throw new AppError('Both sessionId and sandboxId are required', 400, 'VALIDATION_ERROR');
    }
    const userId = this.extractUserId(req, body.userId);
    if (!userId) {
      throw new AppError('Authentication required: Please sign in to connect to cloud sandboxes.', 401, 'UNAUTHORIZED');
    }
    const success = sandboxService.attachSessionToSandbox(body.sessionId, body.sandboxId, userId);
    if (!success) {
      throw new AppError(`Sandbox ${body.sandboxId} not found or unauthorized to attach session`, 404, 'NOT_FOUND');
    }
    logger.info('[Sandbox] Session attached to sandbox', { sessionId: body.sessionId, sandboxId: body.sandboxId, userId });

    // Invalidate model discovery and quota limits so fresh values from newly attached sandbox are retrieved
    agentService.invalidateSandboxModels(body.sandboxId);
    antigravityQuotaService.invalidateUserQuota(userId);
    codexQuotaService.invalidateUserQuota(userId);

    const usage = sandboxService.getSandboxUsage(userId);
    return reply.status(200).send(createSuccessResponse({ success: true, sandboxId: body.sandboxId, usage }));
  }

  public async createSandbox(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = (req.body as { sessionId?: string; userId?: string; replaceOldest?: boolean }) || {};
    const userId = this.extractUserId(req, body.userId);
    if (!userId) {
      logger.warn('[Sandbox] Unauthorized sandbox creation attempt: user not authenticated');
      throw new AppError('Authentication required: Please sign in to create a personal cloud sandbox.', 401, 'UNAUTHORIZED');
    }
    const sessionId = body.sessionId || 'default';
    logger.info('[Sandbox] Received request to provision new cloud microVM', { sessionId, userId });
    try {
      const sandboxId = await sandboxService.getOrCreateSandbox(sessionId, userId, 'new', body.replaceOldest);
      const usage = sandboxService.getSandboxUsage(userId);
      logger.info('[Sandbox] Successfully provisioned cloud microVM', { sandboxId, sessionId, userId, used: usage.used, max: usage.max });

      // Invalidate model discovery and quota limits
      agentService.invalidateSandboxModels(sandboxId);
      antigravityQuotaService.invalidateUserQuota(userId);
      codexQuotaService.invalidateUserQuota(userId);

      return reply.status(201).send(createSuccessResponse({ sandboxId, usage }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[Sandbox] Failed to provision cloud microVM', err, { sessionId, userId });
      throw new AppError(msg, 400, 'SANDBOX_CREATION_FAILED');
    }
  }

  public async detachSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = req.query as { sessionId?: string; userId?: string };
    const body = (req.body as { sessionId?: string; userId?: string }) || {};
    const sessionId = query?.sessionId || body.sessionId;
    const userId = this.extractUserId(req, query?.userId || body.userId) || undefined;
    if (!sessionId) {
      throw new AppError('sessionId is required to detach session', 400, 'VALIDATION_ERROR');
    }
    logger.info('[Sandbox] Detaching session from sandbox', { sessionId, userId });
    const detached = sandboxService.detachSession(sessionId);
    const usage = sandboxService.getSandboxUsage(userId);
    return reply.status(200).send(createSuccessResponse({ success: detached, sessionId, usage }));
  }

  public async deleteSandbox(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = req.query as { sessionId?: string; sandboxId?: string; clearAllSessions?: string; userId?: string };
    const body = (req.body as { sessionId?: string; sandboxId?: string; clearAllSessions?: boolean; userId?: string }) || {};
    const sandboxId = query?.sandboxId || body.sandboxId;
    const sessionId = query?.sessionId || body.sessionId;
    const userId = this.extractUserId(req, query?.userId || body.userId);

    if (!userId) {
      throw new AppError('Authentication required: Sign in to delete or manage sandboxes.', 401, 'UNAUTHORIZED');
    }

    const clearAll = query?.clearAllSessions === 'true' || body.clearAllSessions === true || sessionId === 'all';

    if (sandboxId) {
      logger.info('[Sandbox] Terminating cloud sandbox', { sandboxId, userId });
      await sandboxService.destroySandbox(sandboxId);
      const usage = sandboxService.getSandboxUsage(userId);
      logger.info('[Sandbox] Cloud sandbox terminated and quota slot released', { sandboxId, userId, used: usage.used, max: usage.max });
      return reply.status(200).send(
        createSuccessResponse({
          message: `Sandbox ${sandboxId} deleted successfully. Quota slot released.`,
          usage,
        })
      );
    }

    if (clearAll) {
      sandboxService.clearAllAttachedSessions(userId);
      if (sessionId && sessionId !== 'all') {
        sandboxService.detachSession(sessionId, userId);
      }
      const usage = sandboxService.getSandboxUsage(userId);
      return reply.status(200).send(
        createSuccessResponse({
          message: 'All sessions detached from sandboxes.',
          detached: true,
          usage,
        })
      );
    }

    if (sessionId) {
      const detached = sandboxService.detachSession(sessionId, userId);
      const usage = sandboxService.getSandboxUsage(userId);
      return reply.status(200).send(
        createSuccessResponse({
          message: `Session ${sessionId} detached from sandbox. Workspace preserved.`,
          detached,
          usage,
        })
      );
    }

    throw new AppError('Either sandboxId or sessionId is required', 400, 'VALIDATION_ERROR');
  }
}

export const sandboxController = new SandboxController();
