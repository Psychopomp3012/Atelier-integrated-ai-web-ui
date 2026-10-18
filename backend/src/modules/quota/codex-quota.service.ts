import type { CodexQuotaStats, RecordTurnInput, CliQuotaLimits, QuotaGroup } from './quota.types.js';
import { cliAuthService } from '../auth/cli-auth.service.js';
import { sandboxService } from '../sandbox/sandbox.service.js';
import { firestoreBackendService } from '../../services/firestore.service.js';
import { logger } from '../../utils/logger.util.js';

interface CliTelemetryPersistence {
  totalTurns: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  lastLatencyMs?: number;
  totalLatencyMs?: number;
}

interface SessionStats {
  apiCalls: number;
  promptTokens: number;
  completionTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  lastLatencyMs: number;
  totalLatencyMs: number;
}

export class CodexQuotaService {
  private readonly inMemoryTelemetryMap: Map<string, CliTelemetryPersistence> = new Map();
  private readonly sessionStatsMap: Map<string, SessionStats> = new Map();
  private readonly cachedQuotaLimitsMap: Map<string, { limits: CliQuotaLimits; timestamp: number }> = new Map();
  private readonly inFlightQuotaMap: Map<string, Promise<CodexQuotaStats>> = new Map();
  private readonly inFlightLimitsMap: Map<string, Promise<CliQuotaLimits | null>> = new Map();
  private readonly lastQuotaLogMap: Map<string, { snapshot: string; timestamp: number }> = new Map();

  constructor() {
    // Dynamic live initialization: no local file scanning or storage.
  }

  /**
   * Resolves an active cloud sandbox microVM ID for a user.
   */
  private resolveSandboxId(userId?: string, sessionId?: string): string | null {
    if (sessionId) {
      const active = sandboxService.getActiveSandboxId(sessionId, userId);
      if (active) return active;
    }
    if (userId) {
      const usage = sandboxService.getSandboxUsage(userId);
      if (usage.sandboxes && usage.sandboxes.length > 0) {
        return usage.sandboxes[0].sandboxId;
      }
    }
    // Strict multi-tenant isolation: if a specific userId was passed, DO NOT fall back to another user's sandbox
    if (userId && userId !== 'default' && userId !== 'default_user') {
      return null;
    }

    const defaultActive = sandboxService.getActiveSandboxId('default');
    if (defaultActive) return defaultActive;

    return null;
  }

  public invalidateUserQuota(userKey: string): void {
    this.cachedQuotaLimitsMap.delete(userKey);
  }

  /**
   * Queries Codex CLI version dynamically via cloud sandbox microVM without touching local backend host.
   */
  private async queryCodexVersion(userId?: string, sessionId?: string): Promise<string> {
    const activeSandboxId = this.resolveSandboxId(userId, sessionId);
    if (activeSandboxId) {
      try {
        const cmdRes = await sandboxService.executeInSandbox({
          command: 'sudo -u agent-runner -H env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" codex --version',
          code: '',
          language: 'bash',
          sandboxId: activeSandboxId,
          userId,
          sessionId,
          timeoutMs: 10000,
        });
        if (cmdRes && cmdRes.stdout) {
          const match = cmdRes.stdout.match(/codex(?:-cli)?\s+([0-9.]+)/i);
          if (match) return match[1];
        }
      } catch {}
    }

    return '0.163.0';
  }

