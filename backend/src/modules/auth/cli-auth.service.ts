import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { logger } from '../../utils/logger.util.js';
import { AppError } from '../../utils/error.util.js';
import { firestoreBackendService } from '../../services/firestore.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


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

  private activeCodexLogins = new Map<
    string,
    {
      process: ChildProcess;
      authUrl?: string;
      userCode?: string;
      userId?: string;
      userEmail?: string;
      userCodexHome: string;
      startedAt: number;
      timeoutId: NodeJS.Timeout;
    }
  >();

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

  private getUserCliLinksPath(): string {
    return path.join(this.getGeminiDir(), 'user_cli_links.json');
  }

  public loadUserCliLinks(): Record<string, any> {
    const p = this.getUserCliLinksPath();
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {}
    }
    return {};
  }

  public saveUserCliLinks(links: Record<string, any>): void {
    const p = this.getUserCliLinksPath();
    try {
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(p, JSON.stringify(links, null, 2), 'utf8');
    } catch (err) {
      logger.warn('Failed to save user CLI links', { error: String(err) });
    }
  }

  public isUserCliLinked(userId: string, cli: 'antigravity' | 'gemini' | 'claude' | 'codex'): boolean {
    const rec = this.getUserCliRecord(userId);
    return Boolean(rec?.[cli]?.linked);
  }

  public getUserIdByEmail(email: string): string | null {
    if (!email) return null;
    const links = this.loadUserCliLinks();
    const clean = email.toLowerCase().trim();
    for (const [userId, rec] of Object.entries(links)) {
      if (
        rec.email?.toLowerCase().trim() === clean ||
        rec.antigravity?.email?.toLowerCase().trim() === clean ||
        rec.gemini?.email?.toLowerCase().trim() === clean ||
        rec.claude?.email?.toLowerCase().trim() === clean ||
        rec.codex?.email?.toLowerCase().trim() === clean
      ) {
        return userId;
      }
    }
    return null;
  }

  public isUserCliLinkedByEmail(email: string, cli: 'antigravity' | 'gemini' | 'claude' | 'codex'): boolean {
    if (!email) return false;
    const userId = this.getUserIdByEmail(email);
    if (userId && this.isUserCliLinked(userId, cli)) return true;
    const rec = this.getUserCliRecord(email);
    return Boolean(rec?.[cli]?.linked);
  }

  public getUserCliRecord(userId: string): any {
    if (!userId) return null;
    const links = this.loadUserCliLinks();
    const clean = userId.toLowerCase().trim();

    let directRec = links[userId];
    let userEmail: string | undefined = directRec?.email;

    if (!userEmail) {
      for (const rec of Object.values(links)) {
        if (
          rec.email?.toLowerCase().trim() === clean ||
          rec.antigravity?.email?.toLowerCase().trim() === clean ||
          rec.gemini?.email?.toLowerCase().trim() === clean ||
          rec.claude?.email?.toLowerCase().trim() === clean ||
          rec.codex?.email?.toLowerCase().trim() === clean
        ) {
          userEmail = rec.email || rec.antigravity?.email || rec.codex?.email;
          if (!directRec) directRec = rec;
          break;
        }
      }
    }

    if (userEmail) {
      const cleanEmail = userEmail.toLowerCase().trim();
      const merged: any = { ...directRec, email: userEmail };

      for (const c of ['antigravity', 'gemini', 'claude', 'codex'] as const) {
        let latestTime = 0;
        let latestState: any = directRec?.[c] || null;
        if (latestState) {
          latestTime = latestState.unlinkedAt
            ? new Date(latestState.unlinkedAt).getTime()
            : latestState.linkedAt
            ? new Date(latestState.linkedAt).getTime()
            : 1;
        }

        for (const entry of Object.values(links)) {
          if (
            entry.email?.toLowerCase().trim() === cleanEmail ||
            entry.antigravity?.email?.toLowerCase().trim() === cleanEmail ||
            entry.gemini?.email?.toLowerCase().trim() === cleanEmail ||
            entry.codex?.email?.toLowerCase().trim() === cleanEmail ||
            entry.claude?.email?.toLowerCase().trim() === cleanEmail
          ) {
            const entryState = entry[c];
            if (!entryState) continue;

            const entryTime = entryState.unlinkedAt
              ? new Date(entryState.unlinkedAt).getTime()
              : entryState.linkedAt
              ? new Date(entryState.linkedAt).getTime()
              : 0;

            if (!latestState || entryTime >= latestTime) {
              latestTime = entryTime;
              latestState = entryState;
            }
          }
        }

        // If direct record has an explicit false, respect it unless a newer link occurred
        if (directRec?.[c]?.linked === false) {
          const directUnlinkTime = directRec[c]?.unlinkedAt
            ? new Date(directRec[c].unlinkedAt).getTime()
            : 0;
          if (latestState?.linked && latestState?.linkedAt) {
            const linkTime = new Date(latestState.linkedAt).getTime();
            if (directUnlinkTime >= linkTime) {
              latestState = directRec[c];
            }
          } else {
            latestState = directRec[c];
          }
        }

        if (latestState) {
          merged[c] = latestState;
        }
      }

      return merged;
    }

    return directRec || null;
  }

  public async syncUserFromFirestore(userId?: string, userEmail?: string): Promise<void> {
    try {
      const remote = await firestoreBackendService.getUserCliLinks(userId, userEmail);
      if (remote && typeof remote === 'object') {
        const links = this.loadUserCliLinks();
        const cleanEmail = (userEmail || remote.email || '').toLowerCase().trim();
        const effectiveId = userId || (cleanEmail ? this.getUserIdByEmail(cleanEmail) : '') || userId || 'synced_user';

        if (!links[effectiveId]) links[effectiveId] = {};

        for (const c of ['antigravity', 'gemini', 'claude', 'codex'] as const) {
          if (remote[c] && typeof remote[c] === 'object') {
            const localState = links[effectiveId][c];
            const localTime = localState?.unlinkedAt
              ? new Date(localState.unlinkedAt).getTime()
              : localState?.linkedAt
              ? new Date(localState.linkedAt).getTime()
              : 0;
            const remoteTime = remote[c]?.unlinkedAt
              ? new Date(remote[c].unlinkedAt).getTime()
              : remote[c]?.linkedAt
              ? new Date(remote[c].linkedAt).getTime()
              : 0;

            if (!localState || remoteTime >= localTime) {
              links[effectiveId][c] = remote[c];
            }
          }
        }
        if (cleanEmail && !links[effectiveId].email) {
          links[effectiveId].email = cleanEmail;
        }
        this.saveUserCliLinks(links);
      }
    } catch (e) {
      logger.debug('Failed to sync user CLI links from Firestore', { error: String(e) });
    }
  }

  public async syncLocalLinksToFirestore(): Promise<void> {
    try {
      const links = this.loadUserCliLinks();

      // Check host credentials on local dev machine and associate them with the user record
      const hostAgy = this.getWorkspaceAntigravityUserInfo();
      const hostCodex = this.getCodexAuthInfo();

      if (hostAgy?.email || hostCodex?.email) {
        const hostEmail = (hostAgy?.email || hostCodex?.email || '').toLowerCase().trim();
        if (hostEmail) {
          const targetUser = Object.keys(links).find((k) => {
            const entry = links[k];
            return (
              entry?.email?.toLowerCase().trim() === hostEmail ||
              entry?.antigravity?.email?.toLowerCase().trim() === hostEmail ||
              entry?.gemini?.email?.toLowerCase().trim() === hostEmail ||
              entry?.codex?.email?.toLowerCase().trim() === hostEmail
            );
          }) || hostEmail;

          if (!links[targetUser]) links[targetUser] = { email: hostEmail };

          if (hostAgy?.email && links[targetUser]?.antigravity?.linked !== false) {
            links[targetUser].antigravity = {
              linked: true,
              email: hostAgy.email,
              name: hostAgy.name,
              linkedAt: links[targetUser].antigravity?.linkedAt || new Date().toISOString(),
            };
            links[targetUser].gemini = {
              linked: true,
              email: hostAgy.email,
              name: hostAgy.name,
              linkedAt: links[targetUser].gemini?.linkedAt || new Date().toISOString(),
            };
          }

          if (hostCodex.linked && links[targetUser]?.codex?.linked !== false) {
            links[targetUser].codex = {
              linked: true,
              email: hostCodex.email || hostEmail || 'ChatGPT Account',
              linkedAt: links[targetUser].codex?.linkedAt || new Date().toISOString(),
            };
            try {
              const { codexQuotaService } = await import('../quota/codex-quota.service.js');
              await codexQuotaService.syncLocalTelemetryToFirestore(targetUser, hostEmail).catch(() => {});
            } catch {}
          }

          this.saveUserCliLinks(links);
        }
      }

      for (const [userId, rec] of Object.entries(links)) {
        if (rec && typeof rec === 'object' && Object.keys(rec).length > 0) {
          const email = rec.email || rec.antigravity?.email || rec.gemini?.email || rec.codex?.email;
          await firestoreBackendService.saveUserCliLinks(userId, rec, email).catch(() => {});
        }
      }
    } catch (err) {
      logger.debug('Failed to sync local links to Firestore', { error: String(err) });
    }
  }

  public linkUserCli(
    userId: string,
    cli: 'antigravity' | 'gemini' | 'claude' | 'codex',
    email?: string,
    metadata?: Record<string, any>
  ): void {
    const links = this.loadUserCliLinks();
    if (!links[userId]) {
      links[userId] = { email };
    }
    links[userId][cli] = {
      linked: true,
      email: email || links[userId].email,
      linkedAt: new Date().toISOString(),
      ...metadata,
    };
    this.saveUserCliLinks(links);
    firestoreBackendService.saveUserCliLinks(userId, links[userId], email).catch(() => {});
    logger.info(`Linked ${cli} CLI for user ${userId}`, { email });

    // Also persist per-user Antigravity profile if linking antigravity or gemini
    if (cli === 'antigravity' || cli === 'gemini') {
      this.persistUserAntigravityProfile(userId, email || links[userId].email);
    }
  }

  public unlinkUserCli(userId: string, cli: 'antigravity' | 'gemini' | 'claude' | 'codex', userEmail?: string): void {
    const links = this.loadUserCliLinks();
    let targetEmail = userEmail || links[userId]?.email || links[userId]?.antigravity?.email || links[userId]?.gemini?.email;

    if (!targetEmail && (cli === 'antigravity' || cli === 'gemini')) {
      const hostInfo = this.getWorkspaceAntigravityUserInfo();
      if (hostInfo?.email) targetEmail = hostInfo.email;
    }

    const cleanEmail = targetEmail ? targetEmail.toLowerCase().trim() : '';

    if (userId) {
      if (!links[userId]) {
        links[userId] = {};
      }
      if (!links[userId][cli]) {
        links[userId][cli] = {};
      }
      links[userId][cli].linked = false;
      links[userId][cli].unlinkedAt = new Date().toISOString();
      if (cleanEmail && !links[userId].email) {
        links[userId].email = cleanEmail;
      }
    }

    // Also mark unlinked in any legacy or alias entries matching this email
    if (cleanEmail) {
      for (const entry of Object.values(links)) {
        if (
          entry.email?.toLowerCase().trim() === cleanEmail ||
          entry.antigravity?.email?.toLowerCase().trim() === cleanEmail ||
          entry.gemini?.email?.toLowerCase().trim() === cleanEmail ||
          entry.codex?.email?.toLowerCase().trim() === cleanEmail ||
          entry.claude?.email?.toLowerCase().trim() === cleanEmail
        ) {
          if (!entry[cli]) entry[cli] = {};
          entry[cli].linked = false;
          entry[cli].unlinkedAt = new Date().toISOString();
        }
      }
    }

    this.saveUserCliLinks(links);
    if (userId && links[userId]) {
      firestoreBackendService.saveUserCliLinks(userId, links[userId], targetEmail || cleanEmail).catch(() => {});
    }
    if (userId && (cli === 'antigravity' || cli === 'gemini')) {
      const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const userGeminiDir = path.join(os.homedir(), '.agent-user-profiles', safeUserId, '.gemini');
      if (fs.existsSync(userGeminiDir)) {
        try {
          fs.rmSync(userGeminiDir, { recursive: true, force: true });
        } catch {}
      }
    }
    logger.info(`Unlinked ${cli} CLI for user ${userId}`, { targetEmail });
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

  public getPtySpawnCommand(command: string, args: string[]): { cmd: string; args: string[] } {
    const isLinux = process.platform === 'linux';
    const hasScript = isLinux && (fs.existsSync('/usr/bin/script') || fs.existsSync('/bin/script'));

    if (hasScript) {
      // Use standard Linux 'script' utility to allocate a real kernel pseudo-terminal (PTY)
      // This satisfies agy's isatty() requirement without requiring Python or native C++ addons.
      const fullCmd = [command, ...args].map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ');
      return {
        cmd: 'script',
        args: ['-q', '-f', '-c', fullCmd, '/dev/null'],
      };
    }

    return { cmd: command, args };
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

  public extractEmailFromToken(tokenContent: string): string | null {
    try {
      const parsed = JSON.parse(tokenContent);
      if (parsed.id_token) {
        const parts = parsed.id_token.split('.');
        if (parts.length >= 2) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
          if (payload?.email) return payload.email.toLowerCase().trim();
        }
      }
      if (parsed.email) return parsed.email.toLowerCase().trim();
    } catch {}
    return null;
  }

  public getLatestHostAntigravityToken(): string | null {
    const homedir = os.homedir();
    const candidatePaths = [
      path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-oauth-token'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
    ];
    let newestText: string | null = null;
    let newestMtime = 0;
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          const st = fs.statSync(p);
          if (st.size > 20 && st.mtimeMs > newestMtime) {
            const text = fs.readFileSync(p, 'utf8');
            if (text.includes('token') || text.includes('Bearer') || text.includes('access') || text.includes('refresh')) {
              newestMtime = st.mtimeMs;
              newestText = text;
            }
          }
        } catch {}
      }
    }
    return newestText;
  }

  public persistUserAntigravityProfile(userId: string, userEmail?: string): void {
    if (!userId || userId === 'default' || userId === 'default_user') return;
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const userGeminiDir = path.join(os.homedir(), '.agent-user-profiles', safeUserId, '.gemini');
    const userAgyDir = path.join(userGeminiDir, 'antigravity-cli');
    const userCacheDir = path.join(userAgyDir, 'cache');
    try {
      fs.mkdirSync(userCacheDir, { recursive: true, mode: 0o700 });
      const hostToken = this.getLatestHostAntigravityToken();
      if (hostToken) {
        fs.writeFileSync(path.join(userCacheDir, 'antigravity-keyring-unavailable-oauth-token'), hostToken, { mode: 0o600 });
        fs.writeFileSync(path.join(userCacheDir, 'antigravity-oauth-token'), hostToken, { mode: 0o600 });
        fs.writeFileSync(path.join(userCacheDir, 'jetski-keyring-unavailable-oauth-token'), hostToken, { mode: 0o600 });
        fs.writeFileSync(path.join(userAgyDir, 'antigravity-oauth-token'), hostToken, { mode: 0o600 });
        fs.writeFileSync(path.join(userAgyDir, 'jetski-oauth-token'), hostToken, { mode: 0o600 });
      }
      const emailToSave = userEmail || (hostToken ? this.extractEmailFromToken(hostToken) : undefined);
      if (emailToSave) {
        const accJson = JSON.stringify({ active: emailToSave, accounts: [{ email: emailToSave }] }, null, 2);
        fs.writeFileSync(path.join(userGeminiDir, 'google_accounts.json'), accJson, { mode: 0o600 });
        fs.writeFileSync(path.join(userAgyDir, 'google_accounts.json'), accJson, { mode: 0o600 });
        fs.writeFileSync(path.join(userGeminiDir, 'user_info.json'), JSON.stringify({ email: emailToSave }, null, 2), { mode: 0o600 });
      }
      logger.info(`Persisted Antigravity credentials to user profile: ${safeUserId}`, { email: emailToSave });
    } catch (err) {
      logger.warn('Failed to persist Antigravity credentials to user profile', { error: String(err) });
    }
  }

  public getHostTokenFiles(): string[] {
    const homedir = os.homedir();
    return [
      path.join(homedir, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'jetski-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'jetski-keyring-unavailable-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-oauth-token'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
    ];
  }

  public stashHostAntigravityTokens(): void {
    const files = this.getHostTokenFiles();
    const stashDir = path.join(this.getGeminiDir(), 'stashed_tokens');
    try {
      if (!fs.existsSync(stashDir)) fs.mkdirSync(stashDir, { recursive: true, mode: 0o700 });
      for (const f of files) {
        if (fs.existsSync(f)) {
          const dest = path.join(stashDir, `${path.basename(f)}_${Buffer.from(f).toString('hex').slice(-8)}`);
          try {
            fs.copyFileSync(f, dest);
            fs.unlinkSync(f);
          } catch {}
        }
      }
    } catch {}
  }

  public ensureBrowserStubs(): string {
    const stubScript = '#!/bin/sh\nexit 0\n';
    const tools = ['xdg-open', 'gio', 'sensible-browser', 'x-www-browser', 'firefox', 'google-chrome', 'chromium', 'chromium-browser'];

    // 1. Host shadow bin in system temp directory (clean, zero repo pollution)
    const shadowBinDir = path.join(os.tmpdir(), 'atelier-browser-stubs');
    try {
      if (!fs.existsSync(shadowBinDir)) {
        fs.mkdirSync(shadowBinDir, { recursive: true, mode: 0o755 });
      }
      for (const tool of tools) {
        const p = path.join(shadowBinDir, tool);
        if (!fs.existsSync(p)) {
          fs.writeFileSync(p, stubScript, { mode: 0o755 });
        }
      }
    } catch (e) {
      logger.warn('Failed to setup host shadow bin stubs', { error: String(e) });
    }

    // 2. Snap user common local bin (strictly confined snap agy executes commands from $SNAP_USER_COMMON/local/bin first)
    try {
      const snapBinDir = path.join(os.homedir(), 'snap', 'antigravity-cli', 'common', 'local', 'bin');
      if (!fs.existsSync(snapBinDir)) {
        fs.mkdirSync(snapBinDir, { recursive: true, mode: 0o755 });
      }
      for (const tool of tools) {
        const p = path.join(snapBinDir, tool);
        if (!fs.existsSync(p)) {
          fs.writeFileSync(p, stubScript, { mode: 0o755 });
        }
      }
    } catch (e) {
      logger.warn('Failed to setup snap shadow bin stubs', { error: String(e) });
    }

    return shadowBinDir;
  }

  /**
   * Generates a completely headless environment for CLI child processes.
   * Suppresses all display servers and browser commands to strictly prevent desktop tab popping (xdg-open).
   */
  public getHeadlessCliEnv(extraEnv: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const shadowBinDir = this.ensureBrowserStubs();
    const existingPath = process.env.PATH || '';
    const newPath = `${shadowBinDir}:${existingPath}`;

    return {
      ...process.env,
      PATH: newPath,
      DISPLAY: '',
      WAYLAND_DISPLAY: '',
      BROWSER: '/bin/true',
      XDG_CURRENT_DESKTOP: '',
      DESKTOP_SESSION: '',
      GDMSESSION: '',
      ...extraEnv,
    };
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

    this.stashHostAntigravityTokens();

    const agyBin = this.getAntigravityBin();
    const ptySpawn = this.getPtySpawnCommand(agyBin, ['-p', 'init']);

    return new Promise((resolve, reject) => {
      let resolved = false;

      logger.info('[Antigravity Auth] Spawning agy process in headless mode via native PTY', {
        spawnCmd: ptySpawn.cmd,
        spawnArgs: ptySpawn.args,
      });

      const proc = spawn(ptySpawn.cmd, ptySpawn.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.getHeadlessCliEnv(),
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
  public async submitAntigravityCliCode(code: string, userId?: string, userEmail?: string): Promise<{ success: boolean; error?: string; reason?: string }> {
    let cleanCode = code.trim();
    logger.info('[Antigravity Auth] Code submission received', {
      rawLength: code.length,
      hasCodeParam: cleanCode.includes('code='),
      hasStateParam: cleanCode.includes('state='),
      userId,
      userEmail,
    });

    // 1. If user pasted the redirect URL or query string, extract the code parameter
    if (cleanCode.includes('code=')) {
      try {
        const parsed = new URL(cleanCode);
        const extracted = parsed.searchParams.get('code');
        if (extracted) {
          cleanCode = extracted;
          logger.info('[Antigravity Auth] Extracted "code" parameter from full URL');
        }
      } catch {
        const m = cleanCode.match(/[?&]code=([^&]+)/);
        if (m) {
          cleanCode = decodeURIComponent(m[1]);
          logger.info('[Antigravity Auth] Extracted "code" parameter via regex');
        }
      }
    }

    // 2. Validate code format: Google OAuth authorization codes start with "4/"
    // If the user pasted the state parameter (e.g. u67EQ5wy6al-N9wuoTVR-sljLhRvC8w), detect it immediately!
    if (!cleanCode.startsWith('4/')) {
      logger.warn('[Antigravity Auth] Validation failed: Code does not begin with "4/". User likely copied state token from browser URL bar.', {
        inputPreview: cleanCode.slice(0, 4),
        length: cleanCode.length,
      });
      return {
        success: false,
        reason: 'INVALID_FORMAT_STATE_TOKEN',
        error: 'Invalid authorization code: Google authorization codes always begin with "4/". You appear to have copied the "state" token from the browser address bar. Please switch to the opened Google authorization tab and click the "Copy to Clipboard" button (or copy the code shown in the box on the page), then paste it here.',
      };
    }

    // 3. Ensure active CLI login process is alive
    if (!this.activeAntigravityLogin || !this.activeAntigravityLogin.process.stdin?.writable) {
      logger.warn('[Antigravity Auth] No active Antigravity CLI process waiting on stdin. Login session may have exceeded the 60s timeout.');
      this.syncAntigravityCredentials();
      const alreadyLinked = this.isAntigravityLinked();
      if (alreadyLinked) {
        logger.info('[Antigravity Auth] Existing valid credentials found on disk');
        return { success: true };
      }
      return {
        success: false,
        reason: 'SESSION_EXPIRED',
        error: 'The Antigravity CLI login session timed out (exceeded 60s). Please click "Link Antigravity CLI" again to open a fresh authorization tab and submit the code within 60 seconds.',
      };
    }

    const proc = this.activeAntigravityLogin.process;
    logger.info('[Antigravity Auth] Writing authorization code to agy process stdin', { pid: proc.pid });

    return new Promise((resolve) => {
      let finished = false;
      const finish = (ok: boolean, errReason?: string, errMsg?: string) => {
        if (!finished) {
          finished = true;
          this.syncAntigravityCredentials();
          const linked = this.isAntigravityLinked();
          logger.info('[Antigravity Auth] Code submission resolution', {
            linked,
            ok,
            errReason,
          });
          if (linked || ok) {
            if (userId && userId !== 'default' && userId !== 'default_user') {
              this.persistUserAntigravityProfile(userId, userEmail);
            }
            resolve({ success: true });
          } else {
            resolve({
              success: false,
              reason: errReason || 'EXCHANGE_FAILED',
              error: errMsg || 'Antigravity CLI could not verify the authorization code. Please click "Link Antigravity CLI" to get a fresh URL and try again.',
            });
          }
        }
      };

      const checkInterval = setInterval(() => {
        this.syncAntigravityCredentials();
        if (this.isAntigravityLinked()) {
          clearInterval(checkInterval);
          clearTimeout(timer);
          logger.info('[Antigravity Auth] Successful credential creation detected on disk via polling');
          finish(true);
        }
      }, 500);

      let lastErrorMessage = '';
      proc.stdout?.on('data', (d) => {
        const outStr = d.toString();
        logger.info('[Antigravity Auth] agy stdout: ' + outStr.trim());
        if (outStr.includes('invalid_grant') || outStr.includes('failed') || outStr.includes('Error:')) {
          lastErrorMessage = outStr.trim();
        }
      });

      proc.stderr?.on('data', (d) => {
        const errStr = d.toString();
        logger.warn('[Antigravity Auth] agy stderr: ' + errStr.trim());
        if (errStr.includes('invalid_grant') || errStr.includes('failed') || errStr.includes('Error:')) {
          lastErrorMessage = errStr.trim();
        }
      });

      proc.once('close', (exitCode) => {
        clearInterval(checkInterval);
        clearTimeout(timer);
        logger.info('[Antigravity Auth] agy process closed', { exitCode, lastErrorMessage });
        this.syncAntigravityCredentials();
        const linked = this.isAntigravityLinked();
        if (linked || exitCode === 0) {
          finish(true);
        } else {
          finish(false, 'CLI_EXIT_NON_ZERO', lastErrorMessage || `Antigravity CLI closed with exit code ${exitCode}. Please try linking again with a fresh URL.`);
        }
      });

      const timer = setTimeout(() => {
        clearInterval(checkInterval);
        this.syncAntigravityCredentials();
        const linked = this.isAntigravityLinked();
        logger.warn('[Antigravity Auth] Timed out waiting 30s for agy process after code submission', { linked });
        finish(linked, 'SUBMIT_TIMEOUT', 'Timed out waiting for Antigravity CLI to complete authorization.');
      }, 30000);

      try {
        proc.stdin!.write(cleanCode + '\n');
        logger.info('[Antigravity Auth] Code successfully written to stdin with newline');
      } catch (err) {
        clearInterval(checkInterval);
        clearTimeout(timer);
        logger.error('[Antigravity Auth] Failed to write code to agy stdin', err);
        this.syncAntigravityCredentials();
        finish(this.isAntigravityLinked(), 'STDIN_WRITE_ERROR', 'Failed to communicate with Antigravity CLI process.');
      }
    });
  }

  /**
   * Check whether Antigravity CLI is currently linked with genuine valid agy tokens.
   */
  public hasHostAntigravityTokens(): boolean {
    const homedir = os.homedir();
    const agyTokenPaths = [
      path.join(homedir, '.gemini', 'antigravity-cli', 'oauth_creds.json'),
      path.join(homedir, '.gemini', 'oauth_creds.json'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'oauth_creds.json'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'jetski-keyring-unavailable-oauth-token'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'jetski-oauth-token'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
    ];

    for (const p of agyTokenPaths) {
      if (fs.existsSync(p)) {
        try {
          const stats = fs.statSync(p);
          if (stats.size > 20) {
            if (p.endsWith('.json')) {
              const raw = fs.readFileSync(p, 'utf8');
              const parsed = JSON.parse(raw);
              if (parsed && (parsed.access_token || parsed.refresh_token || parsed.token)) {
                return true;
              }
            } else {
              return true;
            }
          }
        } catch {}
      }
    }
    return false;
  }

  public isAntigravityLinked(userId?: string): boolean {
    if (userId) {
      return this.isUserCliLinked(userId, 'antigravity');
    }
    return this.hasHostAntigravityTokens();
  }

  public isGeminiLinked(userId?: string): boolean {
    if (userId) {
      return this.isUserCliLinked(userId, 'gemini');
    }
    const homedir = os.homedir();
    const credsPaths = [
      path.join(homedir, '.gemini', 'oauth_creds.json'),
      path.join(homedir, '.gemini', 'antigravity-cli', 'oauth_creds.json'),
    ];
    for (const p of credsPaths) {
      if (fs.existsSync(p)) {
        try {
          const stats = fs.statSync(p);
          if (stats.size > 20) return true;
        } catch {}
      }
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
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'oauth_creds.json'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'oauth_creds.json.bak'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'oauth_creds.json'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'user_info.json'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'google_accounts.json'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'google_accounts.json'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
      path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
    ];

    for (const p of toRemove) {
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch {}
      }
    }
  }

  public unlinkAntigravity(): void {
    this.unlinkGemini();
  }

  /**
   * Retrieves workspace Antigravity account info if authenticated on the system host.
   */
  public getWorkspaceAntigravityUserInfo(): { email: string; name?: string } | null {
    try {
      const p = this.getGeminiUserInfoPath();
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const data = JSON.parse(raw);
        if (data.email) return { email: data.email, name: data.name };
      }
    } catch {}
    return null;
  }

  /**
   * Gets current status of all CLI linkings scoped to a specific user.
   */
  public async getCliStatus(userId?: string, userEmail?: string): Promise<CliStatusResult> {
    if (userId || userEmail) {
      await this.syncUserFromFirestore(userId, userEmail);
    }
    const effectiveUserId = userId || (userEmail ? this.getUserIdByEmail(userEmail) : undefined);
    const userRecord = effectiveUserId
      ? this.getUserCliRecord(effectiveUserId)
      : userEmail
      ? this.getUserCliRecord(userEmail)
      : null;

    const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

    // Multi-tenant check: if no user is signed in, no CLI is linked to anonymous visitors
    if (!effectiveUserId && !userEmail) {
      return {
        antigravity: {
          linked: false,
          hasApiKey: false,
          details: 'Connect your Google account to run Antigravity CLI models without API keys',
        },
        gemini: {
          linked: false,
          hasApiKey: hasGeminiKey,
          details: hasGeminiKey
            ? 'Gemini API Key Active · Ready for cloud execution'
            : 'Connect your Google account to run Gemini models',
        },
        claude: {
          linked: false,
        },
        codex: {
          linked: false,
        },
      };
    }

    // Scoped to the specific authenticated user account
    const antigravityLinked = effectiveUserId
      ? this.isUserCliLinked(effectiveUserId, 'antigravity')
      : userEmail
      ? this.isUserCliLinkedByEmail(userEmail, 'antigravity')
      : false;
    const geminiLinked = effectiveUserId
      ? this.isUserCliLinked(effectiveUserId, 'gemini')
      : userEmail
      ? this.isUserCliLinkedByEmail(userEmail, 'gemini')
      : false;
    const claudeLinked = effectiveUserId
      ? this.isUserCliLinked(effectiveUserId, 'claude')
      : userEmail
      ? this.isUserCliLinkedByEmail(userEmail, 'claude')
      : false;
    const userExplicitlyUnlinked = userRecord?.codex?.linked === false;
    const codexAuthInfo = this.getCodexAuthInfo();
    let codexLinked = effectiveUserId
      ? this.isUserCliLinked(effectiveUserId, 'codex')
      : userEmail
      ? this.isUserCliLinkedByEmail(userEmail, 'codex')
      : false;

    let codexEmail: string | undefined = userRecord?.codex?.email;

    const unlinkedAt = userRecord?.codex?.unlinkedAt
      ? new Date(userRecord.codex.unlinkedAt).getTime()
      : 0;
    const isNewLoginAfterUnlink = Boolean(codexAuthInfo.mtime && codexAuthInfo.mtime > unlinkedAt);

    if (codexAuthInfo.linked && (!userExplicitlyUnlinked || isNewLoginAfterUnlink)) {
      const diskEmail = codexAuthInfo.email?.toLowerCase().trim();
      const currentEmail = userEmail?.toLowerCase().trim();
      // Only inherit host machine Codex credentials if disk explicitly belongs to this user with a matching verified email
      const isGenuineUserMatch = Boolean(
        diskEmail &&
        diskEmail.includes('@') &&
        currentEmail &&
        diskEmail === currentEmail
      );
      if (isGenuineUserMatch) {
        codexLinked = true;
        codexEmail = codexAuthInfo.email || codexEmail;
        if (effectiveUserId && !this.isUserCliLinked(effectiveUserId, 'codex')) {
          this.linkUserCli(effectiveUserId, 'codex', codexEmail);
        }
      }
    }

    const email = userEmail || userRecord?.antigravity?.email || userRecord?.gemini?.email || userRecord?.email;
    const name = userRecord?.name;
    const linkedAt = userRecord?.antigravity?.linkedAt;

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
        authMethod: userRecord?.claude?.authMethod || (claudeLinked ? 'Console' : undefined),
        email: claudeLinked ? userRecord?.claude?.email : undefined,
      },
      codex: {
        linked: codexLinked,
        email: codexLinked ? (codexEmail || userRecord?.codex?.email || 'ChatGPT Account') : undefined,
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
          env: this.getHeadlessCliEnv(),
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
        env: this.getHeadlessCliEnv(),
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
          env: this.getHeadlessCliEnv(),
        });
        proc.on('close', () => resolve());
        proc.on('error', () => resolve());
      });
    } catch {}

    this.cachedClaudeStatus = { linked: false, timestamp: Date.now() };
    return true;
  }

  public getCodexBin(): string {
    const candidatePaths = [
      path.join(process.cwd(), 'node_modules', '.bin', 'codex'),
      path.join(process.cwd(), 'backend', 'node_modules', '.bin', 'codex'),
      path.join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'codex'),
      path.join(os.homedir(), '.local', 'bin', 'codex'),
      '/usr/local/bin/codex',
      '/usr/bin/codex',
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) return p;
    }

    return 'codex';
  }

  public getCodexAuthInfo(userId?: string): { linked: boolean; email?: string; mtime?: number } {
    const candidateFiles: string[] = [];

    if (userId && userId !== 'default' && userId !== 'default_user') {
      const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
      candidateFiles.push(
        path.join(os.homedir(), '.agent-user-profiles', safeUserId, '.codex', 'auth.json'),
        path.join(os.homedir(), '.agent-codex-auth', safeUserId, 'auth.json'),
        path.join(os.homedir(), '.agent-codex-auth', safeUserId, '.codex', 'auth.json')
      );
    }

    candidateFiles.push(path.join(os.homedir(), '.codex', 'auth.json'));

    for (const authJsonPath of candidateFiles) {
      if (fs.existsSync(authJsonPath)) {
        try {
          const stats = fs.statSync(authJsonPath);
          if (stats.size > 20) {
            const raw = fs.readFileSync(authJsonPath, 'utf8');
            const parsed = JSON.parse(raw);
            let email = parsed.email;
            if (!email && parsed.tokens?.id_token) {
              try {
                const parts = parsed.tokens.id_token.split('.');
                if (parts.length > 1) {
                  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                  if (payload.email) email = payload.email;
                }
              } catch {}
            }
            if (parsed.tokens || parsed.OPENAI_API_KEY || parsed.auth_mode) {
              return {
                linked: true,
                email: email || (parsed.tokens ? 'ChatGPT Account' : undefined),
                mtime: stats.mtimeMs,
              };
            }
          }
        } catch {}
      }
    }

    return { linked: false };
  }

  public isCodexLinked(userId?: string): boolean {
    return this.getCodexAuthInfo(userId).linked;
  }

  public async refreshCodexStatus(userId?: string): Promise<{ linked: boolean; email?: string }> {
    const info = this.getCodexAuthInfo(userId);
    this.cachedCodexStatus = {
      linked: info.linked,
      email: info.email,
      timestamp: Date.now(),
    };
    return info;
  }

  public async startCodexCliLogin(userId?: string, userEmail?: string): Promise<{ authUrl: string; userCode?: string; sessionId: string }> {
    const sessionKey = userId || 'global';
    const existing = this.activeCodexLogins.get(sessionKey);

    if (
      existing &&
      existing.authUrl &&
      Date.now() - existing.startedAt < 60000
    ) {
      return {
        authUrl: existing.authUrl,
        userCode: existing.userCode,
        sessionId: String(existing.startedAt),
      };
    }

    if (existing) {
      clearTimeout(existing.timeoutId);
      try {
        existing.process.kill('SIGTERM');
      } catch {}
      this.activeCodexLogins.delete(sessionKey);
      try {
        fs.rmSync(existing.userCodexHome, { recursive: true, force: true });
      } catch {}
    }

    const safeUserId = (userId || 'global').replace(/[^a-zA-Z0-9_-]/g, '_');
    const userCodexHome = path.join(os.homedir(), '.agent-codex-auth', safeUserId);
    try {
      if (!fs.existsSync(userCodexHome)) {
        fs.mkdirSync(userCodexHome, { recursive: true });
      }
    } catch (err) {
      logger.warn('Failed to ensure userCodexHome directory', { userCodexHome, error: String(err) });
    }

    const codexBin = this.getCodexBin();

    return new Promise((resolve, reject) => {
      let resolved = false;

      // Spawn Codex with isolated CODEX_HOME and HOME for multi-tenant safety
      const proc = spawn(codexBin, ['login', '--device-auth'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...this.getHeadlessCliEnv(),
          CODEX_HOME: userCodexHome,
          HOME: userCodexHome,
        },
      });

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          proc.kill('SIGTERM');
          this.activeCodexLogins.delete(sessionKey);
          try {
            fs.rmSync(userCodexHome, { recursive: true, force: true });
          } catch {}
          reject(new AppError('Codex CLI login timed out waiting for authorization URL', 504, 'TIMEOUT'));
        }
      }, 15000);

      const sessionExpiryTimer = setTimeout(() => {
        const cur = this.activeCodexLogins.get(sessionKey);
        if (cur?.process === proc) {
          try {
            proc.kill('SIGTERM');
          } catch {}
          this.activeCodexLogins.delete(sessionKey);
          try {
            fs.rmSync(userCodexHome, { recursive: true, force: true });
          } catch {}
        }
      }, 300000);

      let buf = '';

      const handleChunk = (chunk: Buffer) => {
        buf += chunk.toString();
        const urlMatch = buf.match(/https:\/\/[^\s\x1b\x07]+/);
        const codeMatch = buf.match(/([A-Z0-9]{4,}-[A-Z0-9]{4,})/);
        if (urlMatch && !resolved) {
          const userCode = codeMatch ? codeMatch[1] : undefined;
          if (buf.includes('device') && !userCode) {
            return;
          }
          resolved = true;
          clearTimeout(timeoutId);
          const authUrl = urlMatch[0];
          this.activeCodexLogins.set(sessionKey, {
            process: proc,
            authUrl,
            userCode,
            userId,
            userEmail,
            userCodexHome,
            startedAt: Date.now(),
            timeoutId: sessionExpiryTimer,
          });
          logger.info('[Codex Auth] Captured Codex CLI device auth details', { authUrl, userCode, userId });
          resolve({ authUrl, userCode, sessionId: String(Date.now()) });
        }
      };

      proc.stdout?.on('data', handleChunk);
      proc.stderr?.on('data', handleChunk);

      proc.on('close', async (code) => {
        clearTimeout(timeoutId);
        clearTimeout(sessionExpiryTimer);
        const loginUserId = userId;
        const loginUserEmail = userEmail;
        this.activeCodexLogins.delete(sessionKey);

        const isolatedAuthCandidates = [
          path.join(userCodexHome, 'auth.json'),
          path.join(userCodexHome, '.codex', 'auth.json'),
        ];
        let foundAuthJson: string | null = null;
        for (const candidate of isolatedAuthCandidates) {
          if (fs.existsSync(candidate) && fs.statSync(candidate).size > 20) {
            foundAuthJson = candidate;
            break;
          }
        }

        const info = this.getCodexAuthInfo(loginUserId);
        const isAuthSuccessful = Boolean(foundAuthJson && fs.existsSync(foundAuthJson) && fs.statSync(foundAuthJson).size > 20);

        if (isAuthSuccessful) {
          let userDetectedEmail = loginUserEmail;
          let authContent = '';

          if (foundAuthJson) {
            try {
              authContent = fs.readFileSync(foundAuthJson, 'utf8');
              const parsed = JSON.parse(authContent);
              if (parsed.email) userDetectedEmail = parsed.email;
              else if (parsed.tokens?.id_token) {
                const parts = parsed.tokens.id_token.split('.');
                if (parts.length > 1) {
                  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                  if (payload.email) userDetectedEmail = payload.email;
                }
              }
            } catch {}
          }

          const resolvedEmail = userDetectedEmail || info.email || 'ChatGPT Account';
          logger.info('[Codex Auth] Codex CLI login process completed successfully for user', { loginUserId, resolvedEmail });

          if (loginUserId && loginUserId !== 'default' && loginUserId !== 'default_user') {
            const userProfileCodexDir = path.join(os.homedir(), '.agent-user-profiles', safeUserId, '.codex');
            try {
              if (!fs.existsSync(userProfileCodexDir)) {
                fs.mkdirSync(userProfileCodexDir, { recursive: true });
              }
              if (authContent) {
                fs.writeFileSync(path.join(userProfileCodexDir, 'auth.json'), authContent, 'utf8');
                const defaultCodexDir = path.join(os.homedir(), '.codex');
                if (!fs.existsSync(defaultCodexDir)) fs.mkdirSync(defaultCodexDir, { recursive: true });
                fs.writeFileSync(path.join(defaultCodexDir, 'auth.json'), authContent, 'utf8');
              }
            } catch (err) {
              logger.warn('Failed to persist user profile codex credentials', { error: String(err) });
            }

            this.linkUserCli(loginUserId, 'codex', resolvedEmail);
            import('../sandbox/sandbox.service.js')
              .then(({ sandboxService }) => sandboxService.syncCredentialsToUserSandboxes(loginUserId).catch(() => {}))
              .catch(() => {});
          } else {
            if (authContent) {
              const defaultCodexDir = path.join(os.homedir(), '.codex');
              try {
                if (!fs.existsSync(defaultCodexDir)) fs.mkdirSync(defaultCodexDir, { recursive: true });
                fs.writeFileSync(path.join(defaultCodexDir, 'auth.json'), authContent, 'utf8');
              } catch {}
            }
            const links = this.loadUserCliLinks();
            for (const uid of Object.keys(links)) {
              this.linkUserCli(uid, 'codex', resolvedEmail);
              import('../sandbox/sandbox.service.js')
                .then(({ sandboxService }) => sandboxService.syncCredentialsToUserSandboxes(uid).catch(() => {}))
                .catch(() => {});
            }
          }

          try {
            fs.rmSync(userCodexHome, { recursive: true, force: true });
          } catch {}
        } else if (!resolved) {
          try {
            fs.rmSync(userCodexHome, { recursive: true, force: true });
          } catch {}
          logger.error(`[Codex Auth] Codex CLI login process exited before auth URL could be resolved (code ${code})`, { exitCode: code, loginUserId, buf: buf.slice(-500) });
          reject(new AppError(`Codex CLI login process exited with code ${code}: ${buf}`, 500, 'CLI_LOGIN_ERROR'));
        } else {
          try {
            fs.rmSync(userCodexHome, { recursive: true, force: true });
          } catch {}
          logger.warn('[Codex Auth] Codex CLI login process closed without valid credentials', {
            exitCode: code,
            loginUserId,
            hasAuthJson: Boolean(foundAuthJson),
            stderrSample: buf.slice(-500),
          });
        }
      });

      proc.on('error', (err: any) => {
        clearTimeout(timeoutId);
        clearTimeout(sessionExpiryTimer);
        this.activeCodexLogins.delete(sessionKey);
        try {
          fs.rmSync(userCodexHome, { recursive: true, force: true });
        } catch {}

        logger.error('[Codex Auth] Failed to spawn Codex CLI for device auth', { error: err.message, codexBin, userId });
        if (!resolved) {
          reject(new AppError(`Failed to spawn Codex CLI: ${err.message}`, 500, 'SPAWN_ERROR'));
        }
      });
    });
  }

  public async unlinkCodex(userId?: string): Promise<boolean> {
    const sessionKey = userId || 'global';
    const active = this.activeCodexLogins.get(sessionKey);
    if (active) {
      clearTimeout(active.timeoutId);
      try {
        active.process.kill('SIGTERM');
      } catch {}
      this.activeCodexLogins.delete(sessionKey);
      try {
        fs.rmSync(active.userCodexHome, { recursive: true, force: true });
      } catch {}
    }

    if (userId) {
      this.unlinkUserCli(userId, 'codex');
      const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const userProfileCodex = path.join(os.homedir(), '.agent-user-profiles', safeUserId, '.codex');
      try {
        if (fs.existsSync(userProfileCodex)) {
          fs.rmSync(userProfileCodex, { recursive: true, force: true });
        }
      } catch {}
    }

    try {
      const codexBin = this.getCodexBin();
      await new Promise<void>((resolve) => {
        const proc = spawn(codexBin, ['logout'], {
          stdio: ['ignore', 'ignore', 'ignore'],
          env: this.getHeadlessCliEnv(),
        });
        proc.on('close', () => resolve());
        proc.on('error', () => resolve());
      });
    } catch {}

    try {
      const authJsonPath = path.join(os.homedir(), '.codex', 'auth.json');
      if (fs.existsSync(authJsonPath)) {
        fs.unlinkSync(authJsonPath);
      }
    } catch {}

    this.cachedCodexStatus = { linked: false, timestamp: Date.now() };
    return true;
  }
}

export const cliAuthService = new CliAuthService();
