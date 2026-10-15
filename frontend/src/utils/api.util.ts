/**
 * Centralized API utility with seamless same-origin proxy and fallback.
 */

const BASE_URL = ''; // Relative path leverages Vite dev server proxy
const FALLBACK_URL = 'http://localhost:4000';

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

  // First attempt via relative URL (Vite proxy)
  try {
    const res = await fetch(`${BASE_URL}${cleanEndpoint}`, {
      ...options,
      headers,
    });
    return res;
  } catch (err: unknown) {
    // If relative fetch fails (e.g., dev proxy hiccup or direct access), try direct backend port
    try {
      const fallbackRes = await fetch(`${FALLBACK_URL}${cleanEndpoint}`, {
        ...options,
        headers,
      });
      return fallbackRes;
    } catch {
      throw err;
    }
  }
}
