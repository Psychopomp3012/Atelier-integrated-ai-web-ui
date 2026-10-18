/**
 * Centralized API utility with direct backend calls and JWT handling.
 */

export const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export async function apiFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const token = localStorage.getItem('auth_token');

  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return await fetch(`${API_BASE_URL}${cleanEndpoint}`, {
    ...options,
    headers,
  });
}

