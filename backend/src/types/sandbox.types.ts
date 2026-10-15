export interface CloudSandboxMetrics {
  cpuUsagePercentage: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  gpuThroughputTokensPerSec: number;
  pingMs: number;
  podName: string;
  clusterRegion: string;
  isHot: boolean;
  status: 'CONNECTED' | 'DISCONNECTED' | 'DEGRADED';
  sandboxesUsed?: number;
  sandboxesMax?: number;
}


export interface TerminalLogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'READY' | 'EXEC' | 'STREAM' | 'WARN' | 'ERROR';
  message: string;
}

export interface SandboxExecutionRequest {
  code: string;
  language: string;
  command?: string;
  sessionId?: string;
  sandboxId?: string;
  userId?: string;
  entrypoint?: string;
  timeoutMs?: number;
}

export interface SandboxExecutionResponse {
  success: boolean;
  sandboxId: string;
  durationMs: number;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SandboxFileWriteRequest {
  sessionId?: string;
  sandboxId?: string;
  filePath: string;
  content: string;
}

export interface SandboxFileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  extension?: string;
  children?: SandboxFileNode[];
}

export interface SandboxUsageInfo {
  sandboxId: string;
  name: string;
  sessionId?: string;
  lastActiveAt: number;
  createdAt: number;
  attachedSessionCount: number;
  attachedSessionIds: string[];
}

export interface SandboxCliExecutionRequest {
  sessionId?: string;
  sandboxId?: string;
  userId?: string;
  cli: 'agy' | 'claude' | 'codex';
  prompt: string;
  model?: string;
  onToken?: (token: string) => void;
  onStep?: (step: any) => void;
  timeoutMs?: number;
}

export interface SandboxCliExecutionResponse {
  text: string;
  durationMs: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    thinking_tokens?: number;
    cache_read_tokens?: number;
    total_tokens: number;
    duration_seconds?: number;
    num_turns?: number;
  };
  exitCode?: number;
  sandboxId?: string;
}

export interface ISandboxProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  getOrCreateSandbox(sessionId: string, userId?: string, targetSandboxId?: string, replaceOldest?: boolean): Promise<string>;
  attachSessionToSandbox?(sessionId: string, sandboxId: string): boolean;
  detachSession?(sessionId: string): boolean;
  clearAllAttachedSessions?(): void;
  syncActiveSessions?(activeSessionIds: string[], userId?: string): void;
  executeCommand(sandboxId: string, command: string, timeoutMs?: number): Promise<SandboxExecutionResponse>;
  executeCliInSandbox?(req: SandboxCliExecutionRequest): Promise<SandboxCliExecutionResponse>;
  writeFile(sandboxId: string, filePath: string, content: string | Buffer): Promise<boolean>;
  readFile(sandboxId: string, filePath: string): Promise<string>;
  listFiles(sandboxId: string): Promise<SandboxFileNode[]>;
  destroySandbox(sandboxId: string): Promise<void>;
  getMetrics(): CloudSandboxMetrics;
  getTerminalLogs(): TerminalLogEntry[];
  getSandboxWorkspaceDir?(sessionId: string): string;
  hasActiveSandbox?(sessionId: string, userId?: string): boolean;
  getActiveSandboxId?(sessionId: string, userId?: string): string | null;
  syncWithCloud?(userId?: string): Promise<void>;
  getSandboxUsage?(userId?: string): {
    used: number;
    max: number;
    sandboxes: SandboxUsageInfo[];
  };
}
