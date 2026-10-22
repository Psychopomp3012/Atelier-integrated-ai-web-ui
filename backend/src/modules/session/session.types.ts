export type ChatRole = 'user' | 'assistant' | 'system';

export interface StepItem {
  id: string;
  text: string;
  description?: string;
  duration: string;
  durationMs?: number;
  completed: boolean;
  status?: 'pending' | 'in_progress' | 'completed' | 'failed';
  tool?: string;
  command?: string;
  output?: string;
  exitCode?: number;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  author: string;
  authorName?: string;
  authorBadge?: string;
  time: string;
  timestamp?: string;
  avatarUrl: string;
  content: string;
  modelBadge?: string;
  modelUsed?: string;
  latency?: string;
  latencyMs?: number;
  steps?: StepItem[];
  codeFiles?: Array<{
    filename: string;
    icon: string;
    code: string;
  }>;
  executionResult?: {
    time: string;
    sandboxId: string;
    statusText: string;
  };
  explanationPoints?: string[];
}

export interface PaginationMeta {
  total: number;
  returned: number;
  hasMore: boolean;
  remaining: number;
  oldestMessageId?: string;
  newestMessageId?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSessionDetails extends ChatSession {
  messages?: ChatMessage[];
  pagination?: PaginationMeta;
  overwriteMessages?: boolean;
  truncateAfterMessageId?: string;
}

export type SessionSummary = ChatSession;

export interface SessionPaginationQuery {
  limit?: number;
  beforeId?: string;
  all?: boolean;
}

export interface PaginatedMessagesResponse {
  sessionId: string;
  messages: ChatMessage[];
  pagination: PaginationMeta;
}

export type SaveSessionInput = Omit<ChatSessionDetails, 'messageCount'> & {
  messageCount?: number;
};
