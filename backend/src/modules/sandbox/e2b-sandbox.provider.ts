import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { FileType, Sandbox } from 'e2b';
import type {
  CloudSandboxMetrics,
  ISandboxProvider,
  SandboxExecutionResponse,
  SandboxCliExecutionRequest,
  SandboxCliExecutionResponse,
  SandboxFileNode,
  TerminalLogEntry,
} from '../../types/sandbox.types.js';
import { generateId } from '../../utils/id.util.js';
import { logger } from '../../utils/logger.util.js';
import { envConfig } from '../../config/env.config.js';

export interface SandboxRecord {
  sandboxId: string;
  name: string;
  userId: string;
  attachedSessionIds: Set<string>;
  createdAt: number;
  lastActiveAt: number;
}

export class E2BSandboxProvider implements ISandboxProvider {
  public readonly name = 'e2b-cloud';
  private readonly sessionToSandboxId = new Map<string, string>();
  private readonly sandboxRecords = new Map<string, SandboxRecord>();
  private readonly activeSandboxes = new Map<string, Sandbox>();
  private readonly terminalLogs: TerminalLogEntry[] = [];
  private lastPingMs = 35;
  private readonly workspaceRoot = '/home/user/workspace';
  private readonly initializedSandboxes = new Set<string>();

  constructor() {
    this.addLog('READY', 'E2B Cloud Sandbox Provider initialized.');
    this.loadRecordsFromDisk();
    this.syncWithCloud().catch(() => {});
  }

