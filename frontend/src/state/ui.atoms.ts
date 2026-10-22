import { atom, type PrimitiveAtom } from 'jotai';
import { preferencesService } from '../services/preferences.service';

const getInitialDarkMode = (): boolean => {
  if (typeof window === 'undefined') return true;
  const prefs = preferencesService.getPreferences();
  if (prefs.theme === 'dark') return true;
  if (prefs.theme === 'light') return false;
  if (window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return true;
};

const getInitialInspectorOpen = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const prefs = preferencesService.getPreferences();
    if (prefs.isInspectorOpen !== undefined) {
      return prefs.isInspectorOpen;
    }
    return window.innerWidth >= 1280;
  } catch {
    return false;
  }
};

export const isDarkModeAtom: PrimitiveAtom<boolean> = atom(getInitialDarkMode());
export const isInspectorOpenAtom: PrimitiveAtom<boolean> = atom(getInitialInspectorOpen());
export const isTelemetryModalOpenAtom: PrimitiveAtom<boolean> = atom(false);
export const toastMessageAtom: PrimitiveAtom<string | null> = atom(null as string | null);
export const isPageLoadingAtom: PrimitiveAtom<boolean> = atom(true);
export const loadingMessageAtom: PrimitiveAtom<string> = atom('Initializing Atelier Workspace');
export const loadingSubMessageAtom: PrimitiveAtom<string> = atom('Verifying cloud credentials & session...');
export const inspectorTargetFilePathAtom: PrimitiveAtom<string | null> = atom(null as string | null);
