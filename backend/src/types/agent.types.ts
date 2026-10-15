import type { CliUsageTelemetry } from '../modules/quota/quota.types.js';

export type ModelEngine = string;

export type MessageRole = 'user' | 'assistant' | 'system';

export interface AgentStep {
  id: string;
  description: string;
  durationMs: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
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
  authorName: string;
  authorTag?: string;
  avatarUrl?: string;
  modelUsed?: ModelEngine;
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
  | { type: 'done'; response: PromptExecutionResponse }
  | { type: 'error'; error: string };
