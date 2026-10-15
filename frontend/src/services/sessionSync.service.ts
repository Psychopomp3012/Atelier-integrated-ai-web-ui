import { apiFetch } from '../utils/api.util';
import { firestoreService } from './firestore.service';
import type { ChatSession } from '../types';

export const sessionSyncService = {
  /**
   * Loads and reconciles chat sessions from Backend Cloud API, Firestore, and LocalStorage.
   * Ensures identical conversations are visible on mobile, laptop, and localhost for the user.
   */
  async loadAndReconcileSessions(userId: string): Promise<ChatSession[]> {
    // 1. Read existing local sessions
    let localSessions: ChatSession[] = [];
    try {
      const raw = localStorage.getItem('harness_chat_sessions');
      localSessions = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(localSessions)) localSessions = [];
    } catch {
      localSessions = [];
    }

    // 2. Fetch from Backend Cloud Session Store (JWT authenticated)
    let backendSessions: ChatSession[] = [];
    try {
      const res = await apiFetch('/api/v1/sessions');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          backendSessions = data.data;
          console.log(`[SessionSync] Loaded ${backendSessions.length} sessions from Cloud Backend`);
        }
      }
    } catch (err) {
      console.warn('[SessionSync] Cloud backend sessions fetch error:', err);
    }

    // 3. Fetch from Firestore (if available)
    let firestoreSessions: ChatSession[] = [];
    try {
      firestoreSessions = await firestoreService.loadUserSessions(userId);
    } catch (err) {
      console.warn('[SessionSync] Firestore load sessions error:', err);
    }

    // 4. Merge all sources by sessionId
    const sessionMap = new Map<string, ChatSession>();

    // Helper to merge session data prioritizing whichever has more messages or newer timestamp
    const mergeIntoMap = (sess: ChatSession) => {
      if (!sess || !sess.id) return;
      const existing = sessionMap.get(sess.id);
      if (!existing) {
        sessionMap.set(sess.id, sess);
        return;
      }

      const existingMsgs = existing.messages?.length || 0;
      const newMsgs = sess.messages?.length || 0;

      const existingTime = new Date(existing.updatedAt || 0).getTime();
      const newTime = new Date(sess.updatedAt || 0).getTime();

      // If new session has more messages or is strictly newer, pick it
      if (newMsgs > existingMsgs || (newMsgs === existingMsgs && newTime > existingTime)) {
        sessionMap.set(sess.id, sess);
      }
    };

    // Process local first, then backend, then firestore
    localSessions.forEach(mergeIntoMap);
    backendSessions.forEach(mergeIntoMap);
    firestoreSessions.forEach(mergeIntoMap);

    const merged = Array.from(sessionMap.values()).sort(
      (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
    );

    // 5. Update LocalStorage cache
    try {
      localStorage.setItem('harness_chat_sessions', JSON.stringify(merged));
    } catch {}

    // 6. Proactively push any local-only sessions to backend and Firestore
    const backendIds = new Set(backendSessions.map((s) => s.id));
    for (const sess of merged) {
      if (!backendIds.has(sess.id)) {
        this.saveSession(sess, userId).catch(() => {});
      }
    }

    return merged;
  },

  /**
   * Persists a chat session to LocalStorage, Cloud Backend, and Firestore.
   */
  async saveSession(session: ChatSession, userId?: string): Promise<void> {
    if (!session || !session.id) return;

    // 1. Immediately update LocalStorage for ultra-fast UI rendering
    try {
      const raw = localStorage.getItem('harness_chat_sessions');
      const list: ChatSession[] = raw ? JSON.parse(raw) : [];
      const idx = list.findIndex((s) => s.id === session.id);
      if (idx >= 0) {
        list[idx] = session;
      } else {
        list.unshift(session);
      }
      localStorage.setItem('harness_chat_sessions', JSON.stringify(list));
    } catch {}

    // 2. Persist to Cloud Backend API (cross-device source of truth)
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

    // 3. Persist to Firestore
    if (userId) {
      firestoreService.saveSession(userId, session).catch(() => {});
    }
  },

  /**
   * Deletes a chat session from LocalStorage, Cloud Backend, and Firestore.
   */
  async deleteSession(sessionId: string, userId?: string): Promise<void> {
    // 1. Remove from LocalStorage
    try {
      const raw = localStorage.getItem('harness_chat_sessions');
      if (raw) {
        const list: ChatSession[] = JSON.parse(raw);
        const filtered = list.filter((s) => s.id !== sessionId);
        localStorage.setItem('harness_chat_sessions', JSON.stringify(filtered));
      }
    } catch {}

    // 2. Remove from Cloud Backend
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

    // 3. Remove from Firestore
    if (userId) {
      firestoreService.deleteSession(userId, sessionId).catch(() => {});
    }
  },
};
