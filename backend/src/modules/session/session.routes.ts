import type { FastifyInstance } from 'fastify';
import { sessionController } from './session.controller.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { readApiLimitHook, mutationLimitHook } from '../../middleware/rate-limit.middleware.js';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/sessions', {
    schema: {
      tags: ['Sessions'],
      summary: 'List user chat sessions',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 5: Read APIs)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nRetrieves all personal chat sessions for the authenticated user from cloud Firestore authority.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          includeMessages: { type: 'boolean', description: 'Whether to include message history in each session' },
        },
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth, readApiLimitHook],
  }, sessionController.getSessions.bind(sessionController));

  app.post('/api/v1/sessions', {
    schema: {
      tags: ['Sessions'],
      summary: 'Save or update chat session',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nCreates a new chat session or persists updated messages and state to cloud Firestore authority.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          title: { type: 'string', minLength: 1 },
          messages: { type: 'array' },
          messageCount: { type: 'integer' },
          sandboxId: { type: ['string', 'null'] },
          targetCli: { type: 'string' },
          selectedModel: { type: 'string' },
          modelTitle: { type: 'string' },
          reasoningEffort: { type: 'string', enum: ['low', 'medium', 'high'] },
          metadata: { type: 'object' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
        },
        required: ['id', 'title'],
      },
    },
    preValidation: [requireAuth, mutationLimitHook],
  }, sessionController.saveSession.bind(sessionController));

  app.get('/api/v1/sessions/:id', {
    schema: {
      tags: ['Sessions'],
      summary: 'Get session details by ID',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 5: Read APIs)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nFetches a single chat session and its metadata by session ID.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
        },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          beforeId: { type: 'string' },
          all: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth, readApiLimitHook],
  }, sessionController.getSession.bind(sessionController));

  app.get('/api/v1/sessions/:id/messages', {
    schema: {
      tags: ['Sessions'],
      summary: 'Paginate session messages',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 5: Read APIs)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nRetrieves paginated messages for a session (supports `limit`, `beforeId`, `all`).',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
        },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          beforeId: { type: 'string' },
          all: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth, readApiLimitHook],
  }, sessionController.getSessionMessages.bind(sessionController));

  app.delete('/api/v1/sessions/:id', {
    schema: {
      tags: ['Sessions'],
      summary: 'Delete session',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nSoft/hard deletes a session from Firestore and marks tombstones.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
        },
        required: ['id'],
      },
    },
    preValidation: [requireAuth, mutationLimitHook],
  }, sessionController.deleteSession.bind(sessionController));
}
