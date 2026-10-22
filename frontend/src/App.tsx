import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import {
  currentUserAtom,
  isAuthModalOpenAtom,
  cliStatusAtom,
  selectedModelAtom,
  availableModelsAtom,
  geminiQuotaAtom,
  codexQuotaAtom,
  rateLimitAtom,
  currentSessionIdAtom,
  sessionsAtom,
  messagesAtom,
  isGeneratingAtom,
  selectedSandboxIdAtom,
  getSelectedSandboxStorageKey,
  sandboxUsageAtom,
  isDarkModeAtom,
  isInspectorOpenAtom,
  inspectorTargetFilePathAtom,
  toastMessageAtom,
  isPageLoadingAtom,
  loadingMessageAtom,
  loadingSubMessageAtom,
} from './state';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Ribbon } from './components/Ribbon';
import { Accordion } from './components/Accordion';
import { PromptBar, type AttachedFile } from './components/PromptBar';
import { CloudInspector } from './components/CloudInspector';
import { AuthModal } from './components/AuthModal';
import { MarkdownContent } from './components/MarkdownContent';
import { LoadingScreen } from './components/LoadingScreen';
import { signOutFirebase } from './services/firebaseAuth.service';
import { sessionSyncService } from './services/sessionSync.service';
import { fetchCliStatus, closeGeminiCliLoginPopup, invalidateCliStatusCache, type CliStatus } from './services/cliAuth.service';
import { apiFetch, isTokenExpired } from './utils/api.util';
import type { ModelType, ChatMessage, UserProfile, AIPlatform, LinkedAIPlatformAccount, ChatSession, ChatSessionDetails, StepItem, ModelOption, GeminiQuotaStats, CodexQuotaStats } from './types';
import { NONE_MODEL, getModelDisplayInfo, getMinimumEffortModelId } from './types';
import { fetchAvailableModels, invalidateModelsCache } from './services/models.service';
import { preferencesService } from './services/preferences.service';
import { computeSessionTokens } from './utils/tokenMetrics.util';
import { checkModelQuotaExhausted } from './utils/quota.util';

