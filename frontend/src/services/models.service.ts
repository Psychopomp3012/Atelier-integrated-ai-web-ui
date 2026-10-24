import { apiFetch } from '../utils/api.util';
import type { ModelOption } from '../types';

/**
 * Fetches available AI models dynamically discovered from Antigravity CLI.
 */

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
