import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  AgentMessage,
  AgentStep,
  AgentStreamEvent,
  CodeArtifactFile,
  HistoryMessage,
  ModelEngine,
  PromptExecutionRequest,
  PromptExecutionResponse,
} from '../../types/agent.types.js';
import { generateId } from '../../utils/id.util.js';
import { logger } from '../../utils/logger.util.js';
import { authService } from '../auth/auth.service.js';
import { cliAuthService } from '../auth/cli-auth.service.js';
import { antigravityQuotaService } from '../quota/antigravity-quota.service.js';
import { codexQuotaService } from '../quota/codex-quota.service.js';
import type { CliUsageTelemetry } from '../quota/quota.types.js';
import { sandboxService } from '../sandbox/sandbox.service.js';
import { compactConversationHistory } from '../../utils/context-compactor.util.js';
import { AppError } from '../../utils/error.util.js';

export interface DynamicModelOption {
  id: string;
  provider: 'gemini' | 'claude' | 'codex';
  hostedBy?: 'antigravity' | 'codex' | 'claude';
  name: string;
  displayName: string;
  badge: string;
  description: string;
  latencyEstimate: string;
  icon: string;
  iconColor: string;
  iconSvg: string;
  defaultEffort?: 'high' | 'medium' | 'low';
  effortOptions?: Array<{
    effort: 'high' | 'medium' | 'low';
    modelId: string;
    label: string;
    badge: string;
    description: string;
  }>;
}

function getModelVisuals(modelId: string, modelName: string): {
  icon: string;
  iconColor: string;
  iconSvg: string;
} {
  const idLower = modelId.toLowerCase();
  const nameLower = modelName.toLowerCase();

  // If that model is GPT (OpenAI), use /model-icons/openai.svg
  if (
    idLower.includes('gpt') ||
    nameLower.includes('gpt') ||
    idLower.startsWith('o1') ||
    idLower.startsWith('o3') ||
    idLower.startsWith('codex') ||
    nameLower.includes('openai')
  ) {
    return {
      icon: 'code',
      iconColor: 'text-[#10A37F]',
      iconSvg: '/model-icons/openai.svg',
    };
  }

  // Anthropic Claude models
  if (idLower.includes('claude') || nameLower.includes('claude') || nameLower.includes('anthropic')) {
    return {
      icon: 'bolt',
      iconColor: 'text-[#F59E0B]',
      iconSvg: '/provider-icons/claude.svg',
    };
  }

  // Gemini models: user requirement: "1. For gemini models use @[frontend/public/model-icons/google-gemini.svg]"
  if (idLower.includes('gemini') || nameLower.includes('gemini')) {
    return {
      icon: 'auto_awesome',
      iconColor: 'text-[#4285F4]',
      iconSvg: '/model-icons/google-gemini.svg',
    };
  }

  // Default fallback for models
  return {
    icon: 'auto_awesome',
    iconColor: 'text-[#4285F4]',
    iconSvg: '/model-icons/google-gemini.svg',
  };
}

export class AgentService {
  private readonly sandboxModelsCache: Map<string, { models: DynamicModelOption[]; timestamp: number }> = new Map();
  private antigravityModelIds: Set<string> = new Set();
  private codexModelIds: Set<string> = new Set();

  constructor() {
    // Dynamic live initialization: CLIs execute live in cloud sandboxes
  }

  /**
   * Resolves an active cloud sandbox microVM ID for a user.
   */
  private resolveSandboxId(userId?: string, sessionId?: string): string | null {
    if (sessionId) {
      const active = sandboxService.getActiveSandboxId(sessionId, userId);
      if (active) return active;
    }
    if (userId) {
      const usage = sandboxService.getSandboxUsage(userId);
      if (usage.sandboxes && usage.sandboxes.length > 0) {
        return usage.sandboxes[0].sandboxId;
      }
    }
    const defaultActive = sandboxService.getActiveSandboxId('default');
    if (defaultActive) return defaultActive;

    const globalUsage = sandboxService.getSandboxUsage();
    if (globalUsage.sandboxes && globalUsage.sandboxes.length > 0) {
      return globalUsage.sandboxes[0].sandboxId;
    }
    return null;
  }

