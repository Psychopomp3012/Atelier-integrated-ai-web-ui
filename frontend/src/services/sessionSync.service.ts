import { apiFetch } from '../utils/api.util';
import type { ChatSession, PaginatedMessagesResponse } from '../types';

export const sessionSyncService = {
  /**
   * Helper to keep local storage lightweight by trimming cached message arrays
   * to the most recent 25 messages per session, preventing browser QuotaExceededError.
   */
  sanitizeForLocalStorage(sessions: ChatSession[]): ChatSession[] {
    return sessions.map((sess) => ({
      ...sess,
      messages: Array.isArray(sess.messages) ? sess.messages.slice(-25) : [],
    }));
  },

  /**
   * Synchronously reads existing cached sessions for this user from LocalStorage.
   * Enables 0ms instantaneous UI hydration on login before network requests start.
   * Scoped strictly by userId to avoid cross-user session leaks.
   */
  getLocalSessions(userId?: string): ChatSession[] {
    try {
      if (!userId) return [];
      const storageKey = `harness_chat_sessions_${userId}`;
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) return list;
      }
    } catch {}
    return [];
  },

  /**
   * Loads chat sessions from the secure Fastify backend API with JWT authentication.
   * Hydrates immediately with local cache and updates seamlessly when backend responds.
   */
  async loadAndReconcileSessions(
    userId: string,
    onProgress?: (sessions: ChatSession[]) => void
  ): Promise<ChatSession[]> {
    if (!userId) return [];

    // 1. Instant local read for zero-delay hydration
    const localSessions = this.getLocalSessions(userId);
    if (localSessions.length > 0 && onProgress) {
      onProgress(localSessions);
    }

    // 2. Fetch authenticated user sessions from backend API
    try {
      const res = await apiFetch('/api/v1/sessions');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          const backendSessions: ChatSession[] = data.data;

          // Merge backend sessions with any fresh local-only sessions
          const map = new Map<string, ChatSession>();
          for (const s of localSessions) {
            if (s && s.id) map.set(s.id, s);
          }
          for (const s of backendSessions) {
            if (s && s.id) {
              const existing = map.get(s.id);
              if (!existing) {
                map.set(s.id, s);
              } else {
                map.set(s.id, {
                  ...s,
                  messages: existing.messages && existing.messages.length > 0 ? existing.messages : s.messages,
                  messageCount: s.messageCount ?? existing.messageCount ?? existing.messages?.length ?? 0,
                });
              }
            }
          }

          const merged = Array.from(map.values()).sort(
            (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
          );

          // Update local memory cache with capped message slices for lean storage, scoped to this user
          try {
            const sanitized = this.sanitizeForLocalStorage(merged);
            localStorage.setItem(`harness_chat_sessions_${userId}`, JSON.stringify(sanitized));
          } catch {}

          if (onProgress) {
            onProgress(merged);
          }

          return merged;
        }
      }
    } catch (err) {
      console.warn('[SessionSync] Backend sessions fetch error:', err);
    }

    return localSessions;
  },

  /**
   * Fetches a single session with paginated messages from the Fastify Backend API.
   * By default fetches the latest 25 messages, along with pagination metadata.
   */
  async getSession(
    sessionId: string,
    options?: { limit?: number; beforeId?: string; all?: boolean }
  ): Promise<ChatSession | null> {
    if (!sessionId) return null;
    try {
      const limit = options?.limit ?? 25;
      const params = new URLSearchParams({ limit: String(limit) });
      if (options?.beforeId) params.append('beforeId', options.beforeId);
      if (options?.all) params.append('all', 'true');

      const res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          return data.data as ChatSession;
        }
      }
    } catch (err) {
      console.warn('[SessionSync] getSession failed:', err);
    }
    return null;
  },

  /**
   * Loads an earlier slice of messages preceding `beforeId` for a session.
   */
  async loadEarlierMessages(
    sessionId: string,
    beforeId: string,
    limit: number = 25
  ): Promise<PaginatedMessagesResponse | null> {
    if (!sessionId || !beforeId) return null;
    try {
      const params = new URLSearchParams({
        beforeId,
        limit: String(limit),
      });
      const res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/messages?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          return data.data as PaginatedMessagesResponse;
        }
      }
    } catch (err) {
      console.warn('[SessionSync] loadEarlierMessages failed:', err);
    }
    return null;
  },

  /**
   * Persists a chat session to the Fastify Backend API with JWT authentication.
   * Backend automatically performs server-side message merging so earlier un-fetched messages are preserved.
   */
  async saveSession(session: ChatSession, userId?: string): Promise<void> {
    if (!session || !session.id) return;

    // 1. Immediately update LocalStorage scoped to this user
    if (userId) {
      try {
        const storageKey = `harness_chat_sessions_${userId}`;
        const raw = localStorage.getItem(storageKey);
        const list: ChatSession[] = raw ? JSON.parse(raw) : [];
        const idx = list.findIndex((s) => s.id === session.id);
        if (idx >= 0) {
          list[idx] = session;
        } else {
          list.unshift(session);
        }
        const sanitized = this.sanitizeForLocalStorage(list);
        localStorage.setItem(storageKey, JSON.stringify(sanitized));
      } catch {}
    }

    // 2. Persist to Cloud Backend API (backend persists to Firestore with server-side message merging)
    try {
      const token = localStorage.getItem('auth_token');
      if (token) {
        await apiFetch('/api/v1/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(session),
        });
      }
    } catch (err) {
      console.warn('[SessionSync] Cloud backend session save failed:', err);
    }
  },

  /**
   * Deletes a chat session via the Fastify Backend API.
   */
  async deleteSession(sessionId: string, userId?: string): Promise<void> {
    // 1. Remove from LocalStorage scoped to this user
    if (userId) {
      try {
        const storageKey = `harness_chat_sessions_${userId}`;
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const list: ChatSession[] = JSON.parse(raw);
          const filtered = list.filter((s) => s.id !== sessionId);
          const sanitized = this.sanitizeForLocalStorage(filtered);
          localStorage.setItem(storageKey, JSON.stringify(sanitized));
        }
      } catch {}
    }

    // 2. Remove from Cloud Backend (backend removes from Firestore)
    try {
      const token = localStorage.getItem('auth_token');
      if (token) {
        await apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
          method: 'DELETE',
        });
      }
    } catch (err) {
      console.warn('[SessionSync] Cloud backend session deletion failed:', err);
    }
  },

  /**
   * Completely purges all local cached sessions and session pointers from localStorage upon logout.
   */
  clearLocalCache(userId?: string): void {
    try {
      localStorage.removeItem('harness_chat_sessions');
      localStorage.removeItem('harness_current_session_id');
      localStorage.removeItem('harness_selected_sandbox_id');
      if (userId) {
        localStorage.removeItem(`harness_chat_sessions_${userId}`);
      }
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('harness_chat_sessions') || key.startsWith('harness_current_session') || key.startsWith('harness_selected_sandbox'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch {}
  },
};
