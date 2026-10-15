import type { FastifyReply, FastifyRequest } from 'fastify';
import { cliAuthService } from './cli-auth.service.js';
import { authService } from './auth.service.js';
import { createSuccessResponse } from '../../utils/response.util.js';
import { logger } from '../../utils/logger.util.js';

export class CliAuthController {
  public async getStatus(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(200).send(createSuccessResponse({
        antigravity: { linked: false },
        gemini: { linked: false },
        claude: { linked: false },
        codex: { linked: false },
      }));
    }

    const token = authHeader.substring(7);
    const session = await authService.getSession(token);
    if (!session) {
      return reply.status(200).send(createSuccessResponse({
        antigravity: { linked: false },
        gemini: { linked: false },
        claude: { linked: false },
        codex: { linked: false },
      }));
    }

    await Promise.all([
      cliAuthService.refreshClaudeStatus().catch(() => {}),
      cliAuthService.refreshCodexStatus().catch(() => {}),
    ]);
    const status = cliAuthService.getCliStatus();
    return reply.status(200).send(createSuccessResponse(status));
  }

  public async getAntigravityAuthUrl(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const result = await cliAuthService.startAntigravityCliLogin();
      return reply.status(200).send(createSuccessResponse(result));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate Antigravity CLI login URL';
      return reply.status(500).send({ success: false, error: { message: msg } });
    }
  }

  public async loginAntigravity(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const { authUrl } = await cliAuthService.startAntigravityCliLogin();
      return reply.redirect(authUrl);
    } catch (err: unknown) {
      logger.error('Failed to initiate Antigravity CLI login redirect', err);
      return reply.type('text/html').status(500).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Antigravity Auth Error</title></head>
        <body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:2rem;text-align:center;">
          <h2>Failed to initiate Antigravity Login</h2>
          <p>${err instanceof Error ? err.message : 'Error starting Antigravity CLI'}</p>
          <button onclick="window.close()" style="padding:0.5rem 1rem;background:#4285F4;border:none;border-radius:4px;cursor:pointer;color:white;">Close</button>
        </body>
        </html>
      `);
    }
  }

  public async submitAntigravityCode(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = req.body as { code?: string };
    if (!body?.code) {
      return reply.status(400).send({ success: false, error: { message: 'Authorization code is required' } });
    }
    const success = await cliAuthService.submitAntigravityCliCode(body.code);
    return reply.status(200).send(createSuccessResponse({ success }));
  }

  public async getGeminiAuthUrl(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    return this.getAntigravityAuthUrl(req, reply);
  }

  public async loginGemini(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    return this.loginAntigravity(req, reply);
  }

  public async unlinkGemini(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    cliAuthService.unlinkGemini();
    return reply.status(200).send(createSuccessResponse({ success: true, message: 'Antigravity / Gemini CLI unlinked' }));
  }

  public async handleOAuthCallback(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = req.query as { code?: string; error?: string; error_description?: string };

    if (query.error) {
      logger.warn('Google OAuth returned error in callback', { error: query.error });
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Authentication Cancelled</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #151d2f; padding: 2.5rem; border-radius: 1.25rem; border: 1px solid #ef444455; text-align: center; max-width: 440px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7); }
    h1 { font-size: 1.25rem; font-weight: 600; color: #f87171; margin-bottom: 0.5rem; }
    p { color: #94a3b8; font-size: 0.875rem; line-height: 1.5; margin-bottom: 1.5rem; }
    .btn { background: #334155; color: #f8fafc; font-weight: 600; padding: 0.6rem 1.2rem; border-radius: 0.6rem; text-decoration: none; display: inline-block; font-size: 0.875rem; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 2.5rem; margin-bottom: 1rem;">⚠️</div>
    <h1>Authentication Cancelled</h1>
    <p>${query.error_description || query.error || 'Google authorization was cancelled.'}</p>
    <button onclick="window.close()" class="btn">Close Window</button>
  </div>
</body>
</html>`;
      return reply.type('text/html').status(400).send(html);
    }

    if (!query.code) {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Missing Authorization Code</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #151d2f; padding: 2.5rem; border-radius: 1.25rem; border: 1px solid #334155; text-align: center; max-width: 440px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Missing Code</h2>
    <p>No authorization code received from Google.</p>
  </div>
</body>
</html>`;
      return reply.type('text/html').status(400).send(html);
    }

    try {
      const { email } = await cliAuthService.handleGeminiCallback(query.code);

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Gemini CLI Linked</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #090d16;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: #111827;
      padding: 2.5rem;
      border-radius: 1.25rem;
      border: 1px solid #38bdf840;
      text-align: center;
      max-width: 420px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      animation: pop 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes pop {
      0% { transform: scale(0.95); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      background: rgba(56, 189, 248, 0.12);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
      margin-bottom: 1.2rem;
    }
    h1 {
      font-size: 1.35rem;
      font-weight: 600;
      margin: 0 0 0.5rem 0;
      color: #ffffff;
    }
    p {
      color: #94a3b8;
      font-size: 0.875rem;
      line-height: 1.5;
      margin: 0 0 1.5rem 0;
    }
    .email {
      color: #38bdf8;
      font-weight: 600;
    }
    .btn {
      background: #38bdf8;
      color: #090d16;
      font-weight: 600;
      padding: 0.65rem 1.4rem;
      border-radius: 0.75rem;
      text-decoration: none;
      display: inline-block;
      font-size: 0.875rem;
      transition: all 0.2s;
    }
    .btn:hover {
      background: #7dd3fc;
      transform: translateY(-1px);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">
      <span>●</span>
      <span>Antigravity CLI Connected</span>
    </div>
    <h1>Account Linked!</h1>
    <p>Authorized as <span class="email">${email || 'Google Account'}</span>.<br>Closing this window and returning to your workspace...</p>
    <a href="http://localhost:5173" class="btn">Return to Workspace</a>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'ANTIGRAVITY_CLI_AUTH_SUCCESS', email: '${email || ''}' }, '*');
      window.opener.postMessage({ type: 'GEMINI_CLI_AUTH_SUCCESS', email: '${email || ''}' }, '*');
      setTimeout(() => {
        window.close();
      }, 1400);
    } else {
      setTimeout(() => {
        window.location.href = 'http://localhost:5173/?antigravity_linked=true';
      }, 1800);
    }
  </script>
</body>
</html>`;
      return reply.type('text/html').status(200).send(html);
    } catch (err) {
      logger.error('Failed to handle Google OAuth callback', err);
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Linking Failed</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #151d2f; padding: 2.5rem; border-radius: 1.25rem; border: 1px solid #ef444455; text-align: center; max-width: 440px; }
    h1 { font-size: 1.25rem; font-weight: 600; color: #f87171; margin-bottom: 0.5rem; }
    p { color: #94a3b8; font-size: 0.875rem; margin-bottom: 1.5rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Linking Failed</h1>
    <p>Unable to exchange authentication token with Google servers. Please try again.</p>
    <a href="http://localhost:5173" style="color: #38bdf8;">Return to Workspace</a>
  </div>
</body>
</html>`;
      return reply.type('text/html').status(500).send(html);
    }
  }

  public async getClaudeAuthUrl(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = req.query as { mode?: 'claudeai' | 'console' };
    const mode = query.mode === 'claudeai' ? 'claudeai' : 'console';
    try {
      const result = await cliAuthService.startClaudeCliLogin(mode);
      return reply.status(200).send(createSuccessResponse(result));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate Claude CLI login URL';
      return reply.status(500).send({ success: false, error: { message: msg } });
    }
  }

  public async loginClaude(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = req.query as { mode?: 'claudeai' | 'console' };
    const mode = query.mode === 'claudeai' ? 'claudeai' : 'console';
    try {
      const { authUrl } = await cliAuthService.startClaudeCliLogin(mode);
      return reply.redirect(authUrl);
    } catch (err: unknown) {
      logger.error('Failed to initiate Claude CLI login redirect', err);
      return reply.type('text/html').status(500).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Claude Auth Error</title></head>
        <body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:2rem;text-align:center;">
          <h2>Failed to initiate Claude Login</h2>
          <p>${err instanceof Error ? err.message : 'Error starting Claude CLI'}</p>
          <button onclick="window.close()" style="padding:0.5rem 1rem;background:#38bdf8;border:none;border-radius:4px;cursor:pointer;">Close</button>
        </body>
        </html>
      `);
    }
  }

  public async submitClaudeCode(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = req.body as { code?: string };
    if (!body?.code) {
      return reply.status(400).send({ success: false, error: { message: 'Authorization code is required' } });
    }
    const success = await cliAuthService.submitClaudeCliCode(body.code);
    return reply.status(200).send(createSuccessResponse({ success }));
  }

  public async unlinkClaude(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await cliAuthService.unlinkClaude();
    return reply.status(200).send(createSuccessResponse({ success: true, message: 'Claude CLI unlinked' }));
  }

  public async getCodexAuthUrl(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const result = await cliAuthService.startCodexCliLogin();
      return reply.status(200).send(createSuccessResponse(result));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate Codex CLI login URL';
      return reply.status(500).send({ success: false, error: { message: msg } });
    }
  }

  public async loginCodex(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const { authUrl } = await cliAuthService.startCodexCliLogin();
      return reply.redirect(authUrl);
    } catch (err: unknown) {
      logger.error('Failed to initiate Codex CLI login redirect', err);
      return reply.type('text/html').status(500).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Codex Auth Error</title></head>
        <body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:2rem;text-align:center;">
          <h2>Failed to initiate OpenAI Codex Login</h2>
          <p>${err instanceof Error ? err.message : 'Error starting Codex CLI'}</p>
          <button onclick="window.close()" style="padding:0.5rem 1rem;background:#10A37F;border:none;border-radius:4px;cursor:pointer;color:white;">Close</button>
        </body>
        </html>
      `);
    }
  }

  public async unlinkCodex(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await cliAuthService.unlinkCodex();
    return reply.status(200).send(createSuccessResponse({ success: true, message: 'Codex CLI unlinked' }));
  }
}

export const cliAuthController = new CliAuthController();
