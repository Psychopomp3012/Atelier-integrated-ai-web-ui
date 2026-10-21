import { atom, type PrimitiveAtom } from 'jotai';

export interface SandboxRecord {
  sandboxId: string;
  name: string;
  sessionId?: string;
  lastActiveAt: number;
  createdAt: number;
  lastUpdateCheckAt?: number;
  isUpdating?: boolean;
  isProvisioning?: boolean;
}

export interface SandboxUsageState {
  used: number;
  max: number;
  sandboxes: SandboxRecord[];
}

export const getSelectedSandboxStorageKey = (userId?: string | null): string => {
  return userId ? `harness_selected_sandbox_id_${userId}` : 'harness_selected_sandbox_id';
};

const getInitialSelectedSandboxId = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const token = localStorage.getItem('auth_token');
    if (!token) return null;
    let userId: string | null = null;
    const parts = token.split('.');
    if (parts.length === 3) {
      try {
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          atob(base64)
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        const payload = JSON.parse(jsonPayload);
        userId = payload.sub || null;
      } catch {}
    }
    const key = getSelectedSandboxStorageKey(userId);
    return localStorage.getItem(key) || null;
  } catch {
    return null;
  }
};

export const selectedSandboxIdAtom: PrimitiveAtom<string | null> = atom<string | null>(getInitialSelectedSandboxId());
export const sandboxUsageAtom: PrimitiveAtom<SandboxUsageState | null> = atom<SandboxUsageState | null>(null);
