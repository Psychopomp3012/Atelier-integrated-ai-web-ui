import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  CloudSandboxMetrics,
  ISandboxProvider,
  SandboxExecutionResponse,
  SandboxCliExecutionRequest,
  SandboxCliExecutionResponse,
  SandboxFileNode,
  TerminalLogEntry,
} from '../../types/sandbox.types.js';
import { generateId } from '../../utils/id.util.js';
import { logger } from '../../utils/logger.util.js';

const execFileAsync = promisify(execFile);

export class DockerSandboxProvider implements ISandboxProvider {
  public readonly name = 'docker-local';
  private readonly image = 'integrated-agent-sandbox:latest';
  private readonly activeContainers = new Map<string, string>(); // sessionId -> containerName
  private readonly terminalLogs: TerminalLogEntry[] = [];
  private lastPingMs = 12;

  constructor() {
    this.addLog('READY', 'Docker Sandbox Provider initialized.');
  }

  private addLog(level: TerminalLogEntry['level'], message: string): void {
    const entry: TerminalLogEntry = {
      id: generateId('run'),
      timestamp: new Date().toISOString().substring(11, 23),
      level,
      message,
    };
    this.terminalLogs.push(entry);
    if (this.terminalLogs.length > 50) {
      this.terminalLogs.shift();
    }
  }

  public async isAvailable(): Promise<boolean> {
    try {
      const start = Date.now();
      await execFileAsync('docker', ['ps']);
      this.lastPingMs = Date.now() - start;
      return true;
    } catch {
      return false;
    }
  }

