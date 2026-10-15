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
      throw new AppError('Invalid Google login payload', 400, 'VALIDATION_ERROR', parseResult.error.format());
    }

    const session = await authService.loginWithGoogle(parseResult.data);
    return reply.status(200).send(createSuccessResponse(session));
  }

  public async loginCli(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const session = await authService.loginWithCliAccount();
    return reply.status(200).send(createSuccessResponse(session));
  }

  public async refreshToken(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    if (!token) {
      throw new AppError('Authorization token required for refresh', 401, 'UNAUTHORIZED');
    }

    const session = await authService.refreshToken(token);
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
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
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
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    if (!token) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    const session = await authService.getSession(token);
    if (!session) {
      throw new AppError('Invalid or expired session', 401, 'UNAUTHORIZED');
    }

    return reply.status(200).send(createSuccessResponse(session.user));
  }

  public async connectPlatform(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
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

  public async logout(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    if (token) {
      await authService.logout(token);
    }
    return reply.status(200).send(createSuccessResponse({ loggedOut: true }));
  }
}

export const authController = new AuthController();
