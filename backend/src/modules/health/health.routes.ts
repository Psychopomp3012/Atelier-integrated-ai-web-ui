import type { FastifyInstance } from 'fastify';
import { healthController } from './health.controller.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', healthController.getHealth.bind(healthController));
  app.get('/api/v1/health', healthController.getHealth.bind(healthController));
}
