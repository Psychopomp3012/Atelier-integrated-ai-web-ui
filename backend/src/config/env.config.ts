import type { AppEnvConfig } from '../types/env.types.js';

try {
  process.loadEnvFile?.();
} catch {
  // Ignore in production or environments where .env is absent
}

export const envConfig: AppEnvConfig = {
  NODE_ENV: (process.env.NODE_ENV as AppEnvConfig['NODE_ENV']) || 'development',
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 4000,
  HOST: process.env.HOST || '0.0.0.0',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  DEFAULT_MODEL: (process.env.DEFAULT_MODEL as string) || 'gemini-3.8-flash-high',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  FIREBASE_API_KEY: process.env.FIREBASE_API_KEY || 'AIzaSyBaW014bjLdEn9IDoQ83cVAArpNAO0YFCE',
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || 'integrated-ai-cli',
  SANDBOX_CPU_LIMIT: process.env.SANDBOX_CPU_LIMIT || '2.0',
  SANDBOX_MEMORY_LIMIT: process.env.SANDBOX_MEMORY_LIMIT || '4g',
  SANDBOX_PROVIDER: (process.env.SANDBOX_PROVIDER as 'e2b' | 'docker') || 'e2b',
  E2B_API_KEY: process.env.E2B_API_KEY,
  E2B_TEMPLATE: process.env.E2B_TEMPLATE || 'atelier-agent-vm',
  MAX_SANDBOXES_PER_USER: process.env.MAX_SANDBOXES_PER_USER
    ? parseInt(process.env.MAX_SANDBOXES_PER_USER, 10)
    : 3,
};

