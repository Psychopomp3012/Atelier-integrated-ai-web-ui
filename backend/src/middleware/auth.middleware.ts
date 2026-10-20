import type { FastifyReply, FastifyRequest } from 'fastify';
import { tokenUtil } from '../utils/token.util.js';
import { AppError } from '../utils/error.util.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    userEmail?: string;
    token?: string;
  }
}

/**
 * Extracts the JWT bearer token from the Authorization header or query parameter.
 */
function extractBearerToken(req: FastifyRequest): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const raw = authHeader.substring(7).trim();
    if (raw) return raw;
  }

  // Fallback for streaming endpoints or popups that pass token in query
  const query = req.query as { token?: string } | undefined;
  if (query?.token && typeof query.token === 'string') {
    const raw = query.token.trim();
    if (raw) return raw;
  }

  return null;
}

/**
 * Fastify preHandler hook enforcing strict JWT cryptographic verification.
 * Attaches verified userId, userEmail, and token to the FastifyRequest.
 * Throws 401 UNAUTHORIZED AppError if the token is missing, expired, or invalid.
 */
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    throw new AppError(
      'Authentication required: Missing or invalid Authorization Bearer token',
      401,
      'UNAUTHORIZED'
    );
  }

  const verified = tokenUtil.verifyJwt(token);
  if (!verified.valid || !verified.payload?.sub) {
    throw new AppError(
      verified.error || 'Invalid or expired authentication token',
      401,
      'UNAUTHORIZED'
    );
  }

  req.token = token;
  req.userId = verified.payload.sub;
  req.userEmail = verified.payload.email;
}

/**
 * Fastify preHandler hook performing optional JWT cryptographic verification.
 * If a valid Bearer token is provided, attaches verified userId, userEmail, and token.
 * If no token is provided, execution proceeds with req.userId undefined.
 * If a malformed or expired token is provided, leaves req.userId undefined without throwing.
 */
export async function optionalAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) return;

  const verified = tokenUtil.verifyJwt(token);
  if (verified.valid && verified.payload?.sub) {
    req.token = token;
    req.userId = verified.payload.sub;
    req.userEmail = verified.payload.email;
  }
}
