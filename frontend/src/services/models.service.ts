import { apiFetch } from '../utils/api.util';
import type { ModelOption } from '../types';
import { AVAILABLE_MODELS } from '../types';

/**
 * Fetches available AI models dynamically discovered from Antigravity CLI.
 */
export async function fetchAvailableModels(): Promise<ModelOption[]> {
  try {
    const res = await apiFetch('/api/v1/agent/models');
    if (!res.ok) {
      return AVAILABLE_MODELS;
    }
    const json = await res.json();
    if (Array.isArray(json.data) && json.data.length > 0) {
      return json.data as ModelOption[];
    }
    return AVAILABLE_MODELS;
  } catch {
    return AVAILABLE_MODELS;
  }
}
