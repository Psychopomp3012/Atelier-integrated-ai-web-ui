import { atom, type PrimitiveAtom } from 'jotai';
import type { GeminiQuotaStats, CodexQuotaStats, RateLimitState } from '../types';

export const geminiQuotaAtom: PrimitiveAtom<GeminiQuotaStats | null> = atom<GeminiQuotaStats | null>(null);
export const codexQuotaAtom: PrimitiveAtom<CodexQuotaStats | null> = atom<CodexQuotaStats | null>(null);
export const rateLimitAtom: PrimitiveAtom<RateLimitState> = atom<RateLimitState>({
  limit: 100,
  remaining: 100,
  resetInSeconds: 0,
});
