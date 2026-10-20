import type { FastifyReply, FastifyRequest } from 'fastify';
import { tokenUtil } from '../utils/token.util.js';
import { AppError } from '../utils/error.util.js';
import {
  RateLimitService,
  sandboxProvisionLimiter,
  agentPromptLimiter,
  authSensitiveLimiter,
  mutationLimiter,
  readApiLimiter,
  publicLimiter,
} from '../modules/rate-limit/rate-limit.service.js';

/**
 * Resolves a unique client key for rate limiting.
 * If the user is authenticated (via req.userId or valid Bearer JWT), keys by user ID to guarantee multi-tenant fairness.
 * Otherwise, keys by client IP address.
 */
export function getClientKey(req: FastifyRequest): string {
  if (req.userId) {
    return `user:${req.userId}`;
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token) {
      const verified = tokenUtil.verifyJwt(token);
      if (verified.valid && verified.payload?.sub) {
        return `user:${verified.payload.sub}`;
      }
      return `tok:${token.slice(0, 32)}`;
    }
  }

  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.ip;
  return `ip:${ip || '127.0.0.1'}`;
}

/**
 * Factory creating a Fastify preHandler hook from any RateLimitService instance.
 * Automatically injects standard rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset)
 * and sets Retry-After with a 429 AppError if quota is exceeded.
 */
export function createRateLimitHook(limiter: RateLimitService) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const clientKey = getClientKey(req);
    const result = limiter.consume(clientKey);

    reply.header('X-RateLimit-Limit', result.limit);
    reply.header('X-RateLimit-Remaining', result.remaining);
    reply.header('X-RateLimit-Reset', result.resetTimestamp);

    if (!result.allowed) {
      reply.header('Retry-After', String(result.resetInSeconds));
      throw new AppError(
        `Rate limit exceeded. Please wait ${result.resetInSeconds} seconds.`,
        429,
        'RATE_LIMIT_EXCEEDED',
        { retryAfter: result.resetInSeconds }
      );
    }
  };
}

// Pre-configured rate limiting hooks
export const sandboxProvisionLimitHook = createRateLimitHook(sandboxProvisionLimiter);
export const agentPromptLimitHook = createRateLimitHook(agentPromptLimiter);
export const authSensitiveLimitHook = createRateLimitHook(authSensitiveLimiter);
export const mutationLimitHook = createRateLimitHook(mutationLimiter);
export const readApiLimitHook = createRateLimitHook(readApiLimiter);
export const publicLimitHook = createRateLimitHook(publicLimiter);
