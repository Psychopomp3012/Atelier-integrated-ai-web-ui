export interface CliUsageTelemetry {
  input_tokens: number;
  output_tokens: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens: number;
  duration_seconds?: number;
  num_turns?: number;
}

export interface QuotaBucket {
  id: string;
  name: string;
  description: string;
  window: string;
  remaining_fraction: number;
  reset_time: string;
}

export interface QuotaGroup {
  name: string;
  description: string;
  buckets: QuotaBucket[];
}

export interface CliQuotaLimits {
  description?: string;
  groups: QuotaGroup[];
  fetchedAt: string;
}

export type AntigravityQuotaStats = {
  linked: boolean;
  userEmail?: string;
  userName?: string;
  totalTurns: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  lastLatencyMs: number;
  avgLatencyMs: number;
  quotaLimits?: CliQuotaLimits | null;
  lastUpdated: string;
};

export type GeminiQuotaStats = AntigravityQuotaStats;

export interface CodexQuotaStats {
  linked: boolean;
  userEmail?: string;
  userName?: string;
  authMethod?: string;
  totalTurns: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  lastLatencyMs: number;
  avgLatencyMs: number;
  quotaLimits?: CliQuotaLimits | null;
  lastUpdated: string;
}

export interface RecordTurnInput {
  sessionId?: string;
  userEmail?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  thinkingTokens?: number;
  cacheReadTokens?: number;
  totalTokens: number;
  latencyMs: number;
}
