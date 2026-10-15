import type { ApiResponse, ApiErrorResponse, RateLimitMeta } from '../types/api.types.js';

export function createSuccessResponse<T>(
  data: T,
  requestId?: string,
  rateLimit?: RateLimitMeta
): ApiResponse<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...(requestId ? { requestId } : {}),
      ...(rateLimit ? { rateLimit } : {}),
    },
  };
}

export function createErrorResponse(
  code: string,
  message: string,
  details?: unknown,
  rateLimit?: RateLimitMeta
): ApiErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
    meta: {
      timestamp: new Date().toISOString(),
      ...(rateLimit ? { rateLimit } : {}),
    },
  };
}