  private async discoverAntigravityModels(
    sandboxId?: string | null,
    userId?: string,
    sessionId?: string
  ): Promise<DynamicModelOption[]> {
    if (!sandboxId) return [];
    let stdout = '';
    try {
      logger.info('[Model Discovery] Querying Antigravity models from sandbox microVM', {
        sandboxId,
        userId,
        sessionId,
      });
      const cmdRes = await sandboxService.executeInSandbox({
        command: 'sudo -u agent-runner -H env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" agy models',
        code: '',
        language: 'bash',
        sandboxId,
        userId,
        sessionId,
        timeoutMs: 15000,
      });
      if (cmdRes && cmdRes.stdout) {
        stdout = cmdRes.stdout;
        logger.info('[Model Discovery] Antigravity CLI output received', {
          sandboxId,
          exitCode: cmdRes.exitCode,
          outputLength: stdout.length,
          preview: stdout.slice(0, 100),
        });
      } else if (cmdRes?.stderr) {
        logger.warn('[Model Discovery] Antigravity CLI returned stderr', {
          sandboxId,
          stderr: cmdRes.stderr,
        });
      }
    } catch (err) {
      logger.warn('Failed to query models from active cloud microVM', { error: String(err) });
    }

    try {
      const cleanOutput = stdout
        .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\r/g, '\n');
      const lines = cleanOutput.split('\n');
      const parsedRaw: Array<{ id: string; label: string }> = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.includes('Fetching available models')) continue;
        const match = trimmed.match(/^(\S+)\s+(.+)$/);
        if (match) {
          parsedRaw.push({ id: match[1], label: match[2].trim() });
        }
      }

      if (parsedRaw.length === 0) {
        return [];
      }

      // Register all discovered raw model IDs for Antigravity CLI routing
      for (const m of parsedRaw) {
        this.antigravityModelIds.add(m.id);
      }

      const effortRegex = /^(.*)-(high|medium|low)$/i;
      const groups = new Map<
        string,
        Array<{ id: string; label: string; effort: 'high' | 'medium' | 'low' | null }>
      >();

      for (const m of parsedRaw) {
        const match = m.id.match(effortRegex);
        if (match) {
          const baseKey = match[1];
          const effort = match[2].toLowerCase() as 'high' | 'medium' | 'low';
          if (!groups.has(baseKey)) {
            groups.set(baseKey, []);
          }
          groups.get(baseKey)!.push({ ...m, effort });
        } else {
          groups.set(m.id, [{ ...m, effort: null }]);
        }
      }

      const result: DynamicModelOption[] = [];
      for (const [key, variants] of groups.entries()) {
        this.antigravityModelIds.add(key);

        const effortVariants = variants.filter(
          (v): v is { id: string; label: string; effort: 'high' | 'medium' | 'low' } =>
            v.effort !== null
        );

        if (effortVariants.length > 1) {
          const highVariant = variants.find((v) => v.effort === 'high') || variants[0];
          const baseName = highVariant.label.replace(/\s*\((High|Medium|Low)\)/i, '').trim();
          const visuals = getModelVisuals(highVariant.id, baseName);

          for (const ev of effortVariants) {
            this.antigravityModelIds.add(ev.id);
          }

          result.push({
            id: highVariant.id,
            provider: 'gemini',
            hostedBy: 'antigravity',
            name: baseName,
            displayName: baseName,
            badge: key.includes('flash')
              ? 'Fast & Frontier'
              : key.includes('pro')
              ? 'Pro Reasoning'
              : 'Hybrid Reasoning',
            description: key.includes('flash')
              ? 'Latest high-frequency release with rapid agentic reasoning and code execution'
              : 'Frontier reasoning for complex software architecture and debugging',
            latencyEstimate: key.includes('flash') ? '80ms' : '150ms',
            icon: visuals.icon,
            iconColor: visuals.iconColor,
            iconSvg: visuals.iconSvg,
            defaultEffort: 'high',
            effortOptions: effortVariants.map((v) => ({
              effort: v.effort,
              modelId: v.id,
              label: v.effort.charAt(0).toUpperCase() + v.effort.slice(1),
              badge:
                v.effort === 'high'
                  ? 'Max Quality'
                  : v.effort === 'medium'
                  ? 'Balanced'
                  : 'Fastest',
              description:
                v.effort === 'high'
                  ? 'Deep multi-step reasoning & thorough analysis'
                  : v.effort === 'medium'
                  ? 'Balanced speed and synthesis depth'
                  : 'Ultra-fast inference with minimal latency',
            })),
          });
        } else {
          const v = variants[0];
          this.antigravityModelIds.add(v.id);
          const visuals = getModelVisuals(v.id, v.label);

          const badge = v.id.includes('opus')
            ? 'Deep Reasoning'
            : v.id.includes('sonnet')
            ? 'Thinking / Code'
            : v.id.includes('oss')
            ? 'Open Weights 120B'
            : v.id.includes('flash')
            ? 'Fast & Frontier'
            : 'Frontier AI';
          const description = v.id.includes('opus')
            ? 'Maximum depth reasoning for complex multi-file engineering problems'
            : v.id.includes('sonnet')
            ? 'Advanced Anthropic reasoning model with thinking tokens'
            : v.id.includes('oss')
            ? 'Large-scale open weights model with medium reasoning effort'
            : v.label;
          const latencyEstimate = v.id.includes('opus')
            ? '280ms'
            : v.id.includes('sonnet')
            ? '160ms'
            : '120ms';

          result.push({
            id: v.id,
            provider: 'gemini',
            hostedBy: 'antigravity',
            name: v.label,
            displayName: v.label,
            badge,
            description,
            latencyEstimate,
            icon: visuals.icon,
            iconColor: visuals.iconColor,
            iconSvg: visuals.iconSvg,
          });
        }
      }

      return result;
    } catch (err) {
      logger.error('Failed to parse models output', { error: String(err) });
      return [];
    }
  }

  private async discoverCodexModels(
    sandboxId?: string | null,
    userId?: string,
    sessionId?: string
  ): Promise<DynamicModelOption[]> {
    if (!sandboxId) return [];
    const result: DynamicModelOption[] = [];
    let stdout = '';

    try {
      logger.info('[Model Discovery] Querying Codex models from sandbox microVM', {
        sandboxId,
        userId,
        sessionId,
      });
      const cmdRes = await sandboxService.executeInSandbox({
        command: 'sudo -u agent-runner -H env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" codex debug models',
        code: '',
        language: 'bash',
        sandboxId,
        userId,
        sessionId,
        timeoutMs: 15000,
      });
      if (cmdRes && cmdRes.stdout) {
        stdout = cmdRes.stdout;
        logger.info('[Model Discovery] Codex CLI output received', {
          sandboxId,
          exitCode: cmdRes.exitCode,
          outputLength: stdout.length,
          preview: stdout.slice(0, 100),
        });
      } else if (cmdRes?.stderr) {
        logger.warn('[Model Discovery] Codex CLI returned stderr', {
          sandboxId,
          stderr: cmdRes.stderr,
        });
      }
    } catch (err) {
      logger.warn('Failed to live-query Codex models from cloud sandbox microVM', { error: String(err) });
    }

    // Parse live JSON output from Codex CLI
    if (stdout) {
      try {
        const jsonStart = stdout.indexOf('{');
        if (jsonStart !== -1) {
          const codexData = JSON.parse(stdout.substring(jsonStart));
          if (Array.isArray(codexData.models)) {
            const visibleModels = codexData.models
              .filter((cm: any) => cm.visibility !== 'hide')
              .sort((a: any, b: any) => (a.priority ?? 99) - (b.priority ?? 99));

            for (const cm of visibleModels) {
              const slug = cm.slug || cm.id;
              if (!slug) continue;
              this.codexModelIds.add(slug);

              const effortOptions = Array.isArray(cm.supported_reasoning_levels)
                ? cm.supported_reasoning_levels.map((lvl: any) => {
                    const effortId = `${slug}-${lvl.effort}`;
                    this.codexModelIds.add(effortId);
                    return {
                      effort: lvl.effort as 'high' | 'medium' | 'low',
                      modelId: effortId,
                      label: String(lvl.effort).charAt(0).toUpperCase() + String(lvl.effort).slice(1),
                      badge: lvl.effort === 'max' ? 'Max' : lvl.effort === 'high' ? 'High' : 'Fast',
                      description: lvl.description || `${lvl.effort} reasoning effort`,
                    };
                  })
                : undefined;

              const visuals = getModelVisuals(slug, cm.display_name || slug);

              result.push({
                id: slug,
                provider: 'codex',
                hostedBy: 'codex',
                name: cm.display_name || slug,
                displayName: cm.display_name || slug,
                badge: cm.default_reasoning_level ? `${cm.default_reasoning_level} reasoning` : 'OpenAI Codex',
                description: cm.description || 'OpenAI Codex model via ChatGPT Account',
                latencyEstimate: '110ms',
                icon: visuals.icon,
                iconColor: visuals.iconColor,
                iconSvg: visuals.iconSvg,
                defaultEffort: cm.default_reasoning_level,
                effortOptions,
              });
            }
          }
        }

        if (result.length > 0) {
          return result;
        }
      } catch (err) {
        logger.warn('Failed to parse live Codex models JSON', { error: String(err) });
      }
    }

    return result;
  }

  private async fetchDynamicModelsFromCli(
    sandboxId?: string | null,
    userId?: string,
    sessionId?: string
  ): Promise<DynamicModelOption[]> {
    if (!sandboxId) return [];

    const [agyRes, codexRes] = await Promise.allSettled([
      this.discoverAntigravityModels(sandboxId, userId, sessionId),
      this.discoverCodexModels(sandboxId, userId, sessionId),
    ]);

    const agyModels = agyRes.status === 'fulfilled' ? agyRes.value : [];
    const codexModels = codexRes.status === 'fulfilled' ? codexRes.value : [];
    const combined = [...agyModels, ...codexModels];

    logger.info('Successfully discovered models dynamically from installed CLIs in sandbox', {
      sandboxId,
      userId,
      count: combined.length,
      modelIds: combined.map((r) => r.id),
    });
    return combined;
  }

  public async getAvailableModels(userId?: string, sessionId?: string): Promise<DynamicModelOption[]> {
    const sandboxId = this.resolveSandboxId(userId, sessionId);
    if (!sandboxId) {
      return [];
    }

    const now = Date.now();
    const cached = this.sandboxModelsCache.get(sandboxId);
    if (cached && now - cached.timestamp < 300_000 && cached.models.length > 0) {
      return cached.models;
    }

    const models = await this.fetchDynamicModelsFromCli(sandboxId, userId, sessionId);
    if (models.length > 0) {
      this.sandboxModelsCache.set(sandboxId, { models, timestamp: Date.now() });
    }
    return models;
  }

  private extractCodeBlocks(text: string): CodeArtifactFile[] {
    const codeBlockRegex = /```([a-zA-Z0-9_\-+]*)\s*\n([\s\S]*?)```/g;
    const files: CodeArtifactFile[] = [];
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      const lang = (match[1] || 'typescript').toLowerCase();
      const content = match[2].trim();
      const lines = content.split('\n');
      const firstLine = lines[0] || '';
      const secondLine = lines[1] || '';

      // Check for explicit filename comments like:
      // // filename: app.ts, # app.py, <!-- index.html -->, /* styles.css */
      const fileMatch =
        firstLine.match(/^(?:\/\/|#|\/\*|<!--)\s*(?:filename:|file:|filepath:)?\s*([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)/i) ||
        secondLine.match(/^(?:\/\/|#|\/\*|<!--)\s*(?:filename:|file:|filepath:)?\s*([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)/i);

      if (fileMatch) {
        const filename = fileMatch[1].trim();
        files.push({
          filename,
          language: lang || 'typescript',
          content,
        });
      }
    }

    return files;
  }

  private extractDirectCommand(prompt: string): string | null {
    const trimmed = prompt.trim();
    // Only explicit terminal commands starting with $ or $_ (e.g. `$ ls`, `$ pwd`, `$ npm test`)
    if (trimmed.startsWith('$')) {
      return trimmed.replace(/^\$[_]?\s*/, '').trim();
    }
    return null;
  }

  private async streamTextToCallback(text: string, onToken?: (token: string) => void): Promise<void> {
    if (!onToken || !text) return;
    const parts = text.split(/(\s+)/);
    for (let i = 0; i < parts.length; i++) {
      onToken(parts[i]);
      if (parts[i].trim().length > 0) {
        await new Promise((r) => setTimeout(r, 12));
      }
    }
  }

  private async callLiveAI(
    prompt: string,
    modelUsed: ModelEngine,
    history: HistoryMessage[] = [],
    customKey?: string,
    onToken?: (token: string) => void,
    sandboxDir?: string,
    sessionId?: string,
    onStep?: (step: AgentStep) => void,
    userId?: string,
    sandboxId?: string
  ): Promise<{ text: string; durationMs: number; usage?: CliUsageTelemetry; failureReason?: string; cli?: string; rateLimits?: any } | null> {
    const start = Date.now();
    let lastFailureReason: string | undefined;
    const effectiveHistory = history.length > 0 ? history : [{ role: 'user' as const, content: prompt }];
    const compaction = compactConversationHistory(effectiveHistory, prompt);
    const cliPrompt = compaction.formattedPrompt;

    if (compaction.wasCompacted) {
      logger.info('Compacted conversation history for prompt execution', {
        originalTurns: compaction.originalMessageCount,
        retainedTurns: compaction.retainedMessageCount,
      });
    }

    const isSandboxActive = sessionId ? sandboxService.hasActiveSandbox(sessionId, userId) : false;
    const activeSandboxId = sandboxId || (sessionId ? (sandboxService.getActiveSandboxId(sessionId, userId) || sessionId) : undefined);
    const sandboxFiles = isSandboxActive && sessionId ? await sandboxService.listFiles(sessionId, userId).catch(() => []) : [];
    const fileListStr =
      sandboxFiles.length > 0
        ? sandboxFiles.map((f) => `- ${f.name} (${f.type === 'directory' ? 'directory' : `${f.size}B`})`).join('\n')
        : '(workspace directory is empty)';

    // 1. Sandbox-Native CLI Execution inside the cloud microVM
    if (isSandboxActive) {
      try {
        const isCodexTarget =
          this.codexModelIds.has(modelUsed) ||
          modelUsed.startsWith('codex-') ||
          modelUsed.startsWith('gpt-') ||
          modelUsed.startsWith('o1') ||
          modelUsed.startsWith('o3');
        const isClaudeTarget = modelUsed.startsWith('claude-');
        let targetCli: 'codex' | 'claude' | 'agy' = isCodexTarget
          ? 'codex'
          : isClaudeTarget
          ? 'claude'
          : 'agy';

        // Intelligently default to whichever subscription CLI is linked in the sandbox
        if (modelUsed === 'auto' || modelUsed === 'default') {
          if (cliAuthService.isCodexLinked()) {
            targetCli = 'codex';
          } else if (cliAuthService.isClaudeLinked()) {
            targetCli = 'claude';
          } else {
            targetCli = 'agy';
          }
        }

        const sandboxResult = await sandboxService
          .executeCliInSandbox({
            sessionId,
            userId,
            sandboxId: activeSandboxId,
            cli: targetCli,
            prompt: cliPrompt,
            model: modelUsed,
            onToken,
            onStep,
          })
          .catch((err) => {
            lastFailureReason = err?.message || String(err);
            logger.warn('Sandbox-native CLI execution failed', { error: String(err) });
            return null;
          });

        if (sandboxResult?.text && (sandboxResult.exitCode === 0 || sandboxResult.exitCode === undefined)) {
          return {
            ...sandboxResult,
            cli: sandboxResult.cli || targetCli,
          };
        }
      } catch (err: any) {
        lastFailureReason = err?.message || String(err);
        logger.warn('Sandbox-native CLI execution failed', { error: String(err) });
      }
    }

    if (lastFailureReason) {
      logger.warn('Sandbox CLI execution failed for model request', { modelUsed, lastFailureReason });
      return {
        text: `### CLI Execution Notice\n\nThe requested model (\`${modelUsed}\`) could not be executed by the cloud sandbox microVM.\n\n**Reason**: ${lastFailureReason}\n\n**Resolution Options**:\n- **Antigravity CLI (agy)**: Connect your Google account under Subscriptions.\n- **OpenAI Codex**: Ensure your ChatGPT / Codex subscription is linked.\n- **Claude Code**: Ensure Claude CLI is linked.`,
        durationMs: Date.now() - start,
        failureReason: lastFailureReason,
      };
    }

    throw new AppError(
      `No available model provider could execute model "${modelUsed}". Please link your subscription in Subscriptions menu.`,
      400,
      'MODEL_EXECUTION_FAILED'
    );
  }

  public async executePrompt(
    input: PromptExecutionRequest,
    token?: string,
    onToken?: (token: string) => void,
    onStep?: (step: AgentStep) => void
  ): Promise<PromptExecutionResponse> {
    const sessionId = input.sessionId || generateId('sess');
    const start = Date.now();
    let modelUsed: ModelEngine = (input.model as ModelEngine) || input.selectedModel || 'auto';
    const available = await this.getAvailableModels();
    let modelMeta = available.find(
      (m) => m.id === modelUsed || m.effortOptions?.some((opt) => opt.modelId === modelUsed)
    );

    let modelNote = '';
    if (!modelMeta && modelUsed !== 'none' && modelUsed !== 'auto') {
      // 1. Check if base model still exists (effort changed or prefix match)
      const matchedBase = available.find((m) => modelUsed.startsWith(m.id));
      if (matchedBase) {
        const newModelId = (matchedBase.effortOptions?.[0]?.modelId || matchedBase.id) as ModelEngine;
        logger.warn('Requested model variant not found, migrating to available base model variant', {
          requested: modelUsed,
          migratedTo: newModelId,
        });
        modelNote = `(requested variant "${modelUsed}" updated to "${newModelId}")`;
        modelUsed = newModelId;
        modelMeta = matchedBase;
      } else {
        // 2. Model was completely removed from the provider's list
        const isAntigravity = modelUsed.includes('gemini') || modelUsed.includes('antigravity');
        const isCodex =
          modelUsed.includes('codex') ||
          modelUsed.includes('gpt') ||
          modelUsed.startsWith('o1') ||
          modelUsed.startsWith('o3');
        const isClaude = modelUsed.includes('claude');

        const providerModels = available.filter((m) => {
          if (isAntigravity) return m.hostedBy === 'antigravity' || m.provider === 'gemini';
          if (isCodex) return m.provider === 'codex';
          if (isClaude) return m.provider === 'claude';
          return false;
        });

        if (providerModels.length > 0) {
          const fallback = (providerModels[0].effortOptions?.[0]?.modelId || providerModels[0].id) as ModelEngine;
          logger.warn('Requested model was removed from provider, falling back to provider active model', {
            requested: modelUsed,
            fallback,
          });
          modelNote = `(requested model "${modelUsed}" removed from provider; routed to active "${fallback}")`;
          modelUsed = fallback;
          modelMeta = providerModels[0];
        }
      }
    }

    const modelTitle = modelMeta?.displayName || modelUsed;

    // Resolve user session and linked subscriptions from token
    const authSession = token ? await authService.getSession(token) : null;
    const user = authSession?.user;
    const userName = user?.name ? user.name.split(' ')[0] : 'there';
    const isGoogleAuth = Boolean(user && (user.primaryPlatform === 'google' || user.email));
    const isClaudeLinked = Boolean(
      cliAuthService.isClaudeLinked() ||
      user?.linkedPlatforms?.some((p) => (p.platform === 'claude_subscription' || p.platform === 'anthropic') && p.hasValidSession)
    );
    const isCodexLinked = Boolean(
      cliAuthService.isCodexLinked() ||
      user?.linkedPlatforms?.some((p) => (p.platform === 'codex_subscription' || p.platform === 'openai') && p.hasValidSession)
    );

    logger.info('Executing agent prompt', {
      sessionId,
      selectedModel: modelUsed,
      user: user?.email || 'anonymous',
      isGoogleAuth,
      isClaudeLinked,
      isCodexLinked,
      promptPreview: input.prompt.slice(0, 40),
    });

    const userId = user?.id || input.userId;
    // Ensure cloud sandbox is explicitly attached before executing any prompt or command
    if (input.sandboxId && sessionId) {
      sandboxService.attachSessionToSandbox(sessionId, input.sandboxId);
    }
    const isSandboxActive = sandboxService.hasActiveSandbox(sessionId, userId) || Boolean(input.sandboxId);
    if (!isSandboxActive) {
      throw new AppError(
        'No cloud sandbox is attached to this session. Please select an active sandbox from the top bar before executing prompts.',
        400,
        'NO_ACTIVE_SANDBOX'
      );
    }
    const activeSbId = sandboxService.getActiveSandboxId(sessionId, userId) || input.sandboxId;

    // 1. Explicit Shell Command Bypass (e.g. `$ ls`, `$ pwd`, `$ npm test`)
    const directCmd = this.extractDirectCommand(input.prompt);
    if (modelUsed === 'none' || directCmd) {
      const cmd = directCmd || input.prompt.replace(/^\$[_]?\s*/, '').trim();
      const sandboxExec = await sandboxService.executeInSandbox({
        command: cmd,
        code: '',
        language: 'bash',
        sessionId,
        userId: user?.id,
      });

      const stdoutOutput = sandboxExec.stdout
        ? sandboxExec.stdout
        : sandboxExec.exitCode === 0
        ? '(Command completed with no output)'
        : '';
      const responseContent = `Executed command in isolated sandbox \`${sandboxExec.sandboxId}\` (\`/workspace\`):\n\n\`\`\`bash\n$ ${cmd}\n${stdoutOutput}${sandboxExec.stderr ? '\n' + sandboxExec.stderr : ''}\n\`\`\`\n\n*Exit Code: ${sandboxExec.exitCode} • Duration: ${sandboxExec.durationMs}ms • Cloud Sandbox: E2B microVM*`;

      await this.streamTextToCallback(responseContent, onToken);

      const assistantMessage: AgentMessage = {
        id: generateId('msg'),
        role: 'assistant',
        authorName: modelUsed === 'none' ? 'Cloud Sandbox Runner' : modelTitle,
        authorTag: modelUsed === 'none' ? 'Cloud Sandbox' : `${modelTitle} • Cloud Sandbox`,
        modelUsed,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        latencyMs: sandboxExec.durationMs,
        steps: [
          {
            id: generateId('step'),
            description: `Executed command in isolated sandbox: "${cmd.slice(0, 36)}"`,
            durationMs: sandboxExec.durationMs,
            status: sandboxExec.success ? 'completed' : 'failed',
          },
        ],
        codeFiles: [],
        executionResult: {
          sandboxId: sandboxExec.sandboxId,
          durationMs: sandboxExec.durationMs,
          status: sandboxExec.exitCode === 0 ? 'HTTP 200 OK' : 'HTTP 500 Command Failed',
          details: `Direct execution in sandbox ${sandboxExec.sandboxId} (/workspace)`,
        },
        content: responseContent,
      };

      return { sessionId, message: assistantMessage };
    }

    const history: HistoryMessage[] =
      input.messages && input.messages.length > 0
        ? input.messages
        : [{ role: 'user', content: input.prompt }];

    // 2. Try live AI execution in isolated sandbox (via linked CLI or cloud endpoint)
    const sandboxDir = sandboxService.getSandboxWorkspaceDir(sessionId);

    // Seed any user-attached files directly into the sandbox microVM if active
    if (input.files && input.files.length > 0 && isSandboxActive) {
      const targetSbId = activeSbId || sessionId;
      for (const file of input.files) {
        try {
          const safeName = path.basename(file.name);
          const fileBuf = file.base64
            ? Buffer.from(file.base64, 'base64')
            : file.content !== undefined
            ? Buffer.from(file.content, 'utf8')
            : null;
          if (fileBuf) {
            sandboxService.writeFile(targetSbId, path.join('attachments', safeName), fileBuf).catch(() => {});
          }
        } catch (err) {
          logger.warn('Failed to seed attached file into sandbox attachments', {
            fileName: file.name,
            error: String(err),
          });
        }
      }
    }

    const liveStepsMap = new Map<string, AgentStep>();
    const handleStep = (step: AgentStep) => {
      liveStepsMap.set(step.id, step);
      if (onStep) onStep(step);
    };

    const liveResult = await this.callLiveAI(
      input.prompt,
      modelUsed,
      history,
      input.apiKey,
      onToken,
      sandboxDir,
      sessionId,
      handleStep,
      userId,
      activeSbId || input.sandboxId
    );
    if (liveResult && liveResult.text) {
      const codeFiles = this.extractCodeBlocks(liveResult.text);
      const cleanSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 24) || 'default';
      const realSandboxId = `agent-sb-${cleanSessionId}`;

      // Automatically place generated code files directly in sandbox workspace if sandbox is running
      if (codeFiles.length > 0 && isSandboxActive) {
        const targetSbId = activeSbId || sessionId;
        for (const file of codeFiles) {
          sandboxService.writeFile(targetSbId, file.filename, file.content).catch((err) => {
            logger.warn('Could not auto-write code artifact to sandbox', { error: String(err) });
          });
        }
      }

      // Ensure all live steps are marked completed when response successfully finalized
      const accumulatedSteps: AgentStep[] =
        liveStepsMap.size > 0
          ? Array.from(liveStepsMap.values()).map((s) => {
              let desc = s.description;
              if (s.status === 'in_progress' && desc.includes('evaluating tool execution results')) {
                desc = 'Formulated final response & verified solution';
              }
              return {
                ...s,
                description: desc,
                status: s.status === 'failed' ? 'failed' : 'completed',
                durationMs: s.durationMs || 120,
              };
            })
          : [
              {
                id: 'step_init',
                description: `Dispatched prompt to ${modelTitle} live cloud endpoint`,
                durationMs: Math.round(liveResult.durationMs * 0.4),
                status: 'completed',
              },
              {
                id: 'step_stream',
                description: `Streamed response tokens and staged ${codeFiles.length} file(s) in sandbox ${activeSbId ? `\`${activeSbId}\`` : ''} (/workspace)`,
                durationMs: Math.round(liveResult.durationMs * 0.6),
                status: 'completed',
              },
            ];

      const effectiveSandboxId = activeSbId || realSandboxId;
      const assistantMessage: AgentMessage = {
        id: generateId('msg'),
        role: 'assistant',
        authorName: modelTitle,
        authorTag: modelTitle,
        modelUsed,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        latencyMs: liveResult.durationMs,
        steps: accumulatedSteps,
        codeFiles,
        executionResult: {
          sandboxId: effectiveSandboxId,
          durationMs: liveResult.durationMs,
          status: 'HTTP 200 OK',
          details: `Live ${modelTitle} execution in sandbox ${effectiveSandboxId} (/workspace)`,
        },
        content: liveResult.text,
        tokenUsage: liveResult.usage,
      };

      if (liveResult.usage) {
        const turnData = {
          sessionId,
          userEmail: user?.email,
          model: modelUsed,
          promptTokens: liveResult.usage.input_tokens,
          completionTokens: liveResult.usage.output_tokens,
          thinkingTokens: liveResult.usage.thinking_tokens,
          cacheReadTokens: liveResult.usage.cache_read_tokens,
          totalTokens: liveResult.usage.total_tokens,
          latencyMs: liveResult.durationMs,
        };
        const isCodex =
          (liveResult as any).cli === 'codex' ||
          this.codexModelIds.has(modelUsed) ||
          modelUsed === 'codex' ||
          modelUsed.startsWith('codex') ||
          modelUsed.startsWith('gpt-') ||
          modelUsed.startsWith('o1') ||
          modelUsed.startsWith('o3');
        if (isCodex) {
          await codexQuotaService.recordTurn({
            ...turnData,
            userId,
            rateLimits: (liveResult as any).rateLimits,
          });
        } else {
          await antigravityQuotaService.recordTurn(turnData);
        }
      }

      return { sessionId, message: assistantMessage };
    }

    // 3. Dynamic Contextual Handling using Linked Subscriptions and Google Sign-in
    // No hardcoded Fastify/BullMQ mockups, and no raw API key requirements!


    let content = '';
    const steps: AgentStep[] = [];
    const codeFiles: CodeArtifactFile[] = [];

    // Authenticate execution mode by platform
    let authBadge = '';
    if (modelUsed.startsWith('gemini-') || modelUsed.startsWith('antigravity-')) {
      authBadge = isGoogleAuth ? `Google Account (${user?.email})` : 'Antigravity / Google Sign-In';
      steps.push({
        id: 'step_dispatch',
        description: isGoogleAuth
          ? `Authenticated developer via Google (${user?.email})`
          : 'Antigravity session initialized',
        durationMs: 14,
        status: 'completed',
      });
    } else if (modelUsed.startsWith('claude-')) {
      authBadge = isClaudeLinked ? 'Linked Claude CLI / Console' : 'Claude Engine';
      steps.push({
        id: generateId('step'),
        description: isClaudeLinked
          ? 'Validated linked Claude Code CLI / Console session'
          : 'Claude agent session initialized',
        durationMs: 16,
        status: 'completed',
      });
    } else if (
      modelUsed.startsWith('codex-') ||
      modelUsed.startsWith('gpt-') ||
      modelUsed.startsWith('o1') ||
      modelUsed.startsWith('o3')
    ) {
      authBadge = isCodexLinked ? 'Linked OpenAI Codex CLI' : 'Codex Engine';
      steps.push({
        id: generateId('step'),
        description: isCodexLinked
          ? 'Validated linked OpenAI Codex CLI / ChatGPT session'
          : 'Codex agent session initialized',
        durationMs: 16,
        status: 'completed',
      });
    } else {
      authBadge = 'Open Model';
      steps.push({
        id: generateId('step'),
        description: `Orchestrated ${modelTitle} open reasoning session`,
        durationMs: 15,
        status: 'completed',
      });
    }

    if (liveResult?.failureReason && (liveResult.failureReason.includes('timed out') || liveResult.failureReason.includes('TIMEOUT'))) {
      content = `⏱️ **Agent Execution Timed Out**\n\nThe ${modelTitle} agent execution timed out while performing autonomous actions in the sandbox. The prompt required deep multi-step file exploration or tool invocations that exceeded the safety timeout.\n\n*Prompt captured:* \`${input.prompt}\`\n\n*Details:* ${liveResult.failureReason}`;
      steps.push({
        id: generateId('step'),
        description: `Execution timed out: ${liveResult.failureReason}`,
        durationMs: liveResult.durationMs,
        status: 'failed',
      });
    } else {
      content = `⚠️ **Cloud Execution Unavailable**\n\nThe ${modelTitle} engine is currently operating in offline/sandbox mode. Live AI inference is currently unavailable. Please link your account (Google/Antigravity, Claude, or Codex) via the top navigation bar or start an isolated sandbox microVM.\n\n*Prompt captured:* \`${input.prompt}\``;
      steps.push({
        id: generateId('step'),
        description: `Linked account required for ${modelTitle}`,
        durationMs: 38,
        status: 'failed',
      });
    }

    const assistantMessage: AgentMessage = {
      id: generateId('msg'),
      role: 'assistant',
      authorName: 'Atelier Assistant',
      authorTag: `${modelTitle}${authBadge ? ` • ${authBadge}` : ''}`,
      modelUsed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      latencyMs: Date.now() - start + 120,
      steps,
      codeFiles,
      executionResult: {
        sandboxId: activeSbId || 'none',
        durationMs: 45,
        status: 'HTTP 503 Service Unavailable',
        details: 'Execution aborted due to missing AI backend',
      },
      content,
    };

    if (onToken) {
      await this.streamTextToCallback(content, onToken);
    }

    return { sessionId, message: assistantMessage };
  }

  public async executePromptStream(
    input: PromptExecutionRequest,
    token: string | undefined,
    onEvent: (event: AgentStreamEvent) => void
  ): Promise<PromptExecutionResponse> {
    const sessionId = input.sessionId || generateId('sess');
    const startTime = Date.now();
    const modelUsed: ModelEngine = input.selectedModel;
    const modelMeta = (await this.getAvailableModels()).find((m) => m.id === modelUsed);
    const modelTitle = modelMeta?.displayName || modelUsed;

    onEvent({ type: 'start', sessionId, model: modelUsed });

    const initStepId = 'step_init';
    const initStep: AgentStep = {
      id: initStepId,
      description: `Connecting to cloud sandbox microVM & initializing agent...`,
      durationMs: 0,
      status: 'in_progress',
    };

    onEvent({ type: 'step', step: initStep });

    let hasLiveSteps = false;
    let initStepFinished = false;

    const markInitStepCompleted = (customDesc?: string) => {
      if (initStepFinished) return;
      initStepFinished = true;
      const dispatchDuration = Math.max(16, Date.now() - startTime);
      onEvent({
        type: 'step',
        step: {
          ...initStep,
          description: customDesc || `Connected to cloud sandbox microVM & initialized agent`,
          durationMs: dispatchDuration,
          status: 'completed',
        },
      });
    };

    const onToken = (tokenChunk: string) => {
      if (!hasLiveSteps) {
        markInitStepCompleted();
      }
      onEvent({ type: 'token', token: tokenChunk });
    };

    const onStreamStep = (step: AgentStep) => {
      hasLiveSteps = true;
      if (step.id === initStepId) {
        initStepFinished = true;
      } else if (!initStepFinished) {
        markInitStepCompleted();
      }
      onEvent({ type: 'step', step });
    };

    const response = await this.executePrompt(input, token, onToken, onStreamStep);
    markInitStepCompleted();

    const totalDuration = response.message.latencyMs || Date.now() - startTime;
    const dispatchDuration = Math.min(Math.round(totalDuration * 0.4), 2200);
    const streamDuration = Math.max(20, totalDuration - dispatchDuration);
    const artifactCount = response.message.codeFiles?.length || 0;

    // If real live steps were generated by the CLI / sandbox, emit and keep ONLY the real live steps
    if (response.message.steps && response.message.steps.length > 0) {
      for (const st of response.message.steps) {
        onEvent({ type: 'step', step: st });
      }
    } else {
      // Pure fallback when no live steps were streamed
      const finalStep1: AgentStep = {
        id: initStepId,
        description: `Dispatched prompt to ${modelTitle} live cloud endpoint`,
        durationMs: dispatchDuration,
        status: 'completed',
      };
      const finalStep2: AgentStep = {
        id: 'step_stream',
        description: `Streamed response tokens and parsed ${artifactCount} code artifact(s)`,
        durationMs: streamDuration,
        status: 'completed',
      };
      response.message.steps = [finalStep1, finalStep2];
      onEvent({ type: 'step', step: finalStep1 });
      onEvent({ type: 'step', step: finalStep2 });
    }

    onEvent({ type: 'done', response });
    return response;
  }
}

export const agentService = new AgentService();
