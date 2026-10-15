export interface RateLimitMeta {
  limit: number;
  remaining: number;
  resetInSeconds: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    timestamp: string;
    requestId?: string;
    rateLimit?: RateLimitMeta;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: {
    timestamp: string;
    rateLimit?: RateLimitMeta;
  };
}

