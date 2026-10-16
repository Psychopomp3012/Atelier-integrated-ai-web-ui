import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { CodexQuotaStats, RecordTurnInput, CliQuotaLimits, QuotaGroup } from './quota.types.js';
import { cliAuthService } from '../auth/cli-auth.service.js';
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

interface CodexRateLimitWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}

interface CodexScannedRateLimits {
  limit_id?: string;
  primary?: CodexRateLimitWindow;
  secondary?: CodexRateLimitWindow;
  plan_type?: string;
}

export class CodexQuotaService {
  private readonly storagePath: string;
  private readonly sessionStatsMap: Map<string, SessionStats> = new Map();
  private cachedQuotaLimits: CliQuotaLimits | null = null;
  private lastQuotaFetchTime: number = 0;
  private scannedRateLimits: CodexScannedRateLimits | null = null;

  constructor() {
    this.storagePath = path.join(os.homedir(), '.codex', 'cli_usage_telemetry.json');
    this.scanSessionsTelemetry();
    this.fetchCodexQuotaLimits().catch(() => {});
  }

  /**
   * Scans ~/.codex/sessions directory for authentic CLI rollout token usage and rate limit events
   */
  public scanSessionsTelemetry(): CliTelemetryPersistence {
    const sessionsDir = path.join(os.homedir(), '.codex', 'sessions');
    let totalTurns = 0;
    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let thinkingTokens = 0;
    let cacheReadTokens = 0;
    let latestRateLimitTime = 0;

    const findJsonlFiles = (dir: string): string[] => {
      const files: string[] = [];
      if (!fs.existsSync(dir)) return files;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            files.push(...findJsonlFiles(fullPath));
          } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            files.push(fullPath);
          }
        }
      } catch {}
      return files;
    };

    try {
      const files = findJsonlFiles(sessionsDir);
      for (const file of files) {
        try {
          const content = fs.readFileSync(file, 'utf8');
          const lines = content.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.type === 'token_usage_record' && data.payload?.usage) {
                totalTurns += 1;
                const u = data.payload.usage;
                totalTokens += Number(u.total_tokens) || 0;
                promptTokens += Number(u.input_tokens) || 0;
                completionTokens += Number(u.output_tokens) || 0;
                thinkingTokens += Number(u.reasoning_output_tokens) || 0;
                cacheReadTokens += Number(u.cached_input_tokens) || 0;
              }
              if (data.type === 'event_msg' && data.payload?.rate_limits) {
                const eventTime = data.timestamp ? new Date(data.timestamp).getTime() : 0;
                if (eventTime >= latestRateLimitTime) {
                  latestRateLimitTime = eventTime;
                  this.scannedRateLimits = data.payload.rate_limits;
                }
              }
            } catch {}
          }
        } catch {}
      }
    } catch (err) {
      logger.warn('Failed to scan ~/.codex/sessions for telemetry', { error: String(err) });
    }

    return {
      totalTurns,
      totalTokens,
      promptTokens,
      completionTokens,
      thinkingTokens,
      cacheReadTokens,
      lastLatencyMs: 0,
      totalLatencyMs: 0,
    };
  }

  /**
   * Fetches authentic OpenAI Codex quota and model limits from ~/.codex configuration
   */
  public async fetchCodexQuotaLimits(): Promise<CliQuotaLimits | null> {
    if (!this.scannedRateLimits) {
      this.scanSessionsTelemetry();
    }

    const now = Date.now();
    if (
      this.cachedQuotaLimits &&
      this.cachedQuotaLimits.groups.length > 0 &&
      now - this.lastQuotaFetchTime < 30_000
    ) {
      return this.cachedQuotaLimits;
    }

    try {
      let version = '0.162.1';
      const versionPath = path.join(os.homedir(), '.codex', 'version.json');
      if (fs.existsSync(versionPath)) {
        try {
          const vData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
          if (vData.latest_version) version = vData.latest_version;
        } catch {}
      }

      const groups: QuotaGroup[] = [];
      if (this.scannedRateLimits?.primary) {
        const primary = this.scannedRateLimits.primary;
        const usedPct = typeof primary.used_percent === 'number' ? primary.used_percent : 0;
        const remainingFraction = Math.max(0, Math.min(1, (100 - usedPct) / 100));
        const resetTime = primary.resets_at
          ? new Date(primary.resets_at * 1000).toISOString()
          : new Date(Date.now() + (primary.window_minutes || 43200) * 60 * 1000).toISOString();

        const planName = (this.scannedRateLimits.plan_type || 'ChatGPT').toUpperCase();
        const windowDesc = primary.window_minutes
          ? primary.window_minutes <= 360
            ? `${Math.round(primary.window_minutes / 60)}h rolling window`
            : `${Math.round(primary.window_minutes / 1440)}d rolling window`
          : 'Monthly rolling window';

        const primaryWindowType =
          primary.window_minutes && primary.window_minutes <= 360
            ? '5h'
            : primary.window_minutes && primary.window_minutes <= 10080
            ? 'weekly'
            : 'monthly';

        const buckets = [
          {
            id: 'codex-rolling-limit',
            name:
              primaryWindowType === '5h'
                ? '5-Hour Rolling Limit'
                : primaryWindowType === 'weekly'
                ? 'Weekly Quota Limit'
                : 'ChatGPT Rolling Limit',
            description: 'Enforced dynamically by OpenAI ChatGPT infrastructure',
            window: primaryWindowType,
            remaining_fraction: remainingFraction,
            reset_time: resetTime,
          },
        ];

        if (this.scannedRateLimits?.secondary) {
          const secondary = this.scannedRateLimits.secondary;
          const secUsedPct = typeof secondary.used_percent === 'number' ? secondary.used_percent : 0;
          const secRemainingFraction = Math.max(0, Math.min(1, (100 - secUsedPct) / 100));
          const secResetTime = secondary.resets_at
            ? new Date(secondary.resets_at * 1000).toISOString()
            : new Date(Date.now() + (secondary.window_minutes || 10080) * 60 * 1000).toISOString();

          const secWindowType =
            secondary.window_minutes && secondary.window_minutes <= 360
              ? '5h'
              : secondary.window_minutes && secondary.window_minutes <= 10080
              ? 'weekly'
              : 'monthly';

          buckets.push({
            id: 'codex-secondary-limit',
            name: secWindowType === 'weekly' ? 'Weekly Tier Quota' : 'Extended Limit',
            description: 'Longer-term quota ceiling enforced by OpenAI',
            window: secWindowType,
            remaining_fraction: secRemainingFraction,
            reset_time: secResetTime,
          });
        }

        groups.push({
          name: `OPENAI CODEX (${planName})`,
          description: `Authenticated via ChatGPT OAuth (${windowDesc})`,
          buckets,
        });
      }

      this.cachedQuotaLimits = {
        description: `OpenAI Codex CLI (v${version}) authenticated via ChatGPT Account`,
        groups,
        fetchedAt: new Date().toISOString(),
      };
      this.lastQuotaFetchTime = Date.now();
      return this.cachedQuotaLimits;
    } catch (err) {
      logger.warn('Failed to construct Codex quota limits', { error: String(err) });
      return null;
    }
  }

  private loadPersistence(): CliTelemetryPersistence {
    const scanned = this.scanSessionsTelemetry();
    let current: CliTelemetryPersistence = {
      totalTurns: 0,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      thinkingTokens: 0,
      cacheReadTokens: 0,
      lastLatencyMs: 0,
      totalLatencyMs: 0,
    };

    try {
      if (fs.existsSync(this.storagePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.storagePath, 'utf8')) as CliTelemetryPersistence;
        current = {
          totalTurns: parsed.totalTurns || 0,
          totalTokens: parsed.totalTokens || 0,
          promptTokens: parsed.promptTokens || 0,
          completionTokens: parsed.completionTokens || 0,
          thinkingTokens: parsed.thinkingTokens || 0,
          cacheReadTokens: parsed.cacheReadTokens || 0,
          lastLatencyMs: parsed.lastLatencyMs || 0,
          totalLatencyMs: parsed.totalLatencyMs || 0,
        };
      }
    } catch (err) {
      logger.warn('Failed to parse Codex CLI usage persistence, initializing fresh', { error: String(err) });
    }

    const merged: CliTelemetryPersistence = {
      totalTurns: Math.max(current.totalTurns, scanned.totalTurns),
      totalTokens: Math.max(current.totalTokens, scanned.totalTokens),
      promptTokens: Math.max(current.promptTokens, scanned.promptTokens),
      completionTokens: Math.max(current.completionTokens, scanned.completionTokens),
      thinkingTokens: Math.max(current.thinkingTokens, scanned.thinkingTokens),
      cacheReadTokens: Math.max(current.cacheReadTokens, scanned.cacheReadTokens),
      lastLatencyMs: current.lastLatencyMs || scanned.lastLatencyMs || 0,
      totalLatencyMs: current.totalLatencyMs || scanned.totalLatencyMs || 0,
    };

    if (
      merged.totalTurns !== current.totalTurns ||
      merged.totalTokens !== current.totalTokens ||
      merged.cacheReadTokens !== current.cacheReadTokens
    ) {
      this.savePersistence(merged);
    }

    return merged;
  }

  private savePersistence(data: CliTelemetryPersistence): void {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch (err) {
      logger.error('Failed to write Codex CLI telemetry storage', err);
    }
  }

  /**
   * Resolves authentic Codex CLI telemetry and quota.
   */
  public async getCodexQuota(userEmail?: string, sessionId?: string, userId?: string): Promise<CodexQuotaStats> {
    const effectiveUserId = userId || (userEmail ? cliAuthService.getUserIdByEmail(userEmail) : undefined) || undefined;
    const isLinked = Boolean(
      (effectiveUserId && cliAuthService.isUserCliLinked(effectiveUserId, 'codex')) ||
      (userEmail && cliAuthService.isUserCliLinkedByEmail(userEmail, 'codex'))
    );
    const cliStatus = cliAuthService.getCliStatus(effectiveUserId, userEmail);

    logger.debug('[Codex Quota] Evaluated Codex link status', {
      userId,
      userEmail,
      effectiveUserId,
      isLinked,
    });

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

    const persistence = this.loadPersistence();
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

    const quotaLimits = await this.fetchCodexQuotaLimits();

    return {
      linked: true,
      userEmail: email,
      userName: 'ChatGPT Account',
      authMethod: 'ChatGPT OAuth',
      totalTurns: effectiveCalls,
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
   * Records a turn completed by the Codex CLI.
   */
  public async recordTurn(input: RecordTurnInput): Promise<CodexQuotaStats> {
    const persistence = this.loadPersistence();

    persistence.totalTurns += 1;
    persistence.totalTokens += input.totalTokens;
    persistence.promptTokens += input.promptTokens;
    persistence.completionTokens += input.completionTokens;
    persistence.thinkingTokens += (input.thinkingTokens || 0);
    persistence.cacheReadTokens += (input.cacheReadTokens || 0);
    persistence.lastLatencyMs = input.latencyMs;
    persistence.totalLatencyMs = (persistence.totalLatencyMs || 0) + input.latencyMs;
    this.savePersistence(persistence);

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

    this.lastQuotaFetchTime = 0;

    logger.info('Recorded authentic Codex CLI telemetry turn', {
      totalTurns: persistence.totalTurns,
      inputTokens: input.promptTokens,
      outputTokens: input.completionTokens,
      thinkingTokens: input.thinkingTokens,
      totalTokens: input.totalTokens,
      latencyMs: input.latencyMs,
    });

    return this.getCodexQuota(input.userEmail, input.sessionId);
  }
}

export const codexQuotaService = new CodexQuotaService();
