import { apiFetch } from '../utils/api.util';
import type { ChatSession, ChatSessionDetails, PaginatedMessagesResponse } from '../types';

export const sessionSyncService = {
  /**
   * Normalizes incoming raw messages from Firestore / LocalStorage to guarantee
   * full backward compatibility with UI fields (modelBadge, latency, step completion).
   */
  normalizeMessage(m: any): any {
    if (!m) return m;
    const authorName = m.author || m.authorName || (m.role === 'user' ? 'User' : 'Atelier Assistant');
    const isAssistant = m.role === 'assistant';
    const rawSteps = Array.isArray(m.steps) ? m.steps : [];
    const normalizedSteps = rawSteps.map((s: any) => {
      const isCompleted = s.completed !== undefined ? Boolean(s.completed) : s.status === 'completed';
      return {
        id: s.id || `step_${Math.random().toString(36).substring(2, 9)}`,
        text: s.text || s.description || '',
        description: s.description || s.text || '',
        duration: s.duration || (typeof s.durationMs === 'number' ? `${s.durationMs}ms` : '0ms'),
        durationMs: typeof s.durationMs === 'number' ? s.durationMs : 0,
        completed: isCompleted,
        status: s.status || (isCompleted ? 'completed' : 'in_progress'),
        tool: s.tool,
        command: s.command,
        output: s.output,
        exitCode: s.exitCode,
      };
    });

    const modelBadge =
      m.modelBadge ||
      (isAssistant && m.authorName && m.authorName !== 'Atelier Assistant'
        ? m.authorName
        : undefined) ||
      (isAssistant && m.modelUsed && m.modelUsed !== 'Atelier Assistant'
        ? m.modelUsed
        : undefined);

    const latencyFormatted =
      m.latency ||
      (typeof m.latencyMs === 'number' && m.latencyMs > 0
        ? `Latency: ${m.latencyMs.toLocaleString()}ms`
        : undefined);

    return {
      ...m,
      author: authorName,
      authorName: m.authorName || authorName,
      time: m.time || m.timestamp || '',
      timestamp: m.timestamp || m.time || '',
      modelBadge: modelBadge || m.modelBadge,
      modelUsed: m.modelUsed || modelBadge,
      latency: latencyFormatted || m.latency,
      steps: normalizedSteps,
    };
  },

  normalizeSession(session: any): ChatSessionDetails {
    if (!session) return session;
    return {
      id: session.id,
      title: session.title,
      messageCount: typeof session.messageCount === 'number' ? session.messageCount : (Array.isArray(session.messages) ? session.messages.length : 0),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: Array.isArray(session.messages)
        ? session.messages.map((m: any) => this.normalizeMessage(m))
        : [],
      ...(session.pagination ? { pagination: session.pagination } : {}),
      ...(session.overwriteMessages !== undefined ? { overwriteMessages: session.overwriteMessages } : {}),
      ...(session.truncateAfterMessageId ? { truncateAfterMessageId: session.truncateAfterMessageId } : {}),
    };
  },

  /**
   * Helper to keep local storage lightweight by trimming cached message arrays
   * to the most recent 25 messages per session, preventing browser QuotaExceededError.
   */
  sanitizeForLocalStorage(sessions: ChatSessionDetails[]): ChatSessionDetails[] {
    return sessions.map((sess) => ({
      ...sess,
      messages: Array.isArray(sess.messages)
        ? sess.messages.slice(-25).map((m) => this.normalizeMessage(m))
        : [],
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
   * In Pure Cloud SSOT architecture, sessions are kept in-memory only.
   */
  getLocalSessions(_userId?: string): ChatSession[] {
    return [];
  },

  /**
   * Loads chat sessions directly from the secure Fastify backend API (Cloud Firestore SSOT).
   * In-memory state only - no localStorage caching.
   */
  async loadAndReconcileSessions(
    userId: string,
    onProgress?: (sessions: ChatSession[]) => void
  ): Promise<ChatSession[]> {
    if (!userId) return [];

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
          const backendSessions: ChatSession[] = data.data.map((s: any) => this.normalizeSession(s));
          const sorted = backendSessions.sort(
            (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
          );

          if (onProgress) {
            onProgress(sorted);
          }

          return sorted;
        }
      }
    } catch (err) {
      console.warn('[SessionSync] Backend sessions fetch error:', err);
    }

    return [];
  },

  /**
   * Fetches a single session with paginated messages from the Fastify Backend API.
   * By default fetches the latest 25 messages, along with pagination metadata.
   */
  async getSession(
    sessionId: string,
    options?: { limit?: number; beforeId?: string; all?: boolean }
  ): Promise<ChatSessionDetails | null> {
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
          return this.normalizeSession(data.data as ChatSession);
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
          return {
            ...data.data,
            messages: Array.isArray(data.data.messages)
              ? data.data.messages.map((m: any) => this.normalizeMessage(m))
              : [],
          } as PaginatedMessagesResponse;
        }
      }
    } catch (err) {
      console.warn('[SessionSync] loadEarlierMessages failed:', err);
    }
    return null;
  },

  /**
   * Persists a chat session to the Fastify Backend API with JWT authentication.
   * Backend automatically performs server-side message merging into Firestore.
   */
  async saveSession(session: ChatSessionDetails, _userId?: string): Promise<void> {
    if (!session || !session.id) return;

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
   * Deletes a chat session via the Fastify Backend API (Cloud Firestore SSOT).
   */
  async deleteSession(sessionId: string, _userId?: string): Promise<void> {
    if (!sessionId) return;
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
