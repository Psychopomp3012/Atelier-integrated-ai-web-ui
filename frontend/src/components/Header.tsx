import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { UserMenu } from './UserMenu';
import { DeleteSandboxModal, type SandboxPendingDelete } from './DeleteSandboxModal';
import type { UserProfile, TokenUsageState, ModelOption, ModelType } from '../types';
import { apiFetch } from '../utils/api.util';
import {
  currentUserAtom,
  isAuthModalOpenAtom,
  isDarkModeAtom,
  isInspectorOpenAtom,
  isTelemetryModalOpenAtom,
  sandboxUsageAtom,
  selectedModelAtom,
  currentSessionIdAtom,
  toastMessageAtom,
} from '../state';

interface SandboxUsageData {
  used: number;
  max: number;
  sandboxes: Array<{
    sandboxId: string;
    name: string;
    sessionId?: string;
    lastActiveAt: number;
    createdAt: number;
    lastUpdateCheckAt?: number;
    isUpdating?: boolean;
    isProvisioning?: boolean;
  }>;
}

interface HeaderProps {
  currentPath?: string;
  clusterRegion?: string;
  sandboxName?: string;
  tokenUsage?: TokenUsageState;
  modelName?: string;
  selectedModel?: ModelType;
  selectedModelOption?: ModelOption;
  isModelLinked?: boolean;
  activeProvider?: string;
  onToggleSidebar?: () => void;
  onToggleInspector?: () => void;
  isInspectorOpen?: boolean;
  user?: UserProfile | null;
  onOpenAuthModal?: () => void;
  onLogout: () => void;
  isDarkMode?: boolean;
  onToggleTheme?: () => void;
  currentSessionId?: string | null;
  onSandboxChanged?: (sandboxId: string, usage?: SandboxUsageData) => void;
  sandboxUsage?: SandboxUsageData | null;
  activeSandbox?: { sandboxId: string; name: string } | null;
  onRefreshSandboxUsage?: () => void;
  onRefreshQuota?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  clusterRegion: _clusterRegion,
  sandboxName: _sandboxName,
  tokenUsage,
  modelName = 'Gemini 2.5 Pro',
  selectedModel: propSelectedModel,
  selectedModelOption,
  isModelLinked = true,
  activeProvider: propsActiveProvider,
  onToggleSidebar,
  onToggleInspector: propOnToggleInspector,
  isInspectorOpen: propIsInspectorOpen,
  user: propUser,
  onOpenAuthModal: propOnOpenAuthModal,
  onLogout,
  isDarkMode: propIsDarkMode,
  onToggleTheme: propOnToggleTheme,
  currentSessionId: propCurrentSessionId,
  onSandboxChanged,
  sandboxUsage: propSandboxUsage,
  activeSandbox: propActiveSandbox,
  onRefreshSandboxUsage,
  onRefreshQuota,
}) => {
  const [atomDarkMode, setAtomDarkMode] = useAtom(isDarkModeAtom);
  const [atomInspectorOpen, setAtomInspectorOpen] = useAtom(isInspectorOpenAtom);
  const atomUser = useAtomValue(currentUserAtom);
  const atomSandboxUsage = useAtomValue(sandboxUsageAtom);
  const atomSelectedModel = useAtomValue(selectedModelAtom);
  const atomCurrentSessionId = useAtomValue(currentSessionIdAtom);
  const setIsAuthModalOpen = useSetAtom(isAuthModalOpenAtom);
  const setToastMessage = useSetAtom(toastMessageAtom);

  const user = propUser !== undefined ? propUser : atomUser;
  const isDarkMode = propIsDarkMode !== undefined ? propIsDarkMode : atomDarkMode;
  const isInspectorOpen = propIsInspectorOpen !== undefined ? propIsInspectorOpen : atomInspectorOpen;
  const selectedModel = propSelectedModel ?? atomSelectedModel;
  const currentSessionId = propCurrentSessionId !== undefined ? propCurrentSessionId : atomCurrentSessionId;
  const onToggleTheme = propOnToggleTheme ?? (() => setAtomDarkMode((prev) => !prev));
  const onToggleInspector = propOnToggleInspector ?? (() => setAtomInspectorOpen((prev) => !prev));
  const onOpenAuthModal = propOnOpenAuthModal ?? (() => setIsAuthModalOpen(true));

  const [showLimitsPopover, setShowLimitsPopover] = useAtom(isTelemetryModalOpenAtom);
  const popoverRef = useRef<HTMLDivElement>(null);
  const mobileLimitsModalRef = useRef<HTMLDivElement>(null);

  const [showSandboxDropdown, setShowSandboxDropdown] = useState(false);
  const [internalSandboxUsage, setInternalSandboxUsage] = useState<SandboxUsageData | null>(null);
  const [isCreatingSandbox, setIsCreatingSandbox] = useState(false);
  const [switchingSandboxId] = useState<string | null>(null);
  const [deletingSandboxId, setDeletingSandboxId] = useState<string | null>(null);
  const [sandboxPendingDelete, setSandboxPendingDelete] = useState<SandboxPendingDelete | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const sandboxRef = useRef<HTMLDivElement>(null);
  const mobileSandboxModalRef = useRef<HTMLDivElement>(null);

  const sandboxUsage = propSandboxUsage !== undefined ? propSandboxUsage : (atomSandboxUsage || internalSandboxUsage);

  const fetchSandboxUsage = async () => {
    if (onRefreshSandboxUsage) {
      onRefreshSandboxUsage();
      return;
    }
    try {
      if (!user?.id) {
        setInternalSandboxUsage({ used: 0, max: 3, sandboxes: [] });
        return;
      }
      const params = new URLSearchParams();
      params.set('userId', user.id);
      const url = `/api/v1/sandboxes?${params.toString()}`;
      const res = await apiFetch(url);
      const data = await res.json();
      if (data.success && data.data) {
        setInternalSandboxUsage(data.data);
      }
    } catch { }
  };

  // Only perform standalone fetch if sandboxUsage prop is not provided by parent App
  useEffect(() => {
    if (propSandboxUsage === undefined && user?.id) {
      fetchSandboxUsage();
    }
  }, [user?.id, propSandboxUsage]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        (!mobileLimitsModalRef.current || !mobileLimitsModalRef.current.contains(target)) &&
        !(target as HTMLElement)?.closest?.('[role="dialog"]')
      ) {
        setShowLimitsPopover(false);
      }
      if (
        sandboxRef.current &&
        !sandboxRef.current.contains(target) &&
        (!mobileSandboxModalRef.current || !mobileSandboxModalRef.current.contains(target)) &&
        !(target as HTMLElement)?.closest?.('[role="dialog"]')
      ) {
        setShowSandboxDropdown(false);
      }
    };
    if (showLimitsPopover || showSandboxDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showLimitsPopover, showSandboxDropdown]);

  const hasFetchedQuotaOnOpenRef = useRef(false);
  useEffect(() => {
    if (showLimitsPopover && isModelLinked) {
      if (!hasFetchedQuotaOnOpenRef.current) {
        hasFetchedQuotaOnOpenRef.current = true;
        onRefreshQuota?.();
      }
    } else if (!showLimitsPopover) {
      hasFetchedQuotaOnOpenRef.current = false;
    }
  }, [showLimitsPopover, isModelLinked]);

  const activeSandbox = useMemo(() => {
    if (propActiveSandbox) return propActiveSandbox;
    if (!sandboxUsage?.sandboxes || sandboxUsage.sandboxes.length === 0) return null;
    return sandboxUsage.sandboxes[0] || null;
  }, [propActiveSandbox, sandboxUsage]);

  const handleSwitchSandbox = (targetSandboxId: string) => {
    onSandboxChanged?.(targetSandboxId, sandboxUsage || undefined);
    setShowSandboxDropdown(false);
    const targetName = sandboxUsage?.sandboxes?.find((s) => s.sandboxId === targetSandboxId)?.name || 'Sandbox';
    setToastMessage(`Switched to ${targetName}`);
  };

  const handleCreateSandbox = async () => {
    if (!user) {
      setShowSandboxDropdown(false);
      onOpenAuthModal();
      return;
    }
    if (isCreatingSandbox) return;

    if (sandboxUsage && sandboxUsage.used >= sandboxUsage.max) {
      setToastMessage(
        `Sandbox quota limit reached (${sandboxUsage.used}/${sandboxUsage.max} full). Delete an existing sandbox first.`
      );
      return;
    }

    setIsCreatingSandbox(true);
    try {
      const cleanSession = (currentSessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32);
      const res = await apiFetch('/api/v1/sandbox/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: cleanSession }),
      });
      const data = await res.json();
      if (data.success && data.data?.sandboxId) {
        if (data.data.usage) {
          setInternalSandboxUsage(data.data.usage);
        }
        setIsCreatingSandbox(false);
        onSandboxChanged?.(data.data.sandboxId, data.data.usage);
        setShowSandboxDropdown(false);
        setToastMessage('Cloud Sandbox VM created and ready');
      } else {
        setIsCreatingSandbox(false);
        setToastMessage(data.error?.message || 'Failed to create new sandbox VM');
      }
    } catch (err: unknown) {
      setIsCreatingSandbox(false);
      console.error('Failed to create new sandbox', err);
      setToastMessage('Failed to create sandbox VM');
    } finally {
      setIsCreatingSandbox(false);
    }
  };

  const handleDeleteSandbox = (
    targetId: string,
    targetName: string,
    attachedCount: number,
    isCurrentSandbox?: boolean
  ) => {
    setSandboxPendingDelete({
      id: targetId,
      name: targetName,
      attachedCount,
      isCurrent: isCurrentSandbox,
    });
    setDeleteError(null);
  };

  const confirmDeleteSandbox = async () => {
    if (!sandboxPendingDelete || deletingSandboxId) return;
    const targetId = sandboxPendingDelete.id;
    setDeletingSandboxId(targetId);
    setDeleteError(null);
    try {
      const res = await apiFetch(`/api/v1/sandbox?sandboxId=${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        if (data.data?.usage) {
          setInternalSandboxUsage(data.data.usage);
        } else {
          await fetchSandboxUsage();
        }
        onSandboxChanged?.('');
        setSandboxPendingDelete(null);
      } else {
        setDeleteError(data.error?.message || 'Failed to delete sandbox VM');
      }
    } catch (err: any) {
      console.error('Failed to delete sandbox', err);
      setDeleteError(err?.message || 'Failed to connect to backend to delete sandbox');
    } finally {
      setDeletingSandboxId(null);
    }
  };

  const isNoneSelected = !selectedModel || selectedModel === 'none';

  const isCodex =
    !isNoneSelected &&
    (selectedModelOption?.hostedBy === 'codex' ||
      selectedModelOption?.provider === 'codex' ||
      propsActiveProvider === 'codex' ||
      (tokenUsage?.activeProvider === 'codex' && selectedModelOption?.hostedBy !== 'antigravity'));

  const isAntigravity =
    !isNoneSelected &&
    !isCodex &&
    (selectedModelOption?.hostedBy === 'antigravity' ||
      selectedModelOption?.provider === 'gemini' ||
      (selectedModel && (
        selectedModel.includes('gemini') ||
        selectedModel.includes('antigravity') ||
        selectedModel.includes('sonnet') ||
        selectedModel.includes('opus') ||
        selectedModel.includes('oss')
      )));

  const isClaude =
    !isNoneSelected &&
    !isAntigravity &&
    !isCodex &&
    (selectedModelOption?.provider === 'claude' || tokenUsage?.activeProvider === 'claude' || propsActiveProvider === 'claude');

  const providerLabel = isCodex ? 'Codex' : isClaude ? 'Claude' : 'Antigravity';

  const providerIcon = isCodex ? (
    <img src="/provider-icons/codex.svg" alt="Codex" className="w-3.5 h-3.5 object-contain shrink-0" />
  ) : isClaude ? (
    <img src="/provider-icons/claude.svg" alt="Claude" className="w-3.5 h-3.5 object-contain shrink-0" />
  ) : (
    <img src="/provider-icons/antigravity.svg" alt="Antigravity" className="w-3.5 h-3.5 object-contain shrink-0" />
  );

  const linkedEmail = isCodex
    ? (tokenUsage?.codexQuota?.userEmail || tokenUsage?.userEmail || user?.email)
    : (tokenUsage?.userEmail || user?.email);
  const quotaLimits = isCodex
    ? tokenUsage?.codexQuota?.quotaLimits
    : (tokenUsage?.geminiQuota?.quotaLimits || tokenUsage?.quotaLimits);


  // Identify the quota group corresponding to the selected model
  const relevantGroup = useMemo(() => {
    if (!quotaLimits?.groups || quotaLimits.groups.length === 0) return null;

    if (isCodex) {
      return quotaLimits.groups[0];
    }

    const modelLower = (modelName || '').toLowerCase();
    const idLower = (selectedModel || '').toLowerCase();

    // Check if Claude or GPT-OSS model is selected
    const is3pModel =
      modelLower.includes('claude') ||
      modelLower.includes('opus') ||
      modelLower.includes('sonnet') ||
      modelLower.includes('oss') ||
      idLower.includes('claude') ||
      idLower.includes('opus') ||
      idLower.includes('sonnet') ||
      idLower.includes('oss');

    if (is3pModel) {
      const g3p = quotaLimits.groups.find(
        (g) =>
          g.name.toLowerCase().includes('claude') ||
          (g.name.toLowerCase().includes('gpt') && !g.name.toLowerCase().includes('chatgpt')) ||
          g.name.toLowerCase().includes('3p')
      );
      if (g3p) return g3p;
    }

    // Check if ChatGPT or Codex model is selected
    const isChatGpt =
      isCodex ||
      modelLower.includes('chatgpt') ||
      modelLower.includes('codex') ||
      idLower.includes('codex') ||
      idLower.includes('gpt-5') ||
      idLower.includes('gpt-6');

    if (isChatGpt) {
      const gChat = quotaLimits.groups.find(
        (g) => g.name.toLowerCase().includes('chatgpt') || g.name.toLowerCase().includes('codex')
      );
      if (gChat) return gChat;
    }

    // Default to Gemini Models group if present
    const geminiGroup = quotaLimits.groups.find(
      (g) =>
        g.name.toLowerCase().includes('gemini') ||
        g.buckets?.some((b) => b.id.toLowerCase().startsWith('gemini'))
    );
    return geminiGroup || quotaLimits.groups[0];
  }, [quotaLimits, isCodex, modelName, selectedModel]);

  // Identify the 5-hour and weekly buckets for Antigravity dual display
  const bucket5h = relevantGroup?.buckets?.find(
    (b) => b.window === '5h' || b.id?.toLowerCase().includes('5h')
  );
  const bucketWeekly = relevantGroup?.buckets?.find(
    (b) => b.window === 'weekly' || b.id?.toLowerCase().includes('weekly')
  );

  const fraction5h = bucket5h?.remaining_fraction;
  const fractionWeekly = bucketWeekly?.remaining_fraction;

  const isAnyLimitExhausted =
    !isNoneSelected &&
    ((fraction5h !== undefined && fraction5h <= 0) ||
      (fractionWeekly !== undefined && fractionWeekly <= 0));

  // Dual mini-indicator for Antigravity (5h and Weekly), Single for Codex and other providers
  const quotaBadgeText = useMemo(() => {
    if (isAntigravity && (fraction5h !== undefined || fractionWeekly !== undefined)) {
      if (fraction5h !== undefined && fractionWeekly !== undefined) {
        const pct5h = Math.round(fraction5h * 100);
        const pctWeekly = Math.round(fractionWeekly * 100);
        return `${pct5h}% (5h) · ${pctWeekly}% (W)`;
      }
      if (fraction5h !== undefined) {
        return `${Math.round(fraction5h * 100)}% (5h)`;
      }
      return `${Math.round(fractionWeekly! * 100)}% (W)`;
    }

    // Single limit for providers with 1 meter (Codex has only 1 meter)
    const singleFraction =
      relevantGroup?.buckets?.[0]?.remaining_fraction ??
      fraction5h ??
      fractionWeekly;

    if (singleFraction !== undefined) {
      return `${Math.round(singleFraction * 100)}% Quota`;
    }

    return 'Active';
  }, [isAntigravity, fraction5h, fractionWeekly, relevantGroup]);

  // Ultra-compact single indicator strictly for mobile screens (e.g. "100%")
  const mobileQuotaBadgeText = useMemo(() => {
    if (isAnyLimitExhausted) return '0%';

    if (isAntigravity) {
      if (fraction5h !== undefined) {
        return `${Math.round(fraction5h * 100)}%`;
      }
      if (fractionWeekly !== undefined) {
        return `${Math.round(fractionWeekly * 100)}%`;
      }
    }

    const singleFraction =
      relevantGroup?.buckets?.[0]?.remaining_fraction ??
      fraction5h ??
      fractionWeekly;

    if (singleFraction !== undefined) {
      return `${Math.round(singleFraction * 100)}%`;
    }

    return 'OK';
  }, [isAnyLimitExhausted, isAntigravity, fraction5h, fractionWeekly, relevantGroup]);

  const formatResetCountdown = (isoDate?: string, remainingFraction?: number): string => {
    if (remainingFraction !== undefined && remainingFraction >= 1.0) {
      return 'Quota available';
    }
    if (!isoDate) return 'Quota available';
    const diffMs = new Date(isoDate).getTime() - Date.now();
    if (diffMs <= 0) return 'Quota available';
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const minutes = totalMinutes % 60;
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;

    if (days > 0) {
      return `Refreshes in ${days}d ${hours}h ${minutes}m`;
    }
    if (totalHours > 0) {
      return `Refreshes in ${totalHours}h ${minutes}m`;
    }
    return `Refreshes in ${minutes}m`;
  };

  const renderLimitsContent = (isMobileModal = false) => (
    <>
      {/* Header with Switcher Tabs */}
      <div className="flex items-center justify-between pb-space-sm border-b border-outline-variant/20 mb-space-sm">
        <div className="flex items-center gap-1.5">
          {isNoneSelected ? (
            <span className="material-symbols-outlined text-outline text-[18px]">
              speed
            </span>
          ) : isCodex ? (
            <img src="/provider-icons/codex.svg" alt="Codex" className="w-4 h-4 object-contain shrink-0" />
          ) : isClaude ? (
            <img src="/provider-icons/claude.svg" alt="Claude" className="w-4 h-4 object-contain shrink-0" />
          ) : (
            <img src="/provider-icons/antigravity.svg" alt="Antigravity" className="w-4 h-4 object-contain shrink-0" />
          )}
          <span id="cli-telemetry-title" className="font-semibold text-sm text-on-surface">
            {isNoneSelected
              ? 'CLI Telemetry'
              : isCodex
                ? 'OpenAI Codex Quota'
                : isClaude
                  ? 'Anthropic Claude Telemetry'
                  : 'Antigravity Quota'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isNoneSelected ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-surface-container-highest text-outline border border-outline-variant/20">
              STANDBY
            </span>
          ) : isModelLinked ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              CONNECTED
            </span>
          ) : null}
          {isMobileModal && (
            <button
              type="button"
              onClick={() => setShowLimitsPopover(false)}
              className="w-7 h-7 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-all cursor-pointer"
              title="Close modal"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>
      </div>

      {isNoneSelected ? (
        /* Standby View when No Model is Selected */
        <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-surface-container-highest text-outline flex items-center justify-center mx-auto border border-outline-variant/30">
            <span className="material-symbols-outlined text-[20px]">tune</span>
          </div>
          <div>
            <div className="font-semibold text-xs text-on-surface">
              Live Telemetry on Standby
            </div>
            <p className="text-[11px] text-on-surface-variant mt-1 leading-relaxed">
              No model is currently selected. Select a model (Antigravity, Codex, or Claude) in the prompt bar below to activate real-time CLI telemetry, live quota tracking, and session analytics.
            </p>
          </div>

          {/* Connected Providers Status */}
          <div className="pt-2 border-t border-outline-variant/15 text-left space-y-1.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-outline px-1">
              CLI Providers Status
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-container border border-outline-variant/20 text-[11px]">
                <img src="/provider-icons/antigravity.svg" alt="Antigravity" className="w-3.5 h-3.5 object-contain shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium text-on-surface truncate">Antigravity CLI</div>
                  <div className="text-[10px] text-primary flex items-center gap-1 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block"></span>
                    Ready
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-container border border-outline-variant/20 text-[11px]">
                <img src="/provider-icons/codex.svg" alt="Codex" className="w-3.5 h-3.5 object-contain shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium text-on-surface truncate">Codex CLI</div>
                  <div className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                    Ready
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : !isModelLinked ? (
        /* Locked Quota Card when Not Linked */
        <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/30 mb-2 text-center space-y-2">
          <div className="w-8 h-8 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto border border-amber-500/20">
            <span className="material-symbols-outlined text-[18px]">lock</span>
          </div>
          <div>
            <div className="font-semibold text-xs text-on-surface">
              {isCodex ? 'OpenAI Codex CLI Not Linked' : isClaude ? 'Claude CLI Not Linked' : 'Antigravity CLI Not Linked'}
            </div>
            <p className="text-[11px] text-on-surface-variant mt-0.5 leading-snug">
              {isCodex
                ? 'Link your ChatGPT account via Codex CLI to enable live execution and telemetry.'
                : isClaude
                  ? 'Link your Anthropic account via Claude CLI to enable live execution and telemetry.'
                  : 'Sign in with your Google account to enable live Antigravity CLI execution and telemetry.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowLimitsPopover(false);
              onOpenAuthModal();
            }}
            className="w-full py-1.5 px-3 rounded-lg bg-primary hover:bg-primary-fixed-dim text-on-primary font-semibold text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
          >
            <span className="material-symbols-outlined text-[14px]">login</span>
            <span>{isCodex ? 'Link Codex CLI' : isClaude ? 'Link Claude CLI' : 'Link Google Account'}</span>
          </button>
        </div>
      ) : !activeSandbox ? (
        <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto border border-primary/20">
            <span className="material-symbols-outlined text-[20px]">dns</span>
          </div>
          <div>
            <div className="font-semibold text-xs text-on-surface">
              Sandbox VM Required for Telemetry
            </div>
            <p className="text-[11px] text-on-surface-variant mt-1 leading-relaxed">
              Please start a sandbox/VM and select it to see quota for CLI telemetry. All CLIs run strictly in your isolated microVM.
            </p>
          </div>

          {sandboxUsage?.sandboxes && sandboxUsage.sandboxes.length > 0 ? (
            <div className="space-y-2 pt-1 text-left">
              <div className="text-[10px] font-mono uppercase tracking-wider text-outline px-1">
                Select Sandbox VM to Attach:
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto custom-scrollbar">
                {sandboxUsage.sandboxes.map((sb, idx) => (
                  <button
                    key={sb.sandboxId}
                    type="button"
                    onClick={() => {
                      handleSwitchSandbox(sb.sandboxId);
                      onRefreshQuota?.();
                    }}
                    disabled={switchingSandboxId === sb.sandboxId}
                    className="w-full flex items-center justify-between p-2 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/20 hover:border-primary/40 text-xs transition-all cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="material-symbols-outlined text-[16px] text-primary shrink-0">
                        {switchingSandboxId === sb.sandboxId ? 'sync' : 'link'}
                      </span>
                      <span className="font-medium text-on-surface truncate">
                        {sb.name || `Sandbox #${idx + 1}`}
                      </span>
                    </div>
                    <span className="text-[10px] text-primary font-semibold shrink-0">
                      {switchingSandboxId === sb.sandboxId ? 'Attaching...' : 'Attach'}
                    </span>
                  </button>
                ))}
              </div>
              {sandboxUsage.used < sandboxUsage.max && (
                <button
                  type="button"
                  onClick={async () => {
                    await handleCreateSandbox();
                    onRefreshQuota?.();
                  }}
                  disabled={isCreatingSandbox}
                  className="w-full mt-1 py-1.5 px-2 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface text-[11px] font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <span className={`material-symbols-outlined text-[13px] ${isCreatingSandbox ? 'animate-spin' : ''}`}>
                    {isCreatingSandbox ? 'progress_activity' : 'add_circle'}
                  </span>
                  <span>{isCreatingSandbox ? 'Launching...' : '+ Start New Sandbox VM'}</span>
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={async () => {
                await handleCreateSandbox();
                onRefreshQuota?.();
              }}
              disabled={isCreatingSandbox}
              className="w-full py-2 px-3 rounded-lg bg-primary hover:bg-primary-fixed-dim text-on-primary font-semibold text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-[15px] ${isCreatingSandbox ? 'animate-spin' : ''}`}>
                {isCreatingSandbox ? 'progress_activity' : 'bolt'}
              </span>
              <span>{isCreatingSandbox ? 'Booting Cloud MicroVM...' : 'Start Sandbox VM'}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Account & Active Model Bar */}
          <div className="p-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-on-surface truncate">
                  {linkedEmail || 'Linked Account'}
                </div>
                <div className="text-[10px] text-on-surface-variant truncate flex items-center gap-1 mt-0.5">
                  <span>Active Model:</span>
                  {modelName.toLowerCase().includes('none') ? (
                    <span className="material-symbols-outlined text-[13px] text-outline">tune</span>
                  ) : modelName.toLowerCase().includes('claude') ? (
                    <img src="/provider-icons/claude.svg" alt="" className="w-3 h-3 object-contain inline shrink-0" />
                  ) : modelName.toLowerCase().includes('gpt') || modelName.toLowerCase().includes('codex') || modelName.toLowerCase().startsWith('o') ? (
                    <img src="/model-icons/openai.svg" alt="" className="w-3 h-3 object-contain inline shrink-0" />
                  ) : modelName.toLowerCase().includes('gemini') ? (
                    <img src="/model-icons/google-gemini.svg" alt="" className="w-3 h-3 object-contain inline shrink-0" />
                  ) : (
                    <img src="/provider-icons/antigravity.svg" alt="" className="w-3 h-3 object-contain inline shrink-0" />
                  )}
                  <span className="text-primary font-mono font-medium">{modelName}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quota Groups */}
          {isCodex ? (
            <div className="space-y-3">
              {/* Authentic Rolling Quota Bar (if available from Codex session rate limits) */}
              {quotaLimits && quotaLimits.groups && quotaLimits.groups.length > 0 ? (
                <div className="space-y-3">
                  {quotaLimits.groups.map((group, gIdx) => (
                    <div
                      key={group.name || gIdx}
                      className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/20 space-y-3"
                    >
                      <div>
                        <div className="font-bold text-xs uppercase tracking-wider text-on-surface flex items-center gap-1.5">
                          <img src="/provider-icons/codex.svg" alt="" className="w-3.5 h-3.5 object-contain inline shrink-0" />
                          <span>{group.name}</span>
                        </div>
                        {group.description && (
                          <div className="text-[11px] text-[#9ca3af] mt-0.5">
                            {group.description}
                          </div>
                        )}
                      </div>

                      <div className="space-y-3 pt-0.5">
                        {group.buckets.map((bucket) => {
                          const pct = Math.max(0, Math.min(100, bucket.remaining_fraction * 100));
                          return (
                            <div key={bucket.id || bucket.name} className="space-y-1">
                              <div className="text-xs font-semibold text-on-surface">
                                {bucket.name}
                              </div>

                              <div className="flex items-center gap-1.5 font-mono text-xs">
                                <span className="text-outline font-semibold select-none">[</span>
                                <div className="flex-1 h-3.5 bg-surface-container-highest dark:bg-[#1f2937] rounded-xs overflow-hidden border border-outline-variant/30">
                                  <div
                                    className="h-full bg-emerald-500 rounded-xs transition-all duration-500"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-outline font-semibold select-none">]</span>
                                <span className="w-14 text-right text-xs font-mono font-semibold text-on-surface">
                                  {pct.toFixed(2)}%
                                </span>
                              </div>

                              <div className="text-[11px] font-mono text-emerald-500">
                                {formatResetCountdown(bucket.reset_time, bucket.remaining_fraction)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/20 text-center space-y-2 text-xs">
                  <div className="flex items-center justify-center gap-2 text-emerald-400">
                    <span className="material-symbols-outlined text-[18px]">check_circle</span>
                    <span className="font-semibold">Codex Sandbox Environment Ready</span>
                  </div>
                  <p className="text-[11px] text-outline leading-relaxed">
                    Live dynamic session rate limits are fetched directly on response streams via OpenAI's Codex backend.
                  </p>
                </div>
              )}
            </div>
          ) : quotaLimits && quotaLimits.groups && quotaLimits.groups.length > 0 ? (
            <div className="space-y-3">
              {quotaLimits.groups.map((group, idx) => {
                const isCurrentActiveGroup = relevantGroup?.name === group.name;
                return (
                  <div
                    key={group.name || idx}
                    className={`p-3.5 rounded-xl border space-y-3 transition-colors ${isCurrentActiveGroup
                      ? 'bg-surface-container border-primary/40 ring-1 ring-primary/20'
                      : 'bg-surface-container-low border-outline-variant/20'
                      }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-bold text-xs uppercase tracking-wider text-on-surface flex items-center gap-1.5">
                          {group.name.toLowerCase().includes('claude') ? (
                            <img src="/provider-icons/claude.svg" alt="" className="w-3.5 h-3.5 object-contain inline shrink-0" />
                          ) : group.name.toLowerCase().includes('gpt') ? (
                            <img src="/model-icons/openai.svg" alt="" className="w-3.5 h-3.5 object-contain inline shrink-0" />
                          ) : group.name.toLowerCase().includes('gemini') ? (
                            <img src="/model-icons/google-gemini.svg" alt="" className="w-3.5 h-3.5 object-contain inline shrink-0" />
                          ) : (
                            <img src="/provider-icons/antigravity.svg" alt="" className="w-3.5 h-3.5 object-contain inline shrink-0" />
                          )}
                          <span>{group.name.toUpperCase()}</span>
                        </div>
                        {isCurrentActiveGroup && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-primary/10 text-primary border border-primary/20 shrink-0">
                            Active Model Quota
                          </span>
                        )}
                      </div>
                      {group.description && (
                        <div className="text-[11px] text-[#9ca3af] mt-0.5">
                          {group.description}
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 pt-0.5">
                      {group.buckets.map((bucket) => {
                        const pct = Math.max(0, Math.min(100, bucket.remaining_fraction * 100));
                        return (
                          <div key={bucket.id || bucket.name} className="space-y-1">
                            <div className="text-xs font-semibold text-on-surface">
                              {bucket.name}
                            </div>

                            <div className="flex items-center gap-1.5 font-mono text-xs">
                              <span className="text-outline font-semibold select-none">[</span>
                              <div className="flex-1 h-3.5 bg-surface-container-highest dark:bg-[#2d1225] rounded-xs overflow-hidden border border-outline-variant/30">
                                <div
                                  className="h-full bg-[#10b981] rounded-xs transition-all duration-500"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-outline font-semibold select-none">]</span>
                              <span className="w-14 text-right text-xs font-mono font-semibold text-on-surface">
                                {pct.toFixed(2)}%
                              </span>
                            </div>

                            <div className="text-[11px] font-mono text-[#10b981]">
                              {formatResetCountdown(bucket.reset_time, bucket.remaining_fraction)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/20 text-center space-y-2 text-xs">
              <div className="flex items-center justify-center gap-2 text-outline">
                <span className="material-symbols-outlined text-[18px] animate-spin">
                  progress_activity
                </span>
                <span>Acquiring live limits from /quota...</span>
              </div>
              <p className="text-[11px] text-outline">
                Antigravity CLI is evaluating capacity for your linked Google account.
              </p>
            </div>
          )}

          {/* Quota Description Footer */}
          {quotaLimits?.description && (
            <p className="text-[10px] text-outline leading-tight pt-1 border-t border-outline-variant/15">
              {quotaLimits.description}
            </p>
          )}
        </div>
      )}
    </>
  );

  return (
    <header className={`fixed top-0 left-0 right-0 lg:left-[260px] ${isInspectorOpen ? 'xl:right-[380px]' : 'xl:right-0'} h-14 bg-background/90 backdrop-blur-md border-b border-outline-variant/30 pl-2 sm:pl-2.5 lg:pl-gutter-desktop pr-3 sm:pr-4 md:pr-gutter-desktop flex items-center justify-between z-40 transition-all duration-300`}>
      <div className="flex items-center shrink-0">
        {/* Mobile Hamburger Toggle for Left Sidebar */}
        <button
          onClick={onToggleSidebar}
          className="lg:hidden h-[34px] w-[34px] inline-flex items-center justify-center rounded-lg text-outline hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer shrink-0 z-20"
          title="Open Workflows Menu"
          aria-label="Open sidebar"
        >
          <span className="material-symbols-outlined text-[20px] leading-none">menu</span>
        </button>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 md:gap-space-md min-w-0 shrink">
        {/* Interactive Sandbox Selector & Quota Chip */}
        <div className="relative shrink-0 flex items-center" ref={sandboxRef}>
          <button
            id="cloud-sandboxes-menu-button"
            type="button"
            onClick={() => {
              setShowSandboxDropdown(!showSandboxDropdown);
            }}
            className="h-[34px] inline-flex items-center gap-1 sm:gap-1.5 bg-surface-container-low hover:bg-surface-container px-2 sm:px-2.5 rounded-lg border border-outline-variant/30 hover:border-outline-variant/60 font-code-sm text-code-sm text-on-surface transition-all cursor-pointer shadow-xs max-w-[150px] xs:max-w-[190px] sm:max-w-none"
            title={
              activeSandbox
                ? `Cloud Sandbox: ${activeSandbox.name} (Active)`
                : sandboxUsage && sandboxUsage.used >= sandboxUsage.max
                  ? `No Sandbox Active (Standby) - Quota Full (${sandboxUsage.used}/${sandboxUsage.max} Running)`
                  : 'No Sandbox Running (Standby) - Click to Start Sandbox VM'
            }
          >
            {activeSandbox ? (
              <div className="relative flex items-center justify-center shrink-0">
                <span className="absolute inline-flex h-2 w-2 rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </div>
            ) : (
              <div className="relative flex items-center justify-center shrink-0">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-400 dark:bg-slate-500" />
              </div>
            )}
            <span className={`material-symbols-outlined text-[15px] leading-none shrink-0 ${activeSandbox ? 'text-primary' : 'text-outline'}`}>
              {activeSandbox ? 'deployed_code' : 'cloud_off'}
            </span>
            <span className={`font-medium text-xs truncate leading-none max-w-[55px] xs:max-w-[85px] sm:max-w-[105px] lg:max-w-[140px] ${activeSandbox ? 'text-on-surface' : 'text-on-surface-variant'}`}>
              {activeSandbox ? activeSandbox.name : user ? 'No Sandbox' : 'Sandbox'}
            </span>
            {user && sandboxUsage && (
              <span
                className={`text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0.5 rounded font-mono font-medium leading-none shrink-0 ${activeSandbox
                  ? sandboxUsage.used >= sandboxUsage.max
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-secondary/10 text-secondary'
                  : 'bg-surface-container-high text-on-surface-variant'
                  }`}
              >
                {sandboxUsage.used}/{sandboxUsage.max}
              </span>
            )}
            <span className="material-symbols-outlined text-[14px] leading-none text-outline shrink-0">
              {showSandboxDropdown ? 'expand_less' : 'expand_more'}
            </span>
          </button>

          {/* Sandbox Environments - Desktop Popover & Mobile Modal */}
          {showSandboxDropdown && (
            <>
              {/* Desktop Popover (hidden sm:block) */}
              <div className="hidden sm:block absolute left-0 top-full mt-2 w-96 bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-2xl p-3.5 z-50 animate-in fade-in zoom-in-95 duration-150">
                {/* Header */}
                <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-outline-variant/20">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-primary">cloud_queue</span>
                    <div>
                      <h3 className="text-xs font-bold text-on-surface tracking-wide">Cloud Sandboxes</h3>
                      <p className="text-[10px] text-outline">Share workspaces across multiple chat sessions</p>
                    </div>
                  </div>
                  {sandboxUsage && (
                    <span
                      className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border ${sandboxUsage.used >= sandboxUsage.max
                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                        : 'bg-secondary/10 text-secondary border-secondary/20'
                        }`}
                    >
                      {sandboxUsage.used}/{sandboxUsage.max} {sandboxUsage.used >= sandboxUsage.max ? 'FULL' : 'SLOTS'}
                    </span>
                  )}
                </div>

                {/* Explainer Tip */}
                <div className="bg-surface-container/60 rounded-lg p-2 mb-3 text-[11px] text-on-surface-variant flex items-start gap-1.5 border border-outline-variant/15">
                  <span className="material-symbols-outlined text-[14px] text-primary shrink-0 mt-0.5">info</span>
                  <span>
                    Multiple chats can attach to the <strong>same sandbox</strong> to collaborate without consuming extra quota.
                  </span>
                </div>

                {/* Sandboxes List or Empty Standby State */}
                <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5 mb-3 custom-scrollbar">
                  {!user ? (
                    <div className="p-3.5 bg-surface-container-low rounded-xl border border-outline-variant/25 text-center">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary mx-auto flex items-center justify-center mb-2 shadow-xs">
                        <span className="material-symbols-outlined text-[22px]">lock</span>
                      </div>
                      <h4 className="text-xs font-bold text-on-surface mb-1">Sign In Required</h4>
                      <p className="text-[11px] text-outline leading-relaxed mb-3">
                        Cloud sandboxes and workspaces are private. Sign in to boot, attach, and access your isolated microVMs.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSandboxDropdown(false);
                          onOpenAuthModal();
                        }}
                        className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-primary hover:bg-primary-fixed-dim text-on-primary font-medium text-xs shadow-xs transition-all cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[15px]">login</span>
                        <span className="hidden sm:inline">Sign in with Google</span>
                        <span className="sm:hidden">Sign In</span>
                      </button>
                    </div>
                  ) : (!sandboxUsage?.sandboxes || sandboxUsage.sandboxes.length === 0) ? (
                    <div className="p-3.5 bg-surface-container-low rounded-xl border border-outline-variant/25 text-center">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary mx-auto flex items-center justify-center mb-2 shadow-xs">
                        <span className="material-symbols-outlined text-[22px]">rocket_launch</span>
                      </div>
                      <h4 className="text-xs font-bold text-on-surface mb-1">Sandbox VM in Standby</h4>
                      <p className="text-[11px] text-outline leading-relaxed mb-3">
                        Start an isolated cloud microVM to execute code, run bash commands, and access dedicated workspace (<code className="text-primary font-mono text-[10px]">/workspace</code>).
                      </p>
                      <button
                        type="button"
                        onClick={handleCreateSandbox}
                        disabled={isCreatingSandbox}
                        className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-primary hover:bg-primary-fixed-dim text-on-primary font-medium text-xs shadow-xs transition-all cursor-pointer disabled:opacity-50"
                      >
                        {isCreatingSandbox ? (
                          <>
                            <span className="material-symbols-outlined text-[15px] animate-spin">progress_activity</span>
                            <span>Booting Cloud MicroVM...</span>
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-outlined text-[15px]">bolt</span>
                            <span>Start Sandbox VM</span>
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    sandboxUsage.sandboxes.map((sb, index) => {
                      const isCurrent = activeSandbox?.sandboxId === sb.sandboxId;
                      const isSwitching = switchingSandboxId === sb.sandboxId;
                      const displayName = sb.name || `Sandbox #${index + 1} (${sb.sandboxId.substring(0, 6)})`;
                      return (
                        <div
                          key={sb.sandboxId}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (sb.isProvisioning) return;
                            if (!isCurrent && !isSwitching) {
                              handleSwitchSandbox(sb.sandboxId);
                            } else if (isCurrent) {
                              setShowSandboxDropdown(false);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              if (sb.isProvisioning) return;
                              if (!isCurrent && !isSwitching) {
                                handleSwitchSandbox(sb.sandboxId);
                              } else if (isCurrent) {
                                setShowSandboxDropdown(false);
                              }
                            }
                          }}
                          className={`p-2.5 rounded-lg border transition-all select-none active:scale-[0.99] ${sb.isProvisioning
                            ? 'bg-surface-container-low/60 border-primary/20 opacity-80 cursor-wait'
                            : isCurrent
                              ? 'bg-primary/10 border-primary/40 shadow-xs cursor-default'
                              : 'bg-surface-container-low hover:bg-surface-container active:bg-surface-container-high hover:border-primary/40 border-outline-variant/20 cursor-pointer'
                            }`}
                          title={sb.isProvisioning ? `${displayName} is initializing cloud microVM and toolchains...` : isCurrent ? `${displayName} is currently active in this chat` : `Click to switch active chat to ${displayName}`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {sb.isProvisioning ? (
                                <span className="material-symbols-outlined text-[16px] text-primary shrink-0 animate-spin">progress_activity</span>
                              ) : isSwitching ? (
                                <span className="material-symbols-outlined text-[16px] text-primary shrink-0 animate-spin">progress_activity</span>
                              ) : isCurrent ? (
                                <span className="material-symbols-outlined text-[16px] text-primary shrink-0">check_circle</span>
                              ) : (
                                <span className="material-symbols-outlined text-[16px] text-outline shrink-0">radio_button_unchecked</span>
                              )}
                              <span className="font-semibold text-xs text-on-surface truncate" title={displayName}>
                                {displayName}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {sb.isProvisioning ? (
                                <span className="text-[10px] bg-primary/10 text-primary border border-primary/30 px-1.5 py-0.5 rounded font-medium flex items-center gap-1 animate-pulse" title="Cloud microVM is booting and configuring security boundary">
                                  <span className="material-symbols-outlined text-[11px] animate-spin">progress_activity</span>
                                  Booting VM
                                </span>
                              ) : (
                                <>
                                  {sb.isUpdating && (
                                    <span className="text-[10px] bg-amber-500/10 text-amber-500 border border-amber-500/30 px-1.5 py-0.5 rounded font-medium flex items-center gap-1" title="24h maintenance in progress: updating sandbox CLIs">
                                      <span className="material-symbols-outlined text-[11px] animate-spin">sync</span>
                                      Updating CLIs
                                    </span>
                                  )}
                                  {isCurrent && (
                                    <span className="text-[10px] bg-primary text-on-primary px-1.5 py-0.2 rounded font-medium">
                                      Active Chat
                                    </span>
                                  )}
                                  {isSwitching && (
                                    <span className="text-[10px] text-primary font-medium animate-pulse">
                                      Attaching...
                                    </span>
                                  )}
                                </>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteSandbox(sb.sandboxId, displayName, 0, isCurrent);
                                }}
                                disabled={deletingSandboxId === sb.sandboxId || sb.isProvisioning}
                                className={`p-1 rounded text-outline hover:text-error hover:bg-error/10 transition-colors ${sb.isProvisioning ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                                title={sb.isProvisioning ? 'Sandbox is initializing' : 'Delete this sandbox to free up 1 slot'}
                              >
                                <span className="material-symbols-outlined text-[15px]">
                                  {deletingSandboxId === sb.sandboxId ? 'sync' : 'delete'}
                                </span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Actions Footer */}
                <div className="pt-2 border-t border-outline-variant/20 flex flex-col gap-2">
                  {sandboxUsage && sandboxUsage.sandboxes && sandboxUsage.sandboxes.length > 0 && (
                    <button
                      type="button"
                      onClick={handleCreateSandbox}
                      disabled={
                        isCreatingSandbox ||
                        (sandboxUsage !== null && sandboxUsage.used >= sandboxUsage.max)
                      }
                      className={`w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${isCreatingSandbox
                        ? 'bg-surface-container text-outline cursor-wait opacity-60'
                        : sandboxUsage !== null && sandboxUsage.used >= sandboxUsage.max
                          ? 'bg-surface-container text-outline cursor-not-allowed opacity-60'
                          : 'bg-primary text-on-primary hover:bg-primary/90 shadow-xs cursor-pointer'
                        }`}
                      title={
                        sandboxUsage !== null && sandboxUsage.used >= sandboxUsage.max
                          ? `Quota limit reached (${sandboxUsage.used}/${sandboxUsage.max} full). Delete an existing sandbox using the trash icon to create a new one.`
                          : 'Create a brand new isolated sandbox environment'
                      }
                    >
                      <span className={`material-symbols-outlined text-[16px] ${isCreatingSandbox ? 'animate-spin' : ''}`}>
                        {isCreatingSandbox ? 'progress_activity' : 'add_circle'}
                      </span>
                      <span>
                        {isCreatingSandbox
                          ? 'Launching Cloud MicroVM...'
                          : sandboxUsage !== null && sandboxUsage.used >= sandboxUsage.max
                            ? `Quota Full (${sandboxUsage.used}/${sandboxUsage.max})`
                            : 'New Isolated Sandbox'}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setShowSandboxDropdown(false);
                      onToggleInspector?.();
                    }}
                    className="w-full flex items-center justify-center gap-1 py-1 px-2 rounded text-[11px] text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">folder_open</span>
                    <span>Inspect Workspace Files & Telemetry</span>
                  </button>
                </div>
              </div>

              {/* Mobile Modal (sm:hidden) via React Portal */}
              {createPortal(
                <div
                  className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs sm:hidden animate-fade-in"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) setShowSandboxDropdown(false);
                  }}
                >
                  <div
                    ref={mobileSandboxModalRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="cloud-sandboxes-title"
                    className="w-full max-w-sm bg-surface-container-lowest border border-outline-variant/30 rounded-2xl shadow-2xl p-4 animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Modal Header */}
                    <div className="flex items-center justify-between pb-3 mb-2.5 border-b border-outline-variant/20 shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[20px] text-primary">cloud_queue</span>
                        <div>
                          <h3 id="cloud-sandboxes-title" className="text-sm font-bold text-on-surface tracking-wide">Cloud Sandboxes</h3>
                          <p className="text-[10px] text-outline">Share workspaces across multiple chat sessions</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {sandboxUsage && (
                          <span
                            className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border ${sandboxUsage.used >= sandboxUsage.max
                              ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                              : 'bg-secondary/10 text-secondary border-secondary/20'
                              }`}
                          >
                            {sandboxUsage.used}/{sandboxUsage.max} {sandboxUsage.used >= sandboxUsage.max ? 'FULL' : 'SLOTS'}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowSandboxDropdown(false)}
                          className="w-7 h-7 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-all cursor-pointer"
                          title="Close"
                        >
                          <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                      </div>
                    </div>

                    {/* Explainer Tip */}
                    <div className="bg-surface-container/60 rounded-lg p-2.5 mb-3 text-[11px] text-on-surface-variant flex items-start gap-1.5 border border-outline-variant/15 shrink-0">
                      <span className="material-symbols-outlined text-[14px] text-primary shrink-0 mt-0.5">info</span>
                      <span>
                        Multiple chats can attach to the <strong>same sandbox</strong> to collaborate without consuming extra quota.
                      </span>
                    </div>

                    {/* Sandboxes List or Empty Standby State */}
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5 mb-3 custom-scrollbar flex-1">
                      {!user ? (
                        <div className="p-3.5 bg-surface-container-low rounded-xl border border-outline-variant/25 text-center">
                          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary mx-auto flex items-center justify-center mb-2 shadow-xs">
                            <span className="material-symbols-outlined text-[22px]">lock</span>
                          </div>
                          <h4 className="text-xs font-bold text-on-surface mb-1">Sign In Required</h4>
                          <p className="text-[11px] text-outline leading-relaxed mb-3">
                            Cloud sandboxes and workspaces are private. Sign in to boot, attach, and access your isolated microVMs.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setShowSandboxDropdown(false);
                              onOpenAuthModal();
                            }}
                            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-primary hover:bg-primary-fixed-dim text-on-primary font-medium text-xs shadow-xs transition-all cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[15px]">login</span>
                            <span className="hidden sm:inline">Sign in with Google</span>
                            <span className="sm:hidden">Sign In</span>
                          </button>
                        </div>
                      ) : (!sandboxUsage?.sandboxes || sandboxUsage.sandboxes.length === 0) ? (
                        <div className="p-3.5 bg-surface-container-low rounded-xl border border-outline-variant/25 text-center">
                          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary mx-auto flex items-center justify-center mb-2 shadow-xs">
                            <span className="material-symbols-outlined text-[22px]">rocket_launch</span>
                          </div>
                          <h4 className="text-xs font-bold text-on-surface mb-1">Sandbox VM in Standby</h4>
                          <p className="text-[11px] text-outline leading-relaxed mb-3">
                            Start an isolated cloud microVM to execute code, run bash commands, and access dedicated workspace (<code className="text-primary font-mono text-[10px]">/workspace</code>).
                          </p>
                          <button
                            type="button"
                            onClick={handleCreateSandbox}
                            disabled={isCreatingSandbox}
                            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-primary hover:bg-primary-fixed-dim text-on-primary font-medium text-xs shadow-xs transition-all cursor-pointer disabled:opacity-50"
                          >
                            {isCreatingSandbox ? (
                              <>
                                <span className="material-symbols-outlined text-[15px] animate-spin">progress_activity</span>
                                <span>Booting Cloud MicroVM...</span>
                              </>
                            ) : (
                              <>
                                <span className="material-symbols-outlined text-[15px]">bolt</span>
                                <span>Start Sandbox VM</span>
                              </>
                            )}
                          </button>
                        </div>
                      ) : (
                        sandboxUsage.sandboxes.map((sb, index) => {
                          const isCurrent = activeSandbox?.sandboxId === sb.sandboxId;
                          const isSwitching = switchingSandboxId === sb.sandboxId;
                          const displayName = sb.name || `Sandbox #${index + 1} (${sb.sandboxId.substring(0, 6)})`;
                          return (
                            <div
                              key={sb.sandboxId}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                if (sb.isProvisioning) return;
                                if (!isCurrent && !isSwitching) {
                                  handleSwitchSandbox(sb.sandboxId);
                                } else if (isCurrent) {
                                  setShowSandboxDropdown(false);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  if (sb.isProvisioning) return;
                                  if (!isCurrent && !isSwitching) {
                                    handleSwitchSandbox(sb.sandboxId);
                                  } else if (isCurrent) {
                                    setShowSandboxDropdown(false);
                                  }
                                }
                              }}
                              className={`p-2.5 rounded-lg border transition-all select-none active:scale-[0.99] ${sb.isProvisioning
                                ? 'bg-surface-container-low/60 border-primary/20 opacity-80 cursor-wait'
                                : isCurrent
                                  ? 'bg-primary/10 border-primary/40 shadow-xs cursor-default'
                                  : 'bg-surface-container-low hover:bg-surface-container active:bg-surface-container-high hover:border-primary/40 border-outline-variant/20 cursor-pointer'
                                }`}
                              title={sb.isProvisioning ? `${displayName} is initializing cloud microVM and toolchains...` : isCurrent ? `${displayName} is currently active in this chat` : `Click to switch active chat to ${displayName}`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {sb.isProvisioning ? (
                                    <span className="material-symbols-outlined text-[16px] text-primary shrink-0 animate-spin">progress_activity</span>
                                  ) : isSwitching ? (
                                    <span className="material-symbols-outlined text-[16px] text-primary shrink-0 animate-spin">progress_activity</span>
                                  ) : isCurrent ? (
                                    <span className="material-symbols-outlined text-[16px] text-primary shrink-0">check_circle</span>
                                  ) : (
                                    <span className="material-symbols-outlined text-[16px] text-outline shrink-0">radio_button_unchecked</span>
                                  )}
                                  <span className="font-semibold text-xs text-on-surface truncate" title={displayName}>
                                    {displayName}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {sb.isProvisioning ? (
                                    <span className="text-[10px] bg-primary/10 text-primary border border-primary/30 px-1.5 py-0.5 rounded font-medium flex items-center gap-1 animate-pulse" title="Cloud microVM is booting and configuring security boundary">
                                      <span className="material-symbols-outlined text-[11px] animate-spin">progress_activity</span>
                                      Booting VM
                                    </span>
                                  ) : (
                                    <>
                                      {sb.isUpdating && (
                                        <span className="text-[10px] bg-amber-500/10 text-amber-500 border border-amber-500/30 px-1.5 py-0.5 rounded font-medium flex items-center gap-1" title="24h maintenance in progress: updating sandbox CLIs">
                                          <span className="material-symbols-outlined text-[11px] animate-spin">sync</span>
                                          Updating CLIs
                                        </span>
                                      )}
                                      {isCurrent && (
                                        <span className="text-[10px] bg-primary text-on-primary px-1.5 py-0.2 rounded font-medium">
                                          Active Chat
                                        </span>
                                      )}
                                      {isSwitching && (
                                        <span className="text-[10px] text-primary font-medium animate-pulse">
                                          Attaching...
                                        </span>
                                      )}
                                    </>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteSandbox(sb.sandboxId, displayName, 0, isCurrent);
                                    }}
                                    disabled={deletingSandboxId === sb.sandboxId || sb.isProvisioning}
                                    className={`p-1 rounded text-outline hover:text-error hover:bg-error/10 transition-colors ${sb.isProvisioning ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                                    title={sb.isProvisioning ? 'Sandbox is initializing' : 'Delete this sandbox to free up 1 slot'}
                                  >
                                    <span className="material-symbols-outlined text-[15px]">
                                      {deletingSandboxId === sb.sandboxId ? 'sync' : 'delete'}
                                    </span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Actions Footer */}
                    <div className="pt-2 border-t border-outline-variant/20 flex flex-col gap-2 shrink-0">
                      {sandboxUsage && sandboxUsage.sandboxes && sandboxUsage.sandboxes.length > 0 && (
                        <button
                          type="button"
                          onClick={handleCreateSandbox}
                          disabled={
                            isCreatingSandbox ||
                            (sandboxUsage !== null && sandboxUsage.used >= sandboxUsage.max)
                          }
                          className={`w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${isCreatingSandbox
                            ? 'bg-surface-container text-outline cursor-wait opacity-60'
                            : sandboxUsage !== null && sandboxUsage.used >= sandboxUsage.max
                              ? 'bg-surface-container text-outline cursor-not-allowed opacity-60'
                              : 'bg-primary text-on-primary hover:bg-primary/90 shadow-xs cursor-pointer'
                            }`}
                          title={
                            sandboxUsage !== null && sandboxUsage.used >= sandboxUsage.max
                              ? `Quota limit reached (${sandboxUsage.used}/${sandboxUsage.max} full). Delete an existing sandbox using the trash icon to create a new one.`
                              : 'Create a brand new isolated sandbox environment'
                          }
                        >
                          <span className={`material-symbols-outlined text-[16px] ${isCreatingSandbox ? 'animate-spin' : ''}`}>
                            {isCreatingSandbox ? 'progress_activity' : 'add_circle'}
                          </span>
                          <span>
                            {isCreatingSandbox
                              ? 'Launching Cloud MicroVM...'
                              : sandboxUsage !== null && sandboxUsage.used >= sandboxUsage.max
                                ? `Quota Full (${sandboxUsage.used}/${sandboxUsage.max})`
                                : 'New Isolated Sandbox'}
                          </span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setShowSandboxDropdown(false);
                          onToggleInspector?.();
                        }}
                        className="w-full flex items-center justify-center gap-1 py-1.5 px-2 rounded text-[11px] text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[14px]">folder_open</span>
                        <span>Inspect Workspace Files & Telemetry</span>
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )}
            </>
          )}
        </div>

        {/* Real CLI Telemetry Chip */}
        <div className="relative shrink-0 flex items-center" ref={popoverRef}>
          {isNoneSelected ? (
            <button
              type="button"
              onClick={() => setShowLimitsPopover(!showLimitsPopover)}
              className="h-[34px] inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 rounded-lg border border-dashed border-outline-variant/40 bg-surface-container-low text-outline hover:text-on-surface hover:border-outline-variant/80 font-code-sm text-code-sm transition-all cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
              title="No model selected. Click to view status or select a model below to activate live quota telemetry."
            >
              <span className="material-symbols-outlined text-[14px] leading-none text-outline shrink-0">speed</span>
              <span className="text-[11px] font-mono text-outline whitespace-nowrap hidden lg:inline leading-none">Telemetry: Standby</span>
              <span className="text-[11px] font-mono text-outline whitespace-nowrap hidden sm:inline lg:hidden leading-none">Standby</span>
              <span className="text-[10px] font-mono text-outline whitespace-nowrap sm:hidden leading-none">Standby</span>
              <span className="material-symbols-outlined text-[13px] leading-none text-outline shrink-0 hidden sm:inline">
                {showLimitsPopover ? 'expand_less' : 'expand_more'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowLimitsPopover(!showLimitsPopover)}
              className={`h-[34px] inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 rounded-lg border font-code-sm text-code-sm transition-all cursor-pointer whitespace-nowrap shrink-0 shadow-xs ${!isModelLinked
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/15'
                : isAnyLimitExhausted
                  ? 'bg-rose-500/10 text-rose-300 border-rose-500/30 hover:bg-rose-500/15'
                  : 'bg-surface-container-low text-on-surface hover:bg-surface-container border-outline-variant/20'
                }`}
              title={
                !isModelLinked
                  ? `${providerLabel} CLI not linked. Click to link account.`
                  : isAntigravity && fraction5h !== undefined && fractionWeekly !== undefined
                    ? `Antigravity CLI Quota (${relevantGroup?.name || 'All'}): 5-hour rolling: ${Math.round(
                      fraction5h * 100
                    )}%, Weekly tier: ${Math.round(fractionWeekly * 100)}%. Click to view details.`
                    : `Click to view authentic ${providerLabel} CLI quota & telemetry${relevantGroup ? ` (${relevantGroup.name})` : ''
                    }`
              }
            >
              {!isModelLinked ? (
                <>
                  <span className="material-symbols-outlined text-[14px] leading-none text-amber-400 shrink-0">
                    lock
                  </span>
                  <span className="text-amber-400 font-medium whitespace-nowrap hidden sm:inline leading-none">
                    {`${providerLabel} Not Linked`}
                  </span>
                  <span className="text-amber-400 font-medium whitespace-nowrap sm:hidden text-[10px] leading-none">
                    Unlinked
                  </span>
                </>
              ) : (
                <>
                  {providerIcon}
                  <span className="whitespace-nowrap hidden lg:inline leading-none">{`${providerLabel}: ${quotaBadgeText}`}</span>
                  <span className="whitespace-nowrap hidden sm:inline lg:hidden font-mono text-xs leading-none">{quotaBadgeText}</span>
                  <span className="whitespace-nowrap sm:hidden font-mono text-[10px] font-semibold leading-none">{mobileQuotaBadgeText}</span>
                </>
              )}
              <span className="material-symbols-outlined text-[13px] leading-none text-outline shrink-0 hidden sm:inline">
                {showLimitsPopover ? 'expand_less' : 'expand_more'}
              </span>
            </button>
          )}

          {/* Detailed Real CLI Usage Telemetry Popover (Desktop) & Mobile Modal Portal */}
          {showLimitsPopover && (
            <>
              {/* Desktop Popover */}
              <div className="hidden sm:block absolute right-0 top-full mt-2 w-[390px] sm:w-[440px] max-h-[85vh] overflow-y-auto p-space-md rounded-2xl bg-surface-container border border-outline-variant/30 shadow-2xl backdrop-blur-xl z-50 animate-in fade-in slide-in-from-top-1">
                {renderLimitsContent(false)}
              </div>

              {/* Mobile Modal via React Portal */}
              {createPortal(
                <div
                  className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-xs sm:hidden animate-fade-in"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) setShowLimitsPopover(false);
                  }}
                >
                  <div
                    ref={mobileLimitsModalRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="cli-telemetry-title"
                    className="w-full max-w-md bg-surface-container border border-outline-variant/30 rounded-t-3xl sm:rounded-2xl shadow-2xl p-4 animate-in slide-in-from-bottom duration-150 max-h-[85vh] flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Pull Bar Handle for mobile */}
                    <div className="w-10 h-1 bg-outline-variant/50 rounded-full mx-auto mb-2 shrink-0 sm:hidden" />

                    <div className="overflow-y-auto custom-scrollbar flex-1 pr-0.5">
                      {renderLimitsContent(true)}
                    </div>
                  </div>
                </div>,
                document.body
              )}
            </>
          )}
        </div>

        {/* Day / Night Mode Toggle */}
        <button
          onClick={onToggleTheme}
          className="h-[34px] w-[34px] inline-flex items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container-low hover:bg-surface-container text-outline hover:text-on-surface transition-all cursor-pointer shrink-0 shadow-xs"
          title={isDarkMode ? 'Switch to Day Mode' : 'Switch to Night Mode'}
          aria-label={isDarkMode ? 'Switch to Day Mode' : 'Switch to Night Mode'}
        >
          <span className="material-symbols-outlined text-[18px] leading-none">
            {isDarkMode ? 'light_mode' : 'dark_mode'}
          </span>
        </button>

        {/* Cloud Inspector Toggle (Desktop & Mobile) */}
        <button
          onClick={onToggleInspector}
          className={`h-[34px] inline-flex items-center gap-1.5 px-2.5 rounded-lg font-code-sm text-code-sm border cursor-pointer shrink-0 transition-all active:scale-95 shadow-xs ${isInspectorOpen
            ? 'bg-primary/15 text-primary border-primary/35'
            : 'bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-on-surface border-outline-variant/30'
            }`}
          title={isInspectorOpen ? 'Hide Cloud Inspector' : 'Show Cloud Inspector'}
        >
          <span className="material-symbols-outlined text-[16px] leading-none">troubleshoot</span>
          <span className="hidden sm:inline font-medium leading-none">Inspector</span>
        </button>

        <div className="hidden sm:block h-5 w-px bg-outline-variant/30 self-center shrink-0" />

        {/* User Account & Dual Platform Login */}
        <div className="mr-2 sm:mr-3 md:mr-3.5 shrink-0 flex items-center">
          <UserMenu
            user={user}
            onOpenAuthModal={onOpenAuthModal}
            onLogout={onLogout}
          />
        </div>
      </div>

      {/* Custom Delete Sandbox Confirmation Modal */}
      <DeleteSandboxModal
        isOpen={!!sandboxPendingDelete}
        sandbox={sandboxPendingDelete}
        isDeleting={!!deletingSandboxId}
        error={deleteError}
        onConfirm={confirmDeleteSandbox}
        onCancel={() => {
          if (!deletingSandboxId) {
            setSandboxPendingDelete(null);
            setDeleteError(null);
          }
        }}
      />
    </header>
  );
};
