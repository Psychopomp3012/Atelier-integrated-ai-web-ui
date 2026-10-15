import { sandboxService } from '../sandbox/sandbox.service.js';
import { logger } from '../../utils/logger.util.js';
import { generateId } from '../../utils/id.util.js';
import type { AgentStep, HistoryMessage, CodeArtifactFile } from '../../types/agent.types.js';

export interface SandboxToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export const SANDBOX_TOOLS: SandboxToolDefinition[] = [
  {
    name: 'run_command',
    description: 'Execute a bash command in the isolated cloud sandbox microVM (/workspace) and return stdout, stderr, and exitCode. Use this whenever you need to check specs, inspect files, build, run code, or test software.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute in the cloud sandbox (e.g., uname -a, lscpu, free -h, ls -la, cat <file>, npm test, python3 script.py)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file from the cloud sandbox workspace (/workspace/<path>).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The relative file path to read (e.g. package.json, src/index.ts).',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file in the cloud sandbox workspace (/workspace/<path>) with the specified content.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The relative file path to write.',
        },
        content: {
          type: 'string',
          description: 'The full text content to write to the file.',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_dir',
    description: 'List files and directories in the cloud sandbox workspace (/workspace).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional subfolder path. Defaults to root /workspace.',
        },
      },
    },
  },
];

export interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface AutonomousExecutionResult {
  text: string;
  steps: AgentStep[];
  codeFiles: CodeArtifactFile[];
  durationMs: number;
}

export class AutonomousExecutorService {
  /**
   * Normalizes LLM tool names, stripping arbitrary namespaces like repo_browser., tools., bash., etc.
   */
  public normalizeToolName(rawName: string, args: Record<string, any> = {}): string {
    const lower = (rawName || '').trim().toLowerCase();
    const base = lower.includes('.') ? lower.split('.').pop()! : lower;

    if (
      base === 'list_dir' ||
      base === 'list_files' ||
      base === 'list_directory' ||
      base === 'listdir' ||
      base === 'listfiles' ||
      base === 'dir' ||
      base === 'ls'
    ) {
      return 'list_dir';
    }

    if (
      base === 'read_file' ||
      base === 'read' ||
      base === 'view_file' ||
      base === 'view' ||
      base === 'get_file_contents' ||
      base === 'get_file_content' ||
      base === 'readfile' ||
      base === 'cat'
    ) {
      return 'read_file';
    }

    if (
      base === 'write_file' ||
      base === 'write' ||
      base === 'save_file' ||
      base === 'create_file' ||
      base === 'edit_file' ||
      base === 'writefile' ||
      base === 'write_to_file'
    ) {
      return 'write_file';
    }

    if (
      base === 'run_command' ||
      base === 'bash' ||
      base === 'sh' ||
      base === 'exec' ||
      base === 'execute' ||
      base === 'execute_command' ||
      base === 'terminal' ||
      base === 'shell' ||
      base === 'command' ||
      base === 'cmd'
    ) {
      return 'run_command';
    }

    // Argument-driven heuristics if name was ambiguous
    if (args.command || args.cmd || args.script) {
      return 'run_command';
    }
    if (args.content !== undefined && (args.path || args.file || args.filename)) {
      return 'write_file';
    }
    if ((args.path || args.file || args.filename) && args.content === undefined) {
      if (base.includes('dir') || base.includes('folder') || base.includes('list')) {
        return 'list_dir';
      }
      return 'read_file';
    }

    return base;
  }

