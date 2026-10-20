import type { FastifyInstance } from 'fastify';
import { sandboxController } from './sandbox.controller.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import {
  sandboxProvisionLimitHook,
  mutationLimitHook,
  readApiLimitHook,
  publicLimitHook,
} from '../../middleware/rate-limit.middleware.js';

export async function sandboxRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/sandbox/logs', {
    schema: {
      tags: ['Sandbox'],
      summary: 'Get terminal lifecycle logs',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 6: Public Endpoints)\n🔓 **Auth**: Public\n\nReturns rolling buffer of microVM container lifecycle events and terminal logs.',
    },
    preHandler: [publicLimitHook],
  }, sandboxController.getTerminalLogs.bind(sandboxController));

  // User-scoped sandbox file inspection
  app.get('/api/v1/sandbox/files', {
    schema: {
      tags: ['Sandbox'],
      summary: 'List files in sandbox workspace',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 5: Read APIs)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nNavigates and lists recursive filesystem tree inside `/workspace` of the user microVM.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          sandboxId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth],
    preHandler: [readApiLimitHook],
  }, sandboxController.getFiles.bind(sandboxController));

  app.get('/api/v1/sandbox/file', {
    schema: {
      tags: ['Sandbox'],
      summary: 'Read file contents from sandbox',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 5: Read APIs)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nReads code text, binary images (Base64 data URLs), or SVGs from the user microVM workspace.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          path: { type: 'string', minLength: 1, description: 'Relative file path in /workspace' },
          sessionId: { type: 'string' },
          sandboxId: { type: 'string' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth],
    preHandler: [readApiLimitHook],
  }, sandboxController.getFileContent.bind(sandboxController));

  // User-scoped sandbox quota and usage discovery
  app.get('/api/v1/sandbox/usage', {
    schema: {
      tags: ['Sandbox'],
      summary: 'Get user sandbox quota & usage',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 5: Read APIs)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nReturns active sandbox instances, assigned microVM IDs, and slot utilization for authenticated user.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          activeSessionIds: { type: 'string', description: 'Comma-separated list of active frontend session IDs' },
        },
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth],
    preHandler: [readApiLimitHook],
  }, sandboxController.getUsage.bind(sandboxController));

  // MicroVM command execution
  app.post('/api/v1/sandbox/execute', {
    schema: {
      tags: ['Sandbox'],
      summary: 'Execute command in sandbox microVM',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nRuns a shell command in the isolated cloud microVM under the `agent-runner` Linux user.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          command: { type: 'string', minLength: 1 },
          sessionId: { type: 'string' },
          sandboxId: { type: 'string' },
          timeoutMs: { type: 'integer', minimum: 1000, maximum: 300000 },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth],
    preHandler: [mutationLimitHook],
  }, sandboxController.executeInSandbox.bind(sandboxController));

  // Session microVM attachment
  app.post('/api/v1/sandbox/attach', {
    schema: {
      tags: ['Sandbox'],
      summary: 'Attach session to existing microVM',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nBinds an active chat session to a running sandbox microVM owned by the user.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', minLength: 1 },
          sandboxId: { type: 'string', minLength: 1 },
        },
        required: ['sessionId', 'sandboxId'],
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth],
    preHandler: [mutationLimitHook],
  }, sandboxController.attachSession.bind(sandboxController));

  // Expensive cloud microVM provisioning (calibrated to 5 req/min)
  app.post('/api/v1/sandbox/create', {
    schema: {
      tags: ['Sandbox'],
      summary: 'Provision new cloud sandbox microVM',
      description: '⏱️ **Rate Limit**: `5 req / min` (Tier 1: Cloud Provisioning)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nProvisions a new high-performance cloud Linux microVM via E2B. Rate limited to 5/min to protect cloud resources.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          replaceOldest: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth],
    preHandler: [sandboxProvisionLimitHook],
  }, sandboxController.createSandbox.bind(sandboxController));

  // Session detachment
  app.post('/api/v1/sandbox/detach', {
    schema: {
      tags: ['Sandbox'],
      summary: 'Detach session from sandbox',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nDetaches a session from a microVM while preserving the underlying cloud microVM for future turns.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
      querystring: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth],
    preHandler: [mutationLimitHook],
  }, sandboxController.detachSession.bind(sandboxController));

  // Sandbox teardown / slot release
  app.delete('/api/v1/sandbox', {
    schema: {
      tags: ['Sandbox'],
      summary: 'Terminate cloud sandbox microVM',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nDestroys the cloud microVM container and releases the tenant sandbox slot.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          sandboxId: { type: 'string' },
          sessionId: { type: 'string' },
          clearAllSessions: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      body: {
        type: 'object',
        properties: {
          sandboxId: { type: 'string' },
          sessionId: { type: 'string' },
          clearAllSessions: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth],
    preHandler: [mutationLimitHook],
  }, sandboxController.deleteSandbox.bind(sandboxController));
}
