export type ChatRole = 'user' | 'assistant' | 'system';

export interface StepItem {
  id: string;
  text: string;
  duration: string;
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
  authorBadge?: string;
  time: string;
  avatarUrl: string;
  content: string;
  modelBadge?: string;
  latency?: string;
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

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  model: string;
}

export type SaveSessionInput = ChatSession;
