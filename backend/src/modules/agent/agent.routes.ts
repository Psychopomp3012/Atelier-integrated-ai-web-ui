import type { FastifyInstance } from 'fastify';
import { agentController } from './agent.controller.js';

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/agent/models', agentController.getModels.bind(agentController));
  app.get('/api/v1/agent/quota', agentController.getQuota.bind(agentController));
  app.post('/api/v1/agent/prompt', agentController.executePrompt.bind(agentController));
  app.post('/api/v1/agent/prompt/stream', agentController.executePromptStream.bind(agentController));
}
