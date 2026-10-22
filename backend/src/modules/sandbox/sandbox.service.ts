import type {
  ISandboxProvider,
  SandboxExecutionRequest,
  SandboxExecutionResponse,
  SandboxCliExecutionRequest,
  SandboxCliExecutionResponse,
  SandboxFileNode,
  SandboxUsageInfo,
  TerminalLogEntry,
} from '../../types/sandbox.types.js';
import { E2BSandboxProvider } from './e2b-sandbox.provider.js';
import { envConfig } from '../../config/env.config.js';
import { logger } from '../../utils/logger.util.js';

export class SandboxService {
  private readonly provider: ISandboxProvider;
  private readonly e2bProvider: E2BSandboxProvider;

  constructor() {
    this.e2bProvider = new E2BSandboxProvider();
    this.provider = this.e2bProvider;
    logger.info('SandboxService: Activated E2B Cloud Sandbox Provider');
  }

  public getProviderName(): string {
    return this.provider.name;
  }

  public getTerminalLogs(): TerminalLogEntry[] {
    return this.provider.getTerminalLogs();
  }

  public async executeInSandbox(req: SandboxExecutionRequest): Promise<SandboxExecutionResponse> {
    const isAvailable = await this.provider.isAvailable();
    const sessionId = req.sessionId || 'default';

    if (!isAvailable) {
      logger.warn('Active sandbox provider is not available', { provider: this.provider.name });
      return {
        success: false,
        sandboxId: 'offline-sandbox',
        durationMs: 40,
        exitCode: 1,
        stdout: '',
        stderr: `${this.provider.name} is not available. Please ensure E2B_API_KEY is configured in your environment.`,
      };
    }

    try {
      const sandboxId = await this.provider.getOrCreateSandbox(sessionId, req.userId, req.sandboxId);

      // 1. Direct shell command execution
      if (req.command) {
        return await this.provider.executeCommand(
          sandboxId,
          req.command,
          req.timeoutMs || 30000
        );
      }

      // 2. Code snippet execution based on language
      const lang = (req.language || 'bash').toLowerCase();
      let runnerCmd = '';
      let filename = '';

      if (lang.includes('node') || lang.includes('js') || lang.includes('javascript')) {
        filename = 'index.js';
        runnerCmd = 'node index.js';
      } else if (lang.includes('py') || lang.includes('python')) {
        filename = 'script.py';
        runnerCmd = 'python3 script.py';
      } else if (lang.includes('sh') || lang.includes('bash')) {
        filename = 'run.sh';
        runnerCmd = 'bash run.sh';
      } else {
        filename = 'code.txt';
        runnerCmd = `cat ${filename}`;
      }

      // Write file into sandbox workspace
      await this.provider.writeFile(sandboxId, filename, req.code || '');

      // Execute command inside sandbox
      return await this.provider.executeCommand(
        sandboxId,
        runnerCmd,
        req.timeoutMs || 30000
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to execute in sandbox', { provider: this.provider.name, error: msg });
      return {
        success: false,
        sandboxId: 'err-vm',
        durationMs: 10,
        exitCode: 1,
        stdout: '',
        stderr: msg,
      };
    }
  }

  public async executeCliInSandbox(req: SandboxCliExecutionRequest): Promise<SandboxCliExecutionResponse> {
    const isAvailable = await this.provider.isAvailable();
    if (!isAvailable) {
      throw new Error(`${this.provider.name} is not available for sandbox-native CLI execution.`);
    }
    if (this.provider.executeCliInSandbox) {
      return await this.provider.executeCliInSandbox(req);
    }
    throw new Error(`Active provider ${this.provider.name} does not implement executeCliInSandbox.`);
  }

  public async writeFile(sandboxId: string, filePath: string, content: string | Buffer): Promise<boolean> {
    return this.provider.writeFile(sandboxId, filePath, content);
  }

  public hasActiveSandbox(sandboxId?: string, userId?: string): boolean {
    if (this.provider.hasActiveSandbox) {
      return this.provider.hasActiveSandbox(sandboxId, userId);
    }
    const usage = this.getSandboxUsage(userId);
    return usage.used > 0;
  }

  public getActiveSandboxId(sandboxId?: string, userId?: string): string | null {
    if (this.provider.getActiveSandboxId) {
      return this.provider.getActiveSandboxId(sandboxId, userId);
    }
    const usage = this.getSandboxUsage(userId);
    return usage.sandboxes[0]?.sandboxId || null;
  }

  public async readFile(
    sessionIdOrSandboxId: string,
    filePath: string,
    userId?: string,
    targetSandboxId?: string
  ): Promise<string> {
    let activeSandboxId = targetSandboxId || this.getActiveSandboxId(sessionIdOrSandboxId, userId);
    if (!activeSandboxId) {
      const usage = this.getSandboxUsage(userId);
      if (usage.sandboxes && usage.sandboxes.length > 0) {
        activeSandboxId = usage.sandboxes[0].sandboxId;
      }
    }
    if (!activeSandboxId) {
      throw new Error(`No active cloud sandbox VM is running for session ${sessionIdOrSandboxId}. Please click 'Start Sandbox VM'.`);
    }
    return this.provider.readFile(activeSandboxId, filePath);
  }

  public async listFiles(sessionId: string, userId?: string, targetSandboxId?: string): Promise<SandboxFileNode[]> {
    const isAvail = await this.provider.isAvailable();
    if (!isAvail) return [];

    let activeSandboxId = targetSandboxId || this.getActiveSandboxId(sessionId, userId);
    if (!activeSandboxId) {
      const usage = this.getSandboxUsage(userId);
      if (usage.sandboxes && usage.sandboxes.length > 0) {
        activeSandboxId = usage.sandboxes[0].sandboxId;
      }
    }
    if (!activeSandboxId) {
      return [];
    }
    try {
      return await this.provider.listFiles(activeSandboxId);
    } catch (err) {
      logger.warn('Failed to list sandbox files in service', { sessionId, targetSandboxId, error: String(err) });
      return [];
    }
  }

  public async getOrCreateSandbox(
    sessionId: string,
    userId?: string,
    targetSandboxId?: string
  ): Promise<string> {
    return this.provider.getOrCreateSandbox(sessionId, userId, targetSandboxId);
  }

  public async destroySandbox(sandboxIdOrSessionId: string): Promise<void> {
    return this.provider.destroySandbox(sandboxIdOrSessionId);
  }

  public async killAgentProcesses(sandboxIdOrSessionId: string): Promise<boolean> {
    if (this.provider.killAgentProcesses) {
      return this.provider.killAgentProcesses(sandboxIdOrSessionId);
    }
    return false;
  }

  public async syncWithCloud(userId?: string): Promise<void> {
    if (this.provider.syncWithCloud) {
      await this.provider.syncWithCloud(userId);
    }
  }

  public async syncCredentialsToUserSandboxes(userId?: string): Promise<void> {
    if (this.e2bProvider.syncCredentialsToUserSandboxes) {
      await this.e2bProvider.syncCredentialsToUserSandboxes(userId).catch(() => {});
    }
  }

  public async purgeUserCredentialsFromSandboxes(userId?: string, cli?: 'antigravity' | 'gemini' | 'claude' | 'codex'): Promise<void> {
    if (this.e2bProvider.purgeUserCredentialsFromSandboxes) {
      await this.e2bProvider.purgeUserCredentialsFromSandboxes(userId, cli).catch(() => {});
    }
  }

  public getSandboxUsage(userId?: string): {
    used: number;
    max: number;
    sandboxes: SandboxUsageInfo[];
  } {
    if (this.provider.getSandboxUsage) {
      return this.provider.getSandboxUsage(userId);
    }
    return {
      used: 0,
      max: envConfig.MAX_SANDBOXES_PER_USER ?? 3,
      sandboxes: [],
    };
  }

  public sanitizeSessionId(sessionId: string): string {
    return sessionId.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32) || 'default';
  }

  public getSandboxWorkspaceDir(sessionId: string): string {
    if (this.provider.getSandboxWorkspaceDir) {
      return this.provider.getSandboxWorkspaceDir(sessionId);
    }
    return '/workspace';
  }

  public async verifyAndReactivateSandbox(
    sandboxId: string,
    userId: string,
    sessionId?: string
  ): Promise<{ sandboxId: string; name: string }> {
    if (this.provider.verifyAndReactivateSandbox) {
      return await this.provider.verifyAndReactivateSandbox(sandboxId, userId, sessionId);
    }
    return { sandboxId, name: `Sandbox (${sandboxId.slice(0, 6)})` };
  }
}

export const sandboxService = new SandboxService();
