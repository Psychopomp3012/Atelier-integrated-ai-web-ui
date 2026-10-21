/**
 * Centralized API utility with direct backend calls and JWT handling.
 */

export const API_BASE_URL = ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || 'http://localhost:4000').replace(/\/$/, '');

/**
 * Checks if a JWT token string has passed its expiration time.
 */
export function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const parsed = JSON.parse(jsonPayload);
    if (typeof parsed.exp === 'number') {
      return Date.now() >= parsed.exp * 1000;
    }
    return false;
  } catch {
    return false;
  }
}

export async function apiFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const token = localStorage.getItem('auth_token');

  // Proactive check: if token is already expired, notify app and do not send stale credentials
  if (token && isTokenExpired(token)) {
    if (!cleanEndpoint.includes('/auth/login') && !cleanEndpoint.includes('/auth/google')) {
      localStorage.removeItem('auth_token');
      window.dispatchEvent(new CustomEvent('auth:session-expired'));
    }
  }

  const activeToken = localStorage.getItem('auth_token');
  const headers = new Headers(options.headers || {});
  if (activeToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${activeToken}`);
  }

  const res = await fetch(`${API_BASE_URL}${cleanEndpoint}`, {
    ...options,
    headers,
  });

  // Reactive check: if backend returns 401 Unauthorized for an authenticated endpoint
  if (
    res.status === 401 &&
    !cleanEndpoint.includes('/auth/login') &&
    !cleanEndpoint.includes('/auth/google') &&
    !cleanEndpoint.includes('/auth/me')
  ) {
    localStorage.removeItem('auth_token');
    window.dispatchEvent(new CustomEvent('auth:session-expired'));
  }

  return res;
}


