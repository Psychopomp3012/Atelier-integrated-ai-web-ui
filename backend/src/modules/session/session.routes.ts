import type { FastifyInstance } from 'fastify';
import { sessionController } from './session.controller.js';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/sessions', sessionController.getSessions.bind(sessionController));
  app.post('/api/v1/sessions', sessionController.saveSession.bind(sessionController));
  app.get('/api/v1/sessions/:id', sessionController.getSession.bind(sessionController));
  app.delete('/api/v1/sessions/:id', sessionController.deleteSession.bind(sessionController));
}