const syncUserProfileViaBackend = async (user: UserProfile): Promise<void> => {
  try {
    await apiFetch('/api/v1/auth/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    });
  } catch (err) {
    console.warn('Backend user profile sync warning', err);
  }
};

// ---------------------------------------------------------------------------
// Parses user message content to separate attachment metadata from prompt text
// ---------------------------------------------------------------------------
type ParsedAttachment = { name: string; size?: string; isCode: boolean };
type ParsedUserMessage = { text: string; attachments: ParsedAttachment[] };

function parseUserMessageContent(content: string): ParsedUserMessage {
  const attachments: ParsedAttachment[] = [];
  let text = content;

  // Pattern 1: [File: filename.ext] or [File: ./attachments/filename.ext]\n```lang\n...\n```
  const codeFileRegex = /\[File: (?:(?:\.\/)?attachments\/)?([^\]]+)\]\n```[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = codeFileRegex.exec(content)) !== null) {
    const fileName = m[1].trim();
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const codeExts = ['ts','tsx','js','jsx','py','sh','json','html','css','sql','md','txt','yaml','yml'];
    attachments.push({ name: fileName, isCode: codeExts.includes(ext) });
  }
  text = text.replace(codeFileRegex, '').trim();

  // Pattern 2: [Attached file: filename.ext (size)] or [Attached file available in workspace: ./attachments/filename.ext (size)]
  const binaryFileRegex = /\[Attached file(?: available in workspace)?: (?:(?:\.\/)?attachments\/)?([^(]+) \(([^)]+)\)\]/g;
  while ((m = binaryFileRegex.exec(content)) !== null) {
    attachments.push({ name: m[1].trim(), size: m[2].trim(), isCode: false });
  }
  text = text.replace(binaryFileRegex, '').trim();

  return { text, attachments };
}

function getAttachmentIcon(fileName: string): { icon: string; colorClass: string } {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'svg') return { icon: 'palette', colorClass: 'text-pink-400' };
  if (/^(png|jpe?g|gif|webp|ico|bmp|tiff)$/.test(ext)) return { icon: 'image', colorClass: 'text-emerald-400' };
  if (/^(mp4|webm|mkv|mov|avi)$/.test(ext)) return { icon: 'video_file', colorClass: 'text-purple-400' };
  if (/^(mp3|wav|ogg|flac|m4a)$/.test(ext)) return { icon: 'audio_file', colorClass: 'text-rose-400' };
  if (ext === 'pdf') return { icon: 'picture_as_pdf', colorClass: 'text-red-400' };
  if (/^(zip|tar|gz|7z|rar|bz2)$/.test(ext)) return { icon: 'folder_zip', colorClass: 'text-amber-400' };
  if (/^(csv|tsv|xlsx?)$/.test(ext)) return { icon: 'table_chart', colorClass: 'text-teal-400' };
  if (/^(ts|tsx|js|jsx|py|sh|bash|json|html|css|sql|rs|go|cpp|c|java|php|rb|xml|toml|ini|conf|md|txt|yaml|yml)$/.test(ext)) {
    return { icon: 'code', colorClass: 'text-primary' };
  }
  return { icon: 'description', colorClass: 'text-blue-400' };
}

function normalizeUser(user: UserProfile | null): UserProfile | null {
  if (!user) return null;
  let linkedPlatforms: LinkedAIPlatformAccount[] = [];
  if (Array.isArray(user.linkedPlatforms)) {
    linkedPlatforms = user.linkedPlatforms;
  } else if (user.linkedPlatforms && typeof user.linkedPlatforms === 'object') {
    linkedPlatforms = Object.values(user.linkedPlatforms).filter(
      (p): p is LinkedAIPlatformAccount => Boolean(p && typeof p === 'object' && 'platform' in p)
    );
  }
  return {
    ...user,
    linkedPlatforms,
  };
}

export const isModelOptionLinked = (
  model?: ModelOption | null,
  currentCliStatus?: CliStatus | null,
  user?: UserProfile | null
): boolean => {
  if (!model || model.id === 'none') return true;
  const isAgyLinked = Boolean(
    currentCliStatus?.antigravity?.linked || currentCliStatus?.gemini?.linked
  );

  if (model.hostedBy === 'antigravity') {
    return isAgyLinked;
  }
  if (model.id.startsWith('gemini-') || model.id.startsWith('antigravity-')) {
    return isAgyLinked;
  }

  const linkedPlatforms = Array.isArray(user?.linkedPlatforms)
    ? user.linkedPlatforms
    : (user?.linkedPlatforms && typeof user.linkedPlatforms === 'object')
    ? Object.values(user.linkedPlatforms).filter(
        (p): p is LinkedAIPlatformAccount => Boolean(p && typeof p === 'object' && 'platform' in p)
      )
    : [];

  if (model.hostedBy === 'claude' || model.provider === 'claude' || model.id.startsWith('claude-')) {
    const isCliSubscription = Boolean(
      currentCliStatus?.claude?.linked && currentCliStatus?.claude?.authMethod !== 'api_key'
    );
    const isAccountSubscription = Boolean(
      linkedPlatforms.some(
        (p) => p.platform === 'claude_subscription' && p.hasValidSession
      )
    );
    return isCliSubscription || isAccountSubscription;
  }

  if (
    model.hostedBy === 'codex' ||
    model.provider === 'codex' ||
    model.id.startsWith('codex-') ||
    model.id.startsWith('gpt-') ||
    model.id.startsWith('o1') ||
    model.id.startsWith('o3')
  ) {
    return Boolean(
      currentCliStatus?.codex?.linked ||
      linkedPlatforms.some(
        (p) => (p.platform === 'codex_subscription' || p.platform === 'openai') && p.hasValidSession
      )
    );
  }

  return isAgyLinked;
};

export const getBestLinkedModelId = (
  modelsList: ModelOption[],
  currentStatus: CliStatus | null | undefined,
  user: UserProfile | null | undefined,
  geminiQ?: GeminiQuotaStats | null,
  codexQ?: CodexQuotaStats | null
): string | null => {
  if (!modelsList || modelsList.length === 0) return null;

  // 1. Filter models whose backing CLI/account is actively linked
  const linkedModels = modelsList.filter(
    (m) => m.id !== 'none' && isModelOptionLinked(m, currentStatus, user)
  );
  if (linkedModels.length === 0) return null;

  // 2. Filter for models that are not quota exhausted if quotas are known
  const availableLinked = linkedModels.filter(
    (m) => !checkModelQuotaExhausted(m, geminiQ, codexQ, currentStatus)
  );
  const candidates = availableLinked.length > 0 ? availableLinked : linkedModels;

  // 3. Prefer primary Antigravity / Gemini model (e.g., Flash or general default) if linked
  const preferred =
    candidates.find((m) => m.id.includes('flash') || m.id.includes('gemini')) ||
    candidates[0];

  if (preferred.effortOptions && preferred.effortOptions.length > 0) {
    return getMinimumEffortModelId(preferred);
  }
  return preferred.id;
};

export const App: React.FC = () => {
  // Session history state managed via Jotai
  const [sessions, setSessions] = useAtom(sessionsAtom);
  const [currentSessionId, setCurrentSessionId] = useAtom(currentSessionIdAtom);

  // Provider - Model - Effort preference state managed via Jotai
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom);
  const [availableModels, setAvailableModels] = useAtom(availableModelsAtom);
  const [messages, setMessages] = useAtom(messagesAtom);

  // AI Platform Auth State managed via Jotai
  const [currentUser, setCurrentUser] = useAtom(currentUserAtom);
  const [isAuthModalOpen, setIsAuthModalOpen] = useAtom(isAuthModalOpenAtom);
  const [isSyncingSessions, setIsSyncingSessions] = useState(false);

  // Persist current session ID to unified user preferences whenever it changes
  useEffect(() => {
    try {
      if (currentUser?.id) {
        preferencesService.updatePreferences(currentUser.id, {
          activeSessionId: currentSessionId || null,
        });
      }
    } catch {}
  }, [currentUser?.id, currentSessionId]);

  const [isLoading, setIsLoading] = useAtom(isGeneratingAtom);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useAtom(toastMessageAtom);
  const abortControllerRef = useRef<AbortController | null>(null);
  const initialLoadCompletedRef = useRef<boolean>(false);
  const lastHydratedUserIdRef = useRef<string | null>(null);

  // User Message Action States (Copy & Inline Edit)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editMessageContent, setEditMessageContent] = useState<string>('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // Mobile drawer & inspector states
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useAtom(isInspectorOpenAtom);
  const setTargetFilePath = useSetAtom(inspectorTargetFilePathAtom);

  // Handle SPA workspace file route clean-up and auto-open in Cloud Inspector
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const pathname = window.location.pathname;
    const isWorkspaceRoute =
      pathname.startsWith('/home/user/workspace/') ||
      pathname.startsWith('/workspace/');

    if (isWorkspaceRoute) {
      let filePath = pathname
        .replace(/^\/home\/user\/workspace\/?/, '')
        .replace(/^\/workspace\/?/, '');
      filePath = decodeURIComponent(filePath);

      window.history.replaceState(null, '', '/');

      if (filePath) {
        setIsInspectorOpen(true);
        setTargetFilePath(filePath);
      }
    }
  }, [setIsInspectorOpen, setTargetFilePath]);

  // Full-page initialization and post-sign-in loading screen
  const [isPageLoading, setIsPageLoading] = useAtom(isPageLoadingAtom);
  const [loadingMessage, setLoadingMessage] = useAtom(loadingMessageAtom);
  const [loadingSubMessage, setLoadingSubMessage] = useAtom(loadingSubMessageAtom);

  // Paginated chat history state
  const [hasMoreEarlierMessages, setHasMoreEarlierMessages] = useState<boolean>(false);
  const [remainingMessageCount, setRemainingMessageCount] = useState<number>(0);
  const [isLoadingEarlierMessages, setIsLoadingEarlierMessages] = useState<boolean>(false);

  // Rate Limiting & Quota State managed via Jotai
  const [, setRateLimit] = useAtom(rateLimitAtom);
  const [geminiQuota, setGeminiQuota] = useAtom(geminiQuotaAtom);
  const [codexQuota, setCodexQuota] = useAtom(codexQuotaAtom);
  const [cliStatus, setCliStatus] = useAtom(cliStatusAtom);
  const cliStatusFetchedRef = useRef<boolean>(false);

  const refreshCliStatus = useCallback((force = false) => {
    if (!currentUserRef.current?.id) return Promise.resolve(null);
    return fetchCliStatus(force).then((status) => {
      setCliStatus(status);
      cliStatusFetchedRef.current = true;
      try {
        if (currentUserRef.current?.id) {
          localStorage.setItem(`harness_cli_status_${currentUserRef.current.id}`, JSON.stringify(status));
        }
      } catch {}
      fetchQuota(force, currentUserRef.current?.email);
      return status;
    }).catch(() => null);
  }, []);

  useEffect(() => {
    if (!currentUser?.id) {
      if (!localStorage.getItem('auth_token')) {
        setCliStatus({
          antigravity: { linked: false },
          gemini: { linked: false },
          claude: { linked: false },
          codex: { linked: false },
        });
      }
      return;
    }
    // Instant 0ms cache hydration from localStorage if available
    try {
      const cached = localStorage.getItem(`harness_cli_status_${currentUser.id}`);
      if (cached && !cliStatusFetchedRef.current) {
        setCliStatus(JSON.parse(cached));
      }
    } catch {}

    if (!cliStatusFetchedRef.current) {
      refreshCliStatus();
    }
  }, [currentUser?.id, refreshCliStatus]);

  // Cloud Sandbox State & Explicit VM Provisioning managed via Jotai
  const [sandboxUsage, setSandboxUsage] = useAtom(sandboxUsageAtom);
  const [isStartingSandbox, setIsStartingSandbox] = useState(false);
  const [selectedSandboxId, setSelectedSandboxId] = useAtom(selectedSandboxIdAtom);

  // Synchronize active sandbox selection to tenant-scoped localStorage
  useEffect(() => {
    const userId = currentUser?.id;
    const key = getSelectedSandboxStorageKey(userId);
    try {
      if (selectedSandboxId) {
        localStorage.setItem(key, selectedSandboxId);
      } else {
        localStorage.removeItem(key);
      }
    } catch {}
  }, [selectedSandboxId, currentUser?.id]);

  // Synchronize sandbox selection when currentUser switches or logs out
  useEffect(() => {
    const userId = currentUser?.id;
    if (!userId) {
      setSelectedSandboxId(null);
      return;
    }
    const key = getSelectedSandboxStorageKey(userId);
    const saved = localStorage.getItem(key);
    setSelectedSandboxId(saved || null);
  }, [currentUser?.id, setSelectedSandboxId]);

  const activeSandbox = useMemo(() => {
    if (!currentUser || !sandboxUsage?.sandboxes || sandboxUsage.sandboxes.length === 0) return null;
    if (selectedSandboxId) {
      const selected = sandboxUsage.sandboxes.find((s) => s.sandboxId === selectedSandboxId);
      if (selected) return selected;
    }
    if (sandboxUsage.sandboxes.length > 0) {
      return sandboxUsage.sandboxes[0];
    }
    return null;
  }, [currentUser, sandboxUsage, selectedSandboxId]);

  const activeSandboxRef = useRef(activeSandbox);
  activeSandboxRef.current = activeSandbox;
  const sandboxUsageRef = useRef(sandboxUsage);
  sandboxUsageRef.current = sandboxUsage;

  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const isFetchingUsageRef = useRef(false);
  const selectedModelRef = useRef(selectedModel);
  selectedModelRef.current = selectedModel;
  const availableModelsRef = useRef(availableModels);
  availableModelsRef.current = availableModels;
  const cliStatusRef = useRef(cliStatus);
  cliStatusRef.current = cliStatus;
  const geminiQuotaRef = useRef(geminiQuota);
  geminiQuotaRef.current = geminiQuota;
  const codexQuotaRef = useRef(codexQuota);
  codexQuotaRef.current = codexQuota;

  const fetchSandboxUsage = useCallback(async (overrideUserId?: string) => {
    if (isFetchingUsageRef.current) return sandboxUsageRef.current;
    try {
      const uid = overrideUserId || currentUserRef.current?.id;
      if (!uid) {
        const empty = { used: 0, max: 3, sandboxes: [] };
        setSandboxUsage(empty);
        setSelectedSandboxId(null);
        return empty;
      }
      isFetchingUsageRef.current = true;
      const params = new URLSearchParams();
      params.set('userId', uid);
      const url = `/api/v1/sandboxes?${params.toString()}`;
      const res = await apiFetch(url);
      const data = await res.json();
      if (data.success && data.data) {
        setSandboxUsage(data.data);
        return data.data;
      }
      return sandboxUsageRef.current;
    } catch {
      return sandboxUsageRef.current;
    } finally {
      isFetchingUsageRef.current = false;
    }
  }, []);

  // Clean up sandbox state and stored preferences when logged out
  useEffect(() => {
    if (!currentUser) {
      setSelectedSandboxId(null);
      setSandboxUsage({ used: 0, max: 3, sandboxes: [] });
      try {
        localStorage.removeItem('harness_selected_sandbox_id');
      } catch {}
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser?.id) return;
    // Event-driven initial discovery on mount/login
    fetchSandboxUsage();

    // Poll quota telemetry once every 60 seconds only when tab is visible AND conditions are met
    // 1. Sandbox usage is 100% event-driven and NOT polled here.
    // 2. Only poll quota if an active cloud sandbox microVM is running.
    // 3. Only poll quota for CLIs that are actually linked by the user.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        const hasSandbox = activeSandboxRef.current || (sandboxUsageRef.current?.sandboxes && sandboxUsageRef.current.sandboxes.length > 0);
        if (!hasSandbox) return;

        const isLinked = cliStatusRef.current?.antigravity?.linked || cliStatusRef.current?.gemini?.linked || cliStatusRef.current?.codex?.linked;
        if (isLinked) {
          fetchQuota(false);
        }
      }
    }, 60000);

    return () => {
      clearInterval(interval);
    };
  }, [currentUser?.id, fetchSandboxUsage]);

  // If the saved sandbox was destroyed or terminated, clean up stale selection
  useEffect(() => {
    if (sandboxUsage?.sandboxes && selectedSandboxId) {
      const stillExists = sandboxUsage.sandboxes.some((s) => s.sandboxId === selectedSandboxId);
      if (!stillExists) {
        setSelectedSandboxId(null);
      }
    } else if (sandboxUsage?.sandboxes && sandboxUsage.sandboxes.length > 0 && !selectedSandboxId) {
      setSelectedSandboxId(sandboxUsage.sandboxes[0].sandboxId);
    }
  }, [sandboxUsage, selectedSandboxId]);

  const handleStartSandboxVM = async () => {
    if (!currentUser) {
      setIsAuthModalOpen(true);
      return;
    }
    if (sandboxUsage && sandboxUsage.used >= sandboxUsage.max) {
      showToast(`Sandbox quota limit reached (${sandboxUsage.used}/${sandboxUsage.max}). Delete an existing sandbox first.`);
      return;
    }
    setIsStartingSandbox(true);
    try {
      const cleanSession = (currentSessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32);
      const res = await apiFetch('/api/v1/sandbox/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: cleanSession }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.data?.sandboxId) {
          setSelectedSandboxId(data.data.sandboxId);
        }
        if (data.data?.usage) {
          setSandboxUsage(data.data.usage);
        }
        showToast('Cloud Sandbox VM started and ready');
      } else {
        showToast(data.error?.message || 'Failed to start sandbox VM');
      }
    } catch {
      showToast('Failed to start sandbox VM');
    } finally {
      setIsStartingSandbox(false);
    }
  };

  const handleAttachExistingSandbox = (targetSandboxId: string) => {
    setSelectedSandboxId(targetSandboxId);
    const sbName = sandboxUsage?.sandboxes?.find((s) => s.sandboxId === targetSandboxId)?.name || 'Sandbox';
    showToast(`Connected to ${sbName}`);
  };

  const selectedModelOption: ModelOption = useMemo(() => {
    if (selectedModel === 'none') return NONE_MODEL;
    const found = availableModels.find(
      (m) => m.id === selectedModel || m.effortOptions?.some((opt) => opt.modelId === selectedModel)
    );
    if (found) return found;
    return getModelDisplayInfo(selectedModel, availableModels).parentModel;
  }, [selectedModel, availableModels]);

  const selectedModelOptionRef = useRef(selectedModelOption);
  selectedModelOptionRef.current = selectedModelOption;

  const handleSelectModel = useCallback((modelId: ModelType) => {
    setSelectedModel(modelId);
    try {
      const display = getModelDisplayInfo(modelId, availableModelsRef.current);
      preferencesService.updatePreferences(currentUserRef.current?.id, {
        selectedModelId: modelId && modelId !== 'none' ? modelId : undefined,
        selectedEffort: display.effortLabel || 'default',
      });
    } catch {}
  }, [setSelectedModel]);

  const isModelLinked = useMemo(() => {
    return isModelOptionLinked(selectedModelOption, cliStatus, currentUser);
  }, [selectedModelOption, cliStatus, currentUser]);

  const isAnyCliLinked = useMemo(() => {
    return Boolean(
      cliStatus?.antigravity?.linked ||
      cliStatus?.gemini?.linked ||
      cliStatus?.claude?.linked ||
      cliStatus?.codex?.linked
    );
  }, [cliStatus]);

  const refreshModels = useCallback((force = true) => {
    const userId = currentUserRef.current?.id;
    if (!userId) {
      setAvailableModels([]);
      return;
    }
    fetchAvailableModels()
      .then((models) => {
        if (models && models.length > 0) {
          setAvailableModels(models);
          // If a model preference was saved and is available and linked, keep it.
          // Otherwise, auto-default to the best available linked model.
          const currentSelected = selectedModelRef.current;
          const currentOption = selectedModelOptionRef.current;
          const currentStatus = cliStatusRef.current;
          const user = currentUserRef.current;

          const isModelAvailable = models.some(
            (m) => m.id === currentSelected || m.effortOptions?.some((opt) => opt.modelId === currentSelected)
          );
          const isCurrentlyLinked =
            isModelAvailable &&
            currentSelected !== 'none' &&
            isModelOptionLinked(currentOption, currentStatus, user);

          if (!isCurrentlyLinked) {
            const bestLinkedId = getBestLinkedModelId(
              models,
              currentStatus,
              user,
              geminiQuotaRef.current,
              codexQuotaRef.current
            );
            if (bestLinkedId) {
              handleSelectModel(bestLinkedId);
            } else if (!isModelAvailable) {
              setSelectedModel('none');
              localStorage.removeItem('model_preference');
              localStorage.removeItem('selected_model_preference');
            }
          }
        } else if (models && models.length === 0) {
          setAvailableModels([]);
        }
      })
      .catch(() => {});
  }, [currentSessionId, handleSelectModel, setSelectedModel]);

  useEffect(() => {
    if (!currentUser?.id) {
      setAvailableModels([]);
      return;
    }
    // During initial workspace load, waitForWorkspaceAndProvidersReady performs
    // the single unified fetch for models, status, quotas, and sandboxes.
    if (initialLoadCompletedRef.current) {
      refreshModels(false);
    }
  }, [currentUser?.id, refreshModels]);

  // Auto-default to an active, linked model if current selection is unlinked or 'none'
  useEffect(() => {
    if (!currentUser?.id || availableModels.length === 0) return;
    const isCurrentLinked =
      selectedModel !== 'none' &&
      isModelOptionLinked(selectedModelOption, cliStatus, currentUser);

    if (!isCurrentLinked) {
      const bestLinkedId = getBestLinkedModelId(
        availableModels,
        cliStatus,
        currentUser,
        geminiQuotaRef.current,
        codexQuotaRef.current
      );
      if (bestLinkedId && bestLinkedId !== selectedModel) {
        handleSelectModel(bestLinkedId);
      }
    }
  }, [
    currentUser?.id,
    availableModels.length,
    selectedModel,
    selectedModelOption?.id,
    cliStatus?.antigravity?.linked,
    cliStatus?.codex?.linked,
    cliStatus?.claude?.linked,
    cliStatus?.gemini?.linked,
    handleSelectModel,
  ]);

  const tokenUsage = useMemo(
    () =>
      computeSessionTokens(
        messages,
        selectedModel,
        geminiQuota,
        codexQuota,
        selectedModelOption?.hostedBy === 'antigravity'
          ? 'gemini'
          : selectedModelOption?.provider || 'gemini'
      ),
    [messages, selectedModel, geminiQuota, codexQuota, selectedModelOption]
  );

  const lastQuotaFetchRef = useRef<number>(0);
  const inFlightQuotaPromiseRef = useRef<Promise<any> | null>(null);
  const authMeInFlightRef = useRef<Promise<any> | null>(null);
  const authMeCompletedRef = useRef<boolean>(false);
  const authMeMountedRef = useRef<boolean>(false);

  const fetchQuota = async (
    force = false,
    emailOverride?: string,
    cliStatusOverride?: CliStatus | null,
    hasSandboxOverride?: boolean
  ) => {
    // Guard 1: If neither Antigravity nor Codex CLI is linked, never fetch quota!
    const effectiveStatus = cliStatusOverride || cliStatusRef.current;
    const isAntigravityLinked = effectiveStatus?.antigravity?.linked || effectiveStatus?.gemini?.linked;
    const isCodexLinked = effectiveStatus?.codex?.linked;

    if (!isAntigravityLinked) setGeminiQuota(null);
    if (!isCodexLinked) setCodexQuota(null);

    if (!isAntigravityLinked && !isCodexLinked) {
      return null;
    }

    // Guard 2: If user has no active sandbox, never fetch quota (quotas execute strictly inside microVMs)
    const hasSandbox =
      hasSandboxOverride !== undefined
        ? hasSandboxOverride
        : (activeSandboxRef.current || (sandboxUsageRef.current?.sandboxes && sandboxUsageRef.current.sandboxes.length > 0));
    if (!hasSandbox) {
      setGeminiQuota(null);
      setCodexQuota(null);
      return null;
    }

    const email = emailOverride || currentUser?.email || currentUserRef.current?.email;
    if (!email) {
      return null;
    }

    const now = Date.now();
    if (!force && now - lastQuotaFetchRef.current < 4000) {
      return;
    }
    if (inFlightQuotaPromiseRef.current) {
      return inFlightQuotaPromiseRef.current;
    }

    inFlightQuotaPromiseRef.current = (async () => {
      try {
        lastQuotaFetchRef.current = Date.now();
        const emailParam = `?userEmail=${encodeURIComponent(email)}`;
        const res = await apiFetch(`/api/v1/quota${emailParam}`);
        if (res.ok) {
          const json = await res.json();
          if (json.data) {
            if (json.data.antigravity) {
              setGeminiQuota((prev) => {
                if (JSON.stringify(prev) === JSON.stringify(json.data.antigravity)) return prev;
                return json.data.antigravity;
              });
            }
            if (json.data.codex) {
              setCodexQuota((prev) => {
                if (JSON.stringify(prev) === JSON.stringify(json.data.codex)) return prev;
                return json.data.codex;
              });
            }
            return json.data;
          }
        }
      } catch {
        // offline fallback
      } finally {
        inFlightQuotaPromiseRef.current = null;
      }
    })();

    return inFlightQuotaPromiseRef.current;
  };

  // Sync and merge chat sessions across Cloud Backend, Firestore, and LocalStorage
  const syncSessions = useCallback(async (userIdOverride?: string) => {
    const uid = userIdOverride || currentUserRef.current?.id || currentUser?.id;
    if (!uid) {
      setIsSyncingSessions(false);
      return null;
    }
    setIsSyncingSessions(true);
    try {
      const merged = await sessionSyncService.loadAndReconcileSessions(
        uid,
        (interim) => {
          if (currentUserRef.current?.id === uid) {
            setSessions(interim);
          }
        }
      );
      // Guard: if user logged out while request was in-flight, discard!
      if (!currentUserRef.current?.id || currentUserRef.current.id !== uid) {
        return null;
      }
      setSessions(merged);
      return merged;
    } catch (err) {
      console.error('Session reconciliation failed', err);
      return null;
    } finally {
      setIsSyncingSessions(false);
    }
  }, [currentUser?.id]);

  // Single-flight promise reference prevents concurrent duplicate hydrations
  const workspaceHydrationPromiseRef = useRef<Promise<void> | null>(null);

  /**
   * Unified single-flight workspace hydration pipeline.
   * Ensures the 3D rotating isometric cube (LoadingScreen) waits until ALL 5 core resources complete:
   * 1. linked cli detection fetch (GET /api/v1/auth/cli/status)
   * 2. sandboxes created fetch (GET /api/v1/sandboxes)
   * 3. sidebar chats fetch (GET /api/v1/sessions)
   * 4. selected session message fetch (GET /api/v1/sessions/:id)
   * 5. quota fetch (GET /api/v1/quota) & models discovery (GET /api/v1/agent/models)
   */
  const hydrateUserWorkspace = useCallback(
    async (user: UserProfile) => {
      // If hydration is already in progress, await the single in-flight promise
      if (workspaceHydrationPromiseRef.current) {
        return workspaceHydrationPromiseRef.current;
      }
      if (lastHydratedUserIdRef.current === user.id && initialLoadCompletedRef.current) {
        setIsPageLoading(false);
        return Promise.resolve();
      }

      lastHydratedUserIdRef.current = user.id;

      const hydrationStartTime = Date.now();
      const hydrationPromise = (async () => {
        setIsPageLoading(true);
        setLoadingMessage('Configuring Atelier Workspace');
        setLoadingSubMessage('Connecting to cloud microVMs, detecting linked CLIs & chats...');

        const safetyTimer = setTimeout(() => {
          setIsPageLoading(false);
          initialLoadCompletedRef.current = true;
        }, 6000);

        try {
          invalidateCliStatusCache();
          invalidateModelsCache();
          cliStatusFetchedRef.current = false;

          // -------------------------------------------------------------------
          // Phase 1 (Parallel Level-1 Cloud Hydration):
          // 1. Linked CLI detection fetch (GET /api/v1/auth/cli/status)
          // 2. Sandboxes created fetch (GET /api/v1/sandboxes)
          // 3. Sidebar chats fetch (GET /api/v1/sessions)
          // -------------------------------------------------------------------
          setLoadingSubMessage('Detecting linked AI providers, sandboxes & chats...');
          const [cliData, sandboxData, mergedSessions] = await Promise.all([
            fetchCliStatus(true).catch(() => null),
            fetchSandboxUsage(user.id).catch(() => null),
            syncSessions(user.id).catch(() => null),
          ]);

          // Guard: if user signed out or changed while in-flight, terminate cleanly
          if (!currentUserRef.current?.id || currentUserRef.current.id !== user.id) {
            return;
          }

          let freshCliStatus = cliStatus;
          if (cliData) {
            freshCliStatus = cliData;
            setCliStatus(cliData);
            cliStatusFetchedRef.current = true;
            try {
              localStorage.setItem(`harness_cli_status_${user.id}`, JSON.stringify(cliData));
            } catch {}
          }

          // -------------------------------------------------------------------
          // Phase 2 (Target Session Resolution):
          // -------------------------------------------------------------------
          const sessionsList = mergedSessions ?? [];
          let targetSessionId: string | null = null;
          if (sessionsList.length > 0) {
            const savedPrefs = preferencesService.getPreferences(user.id);
            const activeId = savedPrefs.activeSessionId;
            const matched = activeId ? sessionsList.find((s) => s.id === activeId) : sessionsList[0];
            if (matched) {
              targetSessionId = matched.id;
              setCurrentSessionId(matched.id);
            }
          } else {
            setCurrentSessionId(null);
            setMessages([]);
            setHasMoreEarlierMessages(false);
            setRemainingMessageCount(0);
          }

          // -------------------------------------------------------------------
          // Phase 3 (Parallel Level-2 Target Hydration):
          // 4. Selected session message fetch (GET /api/v1/sessions/:id)
          // 5. Quota fetch (GET /api/v1/quota) & Model discovery (GET /api/v1/agent/models)
          // -------------------------------------------------------------------
          setLoadingSubMessage('Retrieving active session messages, quotas & models...');
          const hasSandbox = Boolean(
            (sandboxData?.sandboxes && sandboxData.sandboxes.length > 0) ||
            (sandboxUsageRef.current?.sandboxes && sandboxUsageRef.current.sandboxes.length > 0)
          );

          const [sessionData, quotaData, modelsData] = await Promise.all([
            targetSessionId
              ? sessionSyncService.getSession(targetSessionId, { limit: 25 }).catch(() => null)
              : Promise.resolve(null),
            fetchQuota(true, user.email, freshCliStatus, hasSandbox).catch(() => null),
            fetchAvailableModels().catch(() => []),
          ]);

          // Guard: if user changed during phase 3
          if (!currentUserRef.current?.id || currentUserRef.current.id !== user.id) {
            return;
          }

          // Hydrate selected session messages
          if (sessionData && targetSessionId) {
            setMessages(sessionData.messages || []);
            if (sessionData.pagination) {
              setHasMoreEarlierMessages(sessionData.pagination.hasMore);
              setRemainingMessageCount(sessionData.pagination.remaining);
            } else {
              setHasMoreEarlierMessages(false);
              setRemainingMessageCount(0);
            }
          }

          // Discovered models list
          const freshModels = modelsData && modelsData.length > 0 ? modelsData : [];
          if (freshModels.length > 0) {
            setAvailableModels(freshModels);
          }

          // -------------------------------------------------------------------
          // Phase 4 (Model Selection Reconciliation):
          // -------------------------------------------------------------------
          const effectiveStatus = freshCliStatus || cliStatus;
          const bestLinkedId = getBestLinkedModelId(
            freshModels,
            effectiveStatus,
            user,
            quotaData?.gemini ?? geminiQuotaRef.current,
            quotaData?.codex ?? codexQuotaRef.current
          );

          if (bestLinkedId) {
            handleSelectModel(bestLinkedId);
          } else {
            setSelectedModel('none');
            preferencesService.updatePreferences(user.id, {
              selectedModelId: undefined,
              selectedEffort: undefined,
            });
          }

          initialLoadCompletedRef.current = true;
          // Ensure a smooth presentation window (minimum 750ms) so the 3D cube is visibly displayed
          const elapsed = Date.now() - hydrationStartTime;
          const MIN_LOADING_TIME = 750;
          if (elapsed < MIN_LOADING_TIME) {
            await new Promise((resolve) => setTimeout(resolve, MIN_LOADING_TIME - elapsed));
          }
        } catch (err) {
          console.error('[App] Workspace hydration encountered an error:', err);
        } finally {
          clearTimeout(safetyTimer);
          setIsPageLoading(false);
          workspaceHydrationPromiseRef.current = null;
        }
      })();

      workspaceHydrationPromiseRef.current = hydrationPromise;
      return hydrationPromise;
    },
    [
      cliStatus,
      fetchSandboxUsage,
      syncSessions,
      handleSelectModel,
      setSelectedModel,
      setCliStatus,
      setMessages,
      setAvailableModels,
      setHasMoreEarlierMessages,
      setRemainingMessageCount,
      setCurrentSessionId,
      setIsPageLoading,
      setLoadingMessage,
      setLoadingSubMessage,
    ]
  );

  // Reset quotas when user logs out
  useEffect(() => {
    if (!currentUser?.id) {
      setGeminiQuota(null);
      setCodexQuota(null);
    }
  }, [currentUser?.id]);

  const handleRefreshQuota = useCallback(() => {
    if (!currentUserRef.current?.email) return;
    fetchQuota(true);
  }, []);

  const prevActiveSandboxIdRef = useRef<string | null>(null);

  // Synchronize state when activeSandbox changes (without re-fetching models/quotas)
  useEffect(() => {
    if (!currentUser?.id || !initialLoadCompletedRef.current) return;
    const currentSbxId = activeSandbox?.sandboxId || null;
    if (prevActiveSandboxIdRef.current === currentSbxId) return;
    prevActiveSandboxIdRef.current = currentSbxId;

    if (!currentSbxId) {
      refreshModels(false);
    }
  }, [currentUser?.id, activeSandbox?.sandboxId, refreshModels]);

  // Auto-retry discovering models if a sandbox is active but models list is still empty
  useEffect(() => {
    if (!currentUser?.id || !initialLoadCompletedRef.current) return;
    if (activeSandbox?.sandboxId && availableModels.length === 0) {
      const retryTimer = setTimeout(() => {
        refreshModels(true);
      }, 2500);
      return () => clearTimeout(retryTimer);
    }
  }, [currentUser?.id, activeSandbox?.sandboxId, availableModels.length, refreshModels]);

  const handleCliStatusChange = useCallback((newStatus: CliStatus) => {
    setCliStatus(newStatus);
    fetchQuota(true);
  }, []);


  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Day / Night Theme state managed via Jotai
  const [isDarkMode, setIsDarkMode] = useAtom(isDarkModeAtom);

  // Keep DOM class and favicon in sync and respond to system changes if no manual preference stored
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    const faviconEl = (document.getElementById('app-favicon') || document.querySelector('link[rel="icon"]')) as HTMLLinkElement | null;
    if (faviconEl) {
      faviconEl.href = isDarkMode ? '/favicon-white.svg' : '/favicon-black.svg';
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = (e: MediaQueryListEvent) => {
      const saved = localStorage.getItem('theme_preference');
      if (!saved) {
        setIsDarkMode(e.matches);
        if (e.matches) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
        if (faviconEl) {
          faviconEl.href = e.matches ? '/favicon-white.svg' : '/favicon-black.svg';
        }
      }
    };

    mediaQuery.addEventListener('change', handleSystemChange);
    return () => mediaQuery.removeEventListener('change', handleSystemChange);
  }, [isDarkMode]);

  const handleToggleTheme = () => {
    const nextMode = !isDarkMode;
    setIsDarkMode(nextMode);
    preferencesService.updatePreferences(currentUserRef.current?.id, {
      theme: nextMode ? 'dark' : 'light',
    });
    const faviconEl = (document.getElementById('app-favicon') || document.querySelector('link[rel="icon"]')) as HTMLLinkElement | null;
    if (faviconEl) {
      faviconEl.href = nextMode ? '/favicon-white.svg' : '/favicon-black.svg';
    }
    if (nextMode) {
      document.documentElement.classList.add('dark');
      showToast('Switched to Night Mode');
    } else {
      document.documentElement.classList.remove('dark');
      showToast('Switched to Day Mode');
    }
  };

  // Keep provider-model-effort preference in sync with unified user preferences
  useEffect(() => {
    try {
      if (selectedModel && selectedModel !== 'none') {
        const display = getModelDisplayInfo(selectedModel, availableModels);
        preferencesService.updatePreferences(currentUser?.id, {
          selectedModelId: selectedModel,
          selectedEffort: display.effortLabel || 'default',
        });
      } else if (selectedModel === 'none') {
        preferencesService.updatePreferences(currentUser?.id, {
          selectedModelId: undefined,
          selectedEffort: undefined,
        });
      }
    } catch {}
  }, [selectedModel, availableModels, currentUser?.id]);

  // Comprehensive user and session cleanup routine
  const performUserCleanup = useCallback(() => {
    authMeCompletedRef.current = false;
    authMeInFlightRef.current = null;
    initialLoadCompletedRef.current = false;
    lastHydratedUserIdRef.current = null;
    workspaceHydrationPromiseRef.current = null;
    cliStatusFetchedRef.current = false;
    invalidateCliStatusCache();
    invalidateModelsCache();
    const prevUserId = currentUserRef.current?.id;
    closeGeminiCliLoginPopup();
    // 1. Invalidate authentication tokens & caches
    localStorage.removeItem('auth_token');
    preferencesService.clearUserPreferences(prevUserId);
    sessionSyncService.clearLocalCache(prevUserId);
    currentUserRef.current = null;
    setCurrentUser(null);

    // 2. Clear current session and message view
    localStorage.removeItem('harness_current_session_id');
    setCurrentSessionId(null);
    setMessages([]);
    setHasMoreEarlierMessages(false);
    setRemainingMessageCount(0);
    setIsLoadingEarlierMessages(false);

    // 3. Clear local session list so previous user's chats don't linger
    localStorage.removeItem('harness_chat_sessions');
    setSessions([]);
    setIsSyncingSessions(false);

    // 4. Reset sandbox selection & usage
    setSelectedSandboxId(null);
    localStorage.removeItem('harness_selected_sandbox_id');
    setSandboxUsage(null);

    // 5. Reset quotas, metrics, and cloud limits
    setGeminiQuota(null);
    setCodexQuota(null);
    setRateLimit({
      limit: 1000,
      remaining: 1000,
      resetInSeconds: 0,
    });

    // 6. Reset CLI link state for signed out session
    setCliStatus({
      antigravity: { linked: false },
      gemini: { linked: false },
      claude: { linked: false },
      codex: { linked: false },
    });
  }, []);

  // Immediate full reset whenever user logs out or is unauthenticated
  useEffect(() => {
    if (!currentUser && !localStorage.getItem('auth_token')) {
      setSessions([]);
      setMessages([]);
      setCurrentSessionId(null);
      setSelectedSandboxId(null);
      setHasMoreEarlierMessages(false);
      setRemainingMessageCount(0);
      setIsLoadingEarlierMessages(false);
      localStorage.removeItem('harness_current_session_id');
      localStorage.removeItem('harness_chat_sessions');
      localStorage.removeItem('harness_selected_sandbox_id');
      sessionSyncService.clearLocalCache();
      setCliStatus({
        antigravity: { linked: false },
        gemini: { linked: false },
        claude: { linked: false },
        codex: { linked: false },
      });
    }
  }, [currentUser]);

  // Handle proactive token expiration and reactive auth:session-expired events
  useEffect(() => {
    const handleSessionExpired = () => {
      performUserCleanup();
      showToast('Your session has expired. Please sign in again.');
      setIsAuthModalOpen(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const token = localStorage.getItem('auth_token');
        if (token && isTokenExpired(token)) {
          handleSessionExpired();
        }
      }
    };

    window.addEventListener('auth:session-expired', handleSessionExpired);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('auth:session-expired', handleSessionExpired);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [performUserCleanup, showToast]);

  // Sync user profile on load using verified session token and auto-refresh weekly
  useEffect(() => {
    if (authMeMountedRef.current) return;
    authMeMountedRef.current = true;

    const token = localStorage.getItem('auth_token');
    if (!token || isTokenExpired(token)) {
      performUserCleanup();
      setIsPageLoading(false);
      initialLoadCompletedRef.current = true;
      return;
    }

    if (authMeCompletedRef.current || authMeInFlightRef.current) {
      return;
    }

    setLoadingMessage('Initializing Atelier Workspace');
    setLoadingSubMessage('Verifying credentials & detecting linked CLIs...');

    // Fallback safety timeout ensures loading screen never blocks the user indefinitely (e.g. slow network)
    const safetyTimeout = setTimeout(async () => {
      setIsPageLoading(false);
      initialLoadCompletedRef.current = true;
    }, 12000);

    authMeInFlightRef.current = apiFetch('/api/v1/auth/me')
      .then(async (res) => {
        if (!res.ok) throw new Error('Unauthenticated');
        return res.json();
      })
      .then(async (meData) => {
        authMeCompletedRef.current = true;
        if (meData.success && meData.data) {
          const user = normalizeUser(meData.data);
          if (user) {
            currentUserRef.current = user;
            setCurrentUser(user);
            await hydrateUserWorkspace(user);
          } else {
            performUserCleanup();
            setIsPageLoading(false);
            initialLoadCompletedRef.current = true;
            clearTimeout(safetyTimeout);
          }
        } else {
          performUserCleanup();
          setIsPageLoading(false);
          initialLoadCompletedRef.current = true;
          clearTimeout(safetyTimeout);
        }
      })
      .catch(() => {
        performUserCleanup();
        setIsPageLoading(false);
        initialLoadCompletedRef.current = true;
        clearTimeout(safetyTimeout);
      })
      .finally(() => {
        clearTimeout(safetyTimeout);
        authMeInFlightRef.current = null;
      });

    return () => clearTimeout(safetyTimeout);
  }, []);

  // Synchronize and hydrate workspace when user logs in or switches account
  useEffect(() => {
    if (!currentUser?.id) {
      lastHydratedUserIdRef.current = null;
      initialLoadCompletedRef.current = false;
      setIsSyncingSessions(false);
      setSessions([]);
      setMessages([]);
      setCurrentSessionId(null);
      setHasMoreEarlierMessages(false);
      setRemainingMessageCount(0);
      return;
    }

    // Guard: Prevent re-running initial wipe and sync if this user has already been hydrated
    if (lastHydratedUserIdRef.current === currentUser.id && initialLoadCompletedRef.current) {
      return;
    }

    hydrateUserWorkspace(currentUser);
  }, [currentUser?.id, hydrateUserWorkspace]);

  const handleSelectSession = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      setCurrentSessionId(session.id);

      // Instant local preview
      const localSlice = session.messages && session.messages.length > 0
        ? session.messages.slice(-25)
        : [];
      setMessages(localSlice);
      const totalMsgs = session.messageCount ?? session.messages?.length ?? 0;
      if (totalMsgs > localSlice.length) {
        setHasMoreEarlierMessages(true);
        setRemainingMessageCount(totalMsgs - localSlice.length);
      } else {
        setHasMoreEarlierMessages(false);
        setRemainingMessageCount(0);
      }

      // Preserve user's selected model preference across session switches.
      // Fetch fresh 25-message chunk and pagination state from backend
      sessionSyncService.getSession(session.id, { limit: 25 }).then((data) => {
        if (data && data.id === session.id) {
          setMessages(data.messages || []);
          setSessions((prev) =>
            prev.map((s) => (s.id === session.id ? { ...s, messages: data.messages || [] } : s))
          );
          if (data.pagination) {
            setHasMoreEarlierMessages(data.pagination.hasMore);
            setRemainingMessageCount(data.pagination.remaining);
          } else {
            setHasMoreEarlierMessages(false);
            setRemainingMessageCount(0);
          }
        }
      }).catch(() => {});
    }
  };

  const handleLoadEarlierMessages = async () => {
    if (!currentSessionId || isLoadingEarlierMessages || messages.length === 0) return;
    const oldestMessageId = messages[0]?.id;
    if (!oldestMessageId) return;

    setIsLoadingEarlierMessages(true);
    try {
      const resp = await sessionSyncService.loadEarlierMessages(currentSessionId, oldestMessageId, 25);
      if (resp && Array.isArray(resp.messages) && resp.messages.length > 0) {
        setMessages((prev) => [...resp.messages, ...prev]);
        if (resp.pagination) {
          setHasMoreEarlierMessages(resp.pagination.hasMore);
          setRemainingMessageCount(resp.pagination.remaining);
        } else {
          setHasMoreEarlierMessages(false);
          setRemainingMessageCount(0);
        }
      } else {
        setHasMoreEarlierMessages(false);
        setRemainingMessageCount(0);
      }
    } catch (err) {
      console.warn('[App] Failed to load earlier messages:', err);
      showToast('Could not load earlier messages');
    } finally {
      setIsLoadingEarlierMessages(false);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    const updated = sessions.filter((s) => s.id !== sessionId);
    setSessions(updated);
    sessionSyncService.deleteSession(sessionId, currentUser?.id).catch(() => {});

    if (currentSessionId === sessionId) {
      setCurrentSessionId(null);
      setMessages([]);
      setHasMoreEarlierMessages(false);
      setRemainingMessageCount(0);
    }

    showToast('Chat session deleted');
  };

  const handleNewSession = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setHasMoreEarlierMessages(false);
    setRemainingMessageCount(0);
    if (availableModels.length > 0) {
      const isLinked =
        selectedModel !== 'none' &&
        isModelOptionLinked(selectedModelOption, cliStatus, currentUser);
      if (!isLinked) {
        const bestLinked = getBestLinkedModelId(
          availableModels,
          cliStatus,
          currentUser,
          geminiQuota,
          codexQuota
        );
        if (bestLinked) {
          handleSelectModel(bestLinked);
        }
      }
    }
    showToast('New session initialized');
  };

  const handleGoogleLogin = async (
    idToken: string,
    email?: string,
    name?: string,
    avatarUrl?: string
  ) => {
    setLoadingMessage('Signing in to Atelier');
    setLoadingSubMessage('Configuring cloud workspace & synchronizing profile...');
    setIsPageLoading(true);
    setIsAuthModalOpen(false);

    try {
      // Clear previous user's messages, active session, and sandbox selection immediately
      setMessages([]);
      setCurrentSessionId(null);
      setSessions([]);
      setSelectedSandboxId(null);
      setHasMoreEarlierMessages(false);
      setRemainingMessageCount(0);

      let loggedInUser: UserProfile | null = null;

      // Determine if token is already an internal backend signed JWT (e.g. from direct CLI session restore)
      let isBackendJwt = false;
      try {
        const parts = idToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (payload && typeof payload.sub === 'string' && payload.sub.startsWith('usr_') && !payload.iss?.includes('google')) {
            isBackendJwt = true;
          }
        }
      } catch {}

      if (isBackendJwt) {
        localStorage.setItem('auth_token', idToken);
        const meRes = await apiFetch('/api/v1/auth/me');
        const meData = await meRes.json();
        if (meData.success && meData.data) {
          loggedInUser = meData.data;
        }
      } else {
        const res = await apiFetch('/api/v1/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken, email, name, avatarUrl }),
        });

        const data = await res.json();
        if (data.success && data.data?.token) {
          localStorage.setItem('auth_token', data.data.token);
          loggedInUser = data.data.user;
        } else {
          const errorMsg = data.error?.message || data.message || 'Authentication failed';
          showToast(errorMsg);
          setIsPageLoading(false);
          throw new Error(errorMsg);
        }
      }

      if (!loggedInUser) {
        setIsPageLoading(false);
        throw new Error('Failed to resolve authenticated user profile');
      }

      const normalizedUser = normalizeUser(loggedInUser);
      if (!normalizedUser) {
        setIsPageLoading(false);
        throw new Error('Failed to normalize authenticated user profile');
      }
      currentUserRef.current = normalizedUser;
      setCurrentUser(normalizedUser);

      // Hydrate all 5 cloud resources in single-flight pipeline
      // 3D cube waits for CLI detection, sandboxes, chats, active message, and quota
      await hydrateUserWorkspace(normalizedUser);

      showToast(`Welcome back, ${loggedInUser.name}!`);
    } catch (err: unknown) {
      setIsPageLoading(false);
      const errorMsg = err instanceof Error ? err.message : 'Authentication failed';
      showToast(errorMsg);
      throw err;
    }
  };

  const handleLinkSubscription = async (
    platform: 'claude_subscription' | 'codex_subscription'
  ) => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      showToast('Please sign in first');
      setIsAuthModalOpen(true);
      return;
    }

    try {
      const res = await apiFetch('/api/v1/auth/device/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deviceCode: 'auto_sync', platform }),
      });
      const data = await res.json();
      if (data.success) {
        const user = normalizeUser(data.data);
        currentUserRef.current = user;
        setCurrentUser(user);
        setIsAuthModalOpen(false);
        if (user) {
          syncUserProfileViaBackend(user);
        }
        showToast(
          `Linked ${
            platform === 'claude_subscription' ? 'Claude Pro / Team' : 'ChatGPT Plus / Codex'
          } Subscription!`
        );
      } else {
        showToast(data.error?.message || 'Failed to link subscription');
      }
    } catch {
      showToast('Error linking subscription');
    }
  };

  const handleConnectApiKey = async (platform: AIPlatform, key: string) => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      showToast('Please sign in first');
      setIsAuthModalOpen(true);
      return;
    }

    try {
      const res = await apiFetch('/api/v1/auth/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ platform, apiKey: key }),
      });
      const data = await res.json();
      if (data.success) {
        const user = normalizeUser(data.data);
        currentUserRef.current = user;
        setCurrentUser(user);
        setIsAuthModalOpen(false);
        if (user) {
          syncUserProfileViaBackend(user);
        }
        showToast(`Saved ${platform.toUpperCase()} API Key to secure sandbox`);
      } else {
        showToast(data.error?.message || 'Failed to save API key');
      }
    } catch {
      showToast(`Saved ${platform.toUpperCase()} API Key`);
    }
  };

  const handleLogout = () => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      apiFetch('/api/v1/auth/logout', {
        method: 'POST',
      }).catch(() => {});
    }
    signOutFirebase();
    performUserCleanup();
    setSessions([]);
    setMessages([]);
    setCurrentSessionId(null);
    setSelectedSandboxId(null);
    showToast('Signed out successfully');
  };

  const handleCopyMessage = (content: string, id: string) => {
    navigator.clipboard.writeText(content);
    setCopiedMessageId(id);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  const handleStartEdit = (msg: ChatMessage) => {
    setEditingMessageId(msg.id);
    setEditMessageContent(msg.content);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditMessageContent('');
  };

  const handleSaveEdit = async (msgId: string) => {
    if (!editMessageContent.trim()) return;
    const newPrompt = editMessageContent.trim();
    setEditingMessageId(null);
    setEditMessageContent('');

    // Truncate: keep all messages up to (and including) the edited one, updating its content.
    // All subsequent assistant turns and subsequent user prompts are discarded.
    const msgIdx = messages.findIndex((m) => m.id === msgId);
    if (msgIdx === -1) return;

    const updatedUserMsg: ChatMessage = {
      ...messages[msgIdx],
      content: newPrompt,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const truncatedHistory = [...messages.slice(0, msgIdx), updatedUserMsg];
    setMessages(truncatedHistory);

    const activeSessionId = currentSessionId || `sess_${Date.now()}`;
    if (!currentSessionId) {
      setCurrentSessionId(activeSessionId);
    }

    // Immediately update sessions state and storage so the truncated state is immediately reflected
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === activeSessionId);
      if (idx >= 0) {
        const updated = [...prev];
        const targetSession: ChatSessionDetails = {
          ...updated[idx],
          updatedAt: new Date().toISOString(),
          messages: truncatedHistory,
          messageCount: hasMoreEarlierMessages ? remainingMessageCount + truncatedHistory.length : truncatedHistory.length,
          overwriteMessages: !hasMoreEarlierMessages,
          truncateAfterMessageId: msgId,
        };
        updated[idx] = targetSession;
        sessionSyncService.saveSession(targetSession, currentUser?.id).catch(() => {});
        return updated;
      }
      return prev;
    });

    // Re-send using the truncated history (no extra user message appended)
    await handleSendMessage(newPrompt, truncatedHistory, undefined, {
      isTruncated: true,
      truncateAfterMessageId: msgId,
    });
  };

  const handleSendMessage = async (
    promptText: string,
    customHistory?: ChatMessage[],
    attachedFiles?: AttachedFile[],
    editOptions?: { isTruncated?: boolean; truncateAfterMessageId?: string }
  ) => {
    if (!currentUser) {
      setIsAuthModalOpen(true);
      return;
    }

    if (!isAnyCliLinked) {
      setIsAuthModalOpen(true);
      showToast('Please link an AI CLI (Antigravity, Claude, or Codex) before sending a message.');
      return;
    }

    if (!isModelLinked) {
      setIsAuthModalOpen(true);
      showToast(`Please link the required CLI for ${selectedModelOption?.name || 'this model'} before sending a message.`);
      return;
    }

    if (!activeSandbox || !activeSandbox.sandboxId) {
      showToast('Please select or start a cloud sandbox from the top bar before sending a prompt.');
      const menuBtn = document.getElementById('cloud-sandboxes-menu-button');
      if (menuBtn) {
        menuBtn.click();
      }
      return;
    }

    const activeSessionId = currentSessionId || `sess_${Date.now()}`;
    if (!currentSessionId) {
      setCurrentSessionId(activeSessionId);
    }

    let newMessages: ChatMessage[];
    let userMsgId: string | undefined;

    if (customHistory) {
      // Re-send after an edit: history already contains the updated user message.
      // Don't append a new user bubble — just use the provided truncated history.
      newMessages = customHistory;
      setMessages(newMessages);
    } else {
      userMsgId = `usr_${Date.now()}`;
      const userMsg: ChatMessage = {
        id: userMsgId,
        role: 'user',
        author: currentUser.name,
        authorBadge: 'YOU',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        avatarUrl: currentUser.avatarUrl || '',
        content: promptText,
      };
      newMessages = [...messages, userMsg];
      setMessages(newMessages);
    }

    const sessionTitle = promptText.length > 36 ? promptText.slice(0, 36) + '...' : promptText;
    const isTruncated = Boolean(editOptions?.isTruncated || customHistory);
    const truncateAfterId = editOptions?.truncateAfterMessageId;

    // Immediately register or update the session in local state & cache so it appears in the sidebar
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === activeSessionId);
      let updated: ChatSessionDetails[];
      let targetSession: ChatSessionDetails;
      if (idx >= 0) {
        updated = [...prev];
        targetSession = {
          ...updated[idx],
          updatedAt: new Date().toISOString(),
          messages: newMessages,
          messageCount: Math.max(
            updated[idx]?.messageCount ?? 0,
            hasMoreEarlierMessages ? remainingMessageCount + newMessages.length : newMessages.length
          ),
          overwriteMessages: isTruncated || !hasMoreEarlierMessages,
          truncateAfterMessageId: truncateAfterId,
        };
        updated[idx] = targetSession;
      } else {
        targetSession = {
          id: activeSessionId,
          title: sessionTitle,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: newMessages,
          messageCount: hasMoreEarlierMessages ? remainingMessageCount + newMessages.length : newMessages.length,
          overwriteMessages: isTruncated || !hasMoreEarlierMessages,
          truncateAfterMessageId: truncateAfterId,
        };
        updated = [targetSession, ...prev];
      }
      return updated;
    });

    setIsLoading(true);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Single-call flow: backend handles sandbox attachment & auto-reconnect via Phase 4
    const currentModelOpt = selectedModelOption;
    const modelDisplayName = currentModelOpt.name;

    const syncSession = (msgs: ChatMessage[]) => {
      const sessionTitle = promptText.length > 36 ? promptText.slice(0, 36) + '...' : promptText;
      const isTruncated = Boolean(editOptions?.isTruncated || customHistory);
      const truncateAfterId = editOptions?.truncateAfterMessageId;

      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === activeSessionId);
        let updated: ChatSessionDetails[];
        let targetSession: ChatSessionDetails;
        if (idx >= 0) {
          updated = [...prev];
          targetSession = {
            ...updated[idx],
            updatedAt: new Date().toISOString(),
            messages: msgs,
            messageCount: Math.max(
              updated[idx]?.messageCount ?? 0,
              hasMoreEarlierMessages ? remainingMessageCount + msgs.length : msgs.length
            ),
            overwriteMessages: isTruncated || !hasMoreEarlierMessages,
            truncateAfterMessageId: truncateAfterId,
          };
          updated[idx] = targetSession;
        } else {
          targetSession = {
            id: activeSessionId,
            title: sessionTitle,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: msgs,
            messageCount: hasMoreEarlierMessages ? remainingMessageCount + msgs.length : msgs.length,
            overwriteMessages: isTruncated || !hasMoreEarlierMessages,
            truncateAfterMessageId: truncateAfterId,
          };
          updated = [targetSession, ...prev];
        }
        return updated;
      });
    };

    const assistantId = `ast_${Date.now()}`;
    setStreamingMessageId(assistantId);

    const initialAssistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      author: modelDisplayName,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      modelBadge: modelDisplayName,
      sandboxName: activeSandbox?.name,
      latency: 'Streaming...',
      avatarUrl: '',
      content: '',
      steps: [
        {
          id: 'step_init',
          text: 'Connecting to cloud sandbox microVM & initializing agent...',
          duration: '...',
          completed: false,
        },
      ],
    };

    setMessages([...newMessages, initialAssistantMsg]);

    try {
      const res = await apiFetch('/api/v1/agent/prompt/stream', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: activeSessionId,
          sandboxId: activeSandbox?.sandboxId,
          userId: currentUser?.id,
          userMessageId: userMsgId,
          truncateAfterMessageId: editOptions?.truncateAfterMessageId,
          prompt: promptText,
          selectedModel: selectedModel,
          files: attachedFiles?.map((f) => ({
            name: f.name,
            size: f.size,
            type: f.type,
            content: f.content,
            base64: f.base64,
          })),
          messages: (() => {
            if (newMessages.length <= 20) {
              return newMessages.map((m) => ({ role: m.role, content: m.content }));
            }
            // Keep initial prompt anchor + last 18 messages
            const first = newMessages[0];
            const recent = newMessages.slice(-18);
            return [first, ...recent].map((m) => ({ role: m.role, content: m.content }));
          })(),
        }),
      });

      if (res.status === 429) {
        const json = await res.json().catch(() => null);
        const retryAfter =
          json?.error?.details?.resetInSeconds ||
          json?.error?.details?.retryAfter ||
          60;
        setRateLimit({
          limit: json?.error?.details?.limit || 1000,
          remaining: 0,
          resetInSeconds: retryAfter,
        });

        const rateLimitMsg: ChatMessage = {
          id: assistantId,
          role: 'assistant',
          author: modelDisplayName,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          modelBadge: modelDisplayName,
          sandboxName: activeSandbox?.name,
          latency: '429 Rate Limit',
          avatarUrl: '',
          content: `⏱️ **Provider Rate Limit / Concurrency Threshold Reached**\n\nThe request rate limit for **${modelDisplayName}** was reached.\n\nPlease wait **${retryAfter} seconds** before submitting your next prompt.`,
          steps: [
            {
              id: 's_rl_1',
              text: `Rate limit threshold reached for ${modelDisplayName}`,
              duration: '1ms',
              completed: false,
            },
            {
              id: 's_rl_2',
              text: `Cooldown window active (${retryAfter}s remaining)`,
              duration: `${retryAfter}s`,
              completed: false,
            },
          ],
          executionResult: {
            time: '1ms',
            sandboxId: 'rate-limiter',
            statusText: 'HTTP 429 TOO MANY REQUESTS • Cooldown Active',
          },
        };

        setMessages((prev) => {
          const updated = prev.map((m) => (m.id === assistantId ? rateLimitMsg : m));
          syncSession(updated);
          return updated;
        });
        showToast(`Rate limit reached. Please wait ${retryAfter}s`);
        return;
      }

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const block of parts) {
            if (!block.trim()) continue;
            let event = 'message';
            let dataStr = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event: ')) {
                event = line.replace('event: ', '').trim();
              } else if (line.startsWith('data: ')) {
                dataStr = line.replace('data: ', '').trim();
              }
            }

            if (!dataStr) continue;
            try {
              const data = JSON.parse(dataStr);
              if (event === 'token') {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: m.content + data.token } : m
                  )
                );
              } else if (event === 'step') {
                setMessages((prev) =>
                  prev.map((m) => {
                    if (m.id !== assistantId) return m;
                    const existingSteps = m.steps || [];
                    const stepItem: StepItem = {
                      id: data.id,
                      text: data.description,
                      duration: data.durationMs ? `${data.durationMs}ms` : '...',
                      completed: data.status === 'completed',
                      status: data.status,
                      tool: data.tool,
                      command: data.command,
                      output: data.output,
                      exitCode: data.exitCode,
                    };
                    const idx = existingSteps.findIndex((s) => s.id === data.id);
                    let newSteps: StepItem[];
                    if (idx >= 0) {
                      newSteps = [...existingSteps];
                      newSteps[idx] = { ...existingSteps[idx], ...stepItem };
                    } else {
                      newSteps = [...existingSteps, stepItem];
                    }
                    return { ...m, steps: newSteps };
                  })
                );
              } else if (event === 'done') {
                const serverMsg = data.message;
                const finalAssistantMsg: ChatMessage = {
                  id: serverMsg.id,
                  role: 'assistant',
                  author: serverMsg.authorName,
                  time: serverMsg.timestamp,
                  modelBadge: modelDisplayName,
                  sandboxName: activeSandbox?.name,
                  latency: serverMsg.latencyMs
                    ? `Latency: ${serverMsg.latencyMs.toLocaleString()}ms`
                    : '',
                  avatarUrl: '',
                  content: serverMsg.content,
                  codeFiles: serverMsg.codeFiles?.map((cf: { filename: string; language?: string; content?: string; code?: string }) => ({
                    filename: cf.filename,
                    icon: cf.language === 'python' ? 'code' : cf.language === 'json' ? 'data_object' : 'javascript',
                    code: cf.content || cf.code || '',
                  })),
                  steps: (serverMsg.steps || []).map((s: { id: string; description: string; durationMs: number; status?: 'pending' | 'in_progress' | 'completed' | 'failed'; tool?: string; command?: string; output?: string; exitCode?: number }) => ({
                    id: s.id,
                    text: s.description,
                    duration: `${s.durationMs}ms`,
                    completed: s.status === 'completed',
                    status: s.status,
                    tool: s.tool,
                    command: s.command,
                    output: s.output,
                    exitCode: s.exitCode,
                  })),
                  executionResult: serverMsg.executionResult ? {
                    time: `${serverMsg.executionResult.durationMs}ms`,
                    sandboxId: serverMsg.executionResult.sandboxId,
                    statusText: `${serverMsg.executionResult.status} • ${serverMsg.executionResult.details}`,
                  } : undefined,
                };

                setMessages((prev) => {
                  const updated = prev.map((m) => (m.id === assistantId ? finalAssistantMsg : m));
                  syncSession(updated);
                  return updated;
                });

                if (data.rateLimit) {
                  setRateLimit({
                    limit: data.rateLimit.limit,
                    remaining: data.rateLimit.remaining,
                    resetInSeconds: data.rateLimit.resetInSeconds,
                  });
                }
                // Ingest single-call piggybacked live quotas and sandbox usage
                if (data.codexQuota) {
                  setCodexQuota(data.codexQuota);
                }
                if (data.geminiQuota) {
                  setGeminiQuota(data.geminiQuota);
                }
                if (data.sandboxUsage) {
                  setSandboxUsage(data.sandboxUsage);
                }
              } else if (event === 'error') {
                const errMsg = data.message || 'Execution error';
                if (data.code === 'CLI_NOT_LINKED' || errMsg.toLowerCase().includes('requires an active') || errMsg.toLowerCase().includes('subscription link')) {
                  setIsAuthModalOpen(true);
                }
                const errorMsg: ChatMessage = {
                  id: assistantId,
                  role: 'assistant',
                  author: modelDisplayName,
                  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  modelBadge: modelDisplayName,
                  sandboxName: activeSandbox?.name,
                  latency: 'Error',
                  avatarUrl: '',
                  content: `⚠️ **Execution Error**\n\n${errMsg}`,
                  steps: [
                    { id: 's_err', text: errMsg, duration: '0ms', completed: false },
                  ],
                  executionResult: {
                    time: '0ms',
                    sandboxId: 'none',
                    statusText: `ERROR • ${errMsg}`,
                  },
                };
                setMessages((prev) => {
                  const updated = prev.map((m) => (m.id === assistantId ? errorMsg : m));
                  syncSession(updated);
                  return updated;
                });
                showToast(errMsg);
              }
            } catch (pErr) {
              console.error('Failed to parse SSE event', pErr);
            }
          }
        }
      } else {
        const errJson = await res.json().catch(() => null);
        const errMsg = errJson?.error?.message || errJson?.message || 'Streaming failed';
        const errorMsg: ChatMessage = {
          id: assistantId,
          role: 'assistant',
          author: modelDisplayName,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          modelBadge: modelDisplayName,
          latency: 'Error',
          avatarUrl: '',
          content: `⚠️ **Execution Error**\n\n${errMsg}`,
          steps: [
            { id: 's_err', text: errMsg, duration: '0ms', completed: false },
          ],
          executionResult: {
            time: '0ms',
            sandboxId: 'none',
            statusText: `HTTP ${res.status} • ${errMsg}`,
          },
        };
        setMessages((prev) => {
          const updated = prev.map((m) => (m.id === assistantId ? errorMsg : m));
          syncSession(updated);
          return updated;
        });
        showToast(errMsg);
        return;
      }
    } catch (err: unknown) {
      const errorObj = err as { name?: string };
      if (errorObj?.name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      const fallbackAssistantMsg: ChatMessage = {
        id: `asst_${Date.now()}`,
        role: 'assistant',
        author: 'Atelier Assistant',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelBadge: modelDisplayName,
        latency: 'Latency: 198ms',
        avatarUrl: '',
        content: `⚠️ **Connection Error**\n\nFailed to reach the cloud orchestration backend (${import.meta.env.VITE_API_URL || 'http://localhost:4000'}). Please ensure the API server is active and try again.`,
        steps: [
          { id: 's1', text: `Attempted connection to ${import.meta.env.VITE_API_URL || 'localhost:4000'}`, duration: '0ms', completed: false },
          { id: 's2', text: 'Network request failed', duration: '0ms', completed: false },
        ],
        executionResult: {
          time: '0ms',
          sandboxId: 'none',
          statusText: 'ERR_CONNECTION_REFUSED',
        },
      };
      setMessages((prev) => {
        const updated = prev.map((m) => (m.id === assistantId ? fallbackAssistantMsg : m));
        syncSession(updated);
        return updated;
      });
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsLoading(false);
      setStreamingMessageId(null);
      fetchQuota(true);
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (currentSessionId) {
      apiFetch('/api/v1/agent/stop', {
        method: 'POST',
        body: JSON.stringify({ sessionId: currentSessionId }),
      }).catch((err) => {
        console.warn('Failed to dispatch stop signal to backend', err);
      });
    }

    if (streamingMessageId) {
      setMessages((prev) => {
        const updated = prev.map((m) => {
          if (m.id !== streamingMessageId) return m;
          const currentContent = m.content.trim();
          return {
            ...m,
            latency: 'Stopped',
            content: currentContent ? currentContent : '*(Generation stopped by user)*',
            steps: (m.steps || []).map((s) => ({
              ...s,
              completed: true,
              duration: s.completed ? s.duration : 'Stopped',
            })),
          };
        });
        if (currentSessionId) {
          setSessions((sPrev) => {
            const idx = sPrev.findIndex((s) => s.id === currentSessionId);
            if (idx >= 0) {
              const u = [...sPrev];
              u[idx] = { ...u[idx], messages: updated, updatedAt: new Date().toISOString() };
              sessionSyncService.saveSession(u[idx], currentUser?.id).catch(() => {});
              return u;
            }
            return sPrev;
          });
        }
        return updated;
      });
    }

    setIsLoading(false);
    setStreamingMessageId(null);
    showToast('Generation stopped');
  };

  const handleShareSession = () => {
    navigator.clipboard.writeText(window.location.href);
    showToast('Session link copied to clipboard');
  };

  const handleExportLogs = () => {
    const blob = new Blob([JSON.stringify(messages, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atelier-session-${Date.now()}.json`;
    a.click();
    showToast('Session logs exported');
  };

  return (
    <div className="bg-background font-body-md text-body-md text-on-surface antialiased min-h-screen transition-colors duration-300">
      {/* Full-Page Initial & Post-Sign-In Loading Screen with 3D Rotating Isometric Cube */}
      {isPageLoading && (
        <LoadingScreen
          message={loadingMessage}
          subMessage={loadingSubMessage}
        />
      )}

      {/* Toast Alert */}
      {toastMessage && (
        <div className={`fixed top-16 right-4 sm:right-10 ${isInspectorOpen ? 'xl:right-[400px]' : 'xl:right-10'} z-50 px-space-md py-space-xs rounded-lg bg-surface-container-high border border-primary/40 text-on-surface shadow-2xl text-body-sm flex items-center gap-2 animate-bounce transition-all duration-300`}>
          <span className="material-symbols-outlined text-[16px] text-primary shrink-0 leading-none select-none">info</span>
          <span className="leading-none">{toastMessage}</span>
        </div>
      )}

      {/* AI Platform Auth & Linking Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => {
          setIsAuthModalOpen(false);
          refreshCliStatus();
        }}
        currentUser={currentUser}
        onGoogleLogin={handleGoogleLogin}
        onLinkSubscription={handleLinkSubscription}
        onConnectApiKey={handleConnectApiKey}
        initialCliStatus={cliStatus}
        onCliStatusChange={handleCliStatusChange}
      />

      {/* Left Sidebar (Mobile Drawer & Desktop Sidebar) */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onNewSession={handleNewSession}
        isSyncing={isSyncingSessions}
        onRefreshSessions={syncSessions}
      />

      {/* Center Layout Container with Mobile & Desktop Dynamic Responsive Margins */}
      <div className={`pl-0 pr-0 lg:pl-[260px] ${isInspectorOpen ? 'xl:pr-[380px]' : 'xl:pr-0'} min-h-screen flex flex-col transition-all duration-300`}>
        {/* Top Header */}
        <Header
          user={currentUser}
          tokenUsage={tokenUsage}
          modelName={selectedModelOption?.name || selectedModel}
          selectedModel={selectedModel}
          selectedModelOption={selectedModelOption}
          isModelLinked={isModelLinked}
          activeProvider={
            selectedModelOption?.hostedBy === 'antigravity'
              ? 'gemini'
              : selectedModelOption?.provider || 'gemini'
          }
          sandboxName={activeSandbox?.name}
          sandboxUsage={sandboxUsage}
          activeSandbox={activeSandbox}
          onRefreshSandboxUsage={fetchSandboxUsage}
          onRefreshQuota={handleRefreshQuota}
          currentPath={
            currentSessionId
              ? `chats / ${sessions.find((s) => s.id === currentSessionId)?.title || 'session'}`
              : 'workspaces / chats / new-session'
          }
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
          onLogout={handleLogout}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          isInspectorOpen={isInspectorOpen}
          onToggleInspector={() => setIsInspectorOpen(!isInspectorOpen)}
          isDarkMode={isDarkMode}
          onToggleTheme={handleToggleTheme}
          currentSessionId={currentSessionId}
          onSandboxChanged={(newSandboxId, updatedUsage) => {
            setSelectedSandboxId(newSandboxId || null);
            if (updatedUsage) {
              setSandboxUsage(updatedUsage);
            }
            showToast('Sandbox workspace synchronized');
          }}
        />

        {/* Main Workstation Canvas */}
        <main className="relative pt-14 h-screen bg-background flex-1 flex flex-col">
          <div className="flex flex-col w-full flex-1 min-h-0">
            {/* Sub-Header Operations Ribbon */}
            <Ribbon
              onShareSession={handleShareSession}
              onExportLogs={handleExportLogs}
            />

            {/* Central Interactive Chat Stream or Empty State Hero */}
            {messages.length === 0 ? (
              <div className="flex-1 w-full max-w-4xl mx-auto px-4 flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-lg mb-4 sm:mb-6">
                  <span className="material-symbols-outlined text-[32px] sm:text-[36px]">
                    smart_toy
                  </span>
                </div>

                {isSyncingSessions && (
                  <div className="mb-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/25 text-primary text-xs font-medium animate-pulse">
                    <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>
                    <span>Syncing cloud conversations & workspace...</span>
                  </div>
                )}

                <h1 className="font-headline-lg text-headline-lg text-on-surface font-semibold tracking-tight text-xl sm:text-3xl mb-2 sm:mb-3">
                  {currentUser ? `Welcome back, ${currentUser.name}` : 'What do you want to build or run?'}
                </h1>

                <p className="font-body-lg text-body-lg text-on-surface-variant max-w-xl text-sm sm:text-base">
                  Select across multiple AI providers and frontier models to synthesize code, run agents, and execute in secure cloud sandboxes.
                </p>

                {/* Sandbox Status & Action in Hero */}
                {currentUser && (
                  activeSandbox ? (
                  <div className="mt-6 flex items-center justify-between sm:justify-start gap-2.5 px-3 sm:px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium animate-in fade-in duration-200 max-w-full">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                      <span className="truncate">{activeSandbox.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsInspectorOpen(true)}
                      className="ml-auto sm:ml-2 text-primary hover:underline text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0 inline-flex items-center gap-1"
                    >
                      Open Inspector &rarr;
                    </button>
                  </div>
                ) : currentUser && sandboxUsage?.sandboxes && sandboxUsage.sandboxes.length > 0 ? (
                  /* At least one cloud VM is already initialized in the user's account */
                  <div className="mt-6 flex flex-col items-center gap-3 animate-in fade-in duration-200 max-w-xl">
                    <p className="text-xs text-outline font-medium text-center">
                      Cloud microVM ready. Attach this session to an active workspace:
                    </p>

                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {sandboxUsage.sandboxes.map((sb) => {
                        return (
                          <button
                            key={sb.sandboxId}
                            type="button"
                            onClick={() => handleAttachExistingSandbox(sb.sandboxId)}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-container-high hover:bg-surface-container-highest border border-primary/30 hover:border-primary text-on-surface text-xs font-semibold shadow-xs transition-all cursor-pointer active:scale-95 group"
                            title={`Connect this chat to ${sb.name} (${sb.sandboxId})`}
                          >
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            <span>Connect to {sb.name}</span>
                            <span className="material-symbols-outlined text-[13px] text-primary group-hover:translate-x-0.5 transition-transform">
                              arrow_forward
                            </span>
                          </button>
                        );
                      })}

                      {sandboxUsage.used < sandboxUsage.max ? (
                        <button
                          type="button"
                          onClick={handleStartSandboxVM}
                          disabled={isStartingSandbox}
                          className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-outline-variant/30 hover:border-outline-variant/60 bg-surface-container hover:bg-surface-container-high text-xs font-medium text-on-surface-variant hover:text-on-surface transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                          title="Start another isolated cloud sandbox microVM"
                        >
                          {isStartingSandbox ? (
                            <>
                              <span className="material-symbols-outlined text-[14px] animate-spin text-primary">progress_activity</span>
                              <span>Booting...</span>
                            </>
                          ) : (
                            <>
                              <span className="material-symbols-outlined text-[15px] text-primary">add_circle</span>
                              <span>+ New Sandbox</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => document.getElementById('cloud-sandboxes-menu-button')?.click()}
                          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-outline-variant/30 hover:border-outline-variant/60 bg-surface-container hover:bg-surface-container-high text-xs font-medium text-outline hover:text-on-surface transition-all cursor-pointer"
                          title="Open Cloud Sandboxes menu to manage or delete sandboxes"
                        >
                          <span className="material-symbols-outlined text-[15px]">delete_sweep</span>
                          <span>Free a Slot</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  /* No sandboxes initialized yet: Render Start Sandbox VM button without subtitle */
                  <div className="mt-6 flex flex-col items-center gap-3 animate-in fade-in duration-200">
                    <button
                      type="button"
                      onClick={handleStartSandboxVM}
                      disabled={isStartingSandbox}
                      className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-fixed-dim text-on-primary text-xs font-semibold shadow-md hover:shadow-lg transition-all cursor-pointer active:scale-95 disabled:opacity-60"
                    >
                      {isStartingSandbox ? (
                        <>
                          <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                          <span>Provisioning Cloud MicroVM...</span>
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-[18px]">bolt</span>
                          <span>Start Sandbox VM</span>
                        </>
                      )}
                    </button>
                  </div>
                  )
                )}
              </div>
            ) : (
              <div className="flex-1 w-full max-w-5xl mx-auto px-3 sm:px-margin-desktop py-space-md sm:py-space-xl flex flex-col gap-space-lg sm:gap-space-xl">
                {hasMoreEarlierMessages && (
                  <div className="w-full flex justify-center py-1 animate-in fade-in duration-200">
                    <button
                      type="button"
                      onClick={handleLoadEarlierMessages}
                      disabled={isLoadingEarlierMessages}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-container-high/90 hover:bg-surface-container-highest border border-outline-variant/40 hover:border-primary/50 text-on-surface-variant hover:text-on-surface text-xs font-medium shadow-sm hover:shadow transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed group active:scale-98"
                      title="Load older messages from this conversation"
                    >
                      {isLoadingEarlierMessages ? (
                        <>
                          <span className="material-symbols-outlined text-[16px] text-primary animate-spin">
                            progress_activity
                          </span>
                          <span>Fetching earlier messages...</span>
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-[16px] text-primary transition-transform group-hover:-translate-y-0.5">
                            arrow_upward
                          </span>
                          <span>
                            Load earlier messages
                            {remainingMessageCount > 0 ? (
                              <span className="ml-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-mono font-semibold border border-primary/20">
                                {remainingMessageCount} remaining
                              </span>
                            ) : null}
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                )}
                {messages.map((msg) => {
                  if (msg.role === 'user') {
                    if (editingMessageId === msg.id) {
                      return (
                        <div key={msg.id} className="flex justify-end w-full animate-in fade-in duration-150">
                          <div className="w-full max-w-[85%] sm:max-w-[70%] rounded-2xl bg-surface-container-high border border-primary/40 shadow-lg p-3 sm:p-4">
                            <textarea
                              rows={3}
                              value={editMessageContent}
                              onChange={(e) => setEditMessageContent(e.target.value)}
                              onKeyDown={(e) => {
                                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveEdit(msg.id);
                                }
                              }}
                              className="w-full bg-surface-container-lowest text-on-surface font-body-md text-sm sm:text-[15px] p-2.5 rounded-xl border border-outline-variant/30 focus:border-primary focus:outline-none resize-none leading-relaxed"
                              autoFocus
                            />
                            <div className="flex items-center justify-end gap-2 mt-2.5">
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="px-3 py-1 rounded-lg text-xs font-medium text-outline hover:text-on-surface hover:bg-surface-container-highest transition-colors cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(msg.id)}
                                disabled={!editMessageContent.trim() || isLoading}
                                className="flex items-center gap-1.5 px-3.5 py-1 rounded-lg bg-primary hover:bg-primary-fixed-dim text-on-primary font-medium text-xs shadow-xs transition-all cursor-pointer disabled:opacity-50"
                              >
                                <span>Send</span>
                                <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={msg.id} className="flex justify-end group w-full">
                        <div className="max-w-[80%] sm:max-w-[65%] flex flex-col items-end">
                          {/* User bubble with optional attachment chips */}
                          {(() => {
                            const parsed = parseUserMessageContent(msg.content);
                            return (
                              <div className="w-fit rounded-2xl bg-surface-container-high text-on-surface px-4 py-2 sm:px-4 sm:py-2.5 shadow-xs border border-outline-variant/15 max-w-full">
                                {/* Attachment chip shelf — mirrors the PromptBar file preview */}
                                {parsed.attachments.length > 0 && (
                                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-outline-variant/15 overflow-x-auto scrollbar-thin flex-wrap">
                                    {parsed.attachments.map((att, i) => (
                                      <div
                                        key={i}
                                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-container-highest border border-outline-variant/20 shrink-0"
                                      >
                                        {(() => {
                                          const { icon, colorClass } = getAttachmentIcon(att.name);
                                          return (
                                            <span className={`material-symbols-outlined text-[15px] ${colorClass}`}>
                                              {icon}
                                            </span>
                                          );
                                        })()}
                                        <span className="font-mono text-xs font-medium max-w-[140px] sm:max-w-[200px] truncate text-on-surface">
                                          {att.name}
                                        </span>
                                        {att.size && (
                                          <span className="text-[10px] text-outline font-mono">({att.size})</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {/* Prompt text (may be empty if the message was files-only) */}
                                {parsed.text && (
                                  <p className="font-body-md text-on-surface leading-relaxed text-sm sm:text-[15px] whitespace-pre-wrap select-text break-words">
                                    {parsed.text}
                                  </p>
                                )}
                              </div>
                            );
                          })()}

                          {/* Action tray below user chat bubble: Copy and Edit (icon-only) */}
                          <div className="flex items-center gap-1 pt-1 pr-1 text-outline">
                            <span className="font-code-sm text-code-sm text-[10px] mr-1">
                              {msg.time}
                            </span>

                            {/* Edit button (icon-only) */}
                            <button
                              type="button"
                              onClick={() => handleStartEdit(msg)}
                              disabled={isLoading}
                              className="p-1 rounded-md text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer disabled:opacity-50"
                              title="Edit prompt"
                              aria-label="Edit prompt"
                            >
                              <span className="material-symbols-outlined text-[15px]">edit</span>
                            </button>

                            {/* Copy button (icon-only) */}
                            <button
                              type="button"
                              onClick={() => handleCopyMessage(msg.content, msg.id)}
                              className={`p-1 rounded-md transition-colors cursor-pointer ${
                                copiedMessageId === msg.id
                                  ? 'text-emerald-500 bg-emerald-500/10'
                                  : 'text-outline hover:text-on-surface hover:bg-surface-container-high'
                              }`}
                              title={copiedMessageId === msg.id ? 'Copied to clipboard' : 'Copy prompt text'}
                              aria-label={copiedMessageId === msg.id ? 'Copied' : 'Copy prompt text'}
                            >
                              <span className="material-symbols-outlined text-[15px]">
                                {copiedMessageId === msg.id ? 'check' : 'content_copy'}
                              </span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );

                  }

                  return (
                    <div key={msg.id} className="w-full space-y-space-md sm:space-y-space-lg">
                      {/* Assistant Meta Header */}
                      <div className="flex flex-wrap items-center justify-between gap-space-xs">
                        <div className="flex flex-wrap items-center gap-space-sm">
                          {(() => {
                            const effectiveModelBadge =
                              msg.modelBadge ||
                              (msg.role === 'assistant' && msg.author && msg.author !== 'Atelier Assistant' ? msg.author : undefined) ||
                              (msg.role === 'assistant' && msg.authorName && msg.authorName !== 'Atelier Assistant' ? msg.authorName : undefined) ||
                              (msg.role === 'assistant' && msg.modelUsed && msg.modelUsed !== 'Atelier Assistant' ? msg.modelUsed : undefined);

                            if (effectiveModelBadge) {
                              const badgeLower = effectiveModelBadge.toLowerCase();
                              return (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-primary/10 text-primary font-medium border border-primary/20 text-xs sm:text-sm">
                                  {badgeLower.includes('none') ? (
                                    <span className="material-symbols-outlined text-[14px] text-outline">tune</span>
                                  ) : badgeLower.includes('claude') ? (
                                    <img src="/provider-icons/claude.svg" alt="" className="w-3.5 h-3.5 object-contain" />
                                  ) : badgeLower.includes('gpt') || badgeLower.includes('codex') || badgeLower.startsWith('o') ? (
                                    <img src="/model-icons/openai.svg" alt="" className="w-3.5 h-3.5 object-contain" />
                                  ) : badgeLower.includes('gemini') ? (
                                    <img src="/model-icons/google-gemini.svg" alt="" className="w-3.5 h-3.5 object-contain" />
                                  ) : (
                                    <img src="/provider-icons/antigravity.svg" alt="" className="w-3.5 h-3.5 object-contain" />
                                  )}
                                  {effectiveModelBadge}
                                </span>
                              );
                            }

                            return (
                              <span className="font-headline-sm text-headline-sm text-on-surface font-semibold text-sm sm:text-base">
                                {msg.author || msg.authorName || 'Atelier Assistant'}
                              </span>
                            );
                          })()}

                          {/* Sandbox MicroVM Environment Badge right next to model */}
                          {(() => {
                            const displaySandboxName =
                              msg.sandboxName ||
                              (msg.executionResult?.sandboxId && msg.executionResult.sandboxId !== 'none'
                                ? (sandboxUsage?.sandboxes?.find((s) => s.sandboxId === msg.executionResult?.sandboxId)?.name ||
                                   `Sandbox (${msg.executionResult.sandboxId.substring(0, 6)})`)
                                : activeSandbox?.name);
                            if (!displaySandboxName) return null;
                            return (
                              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-on-surface-variant bg-surface-container-highest/60 px-2 py-0.5 rounded border border-outline-variant/30">
                                <span className="material-symbols-outlined text-[13px] text-primary">cloud</span>
                                {displaySandboxName}
                              </span>
                            );
                          })()}
                        </div>
                        <span className="font-code-sm text-code-sm text-outline text-xs">
                          {(
                            msg.latency ||
                            (typeof msg.latencyMs === 'number' && msg.latencyMs > 0
                              ? `Latency: ${msg.latencyMs.toLocaleString()}ms`
                              : '')
                          )?.replace(/(?:Latency:\s*)?\d+(?:\.\d+)?s\s*\(([\d,]+ms)\)/i, 'Latency: $1')}
                        </span>
                      </div>

                      {/* Live Step Accordion */}
                      {msg.steps && msg.steps.length > 0 && (
                        <Accordion
                          steps={msg.steps}
                          isExecuting={isLoading && streamingMessageId === msg.id}
                          sandboxName={activeSandbox?.name}
                        />
                      )}

                      {/* Assistant Response Content - Clean ChatGPT-like borderless presentation */}
                      {msg.content ? (
                        <div className="text-on-surface leading-relaxed space-y-space-sm py-1 select-text">
                          <MarkdownContent content={msg.content} />
                          {isLoading && streamingMessageId === msg.id && (
                            <span className="inline-block w-2 h-4 ml-1 bg-primary/70 animate-pulse rounded-xs align-middle" />
                          )}

                          {msg.explanationPoints && msg.explanationPoints.length > 0 && (
                            <ul className="space-y-space-xs list-disc pl-space-lg text-on-surface-variant mt-3 pt-3 border-t border-outline-variant/10">
                              {msg.explanationPoints.map((point, pIdx) => {
                                const colonIdx = point.indexOf(':');
                                if (colonIdx > 0) {
                                  return (
                                    <li key={pIdx}>
                                      <strong className="text-on-surface">
                                        {point.slice(0, colonIdx)}:
                                      </strong>
                                      {point.slice(colonIdx + 1)}
                                    </li>
                                  );
                                }
                                return <li key={pIdx}>{point}</li>;
                              })}
                            </ul>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                {/* Physical scroll clearance spacer so the bottom-most message content is never obscured by the fixed PromptBar */}
                <div className="h-64 sm:h-72 w-full shrink-0 pointer-events-none" aria-hidden="true" />
              </div>
            )}

            {/* Fixed Chat Input Prompt Bar regardless of scroll */}
            <div className={`fixed bottom-0 left-0 right-0 lg:left-[260px] ${isInspectorOpen ? 'xl:right-[380px]' : 'xl:right-0'} z-30 pointer-events-none bg-gradient-to-t from-background via-background/95 to-transparent pt-6 pb-2 transition-all duration-300`}>
              <div className="pointer-events-auto">
                <PromptBar
                  onSendMessage={(prompt, files) => handleSendMessage(prompt, undefined, files)}
                  onStopGeneration={handleStopGeneration}
                  onClearSession={handleNewSession}
                  onOpenInspector={() => setIsInspectorOpen(true)}
                  onExportSession={handleExportLogs}
                  selectedModel={selectedModel}
                  onSelectModel={handleSelectModel}
                  currentUser={currentUser}
                  cliStatus={cliStatus}
                  isLoading={isLoading}
                  geminiQuota={geminiQuota}
                  codexQuota={codexQuota}
                  availableModels={availableModels}
                  activeSandbox={activeSandbox}
                  sandboxUsage={sandboxUsage}
                  onStartSandboxVM={handleStartSandboxVM}
                  onAttachExistingSandbox={handleAttachExistingSandbox}
                  isStartingSandbox={isStartingSandbox}
                  onRefreshModels={() => refreshModels(true)}
                  onOpenAuthModal={() => setIsAuthModalOpen(true)}
                />
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Right Sidebar Cloud Inspector (Mobile Drawer & Desktop Sidebar) */}
      <CloudInspector
        isOpen={isInspectorOpen}
        onClose={() => setIsInspectorOpen(false)}
        sessionId={currentSessionId || undefined}
        sandboxId={activeSandbox?.sandboxId}
        userId={currentUser?.id}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        refreshTrigger={messages.length}
      />
    </div>
  );
};

export default App;
