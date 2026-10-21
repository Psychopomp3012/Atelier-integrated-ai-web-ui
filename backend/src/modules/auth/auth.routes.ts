import type { FastifyInstance } from 'fastify';
import { authController } from './auth.controller.js';
import { cliAuthController } from './cli-auth.controller.js';
import { logger } from '../../utils/logger.util.js';
import { requireAuth, optionalAuth } from '../../middleware/auth.middleware.js';
import {
  authSensitiveLimitHook,
  mutationLimitHook,
  readApiLimitHook,
  publicLimitHook,
} from '../../middleware/rate-limit.middleware.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Public Client Auth Config
  app.get('/api/v1/auth/config', {
    schema: {
      tags: ['Auth'],
      summary: 'Get public OAuth client credentials',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 6: Public Endpoints)\n🔓 **Auth**: Public\n\nProvides public Google Client ID for browser Google Identity Services SDK initialization.',
    },
    preHandler: [publicLimitHook],
  }, authController.getConfig.bind(authController));

  // Primary Google Login (Sensitive rate limit: 20 req/min)
  app.post('/api/v1/auth/google', {
    schema: {
      tags: ['Auth'],
      summary: 'Authenticate with Google ID token',
      description: '⏱️ **Rate Limit**: `20 req / min` (Tier 3: Auth Sensitive)\n🔓 **Auth**: Public\n\nValidates Google OAuth JWT, resolves or creates developer profile, and returns a 7-day session JWT.',
      body: {
        type: 'object',
        properties: {
          credential: { type: 'string' },
          code: { type: 'string' },
          email: { type: 'string' },
          name: { type: 'string' },
          avatarUrl: { type: 'string' },
        },
      },
    },
    preHandler: [authSensitiveLimitHook],
  }, authController.loginGoogle.bind(authController));

  app.post('/api/v1/auth/cli-login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login via local CLI developer credentials',
      description: '⏱️ **Rate Limit**: `20 req / min` (Tier 3: Auth Sensitive)\n🔓 **Auth**: Public\n\nBridges local CLI authentication credentials to web session.',
    },
    preHandler: [authSensitiveLimitHook],
  }, authController.loginCli.bind(authController));

  // AI CLI Account Linking Status
  app.get('/api/v1/auth/cli/status', {
    schema: {
      tags: ['Auth'],
      summary: 'Get subscription link status for all AI CLIs',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 5: Read APIs)\n🔓 **Auth**: Optional (`Bearer <JWT>`)\n\nInspects linked status for Google Antigravity, OpenAI Codex, and Anthropic Claude.',
      security: [{ bearerAuth: [] }, {}],
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    preValidation: [optionalAuth],
    preHandler: [readApiLimitHook],
  }, cliAuthController.getStatus.bind(cliAuthController));

  // Google Antigravity & Gemini CLI linking
  app.get('/api/v1/auth/cli/antigravity/url', {
    schema: {
      tags: ['Auth'],
      summary: 'Generate Antigravity OAuth login URL',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 6: Public Endpoints)\n🔓 **Auth**: Public (Optional `Bearer <JWT>` binds to user session)',
    },
    preValidation: [optionalAuth],
    preHandler: [publicLimitHook],
  }, cliAuthController.getAntigravityAuthUrl.bind(cliAuthController));

  app.get('/api/v1/auth/cli/antigravity/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Launch Antigravity headless auth flow',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 6: Public Endpoints)\n🔓 **Auth**: Public (Optional `Bearer <JWT>` binds to user session)',
    },
    preValidation: [optionalAuth],
    preHandler: [publicLimitHook],
  }, cliAuthController.loginAntigravity.bind(cliAuthController));

  app.post('/api/v1/auth/cli/antigravity/code', {
    schema: {
      tags: ['Auth'],
      summary: 'Submit Google OAuth authorization code',
      description: '⏱️ **Rate Limit**: `20 req / min` (Tier 3: Auth Sensitive)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nExchanges OAuth code for credentials and links to authenticated developer profile.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          code: { type: 'string', minLength: 1 },
        },
        required: ['code'],
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth],
    preHandler: [authSensitiveLimitHook],
  }, cliAuthController.submitAntigravityCode.bind(cliAuthController));

  app.post('/api/v1/auth/cli/antigravity/unlink', {
    schema: {
      tags: ['Auth'],
      summary: 'Unlink Google Antigravity credentials',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔒 **Auth**: Required (`Bearer <JWT>`)\n\nUnlinks Google credentials and purges credentials from running microVMs.',
      security: [{ bearerAuth: [] }],
    },
    preValidation: [requireAuth],
    preHandler: [mutationLimitHook],
  }, cliAuthController.unlinkAntigravity.bind(cliAuthController));

  // Claude CLI Authentication
  app.get('/api/v1/auth/cli/claude/url', {
    schema: {
      tags: ['Auth'],
      summary: 'Generate Claude CLI OAuth URL',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 6: Public Endpoints)\n🔓 **Auth**: Public',
    },
    preHandler: [publicLimitHook],
  }, cliAuthController.getClaudeAuthUrl.bind(cliAuthController));

  app.get('/api/v1/auth/cli/claude/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Launch Claude CLI login process',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 6: Public Endpoints)\n🔓 **Auth**: Public',
    },
    preHandler: [publicLimitHook],
  }, cliAuthController.loginClaude.bind(cliAuthController));

  app.post('/api/v1/auth/cli/claude/code', {
    schema: {
      tags: ['Auth'],
      summary: 'Submit Claude CLI verification code',
      description: '⏱️ **Rate Limit**: `20 req / min` (Tier 3: Auth Sensitive)\n🔒 **Auth**: Required (`Bearer <JWT>`)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          code: { type: 'string', minLength: 1 },
        },
        required: ['code'],
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth],
    preHandler: [authSensitiveLimitHook],
  }, cliAuthController.submitClaudeCode.bind(cliAuthController));

  app.post('/api/v1/auth/cli/claude/unlink', {
    schema: {
      tags: ['Auth'],
      summary: 'Unlink Claude CLI credentials',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔒 **Auth**: Required (`Bearer <JWT>`)',
      security: [{ bearerAuth: [] }],
    },
    preValidation: [requireAuth],
    preHandler: [mutationLimitHook],
  }, cliAuthController.unlinkClaude.bind(cliAuthController));

  // OpenAI Codex CLI Authentication
  app.get('/api/v1/auth/cli/codex/url', {
    schema: {
      tags: ['Auth'],
      summary: 'Generate Codex device OAuth URL',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 6: Public Endpoints)\n🔓 **Auth**: Optional (`Bearer <JWT>`)',
      security: [{ bearerAuth: [] }, {}],
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    preValidation: [optionalAuth],
    preHandler: [publicLimitHook],
  }, cliAuthController.getCodexAuthUrl.bind(cliAuthController));

  app.get('/api/v1/auth/cli/codex/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Initiate Codex device OAuth login',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 6: Public Endpoints)\n🔓 **Auth**: Optional (`Bearer <JWT>`)',
      security: [{ bearerAuth: [] }, {}],
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    preValidation: [optionalAuth],
    preHandler: [publicLimitHook],
  }, cliAuthController.loginCodex.bind(cliAuthController));

  app.post('/api/v1/auth/cli/codex/unlink', {
    schema: {
      tags: ['Auth'],
      summary: 'Unlink Codex subscription credentials',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔒 **Auth**: Required (`Bearer <JWT>`)',
      security: [{ bearerAuth: [] }],
    },
    preValidation: [requireAuth],
    preHandler: [mutationLimitHook],
  }, cliAuthController.unlinkCodex.bind(cliAuthController));

  // Standard loopback OAuth callback for Google Native/Desktop flow (port 4000)
  app.get('/oauth2callback', {
    schema: {
      tags: ['Auth'],
      summary: 'Google OAuth loopback redirect receiver',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 6: Public Endpoints)\n🔓 **Auth**: Public',
      querystring: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          state: { type: 'string' },
          error: { type: 'string' },
        },
      },
    },
    preHandler: [publicLimitHook],
  }, cliAuthController.handleOAuthCallback.bind(cliAuthController));

  // Device-Code Subscription Handshake for Claude & Codex CLI subscriptions
  app.post('/api/v1/auth/device/initiate', {
    schema: {
      tags: ['Auth'],
      summary: 'Initiate device authorization code handshake',
      description: '⏱️ **Rate Limit**: `20 req / min` (Tier 3: Auth Sensitive)\n🔓 **Auth**: Public',
      body: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['codex', 'claude', 'antigravity', 'gemini'] },
        },
        required: ['platform'],
        additionalProperties: false,
      },
    },
    preHandler: [authSensitiveLimitHook],
  }, authController.initiateDeviceAuth.bind(authController));

  app.post('/api/v1/auth/device/verify', {
    schema: {
      tags: ['Auth'],
      summary: 'Verify device code and bind to user account',
      description: '⏱️ **Rate Limit**: `20 req / min` (Tier 3: Auth Sensitive)\n🔒 **Auth**: Required (`Bearer <JWT>`)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          deviceCode: { type: 'string', minLength: 1 },
          platform: { type: 'string', enum: ['codex', 'claude', 'antigravity', 'gemini'] },
        },
        required: ['deviceCode', 'platform'],
        additionalProperties: false,
      },
    },
    preValidation: [requireAuth],
    preHandler: [authSensitiveLimitHook],
  }, authController.verifyDeviceAuth.bind(authController));

  // Platform Login & Account Linking
  app.post('/api/v1/auth/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Platform credentials login',
      description: '⏱️ **Rate Limit**: `20 req / min` (Tier 3: Auth Sensitive)\n🔓 **Auth**: Public',
      body: {
        type: 'object',
        properties: {
          platform: { type: 'string', minLength: 1 },
          email: { type: 'string' },
          username: { type: 'string' },
          password: { type: 'string' },
          token: { type: 'string' },
        },
        required: ['platform'],
      },
    },
    preHandler: [authSensitiveLimitHook],
  }, authController.login.bind(authController));

  app.get('/api/v1/auth/me', {
    schema: {
      tags: ['Auth'],
      summary: 'Get current user profile',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 5: Read APIs)\n🔒 **Auth**: Required (`Bearer <JWT>`)',
      security: [{ bearerAuth: [] }],
    },
    preValidation: [requireAuth],
    preHandler: [readApiLimitHook],
  }, authController.getMe.bind(authController));

  app.post('/api/v1/auth/profile', {
    schema: {
      tags: ['Auth'],
      summary: 'Sync user profile with Firestore',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔒 **Auth**: Required (`Bearer <JWT>`)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          avatarUrl: { type: 'string' },
          primaryPlatform: { type: 'string' },
          linkedPlatforms: { type: 'array' },
        },
      },
    },
    preValidation: [requireAuth],
    preHandler: [mutationLimitHook],
  }, authController.syncProfile.bind(authController));

  app.post('/api/v1/auth/connect', {
    schema: {
      tags: ['Auth'],
      summary: 'Link platform account to user profile',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔒 **Auth**: Required (`Bearer <JWT>`)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          platform: { type: 'string', minLength: 1 },
          accountId: { type: 'string' },
          username: { type: 'string' },
          accessToken: { type: 'string' },
        },
        required: ['platform'],
      },
    },
    preValidation: [requireAuth],
    preHandler: [mutationLimitHook],
  }, authController.connectPlatform.bind(authController));

  app.post('/api/v1/auth/logout', {
    schema: {
      tags: ['Auth'],
      summary: 'Invalidate current session token',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔒 **Auth**: Required (`Bearer <JWT>`)',
      security: [{ bearerAuth: [] }],
    },
    preValidation: [requireAuth],
    preHandler: [mutationLimitHook],
  }, authController.logout.bind(authController));

  // Diagnostic Logging Control
  app.get('/api/v1/debug/logging', {
    schema: {
      tags: ['RateLimit'],
      summary: 'Get diagnostic file logging status',
      description: '⏱️ **Rate Limit**: `120 req / min` (Tier 6: Public Endpoints)\n🔓 **Auth**: Public',
    },
    preHandler: [publicLimitHook],
  }, async (_req, reply) => {
    return reply.status(200).send({
      success: true,
      data: {
        enabled: logger.isFileLoggingEnabled(),
        logFile: logger.getLogFilePath(),
      },
    });
  });

  app.post('/api/v1/debug/logging', {
    schema: {
      tags: ['RateLimit'],
      summary: 'Toggle or clear diagnostic file logging',
      description: '⏱️ **Rate Limit**: `60 req / min` (Tier 4: State Mutations)\n🔓 **Auth**: Public',
      body: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          clear: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
    preHandler: [mutationLimitHook],
  }, async (req, reply) => {
    const body = req.body as { enabled?: boolean; clear?: boolean };
    if (typeof body?.enabled === 'boolean') {
      logger.setFileLoggingEnabled(body.enabled);
    }
    if (body?.clear) {
      logger.clearLogFile();
    }
    return reply.status(200).send({
      success: true,
      data: {
        enabled: logger.isFileLoggingEnabled(),
        logFile: logger.getLogFilePath(),
      },
    });
  });
}
