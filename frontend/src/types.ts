export type ModelProvider = 'claude' | 'codex' | 'gemini';

export type ModelId = string;

export type ModelType = ModelId;

export type ReasoningEffort = 'high' | 'medium' | 'low';

export interface ModelEffortOption {
  effort: ReasoningEffort;
  modelId: ModelId;
  label: string;
  badge: string;
  description: string;
}

export interface ModelLimits {
  contextWindow?: number;
  contextWindowLabel?: string;
  maxOutputTokens?: number;
  maxOutputLabel?: string;
  rpmLimit?: number;
  tpmLimit?: number;
  tier?: string;
}

export interface QuotaBucket {
  id: string;
  name: string;
  description: string;
  window: string;
  remaining_fraction: number;
  reset_time: string;
}

export interface QuotaGroup {
  name: string;
  description: string;
  buckets: QuotaBucket[];
}

export interface CliQuotaLimits {
  description?: string;
  groups: QuotaGroup[];
  fetchedAt: string;
}

export type AntigravityQuotaStats = {
  linked: boolean;
  userEmail?: string;
  userName?: string;
  totalTurns: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  lastLatencyMs: number;
  avgLatencyMs: number;
  quotaLimits?: CliQuotaLimits | null;
  lastUpdated: string;
};

export type GeminiQuotaStats = AntigravityQuotaStats;

export interface CodexQuotaStats {
  linked: boolean;
  userEmail?: string;
  userName?: string;
  authMethod?: string;
  totalTurns: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  lastLatencyMs: number;
  avgLatencyMs: number;
  quotaLimits?: CliQuotaLimits | null;
  lastUpdated: string;
}

export interface TokenUsageState {
  promptTokens: number;
  completionTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  totalTurns: number;
  lastLatencyMs: number;
  avgLatencyMs: number;
  linked: boolean;
  userEmail?: string;
  quotaLimits?: CliQuotaLimits | null;
  geminiQuota?: GeminiQuotaStats | null;
  codexQuota?: CodexQuotaStats | null;
  activeProvider?: ModelProvider;
}

export interface ModelOption {
  id: ModelId;
  provider: ModelProvider;
  hostedBy?: 'antigravity' | 'codex' | 'claude';
  name: string;
  badge: string;
  description: string;
  icon: string;
  iconColor: string;
  iconSvg?: string;
  limits?: ModelLimits;
  defaultEffort?: ReasoningEffort;
  effortOptions?: ModelEffortOption[];
}

export const AVAILABLE_MODELS: ModelOption[] = [];

export const NONE_MODEL: ModelOption = {
  id: 'none',
  provider: 'gemini',
  hostedBy: undefined,
  name: 'No Model Selected',
  badge: 'Direct Sandbox',
  description: 'Raw microVM sandbox execution with zero AI inference synthesis',
  icon: 'tune',
  iconColor: 'text-outline',
  limits: {
    contextWindow: 0,
    contextWindowLabel: 'Raw Execution',
    maxOutputTokens: 0,
    maxOutputLabel: 'No LLM',
    tier: 'Direct MicroVM',
  },
};

/**
 * Checks if a model is an OpenAI / GPT model based on its ID or name.
 */
export function isGptModel(modelId: string, modelName?: string): boolean {
  const idLower = (modelId || '').toLowerCase();
  const nameLower = (modelName || '').toLowerCase();
  return (
    idLower.includes('gpt') ||
    nameLower.includes('gpt') ||
    idLower.startsWith('o1') ||
    idLower.startsWith('o3') ||
    idLower.startsWith('codex') ||
    nameLower.includes('openai')
  );
}

/**
 * Checks if a model is a Google Gemini model based on its ID or name.
 */
export function isGeminiModel(modelId: string, modelName?: string): boolean {
  const idLower = (modelId || '').toLowerCase();
  const nameLower = (modelName || '').toLowerCase();
  return idLower.includes('gemini') || nameLower.includes('gemini');
}

/**
 * Resolves the minimum reasoning effort model ID for a model option.
 * If no effort options exist, returns the model's base ID.
 */
export function getMinimumEffortModelId(model: ModelOption): ModelId {
  if (!model.effortOptions || model.effortOptions.length === 0) {
    return model.id;
  }
  const effortOrder: Record<string, number> = {
    min: 0,
    fast: 1,
    lowest: 2,
    low: 3,
    medium: 4,
    med: 4,
    high: 5,
    xhigh: 6,
    max: 7,
    ultra: 8,
  };

  const sorted = [...model.effortOptions].sort((a, b) => {
    const rankA = effortOrder[a.effort?.toLowerCase?.()] ?? 50;
    const rankB = effortOrder[b.effort?.toLowerCase?.()] ?? 50;
    return rankA - rankB;
  });

  return sorted[0].modelId;
}

/**
 * Returns formatted display information for any model ID, including reasoning effort.
 */
