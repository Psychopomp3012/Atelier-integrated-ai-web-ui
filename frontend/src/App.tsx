import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
import { firestoreService } from './services/firestore.service';
import { sessionSyncService } from './services/sessionSync.service';
import { fetchCliStatus, refreshAuthToken, closeGeminiCliLoginPopup, type CliStatus } from './services/cliAuth.service';
import { apiFetch } from './utils/api.util';
import type { ModelType, ChatMessage, UserProfile, AIPlatform, ChatSession, RateLimitState, GeminiQuotaStats, CodexQuotaStats, StepItem, ModelOption } from './types';
import { AVAILABLE_MODELS, NONE_MODEL, getModelDisplayInfo, getMinimumEffortModelId } from './types';
import { fetchAvailableModels } from './services/models.service';
import { computeSessionTokens } from './utils/token.util';

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

export const App: React.FC = () => {
  // Session history state - strictly initialized to empty until authenticated user is resolved
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Provider - Model - Effort preference state: initialized from localStorage preference, or 'none'
  const [selectedModel, setSelectedModel] = useState<ModelType>(() => {
    try {
      const saved = localStorage.getItem('model_preference');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed === 'object' && parsed.modelId) {
            return parsed.modelId as ModelType;
          }
        } catch {
          return saved as ModelType;
        }
      }
      const direct = localStorage.getItem('selected_model_preference');
      if (direct) return direct as ModelType;
    } catch {}
    return 'none';
  });

  const [availableModels, setAvailableModels] = useState<ModelOption[]>(AVAILABLE_MODELS);

  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // AI Platform Auth State
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSyncingSessions, setIsSyncingSessions] = useState(false);

  // Persist current session ID to localStorage whenever it changes, strictly scoped per user
  useEffect(() => {
    try {
      if (currentUser?.id) {
        if (currentSessionId) {
          localStorage.setItem(`harness_current_session_id_${currentUser.id}`, currentSessionId);
        } else {
          localStorage.removeItem(`harness_current_session_id_${currentUser.id}`);
        }
      }
    } catch {}
  }, [currentUser?.id, currentSessionId]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // User Message Action States (Copy & Inline Edit)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editMessageContent, setEditMessageContent] = useState<string>('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // Mobile drawer & inspector states (starts open on desktop >= 1280px)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.innerWidth >= 1280;
    } catch {
      return false;
    }
  });

  // Full-page initialization and post-sign-in loading screen
  const [isPageLoading, setIsPageLoading] = useState<boolean>(() => {
    try {
      return Boolean(localStorage.getItem('auth_token'));
    } catch {
      return false;
    }
  });
  const [loadingMessage, setLoadingMessage] = useState('Initializing Atelier Workspace');
  const [loadingSubMessage, setLoadingSubMessage] = useState('Connecting to cloud microVMs & models...');

  // Paginated chat history state
  const [hasMoreEarlierMessages, setHasMoreEarlierMessages] = useState<boolean>(false);
  const [remainingMessageCount, setRemainingMessageCount] = useState<number>(0);
  const [isLoadingEarlierMessages, setIsLoadingEarlierMessages] = useState<boolean>(false);

  // Rate Limiting & Quota State
  const [rateLimit, setRateLimit] = useState<RateLimitState>({
    limit: 1000,
    remaining: 1000,
    resetInSeconds: 0,
  });

  // Real-time Gemini CLI Daily Quota & Session Stats
  const [geminiQuota, setGeminiQuota] = useState<GeminiQuotaStats | null>(null);
  // Real-time Codex CLI Daily Quota & Session Stats
  const [codexQuota, setCodexQuota] = useState<CodexQuotaStats | null>(null);

  // CLI Linkage Status for active model detection
  const [cliStatus, setCliStatus] = useState<CliStatus>({
    gemini: { linked: false },
    claude: { linked: false },
    codex: { linked: false },
  });

  const refreshCliStatus = (force = false) => {
    fetchCliStatus(force).then((status) => {
      setCliStatus(status);
      fetchGeminiQuota(currentSessionId || undefined, force);
      fetchCodexQuota(currentSessionId || undefined, force);
    }).catch(() => {});
  };

  useEffect(() => {
    refreshCliStatus();
  }, [currentUser?.id]);

  // Cloud Sandbox State & Explicit VM Provisioning
  const [sandboxUsage, setSandboxUsage] = useState<{
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
      lastUpdateCheckAt?: number;
      isUpdating?: boolean;
    }>;
  } | null>(null);
  const [isStartingSandbox, setIsStartingSandbox] = useState(false);
  const [isAttachingSandbox, setIsAttachingSandbox] = useState<string | null>(null);
  const [selectedSandboxId, setSelectedSandboxId] = useState<string | null>(() => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return null;
      return localStorage.getItem('harness_selected_sandbox_id') || null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (selectedSandboxId) {
        localStorage.setItem('harness_selected_sandbox_id', selectedSandboxId);
      } else {
        localStorage.removeItem('harness_selected_sandbox_id');
      }
    } catch {}
  }, [selectedSandboxId]);

  const validSessionIds = useMemo(() => sessions.map((s) => s.id), [sessions.map((s) => s.id).join(',')]);
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const isFetchingUsageRef = useRef(false);

  const fetchSandboxUsage = useCallback(async () => {
    if (isFetchingUsageRef.current) return;
    try {
      const u = currentUserRef.current;
      if (!u?.id) {
        setSandboxUsage({ used: 0, max: 3, sandboxes: [] });
        setSelectedSandboxId(null);
        return;
      }
      isFetchingUsageRef.current = true;
      const activeIds = sessionsRef.current.map((s) => s.id).join(',');
      const params = new URLSearchParams();
      params.set('userId', u.id);
      params.set('activeSessionIds', activeIds);
      const url = `/api/v1/sandbox/usage?${params.toString()}`;
      const res = await apiFetch(url);
      const data = await res.json();
      if (data.success && data.data) {
        setSandboxUsage(data.data);
      }
    } catch {} finally {
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
    fetchSandboxUsage();

    // Poll usage and quota telemetry once every 60 seconds only when tab is visible
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchSandboxUsage();
        fetchGeminiQuota(currentSessionId || undefined);
        fetchCodexQuota(currentSessionId || undefined);
      }
    }, 60000);

    const onFocus = () => {
      if (document.visibilityState === 'visible') {
        fetchSandboxUsage();
        fetchGeminiQuota(currentSessionId || undefined);
        fetchCodexQuota(currentSessionId || undefined);
      }
    };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [currentUser?.id, currentSessionId, fetchSandboxUsage]);

  // If the saved sandbox was destroyed or terminated, clean up stale selection
  useEffect(() => {
    if (sandboxUsage?.sandboxes && selectedSandboxId) {
      const stillExists = sandboxUsage.sandboxes.some((s) => s.sandboxId === selectedSandboxId);
      if (!stillExists) {
        setSelectedSandboxId(null);
      }
    } else if (sandboxUsage?.sandboxes && sandboxUsage.sandboxes.length > 0 && !selectedSandboxId) {
      if (currentSessionId) {
        const cleanSession = currentSessionId.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32);
        const attached = sandboxUsage.sandboxes.find((s) => s.attachedSessionIds?.includes(cleanSession));
        if (attached) {
          setSelectedSandboxId(attached.sandboxId);
        }
      }
    }
  }, [sandboxUsage, selectedSandboxId, currentSessionId]);

  const activeSandbox = useMemo(() => {
    if (!currentUser || !sandboxUsage?.sandboxes || sandboxUsage.sandboxes.length === 0) return null;
    if (currentSessionId) {
      const cleanSession = currentSessionId.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32);
      const attached = sandboxUsage.sandboxes.find((s) => s.attachedSessionIds?.includes(cleanSession));
      if (attached) return attached;
    }
    if (selectedSandboxId) {
      const selected = sandboxUsage.sandboxes.find((s) => s.sandboxId === selectedSandboxId);
      if (selected) return selected;
    }
    return null;
  }, [currentUser, sandboxUsage, currentSessionId, selectedSandboxId]);

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
        body: JSON.stringify({ sessionId: cleanSession, userId: currentUser?.id }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.data?.sandboxId) {
          setSelectedSandboxId(data.data.sandboxId);
        }
        await fetchSandboxUsage();
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

  const handleAttachExistingSandbox = async (targetSandboxId: string) => {
    setIsAttachingSandbox(targetSandboxId);
    setSelectedSandboxId(targetSandboxId);
    try {
      if (currentSessionId) {
        const cleanSession = currentSessionId.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32);
        const res = await apiFetch('/api/v1/sandbox/attach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: cleanSession, sandboxId: targetSandboxId }),
        });
        const data = await res.json();
        if (data.success) {
          await fetchSandboxUsage();
          const sbName = sandboxUsage?.sandboxes?.find((s) => s.sandboxId === targetSandboxId)?.name || 'Sandbox';
          showToast(`Connected to ${sbName}`);
        } else {
          showToast(data.error?.message || 'Failed to attach to sandbox');
        }
      } else {
        const sbName = sandboxUsage?.sandboxes?.find((s) => s.sandboxId === targetSandboxId)?.name || 'Sandbox';
        showToast(`Selected ${sbName}`);
      }
    } catch {
      showToast('Failed to select sandbox');
    } finally {
      setIsAttachingSandbox(null);
    }
  };

  const selectedModelOption: ModelOption = useMemo(() => {
    if (selectedModel === 'none') return NONE_MODEL;
    const found = availableModels.find(
      (m) => m.id === selectedModel || m.effortOptions?.some((opt) => opt.modelId === selectedModel)
    );
    if (found) return found;
    return getModelDisplayInfo(selectedModel, availableModels).parentModel;
  }, [selectedModel, availableModels]);

  const isModelLinked = useMemo(() => {
    if (selectedModel === 'none') return true;
    const isAgyLinked = Boolean(
      cliStatus?.antigravity?.linked ||
      cliStatus?.gemini?.linked
    );

    // If the model is hosted by Antigravity (Gemini, Claude, GPT-OSS via AGY CLI), it uses Antigravity account
    if (selectedModelOption?.hostedBy === 'antigravity') {
      return isAgyLinked;
    }

    if (selectedModel.startsWith('gemini-') || selectedModel.startsWith('antigravity-')) {
      return isAgyLinked;
    }
    if (selectedModel.startsWith('claude-')) {
      const isCliSubscription = Boolean(
        cliStatus?.claude?.linked && cliStatus?.claude?.authMethod !== 'api_key'
      );
      const isAccountSubscription = Boolean(
        currentUser?.linkedPlatforms?.some(
          (p) => p.platform === 'claude_subscription' && p.hasValidSession
        )
      );
      return isCliSubscription || isAccountSubscription;
    }
    if (
      selectedModel.startsWith('codex-') ||
      selectedModel.startsWith('gpt-') ||
      selectedModel.startsWith('o1') ||
      selectedModel.startsWith('o3')
    ) {
      return Boolean(
        cliStatus?.codex?.linked ||
        currentUser?.linkedPlatforms?.some(
          (p) => (p.platform === 'codex_subscription' || p.platform === 'openai') && p.hasValidSession
        )
      );
    }
    return isAgyLinked;
  }, [selectedModel, selectedModelOption, cliStatus, currentUser]);

  const isAnyCliLinked = useMemo(() => {
    return Boolean(
      cliStatus?.antigravity?.linked ||
      cliStatus?.gemini?.linked ||
      cliStatus?.claude?.linked ||
      cliStatus?.codex?.linked
    );
  }, [cliStatus]);

  useEffect(() => {
    fetchAvailableModels()
      .then((models) => {
        if (models && models.length > 0) {
          setAvailableModels(models);
          // If a model preference was saved and is available, keep it.
          // If the model was selected and is no longer available, reset to 'none'.
          if (selectedModel !== 'none') {
            const isModelAvailable = models.some(
              (m) => m.id === selectedModel || m.effortOptions?.some((opt) => opt.modelId === selectedModel)
            );
            if (!isModelAvailable) {
              // 1. Check if the base model still exists under the provider with different efforts
              let savedModelName = '';
              try {
                const saved = localStorage.getItem('model_preference');
                if (saved) {
                  const parsed = JSON.parse(saved);
                  savedModelName = parsed?.model || '';
                }
              } catch {}

              const matchedBaseModel = models.find((m) => {
                if (savedModelName && m.name.toLowerCase() === savedModelName.toLowerCase()) return true;
                if (selectedModel.startsWith(m.id)) return true;
                return false;
              });

              if (matchedBaseModel && matchedBaseModel.effortOptions && matchedBaseModel.effortOptions.length > 0) {
                // Graceful migration to lowest/minimum available effort for the same model
                const newModelId = getMinimumEffortModelId(matchedBaseModel);
                handleSelectModel(newModelId);
                showToast(`Reasoning effort updated to available option for ${matchedBaseModel.name}`);
              } else {
                // The model is completely removed from the provider's list
                setSelectedModel('none');
                localStorage.removeItem('model_preference');
                localStorage.removeItem('selected_model_preference');
                showToast('Previously selected model is no longer available. Please select an active model.');
              }
            }
          }
        }
      })
      .catch(() => {});
  }, []);

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

  const lastGeminiQuotaFetchRef = useRef<number>(0);
  const lastCodexQuotaFetchRef = useRef<number>(0);
  const lastQuotaFetchTimeRef = useRef<number>(0);
  const inFlightQuotaPromiseRef = useRef<Promise<void> | null>(null);
  const authMeInFlightRef = useRef<Promise<any> | null>(null);
  const authMeCompletedRef = useRef<boolean>(false);

  const fetchGeminiQuota = async (sessId?: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastGeminiQuotaFetchRef.current < 1500) {
      return;
    }
    lastGeminiQuotaFetchRef.current = now;
    try {
      const emailParam = currentUser?.email ? `?userEmail=${encodeURIComponent(currentUser.email)}` : '';
      const activeId = sessId || currentSessionId;
      const sessionParam = activeId ? `${emailParam ? '&' : '?'}sessionId=${encodeURIComponent(activeId)}` : '';
      const res = await apiFetch(`/api/v1/quota/gemini${emailParam}${sessionParam}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setGeminiQuota(json.data);
        }
      }
    } catch {
      // offline fallback
    }
  };

  const fetchCodexQuota = async (sessId?: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastCodexQuotaFetchRef.current < 1500) {
      return;
    }
    lastCodexQuotaFetchRef.current = now;
    try {
      const emailParam = currentUser?.email ? `?userEmail=${encodeURIComponent(currentUser.email)}` : '';
      const activeId = sessId || currentSessionId;
      const sessionParam = activeId ? `${emailParam ? '&' : '?'}sessionId=${encodeURIComponent(activeId)}` : '';
      const res = await apiFetch(`/api/v1/quota/codex${emailParam}${sessionParam}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setCodexQuota(json.data);
        }
      }
    } catch {
      // offline fallback
    }
  };

  useEffect(() => {
    if (!currentUser) {
      setGeminiQuota(null);
      setCodexQuota(null);
    } else {
      fetchGeminiQuota(currentSessionId || undefined);
      fetchCodexQuota(currentSessionId || undefined);
    }
  }, [currentUser, currentSessionId]);

  useEffect(() => {
    if (selectedModelOption?.hostedBy === 'codex' || selectedModelOption?.provider === 'codex') {
      fetchCodexQuota(currentSessionId || undefined);
    } else {
      fetchGeminiQuota(currentSessionId || undefined);
    }
  }, [selectedModelOption?.id, selectedModelOption?.hostedBy, selectedModelOption?.provider]);

  const handleRefreshQuota = useCallback(() => {
    fetchGeminiQuota(currentSessionId || undefined, true);
    fetchCodexQuota(currentSessionId || undefined, true);
  }, [currentSessionId, currentUser?.email]);

  const handleCliStatusChange = useCallback((newStatus: CliStatus) => {
    setCliStatus(newStatus);
    fetchGeminiQuota(currentSessionId || undefined);
    fetchCodexQuota(currentSessionId || undefined);
  }, [currentSessionId]);

  const fetchQuota = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastQuotaFetchTimeRef.current < 4000) {
      return;
    }
    if (!force && inFlightQuotaPromiseRef.current) {
      return inFlightQuotaPromiseRef.current;
    }

    inFlightQuotaPromiseRef.current = (async () => {
      try {
        const res = await apiFetch('/api/v1/agent/quota');
        if (res.ok) {
          const json = await res.json();
          if (json.data) {
            setRateLimit({
              limit: json.data.limit,
              remaining: json.data.remaining,
              resetInSeconds: json.data.resetInSeconds,
            });
            lastQuotaFetchTimeRef.current = Date.now();
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

  useEffect(() => {
    fetchQuota();
  }, []);

  useEffect(() => {
    if (rateLimit.resetInSeconds <= 0) return;
    const timer = setInterval(() => {
      setRateLimit((prev) => {
        if (prev.resetInSeconds <= 1) {
          fetchQuota(true);
          return { ...prev, remaining: prev.limit, resetInSeconds: 0 };
        }
        return { ...prev, resetInSeconds: prev.resetInSeconds - 1 };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [rateLimit.resetInSeconds]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Day / Night Theme state: initialized from localStorage preference, or browser system setting
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('theme_preference');
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true;
  });

  // Keep DOM class in sync and respond to system changes if no manual preference stored
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
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
      }
    };

    mediaQuery.addEventListener('change', handleSystemChange);
    return () => mediaQuery.removeEventListener('change', handleSystemChange);
  }, [isDarkMode]);

  const handleToggleTheme = () => {
    const nextMode = !isDarkMode;
    setIsDarkMode(nextMode);
    localStorage.setItem('theme_preference', nextMode ? 'dark' : 'light');
    if (nextMode) {
      document.documentElement.classList.add('dark');
      showToast('Switched to Night Mode');
    } else {
      document.documentElement.classList.remove('dark');
      showToast('Switched to Day Mode');
    }
  };

  const handleSelectModel = (modelId: ModelType) => {
    setSelectedModel(modelId);
    try {
      if (!modelId || modelId === 'none') {
        localStorage.removeItem('model_preference');
        localStorage.removeItem('selected_model_preference');
      } else {
        localStorage.setItem('selected_model_preference', modelId);
        const display = getModelDisplayInfo(modelId, availableModels);
        const preferenceData = {
          provider: display.parentModel.hostedBy || display.provider,
          model: display.baseName,
          effort: display.effortLabel || 'default',
          modelId,
        };
        localStorage.setItem('model_preference', JSON.stringify(preferenceData));
      }
    } catch {}
  };

  // Keep provider-model-effort preference in sync with localStorage
  useEffect(() => {
    try {
      if (selectedModel && selectedModel !== 'none') {
        localStorage.setItem('selected_model_preference', selectedModel);
        const display = getModelDisplayInfo(selectedModel, availableModels);
        const preferenceData = {
          provider: display.parentModel.hostedBy || display.provider,
          model: display.baseName,
          effort: display.effortLabel || 'default',
          modelId: selectedModel,
        };
        localStorage.setItem('model_preference', JSON.stringify(preferenceData));
      } else if (selectedModel === 'none') {
        localStorage.removeItem('model_preference');
        localStorage.removeItem('selected_model_preference');
      }
    } catch {}
  }, [selectedModel, availableModels]);

  // Comprehensive user and session cleanup routine
  const performUserCleanup = useCallback(() => {
    authMeCompletedRef.current = false;
    authMeInFlightRef.current = null;
    const prevUserId = currentUserRef.current?.id;
    closeGeminiCliLoginPopup();
    // 1. Invalidate authentication tokens & caches
    localStorage.removeItem('auth_token');
    sessionSyncService.clearLocalCache(prevUserId);
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
    if (!currentUser) {
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

  // Sync user profile on load using verified session token and auto-refresh weekly
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      performUserCleanup();
      setIsPageLoading(false);
      return;
    }

    if (authMeCompletedRef.current || authMeInFlightRef.current) {
      return;
    }

    setLoadingMessage('Initializing Atelier Workspace');
    setLoadingSubMessage('Connecting to cloud microVMs & models...');

    // Safety timeout ensures loading screen never blocks the user indefinitely if backend takes longer
    const safetyTimeout = setTimeout(() => {
      setIsPageLoading(false);
    }, 4000);

    authMeInFlightRef.current = apiFetch('/api/v1/auth/me')
      .then((res) => {
        if (!res.ok) throw new Error('Unauthenticated');
        return res.json();
      })
      .then(async (data) => {
        authMeCompletedRef.current = true;
        if (data.success && data.data) {
          const user = data.data;
          currentUserRef.current = user;
          setCurrentUser(user);
          // Auto-refresh token if within refresh window (weekly refresh requirement)
          refreshAuthToken().then((refreshed) => {
            if (refreshed?.token) {
              localStorage.setItem('auth_token', refreshed.token);
            }
          });
        } else {
          performUserCleanup();
        }
      })
      .catch((err: any) => {
        if (err?.message === 'Unauthenticated') {
          performUserCleanup();
        }
      })
      .finally(() => {
        authMeInFlightRef.current = null;
        setTimeout(() => {
          setIsPageLoading(false);
          clearTimeout(safetyTimeout);
        }, 350);
      });

    return () => clearTimeout(safetyTimeout);
  }, [performUserCleanup]);

  // Sync and merge chat sessions across Cloud Backend, Firestore, and LocalStorage
  const syncSessions = useCallback(async () => {
    if (!currentUser?.id) {
      setIsSyncingSessions(false);
      return null;
    }
    // Instant hydration from local cache if available
    const cached = sessionSyncService.getLocalSessions(currentUser.id);
    if (cached.length > 0) {
      setSessions(cached);
    }
    setIsSyncingSessions(true);
    try {
      const merged = await sessionSyncService.loadAndReconcileSessions(
        currentUser.id,
        (interim) => {
          if (currentUserRef.current?.id === currentUser.id) {
            setSessions(interim);
          }
        }
      );
      // Guard: if user logged out while request was in-flight, discard!
      if (!currentUserRef.current?.id || currentUserRef.current.id !== currentUser.id) {
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

  useEffect(() => {
    if (!currentUser?.id) {
      setIsSyncingSessions(false);
      setSessions([]);
      setMessages([]);
      setCurrentSessionId(null);
      setHasMoreEarlierMessages(false);
      setRemainingMessageCount(0);
      return;
    }

    // 0ms instant hydration: immediately display local sessions before network calls, scoped to user
    const cached = sessionSyncService.getLocalSessions(currentUser.id);
    if (cached.length > 0) {
      setSessions(cached);
      try {
        const activeId = localStorage.getItem(`harness_current_session_id_${currentUser.id}`);
        const matched = activeId ? cached.find((s) => s.id === activeId) : cached[0];
        if (matched) {
          if (!activeId) setCurrentSessionId(matched.id);
          const localSlice = (matched.messages || []).slice(-25);
          if (localSlice.length > 0) setMessages(localSlice);
          const totalMsgs = matched.messageCount ?? matched.messages?.length ?? 0;
          if (totalMsgs > localSlice.length) {
            setHasMoreEarlierMessages(true);
            setRemainingMessageCount(totalMsgs - localSlice.length);
          } else {
            setHasMoreEarlierMessages(false);
            setRemainingMessageCount(0);
          }
          if (matched.model && matched.model !== 'none') setSelectedModel(matched.model);
        }
      } catch {}
    } else {
      // User has no cached sessions: ensure previous user's messages & active session are cleared!
      setSessions([]);
      setMessages([]);
      setCurrentSessionId(null);
      setHasMoreEarlierMessages(false);
      setRemainingMessageCount(0);
    }

    syncSessions().then((merged) => {
      // Guard: if user logged out or changed in the meantime, discard!
      if (!currentUserRef.current?.id || currentUserRef.current.id !== currentUser.id) return;
      if (!merged || merged.length === 0) {
        setSessions([]);
        setMessages([]);
        setCurrentSessionId(null);
        setHasMoreEarlierMessages(false);
        setRemainingMessageCount(0);
        return;
      }
      try {
        const activeId = localStorage.getItem(`harness_current_session_id_${currentUser.id}`);
        const target = activeId ? merged.find((s) => s.id === activeId) : merged[0];
        if (target) {
          if (!activeId) setCurrentSessionId(target.id);
          if (target.model && target.model !== 'none') {
            setSelectedModel(target.model);
          }
          sessionSyncService.getSession(target.id, { limit: 25 }).then((data) => {
            if (data && currentUserRef.current?.id === currentUser.id) {
              setMessages(data.messages || []);
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
      } catch {}
    });
  }, [currentUser?.id, syncSessions]);

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

      let sessionModel = session.model;
      if (sessionModel && sessionModel !== 'none') {
        const isAvailable = availableModels.some(
          (m) => m.id === sessionModel || m.effortOptions?.some((opt) => opt.modelId === sessionModel)
        );
        if (!isAvailable) {
          // If session's recorded model was removed from that provider, check if base model exists
          const matchedBase = availableModels.find((m) => sessionModel!.startsWith(m.id));
          if (matchedBase && matchedBase.effortOptions && matchedBase.effortOptions.length > 0) {
            sessionModel = getMinimumEffortModelId(matchedBase);
          } else {
            sessionModel = selectedModel !== 'none' ? selectedModel : 'none';
          }
        }
      }
      setSelectedModel(sessionModel || 'none');

      // Fetch fresh 25-message chunk and pagination state from backend
      sessionSyncService.getSession(session.id, { limit: 25 }).then((data) => {
        if (data && data.id === session.id) {
          setMessages(data.messages || []);
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

    // Release/detach associated cloud sandbox and refresh usage immediately
    try {
      const url = updated.length === 0
        ? `/api/v1/sandbox?sessionId=${encodeURIComponent(sessionId)}&clearAllSessions=true`
        : `/api/v1/sandbox?sessionId=${encodeURIComponent(sessionId)}`;
      const res = await apiFetch(url, { method: 'DELETE' });
      const data = await res.json();
      if (data.success && data.data?.usage) {
        setSandboxUsage(data.data.usage);
      } else {
        await fetchSandboxUsage();
      }
    } catch {
      await fetchSandboxUsage();
    }

    showToast('Chat session deleted');
  };

  const handleNewSession = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setHasMoreEarlierMessages(false);
    setRemainingMessageCount(0);
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

    try {
      // Clear previous user's messages, active session, and sandbox selection immediately
      setMessages([]);
      setCurrentSessionId(null);
      setSessions([]);
      setSelectedSandboxId(null);
      setHasMoreEarlierMessages(false);
      setRemainingMessageCount(0);

      // If token is already a backend signed JWT (e.g. from CLI login)
      if (idToken.startsWith('eyJ')) {
        localStorage.setItem('auth_token', idToken);
        const meRes = await apiFetch('/api/v1/auth/me');
        const meData = await meRes.json();
        if (meData.success && meData.data) {
          const user = meData.data;
          currentUserRef.current = user;
          setCurrentUser(user);
          firestoreService.syncUserProfile(user).catch((fErr) => {
            console.warn('Firestore user profile sync warning', fErr);
          });

          const freshStatus = await fetchCliStatus().catch(() => null);
          if (freshStatus) {
            setCliStatus(freshStatus);
          }
          const hasAnyCli = Boolean(
            freshStatus?.antigravity?.linked ||
            freshStatus?.gemini?.linked ||
            freshStatus?.claude?.linked ||
            freshStatus?.codex?.linked
          );

          if (!hasAnyCli) {
            setIsAuthModalOpen(true);
            showToast(`Signed in as ${user.name}. Please link an AI CLI to execute models.`);
          } else {
            setIsAuthModalOpen(false);
            showToast(`Welcome, ${user.name}!`);
          }
          return;
        }
      }

      const res = await apiFetch('/api/v1/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, email, name, avatarUrl }),
      });

      const data = await res.json();
      if (data.success && data.data?.token) {
        localStorage.setItem('auth_token', data.data.token);
        const user = data.data.user;
        currentUserRef.current = user;
        setCurrentUser(user);
        firestoreService.syncUserProfile(user).catch((fErr) => {
          console.warn('Firestore user profile sync warning', fErr);
        });

        const freshStatus = await fetchCliStatus().catch(() => null);
        if (freshStatus) {
          setCliStatus(freshStatus);
        }
        const hasAnyCli = Boolean(
          freshStatus?.antigravity?.linked ||
          freshStatus?.gemini?.linked ||
          freshStatus?.claude?.linked ||
          freshStatus?.codex?.linked
        );

        if (!hasAnyCli) {
          setIsAuthModalOpen(true);
          showToast(`Signed in as ${user.name}. Please link an AI CLI to execute models.`);
        } else {
          setIsAuthModalOpen(false);
          showToast(`Welcome back, ${user.name}!`);
        }
      } else {
        const errorMsg = data.error?.message || 'Authentication failed';
        showToast(errorMsg);
        throw new Error(errorMsg);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Authentication failed';
      showToast(errorMsg);
      throw err;
    } finally {
      setTimeout(() => {
        setIsPageLoading(false);
      }, 350);
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
        const user = data.data;
        setCurrentUser(user);
        setIsAuthModalOpen(false);
        firestoreService.syncUserProfile(user).catch(() => {});
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
        const user = data.data;
        setCurrentUser(user);
        setIsAuthModalOpen(false);
        firestoreService.syncUserProfile(user).catch(() => {});
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
    // All subsequent assistant turns are discarded.
    const msgIdx = messages.findIndex((m) => m.id === msgId);
    if (msgIdx === -1) return;

    const updatedUserMsg: ChatMessage = {
      ...messages[msgIdx],
      content: newPrompt,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const truncatedHistory = [...messages.slice(0, msgIdx), updatedUserMsg];
    setMessages(truncatedHistory);

    // Re-send using the truncated history (no extra user message appended)
    await handleSendMessage(newPrompt, truncatedHistory);
  };

  const handleSendMessage = async (
    promptText: string,
    customHistory?: ChatMessage[],
    attachedFiles?: AttachedFile[]
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

    if (!activeSandbox) {
      showToast('Please select or start a cloud sandbox from the top bar before sending a prompt.');
      const menuBtn = document.getElementById('cloud-sandboxes-menu-button');
      if (menuBtn) {
        menuBtn.click();
      }
      return;
    }

    let newMessages: ChatMessage[];

    if (customHistory) {
      // Re-send after an edit: history already contains the updated user message.
      // Don't append a new user bubble — just use the provided truncated history.
      newMessages = customHistory;
      setMessages(newMessages);
    } else {
      const userMsg: ChatMessage = {
        id: `usr_${Date.now()}`,
        role: 'user',
        author: currentUser.name,
        authorBadge: 'YOU',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        avatarUrl: currentUser.avatarUrl || '',
        content: promptText,
      };
      newMessages = [...messages, userMsg];
      setMessages(newMessages);
      if (currentUser) {
        firestoreService.saveChatMessage(currentUser.id, currentSessionId || `sess_${Date.now()}`, userMsg);
      }
    }

    setIsLoading(true);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const activeSessionId = currentSessionId || `sess_${Date.now()}`;
    if (!currentSessionId) {
      setCurrentSessionId(activeSessionId);
    }
    if (activeSandbox?.sandboxId) {
      const clean = activeSessionId.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32);
      await apiFetch('/api/v1/sandbox/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: clean, sandboxId: activeSandbox.sandboxId }),
      }).catch(() => {});
      fetchSandboxUsage();
    }

    const currentModelOpt = selectedModelOption;
    const modelDisplayName = currentModelOpt.name;

    const syncSession = (msgs: ChatMessage[]) => {
      const sessionTitle = promptText.length > 36 ? promptText.slice(0, 36) + '...' : promptText;
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === activeSessionId);
        let updated: ChatSession[];
        let targetSession: ChatSession;
        if (idx >= 0) {
          updated = [...prev];
          targetSession = {
            ...updated[idx],
            updatedAt: new Date().toISOString(),
            messages: msgs,
            model: selectedModel,
          };
          updated[idx] = targetSession;
        } else {
          targetSession = {
            id: activeSessionId,
            title: sessionTitle,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: msgs,
            model: selectedModel,
          };
          updated = [targetSession, ...prev];
        }
        sessionSyncService.saveSession(targetSession, currentUser?.id).catch(() => {});
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
                  latency: serverMsg.latencyMs
                    ? serverMsg.latencyMs >= 1000
                      ? `Latency: ${(serverMsg.latencyMs / 1000).toFixed(1)}s (${serverMsg.latencyMs.toLocaleString()}ms)`
                      : `Latency: ${serverMsg.latencyMs}ms`
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
                fetchGeminiQuota(activeSessionId, true);
                fetchCodexQuota(activeSessionId, true);
                fetchSandboxUsage();
                if (currentUser) {
                  firestoreService.saveChatMessage(currentUser.id, activeSessionId, finalAssistantMsg);
                }
              } else if (event === 'error') {
                const errMsg = data.message || 'Execution error';
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
      if (currentUser) {
        firestoreService.saveChatMessage(currentUser.id, activeSessionId, fallbackAssistantMsg);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsLoading(false);
      setStreamingMessageId(null);
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
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
      {/* Full-Page Initial & Post-Sign-In Loading Screen with 3D Rotating Square */}
      {isPageLoading && (
        <LoadingScreen
          message={loadingMessage}
          subMessage={loadingSubMessage}
        />
      )}

      {/* Toast Alert */}
      {toastMessage && (
        <div className={`fixed top-16 right-4 sm:right-10 ${isInspectorOpen ? 'xl:right-[400px]' : 'xl:right-10'} z-50 px-space-md py-space-xs rounded-lg bg-surface-container-high border border-primary/40 text-on-surface shadow-2xl text-body-sm flex items-center gap-2 animate-bounce transition-all duration-300`}>
          <span className="material-symbols-outlined text-[16px] text-primary">info</span>
          <span>{toastMessage}</span>
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
          validSessionIds={validSessionIds}
          onSandboxChanged={(newSandboxId) => {
            setSelectedSandboxId(newSandboxId || null);
            fetchSandboxUsage();
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
                  <div className="mt-6 flex items-center gap-2.5 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium animate-in fade-in duration-200">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span>{activeSandbox.name} Active</span>
                    <span className="text-outline text-[11px]">• MicroVM ready</span>
                    <button
                      type="button"
                      onClick={() => setIsInspectorOpen(true)}
                      className="ml-2 text-primary hover:underline text-[11px] font-semibold cursor-pointer"
                    >
                      Open Inspector →
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
                        const validSet = new Set(sessions.map((s) => s.id));
                        const attachedCount = sb.attachedSessionIds?.filter((id) => validSet.has(id)).length || 0;
                        const isAttaching = isAttachingSandbox === sb.sandboxId;
                        return (
                          <button
                            key={sb.sandboxId}
                            type="button"
                            onClick={() => handleAttachExistingSandbox(sb.sandboxId)}
                            disabled={isAttaching}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-container-high hover:bg-surface-container-highest border border-primary/30 hover:border-primary text-on-surface text-xs font-semibold shadow-xs transition-all cursor-pointer active:scale-95 disabled:opacity-50 group"
                            title={`Connect this chat to ${sb.name} (${sb.sandboxId})`}
                          >
                            {isAttaching ? (
                              <span className="material-symbols-outlined text-[14px] animate-spin text-primary">progress_activity</span>
                            ) : (
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                              </span>
                            )}
                            <span>Attach to {sb.name}</span>
                            <span className="text-[10px] text-outline font-mono font-normal">
                              ({attachedCount} {attachedCount === 1 ? 'chat' : 'chats'})
                            </span>
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
                        <div className="flex items-center gap-space-sm">
                          {msg.modelBadge ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-primary/10 text-primary font-medium border border-primary/20 text-xs sm:text-sm">
                              {msg.modelBadge.toLowerCase().includes('none') ? (
                                <span className="material-symbols-outlined text-[14px] text-outline">tune</span>
                              ) : msg.modelBadge.toLowerCase().includes('claude') ? (
                                <img src="/provider-icons/claude.svg" alt="" className="w-3.5 h-3.5 object-contain" />
                              ) : msg.modelBadge.toLowerCase().includes('gpt') || msg.modelBadge.toLowerCase().includes('codex') || msg.modelBadge.toLowerCase().startsWith('o') ? (
                                <img src="/model-icons/openai.svg" alt="" className="w-3.5 h-3.5 object-contain" />
                              ) : msg.modelBadge.toLowerCase().includes('gemini') ? (
                                <img src="/model-icons/google-gemini.svg" alt="" className="w-3.5 h-3.5 object-contain" />
                              ) : (
                                <img src="/provider-icons/antigravity.svg" alt="" className="w-3.5 h-3.5 object-contain" />
                              )}
                              {msg.modelBadge}
                            </span>
                          ) : (
                            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold text-sm sm:text-base">
                              {msg.author || 'Atelier Assistant'}
                            </span>
                          )}
                        </div>
                        <span className="font-code-sm text-code-sm text-outline text-xs">
                          {msg.latency}
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
                      ) : isLoading && streamingMessageId === msg.id ? (
                        <div className="py-2.5 px-3 rounded-lg bg-surface-container-low/70 border border-primary/25 flex items-center justify-between gap-3 text-xs w-fit shadow-xs">
                          <div className="flex items-center gap-2 text-primary">
                            <span className="material-symbols-outlined text-[16px] animate-spin text-primary">
                              progress_activity
                            </span>
                            <span className="font-sans font-medium text-on-surface">
                              {msg.steps?.find((s) => !s.completed)?.text || 'Reasoning & formulating execution strategy...'}
                            </span>
                          </div>
                          <span className="text-[10px] text-primary/80 font-mono uppercase tracking-wider bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                            Thinking
                          </span>
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
