import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logger } from '../utils/logger.util.js';
import type {
  ChatMessage,
  ChatSession,
  PaginationMeta,
  SessionPaginationQuery,
  PaginatedMessagesResponse,
} from '../modules/session/session.types.js';

export interface UserProfileData {
  id: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  primaryPlatform?: string;
  linkedPlatforms?: Record<string, any>;
  updatedAt?: string;
  lastLoginAt?: string;
}

export class FirestoreBackendService {
  private db: Firestore | null = null;
  private isAvailable: boolean = false;

  constructor() {
    this.init();
  }

  private init(): void {
    try {
      if (getApps().length === 0) {
        const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
        const googleAppCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'integrated-ai-cli';

        const gcloudAdc = path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');

        let certObj: any = null;
        if (serviceAccountEnv) {
          try {
            const trimmed = serviceAccountEnv.trim();
            if (trimmed.startsWith('{')) {
              certObj = JSON.parse(trimmed);
            } else if (fs.existsSync(trimmed)) {
              certObj = JSON.parse(fs.readFileSync(trimmed, 'utf8'));
            } else {
              const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
              if (decoded.trim().startsWith('{')) {
                certObj = JSON.parse(decoded);
              }
            }
          } catch (e) {
            logger.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT environment variable', { error: String(e) });
          }
        }

        if (certObj) {
          initializeApp({
            credential: cert(certObj),
            projectId: certObj.project_id || projectId,
          });
        } else if (googleAppCreds && fs.existsSync(googleAppCreds)) {
          initializeApp({
            credential: applicationDefault(),
            projectId,
          });
        } else if (fs.existsSync(gcloudAdc)) {
          initializeApp({
            credential: applicationDefault(),
            projectId,
          });
        } else {
          this.isAvailable = false;
          this.db = null;
          logger.info(
            'Firebase Firestore credentials not found (set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS for persistent cloud storage). Operating with in-memory fallback.'
          );
          return;
        }
      }

      this.db = getFirestore();
      this.db.settings({ ignoreUndefinedProperties: true });
      this.isAvailable = true;
      logger.info('FirestoreBackendService initialized successfully', {
        projectId: process.env.FIREBASE_PROJECT_ID || 'integrated-ai-cli',
      });
    } catch (err) {
      this.isAvailable = false;
      this.db = null;
      logger.warn('Firebase Firestore initialization skipped or failed', {
        error: String(err),
      });
    }
  }

  // --- Message Merging and Pagination Helpers ---

  public mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
    if (!existing || existing.length === 0) return Array.isArray(incoming) ? incoming : [];
    if (!incoming || incoming.length === 0) return Array.isArray(existing) ? existing : [];

    const incomingMap = new Map<string, ChatMessage>();
    for (const m of incoming) {
      if (m && m.id) incomingMap.set(m.id, m);
    }

    const result: ChatMessage[] = [];
    const seenIds = new Set<string>();

    for (const m of existing) {
      if (!m || !m.id) continue;
      if (incomingMap.has(m.id)) {
        result.push(incomingMap.get(m.id)!);
      } else {
        result.push(m);
      }
      seenIds.add(m.id);
    }

    for (const m of incoming) {
      if (!m || !m.id) continue;
      if (!seenIds.has(m.id)) {
        result.push(m);
        seenIds.add(m.id);
      }
    }

