import dns from 'node:dns';
import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import fs from 'node:fs';

// Prioritize IPv4 for Firestore gRPC subchannels
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}
import path from 'node:path';
import os from 'node:os';
import { logger } from '../utils/logger.util.js';
import { timingLogger } from '../utils/timing.util.js';
import type {
  ChatMessage,
  StepItem,
  ChatSession,
  ChatSessionDetails,
  SaveSessionInput,
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
  linkedPlatforms?: any[];
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
            let trimmed = serviceAccountEnv.trim();
            if (
              (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
              (trimmed.startsWith('"') && trimmed.endsWith('"'))
            ) {
              trimmed = trimmed.substring(1, trimmed.length - 1).trim();
            }
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

  public mergeMessages(
    existing: ChatMessage[],
    incoming: ChatMessage[],
    options?: { overwrite?: boolean; truncateAfterMessageId?: string }
  ): ChatMessage[] {
    if (options?.overwrite) {
      return Array.isArray(incoming) ? incoming : [];
    }

    if (!existing || existing.length === 0) return Array.isArray(incoming) ? incoming : [];
    if (!incoming || incoming.length === 0) return Array.isArray(existing) ? existing : [];

    let baseExisting = existing;
    if (options?.truncateAfterMessageId) {
      const cutIdx = existing.findIndex((m) => m && m.id === options.truncateAfterMessageId);
      if (cutIdx >= 0) {
        baseExisting = existing.slice(0, cutIdx + 1);
      }
    } else if (existing[0]?.id && incoming[0]?.id && existing[0].id === incoming[0].id) {
      // If incoming starts from the very first message of the session (root message),
      // any messages in existing that follow the last common message in incoming
      // were deleted/pruned during an edit.
      const incomingIdSet = new Set(incoming.map((m) => m.id).filter(Boolean));
      let lastCommonIdxInExisting = -1;
      for (let i = 0; i < existing.length; i++) {
        if (incomingIdSet.has(existing[i].id)) {
          lastCommonIdxInExisting = i;
        }
      }
      if (lastCommonIdxInExisting >= 0 && lastCommonIdxInExisting < existing.length - 1) {
        baseExisting = existing.slice(0, lastCommonIdxInExisting + 1);
      }
    }

    const incomingMap = new Map<string, ChatMessage>();
    for (const m of incoming) {
      if (m && m.id) incomingMap.set(m.id, m);
    }

    const result: ChatMessage[] = [];
    const seenIds = new Set<string>();

    for (const m of baseExisting) {
      if (!m || !m.id) continue;
      if (incomingMap.has(m.id)) {
        const inc = incomingMap.get(m.id)!;
        result.push({
          ...m,
          ...inc,
          steps: inc.steps && inc.steps.length > 0 ? inc.steps : m.steps,
          codeFiles: inc.codeFiles && inc.codeFiles.length > 0 ? inc.codeFiles : m.codeFiles,
          executionResult: inc.executionResult || m.executionResult,
        });
      } else {
        result.push(m);
      }
      seenIds.add(m.id);
    }

    for (const m of incoming) {
      if (!m || !m.id) continue;
      if (!seenIds.has(m.id)) {
        const lastMsg = result[result.length - 1];
        if (lastMsg && lastMsg.role === m.role && lastMsg.content === m.content) {
          continue;
        }
        result.push(m);
        seenIds.add(m.id);
      }
    }

    return result.map((m) => this.normalizeMessage(m));
  }

  public normalizeMessage(m: any): ChatMessage {
    if (!m) return m;
    const authorName = m.author || m.authorName || (m.role === 'user' ? 'User' : 'Atelier Assistant');
    const isAssistant = m.role === 'assistant';
    const modelUsed = m.modelBadge || m.modelUsed || m.authorTag || '';
    const latencyFormatted =
      m.latency ||
      (typeof m.latencyMs === 'number' && m.latencyMs > 0
        ? `Latency: ${m.latencyMs.toLocaleString()}ms`
        : undefined);

    const rawSteps = Array.isArray(m.steps) ? m.steps : [];
    const normalizedSteps: StepItem[] = rawSteps.map((s: any) => {
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
      (isAssistant && modelUsed && modelUsed !== 'Atelier Assistant'
        ? modelUsed
        : undefined);

    return {
      ...m,
      author: authorName,
      authorName: m.authorName || authorName,
      time: m.time || m.timestamp || '',
      timestamp: m.timestamp || m.time || '',
      modelBadge: modelBadge || m.modelBadge,
      modelUsed: m.modelUsed || modelUsed,
      latency: latencyFormatted || m.latency,
      steps: normalizedSteps,
    };
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

  public async saveSession(userId: string, session: SaveSessionInput): Promise<ChatSessionDetails> {
    const start = performance.now();
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
      Array.isArray(session.messages) ? session.messages : [],
      {
        overwrite: session.overwriteMessages,
        truncateAfterMessageId: session.truncateAfterMessageId,
      }
    );

    const cleanSession: ChatSessionDetails = {
      id: session.id,
      title: session.title || 'Untitled Session',
      createdAt: session.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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

    timingLogger.logTiming('Firestore', 'saveSession', Math.round(performance.now() - start), {
      userId,
      sessionId: cleanSession.id,
      messageCount: cleanSession.messageCount,
    });
    return cleanSession;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs = 6000, fallback: T): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        logger.warn(`Firestore operation timed out after ${timeoutMs}ms, falling back safely`);
        resolve(fallback);
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([promise, timeoutPromise]);
      if (timer) clearTimeout(timer);
      return result;
    } catch (err) {
      if (timer) clearTimeout(timer);
      throw err;
    }
  }

  private inFlightUserSessions = new Map<string, Promise<ChatSession[]>>();
  private lastSessionsLog = new Map<string, { count: number; timestamp: number }>();

  public async getUserSessions(
    userId: string,
    options?: { includeAllMessages?: boolean }
  ): Promise<ChatSession[]> {
    if (!this.isAvailable || !this.db || !userId) {
      return [];
    }

    const inFlightKey = `${userId}:${!!options?.includeAllMessages}`;
    const existing = this.inFlightUserSessions.get(inFlightKey);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      const start = performance.now();
      try {
        const sessionsRef = this.db!.collection('users').doc(userId).collection('sessions');
        const snapshot = await this.withTimeout(sessionsRef.limit(50).get(), 6000, null);
        if (snapshot && !snapshot.empty) {
          const sessions: ChatSession[] = [];
          snapshot.forEach((doc: QueryDocumentSnapshot) => {
            const data = doc.data();
            const messageCount = typeof data.messageCount === 'number'
              ? data.messageCount
              : (Array.isArray(data.messages) ? data.messages.length : 0);

            const sessionSummary: ChatSession = {
              id: data.id || doc.id,
              title: data.title || 'Untitled Session',
              messageCount,
              createdAt: data.createdAt || new Date().toISOString(),
              updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt || new Date().toISOString(),
            };

            sessions.push(sessionSummary);
          });
          sessions.sort(
            (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
          );
          const lastLog = this.lastSessionsLog.get(userId);
          const now = Date.now();
          if (!lastLog || lastLog.count !== sessions.length || now - lastLog.timestamp > 15_000) {
            this.lastSessionsLog.set(userId, { count: sessions.length, timestamp: now });
            logger.info(`Loaded ${sessions.length} sessions from Firebase for user ${userId}`);
          }
          timingLogger.logTiming('Firestore', 'getUserSessions', Math.round(performance.now() - start), {
            userId,
            count: sessions.length,
          });
          return sessions;
        }
      } catch (err) {
        logger.warn('Failed to read sessions from Firebase Firestore', { error: String(err) });
      } finally {
        this.inFlightUserSessions.delete(inFlightKey);
      }
      timingLogger.logTiming('Firestore', 'getUserSessions', Math.round(performance.now() - start), {
        userId,
        count: 0,
      });
      return [];
    })();

    this.inFlightUserSessions.set(inFlightKey, promise);
    return promise;
  }

  public async getSessionById(
    userId: string,
    sessionId: string,
    query?: SessionPaginationQuery
  ): Promise<ChatSessionDetails | null> {
    let rawSession: ChatSessionDetails | null = null;

    if (this.isAvailable && this.db) {
      try {
        const docRef = this.db.collection('users').doc(userId).collection('sessions').doc(sessionId);
        const docSnap = await this.withTimeout(docRef.get(), 6000, null);
        if (docSnap && docSnap.exists) {
          const data = docSnap.data()!;
          rawSession = {
            id: data.id || docSnap.id,
            title: data.title || 'Untitled Session',
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt || new Date().toISOString(),
            messageCount: typeof data.messageCount === 'number' ? data.messageCount : (Array.isArray(data.messages) ? data.messages.length : 0),
            messages: (Array.isArray(data.messages) ? data.messages : []).map((m: any) =>
              this.normalizeMessage(m)
            ),
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
      messageCount: rawSession.messages?.length ?? 0,
      pagination: paged.pagination,
    };
  }

  /**
   * Phase 4 IDOR Defense: Verifies that a sessionId belongs to the requested userId.
   * If the session exists under another user, returns false.
   * If the session belongs to userId, or is a brand-new session not yet created, returns true.
   */
  public async verifySessionOwnership(userId: string, sessionId: string): Promise<boolean> {
    if (!sessionId || !userId) return true;
    if (!this.isAvailable || !this.db) return true;

    try {
      // 1. Direct check: Does this user own this session?
      const userDocRef = this.db.collection('users').doc(userId).collection('sessions').doc(sessionId);
      const userDocSnap = await this.withTimeout(userDocRef.get(), 4000, null);
      if (userDocSnap && userDocSnap.exists) {
        return true;
      }

      // 2. IDOR check: Does this session exist under a different user?
      const groupSnap = await this.withTimeout(
        this.db.collectionGroup('sessions').where('id', '==', sessionId).limit(1).get(),
        4000,
        null
      );
      if (groupSnap && !groupSnap.empty) {
        logger.warn('[IDOR_VIOLATION] User attempted to access session owned by another user', {
          userId,
          sessionId,
        });
        return false;
      }

      // Doesn't exist yet anywhere -> valid new session
      return true;
    } catch (err) {
      logger.warn('Failed to verify session ownership in Firestore, defaulting to allow', { error: String(err) });
      return true;
    }
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
        const linkedPlatforms = Array.isArray(user.linkedPlatforms)
          ? user.linkedPlatforms
          : typeof user.linkedPlatforms === 'object' && user.linkedPlatforms !== null
          ? Object.values(user.linkedPlatforms).filter(
              (p: any) => Boolean(p && typeof p === 'object' && 'platform' in p)
            )
          : [];

        await userRef.set(
          {
            ...user,
            linkedPlatforms,
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
          const data = snap.data() as UserProfileData;
          if (data) {
            if (Array.isArray(data.linkedPlatforms)) {
              // already array
            } else if (data.linkedPlatforms && typeof data.linkedPlatforms === 'object') {
              const platformValues = Object.values(data.linkedPlatforms).filter(
                (p: any) => Boolean(p && typeof p === 'object' && 'platform' in p)
              );
              data.linkedPlatforms = platformValues;
            } else {
              delete (data as any).linkedPlatforms;
            }
          }
          return data;
        }
      } catch (err) {
        logger.warn('Failed to fetch user profile from Firestore', { error: String(err) });
      }
    }
    return null;
  }

  // --- Sandbox Metadata Persistence in Firebase Firestore ---

  private lastSavedSandboxSnapshot = new Map<string, string>();

  public async saveSandboxRecord(userId: string, record: {
    sandboxId: string;
    name: string;
    userId: string;
    attachedSessionIds?: string[];
    createdAt: number;
    lastActiveAt: number;
    provider?: string;
    lastUpdateCheckAt?: number;
  }): Promise<void> {
    if (this.isAvailable && this.db && userId) {
      const cacheKey = `${userId}:${record.sandboxId}`;
      try {
        const recordSnapshot = JSON.stringify({
          sandboxId: record.sandboxId,
          name: record.name,
          userId: record.userId,
          attachedSessionIds: [...(record.attachedSessionIds || [])].sort(),
          provider: record.provider,
        });

        // Prevent redundant Firestore writes and duplicate logs if record has not changed
        if (this.lastSavedSandboxSnapshot.get(cacheKey) === recordSnapshot) {
          return;
        }

        // Lock in snapshot immediately before awaiting to prevent concurrent race conditions
        this.lastSavedSandboxSnapshot.set(cacheKey, recordSnapshot);

        const ref = this.db.collection('users').doc(userId).collection('sandboxes').doc(record.sandboxId);
        const start = performance.now();
        await ref.set(
          {
            ...record,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        timingLogger.logTiming('Firestore', 'saveSandboxRecord', Math.round(performance.now() - start), {
          userId,
          sandboxId: record.sandboxId,
        });
        logger.info(`Persisted sandbox record ${record.sandboxId} to Firebase for user ${userId}`);
      } catch (err) {
        this.lastSavedSandboxSnapshot.delete(cacheKey);
        logger.warn('Failed to save sandbox record to Firebase Firestore', { error: String(err) });
      }
    }
  }

  public async getUserSandboxes(userId: string): Promise<any[]> {
    if (this.isAvailable && this.db && userId) {
      const start = performance.now();
      try {
        const snap = await this.db.collection('users').doc(userId).collection('sandboxes').limit(20).get();
        if (!snap.empty) {
          const list: any[] = [];
          snap.forEach((doc: QueryDocumentSnapshot) => {
            const data = doc.data();
            list.push(data);
            if (data?.sandboxId) {
              const cacheKey = `${userId}:${data.sandboxId}`;
              this.lastSavedSandboxSnapshot.set(
                cacheKey,
                JSON.stringify({
                  sandboxId: data.sandboxId,
                  name: data.name,
                  userId: data.userId || userId,
                  attachedSessionIds: [...(Array.isArray(data.attachedSessionIds) ? data.attachedSessionIds : [])].sort(),
                  provider: data.provider,
                })
              );
            }
          });
          timingLogger.logTiming('Firestore', 'getUserSandboxes', Math.round(performance.now() - start), {
            userId,
            count: list.length,
          });
          return list;
        }
      } catch (err) {
        logger.warn('Failed to load sandbox records from Firebase Firestore', { error: String(err) });
      }
      timingLogger.logTiming('Firestore', 'getUserSandboxes', Math.round(performance.now() - start), {
        userId,
        count: 0,
      });
    }
    return [];
  }

  public async deleteSandboxRecord(userId: string, sandboxId: string): Promise<void> {
    if (this.isAvailable && this.db && userId && sandboxId) {
      try {
        this.lastSavedSandboxSnapshot.delete(`${userId}:${sandboxId}`);
        await this.db.collection('users').doc(userId).collection('sandboxes').doc(sandboxId).delete();
        logger.info(`Deleted sandbox record ${sandboxId} from Firebase Firestore for user ${userId}`);
      } catch (err) {
        logger.warn('Failed to delete sandbox record from Firebase Firestore', { error: String(err) });
      }
    }
  }

  // --- Persistent Cross-Platform CLI Links in Firebase Firestore ---

  public async getUserCliLinks(userId?: string, userEmail?: string): Promise<Record<string, any> | null> {
    if (!this.isAvailable || !this.db) return null;
    try {
      if (userId) {
        const snap = await this.db.collection('users').doc(userId).get();
        if (snap.exists) {
          const data = snap.data();
          const links = data?.cliLinks || (!Array.isArray(data?.linkedPlatforms) ? data?.linkedPlatforms : null);
          if (links && typeof links === 'object' && Object.keys(links).length > 0) return links;
        }
      }
      if (userEmail) {
        const cleanEmail = userEmail.toLowerCase().trim();
        // 1. Direct lookup by email doc id in case email was used as doc key
        const emailDocSnap = await this.db.collection('users').doc(cleanEmail).get();
        if (emailDocSnap.exists) {
          const data = emailDocSnap.data();
          const links = data?.cliLinks || (!Array.isArray(data?.linkedPlatforms) ? data?.linkedPlatforms : null);
          if (links && typeof links === 'object' && Object.keys(links).length > 0) return links;
        }

        // 2. Query lookup by email field across all users
        const querySnap = await this.db.collection('users').where('email', '==', cleanEmail).get();
        for (const doc of querySnap.docs) {
          const data = doc.data();
          const links = data?.cliLinks || (!Array.isArray(data?.linkedPlatforms) ? data?.linkedPlatforms : null);
          if (links && typeof links === 'object' && Object.keys(links).length > 0) return links;
        }
      }
    } catch (err) {
      logger.warn('Failed to fetch user CLI links from Firestore', { error: String(err) });
    }
    return null;
  }

  public async saveUserCliLinks(userId: string, cliLinks: Record<string, any>, userEmail?: string): Promise<void> {
    if (!this.isAvailable || !this.db || !userId || userId === 'anonymous') return;
    try {
      const cleanEmail = (userEmail || cliLinks.email || '').toLowerCase().trim();
      let targetDocId = userId;
      if (targetDocId === 'anonymous') return;

      // If userId looks like an email, check if a canonical user ID doc exists
      if (userId.includes('@') && cleanEmail) {
        const querySnap = await this.db.collection('users').where('email', '==', cleanEmail).limit(1).get();
        if (!querySnap.empty && querySnap.docs[0].id) {
          targetDocId = querySnap.docs[0].id;
        }
      }

      const payload = {
        id: targetDocId,
        ...(cleanEmail ? { email: cleanEmail } : {}),
        cliLinks,
        updatedAt: FieldValue.serverTimestamp(),
      };

      await this.db.collection('users').doc(targetDocId).set(payload, { merge: true });

      // If targetDocId is different from userId, keep both synchronized for seamless lookup
      if (targetDocId !== userId) {
        await this.db.collection('users').doc(userId).set(
          {
            ...(cleanEmail ? { email: cleanEmail } : {}),
            cliLinks,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      logger.info(`Persisted CLI links to Firebase Firestore for user ${targetDocId}`, {
        antigravity: cliLinks?.antigravity?.linked,
        codex: cliLinks?.codex?.linked,
        claude: cliLinks?.claude?.linked,
      });
    } catch (err) {
      logger.warn('Failed to save user CLI links to Firestore', { error: String(err) });
    }
  }

  public async getUserTelemetry(
    userId?: string,
    userEmail?: string,
    provider: 'antigravity' | 'codex' = 'antigravity'
  ): Promise<any | null> {
    if (!this.isAvailable || !this.db) return null;
    try {
      if (userId) {
        const snap = await this.db.collection('users').doc(userId).get();
        if (snap.exists) {
          const data = snap.data();
          const tel = data?.telemetry?.[provider];
          if (tel && typeof tel === 'object') {
            // Never return volatile quota limits from Firestore
            const { rateLimits, lastQuotaLimits, ...safeTel } = tel;
            return safeTel;
          }
        }
      }
      if (userEmail) {
        const cleanEmail = userEmail.toLowerCase().trim();
        const emailDocSnap = await this.db.collection('users').doc(cleanEmail).get();
        if (emailDocSnap.exists) {
          const data = emailDocSnap.data();
          const tel = data?.telemetry?.[provider];
          if (tel && typeof tel === 'object') {
            const { rateLimits, lastQuotaLimits, ...safeTel } = tel;
            return safeTel;
          }
        }
        const querySnap = await this.db.collection('users').where('email', '==', cleanEmail).limit(1).get();
        if (!querySnap.empty) {
          const data = querySnap.docs[0].data();
          const tel = data?.telemetry?.[provider];
          if (tel && typeof tel === 'object') {
            const { rateLimits, lastQuotaLimits, ...safeTel } = tel;
            return safeTel;
          }
        }
      }
    } catch (err) {
      logger.warn(`Failed to fetch ${provider} telemetry from Firestore`, { error: String(err) });
    }
    return null;
  }

  public async saveUserTelemetry(
    userId: string,
    telemetryData: any,
    provider: 'antigravity' | 'codex' = 'antigravity',
    userEmail?: string
  ): Promise<void> {
    if (!this.isAvailable || !this.db || !userId || userId === 'anonymous') return;
    try {
      const cleanEmail = (userEmail || '').toLowerCase().trim();
      let targetDocId = userId;
      if (targetDocId === 'anonymous') return;
      if (userId.includes('@') && cleanEmail) {
        const querySnap = await this.db.collection('users').where('email', '==', cleanEmail).limit(1).get();
        if (!querySnap.empty && querySnap.docs[0].id) {
          targetDocId = querySnap.docs[0].id;
        }
      }
      // Strictly exclude volatile quota and rate limit data from Firestore persistence
      const { rateLimits, lastQuotaLimits, ...sanitizedTelemetry } = telemetryData || {};
      const payload: Record<string, any> = {
        [`telemetry.${provider}`]: sanitizedTelemetry,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (cleanEmail) {
        payload.email = cleanEmail;
      }
      await this.db.collection('users').doc(targetDocId).set(payload, { merge: true });
      if (cleanEmail && targetDocId !== cleanEmail) {
        // Also ensure email-based lookup directly resolves by updating email document if it exists
        try {
          const emailDoc = await this.db.collection('users').doc(cleanEmail).get();
          if (emailDoc.exists) {
            await this.db.collection('users').doc(cleanEmail).set(payload, { merge: true });
          }
        } catch {}
      }
      logger.info(`Persisted ${provider} usage telemetry to Firebase for user ${targetDocId}`, {
        userEmail: cleanEmail,
        turns: sanitizedTelemetry.totalTurns,
        tokens: sanitizedTelemetry.totalTokens,
      });
    } catch (err) {
      logger.warn(`Failed to save ${provider} telemetry to Firestore`, { error: String(err) });
    }
  }
}

export const firestoreBackendService = new FirestoreBackendService();
