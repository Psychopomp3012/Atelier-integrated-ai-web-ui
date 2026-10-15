import type { ModelOption, GeminiQuotaStats, CodexQuotaStats, QuotaGroup } from '../types';
import type { CliStatus } from '../services/cliAuth.service';

/**
 * Checks if any bucket in the matched quota group has remaining_fraction <= 0
 */
export function isQuotaGroupExhausted(
  groups: QuotaGroup[] | undefined,
  matchFn: (group: QuotaGroup) => boolean
): boolean {
  const group = groups?.find(matchFn);
  return Boolean(
    group?.buckets?.some((b) => typeof b.remaining_fraction === 'number' && b.remaining_fraction <= 0)
  );
}

/**
 * Checks whether a specific model's quota or model group quota is exhausted.
 */
export function checkModelQuotaExhausted(
  model: ModelOption | undefined,
  geminiQuota?: GeminiQuotaStats | null,
  codexQuota?: CodexQuotaStats | null,
  cliStatus?: CliStatus | null
): boolean {
  if (!model || model.id === 'none') return false;

  const geminiGroups = geminiQuota?.quotaLimits?.groups;
  const isGeminiQuotaExhausted = isQuotaGroupExhausted(
    geminiGroups,
    (g) =>
      g.buckets?.some((b) => b.id?.toLowerCase().startsWith('gemini')) ||
      g.name?.toLowerCase().includes('gemini')
  );

  const isThirdPartyQuotaExhausted = isQuotaGroupExhausted(
    geminiGroups,
    (g) =>
      g.buckets?.some((b) => b.id?.toLowerCase().startsWith('3p')) ||
      g.name?.toLowerCase().includes('claude') ||
      g.name?.toLowerCase().includes('gpt')
  );

  if (model.hostedBy === 'antigravity' || model.provider === 'gemini') {
    const isThirdParty =
      model.id.toLowerCase().includes('claude') ||
      model.id.toLowerCase().includes('gpt') ||
      model.name.toLowerCase().includes('claude') ||
      model.name.toLowerCase().includes('gpt');
    return isThirdParty ? isThirdPartyQuotaExhausted : isGeminiQuotaExhausted;
  }

  if (model.provider === 'codex') {
    if (cliStatus?.codex?.linked) {
      const codexGroup = codexQuota?.quotaLimits?.groups?.[0];
      return Boolean(
        codexGroup?.buckets?.some(
          (b) => typeof b.remaining_fraction === 'number' && b.remaining_fraction <= 0
        )
      );
    }
    return isThirdPartyQuotaExhausted;
  }

  if (model.provider === 'claude') {
    return isThirdPartyQuotaExhausted;
  }

  return false;
}
