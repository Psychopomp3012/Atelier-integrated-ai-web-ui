import { atom, type PrimitiveAtom } from 'jotai';
import type { ModelOption } from '../types';

const getInitialSelectedModel = (): string => {
  if (typeof window === 'undefined') return 'none';
  try {
    const saved = localStorage.getItem('model_preference');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && parsed.modelId) {
          return parsed.modelId;
        }
      } catch {
        return saved;
      }
    }
    const direct = localStorage.getItem('selected_model_preference');
    if (direct) return direct;
  } catch {}
  return 'none';
};

export const selectedModelAtom: PrimitiveAtom<string> = atom<string>(getInitialSelectedModel());
export const availableModelsAtom: PrimitiveAtom<ModelOption[]> = atom<ModelOption[]>([]);
