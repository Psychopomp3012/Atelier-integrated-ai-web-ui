import { apiFetch } from '../utils/api.util';
import type { ModelOption } from '../types';

/**
 * Fetches available AI models dynamically discovered from Antigravity CLI.
 */
let inFlightModelsPromise: Promise<ModelOption[]> | null = null;
let lastModels: ModelOption[] | null = null;
let lastModelsUserId: string | null = null;
let lastModelsFetchTime = 0;

export function invalidateModelsCache(): void {
  lastModels = null;
  lastModelsUserId = null;
  lastModelsFetchTime = 0;
  inFlightModelsPromise = null;
}

export async function fetchAvailableModels(): Promise<ModelOption[]> {
  try {
    const res = await apiFetch('/api/v1/agent/models');
    if (!res.ok) {
      return [];
    }
    const json = await res.json();
    if (Array.isArray(json.data)) {
      return json.data as ModelOption[];
    }
    return [];
  } catch {
    return [];
  }
}
