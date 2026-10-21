import { apiFetch, API_BASE_URL } from '../utils/api.util';
import type { UserProfile } from '../types';

export interface CliStatus {
  antigravity?: {
    linked: boolean;
    email?: string;
    name?: string;
    linkedAt?: string;
    hasApiKey?: boolean;
    details?: string;
  };
  gemini: {
    linked: boolean;
    email?: string;
    name?: string;
    linkedAt?: string;
    hasApiKey?: boolean;
    details?: string;
  };
  claude: {
    linked: boolean;
    authMethod?: string;
    email?: string;
    linkedAt?: string;
  };
  codex: {
    linked: boolean;
    email?: string;
    linkedAt?: string;
  };
}

export interface CliLoginResult {
  token: string;
  user: UserProfile;
  expiresAt: string;
}

let inFlightCliStatusPromise: Promise<CliStatus> | null = null;
let lastCliStatus: CliStatus | null = null;
let lastCliStatusFetchTime = 0;
const CLI_STATUS_CACHE_TTL = 4000; // 4 seconds deduplication window

export function invalidateCliStatusCache(): void {
  lastCliStatus = null;
  lastCliStatusFetchTime = 0;
  inFlightCliStatusPromise = null;
}

export async function fetchCliStatus(force = false): Promise<CliStatus> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  if (!token) {
    return {
      antigravity: { linked: false },
      gemini: { linked: false },
      claude: { linked: false },
      codex: { linked: false },
    };
  }
  const now = Date.now();
  if (force) {
    invalidateCliStatusCache();
  } else {
    if (lastCliStatus && now - lastCliStatusFetchTime < CLI_STATUS_CACHE_TTL) {
      return lastCliStatus;
    }
    if (inFlightCliStatusPromise) {
      return inFlightCliStatusPromise;
    }
  }

  inFlightCliStatusPromise = (async () => {
    try {
      const res = await apiFetch('/api/v1/auth/cli/status');
      if (!res.ok) throw new Error('Failed to fetch CLI status');
      const data = await res.json();
      lastCliStatus = data.data;
      lastCliStatusFetchTime = Date.now();
      return data.data;
    } catch (err) {
      console.error('Error fetching CLI auth status:', err);
      return (
        lastCliStatus || {
          antigravity: { linked: false },
          gemini: { linked: false },
          claude: { linked: false },
          codex: { linked: false },
        }
      );
    } finally {
      inFlightCliStatusPromise = null;
    }
  })();

  return inFlightCliStatusPromise;
}

export async function loginWithCliAccount(): Promise<CliLoginResult> {
  const res = await apiFetch('/api/v1/auth/cli-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || data.error?.message || 'Failed to authenticate via CLI account');
  }
  return data.data;
}


export async function unlinkAntigravityCli(): Promise<boolean> {
  try {
    invalidateCliStatusCache();
    const res = await apiFetch('/api/v1/auth/cli/antigravity/unlink', {
      method: 'POST',
    });
    invalidateCliStatusCache();
    return res.ok;
  } catch (err) {
    console.error('Error unlinking Antigravity CLI:', err);
    return false;
  }
}

export const unlinkGeminiCli = unlinkAntigravityCli;

export async function getAntigravityAuthUrl(): Promise<{ authUrl: string; sessionId: string }> {
  const res = await apiFetch('/api/v1/auth/cli/antigravity/url');
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error?.message || 'Failed to start Antigravity login');
  }
  const data = await res.json();
  return data.data;
}

export async function submitAntigravityAuthCode(code: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await apiFetch('/api/v1/auth/cli/antigravity/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success && data.data?.success !== false) {
      return { success: true };
    }
    const msg = data.error?.message || data.data?.error || 'Failed to verify authorization code';
    return { success: false, error: msg };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error submitting authorization code';
    return { success: false, error: msg };
  }
}

let antigravityPopupRef: Window | null = null;

export function openAntigravityCliLoginPopup(): { success: boolean; authUrl?: string; popup?: Window | null } {
  const width = 550;
  const height = 700;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  // If a previous popup is open, close it cleanly first
  if (antigravityPopupRef) {
    try {
      if (!antigravityPopupRef.closed) {
        antigravityPopupRef.close();
      }
    } catch {
      try {
        antigravityPopupRef.close();
      } catch {}
    }
    antigravityPopupRef = null;
  }

  const token = localStorage.getItem('auth_token') || '';
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';

  // Open popup synchronously during the user gesture to preserve script-closable control
  // and completely avoid browser popup blockers or detached tab conversions
  const popup = window.open(
    `${API_BASE_URL}/api/v1/auth/cli/antigravity/login${tokenQuery}`,
    'antigravity_cli_oauth',
    `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`
  );

  if (popup) {
    antigravityPopupRef = popup;
  }

  return { success: Boolean(popup), popup };
}

export function closeAntigravityCliLoginPopup(): boolean {
  let closed = false;
  if (antigravityPopupRef) {
    try {
      if (!antigravityPopupRef.closed) {
        antigravityPopupRef.close();
        closed = true;
      }
    } catch {
      // In case accessing .closed throws cross-origin DOMException, call .close() directly
      try {
        antigravityPopupRef.close();
        closed = true;
      } catch (err) {
        console.warn('[CLI Auth] Could not close Antigravity popup window directly:', err);
      }
    }
    antigravityPopupRef = null;
  }
  return closed;
}

export const openGeminiCliLoginPopup = openAntigravityCliLoginPopup;
export const closeGeminiCliLoginPopup = closeAntigravityCliLoginPopup;