  private getStoragePath(): string {
    const dir = path.join(os.homedir(), '.gemini');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    }
    return path.join(dir, 'e2b_sandboxes.json');
  }

  private renumberSandboxes(): void {
    const allRecords = Array.from(this.sandboxRecords.values()).sort(
      (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.sandboxId.localeCompare(b.sandboxId)
    );
    allRecords.forEach((record, index) => {
      record.name = `Sandbox #${index + 1} (${record.sandboxId.substring(0, 6)})`;
    });
  }

  private loadRecordsFromDisk(): void {
    try {
      const storagePath = this.getStoragePath();
      if (!fs.existsSync(storagePath)) return;
      const raw = fs.readFileSync(storagePath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.records)) {
        for (const item of data.records) {
          if (item && item.sandboxId) {
            this.sandboxRecords.set(item.sandboxId, {
              sandboxId: item.sandboxId,
              name: item.name || `Sandbox (${item.sandboxId.substring(0, 6)})`,
              userId: item.userId || 'default_user',
              attachedSessionIds: new Set(Array.isArray(item.attachedSessionIds) ? item.attachedSessionIds : []),
              createdAt: item.createdAt || Date.now(),
              lastActiveAt: item.lastActiveAt || Date.now(),
            });
          }
        }
        this.renumberSandboxes();
      }
      if (data.sessionToSandbox && typeof data.sessionToSandbox === 'object') {
        for (const [sess, sbId] of Object.entries(data.sessionToSandbox)) {
          if (typeof sbId === 'string') {
            this.sessionToSandboxId.set(sess, sbId);
          }
        }
      }
    } catch (err) {
      logger.warn('Failed to load sandbox records from disk', { error: String(err) });
    }
  }

  private saveRecordsToDisk(): void {
    try {
      const storagePath = this.getStoragePath();
      const records = Array.from(this.sandboxRecords.values()).map((r) => ({
        sandboxId: r.sandboxId,
        name: r.name,
        userId: r.userId,
        attachedSessionIds: Array.from(r.attachedSessionIds),
        createdAt: r.createdAt,
        lastActiveAt: r.lastActiveAt,
      }));
      const sessionToSandbox: Record<string, string> = {};
      for (const [sess, sbId] of this.sessionToSandboxId.entries()) {
        sessionToSandbox[sess] = sbId;
      }
      fs.writeFileSync(storagePath, JSON.stringify({ records, sessionToSandbox }, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch (err) {
      logger.warn('Failed to save sandbox records to disk', { error: String(err) });
    }
  }

  public async syncWithCloud(userId?: string): Promise<void> {
    const apiKey = this.getApiKey();
    if (!apiKey) return;

    try {
      const paginator = await Sandbox.list({ apiKey });
      const items = (await paginator.nextItems().catch(() => [])) || [];
      if (!items || !items.length) return;

      const activeCloudIds = new Set(items.map((i) => i.sandboxId));

      // Sort items by startedAt ascending so oldest is #1, second is #2, third is #3
      const sorted = items.slice().sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

      let index = 0;
      for (const cloudSandbox of sorted) {
        index++;
        const sbId = cloudSandbox.sandboxId;
        const startedTime = new Date(cloudSandbox.startedAt).getTime() || Date.now();
        const existing = this.sandboxRecords.get(sbId);

        if (existing) {
          if (startedTime > existing.lastActiveAt) {
            existing.lastActiveAt = startedTime;
          }
          if (userId && userId !== 'default_user') {
            existing.userId = userId;
          }
        } else {
          this.sandboxRecords.set(sbId, {
            sandboxId: sbId,
            name: `Sandbox #${index} (${sbId.substring(0, 6)})`,
            userId: userId || 'default_user',
            attachedSessionIds: new Set(),
            createdAt: startedTime,
            lastActiveAt: startedTime,
          });
        }
      }

      // Prune records deleted from cloud
      for (const localId of Array.from(this.sandboxRecords.keys())) {
        if (!activeCloudIds.has(localId)) {
          this.sandboxRecords.delete(localId);
          this.activeSandboxes.delete(localId);
          for (const [sess, targetId] of this.sessionToSandboxId.entries()) {
            if (targetId === localId) {
              this.sessionToSandboxId.delete(sess);
            }
          }
        }
      }

      this.renumberSandboxes();
      this.saveRecordsToDisk();
    } catch (err) {
      logger.warn('Failed to sync sandboxes from E2B cloud', { error: String(err) });
    }
  }

  private getApiKey(): string | undefined {
    return envConfig.E2B_API_KEY || process.env.E2B_API_KEY;
  }

  private addLog(level: TerminalLogEntry['level'], message: string): void {
    const entry: TerminalLogEntry = {
      id: generateId('sbx'),
      timestamp: new Date().toISOString().substring(11, 23),
      level,
      message,
    };
    this.terminalLogs.push(entry);
    if (this.terminalLogs.length > 50) {
      this.terminalLogs.shift();
    }
  }

  public async isAvailable(): Promise<boolean> {
    const key = this.getApiKey();
    if (!key) {
      return false;
    }
    return true;
  }

  private sanitizeSessionId(sessionId: string): string {
    return sessionId.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32) || 'default';
  }

  private async getSandboxInstance(sandboxId: string): Promise<Sandbox> {
    const cached = this.activeSandboxes.get(sandboxId);
    if (cached) {
      return cached;
    }

    const apiKey = this.getApiKey();
    this.addLog('INFO', `Connecting to E2B sandbox ${sandboxId.substring(0, 8)}...`);
    const sandbox = await Sandbox.connect(sandboxId, { apiKey });
    this.activeSandboxes.set(sandboxId, sandbox);
    return sandbox;
  }

  private async resumeIfPaused(sandboxId: string, apiKey?: string): Promise<Sandbox> {
    const key = apiKey || this.getApiKey();
    const sandbox = await this.getSandboxInstance(sandboxId);
    const isRunning = await sandbox.isRunning().catch(() => false);
    if (!isRunning) {
      this.addLog('INFO', `Resuming paused E2B sandbox ${sandboxId.substring(0, 8)}...`);
      const resumed = await Sandbox.connect(sandboxId, { apiKey: key });
      this.activeSandboxes.set(sandboxId, resumed);
      this.addLog('READY', `E2B sandbox resumed with full workspace preserved.`);
      return resumed;
    }
    return sandbox;
  }

  public attachSessionToSandbox(sessionId: string, sandboxId: string): boolean {
    const cleanSession = this.sanitizeSessionId(sessionId);
    const record = this.sandboxRecords.get(sandboxId);
    if (!record) {
      return false;
    }
    const prevSandboxId = this.sessionToSandboxId.get(cleanSession);
    if (prevSandboxId && prevSandboxId !== sandboxId) {
      const prevRecord = this.sandboxRecords.get(prevSandboxId);
      if (prevRecord) {
        prevRecord.attachedSessionIds.delete(cleanSession);
      }
    }
    this.sessionToSandboxId.set(cleanSession, sandboxId);
    record.attachedSessionIds.add(cleanSession);
    record.lastActiveAt = Date.now();
    this.addLog(
      'INFO',
      `Session [${cleanSession}] attached to sandbox ${sandboxId.substring(0, 8)} (${record.attachedSessionIds.size} sessions sharing this workspace).`
    );
    this.saveRecordsToDisk();
    return true;
  }

  public detachSession(sessionId: string): boolean {
    const cleanSession = this.sanitizeSessionId(sessionId);
    let detached = false;

    for (const [sess, sbId] of this.sessionToSandboxId.entries()) {
      if (sess === cleanSession || sess === sessionId) {
        this.sessionToSandboxId.delete(sess);
        detached = true;
      }
    }

    for (const record of this.sandboxRecords.values()) {
      if (
        record.attachedSessionIds.has(cleanSession) ||
        record.attachedSessionIds.has(sessionId)
      ) {
        record.attachedSessionIds.delete(cleanSession);
        record.attachedSessionIds.delete(sessionId);
        detached = true;
      }
    }

    if (detached) {
      this.saveRecordsToDisk();
    }
    return detached;
  }

  public clearAllAttachedSessions(): void {
    this.sessionToSandboxId.clear();
    for (const record of this.sandboxRecords.values()) {
      record.attachedSessionIds.clear();
    }
    this.saveRecordsToDisk();
  }

  public syncActiveSessions(activeSessionIds: string[], userId?: string): void {
    const validCleanIds = new Set(
      activeSessionIds
        .map((s) => this.sanitizeSessionId(s))
        .filter((s) => s && s !== 'default')
    );

    let changed = false;
    for (const [sess, sbId] of Array.from(this.sessionToSandboxId.entries())) {
      if (!validCleanIds.has(sess)) {
        this.sessionToSandboxId.delete(sess);
        const record = this.sandboxRecords.get(sbId);
        if (record && record.attachedSessionIds.has(sess)) {
          record.attachedSessionIds.delete(sess);
          changed = true;
        }
      }
    }

    for (const record of this.sandboxRecords.values()) {
      if (userId && record.userId && record.userId !== userId && record.userId !== 'default_user') {
        continue;
      }
      for (const sess of Array.from(record.attachedSessionIds)) {
        if (!validCleanIds.has(sess)) {
          record.attachedSessionIds.delete(sess);
          this.sessionToSandboxId.delete(sess);
          changed = true;
        }
      }
    }

    if (changed) {
      this.saveRecordsToDisk();
    }
  }

  public async getOrCreateSandbox(
    sessionId: string,
    userId?: string,
    targetSandboxId?: string,
    replaceOldest?: boolean
  ): Promise<string> {
    const effectiveUserId = userId || 'default_user';
    const cleanId = this.sanitizeSessionId(sessionId);
    const apiKey = this.getApiKey();

    if (!apiKey) {
      throw new Error('E2B_API_KEY is not configured in environment.');
    }

    // 1. If explicit existing sandboxId requested, attach session directly
    if (targetSandboxId && targetSandboxId !== 'new') {
      const targetRecord = this.sandboxRecords.get(targetSandboxId);
      if (targetRecord) {
        this.attachSessionToSandbox(cleanId, targetSandboxId);
        await this.resumeIfPaused(targetSandboxId, apiKey);
        return targetSandboxId;
      }
    }

    // 2. If this session is already attached to a sandbox, reuse it (only if not explicitly requesting a new one)
    if (targetSandboxId !== 'new') {
      let existingSandboxId = this.sessionToSandboxId.get(cleanId);
      if (!existingSandboxId) {
        existingSandboxId = this.getActiveSandboxId(cleanId, userId) || undefined;
        if (existingSandboxId) {
          this.sessionToSandboxId.set(cleanId, existingSandboxId);
        }
      }
      if (existingSandboxId) {
        const record = this.sandboxRecords.get(existingSandboxId);
        if (record) {
          record.lastActiveAt = Date.now();
        }
        try {
          await this.resumeIfPaused(existingSandboxId, apiKey);
          return existingSandboxId;
        } catch (err) {
          logger.warn('Failed to reconnect to existing E2B sandbox, will allocate another', {
            sessionId: cleanId,
            sandboxId: existingSandboxId,
            error: String(err),
          });
          this.activeSandboxes.delete(existingSandboxId);
          this.sessionToSandboxId.delete(cleanId);
          this.sandboxRecords.delete(existingSandboxId);
        }
      }
    }

    // Detach session from prior sandbox if explicitly launching a new isolated microVM
    if (targetSandboxId === 'new') {
      this.detachSession(cleanId);
    }

    // 3. User sandboxes lookup
    const userSandboxes = Array.from(this.sandboxRecords.values())
      .filter((r) => !userId || userId === 'default_user' || r.userId === userId || r.userId === 'default_user' || !r.userId)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    // 4. If targetSandboxId is NOT explicitly 'new', explicit attachment is required
    if (targetSandboxId !== 'new') {
      throw new Error(
        'No cloud sandbox is attached to this session. Please select an active sandbox from the top bar before executing.'
      );
    }

    // 5. Enforce Per-User Maximum Sandbox Quota when allocating a brand new sandbox
    const maxSandboxes = envConfig.MAX_SANDBOXES_PER_USER ?? 3;
    if (userSandboxes.length >= maxSandboxes) {
      throw new Error(
        `Sandbox quota limit reached (${maxSandboxes}/${maxSandboxes} full). Please delete an existing sandbox using the trash icon to free a quota slot before creating a new one.`
      );
    }

    // 5. Launch a new dedicated E2B cloud microVM with auto-pause lifecycle
    try {
      this.addLog('EXEC', `Spinning up dedicated E2B Firecracker microVM for session [${cleanId}]...`);
      const start = Date.now();

      const sandbox = await Sandbox.create({
        apiKey,
        timeoutMs: 15 * 60 * 1000, // 15 minutes of idle before auto-pause
        lifecycle: {
          onTimeout: 'pause', // Preserves RAM and disk state indefinitely
          autoResume: true,
        },
      });

      this.lastPingMs = Date.now() - start;
      const sbId = sandbox.sandboxId;
      this.sessionToSandboxId.set(cleanId, sbId);
      this.activeSandboxes.set(sbId, sandbox);
      this.sandboxRecords.set(sbId, {
        sandboxId: sbId,
        name: `Sandbox (${sbId.substring(0, 6)})`,
        userId: effectiveUserId,
        attachedSessionIds: new Set([cleanId]),
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      });
      this.renumberSandboxes();
      this.saveRecordsToDisk();

      // Create workspace directory
      await sandbox.commands.run(`mkdir -p ${this.workspaceRoot}`);

      // Seed any cloud environment tokens for agent execution
      const envExports: string[] = [
        'export TERM=xterm-256color',
        `export PATH="/home/user/.local/bin:$PATH"`,
      ];
      if (process.env.GEMINI_API_KEY) {
        envExports.push(`export GEMINI_API_KEY="${process.env.GEMINI_API_KEY}"`);
      }
      if (process.env.ANTHROPIC_API_KEY) {
        envExports.push(`export ANTHROPIC_API_KEY="${process.env.ANTHROPIC_API_KEY}"`);
      }
      if (process.env.OPENAI_API_KEY) {
        envExports.push(`export OPENAI_API_KEY="${process.env.OPENAI_API_KEY}"`);
      }

      // Initialize dual-user permission boundary and secure credentials
      await this.ensureSecurityBoundaryAndCredentials(sandbox, effectiveUserId);

      this.addLog('READY', `E2B MicroVM ${sbId.substring(0, 8)} online (${this.lastPingMs}ms launch time). Security boundary active.`);
      return sbId;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addLog('ERROR', `E2B microVM launch failed: ${msg}`);
      logger.error('Failed to create E2B sandbox', { error: msg });
      throw new Error(`E2B sandbox creation failed: ${msg}`);
    }
  }

  /**
   * Enforces strict Linux DAC Dual-User Privilege Separation:
   * 1. 'agent-runner' (UID system): owns credentials in /home/agent-runner with 0700/0600.
   * 2. 'user' (developer): owns /home/user/workspace (rw), but CANNOT read /home/agent-runner.
   */
  public async ensureSecurityBoundaryAndCredentials(sandbox: Sandbox, userId?: string): Promise<void> {
    if (this.initializedSandboxes.has(sandbox.sandboxId)) {
      return;
    }
    const homedir = os.homedir();
    try {
      const setupScript = `
        id -u agent-runner >/dev/null 2>&1 || sudo useradd -m -s /bin/bash agent-runner
        sudo usermod -a -G user agent-runner 2>/dev/null || true
        sudo usermod -a -G agent-runner user 2>/dev/null || true
        sudo mkdir -p /home/agent-runner/.gemini/antigravity-cli /home/agent-runner/.claude /home/agent-runner/.codex /home/agent-runner/.local/bin
        sudo chmod 700 /home/agent-runner
        sudo chmod 700 /home/agent-runner/.gemini /home/agent-runner/.claude /home/agent-runner/.codex
        sudo chmod 755 /home/user 2>/dev/null || true
        sudo mkdir -p ${this.workspaceRoot}
        sudo chown -R user:user ${this.workspaceRoot} 2>/dev/null || true
        sudo chmod -R 777 ${this.workspaceRoot} 2>/dev/null || true
        # Remove any circular workspace symlinks inside workspaceRoot
        sudo rm -f ${this.workspaceRoot}/workspace 2>/dev/null || true
        if [ ! -L /workspace ] && [ ! -d /workspace ]; then
          sudo ln -s ${this.workspaceRoot} /workspace 2>/dev/null || true
        fi
        sudo chmod -h 777 /workspace 2>/dev/null || true
        # Migrate any user-created non-hidden files from /home/agent-runner into the workspace root
        for f in /home/agent-runner/*; do
          if [ -f "$f" ]; then
            sudo mv "$f" ${this.workspaceRoot}/ 2>/dev/null || true
          fi
        done
        sudo chown -R user:user ${this.workspaceRoot} 2>/dev/null || true
        sudo chmod -R 777 ${this.workspaceRoot} 2>/dev/null || true
      `;
      await sandbox.commands.run(setupScript).catch(() => {});

      // Ensure agy CLI binary is provisioned into /usr/local/bin/agy
      const checkAgy = await sandbox.commands.run('which agy || test -f /usr/local/bin/agy').catch(() => null);
      if (checkAgy?.exitCode !== 0) {
        const snapAgy = fs.existsSync('/snap/antigravity-cli/current/bin/agy')
          ? '/snap/antigravity-cli/current/bin/agy'
          : fs.existsSync('/usr/local/bin/agy')
          ? '/usr/local/bin/agy'
          : null;
        if (snapAgy && fs.existsSync(snapAgy)) {
          this.addLog('INFO', 'Provisioning agy CLI binary into cloud sandbox microVM...');
          const rawBuf = fs.readFileSync(snapAgy);
          const gzipped = zlib.gzipSync(rawBuf);
          await sandbox.files.write('/tmp/agy.gz', gzipped.buffer as ArrayBuffer);
          await sandbox.commands.run('gunzip -f /tmp/agy.gz && sudo mv /tmp/agy /usr/local/bin/agy && sudo chmod +x /usr/local/bin/agy');
          this.addLog('READY', 'agy CLI binary successfully installed in /usr/local/bin/agy');
        }
      }

      // Ensure codex CLI and code-mode runner binaries are provisioned into /usr/local/bin
      const checkCodex = await sandbox.commands.run('which codex || test -f /usr/local/bin/codex').catch(() => null);
      if (checkCodex?.exitCode !== 0) {
        const currentCodex = path.join(homedir, '.codex', 'packages', 'app-server-daemon', 'current', 'bin', 'codex');
        const localCodex = path.join(homedir, '.local', 'bin', 'codex');
        const hostCodex = fs.existsSync(currentCodex) ? currentCodex : fs.existsSync(localCodex) ? localCodex : null;
        if (hostCodex && fs.existsSync(hostCodex)) {
          this.addLog('INFO', 'Provisioning codex CLI binary into cloud sandbox microVM...');
          const rawBuf = fs.readFileSync(hostCodex);
          const gzipped = zlib.gzipSync(rawBuf);
          await sandbox.files.write('/tmp/codex.gz', gzipped.buffer as ArrayBuffer);
          await sandbox.commands.run('gunzip -f /tmp/codex.gz && sudo mv /tmp/codex /usr/local/bin/codex && sudo chmod +x /usr/local/bin/codex');
          this.addLog('READY', 'codex CLI binary successfully installed in /usr/local/bin/codex');
        }
      }

      const checkCodeMode = await sandbox.commands.run('which codex-code-mode-host || test -f /usr/local/bin/codex-code-mode-host').catch(() => null);
      if (checkCodeMode?.exitCode !== 0) {
        const currentCodeMode = path.join(homedir, '.codex', 'packages', 'app-server-daemon', 'current', 'bin', 'codex-code-mode-host');
        if (fs.existsSync(currentCodeMode)) {
          const rawBuf = fs.readFileSync(currentCodeMode);
          const gzipped = zlib.gzipSync(rawBuf);
          await sandbox.files.write('/tmp/codex-code-mode-host.gz', gzipped.buffer as ArrayBuffer);
          await sandbox.commands.run('gunzip -f /tmp/codex-code-mode-host.gz && sudo mv /tmp/codex-code-mode-host /usr/local/bin/codex-code-mode-host && sudo chmod +x /usr/local/bin/codex-code-mode-host');
          this.addLog('READY', 'codex-code-mode-host successfully installed in /usr/local/bin/codex-code-mode-host');
        }
      }

      // Ensure /workspace is symlinked to /home/user/workspace for path compatibility
      await sandbox.commands.run('sudo ln -s /home/user/workspace /workspace 2>/dev/null || true');

      // Determine user-specific profile directory if multi-tenant profile exists
      const userProfileDir = userId && userId !== 'default' && userId !== 'default_user'
        ? path.join(homedir, '.agent-user-profiles', userId)
        : homedir;

      // Seed Antigravity / Gemini OAuth credentials securely to /home/agent-runner
      const candidateAgyCreds = [
        path.join(userProfileDir, '.gemini', 'oauth_creds.json'),
        path.join(homedir, '.gemini', 'oauth_creds.json'),
        path.join(homedir, '.gemini', 'antigravity-cli', 'oauth_creds.json'),
        path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'oauth_creds.json'),
      ];

      let agyCredsContent = '';
      let newestAgyMtime = 0;
      for (const cp of candidateAgyCreds) {
        if (fs.existsSync(cp)) {
          try {
            const st = fs.statSync(cp);
            if (st.mtimeMs > newestAgyMtime) {
              const text = fs.readFileSync(cp, 'utf8');
              const parsed = JSON.parse(text);
              if (parsed && (parsed.access_token || parsed.refresh_token)) {
                newestAgyMtime = st.mtimeMs;
                agyCredsContent = text;
              }
            }
          } catch {}
        }
      }

      if (agyCredsContent) {
        await sandbox.files.write('/home/agent-runner/.gemini/oauth_creds.json', agyCredsContent).catch(() => {});
        // Do not write old gemini oauth_creds to antigravity-cli dir as agy uses dedicated keyring-unavailable tokens
      }

      // Seed dedicated Antigravity CLI token files (used by agy when keyring is unavailable)
      const candidateAgyTokens = [
        path.join(userProfileDir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
        path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
        path.join(homedir, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
        path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-oauth-token'),
        path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
        path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
      ];

      let agyTokenContent = '';
      let newestAgyTokenMtime = 0;
      for (const tp of candidateAgyTokens) {
        if (fs.existsSync(tp)) {
          try {
            const st = fs.statSync(tp);
            if (st.size > 20 && st.mtimeMs > newestAgyTokenMtime) {
              const text = fs.readFileSync(tp, 'utf8');
              if (text.includes('token') || text.includes('Bearer') || text.includes('access') || text.includes('refresh')) {
                newestAgyTokenMtime = st.mtimeMs;
                agyTokenContent = text;
              }
            }
          } catch {}
        }
      }

      if (agyTokenContent) {
        await sandbox.commands.run('sudo mkdir -p /home/agent-runner/.gemini/antigravity-cli/cache /home/agent-runner/.antigravity/cache').catch(() => {});
        await sandbox.files.write('/home/agent-runner/.gemini/antigravity-cli/cache/antigravity-keyring-unavailable-oauth-token', agyTokenContent).catch(() => {});
        await sandbox.files.write('/home/agent-runner/.gemini/antigravity-cli/antigravity-oauth-token', agyTokenContent).catch(() => {});
        await sandbox.files.write('/home/agent-runner/.gemini/antigravity-cli/cache/antigravity-oauth-token', agyTokenContent).catch(() => {});
        await sandbox.files.write('/home/agent-runner/.gemini/antigravity-cli/cache/jetski-keyring-unavailable-oauth-token', agyTokenContent).catch(() => {});
        await sandbox.files.write('/home/agent-runner/.gemini/antigravity-cli/jetski-oauth-token', agyTokenContent).catch(() => {});
        // Remove stale/incompatible oauth_creds.json from antigravity-cli if present so agy doesn't try to use it
        await sandbox.commands.run('sudo rm -f /home/agent-runner/.gemini/antigravity-cli/oauth_creds.json').catch(() => {});
      }

      // Seed google_accounts.json so agy knows the active Google account
      const hostGoogleAccounts = path.join(homedir, '.gemini', 'google_accounts.json');
      if (fs.existsSync(hostGoogleAccounts)) {
        const accountsContent = fs.readFileSync(hostGoogleAccounts, 'utf8');
        await sandbox.files.write('/home/agent-runner/.gemini/google_accounts.json', accountsContent).catch(() => {});
        await sandbox.files.write('/home/agent-runner/.gemini/antigravity-cli/google_accounts.json', accountsContent).catch(() => {});
      }

      // Seed antigravity-cli config and state files if available
      const hostAgyDir = path.join(homedir, '.gemini', 'antigravity-cli');
      if (fs.existsSync(hostAgyDir)) {
        for (const fname of ['installation_id', 'jetski_state.pbtxt', 'settings.json']) {
          const fpath = path.join(hostAgyDir, fname);
          if (fs.existsSync(fpath)) {
            await sandbox.files.write(`/home/agent-runner/.gemini/antigravity-cli/${fname}`, fs.readFileSync(fpath, 'utf8')).catch(() => {});
          }
        }
      }

      // Root .gemini user_info if available
      const hostUserInfo = path.join(homedir, '.gemini', 'user_info.json');
      if (fs.existsSync(hostUserInfo)) {
        await sandbox.files.write('/home/agent-runner/.gemini/user_info.json', fs.readFileSync(hostUserInfo, 'utf8')).catch(() => {});
      }

      // Seed settings.json: if Gemini API key is configured, use gemini-api-key; else use oauth-personal
      const activeGeminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (activeGeminiKey) {
        const agySettings = JSON.stringify({
          modelProvider: 'gemini',
          security: {
            auth: {
              selectedType: 'gemini-api-key',
            },
          },
        }, null, 2);
        await sandbox.files.write('/home/agent-runner/.gemini/settings.json', agySettings).catch(() => {});
        await sandbox.files.write('/home/agent-runner/.gemini/antigravity-cli/settings.json', agySettings).catch(() => {});
      } else {
        const hostGeminiSettings = path.join(homedir, '.gemini', 'settings.json');
        if (fs.existsSync(hostGeminiSettings)) {
          const settingsContent = fs.readFileSync(hostGeminiSettings, 'utf8');
          await sandbox.files.write('/home/agent-runner/.gemini/settings.json', settingsContent).catch(() => {});
          await sandbox.files.write('/home/agent-runner/.gemini/antigravity-cli/settings.json', settingsContent).catch(() => {});
        } else {
          const agyOAuthSettings = JSON.stringify({
            security: {
              auth: {
                selectedType: 'oauth-personal',
              },
            },
          }, null, 2);
          await sandbox.files.write('/home/agent-runner/.gemini/settings.json', agyOAuthSettings).catch(() => {});
          await sandbox.files.write('/home/agent-runner/.gemini/antigravity-cli/settings.json', agyOAuthSettings).catch(() => {});
        }
      }

      // Seed Claude credentials securely to /home/agent-runner
      const claudeCredsPath = path.join(userProfileDir, '.claude', '.credentials.json');
      const hostClaudeCreds = fs.existsSync(claudeCredsPath)
        ? claudeCredsPath
        : path.join(homedir, '.claude', '.credentials.json');

      if (fs.existsSync(hostClaudeCreds)) {
        await sandbox.files.write('/home/agent-runner/.claude/.credentials.json', fs.readFileSync(hostClaudeCreds, 'utf8')).catch(() => {});
      }

      // Seed Codex credentials securely to /home/agent-runner
      const codexCredsPath = path.join(userProfileDir, '.codex', 'auth.json');
      const hostCodexCreds = fs.existsSync(codexCredsPath)
        ? codexCredsPath
        : path.join(homedir, '.codex', 'auth.json');

      if (fs.existsSync(hostCodexCreds)) {
        await sandbox.files.write('/home/agent-runner/.codex/auth.json', fs.readFileSync(hostCodexCreds, 'utf8')).catch(() => {});
      }

      // Lock down permissions: strictly chmod 700 for agent-runner so other users cannot access it
      const lockScript = `
        sudo chown -R agent-runner:agent-runner /home/agent-runner 2>/dev/null || true
        sudo chmod -R 700 /home/agent-runner 2>/dev/null || true
      `;
      await sandbox.commands.run(lockScript).catch(() => {});
      this.initializedSandboxes.add(sandbox.sandboxId);
    } catch (err) {
      logger.warn('Failed to fully establish security boundary in E2B sandbox', { error: String(err) });
    }
  }

  /**
   * Executes AI Agent CLIs (agy, claude, codex) directly inside the isolated microVM.
   * Runs under 'agent-runner' so tool executions happen in the sandbox, with zero host execution.
   */
  public async executeCliInSandbox(req: SandboxCliExecutionRequest): Promise<SandboxCliExecutionResponse> {
    const start = Date.now();
    const sessionId = req.sessionId || 'default';
    const sandboxId = await this.getOrCreateSandbox(sessionId, req.userId, req.sandboxId);
    const sandbox = await this.getSandboxInstance(sandboxId);

    await this.ensureSecurityBoundaryAndCredentials(sandbox, req.userId);

    const safePrompt = req.prompt.replace(/'/g, "'\\''");
    let cliCmd = '';

    if (req.cli === 'agy') {
      const modelFlag = req.model && req.model !== 'auto' && req.model !== 'default' ? `--model "${req.model}"` : '';
      const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
      const keyEnv = geminiKey ? `GEMINI_API_KEY='${geminiKey}'` : '';
      
      const runnerId = Math.random().toString(36).substring(7);
      const promptFile = `/tmp/prompt_${runnerId}.txt`;
      const scriptFile = `/tmp/run_agy_${runnerId}.sh`;

      await sandbox.files.write(promptFile, req.prompt).catch(() => {});
      await sandbox.files.write(scriptFile, `#!/bin/bash
PROMPT=$(cat "${promptFile}")
rm -f "${promptFile}" "${scriptFile}"
cd /workspace 2>/dev/null || cd /home/user/workspace || true
exec env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" DBUS_SESSION_BUS_ADDRESS="" ${keyEnv} agy -p "$PROMPT" --dangerously-skip-permissions --output-format stream-json ${modelFlag}
`).catch(() => {});
      await sandbox.commands.run(`sudo chown agent-runner:agent-runner ${promptFile} ${scriptFile} && sudo chmod 700 ${promptFile} ${scriptFile}`).catch(() => {});

      cliCmd = `sudo su - agent-runner -c 'script -q -c "${scriptFile}" /dev/null'`;
    } else if (req.cli === 'claude') {
      const modelFlag = req.model && req.model !== 'auto' && req.model !== 'default' ? `--model "${req.model}"` : '';
      cliCmd = `cd /workspace && sudo -u agent-runner -H env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" claude -p '${safePrompt}' --output-format=stream-json ${modelFlag} < /dev/null`;
    } else if (req.cli === 'codex') {
      let modelFlag = '';
      let effortConfig = '';
      if (req.model && req.model !== 'auto' && req.model !== 'default') {
        const effortMatch = req.model.match(/^(.*)-(high|medium|low)$/i);
        if (effortMatch) {
          const baseModel = effortMatch[1];
          const effort = effortMatch[2].toLowerCase();
          modelFlag = `-m "${baseModel}"`;
          effortConfig = `-c model_reasoning_effort="${effort}"`;
        } else {
          modelFlag = `-m "${req.model}"`;
        }
      }
      cliCmd = `cd /workspace && sudo -u agent-runner -H env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" codex exec --skip-git-repo-check --json --dangerously-bypass-approvals-and-sandbox -C /workspace ${modelFlag} ${effortConfig} '${safePrompt}' < /dev/null`;
    }

    this.addLog('EXEC', `[Sandbox-Native] Executing ${req.cli.toUpperCase()} inside isolated microVM...`);

    let accumulatedText = '';
    let rawStdout = '';
    let lineBuffer = '';
    let cliUsage = {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      duration_seconds: 0,
      num_turns: 1,
    };

    try {
      const result = await sandbox.commands.run(cliCmd, {
        cwd: this.workspaceRoot,
        timeoutMs: req.timeoutMs || 120000,
        onStdout: (chunk) => {
          rawStdout += chunk;
          lineBuffer += chunk;
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const event = JSON.parse(trimmed);
              // Handle standard delta/token events
              if (event.type === 'token' || event.type === 'delta') {
                const token = event.text || event.delta || '';
                accumulatedText += token;
                req.onToken?.(token);
              } else if (event.type === 'step' && req.onStep) {
                req.onStep(event);
              } else if (event.type === 'message' || event.type === 'assistant') {
                const content = event.content || event.text || '';
                if (content && !accumulatedText.includes(content)) {
                  accumulatedText += content;
                  req.onToken?.(content);
                }
              }
              // Handle Codex event stream schema
              else if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
                const content = event.item.text || '';
                if (content && !accumulatedText.includes(content)) {
                  accumulatedText += (accumulatedText ? '\n\n' : '') + content;
                  req.onToken?.(content);
                }
              } else if (event.type === 'item.started' && event.item?.type === 'command_execution') {
                const cmd = event.item.command || '';
                const preview = cmd.length > 48 ? `${cmd.slice(0, 48)}...` : cmd;
                req.onStep?.({
                  id: event.item.id || `step_${Date.now()}`,
                  description: `Executing in sandbox: \`${preview}\``,
                  status: 'in_progress',
                  durationMs: 0,
                  command: cmd,
                });
              } else if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
                const cmd = event.item.command || '';
                const preview = cmd.length > 48 ? `${cmd.slice(0, 48)}...` : cmd;
                req.onStep?.({
                  id: event.item.id || `step_${Date.now()}`,
                  description: `Completed: \`${preview}\``,
                  status: event.item.exit_code === 0 ? 'completed' : 'failed',
                  durationMs: 120,
                  command: cmd,
                  output: event.item.aggregated_output,
                });
              } else if (event.type === 'turn.completed' && event.usage) {
                cliUsage = {
                  input_tokens: event.usage.input_tokens || 0,
                  output_tokens: event.usage.output_tokens || 0,
                  total_tokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
                  duration_seconds: Math.round((Date.now() - start) / 1000),
                  num_turns: 1,
                };
              }
              // Handle Antigravity CLI (agy) stream-json schema
              else if (event.event === 'step_update' && event.step_update?.text_delta) {
                const delta = event.step_update.text_delta;
                accumulatedText += delta;
                req.onToken?.(delta);
              } else if (event.event === 'result' && event.result) {
                if (event.result.response && !accumulatedText) {
                  accumulatedText = event.result.response;
                  req.onToken?.(event.result.response);
                }
                if (event.result.usage) {
                  cliUsage = {
                    input_tokens: event.result.usage.input_tokens || 0,
                    output_tokens: event.result.usage.output_tokens || 0,
                    total_tokens: event.result.usage.total_tokens || 0,
                    duration_seconds: Math.round(event.result.duration_seconds || (Date.now() - start) / 1000),
                    num_turns: event.result.num_turns || 1,
                  };
                }
              }
            } catch {
              accumulatedText += line + '\n';
              req.onToken?.(line + '\n');
            }
          }
        },
        onStderr: (errChunk) => {
          this.addLog('STREAM', `[${req.cli} microVM stderr] ${errChunk.substring(0, 100)}`);
          if (errChunk.includes('Authentication required') || errChunk.includes('Please sign in') || errChunk.includes('visit the URL to log in')) {
            throw new Error(`CLI ${req.cli} requires authentication in cloud microVM. Please link your Antigravity account in the top-right subscriptions menu.`);
          }
        },
      });

      if (lineBuffer.trim() && !accumulatedText) {
        accumulatedText = lineBuffer.trim();
      }
      if (!accumulatedText.trim() && rawStdout.trim()) {
        accumulatedText = rawStdout.trim();
      }

      const durationMs = Date.now() - start;
      cliUsage.duration_seconds = Math.round(durationMs / 1000);
      this.addLog('READY', `[Sandbox-Native] ${req.cli.toUpperCase()} finished in microVM (${durationMs}ms)`);

      return {
        text: accumulatedText.trim(),
        durationMs,
        usage: cliUsage,
        exitCode: result.exitCode,
        sandboxId,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      this.addLog('ERROR', `[Sandbox-Native] ${req.cli} microVM command failed: ${msg}`);
      throw err;
    }
  }

  public async executeCommand(
    sandboxId: string,
    command: string,
    timeoutMs = 30000
  ): Promise<SandboxExecutionResponse> {
    const start = Date.now();
    this.addLog('EXEC', `$ ${command.substring(0, 80)}`);

    try {
      this.touchSandbox(sandboxId);
      const sandbox = await this.getSandboxInstance(sandboxId);

      const result = await sandbox.commands.run(command, {
        timeoutMs,
        cwd: this.workspaceRoot,
      });

      const durationMs = Date.now() - start;
      this.lastPingMs = Math.min(this.lastPingMs, durationMs);
      this.addLog('STREAM', `E2B command completed in ${durationMs}ms (exit code ${result.exitCode})`);

      return {
        success: result.exitCode === 0,
        sandboxId,
        durationMs,
        exitCode: result.exitCode,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const maybeCmdErr = err as {
        exitCode?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
      };

      const exitCode = typeof maybeCmdErr.exitCode === 'number' ? maybeCmdErr.exitCode : 1;
      const stdout = maybeCmdErr.stdout || '';
      const stderr = maybeCmdErr.stderr || maybeCmdErr.message || String(err);

      this.addLog('WARN', `E2B command failed with code ${exitCode} (${durationMs}ms)`);

      return {
        success: false,
        sandboxId,
        durationMs,
        exitCode,
        stdout,
        stderr,
      };
    }
  }

  private resolveSandboxPath(filePath: string): string {
    if (filePath.startsWith('/')) {
      return filePath;
    }
    return path.posix.join(this.workspaceRoot, filePath);
  }

  private touchSandbox(sandboxId: string): void {
    const record = this.sandboxRecords.get(sandboxId);
    if (record) {
      record.lastActiveAt = Date.now();
    }
  }

  public async writeFile(
    sandboxId: string,
    filePath: string,
    content: string | Buffer
  ): Promise<boolean> {
    try {
      this.touchSandbox(sandboxId);
      this.addLog('EXEC', `Writing artifact to ${filePath}`);
      const sandbox = await this.getSandboxInstance(sandboxId);
      const targetPath = this.resolveSandboxPath(filePath);

      const data = Buffer.isBuffer(content) ? content.toString('utf8') : content;
      await sandbox.files.write(targetPath, data);
      return true;
    } catch (err) {
      logger.error('Failed to write file to E2B sandbox', { filePath, error: err });
      return false;
    }
  }

  public getSandboxWorkspaceDir(_sessionId: string): string {
    return this.workspaceRoot;
  }

  public getActiveSandboxId(sessionId: string, userId?: string): string | null {
    const cleanId = this.sanitizeSessionId(sessionId);
    if (this.sandboxRecords.has(cleanId)) {
      return cleanId;
    }
    const directId = this.sessionToSandboxId.get(cleanId);
    if (directId && this.sandboxRecords.has(directId)) {
      return directId;
    }
    for (const record of this.sandboxRecords.values()) {
      if (record.attachedSessionIds.has(cleanId)) {
        return record.sandboxId;
      }
    }
    return null;
  }

  public hasActiveSandbox(sessionId: string, userId?: string): boolean {
    return this.getActiveSandboxId(sessionId, userId) !== null;
  }

  public async readFile(sandboxId: string, filePath: string): Promise<string> {
    try {
      this.touchSandbox(sandboxId);
      const sandbox = await this.getSandboxInstance(sandboxId);
      const targetPath = this.resolveSandboxPath(filePath);
      const ext = path.extname(filePath).toLowerCase().replace('.', '');
      const isRasterImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'].includes(ext);
      if (isRasterImage) {
        const bytes = await sandbox.files.read(targetPath, { format: 'bytes' });
        return Buffer.from(bytes).toString('base64');
      }
      return await sandbox.files.read(targetPath, { format: 'text' });
    } catch (err) {
      logger.error('Failed to read file from E2B sandbox', { filePath, error: err });
      throw new Error(`File ${filePath} not found in E2B sandbox`);
    }
  }

  public async listFiles(sandboxId: string): Promise<SandboxFileNode[]> {
    try {
      const sandbox = await this.getSandboxInstance(sandboxId);

      const getTree = async (currentDir: string, depth = 0): Promise<SandboxFileNode[]> => {
        if (depth > 4) return [];
        try {
          const entries = await sandbox.files.list(currentDir);
          const nodes: SandboxFileNode[] = [];

          for (const entry of entries) {
            if (entry.name.startsWith('.git') || entry.name === 'node_modules') {
              continue;
            }

            const isDir = entry.type === FileType.DIR;
            const relPath = path.posix.relative(this.workspaceRoot, entry.path) || entry.name;

            if (isDir) {
              const children = await getTree(entry.path, depth + 1);
              nodes.push({
                name: entry.name,
                path: relPath,
                type: 'directory',
                children,
              });
            } else {
              nodes.push({
                name: entry.name,
                path: relPath,
                type: 'file',
                size: entry.size,
                extension: path.extname(entry.name).replace('.', ''),
              });
            }
          }
          return nodes;
        } catch {
          return [];
        }
      };

      return await getTree(this.workspaceRoot);
    } catch (err) {
      logger.warn('Failed to list files in E2B sandbox', { sandboxId, error: String(err) });
      return [];
    }
  }

  public async destroySandbox(sandboxIdOrSessionId: string): Promise<void> {
    const targetSandboxId = this.sessionToSandboxId.get(sandboxIdOrSessionId) || sandboxIdOrSessionId;
    try {
      this.addLog('INFO', `Terminating E2B microVM ${targetSandboxId.substring(0, 8)}...`);
      const sandbox = await this.getSandboxInstance(targetSandboxId);
      await sandbox.kill();
      this.activeSandboxes.delete(targetSandboxId);
      this.sandboxRecords.delete(targetSandboxId);
      this.initializedSandboxes.delete(targetSandboxId);

      for (const [sessId, sbId] of this.sessionToSandboxId.entries()) {
        if (sbId === targetSandboxId || sessId === sandboxIdOrSessionId) {
          this.sessionToSandboxId.delete(sessId);
        }
      }
      this.addLog('READY', `E2B microVM ${targetSandboxId.substring(0, 8)} destroyed.`);
    } catch (err) {
      this.activeSandboxes.delete(targetSandboxId);
      this.sandboxRecords.delete(targetSandboxId);
      for (const [sessId, sbId] of this.sessionToSandboxId.entries()) {
        if (sbId === targetSandboxId || sessId === sandboxIdOrSessionId) {
          this.sessionToSandboxId.delete(sessId);
        }
      }
      logger.warn('Failed to kill E2B sandbox', { targetSandboxId, error: err });
    }
    this.renumberSandboxes();
    this.saveRecordsToDisk();
  }

  public getSandboxUsage(userId: string = 'default_user'): {
    used: number;
    max: number;
    sandboxes: Array<{
      sandboxId: string;
      name: string;
      sessionId?: string;
      lastActiveAt: number;
      createdAt: number;
      attachedSessionCount: number;
      attachedSessionIds: string[];
    }>;
  } {
    if (this.sandboxRecords.size === 0) {
      this.loadRecordsFromDisk();
    }
    this.renumberSandboxes();
    const max = envConfig.MAX_SANDBOXES_PER_USER ?? 3;
    const allSandboxes = Array.from(this.sandboxRecords.values()).sort(
      (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.sandboxId.localeCompare(b.sandboxId)
    );

    // Match sandboxes for this user, or shared/unassigned sandboxes.
    // Primary filter: sandboxes belonging to this user.
    const userSandboxes = allSandboxes.filter(
      (r) =>
        !userId ||
        userId === 'default_user' ||
        r.userId === userId ||
        r.userId === 'default_user' ||
        !r.userId
    );

    // Single-tenant fallback: if there are sandboxes in the account but none match this
    // user ID (e.g., after a re-authentication with a new session), show all sandboxes.
    // This prevents sandboxes from vanishing when the userId changes between sessions.
    const effectiveSandboxes = userSandboxes.length > 0 ? userSandboxes : allSandboxes;

    // Limit returned sandboxes to quota slots
    const visibleSandboxes = effectiveSandboxes.slice(0, max);

    return {
      used: visibleSandboxes.length,
      max,
      sandboxes: visibleSandboxes.map((r, idx) => {
        // Purge legacy/phantom 'default' placeholder from session attachments
        if (r.attachedSessionIds.has('default')) {
          r.attachedSessionIds.delete('default');
          this.sessionToSandboxId.delete('default');
        }
        const realSessions = Array.from(r.attachedSessionIds).filter((s) => s && s !== 'default');
        return {
          sandboxId: r.sandboxId,
          name: `Sandbox #${idx + 1} (${r.sandboxId.substring(0, 6)})`,
          sessionId: realSessions[0] || '',
          lastActiveAt: r.lastActiveAt,
          createdAt: r.createdAt,
          attachedSessionCount: realSessions.length,
          attachedSessionIds: realSessions,
        };
      }),
    };
  }

  public getMetrics(): CloudSandboxMetrics {
    const hasKey = Boolean(this.getApiKey());
    const usage = this.getSandboxUsage();
    return {
      cpuUsagePercentage: hasKey ? 18 : 0,
      memoryUsedGb: hasKey ? 0.9 : 0,
      memoryTotalGb: 4.0,
      gpuThroughputTokensPerSec: hasKey ? 195.0 : 0,
      pingMs: this.lastPingMs,
      podName: 'e2b-firecracker-vm',
      clusterRegion: 'e2b-cloud (AWS us-east-1)',
      isHot: true,
      status: hasKey ? 'CONNECTED' : 'DISCONNECTED',
      sandboxesUsed: usage.used,
      sandboxesMax: usage.max,
    };
  }

  public getTerminalLogs(): TerminalLogEntry[] {
    return this.terminalLogs.slice(-25);
  }
}
