import { atom, type PrimitiveAtom } from 'jotai';
import type { ModelOption } from '../types';
import { preferencesService } from '../services/preferences.service';

const getInitialSelectedModel = (): string => {
  if (typeof window === 'undefined') return 'none';
  try {
    const prefs = preferencesService.getPreferences();
    if (prefs.selectedModelId) return prefs.selectedModelId;
  } catch {}
  return 'none';
};

export const selectedModelAtom: PrimitiveAtom<string> = atom(getInitialSelectedModel());
export const availableModelsAtom: PrimitiveAtom<ModelOption[]> = atom([] as ModelOption[]);
