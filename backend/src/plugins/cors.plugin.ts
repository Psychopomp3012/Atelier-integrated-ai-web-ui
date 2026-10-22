import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

export async function registerCorsPlugin(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    origin: (_origin, cb) => {
      // Allow all origins dynamically (browser apps, Vercel frontend, local dev)
      cb(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With', 'Range'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });
}
