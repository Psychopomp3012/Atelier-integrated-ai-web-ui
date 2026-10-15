import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { envConfig } from '../config/env.config.js';

export async function registerCorsPlugin(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    origin: envConfig.CORS_ORIGIN === '*' ? true : envConfig.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });
}