  /**
   * Loads user Codex telemetry strictly from memory cache or Firebase Firestore.
   * Completely avoids reading any local files on the backend.
   * Quota and rate limits are NEVER loaded from Firestore; they are always fetched live.
   */
  private async loadPersistenceAsync(userKey?: string, userEmail?: string): Promise<CliTelemetryPersistence> {
    const key = userKey || userEmail || 'default';
    if (this.inMemoryTelemetryMap.has(key)) {
      return this.inMemoryTelemetryMap.get(key)!;
    }

    try {
      const firestoreData = await firestoreBackendService.getUserTelemetry(key, userEmail, 'codex');
      if (firestoreData) {
        const sanitized: CliTelemetryPersistence = {
          totalTurns: Number(firestoreData.totalTurns) || 0,
          totalTokens: Number(firestoreData.totalTokens) || 0,
          promptTokens: Number(firestoreData.promptTokens) || 0,
          completionTokens: Number(firestoreData.completionTokens) || 0,
          thinkingTokens: Number(firestoreData.thinkingTokens) || 0,
          cacheReadTokens: Number(firestoreData.cacheReadTokens) || 0,
          lastLatencyMs: Number(firestoreData.lastLatencyMs) || 0,
          totalLatencyMs: Number(firestoreData.totalLatencyMs) || 0,
        };
        this.inMemoryTelemetryMap.set(key, sanitized);
        return sanitized;
      }
    } catch (err) {
      logger.warn('[Codex Quota] Failed to load telemetry from Firestore', { error: String(err) });
    }

    const fresh: CliTelemetryPersistence = {
      totalTurns: 0,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      thinkingTokens: 0,
      cacheReadTokens: 0,
      lastLatencyMs: 0,
      totalLatencyMs: 0,
    };
    this.inMemoryTelemetryMap.set(key, fresh);
    return fresh;
  }

  /**
   * Saves user Codex telemetry strictly into memory cache and Firebase Firestore.
   * Excludes all volatile quota and rate limit data from Firestore.
   */
  private savePersistence(data: CliTelemetryPersistence, userKey?: string, userEmail?: string): void {
    const key = userKey || userEmail;
    if (!key || key === 'anonymous' || key === 'default') {
      return;
    }
    this.inMemoryTelemetryMap.set(key, data);
    firestoreBackendService.saveUserTelemetry(key, data, 'codex', userEmail).catch((err) => {
      logger.warn('[Codex Quota] Failed to save telemetry to Firestore', { error: String(err) });
    });
  }

  /**
   * Queries authentic live OpenAI Codex rate limits and account quota directly from Codex CLI daemon.
   * Executes strictly in cloud sandbox microVM without running codex on backend host.
   */
  private async queryLiveCodexQuota(userId?: string, sessionId?: string): Promise<{ rateLimits?: any; account?: any } | null> {
    const activeSandboxId = this.resolveSandboxId(userId, sessionId);
    if (activeSandboxId) {
      try {
        const script = `node -e 'const { spawn } = require("child_process"); const proc = spawn("codex", ["app-server", "--stdio"]); let buffer = ""; let rateLimits = null; let account = null; const timer = setTimeout(() => { try { proc.kill(); } catch {} process.stdout.write(JSON.stringify({ rateLimits, account })); process.exit(0); }, 4000); proc.stdout.on("data", (chunk) => { buffer += chunk.toString(); const lines = buffer.split("\\n"); buffer = lines.pop() || ""; for (const line of lines) { const trimmed = line.trim(); if (!trimmed) continue; try { const json = JSON.parse(trimmed); if (json.id === 2 && json.result?.rateLimits) rateLimits = json.result.rateLimits; if (json.id === 3 && json.result?.account) account = json.result.account; if (rateLimits && account) { clearTimeout(timer); try { proc.kill(); } catch {} process.stdout.write(JSON.stringify({ rateLimits, account })); process.exit(0); } } catch {} } }); proc.on("error", () => { clearTimeout(timer); process.exit(0); }); proc.stdin.write(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "atelier-ui", title: "Atelier", version: "1.0.0" }, capabilities: null } }) + "\\n"); setTimeout(() => { try { proc.stdin.write(JSON.stringify({ id: 2, method: "account/rateLimits/read", params: {} }) + "\\n"); proc.stdin.write(JSON.stringify({ id: 3, method: "account/read", params: {} }) + "\\n"); } catch {} }, 200);'`;
        const cmdRes = await sandboxService.executeInSandbox({
          command: `sudo -u agent-runner -H env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" ${script}`,
          code: '',
          language: 'bash',
          sandboxId: activeSandboxId,
          userId,
          sessionId,
          timeoutMs: 6000,
        });
        if (cmdRes && cmdRes.stdout) {
          const parsed = JSON.parse(cmdRes.stdout.trim());
          if (parsed && (parsed.rateLimits || parsed.account)) {
            return parsed;
          }
        }
      } catch (err) {
        logger.warn('[Codex Quota] Failed to live-query rate limits from cloud sandbox microVM', { error: String(err) });
      }
    }

    return null;
  }

