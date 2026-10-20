import type { FastifyReply, FastifyRequest } from 'fastify';
import { cliAuthService } from './cli-auth.service.js';
import { authService } from './auth.service.js';
import { createSuccessResponse } from '../../utils/response.util.js';
import { logger } from '../../utils/logger.util.js';
import { sandboxService } from '../sandbox/sandbox.service.js';
import { tokenUtil } from '../../utils/token.util.js';
import { antigravityQuotaService } from '../quota/antigravity-quota.service.js';

export class CliAuthController {
  public async getStatus(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = await this.getUserIdFromReq(req);
    const userEmail = await this.getUserEmailFromReq(req);
    const status = await cliAuthService.getCliStatus(userId, userEmail);
    return reply.status(200).send(createSuccessResponse(status));
  }

  private async getUserIdFromReq(req: FastifyRequest): Promise<string | undefined> {
    if (req.userId) return req.userId;

    const authHeader = req.headers.authorization;
    const query = req.query as { token?: string } | undefined;
    const token = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.substring(7) : query?.token;
    if (token) {
      const verified = tokenUtil.verifyJwt(token);
      if (verified.valid && verified.payload?.sub) {
        return verified.payload.sub;
      }
      const session = await authService.getSession(token);
      if (session) return session.user.id;
    }

    return undefined;
  }

