import { apiFetch } from '../utils/api.util';
import type { UserProfile, LinkedAIPlatformAccount, ChatMessage, ChatSession } from '../types';

/**
 * Service to manage user data and chat sessions via the secure Fastify backend API.
 * In compliance with architectural rules, the frontend NEVER performs direct database
 * write operations (e.g. direct Firestore writes). All persistence is authenticated
 * with the user's weekly JWT and handled by the Fastify backend.
 */
export const firestoreService = {
  /**
   * Syncs the user profile to the cloud backend via POST /api/v1/auth/profile.
   */
  async syncUserProfile(user: UserProfile, _fbUid?: string): Promise<void> {
    try {
      await apiFetch('/api/v1/auth/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
          primaryPlatform: user.primaryPlatform,
          linkedPlatforms: user.linkedPlatforms,
        }),
      });
      console.log(`[Backend API] Synchronized user profile for ${user.email} (${user.id})`);
    } catch (error) {
      console.warn('[Backend API] Failed to sync user profile:', error);
    }
  },

  /**
   * Fetches the user profile from the backend.
   */
  async getUserProfile(_docId: string): Promise<Partial<UserProfile> | null> {
    try {
      const res = await apiFetch('/api/v1/auth/me');
      if (res.ok) {
        const data = await res.json();
        return (data.data as Partial<UserProfile>) || null;
      }
      return null;
    } catch (error) {
      console.warn('[Backend API] Failed to get user profile:', error);
      return null;
    }
  },

  /**
   * Updates linked platforms (Claude, Codex, etc.) via backend profile sync.
   */
  async updateLinkedPlatforms(
    docId: string,
    linkedPlatforms: LinkedAIPlatformAccount[]
  ): Promise<void> {
    try {
      await apiFetch('/api/v1/auth/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: docId,
          linkedPlatforms,
        }),
      });
      console.log(`[Backend API] Updated linked platforms for ${docId}`);
    } catch (error) {
      console.warn('[Backend API] Failed to update linked platforms:', error);
    }
  },

  /**
   * Saves or updates a complete chat session via POST /api/v1/sessions.
   */
  async saveSession(_userId: string, session: ChatSession): Promise<void> {
    try {
      await apiFetch('/api/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      });
      console.log(`[Backend API] Successfully persisted session ${session.id}`);
    } catch (error) {
      console.warn('[Backend API] Failed to save session:', error);
    }
  },

  /**
   * Loads all chat sessions for the authenticated user via GET /api/v1/sessions.
   */
  async loadUserSessions(_userId: string, _timeoutMs: number = 2500): Promise<ChatSession[]> {
    try {
      const res = await apiFetch('/api/v1/sessions');
      if (!res.ok) return [];
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        console.log(`[Backend API] Loaded ${data.data.length} sessions from backend`);
        return data.data as ChatSession[];
      }
      return [];
    } catch (error) {
      console.warn('[Backend API] loadUserSessions failed:', error);
      return [];
    }
  },

  /**
   * Deletes a chat session via DELETE /api/v1/sessions/:id.
   */
  async deleteSession(_userId: string, sessionId: string): Promise<void> {
    try {
      await apiFetch(`/api/v1/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      console.log(`[Backend API] Successfully removed session ${sessionId}`);
    } catch (error) {
      console.warn('[Backend API] Failed to delete session:', error);
    }
  },

  /**
   * Stores a chat message by saving the session state via the backend API.
   */
  async saveChatMessage(_userId: string, _sessionId: string, _message: ChatMessage): Promise<void> {
    // Session state with full message array is persisted via saveSession
    return Promise.resolve();
  },

  /**
   * Loads chat messages for a specific session via GET /api/v1/sessions/:id.
   */
  async loadChatMessages(_userId: string, sessionId: string, _maxLimit = 25): Promise<ChatMessage[]> {
    try {
      const res = await apiFetch(`/api/v1/sessions/${sessionId}?limit=${_maxLimit}`);
      if (!res.ok) return [];
      const data = await res.json();
      if (data.success && data.data?.messages) {
        return data.data.messages as ChatMessage[];
      }
      return [];
    } catch (error) {
      console.warn('[Backend API] Failed to load chat history:', error);
      return [];
    }
  },
};
