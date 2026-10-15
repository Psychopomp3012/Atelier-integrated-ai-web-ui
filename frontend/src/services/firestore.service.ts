import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase.config';
import type { UserProfile, LinkedAIPlatformAccount, ChatMessage, ChatSession } from '../types';

export const firestoreService = {
  /**
   * Saves or merges the user profile into the Firestore `users` collection.
   */
  async syncUserProfile(user: UserProfile, fbUid?: string): Promise<void> {
    try {
      const docId = fbUid || user.id;
      const userRef = doc(db, 'users', docId);

      await setDoc(
        userRef,
        {
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
          primaryPlatform: user.primaryPlatform,
          linkedPlatforms: user.linkedPlatforms,
          updatedAt: serverTimestamp(),
          lastLoginAt: new Date().toISOString(),
          ...(user.createdAt ? { createdAt: user.createdAt } : { createdAt: new Date().toISOString() }),
        },
        { merge: true }
      );
      console.log(`[Firestore] Synchronized user profile for ${user.email} (${docId})`);
    } catch (error) {
      console.warn('[Firestore] Failed to sync user profile:', error);
    }
  },

  /**
   * Fetches the user profile document from Firestore.
   */
  async getUserProfile(docId: string): Promise<Partial<UserProfile> | null> {
    try {
      const userRef = doc(db, 'users', docId);
      const snapshot = await getDoc(userRef);
      if (snapshot.exists()) {
        return snapshot.data() as Partial<UserProfile>;
      }
      return null;
    } catch (error) {
      console.warn('[Firestore] Failed to get user profile:', error);
      return null;
    }
  },

  /**
   * Updates linked platforms (Claude, Codex, etc.) in Firestore.
   */
  async updateLinkedPlatforms(
    docId: string,
    linkedPlatforms: LinkedAIPlatformAccount[]
  ): Promise<void> {
    try {
      const userRef = doc(db, 'users', docId);
      await updateDoc(userRef, {
        linkedPlatforms,
        updatedAt: serverTimestamp(),
      });
      console.log(`[Firestore] Updated linked platforms for ${docId}`);
    } catch (error) {
      console.warn('[Firestore] Failed to update linked platforms:', error);
    }
  },

  /**
   * Saves or updates a complete chat session in Firestore.
   * Path: users/{userId}/sessions/{sessionId}
   */
  async saveSession(userId: string, session: ChatSession): Promise<void> {
    try {
      const sessionRef = doc(db, 'users', userId, 'sessions', session.id);
      await setDoc(
        sessionRef,
        {
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: serverTimestamp(),
          model: session.model,
          messages: session.messages,
        },
        { merge: true }
      );
      console.log(`[Firestore] Successfully persisted session ${session.id} for user ${userId}`);
    } catch (error) {
      console.warn('[Firestore] Failed to save session:', error);
    }
  },

  /**
   * Loads all chat sessions for a user, sorted by most recently updated.
   */
  async loadUserSessions(userId: string): Promise<ChatSession[]> {
    try {
      const sessionsRef = collection(db, 'users', userId, 'sessions');
      const q = query(sessionsRef, orderBy('updatedAt', 'desc'), limit(50));
      const snapshot = await getDocs(q);

      const sessions: ChatSession[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        sessions.push({
          id: data.id || d.id,
          title: data.title || 'Untitled Session',
          createdAt: data.createdAt || new Date().toISOString(),
          updatedAt:
            data.updatedAt?.toDate?.()?.toISOString() ||
            data.updatedAt ||
            new Date().toISOString(),
          messages: data.messages || [],
          model: data.model || 'claude-3-7-sonnet',
        });
      });
      console.log(`[Firestore] Loaded ${sessions.length} sessions for user ${userId}`);
      return sessions;
    } catch (error) {
      console.warn('[Firestore] Failed to load sessions:', error);
      return [];
    }
  },

  /**
   * Deletes a chat session from Firestore.
   */
  async deleteSession(userId: string, sessionId: string): Promise<void> {
    try {
      const sessionRef = doc(db, 'users', userId, 'sessions', sessionId);
      await deleteDoc(sessionRef);
      console.log(`[Firestore] Successfully removed session ${sessionId} for user ${userId}`);
    } catch (error) {
      console.warn('[Firestore] Failed to delete session:', error);
    }
  },

  /**
   * Stores a chat message in the user's conversation subcollection.
   */
  async saveChatMessage(userId: string, sessionId: string, message: ChatMessage): Promise<void> {
    try {
      const msgRef = doc(db, 'users', userId, 'sessions', sessionId, 'messages', message.id);
      await setDoc(
        msgRef,
        {
          id: message.id,
          role: message.role,
          author: message.author,
          authorBadge: message.authorBadge || null,
          time: message.time,
          avatarUrl: message.avatarUrl,
          content: message.content,
          modelBadge: message.modelBadge || null,
          latency: message.latency || null,
          steps: message.steps || [],
          executionResult: message.executionResult || null,
          explanationPoints: message.explanationPoints || [],
          timestamp: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.warn('[Firestore] Failed to save chat message in subcollection:', error);
    }
  },

  /**
   * Loads chat messages for a specific session from Firestore.
   */
  async loadChatMessages(userId: string, sessionId: string, maxLimit = 100): Promise<ChatMessage[]> {
    try {
      const messagesRef = collection(db, 'users', userId, 'sessions', sessionId, 'messages');
      const q = query(messagesRef, orderBy('timestamp', 'asc'), limit(maxLimit));
      const snapshot = await getDocs(q);

      const messages: ChatMessage[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        messages.push({
          id: data.id || d.id,
          role: data.role,
          author: data.author,
          authorBadge: data.authorBadge,
          time: data.time,
          avatarUrl: data.avatarUrl,
          content: data.content,
          modelBadge: data.modelBadge,
          latency: data.latency,
          steps: data.steps || [],
          executionResult: data.executionResult,
          explanationPoints: data.explanationPoints || [],
        });
      });
      return messages;
    } catch (error) {
      console.warn('[Firestore] Failed to load chat history:', error);
      return [];
    }
  },
};
