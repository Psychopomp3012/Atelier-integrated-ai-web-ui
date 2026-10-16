import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AntigravityQuotaStats, GeminiQuotaStats, RecordTurnInput, CliQuotaLimits } from './quota.types.js';
import { cliAuthService } from '../auth/cli-auth.service.js';
import { logger } from '../../utils/logger.util.js';

interface AuthenticLimitsData {
  gemini5hFraction: number;
  gemini5hReset: string;
  geminiWeeklyFraction: number;
  geminiWeeklyReset: string;
  thirdParty5hFraction: number;
  thirdParty5hReset: string;
  thirdPartyWeeklyFraction: number;
  thirdPartyWeeklyReset: string;
  fetchedAt?: string;
}

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
  lastAuthenticLimits?: AuthenticLimitsData;
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
      lastAuthenticLimits: parsed?.lastAuthenticLimits
        ? {
            gemini5hFraction: Number(parsed.lastAuthenticLimits.gemini5hFraction) || 1,
            gemini5hReset: String(parsed.lastAuthenticLimits.gemini5hReset || ''),
            geminiWeeklyFraction: Number(parsed.lastAuthenticLimits.geminiWeeklyFraction) || 1,
            geminiWeeklyReset: String(parsed.lastAuthenticLimits.geminiWeeklyReset || ''),
            thirdParty5hFraction: Number(parsed.lastAuthenticLimits.thirdParty5hFraction) || 1,
            thirdParty5hReset: String(parsed.lastAuthenticLimits.thirdParty5hReset || ''),
            thirdPartyWeeklyFraction: Number(parsed.lastAuthenticLimits.thirdPartyWeeklyFraction) || 1,
            thirdPartyWeeklyReset: String(parsed.lastAuthenticLimits.thirdPartyWeeklyReset || ''),
            fetchedAt: String(parsed.lastAuthenticLimits.fetchedAt || ''),
          }
        : undefined,
    } as CliTelemetryPersistence;
  }

  private loadPersistence(userKey?: string): CliTelemetryPersistence {
    if (userKey) {
      const userFilePath = this.getUserTelemetryPath(userKey);
      if (fs.existsSync(userFilePath)) {
        try {
          const raw = fs.readFileSync(userFilePath, 'utf8');
          const parsed = JSON.parse(raw);
          return this.sanitizePersistence(parsed);
        } catch {}
      }
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

  private savePersistence(data: CliTelemetryPersistence, userKey?: string): void {
    const json = JSON.stringify(data, null, 2);
    if (userKey) {
      try {
        const userFilePath = this.getUserTelemetryPath(userKey);
        fs.writeFileSync(userFilePath, json, 'utf8');
      } catch {}
    }
    try {
      const dir = path.dirname(this.defaultStoragePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.defaultStoragePath, json, 'utf8');
    } catch {}
  }

  /**
   * Reads authentic Antigravity quota from the official SQLite DB.
   */
  private readAuthenticDbLimits(): AuthenticLimitsData | null {
    try {
      const dbPath = path.join(os.homedir(), '.gemini', 'antigravity.db');
      if (!fs.existsSync(dbPath)) return null;

      const raw = fs.readFileSync(dbPath);
      const str = raw.toString('utf8', 0, Math.min(raw.length, 500000));

      const extractWindow = (targetPrefix: string) => {
        let remaining_fraction = 1.0;
        let reset_time = '';
        const idx = str.indexOf(targetPrefix);
        if (idx !== -1) {
          const chunk = str.substring(idx, idx + 1500);
          const fracMatch = chunk.match(/"remaining_fraction":\s*([0-9.]+)/i);
          if (fracMatch) remaining_fraction = parseFloat(fracMatch[1]);
          const resetMatch = chunk.match(/"reset_time":\s*"([^"]+)"/i);
          if (resetMatch) reset_time = resetMatch[1];
        }
        return { remaining_fraction, reset_time };
      };

      const gemini5h = extractWindow('models/gemini-2.5-flash');
      const geminiWeekly = extractWindow('models/gemini-2.5-pro');
      const tp5h = extractWindow('models/claude-3-7-sonnet');
      const tpWeekly = extractWindow('models/gpt-4o');

      const isDefault =
        gemini5h.remaining_fraction === 1.0 &&
        geminiWeekly.remaining_fraction === 1.0 &&
        tp5h.remaining_fraction === 1.0 &&
        tpWeekly.remaining_fraction === 1.0;

      if (isDefault) return null;

      return {
        gemini5hFraction: gemini5h.remaining_fraction,
        gemini5hReset: gemini5h.reset_time,
        geminiWeeklyFraction: geminiWeekly.remaining_fraction,
        geminiWeeklyReset: geminiWeekly.reset_time,
        thirdParty5hFraction: tp5h.remaining_fraction,
        thirdParty5hReset: tp5h.reset_time,
        thirdPartyWeeklyFraction: tpWeekly.remaining_fraction,
        thirdPartyWeeklyReset: tpWeekly.reset_time,
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  private async fetchCliQuotaLimits(userKey: string, persistence: CliTelemetryPersistence): Promise<CliQuotaLimits> {
    const cached = this.cachedQuotaLimitsMap.get(userKey);
    const now = Date.now();
    if (cached && now - cached.timestamp < 10000) {
      return cached.limits;
    }

    const fiveHoursMs = 5 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    let window5hStart = persistence.window5hStart || now;
    if (now - window5hStart > fiveHoursMs) {
      window5hStart = now;
      persistence.window5hStart = now;
      persistence.gemini5hTokens = 0;
      persistence.gemini5hTurns = 0;
      persistence.thirdParty5hTokens = 0;
      persistence.thirdParty5hTurns = 0;
      this.savePersistence(persistence, userKey);
    }

    let weeklyStart = persistence.weeklyStart || now;
    if (now - weeklyStart > sevenDaysMs) {
      weeklyStart = now;
      persistence.weeklyStart = now;
      persistence.geminiWeeklyTokens = 0;
      persistence.geminiWeeklyTurns = 0;
      persistence.thirdPartyWeeklyTokens = 0;
      persistence.thirdPartyWeeklyTurns = 0;
      this.savePersistence(persistence, userKey);
    }

    const dbLimits = this.readAuthenticDbLimits();
    if (dbLimits) {
      persistence.lastAuthenticLimits = dbLimits;
      this.savePersistence(persistence, userKey);
    }

    const effectiveLimits = dbLimits || persistence.lastAuthenticLimits;

    let gemini5hFraction: number;
    let gemini5hReset: string;
    let geminiWeeklyFraction: number;
    let geminiWeeklyReset: string;

    let tp5hFraction: number;
    let tp5hReset: string;
    let tpWeeklyFraction: number;
    let tpWeeklyReset: string;

    if (effectiveLimits) {
      gemini5hFraction = effectiveLimits.gemini5hFraction;
      gemini5hReset = effectiveLimits.gemini5hReset || new Date(window5hStart + fiveHoursMs).toISOString();
      geminiWeeklyFraction = effectiveLimits.geminiWeeklyFraction;
      geminiWeeklyReset = effectiveLimits.geminiWeeklyReset || new Date(weeklyStart + sevenDaysMs).toISOString();

      tp5hFraction = effectiveLimits.thirdParty5hFraction;
      tp5hReset = effectiveLimits.thirdParty5hReset || new Date(window5hStart + fiveHoursMs).toISOString();
      tpWeeklyFraction = effectiveLimits.thirdPartyWeeklyFraction;
      tpWeeklyReset = effectiveLimits.thirdPartyWeeklyReset || new Date(weeklyStart + sevenDaysMs).toISOString();
    } else {
      const GEMINI_5H_MAX_TOKENS = 800000;
      const GEMINI_WEEKLY_MAX_TOKENS = 5000000;
      const TP_5H_MAX_TOKENS = 250000;
      const TP_WEEKLY_MAX_TOKENS = 1500000;

      const g5hTokens = persistence.gemini5hTokens || 0;
      const gWeeklyTokens = persistence.geminiWeeklyTokens || 0;
      const tp5hTokens = persistence.thirdParty5hTokens || 0;
      const tpWeeklyTokens = persistence.thirdPartyWeeklyTokens || 0;

      gemini5hFraction = Math.max(0, Math.min(1, 1 - g5hTokens / GEMINI_5H_MAX_TOKENS));
      geminiWeeklyFraction = Math.max(0, Math.min(1, 1 - gWeeklyTokens / GEMINI_WEEKLY_MAX_TOKENS));
      gemini5hReset = new Date(window5hStart + fiveHoursMs).toISOString();
      geminiWeeklyReset = new Date(weeklyStart + sevenDaysMs).toISOString();

      tp5hFraction = Math.max(0, Math.min(1, 1 - tp5hTokens / TP_5H_MAX_TOKENS));
      tpWeeklyFraction = Math.max(0, Math.min(1, 1 - tpWeeklyTokens / TP_WEEKLY_MAX_TOKENS));
      tp5hReset = new Date(window5hStart + fiveHoursMs).toISOString();
      tpWeeklyReset = new Date(weeklyStart + sevenDaysMs).toISOString();
    }

    const limits: CliQuotaLimits = {
      description: 'Antigravity CLI native and third-party hosted limits',
      fetchedAt: new Date().toISOString(),
      groups: [
        {
          name: 'Gemini Models',
          description: 'Gemini 3.8 Flash, Pro, and Ultra reasoning models',
          buckets: [
            {
              id: 'gemini-5h',
              name: '5-Hour Rolling Limit',
              description: 'Usage across Gemini models within a 5-hour rolling window',
              window: '5h',
              remaining_fraction: gemini5hFraction,
              reset_time: gemini5hReset,
            },
            {
              id: 'gemini-weekly',
              name: 'Weekly Limit',
              description: 'Usage across Gemini models within a 7-day rolling window',
              window: '7d',
              remaining_fraction: geminiWeeklyFraction,
              reset_time: geminiWeeklyReset,
            },
          ],
        },
        {
          name: 'Claude & GPT Models',
          description: 'Anthropic Claude and OpenAI models hosted via Antigravity CLI',
          buckets: [
            {
              id: '3p-5h',
              name: '5-Hour Rolling Limit',
              description: 'Usage across third-party models in 5-hour window',
              window: '5h',
              remaining_fraction: tp5hFraction,
              reset_time: tp5hReset,
            },
            {
              id: '3p-weekly',
              name: 'Weekly Limit',
              description: 'Usage across third-party models in 7-day window',
              window: '7d',
              remaining_fraction: tpWeeklyFraction,
              reset_time: tpWeeklyReset,
            },
          ],
        },
      ],
    };

    this.cachedQuotaLimitsMap.set(userKey, { limits, timestamp: now });
    return limits;
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

    logger.debug('[Antigravity Quota] Evaluated Antigravity link status', {
      userId,
      userEmail,
      effectiveUserId,
      isLinked,
    });

    if (!isLinked) {
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
    const persistence = this.loadPersistence(userKey);
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

    const quotaLimits = await this.fetchCliQuotaLimits(userKey, persistence);

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

    const persistence = this.loadPersistence(userKey);

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

    this.savePersistence(persistence, userKey);
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

    const quotaLimits = await this.fetchCliQuotaLimits(userKey, persistence);

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
