import type { AntigravityQuotaStats, GeminiQuotaStats, RecordTurnInput, CliQuotaLimits, QuotaGroup } from './quota.types.js';
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
  window5hStart?: number;
  gemini5hTokens?: number;
  gemini5hTurns?: number;
  thirdParty5hTokens?: number;
  thirdParty5hTurns?: number;
  weeklyStart?: number;
  geminiWeeklyTokens?: number;
  geminiWeeklyTurns?: number;
  thirdPartyWeeklyTokens?: number;
  thirdPartyWeeklyTurns?: number;
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

export class AntigravityQuotaService {
  private readonly inMemoryTelemetryMap: Map<string, CliTelemetryPersistence> = new Map();
  private readonly sessionStatsMap: Map<string, SessionStats> = new Map();
  private readonly cachedQuotaLimitsMap: Map<string, { limits: CliQuotaLimits; timestamp: number }> = new Map();

  constructor() {
    // Dynamic live initialization: no local file scanning or storage.
  }

  private sanitizePersistence(parsed: any): CliTelemetryPersistence {
    return {
      totalTurns: Number(parsed?.totalTurns) || 0,
      totalTokens: Number(parsed?.totalTokens) || 0,
      promptTokens: Number(parsed?.promptTokens) || 0,
      completionTokens: Number(parsed?.completionTokens) || 0,
      thinkingTokens: Number(parsed?.thinkingTokens) || 0,
      cacheReadTokens: Number(parsed?.cacheReadTokens) || 0,
      lastLatencyMs: Number(parsed?.lastLatencyMs) || 0,
      totalLatencyMs: Number(parsed?.totalLatencyMs) || 0,
      window5hStart: parsed?.window5hStart,
      gemini5hTokens: Number(parsed?.gemini5hTokens) || 0,
      gemini5hTurns: Number(parsed?.gemini5hTurns) || 0,
      thirdParty5hTokens: Number(parsed?.thirdParty5hTokens) || 0,
      thirdParty5hTurns: Number(parsed?.thirdParty5hTurns) || 0,
      weeklyStart: parsed?.weeklyStart,
      geminiWeeklyTokens: Number(parsed?.geminiWeeklyTokens) || 0,
      geminiWeeklyTurns: Number(parsed?.geminiWeeklyTurns) || 0,
      thirdPartyWeeklyTokens: Number(parsed?.thirdPartyWeeklyTokens) || 0,
      thirdPartyWeeklyTurns: Number(parsed?.thirdPartyWeeklyTurns) || 0,
    } as CliTelemetryPersistence;
  }

  /**
   * Loads user Antigravity telemetry strictly from memory cache or Firebase Firestore.
   * Completely avoids reading any local files on the backend.
   */
  private async loadPersistenceAsync(userKey?: string, userEmail?: string): Promise<CliTelemetryPersistence> {
    const key = userKey || userEmail || 'default';
    if (this.inMemoryTelemetryMap.has(key)) {
      return this.inMemoryTelemetryMap.get(key)!;
    }

    try {
      const firestoreData = await firestoreBackendService.getUserTelemetry(key, userEmail, 'antigravity');
      if (firestoreData) {
        const sanitized = this.sanitizePersistence(firestoreData);
        this.inMemoryTelemetryMap.set(key, sanitized);
        return sanitized;
      }
    } catch (err) {
      logger.warn('[Antigravity Quota] Failed to load telemetry from Firestore', { error: String(err) });
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
      gemini5hTokens: 0,
      gemini5hTurns: 0,
      thirdParty5hTokens: 0,
      thirdParty5hTurns: 0,
      geminiWeeklyTokens: 0,
      geminiWeeklyTurns: 0,
      thirdPartyWeeklyTokens: 0,
      thirdPartyWeeklyTurns: 0,
    };
    this.inMemoryTelemetryMap.set(key, fresh);
    return fresh;
  }

