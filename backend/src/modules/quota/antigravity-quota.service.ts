import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AntigravityQuotaStats, GeminiQuotaStats, RecordTurnInput, CliQuotaLimits, QuotaGroup } from './quota.types.js';
import { cliAuthService } from '../auth/cli-auth.service.js';
import { firestoreBackendService } from '../../services/firestore.service.js';
import { logger } from '../../utils/logger.util.js';

const execFileAsync = promisify(execFile);

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
  lastQuotaLimits?: CliQuotaLimits;
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
  private readonly defaultStoragePath: string;
  private readonly sessionStatsMap: Map<string, SessionStats> = new Map();
  private readonly cachedQuotaLimitsMap: Map<string, { limits: CliQuotaLimits; timestamp: number }> = new Map();

  constructor() {
    this.defaultStoragePath = path.join(os.homedir(), '.gemini', 'cli_usage_telemetry.json');
  }

  private getUserTelemetryPath(userKey: string): string {
    const baseDir = path.join(os.homedir(), '.gemini', 'telemetry');
    if (!fs.existsSync(baseDir)) {
      try {
        fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
      } catch {}
    }
    const clean = userKey.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(baseDir, `${clean}.json`);
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
      lastQuotaLimits: parsed?.lastQuotaLimits && Array.isArray(parsed.lastQuotaLimits.groups)
        ? {
            description: String(parsed.lastQuotaLimits.description || ''),
            fetchedAt: String(parsed.lastQuotaLimits.fetchedAt || ''),
            groups: parsed.lastQuotaLimits.groups.map((g: any) => ({
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
            })),
          }
        : undefined,
    } as CliTelemetryPersistence;
  }

  private loadPersistence(userKey?: string, userEmail?: string): CliTelemetryPersistence {
    if (userKey && userKey !== 'default') {
      const userFilePath = this.getUserTelemetryPath(userKey);
      if (fs.existsSync(userFilePath)) {
        try {
          const raw = fs.readFileSync(userFilePath, 'utf8');
          const parsed = JSON.parse(raw);
          return this.sanitizePersistence(parsed);
        } catch {}
      }

      // STRICT MULTI-TENANT ISOLATION:
      // Never fall back to defaultStoragePath for named users!
      // Return a clean initial state with 0 turns and 0 tokens.
      return {
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
    }

    if (fs.existsSync(this.defaultStoragePath)) {
      try {
        const raw = fs.readFileSync(this.defaultStoragePath, 'utf8');
        const parsed = JSON.parse(raw);
        return this.sanitizePersistence(parsed);
      } catch {}
    }

    return {
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
  }

  private async loadPersistenceAsync(userKey?: string, userEmail?: string): Promise<CliTelemetryPersistence> {
    if (userKey && userKey !== 'default') {
      const userFilePath = this.getUserTelemetryPath(userKey);
      if (fs.existsSync(userFilePath)) {
        try {
          const raw = fs.readFileSync(userFilePath, 'utf8');
          const parsed = JSON.parse(raw);
          return this.sanitizePersistence(parsed);
        } catch {}
      }

      // Check persistent storage in Firebase Firestore
      try {
        const firestoreData = await firestoreBackendService.getUserTelemetry(userKey, userEmail, 'antigravity');
        if (firestoreData) {
          const sanitized = this.sanitizePersistence(firestoreData);
          try {
            fs.writeFileSync(userFilePath, JSON.stringify(sanitized, null, 2), 'utf8');
          } catch {}
          return sanitized;
        }
      } catch {}

      // Fresh user initial state: 0 tokens, 0 turns
      const freshUserTelemetry: CliTelemetryPersistence = {
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
      try {
        fs.writeFileSync(userFilePath, JSON.stringify(freshUserTelemetry, null, 2), 'utf8');
      } catch {}

      firestoreBackendService.saveUserTelemetry(userKey, freshUserTelemetry, 'antigravity', userEmail).catch(() => {});
      return freshUserTelemetry;
    }

    return this.loadPersistence(userKey, userEmail);
  }

  private savePersistence(data: CliTelemetryPersistence, userKey?: string, userEmail?: string): void {
    const json = JSON.stringify(data, null, 2);
    if (userKey && userKey !== 'default') {
      try {
        const userFilePath = this.getUserTelemetryPath(userKey);
        fs.writeFileSync(userFilePath, json, 'utf8');
      } catch {}
      // Persist to Firebase Firestore
      firestoreBackendService.saveUserTelemetry(userKey, data, 'antigravity', userEmail).catch(() => {});
    } else {
      try {
        const dir = path.dirname(this.defaultStoragePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.defaultStoragePath, json, 'utf8');
      } catch {}
    }
  }

  /**
   * Queries live authentic Antigravity quota from Google's Code Assist backend via CLI.
   * Completely avoids any hardcoded values, fictitious databases, or synthetic token arithmetic.
   */
  private async queryLiveGoogleQuota(): Promise<CliQuotaLimits | null> {
    try {
      const bin = cliAuthService.getAntigravityBin();
      const { stdout } = await execFileAsync(bin, ['-p', '/quota', '--output-format', 'json'], { timeout: 15000 });
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
    userEmail?: string
  ): Promise<CliQuotaLimits> {
    const cached = this.cachedQuotaLimitsMap.get(userKey);
    const now = Date.now();
    if (cached && now - cached.timestamp < 30000) {
      return cached.limits;
    }

    // Live Google API integration
    const liveLimits = await this.queryLiveGoogleQuota();
    if (liveLimits && liveLimits.groups.length > 0) {
      persistence.lastQuotaLimits = liveLimits;
      this.savePersistence(persistence, userKey, userEmail);
      this.cachedQuotaLimitsMap.set(userKey, { limits: liveLimits, timestamp: now });
      return liveLimits;
    }

    // If live call returned null, use persistent authentic quota snapshot if available
    if (persistence.lastQuotaLimits && persistence.lastQuotaLimits.groups.length > 0) {
      this.cachedQuotaLimitsMap.set(userKey, { limits: persistence.lastQuotaLimits, timestamp: now });
      return persistence.lastQuotaLimits;
    }

    // Clean initial fallback if no authentic snapshot exists yet (never fabricate or hardcode values)
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

    const quotaLimits = await this.fetchCliQuotaLimits(userKey, persistence, email);

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