  /**
   * Executes a tool inside the isolated cloud sandbox microVM under agent-runner.
   */
  public async executeTool(
    name: string,
    args: Record<string, any>,
    sessionId: string,
    userId?: string
  ): Promise<{ output: string; success: boolean; durationMs: number; command?: string; exitCode?: number }> {
    const start = Date.now();
    const normalizedName = this.normalizeToolName(name, args);

    try {
      if (normalizedName === 'run_command') {
        const cmd = args.command || args.cmd || args.script || '';
        if (!cmd.trim()) {
          return { output: 'Error: No command provided', success: false, durationMs: 0, command: cmd, exitCode: 1 };
        }
        const res = await sandboxService.executeInSandbox({
          command: cmd,
          code: '',
          language: 'bash',
          sessionId,
          userId,
          timeoutMs: 45000,
        });

        const outputParts = [];
        if (res.stdout?.trim()) outputParts.push(res.stdout.trim());
        if (res.stderr?.trim()) outputParts.push(`[stderr]\n${res.stderr.trim()}`);
        if (!res.stdout?.trim() && !res.stderr?.trim()) outputParts.push('(command exited with no output)');

        return {
          output: outputParts.join('\n\n'),
          success: res.success,
          durationMs: res.durationMs || Date.now() - start,
          command: cmd,
          exitCode: res.exitCode,
        };
      }

      if (normalizedName === 'read_file') {
        const filePath = args.path || args.file || args.filename || '';
        const content = await sandboxService.readFile(sessionId, filePath, userId);
        return {
          output: content,
          success: true,
          durationMs: Date.now() - start,
          command: `cat ${filePath}`,
          exitCode: 0,
        };
      }

      if (normalizedName === 'write_file') {
        const filePath = args.path || args.file || args.filename || '';
        const content = args.content || args.text || args.code || '';
        const targetSbId = sandboxService.getActiveSandboxId(sessionId, userId) || sessionId;
        await sandboxService.writeFile(targetSbId, filePath, content);
        return {
          output: `Successfully wrote ${content.length} bytes to ${filePath}`,
          success: true,
          durationMs: Date.now() - start,
          command: `write > ${filePath}`,
          exitCode: 0,
        };
      }

      if (normalizedName === 'list_dir') {
        const targetDir = args.path || args.dir || args.directory || '/workspace';
        const files = await sandboxService.listFiles(sessionId, userId).catch(() => []);
        let listing = '';
        if (files.length > 0) {
          listing = files.map((f) => `- ${f.name} (${f.type === 'directory' ? 'dir' : `${f.size}B`})`).join('\n');
        } else {
          // Direct bash execution fallback in the microVM
          const cmdRes = await sandboxService.executeInSandbox({
            command: `ls -la ${targetDir}`,
            code: '',
            language: 'bash',
            sessionId,
            userId,
            timeoutMs: 10000,
          }).catch(() => null);

          if (cmdRes && cmdRes.stdout && cmdRes.stdout.trim()) {
            listing = cmdRes.stdout.trim();
          } else {
            listing = '(workspace directory is empty)';
          }
        }
        return {
          output: listing,
          success: true,
          durationMs: Date.now() - start,
          command: `ls -la ${targetDir}`,
          exitCode: 0,
        };
      }

      // If tool name is a common Unix command, execute it directly in the microVM
      const unixCommands = new Set([
        'ls', 'cat', 'grep', 'find', 'mkdir', 'rm', 'touch', 'cp', 'mv', 'pwd', 'whoami',
        'uname', 'lscpu', 'free', 'df', 'top', 'ps', 'curl', 'wget', 'git', 'python', 'python3', 'node', 'npm'
      ]);
      if (unixCommands.has(normalizedName)) {
        const cmdArgs = args.args || args.command || args.flags || args.path || '';
        const fullCmd = `${normalizedName} ${cmdArgs}`.trim();
        const res = await sandboxService.executeInSandbox({
          command: fullCmd,
          code: '',
          language: 'bash',
          sessionId,
          userId,
          timeoutMs: 45000,
        });
        return {
          output: res.stdout || res.stderr || '(command exited with no output)',
          success: res.success,
          durationMs: res.durationMs || Date.now() - start,
          command: fullCmd,
          exitCode: res.exitCode,
        };
      }

      return { output: `Unknown tool: ${name}`, success: false, durationMs: Date.now() - start, exitCode: 1 };
    } catch (err: any) {
      return {
        output: `Tool execution failed: ${err?.message || String(err)}`,
        success: false,
        durationMs: Date.now() - start,
        exitCode: 1,
      };
    }
  }

  /**
   * Parses tool calls from LLM responses (JSON tool_calls, ```tool_call blocks, or executable bash blocks).
   */
  public parseToolCalls(rawText: string, isInitialTurn: boolean = false): ParsedToolCall[] {
    const calls: ParsedToolCall[] = [];

    // 1. Direct JSON tool_calls format (e.g. from OpenAI / Function Calling schema)
    try {
      const parsed = JSON.parse(rawText.trim());
      if (Array.isArray(parsed.tool_calls)) {
        for (const tc of parsed.tool_calls) {
          const fn = tc.function || tc;
          let args = fn.arguments;
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { }
          }
          const rawArgs = typeof args === 'object' && args !== null ? args : { command: String(args) };
          calls.push({
            id: tc.id || generateId('run'),
            name: this.normalizeToolName(fn.name, rawArgs),
            args: rawArgs,
          });
        }
        if (calls.length > 0) return calls;
      }
    } catch { }

