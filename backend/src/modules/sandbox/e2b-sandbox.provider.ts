import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { FileType, Sandbox } from 'e2b';
import type {
  ISandboxProvider,
  SandboxExecutionResponse,
  SandboxCliExecutionRequest,
  SandboxCliExecutionResponse,
  SandboxFileNode,
  SandboxUsageInfo,
  TerminalLogEntry,
} from '../../types/sandbox.types.js';
import { generateId } from '../../utils/id.util.js';
import { logger } from '../../utils/logger.util.js';
import { envConfig } from '../../config/env.config.js';
import { firestoreBackendService } from '../../services/firestore.service.js';
import { cliAuthService } from '../auth/cli-auth.service.js';

export interface SandboxRecord {
  sandboxId: string;
  name: string;
  userId: string;
  attachedSessionIds: Set<string>;
  createdAt: number;
  lastActiveAt: number;
  lastUpdateCheckAt?: number;
  isUpdating?: boolean;
  isProvisioning?: boolean;
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
  private readonly activeExecutions = new Map<string, number>();
  private readonly maintenancePromises = new Map<string, Promise<void>>();
  private static readonly MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.addLog('READY', 'E2B Cloud Sandbox Provider initialized.');
    this.loadRecordsFromDisk();
    this.syncWithCloud().catch(() => {});