  private async getUserEmailFromReq(req: FastifyRequest): Promise<string | undefined> {
    if (req.userEmail) return req.userEmail;

    const authHeader = req.headers.authorization;
    const query = req.query as { token?: string } | undefined;
    const token = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.substring(7) : query?.token;
    if (token) {
      const verified = tokenUtil.verifyJwt(token);
      if (verified.valid && (verified.payload as any)?.email) {
        return (verified.payload as any).email;
      }
      const session = await authService.getSession(token);
      if (session?.user?.email) return session.user.email;
    }

    return undefined;
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
      logger.warn('[Antigravity Auth] Code submission rejected: missing code in request payload');
      return reply.status(400).send({ success: false, error: { message: 'Authorization code is required' } });
    }
    const userId = await this.getUserIdFromReq(req);
    const email = await this.getUserEmailFromReq(req);
    const result = await cliAuthService.submitAntigravityCliCode(body.code, userId, email);
    if (result.success) {
      if (userId) {
        cliAuthService.linkUserCli(userId, 'antigravity', email);
        await sandboxService.syncCredentialsToUserSandboxes(userId).catch(() => {});
        antigravityQuotaService.invalidateUserQuota(userId);
        if (email) antigravityQuotaService.invalidateUserQuota(email);
      }
      return reply.status(200).send(createSuccessResponse({ success: true }));
    }
    return reply.status(400).send({
      success: false,
      error: {
        message: result.error || 'Failed to verify Antigravity authorization code',
        reason: result.reason,
      },
    });
  }

  public async getGeminiAuthUrl(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    return this.getAntigravityAuthUrl(req, reply);
  }

  public async loginGemini(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    return this.loginAntigravity(req, reply);
  }

  public async unlinkGemini(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = await this.getUserIdFromReq(req);
    const userEmail = await this.getUserEmailFromReq(req);
    if (userId || userEmail) {
      cliAuthService.unlinkUserCli(userId || '', 'antigravity', userEmail);
      cliAuthService.unlinkUserCli(userId || '', 'gemini', userEmail);
      if (userId) {
        sandboxService.purgeUserCredentialsFromSandboxes(userId, 'antigravity').catch(() => {});
      }
    }
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
      const userId = await this.getUserIdFromReq(req);
      sandboxService.syncCredentialsToUserSandboxes(userId).catch(() => {});

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
    if (success) {
      const userId = await this.getUserIdFromReq(req);
      const email = await this.getUserEmailFromReq(req);
      if (userId) {
        cliAuthService.linkUserCli(userId, 'claude', email);
        sandboxService.syncCredentialsToUserSandboxes(userId).catch(() => {});
      }
    }
    return reply.status(200).send(createSuccessResponse({ success }));
  }

  public async unlinkClaude(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = await this.getUserIdFromReq(req);
    const userEmail = await this.getUserEmailFromReq(req);
    if (userId || userEmail) {
      cliAuthService.unlinkUserCli(userId || '', 'claude', userEmail);
      if (userId) {
        sandboxService.purgeUserCredentialsFromSandboxes(userId, 'claude').catch(() => {});
      }
    }
    await cliAuthService.unlinkClaude();
    return reply.status(200).send(createSuccessResponse({ success: true, message: 'Claude CLI unlinked' }));
  }

  public async getCodexAuthUrl(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const query = req.query as { token?: string };
      let userId = await this.getUserIdFromReq(req);
      let userEmail = await this.getUserEmailFromReq(req);

      if (!userId && query?.token) {
        const session = await authService.getSession(query.token);
        if (session) {
          userId = session.user.id;
          userEmail = session.user.email;
        } else {
          const verified = tokenUtil.verifyJwt(query.token);
          if (verified.valid && verified.payload) {
            userId = (verified.payload as any).userId || verified.payload.sub;
            userEmail = (verified.payload as any).email;
          }
        }
      }

      logger.info('[Codex Auth] Generating Codex CLI auth URL via API', { userId, userEmail });
      const result = await cliAuthService.startCodexCliLogin(userId, userEmail);
      logger.info('[Codex Auth] Generated Codex CLI auth URL', { userId, userCode: result.userCode, authUrl: result.authUrl });
      return reply.status(200).send(createSuccessResponse(result));
    } catch (err: unknown) {
      logger.error('[Codex Auth] Failed to generate Codex CLI login URL', err);
      const msg = err instanceof Error ? err.message : 'Failed to generate Codex CLI login URL';
      return reply.status(500).send({ success: false, error: { message: msg } });
    }
  }

  public async loginCodex(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const query = req.query as { token?: string };
      let userId = await this.getUserIdFromReq(req);
      let userEmail = await this.getUserEmailFromReq(req);

      if (!userId && query?.token) {
        const session = await authService.getSession(query.token);
        if (session) {
          userId = session.user.id;
          userEmail = session.user.email;
        } else {
          const verified = tokenUtil.verifyJwt(query.token);
          if (verified.valid && verified.payload) {
            userId = (verified.payload as any).userId || verified.payload.sub;
            userEmail = (verified.payload as any).email;
          }
        }
      }

      logger.info('[Codex Auth] Initiating Codex CLI login popup request', { userId, userEmail, hasToken: Boolean(query?.token) });
      const { authUrl, userCode } = await cliAuthService.startCodexCliLogin(userId, userEmail);
      logger.info('[Codex Auth] Codex CLI device auth prompt ready for popup', { userId, userCode, authUrl });

      if (userCode) {
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize Codex CLI · Atelier</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #0b0f19;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
    }
    .card {
      background: #151d2f;
      border: 1px solid rgba(16, 163, 127, 0.35);
      border-radius: 1.25rem;
      padding: 2.25rem 2rem;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: rgba(16, 163, 127, 0.15);
      border: 1px solid rgba(16, 163, 127, 0.3);
      margin-bottom: 1.25rem;
    }
    .badge svg {
      width: 26px;
      height: 26px;
      fill: #10A37F;
    }
    h1 {
      font-size: 1.35rem;
      font-weight: 600;
      color: #f8fafc;
      margin-bottom: 0.5rem;
    }
    p.desc {
      color: #94a3b8;
      font-size: 0.875rem;
      line-height: 1.5;
      margin-bottom: 1.5rem;
    }
    .code-box {
      background: #0b0f19;
      border: 1px dashed rgba(16, 163, 127, 0.5);
      border-radius: 0.75rem;
      padding: 1rem 1.25rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }
    .code-val {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: 0.15em;
      color: #34d399;
      user-select: all;
    }
    .btn-copy {
      background: #1e293b;
      border: 1px solid rgba(148, 163, 184, 0.2);
      color: #f8fafc;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.4rem 0.75rem;
      border-radius: 0.5rem;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .btn-copy:hover {
      background: #334155;
    }
    .btn-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      width: 100%;
      background: #10A37F;
      color: white;
      text-decoration: none;
      font-size: 0.95rem;
      font-weight: 600;
      padding: 0.85rem 1.25rem;
      border-radius: 0.75rem;
      border: none;
      cursor: pointer;
      transition: all 0.15s ease;
      box-shadow: 0 4px 12px rgba(16, 163, 127, 0.3);
    }
    .btn-action:hover {
      background: #0d8a6a;
      box-shadow: 0 6px 16px rgba(16, 163, 127, 0.4);
    }
    .status-bar {
      margin-top: 1.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.6rem;
      font-size: 0.825rem;
      color: #94a3b8;
    }
    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(16, 163, 127, 0.25);
      border-top-color: #10A37F;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .success {
      color: #34d399 !important;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">
      <svg viewBox="0 0 24 24">
        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1683a.071.071 0 0 1 .038.052v5.5826a4.5045 4.5045 0 0 1-4.4945 4.4947zm-9.426-4.9961a4.466 4.466 0 0 1-.5351-3.0094l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-5.906-2.5171zm-1.5201-9.6118a4.4755 4.4755 0 0 1 2.336-1.9663v5.6635a.7712.7712 0 0 0 .3879.6718l5.8428 3.3733-2.02 1.1683a.0757.0757 0 0 1-.071 0l-4.8304-2.7915a4.4945 4.4945 0 0 1-1.6453-6.1192zm16.5 4.8727-5.8428-3.3733 2.02-1.1683a.0757.0757 0 0 1 .071 0l4.8304 2.7915a4.4945 4.4945 0 0 1-.6535 8.0855v-5.6635a.7712.7712 0 0 0-.4251-.6719zm2.3965-3.0567l-.142-.0852-4.7783-2.7582a.7712.7712 0 0 0-.7854 0L9.809 6.2201V3.8877a.0804.0804 0 0 1 .0332-.0615l4.897-2.8293a4.4992 4.4992 0 0 1 6.6805 4.7474zm-11.822-2.3324v6.7369l-2.02-1.1683a.071.071 0 0 1-.038-.052V2.4278a4.5045 4.5045 0 0 1 4.4945-4.4947l-.142.0804-4.7783 2.7582a.7948.7948 0 0 0-.3927.6813zm2.0108 4.2644l2.8764-1.6568 2.8764 1.6568v3.3136l-2.8764 1.6568-2.8764-1.6568z"/>
      </svg>
    </div>
    <h1>Authorize OpenAI Codex CLI</h1>
    <p class="desc">Enter the one-time device code below on OpenAI to link your account to Atelier:</p>

    <div class="code-box">
      <span id="code-val" class="code-val">${userCode}</span>
      <button type="button" id="copy-btn" class="btn-copy" onclick="copyCode()">Copy Code</button>
    </div>

    <button type="button" id="open-btn" class="btn-action" onclick="openAndCopy()">
      <span>Copy Code & Open auth.openai.com</span>
      <span style="font-size: 1.1rem;">↗</span>
    </button>

    <div id="status-box" class="status-bar">
      <div class="spinner"></div>
      <span id="status-label">Waiting for authorization on OpenAI...</span>
    </div>
  </div>

  <script>
    const code = "${userCode}";
    const authUrl = "${authUrl}";
    const authToken = "${query?.token || ''}";
    const authUserId = "${userId || ''}";
    const authUserEmail = "${userEmail || ''}";

    function copyCode() {
      navigator.clipboard.writeText(code).then(() => {
        const btn = document.getElementById('copy-btn');
        btn.innerText = 'Copied!';
        btn.style.color = '#34d399';
        setTimeout(() => {
          btn.innerText = 'Copy Code';
          btn.style.color = '#f8fafc';
        }, 2500);
      }).catch(() => {});
    }

    function openAndCopy() {
      copyCode();
      const openBtn = document.getElementById('open-btn');
      openBtn.innerHTML = '<span>Code Copied! Complete in OpenAI Tab</span> <span>↗</span>';
      window.open(authUrl, '_blank');
    }

    async function checkApproval() {
      try {
        const params = new URLSearchParams();
        if (authToken) params.set('token', authToken);
        if (authUserId) params.set('userId', authUserId);
        if (authUserEmail) params.set('userEmail', authUserEmail);
        const queryStr = params.toString() ? '?' + params.toString() : '';

        const headers = {};
        if (authToken) headers['Authorization'] = 'Bearer ' + authToken;

        const res = await fetch('/api/v1/auth/cli/status' + queryStr, { headers });
        if (!res.ok) return;
        const data = await res.json();
        if (data.data?.codex?.linked) {
          if (pollTimer) clearInterval(pollTimer);
          window.removeEventListener('focus', checkApproval);
          const statusBox = document.getElementById('status-box');
          statusBox.innerHTML = '<span class="success">✓ Codex CLI Successfully Linked! Closing...</span>';
          if (window.opener) {
            window.opener.postMessage({
              type: 'CODEX_CLI_AUTH_SUCCESS',
              email: data.data.codex.email
            }, '*');
          }
          setTimeout(() => {
            window.close();
          }, 1000);
        }
      } catch (err) {}
    }

    // Check immediately when user switches focus back to this window
    window.addEventListener('focus', checkApproval);
    let attempts = 0;
    const pollTimer = setInterval(() => {
      attempts++;
      if (attempts > 100) {
        clearInterval(pollTimer);
        window.removeEventListener('focus', checkApproval);
        return;
      }
      checkApproval();
    }, 3000);
  </script>
</body>
</html>`;
        return reply.type('text/html').send(html);
      }

      return reply.redirect(authUrl);
    } catch (err: unknown) {
      logger.error('[Codex Auth] Failed to initiate Codex CLI login redirect', err);
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

  public async unlinkCodex(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = await this.getUserIdFromReq(req);
    const userEmail = await this.getUserEmailFromReq(req);
    logger.info('[Codex Auth] Unlinking Codex CLI request received', { userId, userEmail });
    if (userId || userEmail) {
      cliAuthService.unlinkUserCli(userId || '', 'codex', userEmail);
      if (userId) {
        sandboxService.purgeUserCredentialsFromSandboxes(userId, 'codex').catch(() => {});
      }
    }
    await cliAuthService.unlinkCodex(userId);
    logger.info('[Codex Auth] Codex CLI successfully unlinked', { userId });
    return reply.status(200).send(createSuccessResponse({ success: true, message: 'Codex CLI unlinked' }));
  }
}

export const cliAuthController = new CliAuthController();
