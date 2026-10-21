import { atom, type PrimitiveAtom } from 'jotai';

const getInitialDarkMode = (): boolean => {
  if (typeof window === 'undefined') return true;
  const saved = localStorage.getItem('theme_preference');
  if (saved === 'dark') return true;
  if (saved === 'light') return false;
  if (window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return true;
};

const getInitialInspectorOpen = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return window.innerWidth >= 1280;
  } catch {
    return false;
  }
};

export const isDarkModeAtom: PrimitiveAtom<boolean> = atom<boolean>(getInitialDarkMode());
export const isInspectorOpenAtom: PrimitiveAtom<boolean> = atom<boolean>(getInitialInspectorOpen());
export const isTelemetryModalOpenAtom: PrimitiveAtom<boolean> = atom<boolean>(false);
export const toastMessageAtom: PrimitiveAtom<string | null> = atom<string | null>(null);
export const isPageLoadingAtom: PrimitiveAtom<boolean> = atom<boolean>(true);
export const loadingMessageAtom: PrimitiveAtom<string> = atom<string>('Initializing Atelier Workspace');
export const loadingSubMessageAtom: PrimitiveAtom<string> = atom<string>('Verifying cloud credentials & session...');
export const inspectorTargetFilePathAtom: PrimitiveAtom<string | null> = atom<string | null>(null);