  /**
   * Saves user Antigravity telemetry strictly into memory cache and Firebase Firestore.
   * Completely avoids saving or writing any local files on the backend.
   */
  private savePersistence(data: CliTelemetryPersistence, userKey?: string, userEmail?: string): void {
    const key = userKey || userEmail || 'default';
    this.inMemoryTelemetryMap.set(key, data);
    firestoreBackendService.saveUserTelemetry(key, data, 'antigravity', userEmail).catch((err) => {
      logger.warn('[Antigravity Quota] Failed to save telemetry to Firestore', { error: String(err) });
    });
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
    const defaultActive = sandboxService.getActiveSandboxId('default');
    if (defaultActive) return defaultActive;

    const globalUsage = sandboxService.getSandboxUsage();
    if (globalUsage.sandboxes && globalUsage.sandboxes.length > 0) {
      return globalUsage.sandboxes[0].sandboxId;
    }
    return null;
  }

  /**
   * Queries live authentic Antigravity quota from Google's Code Assist backend via CLI.
   * Executes strictly in the user's active cloud sandbox microVM without host CLI dependency.
   */
  private async queryLiveGoogleQuota(userId?: string, sessionId?: string): Promise<CliQuotaLimits | null> {
    try {
      const activeSandboxId = this.resolveSandboxId(userId, sessionId);
      if (!activeSandboxId) {
        return null;
      }

      let stdout = '';
      try {
        const cmdRes = await sandboxService.executeInSandbox({
          command: 'sudo -u agent-runner -H env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" agy -p /quota --output-format json',
          code: '',
          language: 'bash',
          sandboxId: activeSandboxId,
          userId,
          sessionId,
          timeoutMs: 15000,
        });
        if (cmdRes && cmdRes.stdout) {
          stdout = cmdRes.stdout;
        }
      } catch (err) {
        logger.warn('[Antigravity Quota] Failed to live-query quota from cloud microVM', { error: String(err) });
      }

      if (!stdout || stdout.trim().length === 0) return null;

      const parsed = JSON.parse(stdout);
      if (parsed.status === 'SUCCESS' && parsed.command?.name === 'usage' && parsed.command?.data) {
        const rawGroups = parsed.command.data.groups;
        if (Array.isArray(rawGroups) && rawGroups.length > 0) {
          const groups: QuotaGroup[] = rawGroups.map((g: any) => ({
            name: String(g.name || ''),
            description: String(g.description || ''),
            buckets: Array.isArray(g.buckets)
              ? g.buckets.map((b: any) => ({
                  id: String(b.id || ''),
                  name: String(b.name || ''),
                  description: String(b.description || ''),
                  window: String(b.window || ''),
                  remaining_fraction: typeof b.remaining_fraction === 'number' ? b.remaining_fraction : 1.0,
                  reset_time: String(b.reset_time || ''),
                }))
              : [],
          }));

          logger.info('[Antigravity Quota] Resolved live Google Code Assist quota', {
            groupsCount: groups.length,
            groups: groups.map((g) => g.name),
          });

          return {
            description: parsed.command.data.description || 'Antigravity CLI native and third-party hosted limits',
            fetchedAt: new Date().toISOString(),
            groups,
          };
        }
      }
      return null;
    } catch (err) {
      logger.warn('[Antigravity Quota] Failed to query live Google Code Assist quota', {
        error: String(err),
      });
      return null;
    }
  }