export function openClaudeCliLoginPopup(
  mode: 'claudeai' | 'console' = 'console'
): Promise<{ success: boolean; email?: string }> {
  return new Promise((resolve) => {
    const width = 550;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const token = localStorage.getItem('auth_token') || '';
    const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : '';

    const popup = window.open(
      `${API_BASE_URL}/api/v1/auth/cli/claude/login?mode=${mode}${tokenQuery}`,
      'claude_cli_oauth',
      `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`
    );

    let resolved = false;
    let checkTimer: ReturnType<typeof setInterval> | null = null;

    const messageHandler = (event: MessageEvent) => {
      if (event.data?.type === 'CLAUDE_CLI_AUTH_SUCCESS') {
        resolved = true;
        window.removeEventListener('message', messageHandler);
        if (checkTimer) clearInterval(checkTimer);
        resolve({ success: true, email: event.data.email });
      }
    };

    window.addEventListener('message', messageHandler);

    // Detect popup closure without constantly polling the backend
    checkTimer = setInterval(() => {
      if (!popup || popup.closed) {
        if (checkTimer) clearInterval(checkTimer);
        window.removeEventListener('message', messageHandler);
        if (!resolved) {
          fetchCliStatus().then((finalStatus) => {
            if (finalStatus.claude?.linked) {
              resolve({ success: true, email: finalStatus.claude.email });
            } else {
              resolve({ success: false });
            }
          });
        }
      }
    }, 1500);
  });
}

export async function submitClaudeAuthCode(code: string): Promise<boolean> {
  try {
    const res = await apiFetch('/api/v1/auth/cli/claude/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    return Boolean(data.success);
  } catch {
    return false;
  }
}

export async function unlinkClaudeCli(): Promise<boolean> {
  try {
    invalidateCliStatusCache();
    const res = await apiFetch('/api/v1/auth/cli/claude/unlink', {
      method: 'POST',
    });
    invalidateCliStatusCache();
    return res.ok;
  } catch {
    return false;
  }
}

export async function getCodexAuthUrl(): Promise<{ authUrl: string; userCode?: string; sessionId: string }> {
  const token = localStorage.getItem('auth_token') || '';
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
  const res = await apiFetch(`/api/v1/auth/cli/codex/url${tokenQuery}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error?.message || 'Failed to start Codex login');
  }
  const data = await res.json();
  return data.data;
}

let codexPopupRef: Window | null = null;

export function closeCodexCliLoginPopup(): boolean {
  let closed = false;
  if (codexPopupRef) {
    try {
      if (!codexPopupRef.closed) {
        codexPopupRef.close();
        closed = true;
      }
    } catch {
      try {
        codexPopupRef.close();
        closed = true;
      } catch {}
    }
    codexPopupRef = null;
  }
  return closed;
}

export function openCodexCliLoginPopup(): Promise<{ success: boolean; email?: string }> {
  return new Promise((resolve) => {
    const width = 550;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    closeCodexCliLoginPopup();

    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') || '' : '';
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';

    const popup = window.open(
      `${API_BASE_URL}/api/v1/auth/cli/codex/login${tokenQuery}`,
      'codex_cli_oauth',
      `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`
    );

    codexPopupRef = popup;

    let resolved = false;
    let checkTimer: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (checkTimer) {
        clearInterval(checkTimer);
        checkTimer = null;
      }
      window.removeEventListener('message', messageHandler);
      window.removeEventListener('focus', checkStatusDirectly);
    };

    const finishSuccess = (email?: string) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      closeCodexCliLoginPopup();
      invalidateCliStatusCache();
      resolve({ success: true, email });
    };

    const finishFail = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      closeCodexCliLoginPopup();
      resolve({ success: false });
    };

    const checkStatusDirectly = async () => {
      if (resolved) return;
      try {
        const current = await fetchCliStatus(true);
        if (current.codex?.linked) {
          finishSuccess(current.codex.email);
        }
      } catch {}
    };

    const messageHandler = (event: MessageEvent) => {
      if (event.data?.type === 'CODEX_CLI_AUTH_SUCCESS') {
        finishSuccess(event.data.email);
      }
    };

    window.addEventListener('message', messageHandler);
    window.addEventListener('focus', checkStatusDirectly);

    // Initial check in case user was already linked
    checkStatusDirectly();

    // Check periodically for backend authorization approval or window closure
    let elapsedMs = 0;
    checkTimer = setInterval(async () => {
      elapsedMs += 2000;

      // 1. Actively verify if backend has confirmed the link
      try {
        const status = await fetchCliStatus(true);
        if (status.codex?.linked) {
          finishSuccess(status.codex.email);
          return;
        }
      } catch {}

      // 2. Check if popup was closed
      let isClosed = false;
      try {
        isClosed = !popup || popup.closed;
      } catch {
        isClosed = false;
      }

      if (isClosed) {
        try {
          const finalStatus = await fetchCliStatus(true);
          if (finalStatus.codex?.linked) {
            finishSuccess(finalStatus.codex.email);
          } else {
            finishFail();
          }
        } catch {
          finishFail();
        }
        return;
      }

      // 3. Graceful timeout after 5 minutes
      if (elapsedMs >= 300000) {
        finishFail();
      }
    }, 2000);
  });
}

export async function unlinkCodexCli(): Promise<boolean> {
  try {
    invalidateCliStatusCache();
    const res = await apiFetch('/api/v1/auth/cli/codex/unlink', {
      method: 'POST',
    });
    invalidateCliStatusCache();
    return res.ok;
  } catch {
    return false;
  }
}
