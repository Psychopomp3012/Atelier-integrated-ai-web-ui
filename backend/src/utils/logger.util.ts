export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LoggerUtil {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: unknown, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

export const logger: LoggerUtil = {
  info(message: string, context?: Record<string, unknown>): void {
    console.log(`[INFO] [${new Date().toISOString()}] ${message}`, context ? JSON.stringify(context) : '');
  },
  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(`[WARN] [${new Date().toISOString()}] ${message}`, context ? JSON.stringify(context) : '');
  },
  error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    console.error(`[ERROR] [${new Date().toISOString()}] ${message}`, error ?? '', context ? JSON.stringify(context) : '');
  },
  debug(message: string, context?: Record<string, unknown>): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[DEBUG] [${new Date().toISOString()}] ${message}`, context ? JSON.stringify(context) : '');
    }
  },
};
