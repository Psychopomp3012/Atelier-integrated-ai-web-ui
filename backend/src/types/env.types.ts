export interface AppEnvConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  HOST: string;
  CORS_ORIGIN: string;
  DEFAULT_MODEL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  FIREBASE_API_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
  SANDBOX_CPU_LIMIT: string;
  SANDBOX_MEMORY_LIMIT: string;
  SANDBOX_PROVIDER?: 'e2b' | 'docker';
  E2B_API_KEY?: string;
  MAX_SANDBOXES_PER_USER?: number;
}
