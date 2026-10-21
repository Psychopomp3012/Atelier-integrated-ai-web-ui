import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { ModelType, ModelProvider, UserProfile, ModelOption, GeminiQuotaStats, CodexQuotaStats, QuotaGroup, LinkedAIPlatformAccount } from '../types';
import { AVAILABLE_MODELS, getModelDisplayInfo, getMinimumEffortModelId } from '../types';
import type { CliStatus } from '../services/cliAuth.service';
import { checkModelQuotaExhausted, isQuotaGroupExhausted } from '../utils/quota.util';
import {
  currentUserAtom,
  cliStatusAtom,
  selectedModelAtom,
  availableModelsAtom,
  geminiQuotaAtom,
  codexQuotaAtom,
  sandboxUsageAtom,
  isAuthModalOpenAtom,
} from '../state';

interface SandboxUsageData {
  used: number;
  max: number;
  sandboxes: Array<{
    sandboxId: string;
    name: string;
    sessionId?: string;
  }>;
}

interface ModelSelectorDropdownProps {
  selectedModel?: ModelType;
  onSelectModel?: (model: ModelType) => void;
  currentUser?: UserProfile | null;
  cliStatus?: CliStatus | null;
  disabled?: boolean;
  geminiQuota?: GeminiQuotaStats | null;
  codexQuota?: CodexQuotaStats | null;
  availableModels?: ModelOption[];
  onOpenAuthModal?: () => void;
  activeSandbox?: { sandboxId: string; name: string } | null;
  sandboxUsage?: SandboxUsageData | null;
  onStartSandboxVM?: () => void;
  onAttachExistingSandbox?: (sandboxId: string) => void;
  isStartingSandbox?: boolean;
  isAttachingSandbox?: string | null;
  onRefreshModels?: () => void;
}

interface ProviderMeta {
  provider: ModelProvider;
  title: string;
  shortLabel: string;
  description: string;
  icon: string;
  iconColor: string;
  iconSvg: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    provider: 'gemini',
    title: 'Antigravity',
    shortLabel: 'Antigravity',
    description: 'Dynamic models via AGY CLI',
    icon: 'auto_awesome',
    iconColor: 'text-[#4285F4]',
    iconSvg: '/provider-icons/antigravity.svg',
  },
  {
    provider: 'claude',
    title: 'Anthropic Claude',
    shortLabel: 'Claude',
    description: 'Anthropic reasoning models via CLI',
    icon: 'bolt',
    iconColor: 'text-[#F59E0B]',
    iconSvg: '/provider-icons/claude.svg',
  },
  {
    provider: 'codex',
    title: 'OpenAI / Codex',
    shortLabel: 'Codex',
    description: 'OpenAI models via Codex CLI',
    icon: 'code',
    iconColor: 'text-[#10A37F]',
    iconSvg: '/provider-icons/codex.svg',
  },
];

const getShortModelName = (name: string): string => {
  return name
    .replace(/^Google\s+/i, '')
    .replace(/^Antigravity\s+/i, '')
    .replace(/^OpenAI\s+/i, '')
    .replace(/\s*\(Latest\)/gi, '')
    .replace(/\s*\(Thinking\)/gi, '')
    .replace(/\s*\(Reasoning\)/gi, '')
    .trim();
};

