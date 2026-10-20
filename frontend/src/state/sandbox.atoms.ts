import { atom, type PrimitiveAtom } from 'jotai';

export interface SandboxRecord {
  sandboxId: string;
  name: string;
  sessionId?: string;
  lastActiveAt: number;
  createdAt: number;
  attachedSessionCount: number;
  attachedSessionIds: string[];
  lastUpdateCheckAt?: number;
  isUpdating?: boolean;
  isProvisioning?: boolean;
}

export interface SandboxUsageState {
  used: number;
  max: number;
  sandboxes: SandboxRecord[];
}

const getInitialSelectedSandboxId = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const token = localStorage.getItem('auth_token');
    if (!token) return null;
    return localStorage.getItem('harness_selected_sandbox_id') || null;
  } catch {
    return null;
  }
};

export const selectedSandboxIdAtom: PrimitiveAtom<string | null> = atom<string | null>(getInitialSelectedSandboxId());
export const sandboxUsageAtom: PrimitiveAtom<SandboxUsageState | null> = atom<SandboxUsageState | null>(null);
