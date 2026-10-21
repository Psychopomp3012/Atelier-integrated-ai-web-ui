import type { CliUsageTelemetry } from '../modules/quota/quota.types.js';

export type ModelEngine = string;

export type MessageRole = 'user' | 'assistant' | 'system';

export interface AgentStep {
  id: string;
  description: string;
  text?: string;
  durationMs: number;
  duration?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  completed?: boolean;
  tool?: string;
  command?: string;
  output?: string;
  exitCode?: number;
}

export interface CodeArtifactFile {
  filename: string;
  language: string;
  content: string;
}

export interface AgentMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  time?: string;
  authorName: string;
  author?: string;
  authorTag?: string;
  avatarUrl?: string;
  modelUsed?: ModelEngine;
  modelBadge?: string;
  latency?: string;
  latencyMs?: number;
  steps?: AgentStep[];
  codeFiles?: CodeArtifactFile[];
  executionResult?: {
    sandboxId: string;
    durationMs: number;
    status: string;
    details: string;
  };
  tokenUsage?: CliUsageTelemetry;
}

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

import type { AttachedFileInput } from '../modules/agent/agent.schema.js';

export interface PromptExecutionRequest {
  sessionId?: string;
  sandboxId?: string;
  userId?: string;
  userMessageId?: string;
  truncateAfterMessageId?: string;
  prompt: string;
  selectedModel: ModelEngine;
  model?: ModelEngine;
  messages?: HistoryMessage[];
  files?: AttachedFileInput[];
  environmentTarget?: string;
  apiKey?: string;
}

export interface PromptExecutionResponse {
  sessionId: string;
  message: AgentMessage;
}

export type AgentStreamEvent =
  | { type: 'start'; sessionId: string; model: ModelEngine }
  | { type: 'step'; step: AgentStep }
  | { type: 'token'; token: string }
  | {
      type: 'done';
      response: PromptExecutionResponse;
      codexQuota?: any;
      geminiQuota?: any;
      sandboxUsage?: any;
    }
  | { type: 'error'; error: string };
