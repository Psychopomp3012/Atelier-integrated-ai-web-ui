import type {
  ChatSession,
  SessionPaginationQuery,
  PaginatedMessagesResponse,
} from './session.types.js';
import { firestoreBackendService } from '../../services/firestore.service.js';

export class SessionService {
  public async getUserSessions(
    userId: string,
    options?: { includeAllMessages?: boolean }
  ): Promise<ChatSession[]> {
    return firestoreBackendService.getUserSessions(userId, options);
  }

  public async getSessionById(
    userId: string,
    sessionId: string,
    query?: SessionPaginationQuery
  ): Promise<ChatSession | null> {
    return firestoreBackendService.getSessionById(userId, sessionId, query);
  }

  public async getSessionMessages(
    userId: string,
    sessionId: string,
    query?: SessionPaginationQuery
  ): Promise<PaginatedMessagesResponse | null> {
    return firestoreBackendService.getSessionMessages(userId, sessionId, query);
  }

  public async saveUserSession(userId: string, session: ChatSession): Promise<ChatSession> {
    return firestoreBackendService.saveSession(userId, session);
  }

  public async deleteUserSession(userId: string, sessionId: string): Promise<boolean> {
    return firestoreBackendService.deleteUserSession(userId, sessionId);
  }
}

export const sessionService = new SessionService();