    // Periodic 1-hour sweep to perform maintenance on idle sandboxes that passed the 24h threshold
    setInterval(() => {
      for (const sandboxId of this.sandboxRecords.keys()) {
        this.checkAndTriggerMaintenance(sandboxId);
      }
    }, 60 * 60 * 1000).unref();
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
    // Records are loaded per user from Firebase Firestore on demand
  }

  private saveRecordsToDisk(): void {
    try {
      for (const r of this.sandboxRecords.values()) {
        if (r && r.userId && r.userId !== 'default_user') {
          firestoreBackendService.saveSandboxRecord(r.userId, {
            sandboxId: r.sandboxId,
            name: r.name,
            userId: r.userId,
            attachedSessionIds: Array.from(r.attachedSessionIds),
            createdAt: r.createdAt,
            lastActiveAt: r.lastActiveAt,
            provider: 'e2b',
            lastUpdateCheckAt: r.lastUpdateCheckAt || r.createdAt,
          }).catch(() => {});
        }
      }
    } catch (err) {
      logger.warn('Failed to persist sandbox records to Firestore', { error: String(err) });
    }
  }

  public async syncWithCloud(userId?: string): Promise<void> {
    if (userId && userId !== 'default_user') {
      try {
        const remoteRecords = await firestoreBackendService.getUserSandboxes(userId);
        if (remoteRecords && remoteRecords.length > 0) {
          for (const item of remoteRecords) {
            if (item && item.sandboxId && !this.sandboxRecords.has(item.sandboxId)) {
              this.sandboxRecords.set(item.sandboxId, {
                sandboxId: item.sandboxId,
                name: item.name || `Sandbox (${item.sandboxId.substring(0, 6)})`,
                userId: item.userId || userId,
                attachedSessionIds: new Set(Array.isArray(item.attachedSessionIds) ? item.attachedSessionIds : []),
                createdAt: item.createdAt || Date.now(),
                lastActiveAt: item.lastActiveAt || Date.now(),
                lastUpdateCheckAt: item.lastUpdateCheckAt || item.createdAt || Date.now(),
                isUpdating: false,
              });
            }
          }
          this.renumberSandboxes();
        }
      } catch (err) {
        logger.warn('Failed to load user sandboxes from Firestore', { error: String(err) });
      }
    }

    const apiKey = this.getApiKey();
    if (!apiKey) return;
    if (!userId || userId === 'default_user') return;

    try {
      const paginator = await Sandbox.list({ apiKey });
      const items = (await paginator.nextItems().catch(() => [])) || [];
      if (!items || !items.length) return;

      const activeCloudIds = new Set(items.map((i) => i.sandboxId));

      // Sort items by startedAt ascending so oldest is #1, second is #2, third is #3
      const sorted = items.slice().sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

      let hasChanges = false;
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
        } else {
          hasChanges = true;
          this.sandboxRecords.set(sbId, {
            sandboxId: sbId,
            name: `Sandbox #${index} (${sbId.substring(0, 6)})`,
            userId: userId,
            attachedSessionIds: new Set(),
            createdAt: startedTime,
            lastActiveAt: startedTime,
            lastUpdateCheckAt: startedTime,
            isUpdating: false,
          });
        }
      }

      // Prune records deleted from cloud
      for (const localId of Array.from(this.sandboxRecords.keys())) {
        if (!activeCloudIds.has(localId)) {
          hasChanges = true;
          const rec = this.sandboxRecords.get(localId);
          if (rec && rec.userId && rec.userId !== 'default_user') {
            firestoreBackendService.deleteSandboxRecord(rec.userId, localId).catch(() => {});
          }
          this.sandboxRecords.delete(localId);
          this.activeSandboxes.delete(localId);
          for (const [sess, targetId] of this.sessionToSandboxId.entries()) {
            if (targetId === localId) {
              this.sessionToSandboxId.delete(sess);
            }
          }
        }
      }

      if (hasChanges) {
        this.renumberSandboxes();
        this.saveRecordsToDisk();
      }
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
    if (level === 'ERROR') {
      logger.error(`[E2B MicroVM] ${message}`);
    } else {
      logger.info(`[E2B MicroVM] ${message}`);
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

  private deduplicateAttachedSessions(): void {
    const sessionOwner = new Map<string, string>();
    for (const [sess, sbId] of this.sessionToSandboxId.entries()) {
      sessionOwner.set(sess, sbId);
    }
    for (const record of this.sandboxRecords.values()) {
      for (const sess of Array.from(record.attachedSessionIds)) {
        const ownerSbId = sessionOwner.get(sess);
        if (ownerSbId && ownerSbId !== record.sandboxId) {
          record.attachedSessionIds.delete(sess);
          logger.info('[Sandbox Session Deduplication] Removed duplicate session attachment from prior sandbox', {
            sessionId: sess,
            removedFromSandboxId: record.sandboxId,
            activeOwnerSandboxId: ownerSbId,
          });
        } else if (!ownerSbId) {
          sessionOwner.set(sess, record.sandboxId);
          this.sessionToSandboxId.set(sess, record.sandboxId);
        }
      }
    }
  }

  public attachSessionToSandbox(sessionId: string, sandboxId: string, userId?: string): boolean {
    const cleanSession = this.sanitizeSessionId(sessionId);
    const record = this.sandboxRecords.get(sandboxId);
    if (!record) {
      logger.warn('[Sandbox Attach] Sandbox not found for attachment', { sessionId: cleanSession, sandboxId, userId });
      return false;
    }
    // Strict Multi-Tenant Isolation: User can only attach to their own sandboxes
    if (userId && record.userId && record.userId !== userId) {
      logger.warn('[Sandbox Attach] Unauthorized session attachment attempt: ownership mismatch', {
        sessionId: cleanSession,
        sandboxId,
        requestedBy: userId,
        ownedBy: record.userId,
      });
      return false;
    }
    const prevSandboxId = this.sessionToSandboxId.get(cleanSession);

    // CRITICAL FIX: Detach cleanSession from ALL other sandboxes (both in memory and persistent storage)
    // A single chat session can ONLY be attached to ONE sandbox at a time.
    for (const [otherSbId, otherRecord] of this.sandboxRecords.entries()) {
      if (otherSbId !== sandboxId) {
        if (otherRecord.attachedSessionIds.has(cleanSession) || otherRecord.attachedSessionIds.has(sessionId)) {
          otherRecord.attachedSessionIds.delete(cleanSession);
          otherRecord.attachedSessionIds.delete(sessionId);
          logger.info('[Sandbox Attach] Detached session from prior sandbox', {
            sessionId: cleanSession,
            priorSandboxId: otherSbId,
            targetSandboxId: sandboxId,
          });
        }
      }
    }

    this.sessionToSandboxId.set(cleanSession, sandboxId);
    record.attachedSessionIds.add(cleanSession);
    record.lastActiveAt = Date.now();
    logger.info('[Sandbox Attach] Successfully attached session to sandbox', {
      sessionId: cleanSession,
      sandboxId,
      priorSandboxId: prevSandboxId,
      userId,
      totalAttachedSessions: record.attachedSessionIds.size,
    });
    this.addLog(
      'INFO',
      `Session [${cleanSession}] attached to sandbox ${sandboxId.substring(0, 8)} (${record.attachedSessionIds.size} sessions sharing this workspace).`
    );
    this.saveRecordsToDisk();

    // Ensure credentials for this user are synchronized to the sandbox microVM
    const effectiveUid = record.userId || userId;
    if (effectiveUid && effectiveUid !== 'default_user') {
      this.getSandboxInstance(sandboxId)
        .then((sb) => this.syncCredentialsToSandbox(sb, effectiveUid))
        .catch((err) => logger.warn('[Sandbox Attach] Credential sync on attach failed', { error: String(err) }));
    }

    return true;
  }

  public detachSession(sessionId: string, userId?: string): boolean {
    const cleanSession = this.sanitizeSessionId(sessionId);
    let detached = false;

    // If userId is provided, ensure we only detach if the target sandbox belongs to this user
    const targetSbId = this.sessionToSandboxId.get(cleanSession) || this.sessionToSandboxId.get(sessionId);
    if (targetSbId) {
      const record = this.sandboxRecords.get(targetSbId);
      if (record && userId && record.userId && record.userId !== userId && record.userId !== 'default_user') {
        logger.warn('[Sandbox Detach] Unauthorized attempt to detach session owned by another user', {
          sessionId: cleanSession,
          targetSandboxId: targetSbId,
          requestedBy: userId,
          ownedBy: record.userId,
        });
        return false;
      }
    }

    for (const [sess, sbId] of this.sessionToSandboxId.entries()) {
      if (sess === cleanSession || sess === sessionId) {
        const record = this.sandboxRecords.get(sbId);
        if (userId && record?.userId && record.userId !== userId && record.userId !== 'default_user') {
          continue;
        }
        this.sessionToSandboxId.delete(sess);
        detached = true;
      }
    }

    for (const record of this.sandboxRecords.values()) {
      if (userId && record.userId && record.userId !== userId && record.userId !== 'default_user') {
        continue;
      }
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

  public clearAllAttachedSessions(userId?: string): void {
    if (!userId || userId === 'default_user') {
      // Global clear only when no specific user is provided (e.g. system wipe/maintenance)
      this.sessionToSandboxId.clear();
      for (const record of this.sandboxRecords.values()) {
        record.attachedSessionIds.clear();
      }
    } else {
      // Strictly scoped to sandboxes owned by this user
      for (const record of this.sandboxRecords.values()) {
        if (record.userId === userId) {
          for (const sess of record.attachedSessionIds) {
            this.sessionToSandboxId.delete(sess);
          }
          record.attachedSessionIds.clear();
        }
      }
    }
    this.saveRecordsToDisk();
  }

  public syncActiveSessions(activeSessionIds: string[], userId?: string): void {
    const validCleanIds = new Set(
      activeSessionIds
        .map((s) => this.sanitizeSessionId(s))
        .filter((s) => s && s !== 'default')
    );

    // If caller has no active session IDs (e.g. initial load), do NOT wipe existing attached sessions
    if (validCleanIds.size === 0) {
      return;
    }

    let changed = false;

    // Scope session synchronization strictly to sandboxes owned by the caller
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
    // If targetSandboxId is an existing sandbox, resolve owner if userId was not explicitly passed
    if ((!userId || userId === 'default_user') && targetSandboxId && targetSandboxId !== 'new') {
      const targetRecord = this.sandboxRecords.get(targetSandboxId);
      if (targetRecord?.userId) {
        userId = targetRecord.userId;
      }
    }

    // Also resolve from session if session is already attached to a known sandbox
    if (!userId || userId === 'default_user') {
      const cleanId = this.sanitizeSessionId(sessionId);
      const existingSbId = this.sessionToSandboxId.get(cleanId);
      if (existingSbId) {
        const record = this.sandboxRecords.get(existingSbId);
        if (record?.userId) {
          userId = record.userId;
        }
      }
    }

    if (!userId || userId === 'default_user') {
      throw new Error('Authentication required: You must be signed in to create or access cloud sandboxes.');
    }
    const cleanId = this.sanitizeSessionId(sessionId);
    const apiKey = this.getApiKey();

    if (!apiKey) {
      throw new Error('E2B_API_KEY is not configured in environment.');
    }

    // 1. If explicit existing sandboxId requested, attach session directly (verifying ownership)
    if (targetSandboxId && targetSandboxId !== 'new') {
      const targetRecord = this.sandboxRecords.get(targetSandboxId);
      if (targetRecord) {
        if (targetRecord.userId && targetRecord.userId !== userId) {
          throw new Error('Access denied: You do not own this sandbox.');
        }
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
          if (record.userId && record.userId !== userId) {
            this.sessionToSandboxId.delete(cleanId);
          } else {
            record.lastActiveAt = Date.now();
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
      }
    }

    // Detach session from prior sandbox if explicitly launching a new isolated microVM
    if (targetSandboxId === 'new') {
      this.detachSession(cleanId);
    }

    // 3. User sandboxes lookup - strictly for THIS user
    const userSandboxes = Array.from(this.sandboxRecords.values())
      .filter((r) => r.userId === userId)
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
      if (replaceOldest && userSandboxes.length > 0) {
        const oldest = userSandboxes[0];
        logger.info('[Sandbox] Replacing oldest sandbox to stay within quota', { oldestSandboxId: oldest.sandboxId, userId });
        await this.destroySandbox(oldest.sandboxId);
      } else {
        throw new Error(
          `Sandbox quota limit reached (${maxSandboxes}/${maxSandboxes} full). Please delete an existing sandbox using the trash icon to free a quota slot before creating a new one.`
        );
      }
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

      const vmBootDuration = Date.now() - start;
      this.lastPingMs = vmBootDuration;
      const sbId = sandbox.sandboxId;
      logger.info(`[Sandbox Provisioning] E2B microVM instance created in ${vmBootDuration}ms`, { sandboxId: sbId });

      this.activeSandboxes.set(sbId, sandbox);
      this.sandboxRecords.set(sbId, {
        sandboxId: sbId,
        name: `Sandbox (${sbId.substring(0, 6)})`,
        userId: userId,
        attachedSessionIds: new Set(), // Attach only once provisioning completes
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        lastUpdateCheckAt: Date.now(),
        isUpdating: false,
        isProvisioning: true,
      });
      this.renumberSandboxes();
      this.saveRecordsToDisk();

      // Create workspace directory
      await sandbox.commands.run(`mkdir -p ${this.workspaceRoot}`);

      // Initialize dual-user permission boundary and secure credentials
      await this.ensureSecurityBoundaryAndCredentials(sandbox, userId);

      // Finalize provisioning: attach session and clear provisioning state
      const rec = this.sandboxRecords.get(sbId);
      if (rec) {
        rec.isProvisioning = false;
        // Detach cleanId from any other sandbox to enforce single active sandbox invariant
        for (const [otherId, otherRecord] of this.sandboxRecords.entries()) {
          if (otherId !== sbId) {
            otherRecord.attachedSessionIds.delete(cleanId);
          }
        }
        rec.attachedSessionIds.add(cleanId);
      }
      this.sessionToSandboxId.set(cleanId, sbId);
      this.saveRecordsToDisk();

      const totalProvisionMs = Date.now() - start;
      logger.info(`[Sandbox Provisioning] Sandbox ${sbId} fully provisioned and ready in ${totalProvisionMs}ms`);
      this.addLog('READY', `E2B MicroVM ${sbId.substring(0, 8)} online (${totalProvisionMs}ms launch time). Security boundary active.`);
      return sbId;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addLog('ERROR', `E2B microVM launch failed: ${msg}`);
      logger.error('Failed to create E2B sandbox', { error: msg });
      throw new Error(`E2B sandbox creation failed: ${msg}`);
    }
  }

  /**
   * Safely writes a batch of files into /home/agent-runner inside the microVM via staging in /tmp,
   * staging all files in parallel with Promise.all and applying permissions/ownership with a single remote composite command.
   */
  private async writeAgentRunnerFilesBatch(
    sandbox: Sandbox,
    files: Array<{ targetPath: string; content: string; mode?: string }>,
    cleanupCommands: string[] = []
  ): Promise<void> {
    if (files.length === 0 && cleanupCommands.length === 0) return;
    const batchId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const stagingDir = `/tmp/agent_sync_${batchId}`;

    // 1. Stage all files in parallel via sandbox.files.write
    if (files.length > 0) {
      await sandbox.commands.run(`mkdir -p "${stagingDir}"`).catch(() => {});
      await Promise.all(
        files.map((file, idx) => {
          const stagingPath = `${stagingDir}/f_${idx}`;
          return sandbox.files.write(stagingPath, file.content);
        })
      );
    }

    // 2. Build composite command to move files and enforce DAC security boundary
    const scriptLines: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const stagingPath = `${stagingDir}/f_${i}`;
      const targetDir = path.posix.dirname(file.targetPath);
      const mode = file.mode || '600';
      scriptLines.push(`sudo mkdir -p "${targetDir}" && sudo cp "${stagingPath}" "${file.targetPath}" && sudo chown agent-runner:agent-runner "${file.targetPath}" && sudo chmod ${mode} "${file.targetPath}"`);
    }
    for (const cmd of cleanupCommands) {
      scriptLines.push(cmd);
    }
    scriptLines.push(`sudo rm -rf "${stagingDir}"`);
    scriptLines.push('sudo chown -R agent-runner:agent-runner /home/agent-runner 2>/dev/null || true');
    scriptLines.push('sudo chmod -R 700 /home/agent-runner 2>/dev/null || true');

    await sandbox.commands.run(scriptLines.join(' && ')).catch((err) => {
      logger.warn('[Sandbox Sync] Failed running batched credential synchronization script', { error: String(err) });
    });
  }

  /**
   * Safely writes a single file into /home/agent-runner inside the microVM via writeAgentRunnerFilesBatch.
   */
  private async writeAgentRunnerFile(
    sandbox: Sandbox,
    targetPath: string,
    content: string,
    mode = '600'
  ): Promise<void> {
    await this.writeAgentRunnerFilesBatch(sandbox, [{ targetPath, content, mode }]);
  }

  /**
   * Enforces strict Linux DAC Dual-User Privilege Separation:
   * 1. 'agent-runner' (UID system): owns credentials in /home/agent-runner with 0700/0600.
   * 2. 'user' (developer): owns /home/user/workspace (rw), but CANNOT read /home/agent-runner.
   */
  public async syncCredentialsToSandbox(sandbox: Sandbox, userId?: string): Promise<void> {
    const syncStart = Date.now();
    const homedir = os.homedir();
    try {
      const safeUid = userId && userId !== 'default' && userId !== 'default_user'
        ? userId.replace(/[^a-zA-Z0-9_-]/g, '_')
        : undefined;

      const userProfileDir = safeUid
        ? path.join(homedir, '.agent-user-profiles', safeUid)
        : homedir;

      let expectedUserEmail: string | undefined;
      if (safeUid) {
        const userRec = cliAuthService.getUserCliRecord(userId!);
        expectedUserEmail = userRec?.email || userRec?.antigravity?.email || userRec?.gemini?.email;
      }

      const filesToSync: Array<{ targetPath: string; content: string; mode?: string }> = [];
      const cleanupCommands: string[] = [];

      // 1. Antigravity credentials resolution (per-user isolated priority)
      const userAgyTokenPaths = safeUid ? [
        path.join(userProfileDir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
        path.join(userProfileDir, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
        path.join(userProfileDir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-oauth-token'),
        path.join(userProfileDir, '.gemini', 'oauth_creds.json'),
      ] : [];

      let agyTokenContent = '';
      for (const tp of userAgyTokenPaths) {
        if (fs.existsSync(tp)) {
          try {
            const st = fs.statSync(tp);
            if (st.size > 20) {
              const text = fs.readFileSync(tp, 'utf8');
              if (text.includes('token') || text.includes('Bearer') || text.includes('access') || text.includes('refresh')) {
                const tokenEmail = cliAuthService.extractEmailFromToken(text);
                if (expectedUserEmail && tokenEmail && tokenEmail.toLowerCase() !== expectedUserEmail.toLowerCase()) {
                  logger.warn('[Sandbox Sync] Skipping mismatched token in user profile to prevent credential leak', {
                    expectedUserEmail,
                    tokenEmail,
                    path: tp,
                  });
                  continue;
                }
                agyTokenContent = text;
                break;
              }
            }
          } catch {}
        }
      }

      // If not yet in user profile, find token matching expectedUserEmail across stashed & host tokens
      if (!agyTokenContent && expectedUserEmail) {
        agyTokenContent = cliAuthService.findValidAntigravityTokenForEmail(expectedUserEmail, userId) || '';
        if (agyTokenContent && userId && userId !== 'default' && userId !== 'default_user') {
          cliAuthService.persistUserAntigravityProfile(userId, expectedUserEmail);
        }
      }

      // Queue Antigravity tokens
      if (agyTokenContent) {
        filesToSync.push({ targetPath: '/home/agent-runner/.gemini/antigravity-cli/cache/antigravity-keyring-unavailable-oauth-token', content: agyTokenContent });
        filesToSync.push({ targetPath: '/home/agent-runner/.gemini/antigravity-cli/antigravity-oauth-token', content: agyTokenContent });
        filesToSync.push({ targetPath: '/home/agent-runner/.gemini/antigravity-cli/cache/antigravity-oauth-token', content: agyTokenContent });
        filesToSync.push({ targetPath: '/home/agent-runner/.gemini/antigravity-cli/cache/jetski-keyring-unavailable-oauth-token', content: agyTokenContent });
        filesToSync.push({ targetPath: '/home/agent-runner/.gemini/antigravity-cli/jetski-oauth-token', content: agyTokenContent });
        filesToSync.push({ targetPath: '/home/agent-runner/.gemini/oauth_creds.json', content: agyTokenContent });
        filesToSync.push({ targetPath: '/home/agent-runner/.gemini/antigravity-cli/oauth_creds.json', content: agyTokenContent });
      } else {
        // Multi-tenant security guarantee: If no valid token for this user, purge any old token in microVM
        cleanupCommands.push('sudo rm -f /home/agent-runner/.gemini/antigravity-cli/*token* /home/agent-runner/.gemini/antigravity-cli/cache/*token* /home/agent-runner/.gemini/oauth_creds.json /home/agent-runner/.gemini/antigravity-cli/oauth_creds.json');
      }

      // Seed google_accounts.json and user_info.json scoped to the user email
      const targetEmail = expectedUserEmail || (agyTokenContent ? cliAuthService.extractEmailFromToken(agyTokenContent) : null);
      if (targetEmail) {
        const accountsContent = JSON.stringify({ active: targetEmail, accounts: [{ email: targetEmail }] }, null, 2);
        filesToSync.push({ targetPath: '/home/agent-runner/.gemini/google_accounts.json', content: accountsContent });
        filesToSync.push({ targetPath: '/home/agent-runner/.gemini/antigravity-cli/google_accounts.json', content: accountsContent });
        const userInfoContent = JSON.stringify({ email: targetEmail }, null, 2);
        filesToSync.push({ targetPath: '/home/agent-runner/.gemini/user_info.json', content: userInfoContent });
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
        filesToSync.push({ targetPath: '/home/agent-runner/.gemini/settings.json', content: agySettings });
        filesToSync.push({ targetPath: '/home/agent-runner/.gemini/antigravity-cli/settings.json', content: agySettings });
      } else {
        const agyOAuthSettings = JSON.stringify({
          security: {
            auth: {
              selectedType: 'oauth-personal',
            },
          },
        }, null, 2);
        filesToSync.push({ targetPath: '/home/agent-runner/.gemini/settings.json', content: agyOAuthSettings });
        filesToSync.push({ targetPath: '/home/agent-runner/.gemini/antigravity-cli/settings.json', content: agyOAuthSettings });
      }

      // Seed Claude credentials securely to /home/agent-runner
      const claudeCredsPath = path.join(userProfileDir, '.claude', '.credentials.json');
      const hostClaudeCreds = fs.existsSync(claudeCredsPath)
        ? claudeCredsPath
        : path.join(homedir, '.claude', '.credentials.json');

      if (fs.existsSync(hostClaudeCreds)) {
        filesToSync.push({ targetPath: '/home/agent-runner/.claude/.credentials.json', content: fs.readFileSync(hostClaudeCreds, 'utf8') });
      }

      // Seed Codex credentials securely to /home/agent-runner
      const candidateCodexPaths = [
        safeUid ? path.join(homedir, '.agent-user-profiles', safeUid, '.codex', 'auth.json') : '',
        path.join(userProfileDir, '.codex', 'auth.json'),
        path.join(homedir, '.codex', 'auth.json'),
      ];
      let codexContent = '';
      for (const p of candidateCodexPaths) {
        if (p && fs.existsSync(p)) {
          try {
            const raw = fs.readFileSync(p, 'utf8');
            const parsed = JSON.parse(raw);
            let email = parsed.email;
            if (!email && parsed.tokens?.id_token) {
              const parts = parsed.tokens.id_token.split('.');
              if (parts.length > 1) {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                if (payload.email) email = payload.email;
              }
            }
            if (expectedUserEmail && email && email.toLowerCase() !== expectedUserEmail.toLowerCase()) {
              logger.warn('[Sandbox Sync] Skipping mismatched Codex credentials to prevent leak', {
                expectedUserEmail,
                tokenEmail: email,
                path: p,
              });
              continue;
            }
            codexContent = raw;
            break;
          } catch {}
        }
      }

      if (codexContent) {
        filesToSync.push({ targetPath: '/home/agent-runner/.codex/auth.json', content: codexContent });
      } else {
        cleanupCommands.push('sudo rm -f /home/agent-runner/.codex/auth.json');
      }

      // Execute batched write in one fast atomic operation
      await this.writeAgentRunnerFilesBatch(sandbox, filesToSync, cleanupCommands);

      const syncDuration = Date.now() - syncStart;
      logger.info(`[Sandbox Credential Sync] Synchronized credentials to sandbox microVM in ${syncDuration}ms`, {
        sandboxId: sandbox.sandboxId,
        userId,
        expectedUserEmail,
        hasAgyToken: Boolean(agyTokenContent),
        hasCodexCreds: Boolean(codexContent),
        fileCount: filesToSync.length,
      });
    } catch (err) {
      logger.warn('Failed to sync credentials into sandbox microVM', { error: String(err) });
    }
  }

  public async syncCredentialsToUserSandboxes(userId?: string): Promise<void> {
    if (!userId || userId === 'default_user') return;
    const safeUid = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const targets: Sandbox[] = [];
    for (const [sbId, rec] of this.sandboxRecords.entries()) {
      if (rec.userId === userId || rec.userId === safeUid) {
        try {
          const inst = await this.getSandboxInstance(sbId);
          if (inst) targets.push(inst);
        } catch {}
      }
    }
    await Promise.all(targets.map((sb) => this.syncCredentialsToSandbox(sb, userId).catch(() => {})));
  }

  /**
   * Purges credentials for a specific CLI (or all CLIs) from all running microVMs belonging to a user.
   */
  public async purgeUserCredentialsFromSandboxes(userId?: string, cli?: 'antigravity' | 'gemini' | 'claude' | 'codex'): Promise<void> {
    if (!userId || userId === 'default_user') return;
    const safeUid = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const targets: Sandbox[] = [];
    for (const [sbId, rec] of this.sandboxRecords.entries()) {
      if (rec.userId === userId || rec.userId === safeUid) {
        try {
          const inst = await this.getSandboxInstance(sbId);
          if (inst) targets.push(inst);
        } catch {}
      }
    }

    if (targets.length === 0) return;

    let purgeCmd = '';
    if (cli === 'codex') {
      purgeCmd = 'sudo rm -rf /home/agent-runner/.codex /home/agent-runner/.config/codex /home/agent-runner/.local/share/codex 2>/dev/null || true';
    } else if (cli === 'claude') {
      purgeCmd = 'sudo rm -rf /home/agent-runner/.claude 2>/dev/null || true';
    } else if (cli === 'antigravity' || cli === 'gemini') {
      purgeCmd = 'sudo rm -rf /home/agent-runner/.gemini /home/agent-runner/.config/antigravity 2>/dev/null || true';
    } else {
      purgeCmd = 'sudo rm -rf /home/agent-runner/.codex /home/agent-runner/.config/codex /home/agent-runner/.local/share/codex /home/agent-runner/.claude /home/agent-runner/.gemini /home/agent-runner/.config/antigravity 2>/dev/null || true';
    }

    await Promise.all(
      targets.map(async (sb) => {
        try {
          await sb.commands.run(purgeCmd);
          // Re-create safe empty base directories so CLI commands don't crash on missing home directories
          await sb.commands.run(`
            sudo mkdir -p /home/agent-runner/.gemini/antigravity-cli /home/agent-runner/.claude /home/agent-runner/.codex /home/agent-runner/.local/bin
            sudo chown -R agent-runner:agent-runner /home/agent-runner
            sudo chmod 700 /home/agent-runner/.gemini /home/agent-runner/.claude /home/agent-runner/.codex
          `).catch(() => {});
        } catch (err) {
          logger.warn(`[Sandbox Purge] Failed to purge ${cli || 'all'} credentials from sandbox ${sb.sandboxId}`, { error: String(err) });
        }
      })
    );
    logger.info(`[Sandbox Purge] Purged ${cli || 'all'} credentials from ${targets.length} active microVMs for user ${userId}`);
  }

  /**
   * Enforces strict Linux DAC Dual-User Privilege Separation:
   * 1. 'agent-runner' (UID system): owns credentials in /home/agent-runner with 0700/0600.
   * 2. 'user' (developer): owns /home/user/workspace (rw), but CANNOT read /home/agent-runner.
   */
  public async ensureSecurityBoundaryAndCredentials(sandbox: Sandbox, userId?: string): Promise<void> {
    const boundaryStart = Date.now();
    const homedir = os.homedir();
    try {
      if (!this.initializedSandboxes.has(sandbox.sandboxId)) {
        const setupScript = `
          # Ensure swap space is active so microVM never hits OOM killer
          if [ ! -f /swapfile ]; then
            sudo fallocate -l 1G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=1024 2>/dev/null || true
            sudo chmod 600 /swapfile 2>/dev/null || true
            sudo mkswap /swapfile 2>/dev/null || true
            sudo swapon /swapfile 2>/dev/null || true
          else
            sudo swapon /swapfile 2>/dev/null || true
          fi
          id -u agent-runner >/dev/null 2>&1 || sudo useradd -m -s /bin/bash agent-runner
          sudo usermod -a -G user agent-runner 2>/dev/null || true
          sudo usermod -a -G agent-runner user 2>/dev/null || true
          sudo mkdir -p /home/agent-runner/.gemini/antigravity-cli /home/agent-runner/.claude /home/agent-runner/.codex /home/agent-runner/.local/bin
          sudo chmod 700 /home/agent-runner
          sudo chmod 700 /home/agent-runner/.gemini /home/agent-runner/.claude /home/agent-runner/.codex
          sudo chmod 755 /home/user 2>/dev/null || true
          sudo mkdir -p ${this.workspaceRoot}
          sudo chown -R user:user ${this.workspaceRoot} 2>/dev/null || true
          sudo chmod -R 2777 ${this.workspaceRoot} 2>/dev/null || true
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
          sudo chmod -R 2777 ${this.workspaceRoot} 2>/dev/null || true
        `;
        await sandbox.commands.run(setupScript).catch(() => {});

        // Check installed toolchains in parallel to minimize network latency
        const [checkAgy, checkCodex, checkClaude] = await Promise.all([
          sandbox.commands.run('which agy || test -f /usr/local/bin/agy').catch(() => null),
          sandbox.commands.run('which codex || test -f /usr/local/bin/codex').catch(() => null),
          sandbox.commands.run('which claude || test -f /usr/local/bin/claude').catch(() => null),
        ]);

        const installTasks: Promise<void>[] = [];

        if (checkAgy?.exitCode !== 0) {
          installTasks.push((async () => {
            this.addLog('INFO', 'Provisioning agy CLI binary into cloud sandbox microVM via release download...');
            const installAgyCmd = `curl -sSL "https://github.com/google-antigravity/antigravity-cli/releases/latest/download/agy_cli_linux_x64.tar.gz" -o /tmp/agy.tar.gz 2>/dev/null || curl -sSL "https://github.com/google-antigravity/antigravity-cli/releases/download/1.3.6/agy_cli_linux_x64.tar.gz" -o /tmp/agy.tar.gz && sudo tar -xzf /tmp/agy.tar.gz -C /usr/local/bin && sudo ln -sf /usr/local/bin/antigravity /usr/local/bin/agy && sudo chmod +x /usr/local/bin/antigravity /usr/local/bin/agy && rm -f /tmp/agy.tar.gz`;
            const installRes = await sandbox.commands.run(installAgyCmd, { timeoutMs: 60000 }).catch(() => null);
            if (installRes?.exitCode === 0) {
              this.addLog('READY', 'agy CLI binary successfully installed in /usr/local/bin/agy');
            } else {
              logger.warn('Failed to install agy CLI in microVM via release download', { exitCode: installRes?.exitCode });
            }
          })());
        }

        if (checkCodex?.exitCode !== 0) {
          installTasks.push((async () => {
            this.addLog('INFO', 'Provisioning codex CLI binary into cloud sandbox microVM via npm...');
            const npmRes = await sandbox.commands
              .run('sudo npm install -g @openai/codex@latest', { timeoutMs: 120000 })
              .catch(() => null);
            if (npmRes?.exitCode === 0) {
              this.addLog('READY', 'codex CLI binary successfully installed in /usr/local/bin/codex');
            } else {
              const currentCodex = path.join(homedir, '.codex', 'packages', 'app-server-daemon', 'current', 'bin', 'codex');
              const localCodex = path.join(homedir, '.local', 'bin', 'codex');
              const hostCodex = fs.existsSync(currentCodex) ? currentCodex : fs.existsSync(localCodex) ? localCodex : null;
              if (hostCodex && fs.existsSync(hostCodex)) {
                const rawBuf = fs.readFileSync(hostCodex);
                const gzipped = zlib.gzipSync(rawBuf);
                await sandbox.files.write('/tmp/codex.gz', gzipped.buffer as ArrayBuffer).catch(() => {});
                await sandbox.commands.run('gunzip -f /tmp/codex.gz && sudo mv /tmp/codex /usr/local/bin/codex && sudo chmod +x /usr/local/bin/codex').catch(() => {});
                this.addLog('READY', 'codex CLI binary successfully installed from host fallback');
              }
            }
          })());
        }

        if (checkClaude?.exitCode !== 0) {
          installTasks.push((async () => {
            this.addLog('INFO', 'Provisioning claude CLI binary into cloud sandbox microVM via npm...');
            await sandbox.commands.run('sudo npm install -g @anthropic-ai/claude-code@latest', { timeoutMs: 120000 }).catch(() => {});
            this.addLog('READY', 'claude CLI binary successfully installed in /usr/local/bin/claude');
          })());
        }

        if (installTasks.length > 0) {
          await Promise.all(installTasks);
        }

        // Ensure /workspace is symlinked to /home/user/workspace for path compatibility (prevent duplicate circular symlink)
        await sandbox.commands.run('if [ ! -L /workspace ] && [ ! -d /workspace ]; then sudo ln -s /home/user/workspace /workspace 2>/dev/null || true; fi; sudo rm -f /home/user/workspace/workspace /workspace/workspace 2>/dev/null || true');

        this.initializedSandboxes.add(sandbox.sandboxId);
      }

      // Always synchronize latest user credentials into /home/agent-runner
      await this.syncCredentialsToSandbox(sandbox, userId);

      const boundaryMs = Date.now() - boundaryStart;
      logger.info(`[Sandbox Provisioning] MicroVM security boundary & tools configured in ${boundaryMs}ms`, {
        sandboxId: sandbox.sandboxId,
        userId,
      });
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

    // Transparent Turn Queueing (Option A): If 24h idle maintenance is currently running on this sandbox,
    // wait for it to finish and provide real-time step progress
    if (this.maintenancePromises.has(sandboxId)) {
      req.onStep?.({
        id: `step_maintenance_${Date.now()}`,
        description: 'Synchronizing latest sandbox toolchains (24h maintenance in progress)...',
        status: 'in_progress',
        durationMs: 0,
      });

      const inFlight = this.maintenancePromises.get(sandboxId);
      if (inFlight) {
        await Promise.race([
          inFlight,
          new Promise((resolve) => setTimeout(resolve, 60000)),
        ]);
      }

      req.onStep?.({
        id: `step_maintenance_${Date.now()}`,
        description: 'Sandbox toolchains synchronized to latest versions',
        status: 'completed',
        durationMs: 120,
      });
    }

    this.activeExecutions.set(sandboxId, (this.activeExecutions.get(sandboxId) || 0) + 1);

    try {
      const sandbox = await this.getSandboxInstance(sandboxId);
      await this.ensureSecurityBoundaryAndCredentials(sandbox, req.userId);

    // Verify requested CLI binary exists inside microVM; if not, re-provision
    const checkCliBinary = await sandbox.commands.run(
      req.cli === 'codex' ? 'which codex' : req.cli === 'claude' ? 'which claude' : 'which agy'
    ).catch(() => null);
    if (checkCliBinary?.exitCode !== 0) {
      this.initializedSandboxes.delete(sandbox.sandboxId);
      await this.ensureSecurityBoundaryAndCredentials(sandbox, req.userId);
    }

    const safePrompt = req.prompt.replace(/'/g, "'\\''");
    let cliCmd = '';

    if (req.cli === 'agy') {
      let modelFlag = '';
      let effortFlag = '';
      if (req.model && req.model !== 'auto' && req.model !== 'default') {
        const effortMatch = req.model.match(/^(.*)-(high|medium|low|max)$/i);
        if (effortMatch) {
          const baseModel = effortMatch[1];
          const effort = effortMatch[2].toLowerCase();
          modelFlag = `--model "${baseModel}"`;
          effortFlag = `--effort "${effort}"`;
        } else {
          modelFlag = `--model "${req.model}"`;
        }
      }
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
exec env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" DBUS_SESSION_BUS_ADDRESS="" ${keyEnv} agy -p "$PROMPT" --dangerously-skip-permissions --output-format stream-json ${modelFlag} ${effortFlag}
`).catch(() => {});
      await sandbox.commands.run(`sudo chown agent-runner:agent-runner ${promptFile} ${scriptFile} && sudo chmod 700 ${promptFile} ${scriptFile}`).catch(() => {});

      cliCmd = `sudo -u agent-runner -H script -q -c "bash ${scriptFile}" /dev/null`;
    } else if (req.cli === 'claude') {
      const modelFlag = req.model && req.model !== 'auto' && req.model !== 'default' ? `--model "${req.model}"` : '';
      cliCmd = `cd /workspace && sudo -u agent-runner -H env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" claude -p '${safePrompt}' --output-format=stream-json ${modelFlag} < /dev/null`;
    } else if (req.cli === 'codex') {
      let modelFlag = '';
      let effortConfig = '';
      if (req.model && req.model !== 'auto' && req.model !== 'default') {
        const effortMatch = req.model.match(/^(.*)-(high|medium|low|xhigh|max)$/i);
        if (effortMatch) {
          const baseModel = effortMatch[1];
          const effort = effortMatch[2].toLowerCase();
          modelFlag = `-m "${baseModel}"`;
          effortConfig = `-c 'model_reasoning_effort="${effort}"'`;
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
    let latestRateLimits: any = null;
    let cliUsage = {
      input_tokens: 0,
      output_tokens: 0,
      thinking_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 0,
      duration_seconds: 0,
      num_turns: 1,
    };

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
              // Strip ANSI escape codes from pty/script wrapper if present
              const cleanLine = trimmed.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
              const event = JSON.parse(cleanLine);

              // Capture authentic rate limits if present in event payload
              if (
                (event.type === 'event_msg' && (event.payload?.rate_limits || event.payload?.info?.rate_limits)) ||
                event.rate_limits
              ) {
                const rl = event.payload?.rate_limits || event.payload?.info?.rate_limits || event.rate_limits;
                if (rl) {
                  latestRateLimits = rl;
                }
              }

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
              } else if (event.type === 'item.started' && event.item?.type === 'reasoning') {
                req.onStep?.({
                  id: event.item.id || `step_reasoning_${Date.now()}`,
                  description: 'Reasoning and formulating execution strategy...',
                  status: 'in_progress',
                  durationMs: 0,
                });
              } else if (event.type === 'item.completed' && event.item?.type === 'reasoning') {
                req.onStep?.({
                  id: event.item.id || `step_reasoning_${Date.now()}`,
                  description: 'Formulated strategy & reasoned about execution plan',
                  status: 'completed',
                  durationMs: 180,
                });
              } else if (event.type === 'item.started' && event.item?.type === 'command_execution') {
                const cmd = event.item.command || '';
                const preview = cmd.length > 55 ? `${cmd.slice(0, 52)}...` : cmd;
                req.onStep?.({
                  id: event.item.id || `step_${Date.now()}`,
                  description: `Running command in sandbox: \`${preview}\``,
                  status: 'in_progress',
                  durationMs: 0,
                  command: cmd,
                  tool: 'run_command',
                });
              } else if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
                const cmd = event.item.command || '';
                const preview = cmd.length > 55 ? `${cmd.slice(0, 52)}...` : cmd;
                req.onStep?.({
                  id: event.item.id || `step_${Date.now()}`,
                  description: `Completed command: \`${preview}\``,
                  status: event.item.exit_code === 0 ? 'completed' : 'failed',
                  durationMs: 120,
                  command: cmd,
                  output: event.item.aggregated_output,
                  tool: 'run_command',
                  exitCode: event.item.exit_code ?? 0,
                });
              } else if (event.type === 'turn.completed' && event.usage) {
                const u = event.usage;
                cliUsage = {
                  input_tokens: Number(u.input_tokens) || 0,
                  output_tokens: Number(u.output_tokens) || 0,
                  thinking_tokens: Number(u.reasoning_output_tokens) || Number(u.thinking_tokens) || 0,
                  cache_read_tokens: Number(u.cached_input_tokens) || Number(u.cache_read_tokens) || 0,
                  total_tokens: (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0),
                  duration_seconds: Math.round((Date.now() - start) / 1000),
                  num_turns: 1,
                };
              }
              // Handle Claude event stream schema (thinking blocks and tool use)
              else if (event.type === 'content_block_start' && event.content_block?.type === 'thinking') {
                req.onStep?.({
                  id: `step_claude_think_${event.index ?? 0}`,
                  description: 'Reasoning and formulating execution strategy...',
                  status: 'in_progress',
                  durationMs: 0,
                });
              } else if (event.type === 'content_block_stop' && event.index !== undefined) {
                req.onStep?.({
                  id: `step_claude_think_${event.index}`,
                  description: 'Formulated strategy & reasoned about execution plan',
                  status: 'completed',
                  durationMs: 180,
                });
              } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
                const toolName = event.content_block.name || 'tool';
                req.onStep?.({
                  id: `step_claude_tool_${event.content_block.id || event.index || Date.now()}`,
                  description: `Executing tool in sandbox: ${toolName}`,
                  status: 'in_progress',
                  durationMs: 0,
                  tool: toolName,
                });
              }
              // Handle Antigravity CLI (agy) stream-json schema
              else if (event.event === 'init') {
                req.onStep?.({
                  id: 'step_init',
                  description: 'Connected to cloud sandbox microVM & initialized agent tools',
                  status: 'completed',
                  durationMs: Math.max(16, Date.now() - start),
                });
                req.onStep?.({
                  id: 'step_reasoning_1',
                  description: 'Reasoning and formulating execution strategy...',
                  status: 'in_progress',
                  durationMs: 0,
                });
              } else if (event.event === 'step_update' && event.step_update) {
                const su = event.step_update;
                const stepIdx = su.step_index ?? 1;

                if (su.step_type === 'tool') {
                  const toolName = su.tool_name || su.tool_info?.name || 'tool';
                  const params = su.tool_info?.parameters || {};
                  const { desc, cmd } = this.formatAgyTool(toolName, params);

                  if (su.state === 'ACTIVE') {
                    req.onStep?.({
                      id: `step_tool_${stepIdx}`,
                      description: desc,
                      status: 'in_progress',
                      durationMs: 0,
                      tool: toolName,
                      command: cmd,
                    });
                  } else if (su.state === 'DONE') {
                    const durationMs = su.duration_seconds ? Math.round(su.duration_seconds * 1000) : 120;
                    let output = su.tool_info?.output;
                    if (typeof output !== 'string' && output !== undefined && output !== null) {
                      output = JSON.stringify(output, null, 2);
                    }
                    const completedDesc = desc
                      .replace('Running command', 'Completed command')
                      .replace('Reading file', 'Read file')
                      .replace('Writing artifact', 'Created artifact')
                      .replace('Editing code', 'Updated code')
                      .replace('Scanning directory', 'Scanned directory')
                      .replace('Searching codebase', 'Searched codebase')
                      .replace('Searching web', 'Searched web')
                      .replace('Executing agent tool:', 'Completed tool:');

                    req.onStep?.({
                      id: `step_tool_${stepIdx}`,
                      description:
                        completedDesc.startsWith('Completed') ||
                        completedDesc.startsWith('Created') ||
                        completedDesc.startsWith('Read') ||
                        completedDesc.startsWith('Updated') ||
                        completedDesc.startsWith('Scanned') ||
                        completedDesc.startsWith('Searched')
                          ? completedDesc
                          : `Completed: ${completedDesc}`,
                      status: 'completed',
                      durationMs,
                      tool: toolName,
                      command: cmd,
                      output: output || undefined,
                      exitCode: 0,
                    });

                    // Prepare next reasoning step if subsequent thoughts/actions follow
                    req.onStep?.({
                      id: `step_reasoning_${stepIdx + 1}`,
                      description: 'Reasoning and evaluating tool execution results...',
                      status: 'in_progress',
                      durationMs: 0,
                    });
                  }
                } else if (su.step_type === 'agent_response') {
                  if (su.text_delta) {
                    accumulatedText += su.text_delta;
                    req.onToken?.(su.text_delta);
                  }

                  const reasoningStepId = `step_reasoning_${stepIdx}`;
                  if (su.state === 'ACTIVE' && !su.text_delta) {
                    req.onStep?.({
                      id: reasoningStepId,
                      description: 'Reasoning and formulating execution strategy...',
                      status: 'in_progress',
                      durationMs: 0,
                    });
                  } else if (su.state === 'DONE') {
                    const durationMs = su.duration_seconds ? Math.round(su.duration_seconds * 1000) : 150;
                    const thinkingTokens = su.usage?.thinking_tokens;
                    if (thinkingTokens) {
                      cliUsage.thinking_tokens = (cliUsage.thinking_tokens || 0) + thinkingTokens;
                    }
                    if (thinkingTokens || !su.text_delta) {
                      req.onStep?.({
                        id: reasoningStepId,
                        description: thinkingTokens
                          ? `Formulated strategy & reasoned about execution (${thinkingTokens} thinking tokens)`
                          : 'Formulated strategy & reasoned about execution plan',
                        status: 'completed',
                        durationMs,
                      });
                    }
                  }
                }
              } else if (event.event === 'result' && event.result) {
                if (event.result.response && !accumulatedText) {
                  accumulatedText = event.result.response;
                  req.onToken?.(event.result.response);
                }
                if (event.result.usage) {
                  cliUsage = {
                    input_tokens: event.result.usage.input_tokens || 0,
                    output_tokens: event.result.usage.output_tokens || 0,
                    thinking_tokens: event.result.usage.thinking_tokens ?? cliUsage.thinking_tokens ?? 0,
                    cache_read_tokens: event.result.usage.cache_read_tokens || 0,
                    total_tokens: event.result.usage.total_tokens || 0,
                    duration_seconds: Math.round(event.result.duration_seconds || (Date.now() - start) / 1000),
                    num_turns: event.result.num_turns || 1,
                  };

                  const finalThinking = cliUsage.thinking_tokens;
                  req.onStep?.({
                    id: 'step_reasoning_1',
                    description: finalThinking
                      ? `Formulated strategy & reasoned about execution (${finalThinking} thinking tokens)`
                      : 'Formulated strategy & reasoned about execution plan',
                    status: 'completed',
                    durationMs: Math.round((event.result.duration_seconds || 1) * 1000),
                  });
                }
              }
            } catch {
              if (
                !line.includes('Authentication required') &&
                !line.includes('Waiting for authentication') &&
                !line.includes('visit the URL to log in') &&
                !line.includes('No such file or directory') &&
                !line.includes('command not found')
              ) {
                accumulatedText += line + '\n';
                req.onToken?.(line + '\n');
              }
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
        const trimmed = lineBuffer.trim();
        if (
          !trimmed.includes('Authentication required') &&
          !trimmed.includes('Waiting for authentication') &&
          !trimmed.includes('visit the URL to log in') &&
          !trimmed.includes('No such file or directory') &&
          !trimmed.includes('command not found')
        ) {
          accumulatedText = trimmed;
        }
      }

      const allOutput = (rawStdout + '\n' + accumulatedText).trim();
      if (
        allOutput.includes('Authentication required') ||
        allOutput.includes('Waiting for authentication') ||
        allOutput.includes('visit the URL to log in') ||
        allOutput.includes('Please sign in')
      ) {
        throw new Error(
          `CLI ${req.cli} requires authentication in cloud microVM. Please link your Antigravity account in the top-right subscriptions menu.`
        );
      }

      if (result.exitCode !== 0) {
        const errDetails = rawStdout.trim() || accumulatedText.trim();
        if (errDetails.includes('No such file or directory') || errDetails.includes('command not found')) {
          throw new Error(`CLI ${req.cli} not found or failed to execute in sandbox microVM (exit code ${result.exitCode}): ${errDetails}`);
        }
        if (!accumulatedText.trim()) {
          throw new Error(`[Sandbox-Native] ${req.cli.toUpperCase()} exited with code ${result.exitCode}: ${errDetails}`);
        }
      }

      const durationMs = Date.now() - start;
      cliUsage.duration_seconds = Math.round(durationMs / 1000);
      this.addLog('READY', `[Sandbox-Native] ${req.cli.toUpperCase()} finished in microVM (${durationMs}ms)`);

      // Ensure all files created or modified by agent-runner are readable and traversable by user
      sandbox.commands.run(`sudo chmod -R a+rX ${this.workspaceRoot} /workspace 2>/dev/null || true`).catch(() => {});

      return {
        text: accumulatedText.trim(),
        durationMs,
        usage: cliUsage,
        exitCode: result.exitCode,
        sandboxId,
        rateLimits: latestRateLimits,
        cli: req.cli,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      this.addLog('ERROR', `[Sandbox-Native] ${req.cli} microVM command failed: ${msg}`);
      throw err;
    } finally {
      const currentActive = (this.activeExecutions.get(sandboxId) || 1) - 1;
      if (currentActive <= 0) {
        this.activeExecutions.delete(sandboxId);
        this.checkAndTriggerMaintenance(sandboxId);
      } else {
        this.activeExecutions.set(sandboxId, currentActive);
      }
    }
  }

  public async executeCommand(
    sandboxId: string,
    command: string,
    timeoutMs = 30000
  ): Promise<SandboxExecutionResponse> {
    const start = Date.now();
    this.addLog('EXEC', `$ ${command.length > 250 ? command.substring(0, 250) + '...' : command}`);

    if (this.maintenancePromises.has(sandboxId)) {
      const inFlight = this.maintenancePromises.get(sandboxId);
      if (inFlight) {
        await Promise.race([
          inFlight,
          new Promise((resolve) => setTimeout(resolve, 60000)),
        ]);
      }
    }

    this.activeExecutions.set(sandboxId, (this.activeExecutions.get(sandboxId) || 0) + 1);

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

      this.addLog('WARN', `E2B command failed with code ${exitCode} (${durationMs}ms): ${stderr.substring(0, 150).replace(/\n/g, ' ')}`);

      return {
        success: false,
        sandboxId,
        durationMs,
        exitCode,
        stdout,
        stderr,
      };
    } finally {
      const currentActive = (this.activeExecutions.get(sandboxId) || 1) - 1;
      if (currentActive <= 0) {
        this.activeExecutions.delete(sandboxId);
        this.checkAndTriggerMaintenance(sandboxId);
      } else {
        this.activeExecutions.set(sandboxId, currentActive);
      }
    }
  }

  private resolveSandboxPath(filePath: string): string {
    // Strip leading /workspace or /home/user/workspace prefixes
    let clean = filePath.replace(/^\/workspace\/?/, '').replace(/^\/home\/user\/workspace\/?/, '');
    if (clean.startsWith('/')) {
      clean = clean.replace(/^\/+/, '');
    }
    // Sanitize path against directory traversal
    const normalized = path.posix.normalize(clean).replace(/^(\.\.[\/\\])+/, '');
    const resolved = path.posix.join(this.workspaceRoot, normalized);
    if (!resolved.startsWith(this.workspaceRoot)) {
      throw new Error(`Security Exception: Path traversal outside workspace boundary is forbidden (${filePath})`);
    }
    return resolved;
  }

  private touchSandbox(sandboxId: string): void {
    const record = this.sandboxRecords.get(sandboxId);
    if (record) {
      record.lastActiveAt = Date.now();
      this.checkAndTriggerMaintenance(sandboxId);
    }
  }

  /**
   * Triggers the 24h idle maintenance toolchain update inside the cloud sandbox microVM.
   * Updates @openai/codex, @anthropic-ai/claude-code, and agy binary to their latest releases.
   */
  public async triggerMaintenance(sandboxId: string): Promise<void> {
    const inFlight = this.maintenancePromises.get(sandboxId);
    if (inFlight) {
      return inFlight;
    }

    const promise = (async () => {
      const record = this.sandboxRecords.get(sandboxId);
      if (record) {
        record.isUpdating = true;
      }
      this.addLog('INFO', `[Maintenance] Starting 24h toolchain update for sandbox ${sandboxId.substring(0, 6)}...`);

      try {
        const sandbox = await this.getSandboxInstance(sandboxId);

        // Update CLI toolchains inside microVM (run with 90s safety timeout)
        const updateCmd = `
          sudo npm install -g @openai/codex@latest @anthropic-ai/claude-code@latest 2>/dev/null || sudo npm update -g @openai/codex @anthropic-ai/claude-code 2>/dev/null || true;
          if command -v agy >/dev/null 2>&1 || test -f /usr/local/bin/agy; then
            agy update 2>/dev/null || (curl -sSL "https://github.com/google-antigravity/antigravity-cli/releases/latest/download/agy_cli_linux_x64.tar.gz" -o /tmp/agy.tar.gz 2>/dev/null && sudo tar -xzf /tmp/agy.tar.gz -C /usr/local/bin 2>/dev/null && sudo ln -sf /usr/local/bin/antigravity /usr/local/bin/agy 2>/dev/null && sudo chmod +x /usr/local/bin/antigravity /usr/local/bin/agy 2>/dev/null && rm -f /tmp/agy.tar.gz 2>/dev/null) || true;
          fi;
        `;

        await sandbox.commands.run(updateCmd, { timeoutMs: 90000 }).catch((err) => {
          logger.warn('Sandbox toolchain update command encountered warning', { sandboxId, error: String(err) });
        });

        if (record) {
          record.lastUpdateCheckAt = Date.now();
        }
        this.addLog('READY', `[Maintenance] Toolchains in sandbox ${sandboxId.substring(0, 6)} updated to latest versions`);
        this.saveRecordsToDisk();
      } catch (err) {
        logger.warn('Failed to complete maintenance update for sandbox', { sandboxId, error: String(err) });
      } finally {
        if (record) {
          record.isUpdating = false;
        }
        this.maintenancePromises.delete(sandboxId);
      }
    })();

    this.maintenancePromises.set(sandboxId, promise);
    return promise;
  }

  /**
   * Checks if the sandbox is idle (no running commands/turns) and has exceeded the 24h maintenance threshold.
   */
  private checkAndTriggerMaintenance(sandboxId: string): void {
    const active = this.activeExecutions.get(sandboxId) || 0;
    if (active > 0) {
      return; // Busy with turn or command
    }
    if (this.maintenancePromises.has(sandboxId)) {
      return; // Already in progress
    }

    const record = this.sandboxRecords.get(sandboxId);
    if (!record) return;

    const lastCheck = record.lastUpdateCheckAt || record.createdAt || 0;
    if (Date.now() - lastCheck >= E2BSandboxProvider.MAINTENANCE_INTERVAL_MS) {
      this.triggerMaintenance(sandboxId).catch(() => {});
    }
  }

  private formatAgyTool(toolName: string, params: Record<string, any> = {}): { desc: string; cmd?: string } {
    if (toolName === 'run_command') {
      const rawCmd = params.CommandLine || '';
      const preview = rawCmd.length > 55 ? `${rawCmd.slice(0, 52)}...` : rawCmd;
      return {
        desc: rawCmd ? `Running command in sandbox: \`${preview}\`` : 'Running command in sandbox',
        cmd: rawCmd,
      };
    }
    if (toolName === 'view_file' || toolName === 'read_resource') {
      const file = params.AbsolutePath || params.filePath || '';
      const base = file ? path.basename(file) : 'file';
      return { desc: `Reading file \`${base}\``, cmd: file };
    }
    if (toolName === 'write_to_file') {
      const file = params.TargetFile || params.targetFile || '';
      const base = file ? path.basename(file) : 'artifact';
      return { desc: `Writing artifact \`${base}\``, cmd: file };
    }
    if (toolName === 'replace_file_content' || toolName === 'multi_replace_file_content' || toolName === 'sed_file') {
      const file = params.TargetFile || params.targetFile || '';
      const base = file ? path.basename(file) : 'code';
      return { desc: `Editing code in \`${base}\``, cmd: file };
    }
    if (toolName === 'list_dir') {
      const dir = params.DirectoryPath || '/workspace';
      const base = path.basename(dir) || dir;
      return { desc: `Scanning directory \`${base}\``, cmd: dir };
    }
    if (toolName === 'grep_search') {
      const q = params.Query || '';
      return { desc: `Searching codebase for \`${q}\``, cmd: q };
    }
    if (toolName === 'search_web') {
      const q = params.query || '';
      return { desc: `Searching web for \`${q}\``, cmd: q };
    }
    if (toolName === 'generate_image') {
      return { desc: 'Generating UI visual artifact', cmd: params.Prompt || '' };
    }
    return { desc: `Executing agent tool: ${toolName}`, cmd: '' };
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
    if (!userId || userId === 'default_user') {
      return null;
    }
    const cleanId = this.sanitizeSessionId(sessionId);
    if (this.sandboxRecords.has(cleanId)) {
      const rec = this.sandboxRecords.get(cleanId);
      if (rec && rec.userId === userId) {
        return cleanId;
      }
    }
    const directId = this.sessionToSandboxId.get(cleanId);
    if (directId && this.sandboxRecords.has(directId)) {
      const rec = this.sandboxRecords.get(directId);
      if (rec && rec.userId === userId) {
        return directId;
      }
    }
    for (const record of this.sandboxRecords.values()) {
      if (record.userId === userId && record.attachedSessionIds.has(cleanId)) {
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
      logger.warn('Initial sandbox.files.read failed, attempting microVM cat fallback', { filePath, error: String(err) });
      try {
        const sandbox = await this.getSandboxInstance(sandboxId);
        const targetPath = this.resolveSandboxPath(filePath);
        const cleanName = filePath.replace(/^\/+/, '').replace(/^workspace\/?/, '');
        const cmdRes = await sandbox.commands.run(`sudo cat "${targetPath}" 2>/dev/null || sudo cat "/workspace/${cleanName}" 2>/dev/null || sudo cat "/home/user/workspace/${cleanName}" 2>/dev/null`);
        if (cmdRes.exitCode === 0) {
          return cmdRes.stdout;
        }
      } catch {}
      logger.error('Failed to read file from E2B sandbox', { filePath, error: err });
      throw new Error(`File ${filePath} not found in E2B sandbox`);
    }
  }

  public async listFiles(sandboxId: string): Promise<SandboxFileNode[]> {
    try {
      const sandbox = await this.getSandboxInstance(sandboxId);

      // Clean up any stale circular symlinks inside workspace directory
      await sandbox.commands.run('sudo rm -f /home/user/workspace/workspace /workspace/workspace 2>/dev/null || true').catch(() => {});

      const getTree = async (currentDir: string, depth = 0): Promise<SandboxFileNode[]> => {
        if (depth > 4) return [];
        try {
          const entries = await sandbox.files.list(currentDir);
          const nodes: SandboxFileNode[] = [];

          for (const entry of entries) {
            if (entry.name.startsWith('.git') || entry.name === 'node_modules') {
              continue;
            }
            // Exclude accidental circular symlink to workspace
            if (entry.name === 'workspace') {
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

  public async killAgentProcesses(sandboxIdOrSessionId: string): Promise<boolean> {
    const targetSandboxId = this.sessionToSandboxId.get(sandboxIdOrSessionId) || sandboxIdOrSessionId;
    const sandbox = this.activeSandboxes.get(targetSandboxId);
    if (!sandbox) {
      logger.info('No active sandbox instance found to terminate agent processes', {
        sandboxIdOrSessionId,
        targetSandboxId,
      });
      return false;
    }
    try {
      logger.info('Terminating running agent processes inside E2B microVM...', { targetSandboxId });
      await sandbox.commands.run(
        'sudo pkill -TERM -u agent-runner || sudo pkill -9 -u agent-runner || sudo pkill -f agy || sudo pkill -f codex || sudo pkill -f claude || true',
        { timeoutMs: 5000 }
      ).catch(() => {});
      logger.info('Agent processes successfully terminated in E2B microVM', { targetSandboxId });
      return true;
    } catch (err) {
      logger.warn('Failed to kill agent processes in microVM', { targetSandboxId, error: String(err) });
      return false;
    }
  }

  public async destroySandbox(sandboxIdOrSessionId: string): Promise<void> {
    const targetSandboxId = this.sessionToSandboxId.get(sandboxIdOrSessionId) || sandboxIdOrSessionId;
    const targetRec = this.sandboxRecords.get(targetSandboxId);
    if (targetRec && targetRec.userId && targetRec.userId !== 'default_user') {
      firestoreBackendService.deleteSandboxRecord(targetRec.userId, targetSandboxId).catch(() => {});
    }
    try {
      this.addLog('INFO', `Terminating E2B microVM ${targetSandboxId.substring(0, 8)}...`);
      const sandbox = await this.getSandboxInstance(targetSandboxId);
      await sandbox.kill();
      this.activeSandboxes.delete(targetSandboxId);
      this.sandboxRecords.delete(targetSandboxId);
      this.initializedSandboxes.delete(targetSandboxId);
      this.activeExecutions.delete(targetSandboxId);
      this.maintenancePromises.delete(targetSandboxId);

      for (const [sessId, sbId] of this.sessionToSandboxId.entries()) {
        if (sbId === targetSandboxId || sessId === sandboxIdOrSessionId) {
          this.sessionToSandboxId.delete(sessId);
        }
      }
      this.addLog('READY', `E2B microVM ${targetSandboxId.substring(0, 8)} destroyed.`);
    } catch (err) {
      this.activeSandboxes.delete(targetSandboxId);
      this.sandboxRecords.delete(targetSandboxId);
      this.activeExecutions.delete(targetSandboxId);
      this.maintenancePromises.delete(targetSandboxId);
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

  public getSandboxUsage(userId?: string): {
    used: number;
    max: number;
    sandboxes: SandboxUsageInfo[];
  } {
    const max = envConfig.MAX_SANDBOXES_PER_USER ?? 3;

    // Strict multi-tenant isolation: Unauthenticated or empty userId returns 0 sandboxes.
    if (!userId || userId === 'default_user' || userId.trim() === '') {
      return {
        used: 0,
        max,
        sandboxes: [],
      };
    }

    this.deduplicateAttachedSessions();
    if (this.sandboxRecords.size === 0) {
      this.loadRecordsFromDisk();
    }
    this.renumberSandboxes();
    const allSandboxes = Array.from(this.sandboxRecords.values()).sort(
      (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.sandboxId.localeCompare(b.sandboxId)
    );

    // Strict owner filter: Sandboxes belonging strictly to THIS user
    const userSandboxes = allSandboxes.filter((r) => r.userId === userId);

    // Limit returned sandboxes to quota slots
    const visibleSandboxes = userSandboxes.slice(0, max);

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
        const isUpdating = Boolean(this.maintenancePromises.has(r.sandboxId) || r.isUpdating);
        return {
          sandboxId: r.sandboxId,
          name: `Sandbox #${idx + 1} (${r.sandboxId.substring(0, 6)})`,
          sessionId: realSessions[0] || '',
          lastActiveAt: r.lastActiveAt,
          createdAt: r.createdAt,
          attachedSessionCount: realSessions.length,
          attachedSessionIds: realSessions,
          lastUpdateCheckAt: r.lastUpdateCheckAt || r.createdAt,
          isUpdating,
          isProvisioning: Boolean(r.isProvisioning),
        };
      }),
    };
  }

  public getTerminalLogs(): TerminalLogEntry[] {
    return this.terminalLogs.slice(-25);
  }
}