export function getModelDisplayInfo(
  modelId: ModelId,
  modelList: ModelOption[] = AVAILABLE_MODELS
): {
  baseName: string;
  effortLabel?: string;
  fullLabel: string;
  icon: string;
  iconColor: string;
  iconSvg?: string;
  provider: ModelProvider;
  parentModel: ModelOption;
} {
  if (modelId === 'none') {
    return {
      baseName: 'No Model Selected',
      effortLabel: undefined,
      fullLabel: 'No Model Selected',
      icon: 'tune',
      iconColor: 'text-outline',
      iconSvg: undefined,
      provider: 'gemini',
      parentModel: NONE_MODEL,
    };
  }

  // Check if modelId matches an effort option in any model
  for (const model of modelList) {
    if (model.effortOptions) {
      const match = model.effortOptions.find((opt) => opt.modelId === modelId);
      if (match) {
        const isGpt = isGptModel(modelId, model.name);
        const isClaude = (modelId + model.name).toLowerCase().includes('claude');
        const isGemini = isGeminiModel(modelId, model.name);
        return {
          baseName: model.name,
          effortLabel: match.label,
          fullLabel: `${model.name} • ${match.label}`,
          icon: isGpt ? 'code' : isClaude ? 'bolt' : 'auto_awesome',
          iconColor: isGpt ? 'text-[#10A37F]' : isClaude ? 'text-[#F59E0B]' : 'text-[#4285F4]',
          iconSvg: isGpt
            ? '/model-icons/openai.svg'
            : isClaude
            ? '/provider-icons/claude.svg'
            : isGemini
            ? '/model-icons/google-gemini.svg'
            : model.iconSvg || '/model-icons/google-gemini.svg',
          provider: model.provider,
          parentModel: model,
        };
      }
    }
  }

  // Check if modelId matches base model id directly
  const exact = modelList.find((m) => m.id === modelId);
  if (exact) {
    const isGpt = isGptModel(modelId, exact.name);
    const isClaude = (modelId + exact.name).toLowerCase().includes('claude');
    const isGemini = isGeminiModel(modelId, exact.name);
    return {
      baseName: exact.name,
      effortLabel: undefined,
      fullLabel: exact.name,
      icon: isGpt ? 'code' : isClaude ? 'bolt' : 'auto_awesome',
      iconColor: isGpt ? 'text-[#10A37F]' : isClaude ? 'text-[#F59E0B]' : 'text-[#4285F4]',
      iconSvg: isGpt
        ? '/model-icons/openai.svg'
        : isClaude
        ? '/provider-icons/claude.svg'
        : isGemini
        ? '/model-icons/google-gemini.svg'
        : exact.iconSvg || '/model-icons/google-gemini.svg',
      provider: exact.provider,
      parentModel: exact,
    };
  }

  // Graceful fallback for dynamic model not yet in list or unknown
  const isGpt = isGptModel(modelId);
  const isClaude = modelId.toLowerCase().includes('claude');
  const provider: ModelProvider = isClaude
    ? 'claude'
    : isGpt
    ? 'codex'
    : 'gemini';
  const fallbackModel: ModelOption = {
    id: modelId,
    provider,
    name: modelId,
    badge: 'Dynamic',
    description: `Dynamic model via CLI (${modelId})`,
    icon: isGpt ? 'code' : isClaude ? 'bolt' : 'auto_awesome',
    iconColor:
      isGpt
        ? 'text-[#10A37F]'
        : isClaude
        ? 'text-[#F59E0B]'
        : 'text-[#4285F4]',
    iconSvg: isGpt
      ? '/model-icons/openai.svg'
      : isClaude
      ? '/provider-icons/claude.svg'
      : '/model-icons/google-gemini.svg',
  };

  return {
    baseName: modelId,
    effortLabel: undefined,
    fullLabel: modelId,
    icon: fallbackModel.icon,
    iconColor: fallbackModel.iconColor,
    iconSvg: fallbackModel.iconSvg,
    provider,
    parentModel: fallbackModel,
  };
}

export type InspectorTab = 'terminal' | 'file-tree' | 'metrics';

export type AIPlatform =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'claude_subscription'
  | 'codex_subscription'
  | 'custom';

export interface LinkedAIPlatformAccount {
  platform: AIPlatform;
  accountId: string;
  accountEmail?: string;
  connectedAt: string;
  hasValidSession: boolean;
  tier?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  primaryPlatform: AIPlatform;
  linkedPlatforms: LinkedAIPlatformAccount[];
  createdAt: string;
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
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  model: ModelType;
  messageCount?: number;
  pagination?: PaginationMeta;
  overwriteMessages?: boolean;
  truncateAfterMessageId?: string;
}

export interface PaginatedMessagesResponse {
  sessionId: string;
  messages: ChatMessage[];
  pagination: PaginationMeta;
}

export interface WorkflowItem {
  id: string;
  name: string;
  icon: string;
  iconColor: string;
  active?: boolean;
}

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
  role: 'user' | 'assistant';
  author: string;
  authorBadge?: string;
  time: string;
  avatarUrl: string;
  content: string;
  modelBadge?: string;
  latency?: string;
  steps?: StepItem[];
  codeFiles?: {
    filename: string;
    icon: string;
    code: string;
  }[];
  executionResult?: {
    time: string;
    sandboxId: string;
    statusText: string;
  };
  explanationPoints?: string[];
}

export interface RateLimitState {
  limit: number;
  remaining: number;
  resetInSeconds: number;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string; select_by?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: 'standard' | 'icon';
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'small' | 'medium' | 'large';
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
              shape?: 'rectangular' | 'pill' | 'circle' | 'square';
              logo_alignment?: 'left' | 'center';
              width?: number | string;
            }
          ) => void;
          prompt: (momentListener?: (notification: unknown) => void) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}