    return result;
  }

  public paginateMessages(
    allMessages: ChatMessage[],
    limit: number = 25,
    beforeId?: string,
    all: boolean = false
  ): { messages: ChatMessage[]; pagination: PaginationMeta } {
    const total = allMessages.length;
    const safeLimit = Math.max(1, Math.min(limit || 25, 100));

    if (all || total <= safeLimit) {
      return {
        messages: allMessages,
        pagination: {
          total,
          returned: total,
          hasMore: false,
          remaining: 0,
          oldestMessageId: allMessages[0]?.id,
          newestMessageId: allMessages[total - 1]?.id,
        },
      };
    }

    if (beforeId) {
      const targetIndex = allMessages.findIndex((m) => m.id === beforeId);
      if (targetIndex <= 0) {
        return {
          messages: [],
          pagination: {
            total,
            returned: 0,
            hasMore: false,
            remaining: 0,
          },
        };
      }
      const startIndex = Math.max(0, targetIndex - safeLimit);
      const endIndex = targetIndex;
      const slice = allMessages.slice(startIndex, endIndex);
      const remaining = startIndex;
      return {
        messages: slice,
        pagination: {
          total,
          returned: slice.length,
          hasMore: remaining > 0,
          remaining,
          oldestMessageId: slice[0]?.id,
          newestMessageId: slice[slice.length - 1]?.id,
        },
      };
    }

    // Default: latest `safeLimit` messages
    const startIndex = Math.max(0, total - safeLimit);
    const slice = allMessages.slice(startIndex);
    const remaining = startIndex;
    return {
      messages: slice,
      pagination: {
        total,
        returned: slice.length,
        hasMore: remaining > 0,
        remaining,
        oldestMessageId: slice[0]?.id,
        newestMessageId: slice[slice.length - 1]?.id,
      },
    };
  }

  // --- Session Management ---

  public async saveSession(userId: string, session: ChatSession): Promise<ChatSession> {
    if (!session.id) {
      session.id = `sess_${Date.now()}`;
    }

    let existingMessages: ChatMessage[] = [];

    if (this.isAvailable && this.db) {
      try {
        const docRef = this.db.collection('users').doc(userId).collection('sessions').doc(session.id);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
          const d = docSnap.data();
          if (Array.isArray(d?.messages)) {
            existingMessages = d.messages;
          }
        }
      } catch (err) {
        logger.warn('Failed to read existing session from Firestore', { error: String(err) });
      }
    }

    const mergedMessages = this.mergeMessages(
      existingMessages,
      Array.isArray(session.messages) ? session.messages : []
    );

    const cleanSession: ChatSession = {
      id: session.id,
      title: session.title || 'Untitled Session',
      createdAt: session.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: session.model || 'claude-3-7-sonnet',
      messages: mergedMessages,
      messageCount: mergedMessages.length,
    };

    // Persist to Cloud Firestore if available
    if (this.isAvailable && this.db) {
      try {
        const sessionRef = this.db.collection('users').doc(userId).collection('sessions').doc(cleanSession.id);
        await sessionRef.set(
          {
            ...cleanSession,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        logger.info(`Persisted session ${cleanSession.id} (${cleanSession.messageCount} messages) to Firebase for user ${userId}`);
      } catch (err) {
        logger.warn('Failed to write session to Firebase Firestore', { error: String(err) });
      }
    }

    return cleanSession;
  }

  public async getUserSessions(
    userId: string,
    options?: { includeAllMessages?: boolean }
  ): Promise<ChatSession[]> {
    if (this.isAvailable && this.db) {
      try {
        const sessionsRef = this.db.collection('users').doc(userId).collection('sessions');
        const snapshot = await sessionsRef.limit(50).get();
        if (!snapshot.empty) {
          const sessions: ChatSession[] = [];
          snapshot.forEach((doc: QueryDocumentSnapshot) => {
            const data = doc.data();
            const allMsgs = Array.isArray(data.messages) ? data.messages : [];
            sessions.push({
              id: data.id || doc.id,
              title: data.title || 'Untitled Session',
              createdAt: data.createdAt || new Date().toISOString(),
              updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt || new Date().toISOString(),
              model: data.model || 'claude-3-7-sonnet',
              messageCount: allMsgs.length,
              // Lightweight response: empty or 1 preview message to avoid bloated transfers
              messages: options?.includeAllMessages ? allMsgs : allMsgs.slice(-1),
            });
          });
          sessions.sort(
            (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
          );
          logger.info(`Loaded ${sessions.length} sessions from Firebase for user ${userId}`);
          return sessions;
        }
      } catch (err) {
        logger.warn('Failed to read sessions from Firebase Firestore', { error: String(err) });
      }
    }

    return [];
  }

  public async getSessionById(
    userId: string,
    sessionId: string,
    query?: SessionPaginationQuery
  ): Promise<ChatSession | null> {
    let rawSession: ChatSession | null = null;

    if (this.isAvailable && this.db) {
      try {
        const docRef = this.db.collection('users').doc(userId).collection('sessions').doc(sessionId);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
          const data = docSnap.data()!;
          rawSession = {
            id: data.id || docSnap.id,
            title: data.title || 'Untitled Session',
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt || new Date().toISOString(),
            model: data.model || 'claude-3-7-sonnet',
            messages: Array.isArray(data.messages) ? data.messages : [],
          };
        }
      } catch (err) {
        logger.warn('Failed to fetch session from Firebase Firestore', { error: String(err) });
      }
    }

    if (!rawSession) return null;

    const paged = this.paginateMessages(
      rawSession.messages || [],
      query?.limit ?? 25,
      query?.beforeId,
      query?.all ?? false
    );

    return {
      ...rawSession,
      messages: paged.messages,
      messageCount: rawSession.messages.length,
      pagination: paged.pagination,
    };
  }

  public async getSessionMessages(
    userId: string,
    sessionId: string,
    query?: SessionPaginationQuery
  ): Promise<PaginatedMessagesResponse | null> {
    const session = await this.getSessionById(userId, sessionId, { all: true });
    if (!session) return null;

    const paged = this.paginateMessages(
      session.messages || [],
      query?.limit ?? 25,
      query?.beforeId,
      query?.all ?? false
    );

    return {
      sessionId,
      messages: paged.messages,
      pagination: paged.pagination,
    };
  }

  public async deleteUserSession(userId: string, sessionId: string): Promise<boolean> {
    if (this.isAvailable && this.db) {
      try {
        await this.db.collection('users').doc(userId).collection('sessions').doc(sessionId).delete();
        logger.info(`Deleted session ${sessionId} from Firebase Firestore for user ${userId}`);
        return true;
      } catch (err) {
        logger.warn('Failed to delete session from Firebase Firestore', { error: String(err) });
        return false;
      }
    }

    return false;
  }

  // --- User Profile & CLI Links Management ---

  public async syncUserProfile(user: UserProfileData): Promise<void> {
    if (this.isAvailable && this.db) {
      try {
        const userRef = this.db.collection('users').doc(user.id);
        await userRef.set(
          {
            ...user,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        logger.info(`Synced user profile in Firestore for user ${user.id}`);
      } catch (err) {
        logger.warn('Failed to sync user profile to Firestore', { error: String(err) });
      }
    }
  }

  public async getUserProfile(userId: string): Promise<UserProfileData | null> {
    if (this.isAvailable && this.db) {
      try {
        const userRef = this.db.collection('users').doc(userId);
        const snap = await userRef.get();
        if (snap.exists) {
          return snap.data() as UserProfileData;
        }
      } catch (err) {
        logger.warn('Failed to fetch user profile from Firestore', { error: String(err) });
      }
    }
    return null;
  }

  // --- Sandbox Metadata Persistence in Firebase Firestore ---

  public async saveSandboxRecord(userId: string, record: {
    sandboxId: string;
    name: string;
    userId: string;
    attachedSessionIds: string[];
    createdAt: number;
    lastActiveAt: number;
    provider?: string;
  }): Promise<void> {
    if (this.isAvailable && this.db && userId) {
      try {
        const ref = this.db.collection('users').doc(userId).collection('sandboxes').doc(record.sandboxId);
        await ref.set(
          {
            ...record,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        logger.info(`Persisted sandbox record ${record.sandboxId} to Firebase for user ${userId}`);
      } catch (err) {
        logger.warn('Failed to save sandbox record to Firebase Firestore', { error: String(err) });
      }
    }
  }

  public async getUserSandboxes(userId: string): Promise<any[]> {
    if (this.isAvailable && this.db && userId) {
      try {
        const snap = await this.db.collection('users').doc(userId).collection('sandboxes').limit(20).get();
        if (!snap.empty) {
          const list: any[] = [];
          snap.forEach((doc: QueryDocumentSnapshot) => {
            list.push(doc.data());
          });
          return list;
        }
      } catch (err) {
        logger.warn('Failed to load sandbox records from Firebase Firestore', { error: String(err) });
      }
    }
    return [];
  }

  public async deleteSandboxRecord(userId: string, sandboxId: string): Promise<void> {
    if (this.isAvailable && this.db && userId && sandboxId) {
      try {
        await this.db.collection('users').doc(userId).collection('sandboxes').doc(sandboxId).delete();
        logger.info(`Deleted sandbox record ${sandboxId} from Firebase Firestore for user ${userId}`);
      } catch (err) {
        logger.warn('Failed to delete sandbox record from Firebase Firestore', { error: String(err) });
      }
    }
  }
}

export const firestoreBackendService = new FirestoreBackendService();
