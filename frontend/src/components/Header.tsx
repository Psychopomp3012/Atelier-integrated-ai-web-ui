import React, { useState, useRef, useEffect, useMemo } from 'react';
import { UserMenu } from './UserMenu';
import type { UserProfile, TokenUsageState, ModelOption, ModelType } from '../types';
import { formatTokenMetric } from '../utils/token.util';
import { apiFetch } from '../utils/api.util';

interface SandboxUsageData {
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
  user: UserProfile | null;
  onOpenAuthModal: () => void;
  onLogout: () => void;
  isDarkMode?: boolean;
  onToggleTheme?: () => void;
  currentSessionId?: string | null;
  onSandboxChanged?: (sandboxId: string) => void;
  sandboxUsage?: SandboxUsageData | null;
  validSessionIds?: string[];
  activeSandbox?: { sandboxId: string; name: string } | null;
  onRefreshSandboxUsage?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  clusterRegion: _clusterRegion,
  sandboxName: _sandboxName,
  tokenUsage,
  modelName = 'Gemini 2.5 Pro',
  selectedModel,
  selectedModelOption,
  isModelLinked = true,
  activeProvider: propsActiveProvider,
  onToggleSidebar,
  onToggleInspector,
  user,
  onOpenAuthModal,
  onLogout,
  isDarkMode = true,
  onToggleTheme,
  currentSessionId,
  onSandboxChanged,
  sandboxUsage: propSandboxUsage,
  activeSandbox: propActiveSandbox,
  onRefreshSandboxUsage,
  validSessionIds,
}) => {
  const [showLimitsPopover, setShowLimitsPopover] = useState(false);
  const [telemetryTab, setTelemetryTab] = useState<'quota' | 'session'>('quota');
  const popoverRef = useRef<HTMLDivElement>(null);

  const [showSandboxDropdown, setShowSandboxDropdown] = useState(false);
  const [internalSandboxUsage, setInternalSandboxUsage] = useState<SandboxUsageData | null>(null);
  const [isCreatingSandbox, setIsCreatingSandbox] = useState(false);
  const [switchingSandboxId, setSwitchingSandboxId] = useState<string | null>(null);
  const [deletingSandboxId, setDeletingSandboxId] = useState<string | null>(null);
  const sandboxRef = useRef<HTMLDivElement>(null);

  const validSessionSet = useMemo(() => new Set(validSessionIds || []), [validSessionIds]);
  const sandboxUsage = propSandboxUsage !== undefined ? propSandboxUsage : internalSandboxUsage;

  const fetchSandboxUsage = async () => {
    try {
      onRefreshSandboxUsage?.();
      const activeIds = (validSessionIds || []).join(',');
      const params = new URLSearchParams();
      if (user?.id) params.set('userId', user.id);
      params.set('activeSessionIds', activeIds);
      const url = `/api/v1/sandbox/usage?${params.toString()}`;
      const res = await apiFetch(url);
      const data = await res.json();
      if (data.success && data.data) {
        setInternalSandboxUsage(data.data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchSandboxUsage();
  }, [currentSessionId, user, validSessionIds]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowLimitsPopover(false);
      }
      if (sandboxRef.current && !sandboxRef.current.contains(e.target as Node)) {
        setShowSandboxDropdown(false);
      }
    };
    if (showLimitsPopover || showSandboxDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showLimitsPopover, showSandboxDropdown]);

  const activeSandbox = useMemo(() => {
    if (propActiveSandbox) return propActiveSandbox;
    if (!sandboxUsage?.sandboxes || sandboxUsage.sandboxes.length === 0) return null;
    if (!currentSessionId) return null;
    const cleanSession = currentSessionId.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32);
    return sandboxUsage.sandboxes.find((s) => s.attachedSessionIds?.includes(cleanSession)) || null;
  }, [propActiveSandbox, sandboxUsage, currentSessionId]);

  const handleSwitchSandbox = async (targetSandboxId: string) => {
    if (switchingSandboxId) return;
    setSwitchingSandboxId(targetSandboxId);
    try {
      const cleanSession = (currentSessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32);
      const res = await apiFetch('/api/v1/sandbox/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: cleanSession, sandboxId: targetSandboxId }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.data?.usage) {
          setInternalSandboxUsage(data.data.usage);
        }
        setSwitchingSandboxId(null);
        fetchSandboxUsage();
        onSandboxChanged?.(targetSandboxId);
        setShowSandboxDropdown(false);
      }
    } catch (err) {
      console.error('Failed to attach session to sandbox', err);
    } finally {
      setSwitchingSandboxId(null);
    }
  };

  const handleCreateSandbox = async () => {
    if (isCreatingSandbox) return;

    if (sandboxUsage && sandboxUsage.used >= sandboxUsage.max) {
      alert(
        `Sandbox quota limit reached (${sandboxUsage.used}/${sandboxUsage.max} full).\n\nPlease delete one of your existing sandboxes using the trash icon to free a quota slot before creating a new one.`
      );
      return;
    }

    setIsCreatingSandbox(true);
    try {
      const cleanSession = (currentSessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32);
      const res = await apiFetch('/api/v1/sandbox/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: cleanSession, userId: user?.id }),
      });
      const data = await res.json();
      if (data.success && data.data?.sandboxId) {
        if (data.data.usage) {
          setInternalSandboxUsage(data.data.usage);
        }
        setIsCreatingSandbox(false);
        fetchSandboxUsage();
        onSandboxChanged?.(data.data.sandboxId);
        setShowSandboxDropdown(false);
      } else {
        setIsCreatingSandbox(false);
        alert(data.error?.message || 'Failed to create new sandbox VM');
      }
    } catch (err) {
      setIsCreatingSandbox(false);
      console.error('Failed to create new sandbox', err);
      alert('Failed to connect to backend to create sandbox');
    } finally {
      setIsCreatingSandbox(false);
    }
  };

  const handleDeleteSandbox = async (targetId: string, targetName: string, attachedCount: number) => {
    const warning =
      attachedCount > 1
        ? `Warning: ${attachedCount} chats are currently attached to ${targetName}. Deleting it will terminate this cloud microVM and erase its workspace for all attached chats. Continue?`
        : `Are you sure you want to delete ${targetName}? This will permanently terminate the cloud microVM and release 1 sandbox quota slot.`;
    if (!window.confirm(warning)) return;
    setDeletingSandboxId(targetId);
    try {
      const res = await apiFetch(`/api/v1/sandbox?sandboxId=${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        await fetchSandboxUsage();
        onSandboxChanged?.('');
      }
    } catch (err) {
      console.error('Failed to delete sandbox', err);
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

  const used = tokenUsage ? tokenUsage.totalTokens : 0;
  const promptTokens = tokenUsage ? tokenUsage.promptTokens : 0;
  const completionTokens = tokenUsage ? tokenUsage.completionTokens : 0;
  const thinkingTokens = tokenUsage ? tokenUsage.thinkingTokens : 0;
  const cacheReadTokens = tokenUsage ? tokenUsage.cacheReadTokens : 0;
  const totalTurns = tokenUsage ? tokenUsage.totalTurns : 0;
  const lastLatencyMs = tokenUsage ? tokenUsage.lastLatencyMs : 0;
  const avgLatencyMs = tokenUsage ? tokenUsage.avgLatencyMs : 0;
  const linkedEmail = isCodex
    ? (tokenUsage?.codexQuota?.userEmail || tokenUsage?.userEmail || user?.email)
    : (tokenUsage?.userEmail || user?.email);
  const quotaLimits = isCodex
    ? (tokenUsage?.codexQuota?.quotaLimits || tokenUsage?.quotaLimits)
    : (tokenUsage?.geminiQuota?.quotaLimits || tokenUsage?.quotaLimits);

  // Identify the quota group corresponding to the selected model
  const relevantGroup = useMemo(() => {
    if (!quotaLimits?.groups || quotaLimits.groups.length === 0) return null;

    if (isCodex) {
      return quotaLimits.groups[0];
    }

    // For Antigravity CLI:
    // Group 0: "Gemini Models"
    // Group 1: "Claude and GPT models"
    const modelLower = (modelName || '').toLowerCase();
    const idLower = (selectedModel || '').toLowerCase();
    const is3pModel =
      modelLower.includes('claude') ||
      modelLower.includes('gpt') ||
      modelLower.includes('opus') ||
      modelLower.includes('sonnet') ||
      modelLower.includes('oss') ||
      idLower.includes('claude') ||
      idLower.includes('gpt') ||
      idLower.includes('opus') ||
      idLower.includes('sonnet') ||
      idLower.includes('oss');

    if (is3pModel) {
      const g3p = quotaLimits.groups.find(
        (g) =>
          g.name.toLowerCase().includes('claude') ||
          g.name.toLowerCase().includes('gpt') ||
          g.name.toLowerCase().includes('3p')
      );
      if (g3p) return g3p;
    }

    // Default to Gemini Models group
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

  // Option C: Dual mini-indicator for Antigravity (5h and Weekly), single for Codex/others
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

    // Single limit for Codex and other providers
    const singleFraction =
      fractionWeekly ??
      fraction5h ??
      relevantGroup?.buckets?.[0]?.remaining_fraction;

    if (singleFraction !== undefined) {
      return `${Math.round(singleFraction * 100)}% Quota`;
    }

    return used > 0 ? `${formatTokenMetric(used)} tokens` : 'Active';
  }, [isAntigravity, fraction5h, fractionWeekly, relevantGroup, used]);

  const formatResetCountdown = (isoDate?: string): string => {
    if (!isoDate) return 'Refreshed';
    const diffMs = new Date(isoDate).getTime() - Date.now();
    if (diffMs <= 0) return 'Refreshed';
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const minutes = totalMinutes % 60;
    const totalHours = Math.floor(totalMinutes / 60);

    if (totalHours >= 24) {
      const days = Math.floor(totalHours / 24);
      const hours = totalHours % 24;
      return `Refreshes in ${days}d ${hours}h ${minutes}m`;
    }
    return `Refreshes in ${totalHours}h ${minutes}m`;
  };

  return (
    <header className="fixed top-0 left-0 right-0 lg:left-[260px] xl:right-[360px] h-14 bg-background/90 backdrop-blur-md border-b border-outline-variant/30 px-3 md:px-gutter-desktop flex items-center justify-between z-40 transition-all">
      <div className="flex items-center gap-2 md:gap-space-md min-w-0">
        {/* Mobile Hamburger Toggle for Left Sidebar */}
        <button
          onClick={onToggleSidebar}
          className="lg:hidden p-1.5 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
          title="Open Workflows Menu"
        >
          <span className="material-symbols-outlined text-[20px]">menu</span>
        </button>
      </div>

      <div className="flex items-center gap-2 md:gap-space-md shrink-0">
        {/* Interactive Sandbox Selector & Quota Chip */}
        <div className="relative" ref={sandboxRef}>
          <button
            id="cloud-sandboxes-menu-button"
            type="button"
            onClick={() => {
              setShowSandboxDropdown(!showSandboxDropdown);
              if (!showSandboxDropdown) fetchSandboxUsage();
            }}
            className="flex items-center gap-1.5 bg-surface-container-low hover:bg-surface-container px-2 sm:px-2.5 py-1 rounded-lg border border-outline-variant/30 hover:border-outline-variant/60 font-code-sm text-code-sm text-on-surface transition-all cursor-pointer shadow-xs"
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
            <span className={`material-symbols-outlined text-[15px] shrink-0 ${activeSandbox ? 'text-primary' : 'text-outline'}`}>
              {activeSandbox ? 'deployed_code' : 'cloud_off'}
            </span>
            <span className={`font-medium text-xs truncate max-w-[80px] sm:max-w-[140px] ${activeSandbox ? 'text-on-surface' : 'text-on-surface-variant'}`}>
              {activeSandbox ? activeSandbox.name : 'No Sandbox'}
            </span>
            {sandboxUsage && (
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-medium ${
                  activeSandbox
                    ? sandboxUsage.used >= sandboxUsage.max
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-surface-container-high text-on-surface-variant'
                }`}
              >
                {sandboxUsage.used}/{sandboxUsage.max}
              </span>
            )}
            <span className="material-symbols-outlined text-[14px] text-outline">
              {showSandboxDropdown ? 'expand_less' : 'expand_more'}
            </span>
          </button>

          {/* Sandbox Environments Popover */}
          {showSandboxDropdown && (
            <div className="absolute left-0 top-full mt-2 w-80 sm:w-96 bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-2xl p-3.5 z-50 animate-in fade-in zoom-in-95 duration-150">
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
                    className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border ${
                      sandboxUsage.used >= sandboxUsage.max
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
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
                  Multiple chats can attach to the <strong>same sandbox</strong> to collaborate on the same files (/home/user/workspace) without consuming extra quota.
                </span>
              </div>

              {/* Sandboxes List or Empty Standby State */}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5 mb-3 custom-scrollbar">
                {(!sandboxUsage?.sandboxes || sandboxUsage.sandboxes.length === 0) ? (
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
                    const realChatCount = validSessionIds !== undefined
                      ? (sb.attachedSessionIds?.filter((id) => validSessionSet.has(id)).length || 0)
                      : (sb.attachedSessionCount || 0);
                    return (
                      <div
                        key={sb.sandboxId}
                        onClick={() => {
                          if (!isCurrent && !isSwitching) {
                            handleSwitchSandbox(sb.sandboxId);
                          } else if (isCurrent) {
                            setShowSandboxDropdown(false);
                          }
                        }}
                        className={`p-2.5 rounded-lg border transition-all ${
                          isCurrent
                            ? 'bg-primary/10 border-primary/40 shadow-xs cursor-default'
                            : 'bg-surface-container-low hover:bg-surface-container hover:border-primary/40 border-outline-variant/20 cursor-pointer'
                        }`}
                        title={isCurrent ? `${displayName} is currently active in this chat` : `Click to switch active chat to ${displayName}`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {isSwitching ? (
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
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteSandbox(sb.sandboxId, displayName, realChatCount);
                              }}
                              disabled={deletingSandboxId === sb.sandboxId}
                              className="p-1 rounded text-outline hover:text-error hover:bg-error/10 transition-colors cursor-pointer"
                              title="Delete this sandbox to free up 1 slot"
                            >
                              <span className="material-symbols-outlined text-[15px]">
                                {deletingSandboxId === sb.sandboxId ? 'sync' : 'delete'}
                              </span>
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-outline pl-5">
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px] text-primary">link</span>
                            <span>{realChatCount} chat{realChatCount === 1 ? '' : 's'} sharing workspace</span>
                          </span>
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
                    className={`w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                      isCreatingSandbox
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
                    <span className="material-symbols-outlined text-[16px]">
                      {isCreatingSandbox ? 'sync' : 'add_circle'}
                    </span>
                    <span>
                      {isCreatingSandbox
                        ? 'Launching Cloud MicroVM...'
                        : sandboxUsage !== null && sandboxUsage.used >= sandboxUsage.max
                        ? `Quota Full (${sandboxUsage.used}/${sandboxUsage.max})`
                        : '+ New Isolated Sandbox'}
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
          )}
        </div>

        {/* Real CLI Telemetry Chip */}
        <div className="relative" ref={popoverRef}>
          {isNoneSelected ? (
            <button
              type="button"
              onClick={() => setShowLimitsPopover(!showLimitsPopover)}
              className="hidden sm:flex items-center gap-1.5 px-space-sm py-1 rounded border border-dashed border-outline-variant/40 bg-surface-container-low text-outline hover:text-on-surface hover:border-outline-variant/80 font-code-sm text-code-sm transition-all cursor-pointer"
              title="No model selected. Click to view status or select a model below to activate live quota telemetry."
            >
              <span className="material-symbols-outlined text-[14px] text-outline shrink-0">speed</span>
              <span className="text-[11px] font-mono text-outline">Telemetry: Standby</span>
              <span className="material-symbols-outlined text-[13px] text-outline">
                {showLimitsPopover ? 'expand_less' : 'expand_more'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowLimitsPopover(!showLimitsPopover)}
              className={`hidden sm:flex items-center gap-1.5 px-space-sm py-1 rounded border font-code-sm text-code-sm transition-all cursor-pointer ${
                !isModelLinked
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
                  : `Click to view authentic ${providerLabel} CLI quota & telemetry${
                      relevantGroup ? ` (${relevantGroup.name})` : ''
                    }`
              }
            >
              {!isModelLinked ? (
                <>
                  <span className="material-symbols-outlined text-[14px] text-amber-400">
                    lock
                  </span>
                  <span className="text-amber-400 font-medium">
                    {`${providerLabel} Not Linked`}
                  </span>
                </>
              ) : (
                <>
                  {providerIcon}
                  <span>{`${providerLabel}: ${quotaBadgeText}`}</span>
                </>
              )}
              <span className="material-symbols-outlined text-[13px] text-outline">
                {showLimitsPopover ? 'expand_less' : 'expand_more'}
              </span>
            </button>
          )}

          {/* Detailed Real CLI Usage Telemetry Popover */}
          {showLimitsPopover && (
            <div className="absolute right-0 top-full mt-2 w-[390px] sm:w-[440px] max-h-[85vh] overflow-y-auto p-space-md rounded-2xl bg-surface-container border border-outline-variant/30 shadow-2xl backdrop-blur-xl z-50 animate-in fade-in slide-in-from-top-1">
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
                  <span className="font-semibold text-sm text-on-surface">
                    {isNoneSelected
                      ? 'CLI Telemetry'
                      : isCodex
                      ? 'OpenAI Codex Telemetry'
                      : isClaude
                      ? 'Anthropic Claude Telemetry'
                      : 'Antigravity CLI Telemetry'}
                  </span>
                </div>
                {isNoneSelected ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-surface-container-highest text-outline border border-outline-variant/20">
                    STANDBY
                  </span>
                ) : isModelLinked ? (
                  <div className="flex items-center gap-1 bg-surface-container-low p-0.5 rounded-lg border border-outline-variant/20">
                    <button
                      type="button"
                      onClick={() => setTelemetryTab('quota')}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                        telemetryTab === 'quota'
                          ? 'bg-primary text-on-primary shadow-xs'
                          : 'text-outline hover:text-on-surface'
                      }`}
                    >
                      Models & Quota
                    </button>
                    <button
                      type="button"
                      onClick={() => setTelemetryTab('session')}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                        telemetryTab === 'session'
                          ? 'bg-primary text-on-primary shadow-xs'
                          : 'text-outline hover:text-on-surface'
                      }`}
                    >
                      Session Tokens
                    </button>
                  </div>
                ) : null}
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
              ) : telemetryTab === 'quota' ? (
                /* Tab 1: Authentic Models & Quota Visual */
                <div className="space-y-4">
                  {/* Quota Groups */}
                  {isCodex ? (
                    <div className="space-y-3">
                      {/* Authentic Rolling Quota Bar (if available from Codex session rate limits) */}
                      {quotaLimits && quotaLimits.groups && quotaLimits.groups.length > 0 && (
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

                                      {/* Terminal bracket progress bar */}
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
                                        {formatResetCountdown(bucket.reset_time)}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-[11px] text-outline leading-tight px-1">
                        OpenAI Codex runs against your ChatGPT account via the local CLI daemon. Rate limits and capacity are enforced dynamically by OpenAI.
                      </p>
                    </div>
                  ) : quotaLimits && quotaLimits.groups && quotaLimits.groups.length > 0 ? (
                    <div className="space-y-4">
                      {quotaLimits.groups.map((group, gIdx) => {
                        const isCurrentActiveGroup = relevantGroup?.name === group.name;
                        return (
                          <div
                            key={group.name || gIdx}
                            className={`p-3.5 rounded-xl bg-surface-container-low border transition-all space-y-3 ${
                              isCurrentActiveGroup
                                ? 'border-primary/40 ring-1 ring-primary/20 shadow-xs'
                                : 'border-outline-variant/20'
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

                                  {/* Terminal bracket progress bar */}
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
                                    {formatResetCountdown(bucket.reset_time)}
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
              ) : (
                /* Tab 2: Session Token Telemetry */
                <div className="space-y-3">
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
                    <span className="text-[10px] font-medium text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20 shrink-0">
                      Connected
                    </span>
                  </div>

                  {/* Authentic Token Telemetry Grid */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded-lg bg-surface-container-low border border-outline-variant/15">
                      <span className="text-outline block text-[9px] uppercase font-semibold">Total Consumed</span>
                      <span className="font-mono font-semibold text-primary text-[13px]">
                        {used.toLocaleString()}
                      </span>
                      <span className="text-outline text-[10px] block">tokens</span>
                    </div>

                    <div className="p-2 rounded-lg bg-surface-container-low border border-outline-variant/15">
                      <span className="text-outline block text-[9px] uppercase font-semibold">CLI Turns</span>
                      <span className="font-mono font-semibold text-on-surface text-[13px]">
                        {totalTurns}
                      </span>
                      <span className="text-outline text-[10px] block">invocations</span>
                    </div>

                    <div className="p-2 rounded-lg bg-surface-container-low border border-outline-variant/15">
                      <span className="text-outline block text-[9px] uppercase font-semibold">Prompt In</span>
                      <span className="font-mono font-medium text-on-surface text-[12px]">
                        {promptTokens.toLocaleString()}
                      </span>
                      <span className="text-outline text-[10px] block">tokens</span>
                    </div>

                    <div className="p-2 rounded-lg bg-surface-container-low border border-outline-variant/15">
                      <span className="text-outline block text-[9px] uppercase font-semibold">Resp Out</span>
                      <span className="font-mono font-medium text-on-surface text-[12px]">
                        {completionTokens.toLocaleString()}
                      </span>
                      <span className="text-outline text-[10px] block">tokens</span>
                    </div>

                    <div className="p-2 rounded-lg bg-surface-container-low border border-outline-variant/15">
                      <span className="text-outline block text-[9px] uppercase font-semibold">Thinking</span>
                      <span className="font-mono font-medium text-on-surface text-[12px]">
                        {thinkingTokens.toLocaleString()}
                      </span>
                      <span className="text-outline text-[10px] block">reasoning tokens</span>
                    </div>

                    <div className="p-2 rounded-lg bg-surface-container-low border border-outline-variant/15">
                      <span className="text-outline block text-[9px] uppercase font-semibold">Cache Read</span>
                      <span className="font-mono font-medium text-on-surface text-[12px]">
                        {cacheReadTokens.toLocaleString()}
                      </span>
                      <span className="text-outline text-[10px] block">cached tokens</span>
                    </div>
                  </div>

                  {/* Execution Latency Telemetry */}
                  <div className="p-2 rounded-lg bg-surface-container-low border border-outline-variant/15 flex items-center justify-between text-xs">
                    <span className="text-on-surface-variant text-[11px]">Last Turn Latency</span>
                    <span className="font-mono text-on-surface text-[11px] font-medium">
                      {lastLatencyMs > 0 ? `${lastLatencyMs}ms` : '—'}
                      {avgLatencyMs > 0 && ` (avg ${avgLatencyMs}ms)`}
                    </span>
                  </div>

                  {/* Telemetry Authenticity Note */}
                  <p className="text-[10px] text-outline leading-tight pt-1 border-t border-outline-variant/15">
                    {isCodex
                      ? 'Metrics acquired directly from local OpenAI Codex CLI process execution telemetry. No external quotas or rate limits are simulated.'
                      : 'Metrics acquired directly from local Antigravity CLI process execution telemetry. No external quotas or rate limits are simulated.'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Day / Night Mode Toggle */}
        <button
          onClick={onToggleTheme}
          className="p-1.5 rounded-lg hover:bg-surface-container text-outline hover:text-on-surface transition-colors cursor-pointer"
          title={isDarkMode ? 'Switch to Day Mode' : 'Switch to Night Mode'}
        >
          <span className="material-symbols-outlined text-[18px]">
            {isDarkMode ? 'light_mode' : 'dark_mode'}
          </span>
        </button>

        {/* Mobile Inspector Toggle */}
        <button
          onClick={onToggleInspector}
          className="xl:hidden flex items-center gap-1 px-2 py-1 rounded bg-surface-container hover:bg-surface-container-high text-tertiary font-code-sm text-code-sm border border-outline-variant/30 cursor-pointer"
          title="Toggle Cloud Inspector"
        >
          <span className="material-symbols-outlined text-[16px]">troubleshoot</span>
          <span className="hidden xs:inline">Inspector</span>
        </button>

        <div className="hidden sm:block h-4 w-px bg-outline-variant/30" />

        {/* User Account & Dual Platform Login */}
        <UserMenu
          user={user}
          onOpenAuthModal={onOpenAuthModal}
          onLogout={onLogout}
        />
      </div>
    </header>
  );
};
