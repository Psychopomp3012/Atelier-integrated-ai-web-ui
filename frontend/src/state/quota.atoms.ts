import { atom, type PrimitiveAtom } from 'jotai';
import type { AntigravityQuotaStats, GeminiQuotaStats, CodexQuotaStats, RateLimitState } from '../types';

export const antigravityQuotaAtom: PrimitiveAtom<AntigravityQuotaStats | null> = atom<AntigravityQuotaStats | null>(null);
export const geminiQuotaAtom: PrimitiveAtom<GeminiQuotaStats | null> = antigravityQuotaAtom;
export const codexQuotaAtom: PrimitiveAtom<CodexQuotaStats | null> = atom<CodexQuotaStats | null>(null);
export const rateLimitAtom: PrimitiveAtom<RateLimitState> = atom<RateLimitState>({
  limit: 100,
  remaining: 100,
  resetInSeconds: 0,
});
export const isFetchingQuotaAtom: PrimitiveAtom<boolean> = atom<boolean>(false);