    // 2. Markdown ```tool_call ... ``` or ```tool ... ``` blocks
    const toolCallRegex = /```(?:tool_call|tool|action|json:tool)\s*([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;
    while ((match = toolCallRegex.exec(rawText)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        const toolName = parsed.tool || parsed.name || parsed.action;
        const toolArgs = parsed.args || parsed.parameters || parsed.arguments || {};
        if (toolName) {
          calls.push({
            id: generateId('run'),
            name: this.normalizeToolName(toolName, toolArgs),
            args: toolArgs,
          });
        }
      } catch { }
    }

    if (calls.length > 0) return calls;

    // 3. Markdown ```json ... ``` blocks with explicit tool action
    const jsonBlockRegex = /```json\s*([\s\S]*?)```/gi;
    let jsonMatch: RegExpExecArray | null;
    while ((jsonMatch = jsonBlockRegex.exec(rawText)) !== null) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        if (parsed && typeof parsed === 'object') {
          const toolName = parsed.tool || parsed.name || parsed.action;
          const toolArgs = parsed.args || parsed.parameters || parsed.arguments || {};
          if (toolName) {
            const normalized = this.normalizeToolName(toolName, toolArgs);
            if (SANDBOX_TOOLS.some((t) => t.name === normalized)) {
              calls.push({
                id: generateId('run'),
                name: normalized,
                args: toolArgs,
              });
            }
          }
        }
      } catch { }
    }

    if (calls.length > 0) return calls;

    // 4. Executable bash command blocks:
    const bashRegex = /```(?:bash|sh|shell)\s*([\s\S]*?)```/gi;
    let bashMatch: RegExpExecArray | null;
    while ((bashMatch = bashRegex.exec(rawText)) !== null) {
      const cmd = bashMatch[1].trim();
      // Skip purely informative comments or non-executable text
      if (cmd && !cmd.startsWith('#!') && !calls.some((c) => c.args.command === cmd)) {
        calls.push({
          id: generateId('run'),
          name: 'run_command',
          args: { command: cmd },
        });
      }
    }

    return calls;
  }

  /**
   * Formats a user-friendly step description based on the tool and arguments.
   */
  public formatStepDescription(toolName: string, args: Record<string, any>): string {
    const normalized = this.normalizeToolName(toolName, args);
    if (normalized === 'run_command') {
      const cmd = String(args.command || args.cmd || args.script || '').trim();
      const preview = cmd.length > 44 ? `${cmd.slice(0, 44)}...` : cmd;
      return `Running command: \`${preview}\``;
    }
    if (normalized === 'read_file') {
      const p = String(args.path || args.file || args.filename || '');
      return `Reading file: \`${p}\``;
    }
    if (normalized === 'write_file') {
      const p = String(args.path || args.file || args.filename || '');
      return `Writing artifact: \`${p}\``;
    }
    if (normalized === 'list_dir') {
      return `Scanning directory \`${args.path || args.dir || args.directory || '/workspace'}\``;
    }
    return `Executing tool: ${normalized}`;
  }

  /**
   * Runs the autonomous ReAct agent loop in the cloud sandbox microVM.
   */
  public async executeAutonomousLoop(
    userPrompt: string,
    sessionId: string,
    userId: string | undefined,
    modelUsed: string,
    history: HistoryMessage[],
    callInference: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => Promise<string>,
    onStep?: (step: AgentStep) => void,
    onToken?: (token: string) => void
  ): Promise<AutonomousExecutionResult> {
    const startTime = Date.now();
    const steps: AgentStep[] = [];
    const conversationMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const h of history) {
      conversationMessages.push({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content,
      });
    }

    if (conversationMessages[conversationMessages.length - 1]?.content !== userPrompt) {
      conversationMessages.push({ role: 'user', content: userPrompt });
    }

    let currentTurn = 0;
    const maxTurns = 4;
    let finalSynthesizedText = '';
    let accumulatedToolOutputs = '';

    while (currentTurn < maxTurns) {
      currentTurn++;

      // Reasoning turn step
      const reasoningStepId = generateId('step');
      const reasoningStep: AgentStep = {
        id: reasoningStepId,
        description: currentTurn === 1
          ? 'Analyzing prompt & formulating autonomous action plan'
          : `Synthesizing tool observation (Turn ${currentTurn})`,
        durationMs: 0,
        status: 'in_progress',
      };
      steps.push(reasoningStep);
      onStep?.(reasoningStep);

      const inferenceStart = Date.now();
      let rawResponse = '';
      try {
        rawResponse = await callInference(conversationMessages);
      } catch (err: any) {
        reasoningStep.status = 'failed';
        reasoningStep.durationMs = Date.now() - inferenceStart;
        onStep?.(reasoningStep);
        logger.error('Inference call failed in autonomous loop', { turn: currentTurn, error: String(err) });
        break;
      }

      reasoningStep.durationMs = Date.now() - inferenceStart;
      reasoningStep.status = 'completed';
      onStep?.(reasoningStep);

      // Check for tool calls in the model response
      let toolCalls = this.parseToolCalls(rawResponse, currentTurn === 1);



      if (toolCalls.length === 0) {
        // No tool calls: model provided its final synthesis
        finalSynthesizedText = rawResponse;
        break;
      }

      // Execute each tool call inside the cloud sandbox microVM
      let turnOutputs = '';
      for (const tc of toolCalls) {
        const normalizedName = this.normalizeToolName(tc.name, tc.args);
        tc.name = normalizedName;
        const stepId = generateId('step');
        const desc = this.formatStepDescription(normalizedName, tc.args);
        const initialCmd =
          normalizedName === 'run_command'
            ? tc.args.command || tc.args.cmd || tc.args.script
            : normalizedName === 'read_file'
              ? `cat ${tc.args.path || tc.args.file || tc.args.filename}`
              : normalizedName === 'write_file'
                ? `write > ${tc.args.path || tc.args.file || tc.args.filename}`
                : normalizedName === 'list_dir'
                  ? `ls -la ${tc.args.path || tc.args.dir || tc.args.directory || '/workspace'}`
                  : undefined;

        const toolStep: AgentStep = {
          id: stepId,
          description: desc,
          durationMs: 0,
          status: 'in_progress',
          tool: normalizedName,
          command: initialCmd,
        };
        steps.push(toolStep);
        onStep?.(toolStep);

        logger.info('Executing autonomous sandbox tool', {
          tool: tc.name,
          args: tc.args,
          sessionId,
        });

        const toolResult = await this.executeTool(tc.name, tc.args, sessionId, userId);

        toolStep.durationMs = toolResult.durationMs;
        toolStep.status = toolResult.success ? 'completed' : 'failed';
        toolStep.output = toolResult.output;
        toolStep.exitCode = toolResult.exitCode;
        if (toolResult.command) toolStep.command = toolResult.command;
        onStep?.(toolStep);

        const observation = `Output from environment command:\n${toolResult.output}`;
        turnOutputs += observation + '\n\n';
        accumulatedToolOutputs += observation + '\n\n';
      }

      // Feed observations back to conversation history for next synthesis turn
      conversationMessages.push({
        role: 'assistant',
        content: rawResponse,
      });
      conversationMessages.push({
        role: 'user',
        content: `Live environment execution results from microVM:\n${turnOutputs}\nBased on these live results, provide a clear, helpful final response answering the user's prompt directly.`,
      });
    }

    // Clean up response formatting if it contains raw tool_call blocks or echoed tool observations
    let cleanedText = finalSynthesizedText
      .replace(/```(?:tool_call|tool|action|json:tool)[\s\S]*?```/gi, '')
      .replace(/\[(?:Tool Observation|Sandbox Observation)[^\]]*\]:?/gi, '')
      .trim();

    if (!cleanedText && accumulatedToolOutputs.trim()) {
      // Dynamic output directly from real microVM execution formatted cleanly if LLM synthesis was interrupted
      const rawLines = accumulatedToolOutputs
        .replace(/Output from environment command:\s*/gi, '')
        .trim();
      cleanedText = `The command executed inside the sandbox microVM (/workspace) with the following output:\n\n\`\`\`text\n${rawLines}\n\`\`\``;
    }

    // Extract any code blocks created
    const codeFiles: CodeArtifactFile[] = [];
    const codeBlockRegex = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
    let cbMatch: RegExpExecArray | null;
    while ((cbMatch = codeBlockRegex.exec(cleanedText)) !== null) {
      const lang = (cbMatch[1] || 'text').toLowerCase();
      const content = cbMatch[2].trim();
      const firstLine = content.split('\n')[0] || '';
      const fileMatch = firstLine.match(/^(?:\/\/|#|\/\*|<!--)\s*(?:filename:|file:)?\s*([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)/i);
      if (fileMatch) {
        codeFiles.push({
          filename: fileMatch[1].trim(),
          language: lang,
          content,
        });
      }
    }

    return {
      text: cleanedText,
      steps,
      codeFiles,
      durationMs: Date.now() - startTime,
    };
  }
}

export const autonomousExecutor = new AutonomousExecutorService();