  private sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 24);
  }

  /**
   * Automatic Credential Bridge:
   * Safely synchronizes linked provider credentials (Antigravity/Gemini, Claude, Codex)
   * into the sandbox container (/home/node/) and exports relevant environment tokens.
   */
  public async seedProviderCredentials(containerName: string): Promise<void> {
    const homedir = os.homedir();
    try {
      // 1. Antigravity / Gemini CLI credentials seeding
      const agyDir = path.join(homedir, '.gemini', 'antigravity-cli');
      if (fs.existsSync(agyDir)) {
        await execFileAsync('docker', [
          'exec',
          '-i',
          containerName,
          'mkdir',
          '-p',
          '/home/node/.gemini/antigravity-cli',
        ]).catch(() => {});

        const filesToSync = ['settings.json', 'installation_id', 'jetski_state.pbtxt'];
        for (const file of filesToSync) {
          const hostFile = path.join(agyDir, file);
          if (fs.existsSync(hostFile)) {
            await execFileAsync('docker', [
              'cp',
              hostFile,
              `${containerName}:/home/node/.gemini/antigravity-cli/${file}`,
            ]).catch(() => {});
          }
        }
      }

      // Root .gemini credentials
      const oauthCreds = path.join(homedir, '.gemini', 'oauth_creds.json');
      if (fs.existsSync(oauthCreds)) {
        await execFileAsync('docker', [
          'cp',
          oauthCreds,
          `${containerName}:/home/node/.gemini/oauth_creds.json`,
        ]).catch(() => {});
      }
      const googleAccounts = path.join(homedir, '.gemini', 'google_accounts.json');
      if (fs.existsSync(googleAccounts)) {
        await execFileAsync('docker', [
          'cp',
          googleAccounts,
          `${containerName}:/home/node/.gemini/google_accounts.json`,
        ]).catch(() => {});
      }
      const userInfo = path.join(homedir, '.gemini', 'user_info.json');
      if (fs.existsSync(userInfo)) {
        await execFileAsync('docker', [
          'cp',
          userInfo,
          `${containerName}:/home/node/.gemini/user_info.json`,
        ]).catch(() => {});
      }

      // 2. Claude CLI credentials seeding
      const claudeCreds = path.join(homedir, '.claude', '.credentials.json');
      if (fs.existsSync(claudeCreds)) {
        await execFileAsync('docker', ['exec', '-i', containerName, 'mkdir', '-p', '/home/node/.claude']).catch(() => {});
        await execFileAsync('docker', [
          'cp',
          claudeCreds,
          `${containerName}:/home/node/.claude/.credentials.json`,
        ]).catch(() => {});
      }

      // 3. Codex CLI credentials seeding
      const codexCreds = path.join(homedir, '.codex', 'auth.json');
      if (fs.existsSync(codexCreds)) {
        await execFileAsync('docker', ['exec', '-i', containerName, 'mkdir', '-p', '/home/node/.codex']).catch(() => {});
        await execFileAsync('docker', [
          'cp',
          codexCreds,
          `${containerName}:/home/node/.codex/auth.json`,
        ]).catch(() => {});
      }

      // 4. Inject Environment Variables into container profile
      const envExports: string[] = [
        'export PATH=/home/node/.local/bin:/usr/local/bin:$PATH',
        'export TERM=xterm-256color',
      ];
      if (process.env.GEMINI_API_KEY) {
        envExports.push(`export GEMINI_API_KEY="${process.env.GEMINI_API_KEY}"`);
      }
      if (process.env.ANTHROPIC_API_KEY) {
        envExports.push(`export ANTHROPIC_API_KEY="${process.env.ANTHROPIC_API_KEY}"`);
      }
      if (process.env.OPENAI_API_KEY) {
        envExports.push(`export OPENAI_API_KEY="${process.env.OPENAI_API_KEY}"`);
      }
      if (process.env.ANTIGRAVITY_LS_ADDRESS) {
        envExports.push(`export ANTIGRAVITY_LS_ADDRESS="${process.env.ANTIGRAVITY_LS_ADDRESS}"`);
      }
      if (process.env.ANTIGRAVITY_CSRF_TOKEN) {
        envExports.push(`export ANTIGRAVITY_CSRF_TOKEN="${process.env.ANTIGRAVITY_CSRF_TOKEN}"`);
      }

      const bashrcCmd = `echo '${envExports.join('\n')}' > /home/node/.bashrc && cp /home/node/.bashrc /home/node/.profile`;
      await execFileAsync('docker', ['exec', '-i', containerName, 'bash', '-c', bashrcCmd]).catch(() => {});

      // 5. Ensure non-root node user ownership
      await execFileAsync('docker', [
        'exec',
        '-u',
        '0',
        containerName,
        'chown',
        '-R',
        'node:node',
        '/home/node',
        '/workspace',
      ]).catch(() => {});
    } catch (err) {
      logger.warn('Failed to seed some provider credentials to sandbox container', {
        containerName,
        error: String(err),
      });
    }
  }

  public getSandboxWorkspaceDir(_sessionId: string): string {
    return '/workspace';
  }

  public getActiveSandboxId(sessionId: string, _userId?: string): string | null {
    const cleanId = this.sanitizeId(sessionId) || 'default';
    return this.activeContainers.get(cleanId) || null;
  }

  public hasActiveSandbox(sessionId: string, userId?: string): boolean {
    return this.getActiveSandboxId(sessionId, userId) !== null;
  }

  public async getOrCreateSandbox(sessionId: string, _userId?: string, _targetSandboxId?: string, _replaceOldest?: boolean): Promise<string> {
    const cleanId = this.sanitizeId(sessionId) || 'default';
    const containerName = `agent-sb-${cleanId}`;

    if (this.activeContainers.has(cleanId)) {
      // Check if container is still alive
      try {
        const { stdout } = await execFileAsync('docker', [
          'inspect',
          '--format',
          '{{.State.Running}}',
          containerName,
        ]);
        if (stdout.trim() === 'true') {
          await this.seedProviderCredentials(containerName);
          return containerName;
        }
        await execFileAsync('docker', ['rm', '-f', containerName]).catch(() => {});
      } catch {
        // Container stopped or absent, proceed to recreate
      }
    } else {
      try {
        const { stdout } = await execFileAsync('docker', [
          'inspect',
          '--format',
          '{{.State.Running}}',
          containerName,
        ]);
        if (stdout.trim() === 'true') {
          await this.seedProviderCredentials(containerName);
          this.activeContainers.set(cleanId, containerName);
          return containerName;
        }
        await execFileAsync('docker', ['rm', '-f', containerName]).catch(() => {});
      } catch {}
    }

    // Launch container with dedicated isolated container volume (no host disk mounts)
    try {
      this.addLog('EXEC', `Spawning isolated container ${containerName}...`);
      await execFileAsync('docker', [
        'run',
        '-d',
        '--name',
        containerName,
        '--cpus=2.0',
        '--memory=2048m',
        '--security-opt=no-new-privileges:true',
        '--restart=no',
        '-v',
        `${containerName}-vol:/workspace:rw`,
        this.image,
      ]);

      await this.seedProviderCredentials(containerName);

      this.activeContainers.set(cleanId, containerName);
      this.addLog('READY', `Sandbox microVM ${containerName} ready for execution.`);
      return containerName;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Conflict') || msg.includes('already in use')) {
        await this.seedProviderCredentials(containerName);
        this.activeContainers.set(cleanId, containerName);
        return containerName;
      }
      logger.error('Failed to spawn Docker sandbox container', { error: msg });
      throw new Error(`Docker sandbox initialization failed: ${msg}`);
    }
  }

  public async executeCommand(
    sandboxId: string,
    command: string,
    timeoutMs: number = 30000
  ): Promise<SandboxExecutionResponse> {
    const start = Date.now();
    this.addLog('EXEC', `$ ${command.substring(0, 80)}`);

    try {
      const { stdout, stderr } = await execFileAsync(
        'docker',
        ['exec', '-i', '-u', 'node', '-w', '/workspace', sandboxId, 'bash', '-l', '-c', command],
        { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }
      );

      const durationMs = Date.now() - start;
      this.addLog('STREAM', `Command executed in ${durationMs}ms (exit code 0)`);

      return {
        success: true,
        sandboxId,
        durationMs,
        exitCode: 0,
        stdout: stdout || '',
        stderr: stderr || '',
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const errorObj = err as { code?: number | string; stdout?: string; stderr?: string; message?: string };
      const exitCode = typeof errorObj.code === 'number' ? errorObj.code : 1;
      const stdout = errorObj.stdout || '';
      const stderr = errorObj.stderr || errorObj.message || 'Execution error';

      this.addLog('WARN', `Command failed with exit code ${exitCode} (${durationMs}ms)`);

      return {
        success: false,
        sandboxId,
        durationMs,
        exitCode,
        stdout,
        stderr,
      };
    }
  }

  public async executeCliInSandbox(req: SandboxCliExecutionRequest): Promise<SandboxCliExecutionResponse> {
    const start = Date.now();
    const sessionId = req.sessionId || 'default';
    const containerName = await this.getOrCreateSandbox(sessionId, req.userId);
    const safePrompt = req.prompt.replace(/'/g, "'\\''");

    let cliCmd = '';
    if (req.cli === 'agy') {
      const modelFlag = req.model && req.model !== 'auto' && req.model !== 'default' ? `--model "${req.model}"` : '';
      cliCmd = `agy -p '${safePrompt}' --dangerously-skip-permissions --output-format stream-json ${modelFlag}`;
    } else if (req.cli === 'claude') {
      const modelFlag = req.model && req.model !== 'auto' && req.model !== 'default' ? `--model "${req.model}"` : '';
      cliCmd = `claude -p '${safePrompt}' --output-format=stream-json ${modelFlag}`;
    } else if (req.cli === 'codex') {
      const modelFlag = req.model && req.model !== 'auto' && req.model !== 'default' ? `-m "${req.model}"` : '';
      cliCmd = `codex exec --skip-git-repo-check --json --dangerously-bypass-approvals-and-sandbox -C /workspace ${modelFlag} '${safePrompt}'`;
    }

    this.addLog('EXEC', `[Docker-Native] Executing ${req.cli.toUpperCase()} in container ${containerName}...`);

    try {
      const { stdout } = await execFileAsync(
        'docker',
        ['exec', '-i', '-u', 'node', '-w', '/workspace', containerName, 'bash', '-l', '-c', cliCmd],
        { maxBuffer: 10 * 1024 * 1024, timeout: req.timeoutMs || 120000 }
      );

      const lines = stdout.split('\n');
      let text = '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.text || parsed.delta) {
            const token = parsed.text || parsed.delta;
            text += token;
            req.onToken?.(token);
          } else if (parsed.content) {
            text += parsed.content;
            req.onToken?.(parsed.content);
          }
        } catch {
          text += line + '\n';
        }
      }

      const durationMs = Date.now() - start;
      return {
        text: text.trim() || stdout.trim(),
        durationMs,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          duration_seconds: Math.round(durationMs / 1000),
          num_turns: 1,
        },
        exitCode: 0,
        sandboxId: containerName,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      this.addLog('ERROR', `[Docker-Native] CLI execution error: ${msg}`);
      throw err;
    }
  }

  public async writeFile(sandboxId: string, filePath: string, content: string | Buffer): Promise<boolean> {
    try {
      this.addLog('EXEC', `Writing artifact to ${filePath}`);
      const base64 = Buffer.isBuffer(content)
        ? content.toString('base64')
        : Buffer.from(content, 'utf8').toString('base64');
      const containerPath = filePath.startsWith('/') ? filePath : `/workspace/${filePath}`;
      const cmd = `mkdir -p "$(dirname "${containerPath}")" && echo "${base64}" | base64 -d > "${containerPath}"`;
      await execFileAsync('docker', ['exec', '-i', sandboxId, 'bash', '-c', cmd]);
      return true;
    } catch (err) {
      logger.error('Failed to write file in sandbox', { filePath, error: err });
      return false;
    }
  }

  public async readFile(sandboxId: string, filePath: string): Promise<string> {
    try {
      const fullPath = filePath.startsWith('/') ? filePath : `/workspace/${filePath}`;
      const ext = path.extname(filePath).toLowerCase().replace('.', '');
      const isRasterImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'].includes(ext);
      if (isRasterImage) {
        const { stdout } = await execFileAsync('docker', [
          'exec',
          '-i',
          sandboxId,
          'base64',
          '-w',
          '0',
          fullPath,
        ]);
        return stdout.trim();
      }
      const { stdout } = await execFileAsync('docker', [
        'exec',
        '-i',
        sandboxId,
        'cat',
        fullPath,
      ]);
      return stdout;
    } catch (err) {
      logger.error('Failed to read file from sandbox', { filePath, error: err });
      throw new Error(`File ${filePath} not found in sandbox`);
    }
  }

  public async listFiles(sandboxId: string): Promise<SandboxFileNode[]> {

    try {
      const script = `
const fs = require('fs');
const path = require('path');
function getTree(dir, depth = 0) {
  if (depth > 5) return [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter(e => !e.name.startsWith('.git') && e.name !== 'node_modules')
      .map(e => {
        const full = path.join(dir, e.name);
        const rel = path.relative('/workspace', full);
        if (e.isDirectory()) {
          return {
            name: e.name,
            path: rel,
            type: 'directory',
            children: getTree(full, depth + 1),
          };
        }
        const stat = fs.statSync(full);
        return {
          name: e.name,
          path: rel,
          type: 'file',
          size: stat.size,
          extension: path.extname(e.name).replace('.', ''),
        };
      });
  } catch (err) {
    return [];
  }
}
console.log(JSON.stringify(getTree('/workspace')));
`;
      const { stdout } = await execFileAsync('docker', [
        'exec',
        '-i',
        '-w',
        '/workspace',
        sandboxId,
        'node',
        '-e',
        script,
      ]);
      return JSON.parse(stdout.trim() || '[]');
    } catch (err) {
      logger.warn('Failed to list sandbox files', { sandboxId, error: String(err) });
      return [];
    }
  }

  public async destroySandbox(sandboxId: string): Promise<void> {
    try {
      this.addLog('INFO', `Tearing down container ${sandboxId}...`);
      await execFileAsync('docker', ['rm', '-f', sandboxId]);
      for (const [key, val] of this.activeContainers.entries()) {
        if (val === sandboxId) {
          this.activeContainers.delete(key);
          break;
        }
      }
    } catch (err) {
      logger.warn('Failed to tear down container', { sandboxId, error: err });
    }
  }

  public attachSessionToSandbox(sessionId: string, sandboxId: string): boolean {
    const cleanId = this.sanitizeId(sessionId) || 'default';
    this.activeContainers.set(cleanId, sandboxId);
    this.addLog('INFO', `Session [${cleanId}] attached to container ${sandboxId}`);
    return true;
  }

  public detachSession(sessionId: string): boolean {
    const cleanId = this.sanitizeId(sessionId) || 'default';
    const removed = this.activeContainers.delete(cleanId);
    if (removed) {
      this.addLog('INFO', `Session [${cleanId}] detached.`);
    }
    return removed;
  }

  public clearAllAttachedSessions(): void {
    this.activeContainers.clear();
  }

  public syncActiveSessions(activeSessionIds: string[], _userId?: string): void {
    const validCleanIds = new Set(
      activeSessionIds
        .map((s) => this.sanitizeId(s))
        .filter((s) => s && s !== 'default')
    );
    for (const sess of Array.from(this.activeContainers.keys())) {
      if (!validCleanIds.has(sess)) {
        this.activeContainers.delete(sess);
      }
    }
  }

  public getSandboxUsage(userId?: string): {
    used: number;
    max: number;
    sandboxes: Array<{
      sandboxId: string;
      name: string;
      sessionId?: string;
      lastActiveAt: number;
      createdAt: number;
      attachedSessionCount: number;
      attachedSessionIds: string[];
    }>;
  } {
    if (!userId || userId === 'default_user' || userId.trim() === '') {
      return {
        used: 0,
        max: 3,
        sandboxes: [],
      };
    }
    const containerMap = new Map<string, string[]>();
    for (const [sessId, contName] of this.activeContainers.entries()) {
      const list = containerMap.get(contName) || [];
      list.push(sessId);
      containerMap.set(contName, list);
    }

    const sandboxes = Array.from(containerMap.entries()).map(([contName, sessions], idx) => ({
      sandboxId: contName,
      name: `Docker Sandbox #${idx + 1} (${contName})`,
      sessionId: sessions[0] || 'default',
      lastActiveAt: Date.now(),
      createdAt: Date.now(),
      attachedSessionCount: sessions.length,
      attachedSessionIds: sessions,
    }));

    return {
      used: sandboxes.length,
      max: 3,
      sandboxes,
    };
  }

  public getMetrics(): CloudSandboxMetrics {
    const usage = this.getSandboxUsage();
    return {
      cpuUsagePercentage: 24,
      memoryUsedGb: 1.2,
      memoryTotalGb: 4.0,
      gpuThroughputTokensPerSec: 142.0,
      pingMs: this.lastPingMs,
      podName: 'docker-local-worker-1',
      clusterRegion: 'local-docker-engine',
      isHot: true,
      status: 'CONNECTED',
      sandboxesUsed: usage.used,
      sandboxesMax: usage.max,
    };
  }

  public getTerminalLogs(): TerminalLogEntry[] {
    return this.terminalLogs.slice(-25);
  }
}
