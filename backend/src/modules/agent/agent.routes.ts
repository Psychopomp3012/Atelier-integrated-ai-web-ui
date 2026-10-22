import type { FastifyInstance } from 'fastify';
import { agentController } from './agent.controller.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import {
  agentPromptLimitHook,
  mutationLimitHook,
  readApiLimitHook,
} from '../../middleware/rate-limit.middleware.js';

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  // Model discovery (strictly authenticated, 4-phase defense pipeline)
  app.get('/api/v1/agent/models', {
    schema: {
      tags: ['Agent'],
      summary: 'List available AI models & reasoning effort levels',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 5: Read APIs)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nDiscovers available LLM engines (Gemini, Claude, Codex) and reasoning effort variants live from CLI discovery.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth, readApiLimitHook],
  }, agentController.getModels.bind(agentController));

  // AI prompt streaming execution (strictly authenticated, calibrated to 20 req/min)
  app.post('/api/v1/agent/prompt/stream', {
    schema: {
      tags: ['Agent'],
      summary: 'Execute prompt with real-time SSE stream',
      description: '⏱️ **Rate Limit**: `20 req / min` (Tier 2: AI Execution)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nDispatches AI prompt execution inside the cloud sandbox microVM and streams progress steps and tokens via Server-Sent Events (SSE).',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          prompt: { type: 'string', minLength: 1, description: 'User prompt to execute' },
          selectedModel: { type: 'string', minLength: 1, description: 'Selected model ID' },
          sessionId: { type: 'string', description: 'Target session ID' },
          sandboxId: { type: 'string', description: 'Optional target sandbox ID' },
          reasoningEffort: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Reasoning effort tier' },
        },
        required: ['prompt', 'selectedModel'],
      },
    },
    preValidation: [requireAuth, agentPromptLimitHook],
  }, agentController.executePromptStream.bind(agentController));

  // User abort / cancel agent execution
  app.post('/api/v1/agent/stop', {
    schema: {
      tags: ['Agent'],
      summary: 'Abort active agent execution',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nExplicitly signals microVM to terminate in-flight CLI processes (`pkill`) and aborts SSE generation.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', minLength: 1, description: 'Session ID to abort' },
        },
        required: ['sessionId'],
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth, mutationLimitHook],
  }, agentController.stopExecution.bind(agentController));
}