export const ModelSelectorDropdown: React.FC<ModelSelectorDropdownProps> = ({
  selectedModel: propSelectedModel,
  onSelectModel: propOnSelectModel,
  currentUser: propCurrentUser,
  cliStatus: cliStatusProp,
  disabled = false,
  geminiQuota: propGeminiQuota,
  codexQuota: propCodexQuota,
  availableModels: propAvailableModels,
  onOpenAuthModal: propOnOpenAuthModal,
  activeSandbox,
  sandboxUsage: propSandboxUsage,
  onStartSandboxVM,
  onAttachExistingSandbox,
  isStartingSandbox = false,
  isAttachingSandbox = null,
  onRefreshModels,
}) => {
  const [atomSelectedModel, setAtomSelectedModel] = useAtom(selectedModelAtom);
  const atomCurrentUser = useAtomValue(currentUserAtom);
  const atomCliStatus = useAtomValue(cliStatusAtom);
  const atomAvailableModels = useAtomValue(availableModelsAtom);
  const atomGeminiQuota = useAtomValue(geminiQuotaAtom);
  const atomCodexQuota = useAtomValue(codexQuotaAtom);
  const atomSandboxUsage = useAtomValue(sandboxUsageAtom);
  const setIsAuthModalOpen = useSetAtom(isAuthModalOpenAtom);

  const selectedModel = propSelectedModel ?? atomSelectedModel;
  const onSelectModel = propOnSelectModel ?? setAtomSelectedModel;
  const currentUser = propCurrentUser !== undefined ? propCurrentUser : atomCurrentUser;
  const activeCliStatus = cliStatusProp || atomCliStatus;
  const geminiQuota = propGeminiQuota !== undefined ? propGeminiQuota : atomGeminiQuota;
  const codexQuota = propCodexQuota !== undefined ? propCodexQuota : atomCodexQuota;
  const availableModels = (propAvailableModels && propAvailableModels.length > 0)
    ? propAvailableModels
    : (atomAvailableModels.length > 0 ? atomAvailableModels : AVAILABLE_MODELS);
  const sandboxUsage = propSandboxUsage !== undefined ? propSandboxUsage : atomSandboxUsage;
  const onOpenAuthModal = propOnOpenAuthModal ?? (() => setIsAuthModalOpen(true));

  const [isOpen, setIsOpen] = useState(false);
  const [hoveredProvider, setHoveredProvider] = useState<ModelProvider | null>(null);
  const [hoveredModel, setHoveredModel] = useState<ModelOption | null>(null);
  const [hoveredModelTop, setHoveredModelTop] = useState<number>(0);
  const [isMobile, setIsMobile] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const column2Ref = useRef<HTMLDivElement>(null);
  const effortFlyoutRef = useRef<HTMLDivElement>(null);
  const mobileModalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Determine if a provider is signed in / unlocked
  const isProviderUnlocked = (provider: ModelProvider): boolean => {
    // If not signed in, all providers require sign in and are locked
    if (!currentUser) return false;

    // Google Gemini (Antigravity native engine) requires Antigravity CLI to be linked
    if (provider === 'gemini') {
      return Boolean(activeCliStatus?.antigravity?.linked || activeCliStatus?.gemini?.linked);
    }
    const linkedPlatforms = Array.isArray(currentUser?.linkedPlatforms)
      ? currentUser.linkedPlatforms
      : (currentUser?.linkedPlatforms && typeof currentUser.linkedPlatforms === 'object')
        ? Object.values(currentUser.linkedPlatforms).filter(
          (p: any): p is LinkedAIPlatformAccount => Boolean(p && typeof p === 'object' && 'platform' in p)
        )
        : [];

    if (provider === 'claude') {
      const isCliSubscription = Boolean(
        activeCliStatus?.claude?.linked && activeCliStatus?.claude?.authMethod !== 'api_key'
      );
      const isAccountSubscription = Boolean(
        linkedPlatforms.some(
          (p) => p.platform === 'claude_subscription' && p.hasValidSession
        )
      );
      return isCliSubscription || isAccountSubscription;
    }
    if (provider === 'codex') {
      return Boolean(
        activeCliStatus?.codex?.linked ||
        linkedPlatforms.some(
          (p) => (p.platform === 'codex_subscription' || p.platform === 'openai') && p.hasValidSession
        )
      );
    }
    return false;
  };

  // Reset dropdown when user signs out
  useEffect(() => {
    if (!currentUser) {
      setIsOpen(false);
      setHoveredProvider(null);
      setHoveredModel(null);
    }
  }, [currentUser]);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!mobileModalRef.current || !mobileModalRef.current.contains(target)) &&
        !(target as HTMLElement)?.closest?.('[role="dialog"]')
      ) {
        setIsOpen(false);
        setHoveredProvider(null);
        setHoveredModel(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setHoveredProvider(null);
        setHoveredModel(null);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // If dropdown is opened and a sandbox microVM is attached but models haven't loaded yet, auto-trigger refresh
  useEffect(() => {
    if (isOpen && activeSandbox?.sandboxId && availableModels.length === 0 && onRefreshModels) {
      onRefreshModels();
    }
  }, [isOpen, activeSandbox?.sandboxId, availableModels.length, onRefreshModels]);

  const displayInfo = getModelDisplayInfo(selectedModel, availableModels);
  const activeProvider = displayInfo.provider;

  const handleToggleOpen = () => {
    if (disabled) return;
    if (!isOpen) {
      // If the current provider is unlocked, show its models by default, otherwise gemini
      const unlocked = isProviderUnlocked(activeProvider);
      setHoveredProvider(unlocked ? activeProvider : 'gemini');
      setHoveredModel(null);
    } else {
      setHoveredModel(null);
    }
    setIsOpen((prev) => !prev);
  };

  const handleSelectModel = (modelId: ModelType) => {
    onSelectModel(modelId);
    setIsOpen(false);
    setHoveredProvider(null);
    setHoveredModel(null);
  };

  // Only display sub-menu for an unlocked hovered provider
  const displayProvider = hoveredProvider && isProviderUnlocked(hoveredProvider) ? hoveredProvider : null;
  const currentProviderMeta = displayProvider
    ? PROVIDERS.find((p) => p.provider === displayProvider)
    : null;
  // Filter models belonging to the currently selected provider
  const providerModels = displayProvider
    ? availableModels.filter((m) => {
      if (m.id === 'none') return false;
      if (displayProvider === 'gemini') {
        return m.hostedBy === 'antigravity' || m.provider === 'gemini';
      }
      if (displayProvider === 'claude') {
        return m.provider === 'claude' && m.hostedBy !== 'antigravity';
      }
      if (displayProvider === 'codex') {
        return m.provider === 'codex' && m.hostedBy !== 'antigravity';
      }
      return m.provider === displayProvider;
    })
    : [];

  const hasAnySandbox = Boolean(sandboxUsage?.sandboxes && sandboxUsage.sandboxes.length > 0);
  const isSandboxAttached = Boolean(activeSandbox?.sandboxId);

  // Check if a specific quota group has any bucket with remaining_fraction <= 0 using shared quota.util
  const isGroupExhausted = (matchFn: (group: QuotaGroup) => boolean): boolean => {
    return isQuotaGroupExhausted(geminiQuota?.quotaLimits?.groups, matchFn);
  };

  // Gemini Models group (matches bucket id prefix 'gemini' or group name containing 'gemini')
  const isGeminiQuotaExhausted = isGroupExhausted(
    (g) =>
      g.buckets?.some((b) => b.id?.toLowerCase().startsWith('gemini')) ||
      g.name?.toLowerCase().includes('gemini')
  );

  // Claude and GPT models group (matches bucket id prefix '3p' or group name containing 'claude' or 'gpt')
  const isThirdPartyQuotaExhausted = isGroupExhausted(
    (g) =>
      g.buckets?.some((b) => b.id?.toLowerCase().startsWith('3p')) ||
      g.name?.toLowerCase().includes('claude') ||
      g.name?.toLowerCase().includes('gpt')
  );

  // All Antigravity quotas exhausted (both Gemini native and 3rd party Claude/GPT)
  const isAllQuotaExhausted = isGeminiQuotaExhausted && isThirdPartyQuotaExhausted;

  // Determine if a specific model is disabled due to quota exhaustion
  const isModelQuotaExhausted = (m: ModelOption): boolean => {
    return checkModelQuotaExhausted(m, geminiQuota, codexQuota, activeCliStatus);
  };

  const getModelQuotaDescription = (m: ModelOption): string => {
    if (m.hostedBy === 'antigravity' || m.provider === 'gemini') {
      const isThirdParty =
        m.id.toLowerCase().includes('claude') ||
        m.id.toLowerCase().includes('gpt');
      return isThirdParty
        ? 'Antigravity 3rd-party rolling 5-hour quota exhausted — refreshes automatically'
        : 'Gemini rolling 5-hour quota exhausted — refreshes automatically';
    }
    if (m.provider === 'claude') {
      return 'Claude rolling 5-hour quota exhausted — refreshes automatically';
    }
    if (m.provider === 'codex') {
      return 'OpenAI Codex quota limit reached — refreshes in rolling window';
    }
    return 'Rolling 5-hour quota exhausted — refreshes automatically';
  };

  const isSelectedModelExhausted = Boolean(
    selectedModel !== 'none' &&
    checkModelQuotaExhausted(displayInfo.parentModel, geminiQuota, codexQuota, activeCliStatus)
  );

  // Resolve provider details for the selected model
  const selectedProviderMeta = React.useMemo(() => {
    if (selectedModel === 'none') return null;
    const hostedBy = displayInfo.parentModel?.hostedBy;
    const prov = displayInfo.provider;

    if (hostedBy === 'antigravity' || prov === 'gemini') {
      return {
        name: 'Antigravity',
        iconSvg: '/provider-icons/antigravity.svg',
      };
    }
    if (hostedBy === 'codex' || prov === 'codex') {
      return {
        name: 'Codex',
        iconSvg: '/provider-icons/codex.svg',
      };
    }
    if (hostedBy === 'claude' || prov === 'claude') {
      return {
        name: 'Claude',
        iconSvg: '/provider-icons/claude.svg',
      };
    }
    return {
      name: 'Antigravity',
      iconSvg: '/provider-icons/antigravity.svg',
    };
  }, [selectedModel, displayInfo]);

  return (
    <div ref={containerRef} className="relative inline-block text-left min-w-0 shrink">
      {/* Trigger Button next to Attach */}
      <button
        type="button"
        onClick={handleToggleOpen}
        disabled={disabled}
        className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-md bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-xs border border-outline-variant/20 transition-all cursor-pointer shadow-xs max-w-[110px] xs:max-w-[145px] sm:max-w-[420px] shrink min-w-0 ${isOpen ? 'ring-2 ring-primary/30 border-primary/50' : ''
          }`}
        title={
          selectedModel === 'none'
            ? 'No model selected. Click to select a provider and model.'
            : `${selectedProviderMeta?.name || ''} • ${displayInfo.baseName}${displayInfo.effortLabel ? ` • ${displayInfo.effortLabel}` : ''
            }. Click to switch model.`
        }
      >
        {selectedModel === 'none' ? (
          <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 truncate">
            <span
              className="material-symbols-outlined text-[15px] text-outline shrink-0"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              tune
            </span>
            <span className="font-medium text-on-surface truncate hidden sm:inline">No Model Selected</span>
            <span className="font-medium text-on-surface truncate sm:hidden">Select</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 overflow-hidden">
            {/* Provider Icon */}
            {selectedProviderMeta?.iconSvg ? (
              <img
                src={selectedProviderMeta.iconSvg}
                alt=""
                className="w-3.5 h-3.5 object-contain shrink-0"
              />
            ) : displayInfo.iconSvg ? (
              <img
                src={displayInfo.iconSvg}
                alt=""
                className="w-3.5 h-3.5 object-contain shrink-0"
              />
            ) : (
              <span
                className={`material-symbols-outlined text-[14px] shrink-0 ${displayInfo.iconColor}`}
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {displayInfo.icon}
              </span>
            )}

            {/* Provider Name (Desktop only to keep mobile compact) */}
            {selectedProviderMeta && (
              <>
                <span className="font-semibold text-on-surface shrink-0 hidden sm:inline">
                  {selectedProviderMeta.name}
                </span>
                <span className="text-outline/40 shrink-0 hidden sm:inline">•</span>
              </>
            )}

            {/* Model Name (Compact & truncated on mobile) */}
            <span className="font-medium text-on-surface truncate max-w-[65px] xs:max-w-[95px] sm:hidden">
              {getShortModelName(displayInfo.baseName)}
            </span>
            <span className="font-medium text-on-surface truncate hidden sm:inline">
              {displayInfo.baseName}
            </span>

            {/* Dot & Effort (Desktop only) */}
            {displayInfo.effortLabel && (
              <>
                <span className="text-outline/40 shrink-0 hidden sm:inline">•</span>
                <span className="text-[11px] text-on-surface-variant font-medium shrink-0 hidden sm:inline">
                  {displayInfo.effortLabel}
                </span>
              </>
            )}
          </div>
        )}

        {isSelectedModelExhausted && (
          <span
            className="w-2 h-2 rounded-full bg-amber-400 shrink-0 ring-2 ring-amber-400/20 ml-1"
            title="Current model quota exhausted"
          />
        )}
        <span
          className={`material-symbols-outlined text-[14px] text-outline shrink-0 ml-auto transition-transform duration-200 ${isOpen ? 'rotate-180' : ''
            }`}
        >
          expand_less
        </span>
      </button>

      {/* Desktop Providers Dropdown Popover (hidden sm:flex) */}
      {isOpen && (
        <div className="hidden sm:flex absolute bottom-full mb-2 left-0 z-50 items-end">
          <div className="relative flex items-end">
            {/* Column 1: Providers List */}
            <div className="w-56 p-1.5 rounded-xl bg-surface-container border border-outline-variant/30 shadow-2xl backdrop-blur-md flex flex-col shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-150">
              <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-outline-variant/15 text-[10px] font-semibold text-outline uppercase tracking-wider">
                <span>AI Providers</span>
                {availableModels.length === 0 ? (
                  <></>
                ) : (
                  <span>Hover to expand</span>
                )}
              </div>

              <div className="flex flex-col gap-0.5">
                {PROVIDERS.map((meta) => {
                  const isUnlocked = isProviderUnlocked(meta.provider);
                  const isSelected = activeProvider === meta.provider;
                  const isHovered = hoveredProvider === meta.provider && isUnlocked;

                  return (
                    <div
                      key={meta.provider}
                      onMouseEnter={() => {
                        if (isUnlocked) {
                          setHoveredProvider(meta.provider);
                          setHoveredModel(null);
                        } else {
                          setHoveredProvider(null);
                          setHoveredModel(null);
                        }
                      }}
                      className="relative"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (!isUnlocked) {
                            setIsOpen(false);
                            onOpenAuthModal?.();
                            return;
                          }
                          setHoveredProvider(meta.provider);
                          setHoveredModel(null);
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-all ${!isUnlocked
                            ? 'opacity-60 grayscale-[30%] hover:bg-amber-500/10 cursor-pointer select-none bg-surface-container/20 border border-transparent'
                            : isHovered
                              ? 'bg-surface-container-highest text-on-surface shadow-xs cursor-pointer'
                              : isSelected
                                ? 'bg-primary/10 text-on-surface cursor-pointer'
                                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface cursor-pointer'
                          }`}
                        title={
                          isUnlocked
                            ? `${meta.title} (Available)`
                            : `${meta.title} is locked. Click to link CLI.`
                        }
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {meta.iconSvg ? (
                            <div className={`w-5 h-5 flex items-center justify-center shrink-0 ${!isUnlocked ? 'opacity-40 grayscale' : ''}`}>
                              <img
                                src={meta.iconSvg}
                                alt={meta.title}
                                className="w-4 h-4 object-contain"
                              />
                            </div>
                          ) : (
                            <span
                              className={`material-symbols-outlined text-[18px] shrink-0 ${isUnlocked ? meta.iconColor : 'text-outline'
                                }`}
                              style={{ fontVariationSettings: "'FILL' 1" }}
                            >
                              {meta.icon}
                            </span>
                          )}
                          <div className="min-w-0 flex flex-col">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold text-on-surface truncate">
                                {meta.title}
                              </span>
                            </div>
                            <span className="text-[10px] text-outline truncate">
                              {isUnlocked ? meta.description : 'Sign in required • Locked'}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isUnlocked ? (
                            <span
                              className={`material-symbols-outlined text-[16px] transition-transform ${isHovered ? 'text-primary translate-x-0.5' : 'text-outline'
                                }`}
                            >
                              chevron_right
                            </span>
                          ) : (
                            <span className="material-symbols-outlined text-[15px] text-outline/70">
                              lock
                            </span>
                          )}
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Column 2: Models List for Hovered Provider */}
            {!isMobile && displayProvider && currentProviderMeta && (
              <div
                ref={column2Ref}
                onMouseEnter={() => setHoveredProvider(displayProvider)}
                className="-ml-px w-[270px] max-h-[390px] p-2 rounded-xl bg-surface-container border border-outline-variant/30 shadow-2xl backdrop-blur-md flex flex-col shrink-0 animate-in fade-in duration-150 relative"
              >
                <div className="flex items-center justify-between px-2 py-1 mb-1.5 border-b border-outline-variant/15 text-xs text-on-surface-variant font-medium shrink-0">
                  <div className="flex items-center gap-1.5">
                    {currentProviderMeta.iconSvg ? (
                      <img
                        src={currentProviderMeta.iconSvg}
                        alt=""
                        className="w-4 h-4 object-contain shrink-0"
                      />
                    ) : (
                      <span className={`material-symbols-outlined text-[15px] ${currentProviderMeta.iconColor}`}>
                        {currentProviderMeta.icon}
                      </span>
                    )}
                    <span className="font-semibold text-on-surface">{currentProviderMeta.title}</span>
                  </div>
                  <span className="text-[10px] text-outline">Select Model</span>
                </div>

                {/* Quota exhausted notice banner */}
                {((displayProvider === 'gemini' && (isGeminiQuotaExhausted || isThirdPartyQuotaExhausted)) ||
                  (displayProvider === 'claude' && isThirdPartyQuotaExhausted) ||
                  (displayProvider === 'codex' && isThirdPartyQuotaExhausted)) && (
                    <div className="flex items-center gap-2 mx-1 mb-2 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
                      <span className="material-symbols-outlined text-[14px] shrink-0">warning</span>
                      <div className="min-w-0">
                        {displayProvider === 'gemini' ? (
                          isAllQuotaExhausted ? (
                            <>
                              <p className="text-[11px] font-semibold leading-tight">All Model Quotas Reached</p>
                              <p className="text-[10px] text-amber-400/80 leading-tight">All Antigravity models temporarily unavailable. Rolling 5-hour window refreshing.</p>
                            </>
                          ) : isGeminiQuotaExhausted ? (
                            <>
                              <p className="text-[11px] font-semibold leading-tight">Gemini Quota Reached</p>
                              <p className="text-[10px] text-amber-400/80 leading-tight">Gemini models unavailable.</p>
                            </>
                          ) : (
                            <>
                              <p className="text-[11px] font-semibold leading-tight">Provider Quota Reached</p>
                              <p className="text-[10px] text-amber-400/80 leading-tight">Quota limit reached for secondary models.</p>
                            </>
                          )
                        ) : displayProvider === 'claude' ? (
                          <>
                            <p className="text-[11px] font-semibold leading-tight">Claude Quota Reached</p>
                            <p className="text-[10px] text-amber-400/80 leading-tight">Anthropic Claude quota limit reached.</p>
                          </>
                        ) : (
                          <>
                            <p className="text-[11px] font-semibold leading-tight">Codex Quota Reached</p>
                            <p className="text-[10px] text-amber-400/80 leading-tight">OpenAI Codex quota limit reached.</p>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                {/* Sandbox VM Status & Model Discovery */}
                {!hasAnySandbox ? (
                  <div className="flex flex-col items-center justify-center py-7 px-4 text-center my-auto space-y-3 bg-surface-container-low/70 rounded-xl border border-outline-variant/20 mx-1">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary mx-auto flex items-center justify-center shadow-xs">
                      <span className="material-symbols-outlined text-[22px]">rocket_launch</span>
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-on-surface">Sandbox VM Required</h4>
                      <p className="text-[11px] text-outline leading-snug">
                        No cloud microVM is running. Start a sandbox VM to discover and execute models for {currentProviderMeta.title}.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onStartSandboxVM}
                      disabled={isStartingSandbox}
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-primary hover:bg-primary-fixed-dim text-on-primary font-medium text-xs shadow-xs transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isStartingSandbox ? (
                        <>
                          <span className="material-symbols-outlined text-[15px] animate-spin">progress_activity</span>
                          <span>Starting MicroVM...</span>
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-[15px]">bolt</span>
                          <span>Start Sandbox VM</span>
                        </>
                      )}
                    </button>
                  </div>
                ) : !isSandboxAttached ? (
                  <div className="flex flex-col py-3 px-3 text-left space-y-2.5 bg-surface-container-low/70 rounded-xl border border-outline-variant/20 mx-1">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[17px]">link_off</span>
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs font-bold text-on-surface truncate">Attach Sandbox VM</h4>
                        <p className="text-[10px] text-outline">Connect workspace to load models</p>
                      </div>
                    </div>
                    <p className="text-[11px] text-on-surface-variant leading-snug">
                      Please attach an active sandbox VM to load live {currentProviderMeta.shortLabel} models:
                    </p>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
                      {sandboxUsage?.sandboxes.map((sb, idx) => (
                        <button
                          key={sb.sandboxId}
                          type="button"
                          onClick={() => onAttachExistingSandbox?.(sb.sandboxId)}
                          disabled={isAttachingSandbox === sb.sandboxId}
                          className="w-full flex items-center justify-between p-2 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/20 hover:border-primary/40 text-xs transition-all cursor-pointer"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="material-symbols-outlined text-[15px] text-primary shrink-0">
                              {isAttachingSandbox === sb.sandboxId ? 'sync' : 'link'}
                            </span>
                            <span className="font-medium text-on-surface truncate">
                              {sb.name || `Sandbox #${idx + 1}`}
                            </span>
                          </div>
                          <span className="text-[10px] font-semibold text-primary shrink-0">
                            {isAttachingSandbox === sb.sandboxId ? 'Attaching...' : 'Attach'}
                          </span>
                        </button>
                      ))}
                    </div>
                    {sandboxUsage && sandboxUsage.used < sandboxUsage.max && (
                      <button
                        type="button"
                        onClick={onStartSandboxVM}
                        disabled={isStartingSandbox}
                        className="w-full flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border border-dashed border-outline-variant/40 hover:border-primary/50 text-[11px] text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[13px]">add</span>
                        <span>{isStartingSandbox ? 'Starting...' : 'Or start new Sandbox VM'}</span>
                      </button>
                    )}
                  </div>
                ) : providerModels.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 px-4 text-center my-auto space-y-3">
                    {availableModels.length === 0 ? (
                      <>
                        <div className="relative flex items-center justify-center">
                          <span className="absolute w-10 h-10 rounded-full bg-primary/10 animate-ping" />
                          <div className="w-8 h-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                          {currentProviderMeta.iconSvg ? (
                            <img
                              src={currentProviderMeta.iconSvg}
                              alt=""
                              className="w-4 h-4 object-contain absolute opacity-80"
                            />
                          ) : (
                            <span className={`material-symbols-outlined text-[15px] absolute ${currentProviderMeta.iconColor}`}>
                              {currentProviderMeta.icon}
                            </span>
                          )}
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-xs font-semibold text-on-surface">Discovering models...</p>
                          <p className="text-[11px] text-outline">
                            Querying {currentProviderMeta.shortLabel} CLI in Sandbox microVM ({activeSandbox?.name || 'attached'})
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        {currentProviderMeta.iconSvg ? (
                          <img
                            src={currentProviderMeta.iconSvg}
                            alt=""
                            className="w-7 h-7 object-contain opacity-50 mb-1"
                          />
                        ) : (
                          <span className={`material-symbols-outlined text-[24px] opacity-50 ${currentProviderMeta.iconColor}`}>
                            {currentProviderMeta.icon}
                          </span>
                        )}
                        <div className="space-y-0.5">
                          <p className="text-xs font-semibold text-on-surface">No active models detected</p>
                          <p className="text-[11px] text-outline max-w-xs">
                            {currentProviderMeta.shortLabel} CLI is preparing credentials in this microVM. Click Refresh Models to reload.
                          </p>
                        </div>
                      </>
                    )}
                    {onRefreshModels && (
                      <button
                        type="button"
                        onClick={() => onRefreshModels()}
                        className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-surface-container hover:bg-surface-container-high border border-outline-variant/20 text-on-surface transition-colors cursor-pointer inline-flex items-center gap-1 shadow-xs"
                      >
                        <span className="material-symbols-outlined text-[13px]">refresh</span>
                        <span>Refresh Models</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 overflow-y-auto max-h-72 pr-0.5">
                    {providerModels.map((m) => {
                      const hasEffortOptions = Boolean(m.effortOptions && m.effortOptions.length > 0);
                      const activeEffort = m.effortOptions?.find((opt) => opt.modelId === selectedModel);
                      const isCurrentActive = selectedModel === m.id || Boolean(activeEffort);
                      const isCurrentlyHovered = hoveredModel?.name === m.name;
                      const isModelDisabled = isModelQuotaExhausted(m);

                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={isModelDisabled}
                          onMouseEnter={(e) => {
                            if (isModelDisabled) return;
                            if (hasEffortOptions) {
                              setHoveredModel(m);
                              setHoveredModelTop(e.currentTarget.offsetTop);
                            } else {
                              setHoveredModel(null);
                            }
                          }}
                          onPointerEnter={(e) => {
                            if (isModelDisabled) return;
                            if (hasEffortOptions) {
                              setHoveredModel(m);
                              setHoveredModelTop(e.currentTarget.offsetTop);
                            } else {
                              setHoveredModel(null);
                            }
                          }}
                          onClick={(e) => {
                            if (isModelDisabled) return;
                            if (hasEffortOptions) {
                              if (hoveredModel?.name === m.name) {
                                handleSelectModel(getMinimumEffortModelId(m));
                              } else {
                                setHoveredModel(m);
                                setHoveredModelTop(e.currentTarget.offsetTop);
                              }
                              return;
                            }
                            handleSelectModel(getMinimumEffortModelId(m));
                          }}
                          className={`flex flex-col text-left p-2 rounded-lg transition-all border ${isModelDisabled
                              ? 'opacity-40 grayscale cursor-not-allowed border-transparent bg-surface-container/30 select-none'
                              : isCurrentlyHovered
                                ? 'bg-surface-container-highest border-primary/40 text-on-surface shadow-xs cursor-pointer'
                                : isCurrentActive
                                  ? 'bg-primary/10 border-primary/30 text-on-surface shadow-xs cursor-pointer'
                                  : 'hover:bg-surface-container-high border-transparent text-on-surface-variant hover:text-on-surface cursor-pointer'
                            }`}
                        >
                          <div className="flex items-center justify-between gap-2 w-full">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {m.iconSvg ? (
                                <img
                                  src={m.iconSvg}
                                  alt=""
                                  className="w-4 h-4 object-contain shrink-0"
                                />
                              ) : (
                                <span className={`material-symbols-outlined text-[15px] ${m.iconColor}`}>
                                  {m.icon}
                                </span>
                              )}
                              <span className="font-semibold text-xs text-on-surface truncate">
                                {m.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {isModelDisabled ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30">
                                  Quota Limit
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-container-highest text-on-surface-variant border border-outline-variant/20">
                                  {m.badge}
                                </span>
                              )}
                              {!isModelDisabled && hasEffortOptions ? (
                                <span
                                  className={`material-symbols-outlined text-[16px] transition-transform ${isCurrentlyHovered ? 'text-primary translate-x-0.5' : 'text-outline'
                                    }`}
                                >
                                  chevron_right
                                </span>
                              ) : (
                                !isModelDisabled && isCurrentActive && (
                                  <span className="material-symbols-outlined text-[16px] text-primary">
                                    check
                                  </span>
                                )
                              )}
                            </div>
                          </div>
                          <p className="text-[11px] text-on-surface-variant/80 mt-1 line-clamp-2">
                            {isModelDisabled ? getModelQuotaDescription(m) : m.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Column 3: Reasoning Effort Flyout on Exact Right of Hovered Model */}
                {hoveredModel &&
                  hoveredModel.effortOptions &&
                  hoveredModel.effortOptions.length > 0 && (
                    <div
                      ref={effortFlyoutRef}
                      style={{
                        top: Math.max(
                          0,
                          Math.min(
                            hoveredModelTop,
                            column2Ref.current
                              ? Math.max(0, column2Ref.current.offsetHeight - (effortFlyoutRef.current?.offsetHeight || 140))
                              : hoveredModelTop
                          )
                        ),
                      }}
                      onMouseEnter={() => {
                        setHoveredProvider(displayProvider);
                      }}
                      className="absolute left-full -ml-px w-52 p-2 rounded-xl bg-surface-container border border-outline-variant/30 shadow-2xl backdrop-blur-md flex flex-col shrink-0 animate-in fade-in duration-150 z-30"
                    >
                      <div className="flex items-center justify-between px-2.5 py-1.5 mb-1.5 border-b border-outline-variant/15 text-xs text-on-surface-variant font-medium shrink-0 gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="material-symbols-outlined text-[15px] text-primary">
                            psychology
                          </span>
                          <span className="font-semibold text-on-surface truncate">
                            Reasoning Effort
                          </span>
                        </div>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-surface-container-highest text-outline uppercase shrink-0 border border-outline-variant/20">
                          {hoveredModel.name.split(' ')[0]}
                        </span>
                      </div>

                      <div className="flex flex-col gap-0.5 pr-0.5">
                        {hoveredModel.effortOptions.map((effort) => {
                          const isEffortActive = selectedModel === effort.modelId;
                          return (
                            <button
                              key={`${hoveredModel.id}-${effort.effort}`}
                              type="button"
                              onClick={() => handleSelectModel(effort.modelId)}
                              className={`flex items-center justify-between gap-2 w-full px-2.5 py-1 rounded-md transition-all cursor-pointer border ${isEffortActive
                                  ? 'bg-primary/10 border-primary/40 text-on-surface shadow-xs font-medium'
                                  : 'hover:bg-surface-container-high border-transparent text-on-surface-variant hover:text-on-surface'
                                }`}
                            >
                              <span className="font-semibold text-xs text-on-surface truncate">
                                {effort.label}
                              </span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-container-highest text-on-surface-variant border border-outline-variant/20">
                                  {effort.badge}
                                </span>
                                {isEffortActive && (
                                  <span className="material-symbols-outlined text-[14px] text-primary">
                                    check
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile Dedicated Modal (sm:hidden) via React Portal */}
      {isOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:hidden bg-black/75 backdrop-blur-xs animate-fade-in"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setIsOpen(false);
              }
            }}
          >
            <div
              ref={mobileModalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="select-model-title"
              className="w-full max-w-sm bg-surface-container-lowest border border-outline-variant/30 rounded-2xl shadow-2xl p-4 animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-3 mb-2.5 border-b border-outline-variant/20 shrink-0">
                <div className="min-w-0">
                  <h3 id="select-model-title" className="text-sm font-bold text-on-surface tracking-wide">Select AI Model</h3>
                  <p className="text-[10px] text-outline">Choose provider, model & reasoning effort</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="w-7 h-7 rounded-lg bg-surface-container/70 hover:bg-surface-container-high border border-outline-variant/30 flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-all cursor-pointer shadow-xs active:scale-95 shrink-0"
                  title="Close"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>

              {/* Provider Selection Tabs */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-container-low border border-outline-variant/20 mb-3 shrink-0">
                {PROVIDERS.map((meta) => {
                  const isUnlocked = isProviderUnlocked(meta.provider);
                  const isSelected = displayProvider === meta.provider;
                  return (
                    <button
                      key={meta.provider}
                      type="button"
                      onClick={() => {
                        if (!isUnlocked) {
                          setIsOpen(false);
                          onOpenAuthModal?.();
                          return;
                        }
                        setHoveredProvider(meta.provider);
                      }}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${isSelected
                          ? 'bg-surface-container-highest text-on-surface shadow-xs border border-outline-variant/30'
                          : !isUnlocked
                            ? 'text-outline/60 hover:text-amber-400 cursor-pointer opacity-70'
                            : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container cursor-pointer'
                        }`}
                      title={isUnlocked ? meta.title : `${meta.title} (Locked - Click to link CLI)`}
                    >
                      <img src={meta.iconSvg} alt="" className="w-3.5 h-3.5 object-contain" />
                      <span className="truncate">{meta.shortLabel}</span>
                      {!isUnlocked && (
                        <span className="material-symbols-outlined text-[12px] text-outline">lock</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Quota Exhausted Warning if any */}
              {((displayProvider === 'gemini' && (isGeminiQuotaExhausted || isThirdPartyQuotaExhausted)) ||
                (displayProvider === 'claude' && isThirdPartyQuotaExhausted) ||
                (displayProvider === 'codex' && isThirdPartyQuotaExhausted)) && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 mb-2 shrink-0">
                    <span className="material-symbols-outlined text-[14px] shrink-0">warning</span>
                    <div className="min-w-0 text-[11px] font-medium leading-tight">
                      Quota limit reached for some models. Refreshes in rolling 5-hour window.
                    </div>
                  </div>
                )}

              {/* Scrollable Models & Reasoning Effort List */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[140px]">
                {!hasAnySandbox ? (
                  <div className="flex flex-col items-center justify-center py-6 px-3 text-center space-y-2.5 bg-surface-container-low rounded-xl border border-outline-variant/20">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary mx-auto flex items-center justify-center shadow-xs">
                      <span className="material-symbols-outlined text-[20px]">rocket_launch</span>
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-on-surface">Sandbox VM Required</h4>
                      <p className="text-[11px] text-outline leading-snug">
                        Start a sandbox VM to load and run models for {currentProviderMeta?.title || 'this provider'}.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onStartSandboxVM?.();
                        setIsOpen(false);
                      }}
                      disabled={isStartingSandbox}
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-primary hover:bg-primary-fixed-dim text-on-primary font-medium text-xs shadow-xs transition-all cursor-pointer disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[15px]">bolt</span>
                      <span>Start Sandbox VM</span>
                    </button>
                  </div>
                ) : !isSandboxAttached ? (
                  <div className="flex flex-col py-3 px-3 text-left space-y-2 bg-surface-container-low rounded-xl border border-outline-variant/20">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[15px]">link_off</span>
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs font-bold text-on-surface truncate">Attach Sandbox VM</h4>
                        <p className="text-[10px] text-outline">Connect to load models</p>
                      </div>
                    </div>
                    <div className="space-y-1 max-h-36 overflow-y-auto custom-scrollbar">
                      {sandboxUsage?.sandboxes.map((sb, idx) => (
                        <button
                          key={sb.sandboxId}
                          type="button"
                          onClick={() => {
                            onAttachExistingSandbox?.(sb.sandboxId);
                            setIsOpen(false);
                          }}
                          disabled={isAttachingSandbox === sb.sandboxId}
                          className="w-full flex items-center justify-between p-2 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/20 text-xs transition-all cursor-pointer"
                        >
                          <span className="font-medium text-on-surface truncate">{sb.name || `Sandbox #${idx + 1}`}</span>
                          <span className="text-[10px] font-semibold text-primary">Attach</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : providerModels.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
                    <div className="w-6 h-6 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                    <p className="text-xs font-medium text-outline">
                      Executing {currentProviderMeta?.shortLabel || ''} CLI in Sandbox microVM...
                    </p>
                  </div>
                ) : (
                  providerModels.map((m) => {
                    const hasEffortOptions = Boolean(m.effortOptions && m.effortOptions.length > 0);
                    const activeEffort = m.effortOptions?.find((opt) => opt.modelId === selectedModel);
                    const isCurrentActive = selectedModel === m.id || Boolean(activeEffort);
                    const isModelDisabled = isModelQuotaExhausted(m);

                    if (hasEffortOptions && m.effortOptions) {
                      return (
                        <div
                          key={m.id}
                          className={`p-2.5 rounded-xl border transition-all ${isModelDisabled
                              ? 'opacity-40 grayscale border-outline-variant/15 bg-surface-container/20'
                              : isCurrentActive
                                ? 'bg-primary/5 border-primary/40 shadow-xs'
                                : 'bg-surface-container-low border-outline-variant/20'
                            }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {m.iconSvg ? (
                                <img src={m.iconSvg} alt="" className="w-4 h-4 object-contain shrink-0" />
                              ) : (
                                <span className={`material-symbols-outlined text-[15px] ${m.iconColor}`}>
                                  {m.icon}
                                </span>
                              )}
                              <span className="font-semibold text-xs text-on-surface truncate">
                                {m.name}
                              </span>
                            </div>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-container-highest text-on-surface-variant border border-outline-variant/20 shrink-0">
                              {m.badge}
                            </span>
                          </div>

                          <p className="text-[11px] text-outline mb-2 line-clamp-2">
                            {isModelDisabled ? getModelQuotaDescription(m) : m.description}
                          </p>

                          {/* Mobile Reasoning Effort Buttons */}
                          <div className="space-y-1">
                            <span className="text-[10px] text-on-surface-variant font-medium flex items-center gap-1">
                              Reasoning Effort:
                            </span>
                            <div className="grid grid-cols-3 gap-1">
                              {m.effortOptions.map((effort) => {
                                const isEffortActive = selectedModel === effort.modelId;
                                return (
                                  <button
                                    key={`${m.id}-${effort.effort}`}
                                    type="button"
                                    disabled={isModelDisabled}
                                    onClick={() => handleSelectModel(effort.modelId)}
                                    className={`py-1.5 px-1 rounded-lg text-xs font-semibold border flex flex-col items-center justify-center transition-all cursor-pointer ${isEffortActive
                                        ? 'bg-primary text-on-primary border-primary shadow-xs'
                                        : 'bg-surface-container hover:bg-surface-container-high border-outline-variant/25 text-on-surface'
                                      }`}
                                  >
                                    <span>{effort.label}</span>
                                    <span className={`text-[9px] font-normal ${isEffortActive ? 'text-on-primary/80' : 'text-outline'}`}>
                                      {effort.badge}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={isModelDisabled}
                        onClick={() => handleSelectModel(m.id)}
                        className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer ${isModelDisabled
                            ? 'opacity-40 grayscale cursor-not-allowed bg-surface-container/20 border-outline-variant/15'
                            : isCurrentActive
                              ? 'bg-primary/10 border-primary text-on-surface shadow-xs font-medium'
                              : 'bg-surface-container-low hover:bg-surface-container border-outline-variant/20 text-on-surface-variant hover:text-on-surface'
                          }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {m.iconSvg ? (
                              <img src={m.iconSvg} alt="" className="w-4 h-4 object-contain shrink-0" />
                            ) : (
                              <span className={`material-symbols-outlined text-[15px] ${m.iconColor}`}>
                                {m.icon}
                              </span>
                            )}
                            <span className="font-semibold text-xs text-on-surface truncate">
                              {m.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-container-highest text-on-surface-variant border border-outline-variant/20">
                              {m.badge}
                            </span>
                            {isCurrentActive && (
                              <span className="material-symbols-outlined text-[15px] text-primary">
                                check
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-[11px] text-outline line-clamp-2">
                          {isModelDisabled ? getModelQuotaDescription(m) : m.description}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
