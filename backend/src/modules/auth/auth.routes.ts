import type { FastifyInstance } from 'fastify';
import { authController } from './auth.controller.js';
import { cliAuthController } from './cli-auth.controller.js';
import { logger } from '../../utils/logger.util.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Public Client Auth Config
  app.get('/api/v1/auth/config', authController.getConfig.bind(authController));

  // Primary Google Login
  app.post('/api/v1/auth/google', authController.loginGoogle.bind(authController));
  app.post('/api/v1/auth/cli-login', authController.loginCli.bind(authController));
  app.post('/api/v1/auth/refresh', authController.refreshToken.bind(authController));

  // AI CLI Account Linking (Antigravity, Gemini, Claude, Codex)
  app.get('/api/v1/auth/cli/status', cliAuthController.getStatus.bind(cliAuthController));
  app.get('/api/v1/auth/cli/antigravity/url', cliAuthController.getAntigravityAuthUrl.bind(cliAuthController));
  app.get('/api/v1/auth/cli/antigravity/login', cliAuthController.loginAntigravity.bind(cliAuthController));
  app.post('/api/v1/auth/cli/antigravity/code', cliAuthController.submitAntigravityCode.bind(cliAuthController));
  app.post('/api/v1/auth/cli/antigravity/unlink', cliAuthController.unlinkGemini.bind(cliAuthController));
  app.get('/api/v1/auth/cli/gemini/url', cliAuthController.getAntigravityAuthUrl.bind(cliAuthController));
  app.get('/api/v1/auth/cli/gemini/login', cliAuthController.loginAntigravity.bind(cliAuthController));
  app.post('/api/v1/auth/cli/gemini/code', cliAuthController.submitAntigravityCode.bind(cliAuthController));
  app.post('/api/v1/auth/cli/gemini/unlink', cliAuthController.unlinkGemini.bind(cliAuthController));

  // Claude CLI Authentication (Loopback OAuth & Console flow)
  app.get('/api/v1/auth/cli/claude/url', cliAuthController.getClaudeAuthUrl.bind(cliAuthController));
  app.get('/api/v1/auth/cli/claude/login', cliAuthController.loginClaude.bind(cliAuthController));
  app.post('/api/v1/auth/cli/claude/code', cliAuthController.submitClaudeCode.bind(cliAuthController));
  app.post('/api/v1/auth/cli/claude/unlink', cliAuthController.unlinkClaude.bind(cliAuthController));

  // OpenAI Codex CLI Authentication (Loopback OAuth on port 1455)
  app.get('/api/v1/auth/cli/codex/url', cliAuthController.getCodexAuthUrl.bind(cliAuthController));
  app.get('/api/v1/auth/cli/codex/login', cliAuthController.loginCodex.bind(cliAuthController));
  app.post('/api/v1/auth/cli/codex/unlink', cliAuthController.unlinkCodex.bind(cliAuthController));

  // Standard loopback OAuth callback for Google Native/Desktop flow (port 4000)
  app.get('/oauth2callback', cliAuthController.handleOAuthCallback.bind(cliAuthController));

  // Device-Code Subscription Handshake for Claude & Codex CLI subscriptions
  app.post('/api/v1/auth/device/initiate', authController.initiateDeviceAuth.bind(authController));
  app.post('/api/v1/auth/device/verify', authController.verifyDeviceAuth.bind(authController));

  // Platform Login & Account Linking
  app.post('/api/v1/auth/login', authController.login.bind(authController));
  app.get('/api/v1/auth/me', authController.getMe.bind(authController));
  app.post('/api/v1/auth/profile', authController.syncProfile.bind(authController));
  app.post('/api/v1/auth/connect', authController.connectPlatform.bind(authController));
  app.post('/api/v1/auth/logout', authController.logout.bind(authController));

  // Diagnostic Logging Control (Toggle file logging to test_suite/app_debug.log)
  app.get('/api/v1/debug/logging', async (_req, reply) => {
    return reply.status(200).send({
      success: true,
      data: {
        enabled: logger.isFileLoggingEnabled(),
        logFile: logger.getLogFilePath(),
      },
    });
  });

  app.post('/api/v1/debug/logging', async (req, reply) => {
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

