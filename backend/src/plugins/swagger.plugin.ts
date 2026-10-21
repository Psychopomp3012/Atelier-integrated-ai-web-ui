import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export async function registerSwaggerPlugin(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Atelier - Cloud Agent Workspace API',
        description: `
## Cloud-Native Multi-Tenant AI Agent Architecture
Interactive API reference and runtime sandbox for Atelier Cloud Agent Workspace.

### ⏱️ Rate Limiting Policy & Calibrated Tiers
Every endpoint enforces a sliding-window rate limiter keyed by \`user:<userId>\` (for authenticated callers) or \`ip:<ip>\` (for anonymous callers) to guarantee multi-tenant fairness:
* **Tier 1: Cloud MicroVM Provisioning** (\`5 req / min\`): \`POST /api/v1/sandbox/create\` *(protects expensive cloud compute)*
* **Tier 2: AI Execution & Prompts** (\`20 req / min\`): \`POST /api/v1/agent/prompt/stream\` *(protects agent loops)*
* **Tier 3: Auth & Linking Sensitive** (\`20 req / min\`): \`POST /api/v1/auth/google\`, \`/auth/login\`, \`/auth/device/*\`, \`/auth/cli/*/code\`
* **Tier 4: State Mutations & Commands** (\`60 req / min\`): \`POST/DELETE /api/v1/sessions\`, \`/sandbox/execute\`, \`/agent/stop\`, etc.
* **Tier 5: Read APIs & Status Polling** (\`120 req / min\`): \`GET /api/v1/sessions\`, \`/sandbox/files\`, \`/sandboxes\`, \`/quota\`, \`/auth/cli/status\`
* **Tier 6: Public Endpoints & Diagnostics** (\`120 req / min\`): \`GET /api/v1/auth/config\`, \`/sandbox/logs\`, \`/debug/logging\`

### 📡 Standard Rate Limit Headers
Every response includes:
* \`X-RateLimit-Limit\`: Request quota ceiling for current 1-minute window
* \`X-RateLimit-Remaining\`: Remaining requests available before reset
* \`X-RateLimit-Reset\`: Unix epoch timestamp (seconds) when quota refreshes
* \`Retry-After\`: Seconds client must wait if HTTP 429 Too Many Requests is triggered
        `,
        version: '1.0.0',
        contact: {
          name: 'Atelier Engineering',
        },
      },
      servers: [
        {
          url: 'http://localhost:4000',
          description: 'Local Backend Server',
        },
      ],
      tags: [
        { name: 'Sessions', description: 'Chat sessions, message history, and Firestore persistence' },
        { name: 'Sandbox', description: 'Cloud Linux microVM provisioning, file inspection, and remote execution' },
        { name: 'Agent', description: 'AI prompt streaming (SSE), model discovery, and process abort control' },
        { name: 'Auth', description: 'Google OAuth, device authentication, and AI CLI subscription linking' },
        { name: 'Quota', description: 'Live subscription quota telemetry discovered from microVM CLIs' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Enter your 7-day cryptographic JWT token obtained from Google login or /api/v1/auth/login.',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
  });
}
