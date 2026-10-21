import fs from 'node:fs';
import path from 'node:path';

export interface TimingContext {
  userId?: string;
  sessionId?: string;
  reqId?: string;
  [key: string]: unknown;
}

export interface TimingLoggerUtil {
  logTiming(category: string, step: string, durationMs: number, context?: TimingContext): void;
  startTimer(category: string, step: string, initialContext?: TimingContext): (additionalContext?: TimingContext) => number;
  measure<T>(
    category: string,
    step: string,
    fn: () => Promise<T>,
    getContext?: TimingContext | ((result: T, durationMs: number) => TimingContext)
  ): Promise<T>;
  measureSync<T>(
    category: string,
    step: string,
    fn: () => T,
    getContext?: TimingContext | ((result: T, durationMs: number) => TimingContext)
  ): T;
  getLogFilePath(): string;
  clearLogFile(): void;
}

function resolveTimingLogFilePath(): string {
  if (process.env.APP_TIMING_LOG_FILE) return path.resolve(process.env.APP_TIMING_LOG_FILE);
  const candidates = [
    path.resolve(process.cwd(), 'test_suite', 'app_timing.log'),
    path.resolve(process.cwd(), '..', 'test_suite', 'app_timing.log'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.dirname(c))) {
      return c;
    }
  }
  return candidates[0];
}

const timingLogFilePath = resolveTimingLogFilePath();
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function sanitizeTimingContext(obj: unknown, depth = 0): unknown {
  if (depth > 3) return '[Nested Object]';
  if (!obj || typeof obj !== 'object') {
    if (typeof obj === 'string') {
      if (obj.startsWith('eyJ') && obj.length > 25) return `[JWT len=${obj.length}]`;
      if (obj.startsWith('4/') && obj.length > 20) return `[OAuth Code len=${obj.length}]`;
      if (obj.startsWith('sk-') || obj.startsWith('AIzaSy')) return `[API Key len=${obj.length}]`;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeTimingContext(item, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('secret') ||
      lowerKey.includes('password') ||
      lowerKey.includes('privatekey') ||
      lowerKey.includes('access_token') ||
      lowerKey.includes('refresh_token') ||
      lowerKey.includes('id_token') ||
      lowerKey === 'token'
    ) {
      sanitized[key] = typeof val === 'string' ? `[REDACTED len=${val.length}]` : '[REDACTED]';
    } else {
      sanitized[key] = sanitizeTimingContext(val, depth + 1);
    }
  }
  return sanitized;
}

function extractTimingTags(ctx?: TimingContext): { tags: string; meta?: Record<string, unknown> } {
  if (!ctx || typeof ctx !== 'object') return { tags: '' };

  const rawUserId = ctx.userId;
  const rawSessionId = ctx.sessionId;
  const rawReqId = ctx.reqId ?? ctx.requestId ?? ctx.correlationId;

  const userTag =
    typeof rawUserId === 'string' && rawUserId.trim() && !['anonymous', 'undefined'].includes(rawUserId)
      ? ` [User: ${rawUserId.trim()}]`
      : '';
  const sessTag =
    typeof rawSessionId === 'string' && rawSessionId.trim() && !['undefined', 'default'].includes(rawSessionId)
      ? ` [Sess: ${rawSessionId.trim()}]`
      : '';
  const reqTag =
    typeof rawReqId === 'string' && rawReqId.trim() && rawReqId !== 'undefined'
      ? ` [Req: ${rawReqId.trim()}]`
      : '';

  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (!['userId', 'sessionId', 'reqId', 'requestId', 'correlationId'].includes(k)) {
      meta[k] = v;
    }
  }

  return {
    tags: `${userTag}${sessTag}${reqTag}`,
    meta: Object.keys(meta).length > 0 ? meta : undefined,
  };
}

function writeTimingToFile(category: string, step: string, durationMs: number, context?: TimingContext): void {
  try {
    const dir = path.dirname(timingLogFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(timingLogFilePath)) {
      try {
        const stats = fs.statSync(timingLogFilePath);
        if (stats.size > MAX_LOG_SIZE_BYTES) {
          const content = fs.readFileSync(timingLogFilePath, 'utf8');
          const lines = content.split('\n');
          const trimmed = lines.slice(-2000).join('\n');
          fs.writeFileSync(timingLogFilePath, `[LOG ROTATED - Kept last 2000 lines to prevent disk bloat]\n${trimmed}\n`, 'utf8');
        }
      } catch {}
    }

    const timestamp = new Date().toISOString();
    const { tags, meta } = extractTimingTags(context);
    const metaStr = meta ? ` | ${JSON.stringify(sanitizeTimingContext(meta))}` : '';
    const line = `[${timestamp}] [TIMING]${tags} [${category}] ${step} (${durationMs}ms)${metaStr}\n`;
    fs.appendFileSync(timingLogFilePath, line, 'utf8');
  } catch {
    // Fail silently to avoid interrupting core application flow
  }
}

export const timingLogger: TimingLoggerUtil = {
  logTiming(category: string, step: string, durationMs: number, context?: TimingContext): void {
    writeTimingToFile(category, step, durationMs, context);
  },

  startTimer(category: string, step: string, initialContext?: TimingContext): (additionalContext?: TimingContext) => number {
    const start = performance.now();
    return (additionalContext?: TimingContext): number => {
      const durationMs = Math.round(performance.now() - start);
      const merged = { ...initialContext, ...additionalContext };
      writeTimingToFile(category, step, durationMs, merged);
      return durationMs;
    };
  },

  async measure<T>(
    category: string,
    step: string,
    fn: () => Promise<T>,
    getContext?: TimingContext | ((result: T, durationMs: number) => TimingContext)
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const durationMs = Math.round(performance.now() - start);
      const ctx = typeof getContext === 'function' ? getContext(result, durationMs) : getContext;
      writeTimingToFile(category, step, durationMs, ctx);
      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const baseCtx = typeof getContext === 'function' ? {} : (getContext || {});
      writeTimingToFile(category, `${step} [FAILED]`, durationMs, {
        ...baseCtx,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  measureSync<T>(
    category: string,
    step: string,
    fn: () => T,
    getContext?: TimingContext | ((result: T, durationMs: number) => TimingContext)
  ): T {
    const start = performance.now();
    try {
      const result = fn();
      const durationMs = Math.round(performance.now() - start);
      const ctx = typeof getContext === 'function' ? getContext(result, durationMs) : getContext;
      writeTimingToFile(category, step, durationMs, ctx);
      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const baseCtx = typeof getContext === 'function' ? {} : (getContext || {});
      writeTimingToFile(category, `${step} [FAILED]`, durationMs, {
        ...baseCtx,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  getLogFilePath(): string {
    return timingLogFilePath;
  },

  clearLogFile(): void {
    try {
      if (fs.existsSync(timingLogFilePath)) {
        fs.writeFileSync(timingLogFilePath, `[${new Date().toISOString()}] [TIMING] Timing log file initialized.\n`, 'utf8');
      }
    } catch {}
  },
};