  private async fetchCliQuotaLimits(
    userKey: string,
    persistence: CliTelemetryPersistence,
    userEmail?: string,
    sessionId?: string,
    userId?: string
  ): Promise<CliQuotaLimits> {
    const cached = this.cachedQuotaLimitsMap.get(userKey);
    const now = Date.now();
    if (cached && now - cached.timestamp < 10000) {
      return cached.limits;
    }

    // Live Google Code Assist CLI live fetch via cloud sandbox
    const liveLimits = await this.queryLiveGoogleQuota(userId, sessionId);
    if (liveLimits && liveLimits.groups.length > 0) {
      this.cachedQuotaLimitsMap.set(userKey, { limits: liveLimits, timestamp: now });
      return liveLimits;
    }

    // Clean initial fallback if live fetch unavailable (never store or read from firestore)
    const initialLimits: CliQuotaLimits = {
      description: 'Antigravity CLI native and third-party hosted limits',
      fetchedAt: new Date().toISOString(),
      groups: [],
    };

    return initialLimits;
  }

  /**
   * Resolves authentic Antigravity CLI telemetry and quota scoped to the specific user.
   */
  public async getAntigravityQuota(
    userEmail?: string,
    sessionId?: string,
    userId?: string
  ): Promise<AntigravityQuotaStats> {
    const effectiveUserId = userId || (userEmail ? cliAuthService.getUserIdByEmail(userEmail) || undefined : undefined);

    if (effectiveUserId || userEmail) {
      await cliAuthService.syncUserFromFirestore(effectiveUserId || undefined, userEmail);
    }

    // Multi-tenant check: Is Antigravity CLI linked for this specific user or email?
    const isLinked = Boolean(
      (effectiveUserId && cliAuthService.isUserCliLinked(effectiveUserId, 'antigravity')) ||
      (userEmail && cliAuthService.isUserCliLinkedByEmail(userEmail, 'antigravity'))
    );

    if (!isLinked) {
      logger.info('[Antigravity Quota] Resolved user quota status: Not Linked', {
        userId,
        userEmail,
        effectiveUserId,
        isLinked: false,
      });

      return {
        linked: false,
        userEmail: userEmail || undefined,
        userName: undefined,
        totalTurns: 0,
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        thinkingTokens: 0,
        cacheReadTokens: 0,
        lastLatencyMs: 0,
        avgLatencyMs: 0,
        quotaLimits: null,
        lastUpdated: new Date().toISOString(),
      };
    }

    const userKey = effectiveUserId || userEmail || 'default';
    const persistence = await this.loadPersistenceAsync(userKey, userEmail);
    const userRecord = effectiveUserId ? cliAuthService.getUserCliRecord(effectiveUserId) : null;
    const email = userEmail || userRecord?.antigravity?.email || userRecord?.email;
    const name = userRecord?.name;

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

    const totalTurnsCount =
      sessionStats.apiCalls > 0
        ? sessionStats.apiCalls
        : persistence.totalTurns;

    const avgLatencyMs =
      totalTurnsCount > 0
        ? Math.round(effectiveTotalLatency / totalTurnsCount)
        : 0;

    const quotaLimits = await this.fetchCliQuotaLimits(userKey, persistence, email, sessionId, effectiveUserId);

    logger.info('[Antigravity Quota] Resolved user quota status', {
      userId,
      userEmail: email,
      effectiveUserId,
      userKey,
      isLinked,
      totalTurns: totalTurnsCount,
      groupsDetected: quotaLimits.groups.map((g) => g.name),
    });

    return {
      linked: true,
      userEmail: email,
      userName: name,
      totalTurns: totalTurnsCount,
      totalTokens: sessionStats.totalTokens,
      promptTokens: sessionStats.promptTokens,
      completionTokens: sessionStats.completionTokens,
      thinkingTokens: sessionStats.thinkingTokens,
      cacheReadTokens: sessionStats.cacheReadTokens,
      lastLatencyMs: effectiveLastLatency,
      avgLatencyMs,
      quotaLimits,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Alias for backwards compatibility.
   */
  public async getGeminiQuota(
    userEmail?: string,
    sessionId?: string,
    userId?: string
  ): Promise<AntigravityQuotaStats> {
    return this.getAntigravityQuota(userEmail, sessionId, userId);
  }

  /**
   * Records a turn completed by the Antigravity CLI directly using CLI-acquired token usage.
   */
  public async recordTurn(input: RecordTurnInput): Promise<AntigravityQuotaStats> {
    const userKey = input.userEmail
      ? (cliAuthService.getUserIdByEmail(input.userEmail) || input.userEmail)
      : 'anonymous';

    const persistence = await this.loadPersistenceAsync(userKey, input.userEmail);

    persistence.totalTurns += 1;
    persistence.totalTokens += input.totalTokens;
    persistence.promptTokens += input.promptTokens;
    persistence.completionTokens += input.completionTokens;
    persistence.thinkingTokens = (persistence.thinkingTokens || 0) + (input.thinkingTokens || 0);
    persistence.cacheReadTokens = (persistence.cacheReadTokens || 0) + (input.cacheReadTokens || 0);
    persistence.lastLatencyMs = input.latencyMs;
    persistence.totalLatencyMs = (persistence.totalLatencyMs || 0) + input.latencyMs;

    const modelLower = (input.model || '').toLowerCase();
    const is3p =
      modelLower.includes('claude') ||
      modelLower.includes('gpt') ||
      modelLower.includes('opus') ||
      modelLower.includes('sonnet') ||
      modelLower.includes('oss');

    if (is3p) {
      persistence.thirdParty5hTokens = (persistence.thirdParty5hTokens || 0) + input.totalTokens;
      persistence.thirdParty5hTurns = (persistence.thirdParty5hTurns || 0) + 1;
      persistence.thirdPartyWeeklyTokens = (persistence.thirdPartyWeeklyTokens || 0) + input.totalTokens;
      persistence.thirdPartyWeeklyTurns = (persistence.thirdPartyWeeklyTurns || 0) + 1;
    } else {
      persistence.gemini5hTokens = (persistence.gemini5hTokens || 0) + input.totalTokens;
      persistence.gemini5hTurns = (persistence.gemini5hTurns || 0) + 1;
      persistence.geminiWeeklyTokens = (persistence.geminiWeeklyTokens || 0) + input.totalTokens;
      persistence.geminiWeeklyTurns = (persistence.geminiWeeklyTurns || 0) + 1;
    }

    this.savePersistence(persistence, userKey, input.userEmail);
    this.cachedQuotaLimitsMap.delete(userKey);

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
    existing.totalTokens += input.totalTokens;
    existing.promptTokens += input.promptTokens;
    existing.completionTokens += input.completionTokens;
    existing.thinkingTokens += (input.thinkingTokens || 0);
    existing.cacheReadTokens += (input.cacheReadTokens || 0);
    existing.lastLatencyMs = input.latencyMs;
    existing.totalLatencyMs += input.latencyMs;

    if (input.sessionId) {
      this.sessionStatsMap.set(input.sessionId, existing);
    }

    const quotaLimits = await this.fetchCliQuotaLimits(userKey, persistence, input.userEmail);

    logger.info('[Antigravity Quota] Recorded turn', {
      userKey,
      userEmail: input.userEmail,
      model: input.model,
      turnTokens: input.totalTokens,
      userTotalTokens: persistence.totalTokens,
      userTotalTurns: persistence.totalTurns,
    });

    return {
      linked: true,
      userEmail: input.userEmail,
      totalTurns: existing.apiCalls,
      totalTokens: existing.totalTokens,
      promptTokens: existing.promptTokens,
      completionTokens: existing.completionTokens,
      thinkingTokens: existing.thinkingTokens,
      cacheReadTokens: existing.cacheReadTokens,
      lastLatencyMs: input.latencyMs,
      avgLatencyMs: Math.round(existing.totalLatencyMs / existing.apiCalls),
      quotaLimits,
      lastUpdated: new Date().toISOString(),
    };
  }
}

export const antigravityQuotaService = new AntigravityQuotaService();
export const geminiQuotaService = antigravityQuotaService;
export const GeminiQuotaService = AntigravityQuotaService;
