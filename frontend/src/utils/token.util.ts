import type { ChatMessage, ModelId, TokenUsageState, GeminiQuotaStats, CodexQuotaStats, ModelProvider } from '../types';

export function computeSessionTokens(
  messages: ChatMessage[],
  _selectedModel: ModelId,
  geminiQuota?: GeminiQuotaStats | null,
  codexQuota?: CodexQuotaStats | null,
  activeProvider: ModelProvider = 'gemini'
): TokenUsageState {
  const activeStats = activeProvider === 'codex' ? codexQuota : geminiQuota;

  const promptTokens = activeStats?.promptTokens ?? 0;
  const completionTokens = activeStats?.completionTokens ?? 0;
  const thinkingTokens = activeStats?.thinkingTokens ?? 0;
  const cacheReadTokens = (activeStats as any)?.cacheReadTokens ?? 0;
  const totalTokens = activeStats?.totalTokens ?? 0;
  const totalTurns = activeStats?.totalTurns ?? 0;

  // Extract latency from most recent assistant message in active session as immediate source of truth
  let lastMessageLatency = 0;
  if (messages && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant') {
        if (m.executionResult?.time) {
          const match = m.executionResult.time.match(/\d+/);
          if (match) {
            lastMessageLatency = parseInt(match[0], 10);
            break;
          }
        }
        if (m.latency) {
          const match = m.latency.match(/\d+/);
          if (match) {
            lastMessageLatency = parseInt(match[0], 10);
            break;
          }
        }
      }
    }
  }

  const lastLatencyMs =
    (activeStats?.lastLatencyMs && activeStats.lastLatencyMs > 0)
      ? activeStats.lastLatencyMs
      : lastMessageLatency;

  const avgLatencyMs =
    (activeStats?.avgLatencyMs && activeStats.avgLatencyMs > 0)
      ? activeStats.avgLatencyMs
      : lastLatencyMs;

  const linked = activeStats?.linked ?? false;
  const userEmail = activeStats?.userEmail;

  return {
    promptTokens,
    completionTokens,
    thinkingTokens,
    cacheReadTokens,
    totalTokens,
    totalTurns,
    lastLatencyMs,
    avgLatencyMs,
    linked,
    userEmail,
    quotaLimits: activeStats?.quotaLimits ?? null,
    geminiQuota,
    codexQuota,
    activeProvider,
  };
}

export function formatTokenMetric(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return tokens.toLocaleString();
}


