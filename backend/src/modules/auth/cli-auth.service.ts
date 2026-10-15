import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { logger } from '../../utils/logger.util.js';
import { AppError } from '../../utils/error.util.js';
import type { CliUsageTelemetry } from '../quota/quota.types.js';
import type { AgentStep } from '../../types/agent.types.js';

export interface CliExecutionResult {
  text: string;
  durationMs: number;
  usage: CliUsageTelemetry;
}

export interface CliStatusResult {
  antigravity: {
    linked: boolean;
    email?: string;
    name?: string;
    linkedAt?: string;
    hasApiKey?: boolean;
    details?: string;
  };
  gemini: {
    linked: boolean;
    email?: string;
    name?: string;
    linkedAt?: string;
    hasApiKey?: boolean;
    details?: string;
  };
  claude: {
    linked: boolean;
    authMethod?: string;
    email?: string;
    linkedAt?: string;
  };
  codex: {
    linked: boolean;
    email?: string;
    linkedAt?: string;
  };
}

export class CliAuthService {
  // Gemini Code Assist OAuth credentials resolved dynamically from environment
  private readonly GEMINI_CLIENT_ID =
    process.env.GEMINI_CLI_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
  private readonly GEMINI_CLIENT_SECRET =
    process.env.GEMINI_CLI_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
  private readonly GEMINI_REDIRECT_URI = 'http://127.0.0.1:4000/oauth2callback';
  private readonly GEMINI_SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'openid',
  ].join(' ');

  private activeAntigravityLogin: {
    process: ChildProcess;
    authUrl?: string;
    startedAt: number;
    timeoutId: NodeJS.Timeout;
  } | null = null;

  private activeClaudeLogin: {
    process: ChildProcess;
    authUrl?: string;
    startedAt: number;
    timeoutId: NodeJS.Timeout;
  } | null = null;

  private cachedClaudeStatus: {
    linked: boolean;
    authMethod?: string;
    email?: string;
    timestamp: number;
  } | null = null;

  private activeCodexLogin: {
    process: ChildProcess;
    authUrl?: string;
    startedAt: number;
    timeoutId: NodeJS.Timeout;
  } | null = null;

  private cachedCodexStatus: {
    linked: boolean;
    email?: string;
    timestamp: number;
  } | null = null;

  private getGeminiDir(): string {
    return path.join(os.homedir(), '.gemini');
  }

  private getGeminiCredsPath(): string {
    return path.join(this.getGeminiDir(), 'oauth_creds.json');
  }

  private getGeminiUserInfoPath(): string {
    return path.join(this.getGeminiDir(), 'user_info.json');
  }

  private getGeminiSettingsPath(): string {
    return path.join(this.getGeminiDir(), 'settings.json');
  }

  /**
   * Retrieves or refreshes a valid Google OAuth access token for linked Antigravity/Gemini accounts.
   * Completely avoids requiring any developer API keys from the user.
   */
  public async getValidGeminiAccessToken(): Promise<string | null> {
    const credsPath = this.getGeminiCredsPath();
    if (!fs.existsSync(credsPath)) return null;

    try {
      const raw = fs.readFileSync(credsPath, 'utf8');
      const creds = JSON.parse(raw);
      const now = Date.now();

      // If existing access_token is valid for at least 2 more minutes, return it
      if (creds.access_token && creds.expiry_date && creds.expiry_date > now + 120000) {
        return creds.access_token;
      }

      // If refresh_token is present, refresh the token automatically
      if (creds.refresh_token) {
        const tokenBody = new URLSearchParams({
          client_id: this.GEMINI_CLIENT_ID,
          client_secret: this.GEMINI_CLIENT_SECRET,
          refresh_token: creds.refresh_token,
          grant_type: 'refresh_token',
        });

        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: tokenBody.toString(),
        });

        if (res.ok) {
          const data = (await res.json()) as { access_token: string; expires_in?: number; scope?: string };
          creds.access_token = data.access_token;
          creds.expiry_date = now + (data.expires_in || 3600) * 1000;
          if (data.scope) creds.scope = data.scope;
          fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
          logger.info('Refreshed linked Google OAuth access token for cloud inference');
          return creds.access_token;
        } else {
          logger.warn('Failed to refresh Google OAuth token', { status: res.status });
        }
      }

      return creds.access_token || null;
    } catch (err) {
      logger.warn('Error reading or refreshing Gemini OAuth credentials', { error: String(err) });
      return null;
    }
  }

  /**
   * Generates the Google OAuth authorization URL for Gemini CLI linking.
   */
  public getGeminiAuthUrl(state?: string): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', this.GEMINI_CLIENT_ID);
    url.searchParams.set('redirect_uri', this.GEMINI_REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.GEMINI_SCOPES);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    if (state) {
      url.searchParams.set('state', state);
    }
    return url.toString();
  }

  /**
   * Exchanges authorization code for tokens and writes credentials for Gemini CLI.
   */
  public async handleGeminiCallback(code: string): Promise<{ success: boolean; email?: string }> {
    try {
      const tokenBody = new URLSearchParams({
        code,
        client_id: this.GEMINI_CLIENT_ID,
        client_secret: this.GEMINI_CLIENT_SECRET,
        redirect_uri: this.GEMINI_REDIRECT_URI,
        grant_type: 'authorization_code',
      });

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
      });

      if (!tokenRes.ok) {
        const errorText = await tokenRes.text();
        logger.error('Failed to exchange code with Google OAuth endpoint', { errorText });
        throw new AppError(`Google OAuth token exchange failed: ${errorText}`, 400, 'AUTH_ERROR');
      }

      const tokenData = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        scope?: string;
        expires_in?: number;
        token_type?: string;
      };

      const geminiDir = this.getGeminiDir();
      if (!fs.existsSync(geminiDir)) {
        fs.mkdirSync(geminiDir, { recursive: true, mode: 0o700 });
      }

      // Check for existing refresh token if not returned on re-auth
      let existingRefreshToken = '';
      const credsPath = this.getGeminiCredsPath();
      if (fs.existsSync(credsPath)) {
        try {
          const oldContent = fs.readFileSync(credsPath, 'utf8');
          const oldCreds = JSON.parse(oldContent);
          existingRefreshToken = oldCreds.refresh_token || '';
        } catch {
          // ignore error reading old creds
        }
      }

      const credentials = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || existingRefreshToken,
        scope: tokenData.scope || this.GEMINI_SCOPES,
        token_type: tokenData.token_type || 'Bearer',
        expiry_date: Date.now() + (tokenData.expires_in || 3600) * 1000,
      };

      // Save credentials for Gemini CLI
      fs.writeFileSync(credsPath, JSON.stringify(credentials, null, 2), {
        mode: 0o600,
      });

      // Ensure settings.json configures oauth-personal
      const settingsPath = this.getGeminiSettingsPath();
      let settings: Record<string, any> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        } catch {
          settings = {};
        }
      }
      settings.security = settings.security || {};
      settings.security.auth = settings.security.auth || {};
      settings.security.auth.selectedType = 'oauth-personal';
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });

      // Mirror credentials and settings to antigravity-cli directory
      const agyCliDir = path.join(geminiDir, 'antigravity-cli');
      if (fs.existsSync(agyCliDir)) {
        try {
          fs.writeFileSync(path.join(agyCliDir, 'oauth_creds.json'), JSON.stringify(credentials, null, 2), { mode: 0o600 });
          const agySettingsPath = path.join(agyCliDir, 'settings.json');
          let agySettings: Record<string, any> = {};
          if (fs.existsSync(agySettingsPath)) {
            try { agySettings = JSON.parse(fs.readFileSync(agySettingsPath, 'utf8')); } catch { agySettings = {}; }
          }
          agySettings.security = agySettings.security || {};
          agySettings.security.auth = agySettings.security.auth || {};
          agySettings.security.auth.selectedType = 'oauth-personal';
          fs.writeFileSync(agySettingsPath, JSON.stringify(agySettings, null, 2), { mode: 0o600 });
        } catch (e) {
          logger.warn('Failed to mirror credentials to antigravity-cli dir', { error: String(e) });
        }
      }

      // Fetch public user profile to cache email for UI display
      let userEmail = '';
      try {
        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (userRes.ok) {
          const userInfo = (await userRes.json()) as { email?: string; name?: string; picture?: string };
          userEmail = userInfo.email || '';
          fs.writeFileSync(
            this.getGeminiUserInfoPath(),
            JSON.stringify(
              {
                email: userInfo.email,
                name: userInfo.name,
                picture: userInfo.picture,
                linkedAt: new Date().toISOString(),
              },
              null,
              2
            ),
            { mode: 0o600 }
          );

          // Update google_accounts.json so agy knows the active Google account
          const googleAccountsPath = path.join(geminiDir, 'google_accounts.json');
          fs.writeFileSync(
            googleAccountsPath,
            JSON.stringify({ active: userEmail, old: [] }, null, 2),
            { mode: 0o600 }
          );
          if (fs.existsSync(agyCliDir)) {
            fs.writeFileSync(
              path.join(agyCliDir, 'google_accounts.json'),
              JSON.stringify({ active: userEmail, old: [] }, null, 2),
              { mode: 0o600 }
            );
          }
        }
      } catch (err) {
        logger.warn('Failed to fetch userinfo after Google OAuth linking', { error: String(err) });
      }

      logger.info('Gemini / Antigravity CLI successfully authenticated and credentials cached', { email: userEmail });
      return { success: true, email: userEmail };
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error('Unexpected error during Gemini CLI OAuth linking', err);
      throw new AppError('Gemini OAuth linking encountered an unexpected error', 500, 'INTERNAL_ERROR');
    }
  }

  public getAntigravityBin(): string {
    const localBin = path.join(os.homedir(), '.local', 'bin', 'agy');
    if (fs.existsSync(localBin)) return localBin;
    if (fs.existsSync('/snap/bin/agy')) return '/snap/bin/agy';
    if (fs.existsSync('/snap/antigravity-cli/current/bin/agy')) return '/snap/antigravity-cli/current/bin/agy';
    if (fs.existsSync('/usr/local/bin/agy')) return '/usr/local/bin/agy';
    return 'agy';
  }

  /**
   * Discovers and synchronizes valid Antigravity CLI OAuth credentials across standard config paths.
   */
  public syncAntigravityCredentials(): boolean {
    const homedir = os.homedir();

    // 1. Look for agy's dedicated token files (antigravity-keyring-unavailable-oauth-token)
    const agyTokenPaths = [
      path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-oauth-token'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
    ];

    let newestTokenPath = '';
    let newestTokenMtime = 0;
    let validTokenText = '';

    for (const p of agyTokenPaths) {
      if (fs.existsSync(p)) {
        try {
          const stats = fs.statSync(p);
          if (stats.size > 20 && stats.mtimeMs > newestTokenMtime) {
            newestTokenMtime = stats.mtimeMs;
            newestTokenPath = p;
            validTokenText = fs.readFileSync(p, 'utf8');
          }
        } catch {}
      }
    }

    if (validTokenText) {
      try {
        const geminiDir = this.getGeminiDir();
        const agyCliDir = path.join(geminiDir, 'antigravity-cli');
        const agyCacheDir = path.join(agyCliDir, 'cache');
        if (!fs.existsSync(geminiDir)) fs.mkdirSync(geminiDir, { recursive: true, mode: 0o700 });
        if (!fs.existsSync(agyCliDir)) fs.mkdirSync(agyCliDir, { recursive: true, mode: 0o700 });
        if (!fs.existsSync(agyCacheDir)) fs.mkdirSync(agyCacheDir, { recursive: true, mode: 0o700 });

        // Synchronize across standard agy token paths
        fs.writeFileSync(path.join(agyCacheDir, 'antigravity-keyring-unavailable-oauth-token'), validTokenText, { mode: 0o600 });
        fs.writeFileSync(path.join(agyCliDir, 'antigravity-oauth-token'), validTokenText, { mode: 0o600 });
        fs.writeFileSync(path.join(agyCacheDir, 'antigravity-oauth-token'), validTokenText, { mode: 0o600 });
        fs.writeFileSync(path.join(agyCacheDir, 'jetski-keyring-unavailable-oauth-token'), validTokenText, { mode: 0o600 });
        fs.writeFileSync(path.join(agyCliDir, 'jetski-oauth-token'), validTokenText, { mode: 0o600 });

        // Snap directory if accessible
        const snapAgyCache = path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'cache');
        if (fs.existsSync(path.dirname(snapAgyCache))) {
          if (!fs.existsSync(snapAgyCache)) fs.mkdirSync(snapAgyCache, { recursive: true, mode: 0o700 });
          fs.writeFileSync(path.join(snapAgyCache, 'antigravity-keyring-unavailable-oauth-token'), validTokenText, { mode: 0o600 });
        }

        logger.info('Antigravity CLI token synchronized successfully', { source: newestTokenPath });
        return true;
      } catch (err) {
        logger.warn('Failed to sync Antigravity token', { error: String(err) });
      }
    }

    // 2. Also check for legacy oauth_creds.json
    const candidatePaths = [
      path.join(homedir, '.gemini', 'oauth_creds.json'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'oauth_creds.json'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'oauth_creds.json'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'oauth_creds.json.bak'),
    ];

    let newestPath = '';
    let newestMtime = 0;
    let validCreds: any = null;

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          const stats = fs.statSync(p);
          const raw = fs.readFileSync(p, 'utf8');
          const parsed = JSON.parse(raw);
          if (parsed && (parsed.access_token || parsed.refresh_token)) {
            if (stats.mtimeMs > newestMtime) {
              newestMtime = stats.mtimeMs;
              newestPath = p;
              validCreds = parsed;
            }
          }
        } catch {}
      }
    }

    if (!validCreds) return Boolean(validTokenText);

    try {
      const geminiDir = this.getGeminiDir();
      const agyCliDir = path.join(geminiDir, 'antigravity-cli');
      if (!fs.existsSync(geminiDir)) fs.mkdirSync(geminiDir, { recursive: true, mode: 0o700 });
      if (!fs.existsSync(agyCliDir)) fs.mkdirSync(agyCliDir, { recursive: true, mode: 0o700 });

      // Save credentials in both standard locations
      fs.writeFileSync(path.join(geminiDir, 'oauth_creds.json'), JSON.stringify(validCreds, null, 2), { mode: 0o600 });
      fs.writeFileSync(path.join(agyCliDir, 'oauth_creds.json'), JSON.stringify(validCreds, null, 2), { mode: 0o600 });

      // Configure settings.json to oauth-personal
      const settingsObj = { security: { auth: { selectedType: 'oauth-personal' } } };
      fs.writeFileSync(path.join(geminiDir, 'settings.json'), JSON.stringify(settingsObj, null, 2), { mode: 0o600 });
      fs.writeFileSync(path.join(agyCliDir, 'settings.json'), JSON.stringify(settingsObj, null, 2), { mode: 0o600 });

      // Extract user email if id_token or access_token is present
      let email = '';
      let name = '';
      if (validCreds.id_token) {
        try {
          const payload = JSON.parse(Buffer.from(validCreds.id_token.split('.')[1], 'base64').toString());
          if (payload.email) email = payload.email;
          if (payload.name) name = payload.name;
        } catch {}
      }

      if (email) {
        const userInfo = { email, name, linkedAt: new Date().toISOString() };
        fs.writeFileSync(this.getGeminiUserInfoPath(), JSON.stringify(userInfo, null, 2), { mode: 0o600 });
        const accounts = { active: email, old: [] };
        fs.writeFileSync(path.join(geminiDir, 'google_accounts.json'), JSON.stringify(accounts, null, 2), { mode: 0o600 });
        fs.writeFileSync(path.join(agyCliDir, 'google_accounts.json'), JSON.stringify(accounts, null, 2), { mode: 0o600 });
      }

      logger.info('Antigravity credentials synchronized successfully', { source: newestPath, email });
      return true;
    } catch (err) {
      logger.warn('Failed to sync Antigravity credentials', { error: String(err) });
      return Boolean(validTokenText);
    }
  }

  /**
   * Initiates Antigravity CLI Google OAuth authentication flow.
   * Spawns agy in headless mode, extracts the PKCE authorization URL, and holds process open for code.
   */
  public async startAntigravityCliLogin(force: boolean = false): Promise<{ authUrl: string; sessionId: string }> {
    if (
      !force &&
      this.activeAntigravityLogin &&
      this.activeAntigravityLogin.authUrl &&
      this.activeAntigravityLogin.process &&
      !this.activeAntigravityLogin.process.killed &&
      Date.now() - this.activeAntigravityLogin.startedAt < 900000
    ) {
      return {
        authUrl: this.activeAntigravityLogin.authUrl,
        sessionId: String(this.activeAntigravityLogin.startedAt),
      };
    }

    if (this.activeAntigravityLogin) {
      clearTimeout(this.activeAntigravityLogin.timeoutId);
      try {
        this.activeAntigravityLogin.process.kill('SIGTERM');
      } catch {}
      this.activeAntigravityLogin = null;
    }

    const agyBin = this.getAntigravityBin();

    return new Promise((resolve, reject) => {
      let resolved = false;
      const proc = spawn(agyBin, ['-p', 'init'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DBUS_SESSION_BUS_ADDRESS: '',
        },
      });

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          try { proc.kill('SIGTERM'); } catch {}
          reject(new AppError('Antigravity CLI login timed out waiting for authorization URL', 504, 'TIMEOUT'));
        }
      }, 10000);

      const sessionExpiryTimer = setTimeout(() => {
        if (this.activeAntigravityLogin?.process === proc) {
          try { proc.kill('SIGTERM'); } catch {}
          this.activeAntigravityLogin = null;
        }
      }, 900000); // 15 minutes to allow user to complete browser OAuth

      let buf = '';

      const handleChunk = (chunk: Buffer) => {
        buf += chunk.toString();
        const urlMatch = buf.match(/https:\/\/accounts\.google\.com\/[^\s\x1b\x07]+/);
        if (urlMatch && !resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          const authUrl = urlMatch[0];
          this.activeAntigravityLogin = {
            process: proc,
            authUrl,
            startedAt: Date.now(),
            timeoutId: sessionExpiryTimer,
          };
          logger.info('Captured Antigravity CLI OAuth authorization URL', { authUrl });
          resolve({ authUrl, sessionId: String(Date.now()) });
        }
      };

      proc.stdout?.on('data', handleChunk);
      proc.stderr?.on('data', handleChunk);

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        clearTimeout(sessionExpiryTimer);
        if (this.activeAntigravityLogin?.process === proc) {
          this.activeAntigravityLogin = null;
        }
        if (code === 0) {
          logger.info('Antigravity CLI login process completed successfully');
          this.syncAntigravityCredentials();
        } else if (!resolved) {
          reject(new AppError(`Antigravity CLI login process exited with code ${code}: ${buf}`, 500, 'CLI_LOGIN_ERROR'));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        clearTimeout(sessionExpiryTimer);
        if (!resolved) {
          reject(new AppError(`Failed to spawn Antigravity CLI: ${err.message}`, 500, 'SPAWN_ERROR'));
        }
      });
    });
  }

  /**
   * Submits user-provided authorization code to active Antigravity CLI process stdin.
   */
  public async submitAntigravityCliCode(code: string): Promise<boolean> {
    if (!this.activeAntigravityLogin || !this.activeAntigravityLogin.process.stdin?.writable) {
      logger.warn('No active Antigravity CLI login process waiting for code');
      return false;
    }
    const proc = this.activeAntigravityLogin.process;

    // Sanitize code: If user pasted redirect URL (https://antigravity.google/oauth-callback?code=4/0A...&state=...), extract the code
    let cleanCode = code.trim();
    if (cleanCode.includes('code=')) {
      try {
        const parsed = new URL(cleanCode);
        cleanCode = parsed.searchParams.get('code') || cleanCode;
      } catch {
        const m = cleanCode.match(/[?&]code=([^&]+)/);
        if (m) cleanCode = decodeURIComponent(m[1]);
      }
    }

    return new Promise((resolve) => {
      let finished = false;
      const finish = (ok: boolean) => {
        if (!finished) {
          finished = true;
          if (ok) {
            this.syncAntigravityCredentials();
          }
          resolve(ok);
        }
      };

      proc.stdout?.on('data', (d) => {
        logger.info('Antigravity CLI stdout after code submission', { output: d.toString() });
      });

      proc.stderr?.on('data', (d) => {
        logger.info('Antigravity CLI stderr after code submission', { output: d.toString() });
      });

      proc.once('close', (exitCode) => {
        logger.info('Antigravity CLI login process closed after code submission', { exitCode });
        const linked = this.isAntigravityLinked();
        finish(exitCode === 0 || linked);
      });

      const timer = setTimeout(() => {
        const linked = this.syncAntigravityCredentials();
        finish(linked);
      }, 15000);

      try {
        logger.info('Writing authorization code to Antigravity CLI stdin');
        proc.stdin!.write(cleanCode + '\n');
      } catch (err) {
        clearTimeout(timer);
        logger.warn('Failed to submit authorization code to Antigravity CLI stdin', { error: String(err) });
        finish(false);
      }
    });
  }

  /**
   * Check whether Antigravity CLI is currently linked with genuine valid agy tokens.
   */
  public isAntigravityLinked(): boolean {
    const homedir = os.homedir();
    const agyTokenPaths = [
      path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-oauth-token'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
    ];

    for (const p of agyTokenPaths) {
      if (fs.existsSync(p)) {
        try {
          const stats = fs.statSync(p);
          if (stats.size > 20) {
            return true;
          }
        } catch {}
      }
    }
    return false;
  }

  public isGeminiLinked(): boolean {
    const homedir = os.homedir();
    const geminiCredsPath = path.join(homedir, '.gemini', 'oauth_creds.json');
    if (fs.existsSync(geminiCredsPath)) {
      try {
        const stats = fs.statSync(geminiCredsPath);
        if (stats.size > 20) return true;
      } catch {}
    }
    return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  }

  /**
   * Unlinks Gemini / Antigravity CLI credentials.
   */
  public unlinkGemini(): void {
    if (this.activeAntigravityLogin) {
      clearTimeout(this.activeAntigravityLogin.timeoutId);
      try {
        this.activeAntigravityLogin.process.kill('SIGTERM');
      } catch {}
      this.activeAntigravityLogin = null;
    }

    const homedir = os.homedir();
    const toRemove = [
      this.getGeminiCredsPath(),
      path.join(this.getGeminiDir(), 'antigravity-cli', 'oauth_creds.json'),
      this.getGeminiUserInfoPath(),
      path.join(this.getGeminiDir(), 'google_accounts.json'),
      path.join(this.getGeminiDir(), 'antigravity-cli', 'google_accounts.json'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'jetski-keyring-unavailable-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'jetski-oauth-token'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
    ];

    for (const p of toRemove) {
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch {}
      }
    }

    // Also backup snap credentials so unlink is clean and complete
    const snapCredsPath = path.join(os.homedir(), 'snap', 'antigravity-cli', 'common', '.gemini', 'oauth_creds.json');
    if (fs.existsSync(snapCredsPath)) {
      try {
        fs.renameSync(snapCredsPath, `${snapCredsPath}.bak`);
      } catch {}
    }
  }

  public unlinkAntigravity(): void {
    this.unlinkGemini();
  }

  /**
   * Gets current status of all 3 CLI linkings.
   */
  public getCliStatus(): CliStatusResult {
    const antigravityLinked = this.isAntigravityLinked();
    const geminiLinked = this.isGeminiLinked();
    let email: string | undefined;
    let name: string | undefined;
    let linkedAt: string | undefined;

    const userInfoPath = this.getGeminiUserInfoPath();
    if (fs.existsSync(userInfoPath)) {
      try {
        const info = JSON.parse(fs.readFileSync(userInfoPath, 'utf8'));
        email = info.email;
        name = info.name;
        linkedAt = info.linkedAt;
      } catch {}
    }

    // Claude CLI credentials check
    const claudeLinked = this.isClaudeLinked();

    // Codex CLI status check
    const codexLinked = this.isCodexLinked();

    const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    const agyStatus = {
      linked: antigravityLinked,
      email: antigravityLinked ? email : undefined,
      name: antigravityLinked ? name : undefined,
      linkedAt: antigravityLinked ? linkedAt : undefined,
      hasApiKey: false,
      details: antigravityLinked
        ? email
          ? `Authorized as ${email} · Ready for cloud microVM execution`
          : 'Antigravity CLI Authorized · Ready for cloud microVM execution'
        : 'Connect your Google account to run Antigravity CLI models without API keys',
    };

    const geminiStatus = {
      linked: geminiLinked,
      email: geminiLinked ? email : undefined,
      name: geminiLinked ? name : undefined,
      linkedAt: geminiLinked ? linkedAt : undefined,
      hasApiKey: hasGeminiKey,
      details: hasGeminiKey
        ? 'Gemini API Key Active · Ready for cloud execution'
        : geminiLinked && email
        ? `Authorized as ${email} · Ready for cloud execution`
        : 'Connect your Google account to run Gemini models',
    };

    return {
      antigravity: agyStatus,
      gemini: geminiStatus,
      claude: {
        linked: claudeLinked,
        authMethod: this.cachedClaudeStatus?.authMethod,
        email: this.cachedClaudeStatus?.email,
      },
      codex: {
        linked: codexLinked,
        email: this.cachedCodexStatus?.email || (codexLinked ? 'ChatGPT Account' : undefined),
      },
    };
  }

  public getClaudeBin(): string {
    const localBin = path.join(os.homedir(), '.local', 'bin', 'claude');
    if (fs.existsSync(localBin)) return localBin;
    return 'claude';
  }

  public isClaudeLinked(): boolean {
    if (this.cachedClaudeStatus && Date.now() - this.cachedClaudeStatus.timestamp < 10000) {
      return Boolean(this.cachedClaudeStatus.linked && this.cachedClaudeStatus.authMethod !== 'api_key');
    }
    return false;
  }

  public async refreshClaudeStatus(): Promise<{ linked: boolean; authMethod?: string; email?: string }> {
    if (this.cachedClaudeStatus && Date.now() - this.cachedClaudeStatus.timestamp < 3000) {
      return this.cachedClaudeStatus;
    }

    try {
      const claudeBin = this.getClaudeBin();
      const output = await new Promise<string>((resolve) => {
        const proc = spawn(claudeBin, ['auth', 'status'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        });
        let buf = '';
        proc.stdout?.on('data', (d) => { buf += d.toString(); });
        proc.stderr?.on('data', (d) => { buf += d.toString(); });
        const timer = setTimeout(() => {
          proc.kill('SIGTERM');
          resolve(buf);
        }, 3000);
        proc.on('close', () => {
          clearTimeout(timer);
          resolve(buf);
        });
        proc.on('error', () => {
          clearTimeout(timer);
          resolve(buf);
        });
      });

      const match = output.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        // Claude CLI is only linked if authenticated via Claude Pro/Team subscription (OAuth), not standalone API key
        const isSubscriptionLinked = Boolean(
          parsed.loggedIn && parsed.authMethod && parsed.authMethod !== 'api_key'
        );
        const result = {
          linked: isSubscriptionLinked,
          authMethod: parsed.authMethod,
          email: parsed.email,
          timestamp: Date.now(),
        };
        this.cachedClaudeStatus = result;
        return result;
      }
    } catch (err) {
      logger.debug('Error refreshing Claude CLI status', { error: String(err) });
    }

    const credsPath = path.join(os.homedir(), '.claude', '.credentials.json');
    let linked = false;
    if (fs.existsSync(credsPath)) {
      try {
        const stats = fs.statSync(credsPath);
        if (stats.size > 10) {
          const raw = fs.readFileSync(credsPath, 'utf8');
          const parsed = JSON.parse(raw);
          if (parsed.oauthToken || parsed.claudeAiSessionKey || parsed.accessToken || Object.keys(parsed).length > 0) {
            linked = true;
          }
        }
      } catch {}
    }
    const result = { linked, timestamp: Date.now() };
    this.cachedClaudeStatus = result;
    return result;
  }

  public async startClaudeCliLogin(
    mode: 'claudeai' | 'console' = 'console'
  ): Promise<{ authUrl: string; sessionId: string }> {
    if (
      this.activeClaudeLogin &&
      this.activeClaudeLogin.authUrl &&
      Date.now() - this.activeClaudeLogin.startedAt < 45000
    ) {
      return {
        authUrl: this.activeClaudeLogin.authUrl,
        sessionId: String(this.activeClaudeLogin.startedAt),
      };
    }

    if (this.activeClaudeLogin) {
      clearTimeout(this.activeClaudeLogin.timeoutId);
      try {
        this.activeClaudeLogin.process.kill('SIGTERM');
      } catch {}
      this.activeClaudeLogin = null;
    }

    const claudeBin = this.getClaudeBin();
    const args = ['auth', 'login'];
    if (mode === 'console') {
      args.push('--console');
    }

    return new Promise((resolve, reject) => {
      let resolved = false;
      const proc = spawn(claudeBin, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          proc.kill('SIGTERM');
          reject(new AppError('Claude CLI login timed out waiting for authorization URL', 504, 'TIMEOUT'));
        }
      }, 8000);

      const sessionExpiryTimer = setTimeout(() => {
        if (this.activeClaudeLogin?.process === proc) {
          try {
            proc.kill('SIGTERM');
          } catch {}
          this.activeClaudeLogin = null;
        }
      }, 300000);

      let buf = '';

      proc.stdout?.on('data', (chunk) => {
        buf += chunk.toString();
        const urlMatch = buf.match(/https:\/\/[^\s\x1b\x07]+/);
        if (urlMatch && !resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          const authUrl = urlMatch[0];
          this.activeClaudeLogin = {
            process: proc,
            authUrl,
            startedAt: Date.now(),
            timeoutId: sessionExpiryTimer,
          };
          logger.info('Captured Claude CLI OAuth authorization URL', { authUrl, mode });
          resolve({ authUrl, sessionId: String(Date.now()) });
        }
      });

      proc.stderr?.on('data', (chunk) => {
        buf += chunk.toString();
        const urlMatch = buf.match(/https:\/\/[^\s\x1b\x07]+/);
        if (urlMatch && !resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          const authUrl = urlMatch[0];
          this.activeClaudeLogin = {
            process: proc,
            authUrl,
            startedAt: Date.now(),
            timeoutId: sessionExpiryTimer,
          };
          resolve({ authUrl, sessionId: String(Date.now()) });
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        clearTimeout(sessionExpiryTimer);
        if (this.activeClaudeLogin?.process === proc) {
          this.activeClaudeLogin = null;
        }
        if (code === 0) {
          logger.info('Claude CLI login process completed successfully');
          this.cachedClaudeStatus = { linked: true, timestamp: Date.now() };
        } else if (!resolved) {
          reject(new AppError(`Claude CLI login process exited with code ${code}: ${buf}`, 500, 'CLI_LOGIN_ERROR'));
        }
      });

      proc.on('error', (err: any) => {
        clearTimeout(timeoutId);
        clearTimeout(sessionExpiryTimer);
        if (!resolved) {
          if (err.code === 'ENOENT') {
            logger.info('Claude CLI binary not found on host backend. Returning Claude auth link.');
            resolved = true;
            resolve({
              authUrl: 'https://claude.ai/login',
              sessionId: String(Date.now()),
            });
            return;
          }
          reject(new AppError(`Failed to spawn Claude CLI: ${err.message}`, 500, 'SPAWN_ERROR'));
        }
      });
    });
  }

  public async submitClaudeCliCode(code: string): Promise<boolean> {
    if (!this.activeClaudeLogin || !this.activeClaudeLogin.process.stdin?.writable) {
      return false;
    }
    try {
      this.activeClaudeLogin.process.stdin.write(code.trim() + '\n');
      return true;
    } catch (err) {
      logger.warn('Failed to submit authorization code to Claude CLI', { error: String(err) });
      return false;
    }
  }

  public async unlinkClaude(): Promise<boolean> {
    if (this.activeClaudeLogin) {
      clearTimeout(this.activeClaudeLogin.timeoutId);
      try {
        this.activeClaudeLogin.process.kill('SIGTERM');
      } catch {}
      this.activeClaudeLogin = null;
    }

    try {
      const claudeBin = this.getClaudeBin();
      await new Promise<void>((resolve) => {
        const proc = spawn(claudeBin, ['auth', 'logout'], {
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        proc.on('close', () => resolve());
        proc.on('error', () => resolve());
      });
    } catch {}

    this.cachedClaudeStatus = { linked: false, timestamp: Date.now() };
    return true;
  }

  public async executeClaudeCli(
    prompt: string,
    model?: string,
    onToken?: (token: string) => void,
    sandboxDir?: string
  ): Promise<CliExecutionResult> {
    const startTime = Date.now();
    const claudeBin = this.getClaudeBin();
    const effectiveSandboxDir =
      sandboxDir && fs.existsSync(sandboxDir)
        ? sandboxDir
        : os.tmpdir();

    const args = ['-p', prompt, '--output-format=stream-json'];
    if (model && model !== 'auto' && model !== 'default') {
      args.push('--model', model);
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(claudeBin, args, {
        cwd: effectiveSandboxDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let accumulatedText = '';
      let stderr = '';
      const cliUsage: CliUsageTelemetry = {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      };

      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new AppError('Claude CLI execution timed out after 60s', 504, 'TIMEOUT'));
      }, 60000);

      proc.stdout?.on('data', (chunk) => {
        const raw = chunk.toString();
        const lines = raw.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              accumulatedText += parsed.delta.text;
              if (onToken) onToken(parsed.delta.text);
            } else if (parsed.type === 'message_delta' && parsed.usage) {
              cliUsage.output_tokens = parsed.usage.output_tokens || cliUsage.output_tokens;
              cliUsage.total_tokens = (cliUsage.input_tokens || 0) + (cliUsage.output_tokens || 0);
            } else if (parsed.type === 'message_start' && parsed.message?.usage) {
              cliUsage.input_tokens = parsed.message.usage.input_tokens || cliUsage.input_tokens;
            } else if (parsed.result?.response && !accumulatedText) {
              accumulatedText = parsed.result.response;
            }
          } catch {
            if (!raw.startsWith('{')) {
              accumulatedText += raw;
              if (onToken) onToken(raw);
            }
          }
        }
      });

      proc.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        const durationMs = Date.now() - startTime;
        if (code === 0 || accumulatedText.trim().length > 0) {
          resolve({ text: accumulatedText.trim(), durationMs, usage: cliUsage });
        } else {
          logger.error('Claude CLI exited with error', { code, stderr, accumulatedText });
          reject(new AppError(stderr.trim() || `Claude CLI exited with code ${code}`, 500, 'CLI_EXECUTION_ERROR'));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(new AppError(`Failed to spawn Claude CLI: ${err.message}`, 500, 'SPAWN_ERROR'));
      });
    });
  }

  private formatToolDescription(toolName: string, params: any): string {
    if (toolName === 'run_command') {
      const cmd = params?.CommandLine ? ` \`${params.CommandLine.slice(0, 48)}${params.CommandLine.length > 48 ? '...' : ''}\`` : '';
      return `Running command${cmd}`;
    }
    if (toolName === 'view_file') {
      const file = params?.AbsolutePath ? ` \`${path.basename(params.AbsolutePath)}\`` : '';
      return `Reading file${file}`;
    }
    if (toolName === 'write_to_file') {
      const file = params?.TargetFile ? ` \`${path.basename(params.TargetFile)}\`` : '';
      return `Writing artifact${file}`;
    }
    if (toolName === 'replace_file_content' || toolName === 'multi_replace_file_content') {
      const file = params?.TargetFile ? ` \`${path.basename(params.TargetFile)}\`` : '';
      return `Editing code${file}`;
    }
    if (toolName === 'list_dir') {
      return `Scanning directory \`${params?.DirectoryPath ? path.basename(params.DirectoryPath) : '.'}\``;
    }
    if (toolName === 'grep_search') {
      return `Searching workspace for \`${params?.Query || ''}\``;
    }
    if (toolName === 'generate_image') {
      return `Generating UI visualization with neural renderer`;
    }
    return `Executing agent tool: ${toolName}`;
  }

  /**
   * Executes prompt directly using the installed Antigravity CLI (agy) binary with stream-json.
   * Acquires authentic CLI usage telemetry (input_tokens, output_tokens, thinking_tokens, etc.).
   */
  public async executeAntigravityCli(
    prompt: string,
    model: string = 'gemini-3.1-pro-high',
    onToken?: (token: string) => void,
    sandboxDir?: string,
    onStep?: (step: AgentStep) => void
  ): Promise<CliExecutionResult> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      let selectedCliModel: string | undefined;
      if (model && model !== 'auto' && model !== 'default') {
        selectedCliModel = model;
      }

      const agyBin = this.getAntigravityBin();

      const cliSandboxDir =
        sandboxDir && fs.existsSync(sandboxDir)
          ? sandboxDir
          : os.tmpdir();

      // Antigravity CLI flags:
      // -p <prompt>: run prompt non-interactively
      // --dangerously-skip-permissions: auto-approve agent tool requests in headless execution
      // --output-format stream-json: real-time streaming of tokens and exact usage telemetry
      const args = [
        '-p',
        prompt,
        '--dangerously-skip-permissions',
        '--output-format',
        'stream-json',
      ];
      if (selectedCliModel) {
        args.push('--model', selectedCliModel);
      }

      logger.info('Spawning Antigravity CLI (agy) in isolated sandbox', {
        model: selectedCliModel ?? 'default',
        cwd: cliSandboxDir,
        promptLength: prompt.length,
      });

      const proc = spawn(agyBin, args, {
        cwd: cliSandboxDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DBUS_SESSION_BUS_ADDRESS: '',
          PATH: `${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
          NO_COLOR: '1',
          TERM: 'dumb',
        },
      });

      let lineBuffer = '';
      let accumulatedText = '';
      let stderr = '';
      let cliUsage: CliUsageTelemetry = {
        input_tokens: 0,
        output_tokens: 0,
        thinking_tokens: 0,
        cache_read_tokens: 0,
        total_tokens: 0,
        duration_seconds: 0,
        num_turns: 1,
      };

      const checkAuthPrompt = (text: string): boolean => {
        if (
          text.includes('Authentication required') ||
          text.includes('Please visit the URL to log in') ||
          text.includes('Waiting for authentication') ||
          text.includes('Please sign in to view available models')
        ) {
          clearTimeout(timeoutId);
          try {
            proc.kill('SIGTERM');
          } catch {}
          reject(
            new AppError(
              'Antigravity CLI requires authentication. Please link your Google account in the UI.',
              401,
              'CLI_AUTH_REQUIRED'
            )
          );
          return true;
        }
        return false;
      };

      proc.stdout.on('data', (chunk) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (checkAuthPrompt(trimmed)) return;

          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.event === 'step_update' && parsed.step_update) {
              const su = parsed.step_update;
              const stepIndex = su.step_index ?? 0;

              if (su.step_type === 'tool') {
                const toolName = su.tool_name || su.tool_info?.name || 'tool';
                const desc = this.formatToolDescription(toolName, su.tool_info?.parameters);
                const status = su.state === 'DONE' ? 'completed' : 'in_progress';
                const durationMs = su.duration_seconds ? Math.round(su.duration_seconds * 1000) : 0;
                if (onStep) {
                  onStep({
                    id: `step_agy_tool_${stepIndex}`,
                    description: desc,
                    durationMs,
                    status,
                  });
                }
              } else if (su.step_type === 'agent_response') {
                if (su.text_delta) {
                  accumulatedText += su.text_delta;
                  if (onToken) onToken(su.text_delta);
                }
                if (su.state === 'ACTIVE' && !su.text_delta) {
                  if (onStep) {
                    onStep({
                      id: `step_agy_think_${stepIndex}`,
                      description: 'Analyzing architecture & formulating plan...',
                      durationMs: 0,
                      status: 'in_progress',
                    });
                  }
                } else if (su.state === 'DONE') {
                  const durationMs = su.duration_seconds ? Math.round(su.duration_seconds * 1000) : 0;
                  const thinkingTokens = su.usage?.thinking_tokens;
                  const desc = thinkingTokens
                    ? `Reasoned & formulated action (${thinkingTokens} thinking tokens)`
                    : 'Completed reasoning phase';
                  if (onStep) {
                    onStep({
                      id: `step_agy_think_${stepIndex}`,
                      description: desc,
                      durationMs,
                      status: 'completed',
                    });
                  }
                }
              }

              if (su.usage) {
                cliUsage = {
                  ...cliUsage,
                  ...su.usage,
                  duration_seconds: su.duration_seconds ?? cliUsage.duration_seconds,
                };
              }
            } else if (parsed.event === 'result' && parsed.result) {
              if (parsed.result.status === 'ERROR') {
                const errorMsg = parsed.result.error || 'Antigravity CLI execution error';
                clearTimeout(timeoutId);
                reject(new AppError(errorMsg, 500, 'CLI_EXECUTION_ERROR'));
                return;
              }
              if (parsed.result.response && !accumulatedText) {
                accumulatedText = parsed.result.response;
              }
              if (parsed.result.usage) {
                cliUsage = {
                  ...cliUsage,
                  ...parsed.result.usage,
                  duration_seconds: parsed.result.duration_seconds ?? cliUsage.duration_seconds,
                  num_turns: parsed.result.num_turns ?? cliUsage.num_turns,
                };
              }
            }
          } catch {
            // Non-JSON line from stdout
          }
        }
      });

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        if (checkAuthPrompt(text)) return;
        stderr += text;
      });

      // 180-second execution timeout safety (allows multi-step autonomous tool calls)
      const timeoutId = setTimeout(() => {
        if (accumulatedText.trim().length > 0) {
          proc.kill('SIGTERM');
          resolve({ text: accumulatedText.trim(), durationMs: Date.now() - startTime, usage: cliUsage });
        } else {
          proc.kill('SIGTERM');
          reject(new AppError('Antigravity CLI execution timed out after 180s', 504, 'TIMEOUT'));
        }
      }, 180000);

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        const durationMs = Date.now() - startTime;

        if (code === 0 || accumulatedText.trim().length > 0) {
          const cleanOutput = accumulatedText.trim();
          resolve({ text: cleanOutput, durationMs, usage: cliUsage });
        } else {
          logger.error('Antigravity CLI exited with non-zero code', { code, stderr, accumulatedText });
          reject(
            new AppError(
              stderr.trim() || accumulatedText.trim() || `Antigravity CLI process exited with code ${code}`,
              500,
              'CLI_EXECUTION_ERROR'
            )
          );
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        logger.error('Failed to spawn Antigravity CLI (agy)', err);
        reject(new AppError(`Failed to spawn Antigravity CLI: ${err.message}`, 500, 'SPAWN_ERROR'));
      });
    });
  }

  /**
   * Alias for backward compatibility.
   */
  public async executeGeminiCli(
    prompt: string,
    model: string = 'gemini-3.1-pro-high',
    onToken?: (token: string) => void
  ): Promise<CliExecutionResult> {
    return this.executeAntigravityCli(prompt, model, onToken);
  }

  public getCodexBin(): string {
    const localBin = path.join(os.homedir(), '.local', 'bin', 'codex');
    if (fs.existsSync(localBin)) return localBin;
    return 'codex';
  }

  public isCodexLinked(): boolean {
    const codexDir = path.join(os.homedir(), '.codex');
    const authJsonPath = path.join(codexDir, 'auth.json');
    if (fs.existsSync(authJsonPath)) {
      try {
        const stats = fs.statSync(authJsonPath);
        if (stats.size > 20) return true;
      } catch {}
    }

    if (this.cachedCodexStatus && Date.now() - this.cachedCodexStatus.timestamp < 120000) {
      return this.cachedCodexStatus.linked;
    }

    const hasConfig = fs.existsSync(path.join(codexDir, 'config.toml'));
    const hasCache = fs.existsSync(path.join(codexDir, 'models_cache.json'));
    const hasDb =
      fs.existsSync(path.join(codexDir, 'state_5.sqlite')) ||
      fs.existsSync(path.join(codexDir, 'goals_1.sqlite'));
    return hasConfig || hasCache || hasDb;
  }

  public async refreshCodexStatus(): Promise<{ linked: boolean; email?: string }> {
    const codexDir = path.join(os.homedir(), '.codex');
    const authJsonPath = path.join(codexDir, 'auth.json');
    if (fs.existsSync(authJsonPath)) {
      try {
        const stats = fs.statSync(authJsonPath);
        if (stats.size > 20) {
          const raw = fs.readFileSync(authJsonPath, 'utf8');
          const parsed = JSON.parse(raw);
          const email = parsed.email || (parsed.tokens ? 'ChatGPT Account' : undefined);
          const result = {
            linked: true,
            email: email || 'ChatGPT Account',
            timestamp: Date.now(),
          };
          this.cachedCodexStatus = result;
          return result;
        }
      } catch {}
    }

    if (this.cachedCodexStatus && Date.now() - this.cachedCodexStatus.timestamp < 10000) {
      return this.cachedCodexStatus;
    }

    try {
      const codexBin = this.getCodexBin();
      const output = await new Promise<string>((resolve) => {
        const proc = spawn(codexBin, ['login', 'status'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        });
        let buf = '';
        proc.stdout?.on('data', (d) => { buf += d.toString(); });
        proc.stderr?.on('data', (d) => { buf += d.toString(); });
        const timer = setTimeout(() => {
          proc.kill('SIGTERM');
          resolve(buf);
        }, 3000);
        proc.on('close', () => {
          clearTimeout(timer);
          resolve(buf);
        });
        proc.on('error', () => {
          clearTimeout(timer);
          resolve(buf);
        });
      });

      const lower = output.toLowerCase();
      const linked =
        !lower.includes('not logged in') &&
        (lower.includes('logged in') || output.trim().length > 5);
      const emailMatch = output.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      const result = {
        linked,
        email: emailMatch ? emailMatch[1] : undefined,
        timestamp: Date.now(),
      };
      this.cachedCodexStatus = result;
      return result;
    } catch (err) {
      logger.debug('Error refreshing Codex CLI status', { error: String(err) });
    }

    const hasConfig = fs.existsSync(path.join(codexDir, 'config.toml'));
    const hasCache = fs.existsSync(path.join(codexDir, 'models_cache.json'));
    const hasDb =
      fs.existsSync(path.join(codexDir, 'state_5.sqlite')) ||
      fs.existsSync(path.join(codexDir, 'goals_1.sqlite'));
    const linked = hasConfig || hasCache || hasDb;
    const result = { linked, timestamp: Date.now() };
    this.cachedCodexStatus = result;
    return result;
  }

  public async startCodexCliLogin(): Promise<{ authUrl: string; sessionId: string }> {
    if (
      this.activeCodexLogin &&
      this.activeCodexLogin.authUrl &&
      Date.now() - this.activeCodexLogin.startedAt < 45000
    ) {
      return {
        authUrl: this.activeCodexLogin.authUrl,
        sessionId: String(this.activeCodexLogin.startedAt),
      };
    }

    if (this.activeCodexLogin) {
      clearTimeout(this.activeCodexLogin.timeoutId);
      try {
        this.activeCodexLogin.process.kill('SIGTERM');
      } catch {}
      this.activeCodexLogin = null;
    }

    const codexBin = this.getCodexBin();

    return new Promise((resolve, reject) => {
      let resolved = false;
      const proc = spawn(codexBin, ['login'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          proc.kill('SIGTERM');
          reject(new AppError('Codex CLI login timed out waiting for authorization URL', 504, 'TIMEOUT'));
        }
      }, 8000);

      const sessionExpiryTimer = setTimeout(() => {
        if (this.activeCodexLogin?.process === proc) {
          try {
            proc.kill('SIGTERM');
          } catch {}
          this.activeCodexLogin = null;
        }
      }, 300000);

      let buf = '';

      const handleChunk = (chunk: Buffer) => {
        buf += chunk.toString();
        const urlMatch = buf.match(/https:\/\/auth\.openai\.com\/oauth\/authorize[^\s\x1b\x07]+/);
        if (urlMatch && !resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          const authUrl = urlMatch[0];
          this.activeCodexLogin = {
            process: proc,
            authUrl,
            startedAt: Date.now(),
            timeoutId: sessionExpiryTimer,
          };
          logger.info('Captured Codex CLI OAuth authorization URL', { authUrl });
          resolve({ authUrl, sessionId: String(Date.now()) });
        }
      };

      proc.stdout?.on('data', handleChunk);
      proc.stderr?.on('data', handleChunk);

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        clearTimeout(sessionExpiryTimer);
        if (this.activeCodexLogin?.process === proc) {
          this.activeCodexLogin = null;
        }
        if (code === 0) {
          logger.info('Codex CLI login process completed successfully');
          this.cachedCodexStatus = { linked: true, timestamp: Date.now() };
        } else if (!resolved) {
          reject(new AppError(`Codex CLI login process exited with code ${code}: ${buf}`, 500, 'CLI_LOGIN_ERROR'));
        }
      });

      proc.on('error', (err: any) => {
        clearTimeout(timeoutId);
        clearTimeout(sessionExpiryTimer);
        if (!resolved) {
          if (err.code === 'ENOENT') {
            logger.info('Codex CLI binary not found on host backend. Returning OpenAI auth link.');
            resolved = true;
            resolve({
              authUrl: 'https://auth.openai.com/codex',
              sessionId: String(Date.now()),
            });
            return;
          }
          reject(new AppError(`Failed to spawn Codex CLI: ${err.message}`, 500, 'SPAWN_ERROR'));
        }
      });
    });
  }

  public async unlinkCodex(): Promise<boolean> {
    if (this.activeCodexLogin) {
      clearTimeout(this.activeCodexLogin.timeoutId);
      try {
        this.activeCodexLogin.process.kill('SIGTERM');
      } catch {}
      this.activeCodexLogin = null;
    }

    try {
      const codexBin = this.getCodexBin();
      await new Promise<void>((resolve) => {
        const proc = spawn(codexBin, ['logout'], {
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        proc.on('close', () => resolve());
        proc.on('error', () => resolve());
      });
    } catch {}

    this.cachedCodexStatus = { linked: false, timestamp: Date.now() };
    return true;
  }

  public async executeCodexCli(
    prompt: string,
    model?: string,
    onToken?: (token: string) => void,
    sandboxDir?: string,
    onStep?: (step: AgentStep) => void
  ): Promise<CliExecutionResult> {
    const startTime = Date.now();
    const codexBin = this.getCodexBin();
    const effectiveSandboxDir =
      sandboxDir && fs.existsSync(sandboxDir)
        ? sandboxDir
        : os.tmpdir();

    const args = [
      'exec',
      '--skip-git-repo-check',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '-C',
      effectiveSandboxDir,
    ];
    if (model && model !== 'auto' && model !== 'default') {
      const match = model.match(/^(.*)-(low|medium|high|xhigh|max|ultra)$/);
      if (match) {
        args.push('-m', match[1]);
        args.push('-c', `model_reasoning_effort="${match[2]}"`);
      } else {
        args.push('-m', model);
      }
    }
    args.push(prompt);

    return new Promise((resolve, reject) => {
      const proc = spawn(codexBin, args, {
        cwd: effectiveSandboxDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let accumulatedText = '';
      let stderr = '';
      let lineBuffer = '';
      const cliUsage: CliUsageTelemetry = {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      };

      const parseJsonEvent = (lineStr: string) => {
        const trimmed = lineStr.trim();
        if (!trimmed) return;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === 'item.started') {
            if (event.item?.type === 'reasoning') {
              if (onStep) {
                onStep({
                  id: `step_codex_${event.item.id || 'think'}`,
                  description: 'Deep reasoning in progress...',
                  durationMs: 0,
                  status: 'in_progress',
                });
              }
            } else if (event.item?.type === 'command_execution' || event.item?.type === 'tool_call') {
              const cmd = event.item.command || event.item.name || 'action';
              if (onStep) {
                onStep({
                  id: `step_codex_${event.item.id || 'tool'}`,
                  description: `Executing action: ${cmd}`,
                  durationMs: 0,
                  status: 'in_progress',
                });
              }
            }
          } else if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item?.text) {
            const textChunk = event.item.text;
            accumulatedText += textChunk;
            if (onToken) onToken(textChunk);
          } else if (event.type === 'item.completed') {
            if (event.item?.type === 'reasoning') {
              if (onStep) {
                onStep({
                  id: `step_codex_${event.item.id || 'think'}`,
                  description: 'Formulated reasoning strategy',
                  durationMs: 120,
                  status: 'completed',
                });
              }
            } else if (event.item?.type === 'command_execution' || event.item?.type === 'tool_call') {
              const cmd = event.item.command || event.item.name || 'action';
              if (onStep) {
                onStep({
                  id: `step_codex_${event.item.id || 'tool'}`,
                  description: `Executed: ${cmd}`,
                  durationMs: 150,
                  status: 'completed',
                });
              }
            }
          } else if (event.type === 'turn.completed' && event.usage) {
            const u = event.usage;
            cliUsage.input_tokens = Number(u.input_tokens) || 0;
            cliUsage.output_tokens = Number(u.output_tokens) || 0;
            cliUsage.cache_read_tokens = Number(u.cached_input_tokens) || 0;
            cliUsage.thinking_tokens = Number(u.reasoning_output_tokens) || 0;
            cliUsage.total_tokens = cliUsage.input_tokens + cliUsage.output_tokens;
          }
        } catch {
          // If non-JSON text appears
          if (!trimmed.startsWith('{')) {
            accumulatedText += trimmed + '\n';
            if (onToken) onToken(trimmed + '\n');
          }
        }
      };

      // 180-second execution timeout safety (allows multi-step reasoning)
      const timeoutId = setTimeout(() => {
        if (accumulatedText.trim().length > 0) {
          proc.kill('SIGTERM');
          resolve({ text: accumulatedText.trim(), durationMs: Date.now() - startTime, usage: cliUsage });
        } else {
          proc.kill('SIGTERM');
          reject(new AppError('Codex CLI execution timed out after 180s', 504, 'TIMEOUT'));
        }
      }, 180000);

      proc.stdout?.on('data', (chunk) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          parseJsonEvent(line);
        }
      });

      proc.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        if (lineBuffer.trim()) {
          parseJsonEvent(lineBuffer);
        }
        const durationMs = Date.now() - startTime;
        if (code === 0 || accumulatedText.trim().length > 0) {
          resolve({ text: accumulatedText.trim(), durationMs, usage: cliUsage });
        } else {
          logger.error('Codex CLI exited with error', { code, stderr, accumulatedText });
          reject(new AppError(stderr.trim() || `Codex CLI exited with code ${code}`, 500, 'CLI_EXECUTION_ERROR'));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(new AppError(`Failed to spawn Codex CLI: ${err.message}`, 500, 'SPAWN_ERROR'));
      });
    });
  }
}

export const cliAuthService = new CliAuthService();
