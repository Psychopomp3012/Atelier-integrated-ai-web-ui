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
   * Reads tombstoned (deleted) session IDs for this user, pruning tombstones older than 30 days.
   */
  getTombstones(userId: string): Set<string> {
    try {
      if (!userId) return new Set();
      const storageKey = `harness_deleted_sessions_${userId}`;
      const raw = localStorage.getItem(storageKey);
      if (!raw) return new Set();
      const obj: Record<string, number> = JSON.parse(raw);
      const now = Date.now();
      const valid = new Set<string>();
      const updated: Record<string, number> = {};
      let changed = false;

      for (const [id, ts] of Object.entries(obj)) {
        if (typeof ts === 'number' && now - ts < 30 * 24 * 60 * 60 * 1000) {
          valid.add(id);
          updated[id] = ts;
        } else {
          changed = true;
        }
      }

      if (changed) {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      }
      return valid;
    } catch {
      return new Set();
    }
  },

  /**
   * Records a session ID as tombstoned (deleted) to prevent resurrection from stale caches.
   */
  addTombstone(sessionId: string, userId: string): void {
    try {
      if (!sessionId || !userId) return;
      const storageKey = `harness_deleted_sessions_${userId}`;
      const raw = localStorage.getItem(storageKey);
      const obj: Record<string, number> = raw ? JSON.parse(raw) : {};
      obj[sessionId] = Date.now();
      localStorage.setItem(storageKey, JSON.stringify(obj));
    } catch {}
  },

  /**
   * Clears a tombstone record when a session is explicitly re-created or re-saved.
   */
  removeTombstone(sessionId: string, userId: string): void {
    try {
      if (!sessionId || !userId) return;
      const storageKey = `harness_deleted_sessions_${userId}`;
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const obj: Record<string, number> = JSON.parse(raw);
        if (obj[sessionId]) {
          delete obj[sessionId];
          localStorage.setItem(storageKey, JSON.stringify(obj));
        }
      }
    } catch {}
  },

  /**
   * Synchronously reads existing cached sessions for this user from LocalStorage.
   * Enables 0ms instantaneous UI hydration on login before network requests start.
   * Scoped strictly by userId to avoid cross-user session leaks, and filters out tombstones.
   */
  getLocalSessions(userId?: string): ChatSession[] {
    try {
      if (!userId) return [];
      const storageKey = `harness_chat_sessions_${userId}`;
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          const tombstones = this.getTombstones(userId);
          const filtered = list.filter((s) => s && s.id && !tombstones.has(s.id));
          if (filtered.length !== list.length) {
            localStorage.setItem(storageKey, JSON.stringify(this.sanitizeForLocalStorage(filtered)));
          }
          return filtered;
        }
      }
    } catch {}
    return [];
  },

  /**
   * Loads chat sessions from the secure Fastify backend API with JWT authentication.
   * Hydrates immediately with local cache and updates seamlessly when backend responds.
   * Reconciles local and cloud state using cloud authority and tombstones to prevent resurrecting deleted sessions.
   */
  async loadAndReconcileSessions(
    userId: string,
    onProgress?: (sessions: ChatSession[]) => void
  ): Promise<ChatSession[]> {
    if (!userId) return [];

    const tombstones = this.getTombstones(userId);

    // 1. Instant local read for zero-delay hydration (excluding tombstones)
    const localSessions = this.getLocalSessions(userId);
    if (localSessions.length > 0 && onProgress) {
      onProgress(localSessions);
    }

    // 2. Fetch authenticated user sessions from backend API with 5s timeout
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      let res: Response;
      try {
        res = await apiFetch('/api/v1/sessions', { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          const backendSessions: ChatSession[] = data.data;

          // Build map using backend sessions as cloud authority
          const map = new Map<string, ChatSession>();
          const backendSessionIds = new Set<string>();

          // Index local sessions for local message cache preservation
          const localMap = new Map<string, ChatSession>();
          for (const s of localSessions) {
            if (s && s.id) localMap.set(s.id, s);
          }

          for (const s of backendSessions) {
            if (s && s.id) {
              // If marked deleted locally, ignore cloud record
              if (tombstones.has(s.id)) continue;

              backendSessionIds.add(s.id);
              const existing = localMap.get(s.id);
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

          // Check local sessions: only retain fresh unsaved drafts created < 60s ago
          const now = Date.now();
          for (const s of localSessions) {
            if (!s || !s.id) continue;
            if (backendSessionIds.has(s.id) || tombstones.has(s.id)) continue;

            const createdAtMs = s.createdAt ? new Date(s.createdAt).getTime() : 0;
            const isFreshLocalDraft = createdAtMs > 0 && (now - createdAtMs) < 60000;

            if (isFreshLocalDraft) {
              map.set(s.id, s);
            } else {
              // Absent from cloud and older than 60s -> deleted remotely on another device/tab
              this.addTombstone(s.id, userId);
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

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      let res: Response;
      try {
        res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}?${params.toString()}`, {
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
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
      this.removeTombstone(session.id, userId);
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
        const res = await apiFetch('/api/v1/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(session),
        });
        if (res.ok && userId) {
          const json = await res.json().catch(() => null);
          const savedData = (json?.data || json) as ChatSession | undefined;
          if (savedData?.messageCount) {
            try {
              const storageKey = `harness_chat_sessions_${userId}`;
              const raw = localStorage.getItem(storageKey);
              if (raw) {
                const list: ChatSession[] = JSON.parse(raw);
                const sIdx = list.findIndex((s) => s.id === session.id);
                if (sIdx >= 0 && (list[sIdx].messageCount ?? 0) < savedData.messageCount) {
                  list[sIdx].messageCount = savedData.messageCount;
                  localStorage.setItem(storageKey, JSON.stringify(list));
                }
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      console.warn('[SessionSync] Cloud backend session save failed:', err);
    }
  },

  /**
   * Deletes a chat session via the Fastify Backend API.
   * Records a persistent tombstone to prevent resurrection from stale device caches.
   */
  async deleteSession(sessionId: string, userId?: string): Promise<void> {
    // 1. Record tombstone and remove from LocalStorage scoped to this user
    if (userId) {
      this.addTombstone(sessionId, userId);
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
        localStorage.removeItem(`harness_deleted_sessions_${userId}`);
      }
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key &&
          (key.startsWith('harness_chat_sessions') ||
            key.startsWith('harness_deleted_sessions') ||
            key.startsWith('harness_current_session') ||
            key.startsWith('harness_selected_sandbox'))
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch {}
  },
};
