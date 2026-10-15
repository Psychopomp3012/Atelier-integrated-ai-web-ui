import { apiFetch } from '../utils/api.util';
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

export async function fetchCliStatus(): Promise<CliStatus> {
  try {
    const res = await apiFetch('/api/v1/auth/cli/status');
    if (!res.ok) throw new Error('Failed to fetch CLI status');
    const data = await res.json();
    return data.data;
  } catch (err) {
    console.error('Error fetching CLI auth status:', err);
    return {
      antigravity: { linked: false },
      gemini: { linked: false },
      claude: { linked: false },
      codex: { linked: false },
    };
  }
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

export async function refreshAuthToken(): Promise<CliLoginResult | null> {
  try {
    const res = await apiFetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.success ? data.data : null;
  } catch {
    return null;
  }
}

export async function unlinkAntigravityCli(): Promise<boolean> {
  try {
    const res = await apiFetch('/api/v1/auth/cli/antigravity/unlink', {
      method: 'POST',
    });
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

export async function submitAntigravityAuthCode(code: string): Promise<boolean> {
  try {
    const res = await apiFetch('/api/v1/auth/cli/antigravity/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    return Boolean(data.success || data.data?.success);
  } catch {
    return false;
  }
}

export async function openAntigravityCliLoginPopup(): Promise<{ success: boolean; authUrl?: string }> {
  try {
    const { authUrl } = await getAntigravityAuthUrl();
    const width = 550;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    window.open(
      authUrl,
      'antigravity_cli_oauth',
      `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`
    );

    return { success: true, authUrl };
  } catch (err: unknown) {
    console.error('Failed to open Antigravity login:', err);
    throw err;
  }
}

export const openGeminiCliLoginPopup = openAntigravityCliLoginPopup;

export function openClaudeCliLoginPopup(
  mode: 'claudeai' | 'console' = 'console'
): Promise<{ success: boolean; email?: string }> {
  return new Promise((resolve) => {
    const width = 550;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      `/api/v1/auth/cli/claude/login?mode=${mode}`,
      'claude_cli_oauth',
      `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`
    );

    let resolved = false;

    const messageHandler = (event: MessageEvent) => {
      if (event.data?.type === 'CLAUDE_CLI_AUTH_SUCCESS') {
        resolved = true;
        window.removeEventListener('message', messageHandler);
        clearInterval(pollTimer);
        resolve({ success: true, email: event.data.email });
      }
    };

    window.addEventListener('message', messageHandler);

    const pollTimer = setInterval(() => {
      fetchCliStatus().then((status) => {
        if (status.claude?.linked) {
          resolved = true;
          clearInterval(pollTimer);
          window.removeEventListener('message', messageHandler);
          try {
            if (popup && !popup.closed) popup.close();
          } catch {}
          resolve({ success: true, email: status.claude.email });
        } else if (!popup || popup.closed) {
          clearInterval(pollTimer);
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
      });
    }, 1200);
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
    const res = await apiFetch('/api/v1/auth/cli/claude/unlink', {
      method: 'POST',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function openCodexCliLoginPopup(): Promise<{ success: boolean; email?: string }> {
  return new Promise((resolve) => {
    const width = 550;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      '/api/v1/auth/cli/codex/login',
      'codex_cli_oauth',
      `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`
    );

    let resolved = false;

    const messageHandler = (event: MessageEvent) => {
      if (event.data?.type === 'CODEX_CLI_AUTH_SUCCESS') {
        resolved = true;
        window.removeEventListener('message', messageHandler);
        clearInterval(pollTimer);
        resolve({ success: true, email: event.data.email });
      }
    };

    window.addEventListener('message', messageHandler);

    const pollTimer = setInterval(() => {
      fetchCliStatus().then((status) => {
        if (status.codex?.linked) {
          resolved = true;
          clearInterval(pollTimer);
          window.removeEventListener('message', messageHandler);
          try {
            if (popup && !popup.closed) popup.close();
          } catch {}
          resolve({ success: true, email: status.codex.email });
        } else if (!popup || popup.closed) {
          clearInterval(pollTimer);
          window.removeEventListener('message', messageHandler);
          if (!resolved) {
            fetchCliStatus().then((finalStatus) => {
              if (finalStatus.codex?.linked) {
                resolve({ success: true, email: finalStatus.codex.email });
              } else {
                resolve({ success: false });
              }
            });
          }
        }
      });
    }, 1200);
  });
}

export async function unlinkCodexCli(): Promise<boolean> {
  try {
    const res = await apiFetch('/api/v1/auth/cli/codex/unlink', {
      method: 'POST',
    });
    return res.ok;
  } catch {
    return false;
  }
}
