import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ConnectPlatformSchema,
  DeviceAuthInitiateSchema,
  DeviceAuthVerifySchema,
  GoogleLoginSchema,
  LoginWithPlatformSchema,
} from './auth.schema.js';
import { authService } from './auth.service.js';
import { createSuccessResponse } from '../../utils/response.util.js';
import { AppError } from '../../utils/error.util.js';
import { envConfig } from '../../config/env.config.js';
import { tokenUtil } from '../../utils/token.util.js';
import { firestoreBackendService } from '../../services/firestore.service.js';
import { sandboxService } from '../sandbox/sandbox.service.js';
import { logger } from '../../utils/logger.util.js';

export class AuthController {
  public async getConfig(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    return reply.status(200).send(
      createSuccessResponse({
        googleClientId: envConfig.GOOGLE_CLIENT_ID || '',
      })
    );
  }

  public async loginGoogle(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parseResult = GoogleLoginSchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.warn('[Auth] Google login payload validation failed', { errors: parseResult.error.format() });
      throw new AppError('Invalid Google login payload', 400, 'VALIDATION_ERROR', parseResult.error.format());
    }

    logger.info('[Auth] Initiating Google login', { email: parseResult.data.email });
    const session = await authService.loginWithGoogle(parseResult.data);
    logger.info('[Auth] Google login resolved session', { userId: session.user.id, email: session.user.email });
    if (session.user?.id) {
      sandboxService.invalidateUserCredentialHash(session.user.id);
      sandboxService.syncCredentialsToUserSandboxes(session.user.id, true).catch(() => {});
    }
    return reply.status(200).send(createSuccessResponse(session));
  }

  public async loginCli(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const session = await authService.loginWithCliAccount();
    if (session.user?.id) {
      sandboxService.invalidateUserCredentialHash(session.user.id);
      sandboxService.syncCredentialsToUserSandboxes(session.user.id, true).catch(() => {});
    }
    return reply.status(200).send(createSuccessResponse(session));
  }

  public async initiateDeviceAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parseResult = DeviceAuthInitiateSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError('Invalid device auth initiation payload', 400, 'VALIDATION_ERROR', parseResult.error.format());
    }

    const result = await authService.initiateDeviceAuth(parseResult.data.platform);
    return reply.status(200).send(createSuccessResponse(result));
  }

  public async verifyDeviceAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = req.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : null);
    if (!token) {
      throw new AppError('Authentication required to link subscriptions', 401, 'UNAUTHORIZED');
    }

    const parseResult = DeviceAuthVerifySchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError('Invalid device auth verification payload', 400, 'VALIDATION_ERROR', parseResult.error.format());
    }

    const updatedUser = await authService.verifyDeviceAuth(
      token,
      parseResult.data.deviceCode,
      parseResult.data.platform
    );
    return reply.status(200).send(createSuccessResponse(updatedUser));
  }

  public async login(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parseResult = LoginWithPlatformSchema.safeParse(req.body);

    if (!parseResult.success) {
      throw new AppError('Invalid login payload', 400, 'VALIDATION_ERROR', parseResult.error.format());
    }

    const session = await authService.loginWithPlatform(parseResult.data);
    return reply.status(200).send(createSuccessResponse(session));
  }

  public async getMe(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = req.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : null);
    if (!token) {
      logger.warn('[Auth] getMe rejected: Missing or invalid Authorization Bearer header');
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    const session = await authService.getSession(token);
    if (!session) {
      logger.warn('[Auth] getMe rejected: Invalid or expired session for provided token');
      throw new AppError('Invalid or expired session', 401, 'UNAUTHORIZED');
    }

    if (session.user && !Array.isArray(session.user.linkedPlatforms)) {
      session.user.linkedPlatforms = [];
    }

    return reply.status(200).send(createSuccessResponse(session.user));
  }

  public async connectPlatform(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = req.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : null);
    if (!token) {
      throw new AppError('Authentication required to link platforms', 401, 'UNAUTHORIZED');
    }

    const parseResult = ConnectPlatformSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError('Invalid platform connect payload', 400, 'VALIDATION_ERROR', parseResult.error.format());
    }

    const updatedUser = await authService.connectPlatform(token, parseResult.data);
    return reply.status(200).send(createSuccessResponse(updatedUser));
  }

  public async syncProfile(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = req.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : null);
    if (!token) {
      throw new AppError('Authentication required to sync profile', 401, 'UNAUTHORIZED');
    }
    const userId = req.userId || (() => {
      const verified = tokenUtil.verifyJwt(token);
      if (!verified.valid || !verified.payload?.sub) {
        throw new AppError('Invalid authentication token', 401, 'UNAUTHORIZED');
      }
      return verified.payload.sub;
    })();

    const body = (req.body || {}) as any;
    const linkedPlatforms = Array.isArray(body.linkedPlatforms)
      ? body.linkedPlatforms
      : typeof body.linkedPlatforms === 'object' && body.linkedPlatforms !== null
      ? Object.values(body.linkedPlatforms).filter((p: any) => Boolean(p && typeof p === 'object' && 'platform' in p))
      : [];

    await firestoreBackendService.syncUserProfile({
      id: userId,
      name: body.name,
      email: body.email,
      avatarUrl: body.avatarUrl,
      primaryPlatform: body.primaryPlatform,
      linkedPlatforms,
      lastLoginAt: new Date().toISOString(),
    });
    return reply.status(200).send(createSuccessResponse({ synced: true }));
  }

  public async logout(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = (req as any).token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : null);
    if (token) {
      const session = await authService.getSession(token);
      if (session?.user?.id) {
        sandboxService.invalidateUserCredentialHash(session.user.id);
      }
      await authService.logout(token);
    }
    return reply.status(200).send(createSuccessResponse({ loggedOut: true }));
  }
}

export const authController = new AuthController();
