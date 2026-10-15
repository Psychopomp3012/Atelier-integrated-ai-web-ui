import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatSession } from './session.types.js';
import { logger } from '../../utils/logger.util.js';

export class SessionService {
  private readonly memoryCache = new Map<string, Map<string, ChatSession>>();

  private getStorageDir(): string {
    const dir = path.join(os.homedir(), '.gemini', 'chat_sessions');
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        logger.warn('Failed to create chat_sessions directory', { error: String(err) });
      }
    }
    return dir;
  }

  private sanitizeUserId(userId: string): string {
    return userId.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 48) || 'default_user';
  }

  private getUserFilePath(userId: string): string {
    const safeId = this.sanitizeUserId(userId);
    return path.join(this.getStorageDir(), `${safeId}.json`);
  }

  private loadUserMap(userId: string): Map<string, ChatSession> {
    const safeId = this.sanitizeUserId(userId);
    let userMap = this.memoryCache.get(safeId);
    if (userMap) {
      return userMap;
    }

    userMap = new Map<string, ChatSession>();
    const filePath = this.getUserFilePath(userId);

    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && item.id) {
              userMap.set(item.id, item);
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`Failed to read stored sessions for user ${safeId}`, { error: String(err) });
    }

    this.memoryCache.set(safeId, userMap);
    return userMap;
  }

  private persistUserMap(userId: string): void {
    const safeId = this.sanitizeUserId(userId);
    const userMap = this.loadUserMap(userId);
    const filePath = this.getUserFilePath(userId);

    try {
      const list = Array.from(userMap.values()).sort(
        (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
      );
      fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (err) {
      logger.error(`Failed to persist chat sessions for user ${safeId}`, { error: String(err) });
    }
  }

  public async getUserSessions(userId: string): Promise<ChatSession[]> {
    const userMap = this.loadUserMap(userId);
    return Array.from(userMap.values()).sort(
      (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
    );
  }

  public async getSessionById(userId: string, sessionId: string): Promise<ChatSession | null> {
    const userMap = this.loadUserMap(userId);
    return userMap.get(sessionId) || null;
  }

  public async saveUserSession(userId: string, session: ChatSession): Promise<ChatSession> {
    if (!session.id) {
      session.id = `sess_${Date.now()}`;
    }
    const userMap = this.loadUserMap(userId);
    const existing = userMap.get(session.id);

    const merged: ChatSession = {
      id: session.id,
      title: session.title || existing?.title || 'Untitled Session',
      createdAt: session.createdAt || existing?.createdAt || new Date().toISOString(),
      updatedAt: session.updatedAt || new Date().toISOString(),
      messages: Array.isArray(session.messages) ? session.messages : existing?.messages || [],
      model: session.model || existing?.model || 'none',
    };

    userMap.set(session.id, merged);
    this.persistUserMap(userId);

    logger.info(`Persisted session ${session.id} for user ${this.sanitizeUserId(userId)} (${merged.messages.length} messages)`);
    return merged;
  }

  public async deleteUserSession(userId: string, sessionId: string): Promise<boolean> {
    const userMap = this.loadUserMap(userId);
    const deleted = userMap.delete(sessionId);
    if (deleted) {
      this.persistUserMap(userId);
      logger.info(`Deleted session ${sessionId} for user ${this.sanitizeUserId(userId)}`);
    }
    return deleted;
  }
}

export const sessionService = new SessionService();
