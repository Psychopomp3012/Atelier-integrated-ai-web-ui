import fs from 'fs';
import path from 'path';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LoggerUtil {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: unknown, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  setFileLoggingEnabled(enabled: boolean): void;
  isFileLoggingEnabled(): boolean;
  getLogFilePath(): string;
  clearLogFile(): void;
}

function resolveLogFilePath(): string {
  if (process.env.APP_LOG_FILE) return path.resolve(process.env.APP_LOG_FILE);
  const candidates = [
    path.resolve(process.cwd(), 'test_suite', 'app_debug.log'),
    path.resolve(process.cwd(), '..', 'test_suite', 'app_debug.log'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.dirname(c))) {
      return c;
    }
  }
  return candidates[0];
}

let fileLoggingEnabled = process.env.ENABLE_FILE_LOGGING !== 'false' && process.env.APP_FILE_LOGGING !== 'false';
const logFilePath = resolveLogFilePath();

function sanitizeContext(obj: unknown, depth = 0): unknown {
  if (depth > 4) return '[Nested Object]';
  if (!obj || typeof obj !== 'object') {
    if (typeof obj === 'string') {
      if (obj.startsWith('eyJ') && obj.length > 25) {
        return `[JWT len=${obj.length}]`;
      }
      if (obj.startsWith('4/') && obj.length > 20) {
        return `[OAuth Code len=${obj.length}]`;
      }
      if (obj.startsWith('sk-') || obj.startsWith('AIzaSy')) {
        return `[API Key len=${obj.length}]`;
      }
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeContext(item, depth + 1));
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
    } else if (lowerKey === 'code' && typeof val === 'string') {
      sanitized[key] = val.startsWith('4/') ? `[OAuth Code 4/... len=${val.length}]` : `[Code len=${val.length}]`;
    } else {
      sanitized[key] = sanitizeContext(val, depth + 1);
    }
  }
  return sanitized;
}

const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function writeToFile(level: LogLevel, message: string, extra?: unknown) {
  if (!fileLoggingEnabled) return;
  // Never write high-frequency debug polling noise to file
  if (level === 'debug' && process.env.LOG_DEBUG_TO_FILE !== 'true') return;
  if (
    message.includes('Quota') ||
    message.includes('Evaluated Antigravity link status') ||
    message.includes('Evaluated Codex link status')
  ) {
    return;
  }
  try {
    const dir = path.dirname(logFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Auto-truncate if log file exceeds 5MB
    if (fs.existsSync(logFilePath)) {
      try {
        const stats = fs.statSync(logFilePath);
        if (stats.size > MAX_LOG_SIZE_BYTES) {
          const content = fs.readFileSync(logFilePath, 'utf8');
          const lines = content.split('\n');
          const trimmed = lines.slice(-2000).join('\n');
          fs.writeFileSync(logFilePath, `[LOG ROTATED - Kept last 2000 lines to prevent disk bloat]\n${trimmed}\n`, 'utf8');
        }
      } catch {}
    }
    const timestamp = new Date().toISOString();
    const extraStr = extra !== undefined ? ` | ${typeof extra === 'object' ? JSON.stringify(sanitizeContext(extra)) : String(extra)}` : '';
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${extraStr}\n`;
    fs.appendFileSync(logFilePath, line, 'utf8');
  } catch {
    // Fail silently to avoid crashing primary app flows if disk I/O fails
  }
}

export const logger: LoggerUtil = {
  info(message: string, context?: Record<string, unknown>): void {
    const sanitized = context ? sanitizeContext(context) : undefined;
    console.log(`[INFO] [${new Date().toISOString()}] ${message}`, sanitized ? JSON.stringify(sanitized) : '');
    writeToFile('info', message, context);
  },
  warn(message: string, context?: Record<string, unknown>): void {
    const sanitized = context ? sanitizeContext(context) : undefined;
    console.warn(`[WARN] [${new Date().toISOString()}] ${message}`, sanitized ? JSON.stringify(sanitized) : '');
    writeToFile('warn', message, context);
  },
  error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    const errSummary = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.split('\n').slice(0, 3).join(' ') } : error;
    const sanitized = context ? sanitizeContext(context) : undefined;
    console.error(`[ERROR] [${new Date().toISOString()}] ${message}`, errSummary ?? '', sanitized ? JSON.stringify(sanitized) : '');
    writeToFile('error', message, { error: errSummary, context });
  },
  debug(message: string, context?: Record<string, unknown>): void {
    if (process.env.NODE_ENV !== 'production') {
      const sanitized = context ? sanitizeContext(context) : undefined;
      console.debug(`[DEBUG] [${new Date().toISOString()}] ${message}`, sanitized ? JSON.stringify(sanitized) : '');
    }
    writeToFile('debug', message, context);
  },
  setFileLoggingEnabled(enabled: boolean): void {
    fileLoggingEnabled = enabled;
    writeToFile('info', `File logging toggled: ${enabled ? 'ENABLED' : 'DISABLED'}`);
  },
  isFileLoggingEnabled(): boolean {
    return fileLoggingEnabled;
  },
  getLogFilePath(): string {
    return logFilePath;
  },
  clearLogFile(): void {
    try {
      if (fs.existsSync(logFilePath)) {
        fs.writeFileSync(logFilePath, `[${new Date().toISOString()}] [INFO] Log file cleared.\n`, 'utf8');
      }
    } catch {}
  },
};