  /**
   * Fetches authentic OpenAI Codex quota and model limits freshly and live from the CLI.
   * Completely avoids storing or reading quota from Firestore.
   */
  public async fetchCodexQuotaLimits(
    userKey?: string,
    userEmail?: string,
    sessionId?: string
  ): Promise<CliQuotaLimits | null> {
    const cacheKey = userKey || userEmail || 'default';
    const cached = this.cachedQuotaLimitsMap.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.timestamp < 10000) {
      return cached.limits;
    }

    const inFlight = this.inFlightLimitsMap.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const limitsPromise = (async () => {
      const version = await this.queryCodexVersion(userKey, sessionId);
      const liveData = await this.queryLiveCodexQuota(userKey, sessionId);
      const activeRateLimits = liveData?.rateLimits;

      try {
        const groups: QuotaGroup[] = [];
        if (activeRateLimits?.primary) {
          const primary = activeRateLimits.primary;
          const usedPct = typeof primary.usedPercent === 'number'
            ? primary.usedPercent
            : typeof primary.used_percent === 'number'
            ? primary.used_percent
            : 0;
          const remainingFraction = Math.max(0, Math.min(1, (100 - usedPct) / 100));
          const windowMins = primary.windowDurationMins || primary.window_minutes || 43200;
          const resetSeconds = primary.resetsAt || primary.resets_at;
          const resetTime = resetSeconds
            ? new Date(resetSeconds * 1000).toISOString()
            : new Date(Date.now() + windowMins * 60 * 1000).toISOString();

          const windowDesc = windowMins <= 360
            ? `${Math.round(windowMins / 60)}h rolling window`
            : `${Math.round(windowMins / 1440)}d rolling window`;

          const primaryWindowType = windowMins <= 360
            ? '5h'
            : windowMins <= 10080
            ? 'weekly'
            : 'monthly';

          const planName = (activeRateLimits.planType || liveData?.account?.planType || 'ChatGPT').toUpperCase();

          const buckets = [
            {
              id: 'codex-rolling-limit',
              name: `Codex Limit Remaining (${planName} Plan)`,
              description: 'Enforced dynamically by OpenAI Codex infrastructure',
              window: primaryWindowType,
              remaining_fraction: remainingFraction,
              reset_time: resetTime,
            },
          ];

          // Include secondary window if present (e.g. secondary rate limit bucket)
          if (activeRateLimits.secondary) {
            const sec = activeRateLimits.secondary;
            const secUsed = typeof sec.usedPercent === 'number' ? sec.usedPercent : (sec.used_percent || 0);
            const secRemaining = Math.max(0, Math.min(1, (100 - secUsed) / 100));
            const secMins = sec.windowDurationMins || sec.window_minutes || 360;
            const secResetSec = sec.resetsAt || sec.resets_at;
            const secResetTime = secResetSec
              ? new Date(secResetSec * 1000).toISOString()
              : new Date(Date.now() + secMins * 60 * 1000).toISOString();

            buckets.push({
              id: 'codex-secondary-limit',
              name: 'Codex Secondary Window',
              description: 'Secondary rolling capacity window',
              window: secMins <= 360 ? '5h' : 'weekly',
              remaining_fraction: secRemaining,
              reset_time: secResetTime,
            });
          }

          groups.push({
            name: 'OpenAI Codex Limits',
            description: `Authenticated via ChatGPT Account (${windowDesc})`,
            buckets,
          });

          logger.info('[Codex Quota] Resolved live OpenAI Codex quota', {
            usedPercent: usedPct,
            remainingFraction,
            resetTime,
            planType: planName,
          });
        }

        const limits: CliQuotaLimits = {
          description: `OpenAI Codex CLI (v${version}) authenticated via ChatGPT Account`,
          groups,
          fetchedAt: new Date().toISOString(),
        };
        this.cachedQuotaLimitsMap.set(cacheKey, { limits, timestamp: Date.now() });
        return limits;
      } catch (err) {
        logger.warn('[Codex Quota] Failed to construct live Codex quota limits', { error: String(err) });
        return null;
      }
    })();

