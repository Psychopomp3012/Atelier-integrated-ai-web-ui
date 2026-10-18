import { apiFetch } from '../utils/api.util';
import type { ModelOption } from '../types';

/**
 * Fetches available AI models dynamically discovered from Antigravity CLI.
 */
let inFlightModelsPromise: Promise<ModelOption[]> | null = null;
let lastModels: ModelOption[] | null = null;
let lastModelsFetchTime = 0;
const MODELS_CACHE_TTL = 4000;

export function invalidateModelsCache(): void {
  lastModels = null;
  lastModelsFetchTime = 0;
  inFlightModelsPromise = null;
}

/**
 * Fetches available AI models dynamically discovered from installed CLIs.
 * In-flight promise sharing and short-term deduplication prevents burst duplicate calls.
 */
export async function fetchAvailableModels(force = false, sessionId?: string, userId?: string): Promise<ModelOption[]> {
  if (!userId) {
    return [];
  }
  const now = Date.now();
  if (!force && lastModels && now - lastModelsFetchTime < MODELS_CACHE_TTL) {
    return lastModels;
  }
  // Deduplicate burst calls within 1.5s regardless of force flag
  if (lastModels && now - lastModelsFetchTime < 1500) {
    return lastModels;
  }
  if (inFlightModelsPromise) {
    return inFlightModelsPromise;
  }

  inFlightModelsPromise = (async () => {
    try {
      const params = new URLSearchParams();
      if (sessionId) params.set('sessionId', sessionId);
      if (userId) params.set('userId', userId);
      const qStr = params.toString() ? `?${params.toString()}` : '';

      const res = await apiFetch(`/api/v1/agent/models${qStr}`);
      if (!res.ok) {
        return lastModels || [];
      }
      const json = await res.json();
      if (Array.isArray(json.data) && json.data.length > 0) {
        lastModels = json.data as ModelOption[];
        lastModelsFetchTime = Date.now();
        return lastModels;
      }
      return lastModels || [];
    } catch {
      return lastModels || [];
    } finally {
      inFlightModelsPromise = null;
    }
  })();

  return inFlightModelsPromise;
}