    this.inFlightLimitsMap.set(cacheKey, limitsPromise);
    try {
      return await limitsPromise;
    } finally {
      this.inFlightLimitsMap.delete(cacheKey);
    }
  }

  /**
   * Resolves authentic Codex CLI telemetry and quota scoped to the specific user.
   */
  public async getCodexQuota(userEmail?: string, sessionId?: string, userId?: string): Promise<CodexQuotaStats> {
    const effectiveUserId = userId || (userEmail ? cliAuthService.getUserIdByEmail(userEmail) : undefined) || undefined;
    const inFlightKey = `${effectiveUserId || userId || userEmail || 'default'}:${sessionId || ''}`;
    const existing = this.inFlightQuotaMap.get(inFlightKey);
    if (existing) {
      return existing;
    }

    const quotaPromise = (async () => {
      if (effectiveUserId || userEmail) {
        await cliAuthService.syncUserFromFirestore(effectiveUserId || undefined, userEmail);
      }
      const cliStatus = await cliAuthService.getCliStatus(effectiveUserId, userEmail);
      const isLinked = Boolean(
        cliStatus.codex?.linked ||
        (effectiveUserId && cliAuthService.isUserCliLinked(effectiveUserId, 'codex')) ||
        (userEmail && cliAuthService.isUserCliLinkedByEmail(userEmail, 'codex'))
      );

      if (!isLinked) {
        return {
          linked: false,
          totalTurns: 0,
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          thinkingTokens: 0,
          cacheReadTokens: 0,
          lastLatencyMs: 0,
          avgLatencyMs: 0,
          lastUpdated: new Date().toISOString(),
        };
      }

      const userKey = effectiveUserId || userEmail || 'default';
      const persistence = await this.loadPersistenceAsync(userKey, userEmail);
      const email = userEmail || cliStatus.codex?.email || 'ChatGPT Account';

      const sessionStats = (sessionId ? this.sessionStatsMap.get(sessionId) : null) || {
        apiCalls: persistence.totalTurns,
        promptTokens: persistence.promptTokens,
        completionTokens: persistence.completionTokens,
        thinkingTokens: persistence.thinkingTokens,
        cacheReadTokens: persistence.cacheReadTokens,
        totalTokens: persistence.totalTokens,
        lastLatencyMs: persistence.lastLatencyMs || 0,
        totalLatencyMs: persistence.totalLatencyMs || 0,
      };

      const effectiveLastLatency =
        sessionStats.lastLatencyMs > 0
          ? sessionStats.lastLatencyMs
          : (persistence.lastLatencyMs || 0);

      const effectiveTotalLatency =
        sessionStats.totalLatencyMs > 0
          ? sessionStats.totalLatencyMs
          : (persistence.totalLatencyMs || 0);

      const effectiveCalls =
        sessionStats.apiCalls > 0
          ? sessionStats.apiCalls
          : persistence.totalTurns;

      const avgLatencyMs =
        effectiveCalls > 0
          ? Math.round(effectiveTotalLatency / effectiveCalls)
          : 0;

      // Fresh live fetch of authentic limits (no Firestore read)
      const quotaLimits = await this.fetchCodexQuotaLimits(userKey, userEmail, sessionId);
      const singleBucket = quotaLimits?.groups[0]?.buckets?.[0];

      const logKey = `${effectiveUserId || userId || userEmail || 'default'}`;
      const logSnapshot = `${isLinked}:${persistence.totalTurns}:${singleBucket?.remaining_fraction ?? 1}`;
      const lastLog = this.lastQuotaLogMap.get(logKey);
      const now = Date.now();
      if (!lastLog || lastLog.snapshot !== logSnapshot || now - lastLog.timestamp > 15_000) {
        this.lastQuotaLogMap.set(logKey, { snapshot: logSnapshot, timestamp: now });
        logger.info('[Codex Quota] Resolved user quota status', {
          userId,
          userEmail: email,
          effectiveUserId,
          userKey,
          isLinked,
          totalTurns: persistence.totalTurns,
          sessionTurns: sessionStats.apiCalls,
          totalTokens: persistence.totalTokens,
          sessionTokens: sessionStats.totalTokens,
          limitRemaining: singleBucket ? `${(singleBucket.remaining_fraction * 100).toFixed(2)}%` : 'N/A',
        });
      }

      return {
        linked: true,
        userEmail: email,
        userName: 'ChatGPT Account',
        authMethod: 'ChatGPT OAuth',
        totalTurns: persistence.totalTurns,
        totalTokens: persistence.totalTokens,
        promptTokens: persistence.promptTokens,
        completionTokens: persistence.completionTokens,
        thinkingTokens: persistence.thinkingTokens,
        cacheReadTokens: persistence.cacheReadTokens,
        lastLatencyMs: effectiveLastLatency,
        avgLatencyMs,
        quotaLimits,
        lastUpdated: new Date().toISOString(),
      };
    })();

    this.inFlightQuotaMap.set(inFlightKey, quotaPromise);
    try {
      return await quotaPromise;
    } finally {
      this.inFlightQuotaMap.delete(inFlightKey);
    }
  }

  /**
   * Records a turn completed by the Codex CLI and persists cumulative turn/token metrics to Firebase Firestore.
   * Quota limits are NEVER saved to Firestore.
   */
  public async recordTurn(input: RecordTurnInput): Promise<CodexQuotaStats> {
    const userKey =
      input.userId ||
      (input.userEmail ? (cliAuthService.getUserIdByEmail(input.userEmail) || input.userEmail) : '');

    if (!userKey || userKey === 'anonymous' || userKey === 'default') {
      return this.getCodexQuota(input.userEmail, input.sessionId, input.userId);
    }

    const persistence = await this.loadPersistenceAsync(userKey, input.userEmail);

    persistence.totalTurns += 1;
    persistence.totalTokens += input.totalTokens;
    persistence.promptTokens += input.promptTokens;
    persistence.completionTokens += input.completionTokens;
    persistence.thinkingTokens = (persistence.thinkingTokens || 0) + (input.thinkingTokens || 0);
    persistence.cacheReadTokens = (persistence.cacheReadTokens || 0) + (input.cacheReadTokens || 0);
    persistence.lastLatencyMs = input.latencyMs;
    persistence.totalLatencyMs = (persistence.totalLatencyMs || 0) + input.latencyMs;

    this.savePersistence(persistence, userKey, input.userEmail);

    // Update session metrics if sessionId provided
    const existing = (input.sessionId ? this.sessionStatsMap.get(input.sessionId) : null) || {
      apiCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      thinkingTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      lastLatencyMs: 0,
      totalLatencyMs: 0,
    };

    existing.apiCalls += 1;
    existing.promptTokens += input.promptTokens;
    existing.completionTokens += input.completionTokens;
    existing.thinkingTokens += (input.thinkingTokens || 0);
    existing.cacheReadTokens += (input.cacheReadTokens || 0);
    existing.totalTokens += input.totalTokens;
    existing.lastLatencyMs = input.latencyMs;
    existing.totalLatencyMs += input.latencyMs;

    if (input.sessionId) {
      this.sessionStatsMap.set(input.sessionId, existing);
    }

    // Invalidate cached limits so the next fetch hits fresh
    this.cachedQuotaLimitsMap.delete(userKey);

    logger.info('[Codex Quota] Recorded authentic Codex CLI turn', {
      userKey,
      userEmail: input.userEmail,
      totalTurns: persistence.totalTurns,
      inputTokens: input.promptTokens,
      outputTokens: input.completionTokens,
      totalTokens: input.totalTokens,
      latencyMs: input.latencyMs,
    });

    return this.getCodexQuota(input.userEmail, input.sessionId, input.userId);
  }

  public async syncLocalTelemetryToFirestore(userKey: string, userEmail?: string): Promise<void> {
    try {
      await this.loadPersistenceAsync(userKey, userEmail);
    } catch {}
  }
}

export const codexQuotaService = new CodexQuotaService();
