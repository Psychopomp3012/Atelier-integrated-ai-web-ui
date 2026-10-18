import React, { useState, useEffect, useRef } from 'react';
import type { AIPlatform, UserProfile } from '../types';
import { signInWithGoogle } from '../services/firebaseAuth.service';
import {
  fetchCliStatus,
  openGeminiCliLoginPopup,
  closeGeminiCliLoginPopup,
  unlinkGeminiCli,
  submitAntigravityAuthCode,
  openClaudeCliLoginPopup,
  unlinkClaudeCli,
  submitClaudeAuthCode,
  openCodexCliLoginPopup,
  closeCodexCliLoginPopup,
  getCodexAuthUrl,
  unlinkCodexCli,
  refreshAuthToken,
  type CliStatus,
} from '../services/cliAuth.service';
import { apiFetch } from '../utils/api.util';
import { UserAvatar } from './UserAvatar';
import { AtelierLogo } from './AtelierLogo';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile | null;
  onGoogleLogin: (
    idToken: string,
    email?: string,
    name?: string,
    avatarUrl?: string
  ) => Promise<void>;
  onLinkSubscription: (platform: 'claude_subscription' | 'codex_subscription') => Promise<void>;
  onConnectApiKey: (platform: AIPlatform, key: string) => Promise<void>;
  initialCliStatus?: CliStatus | null;
  onCliStatusChange?: (status: CliStatus) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onGoogleLogin,
  onLinkSubscription,
  onConnectApiKey,
  initialCliStatus,
  onCliStatusChange,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [selectedKeyPlatform, setSelectedKeyPlatform] = useState<AIPlatform>('anthropic');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [unlinkingCli, setUnlinkingCli] = useState<'antigravity' | 'claude' | 'codex' | null>(null);
  const [showByok, setShowByok] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [cliStatus, setCliStatus] = useState<CliStatus | null>(initialCliStatus || null);
  const [codexProcessingStep, setCodexProcessingStep] = useState<string | null>(null);
  const [codexSuccess, setCodexSuccess] = useState(false);
  const [codexAuthError, setCodexAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (initialCliStatus) {
      setCliStatus(initialCliStatus);
    }
  }, [initialCliStatus]);

  const onCliStatusChangeRef = useRef(onCliStatusChange);
  onCliStatusChangeRef.current = onCliStatusChange;
  const lastStatusJsonRef = useRef<string>('');

  useEffect(() => {
    if (!isOpen || !currentUser) return;
    const update = () => {
      fetchCliStatus(true)
        .then((status) => {
          const json = JSON.stringify(status);
          if (json !== lastStatusJsonRef.current) {
            lastStatusJsonRef.current = json;
            setCliStatus(status);
            onCliStatusChangeRef.current?.(status);
          }
        })
        .catch(() => {});
    };
    update();
    window.addEventListener('focus', update);
    return () => {
      window.removeEventListener('focus', update);
    };
  }, [isOpen, currentUser]);

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Antigravity CLI Authentication state & handlers
  const [agyCodeInput, setAgyCodeInput] = useState('');
  const [showAgyCodeInput, setShowAgyCodeInput] = useState(false);
  const [agyProcessingStep, setAgyProcessingStep] = useState<string | null>(null);
  const [agyAuthError, setAgyAuthError] = useState<string | null>(null);
  const [agySuccess, setAgySuccess] = useState(false);
  const agyInputContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showAgyCodeInput && agyInputContainerRef.current) {
      agyInputContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [showAgyCodeInput, agyProcessingStep, agyAuthError]);

  const handleLinkGeminiCli = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setAuthError(null);
    setAgyAuthError(null);
    setAgySuccess(false);
    setShowAgyCodeInput(true);
    try {
      openGeminiCliLoginPopup();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Antigravity CLI linking was cancelled';
      setAuthError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitAgyCode = async () => {
    let raw = agyCodeInput.trim();
    if (!raw) return;

    setAuthError(null);
    setAgyAuthError(null);
    setAgySuccess(false);

    // Auto-extract code if the user pasted the full redirect URL
    if (raw.includes('code=')) {
      try {
        const u = new URL(raw.startsWith('http') ? raw : `http://localhost/${raw}`);
        raw = u.searchParams.get('code') || raw;
      } catch {
        const m = raw.match(/[?&]code=([^&]+)/);
        if (m) raw = decodeURIComponent(m[1]);
      }
    }

    // Google OAuth codes begin with "4/". Detect if the user pasted the state parameter
    if (!raw.startsWith('4/')) {
      setAgyAuthError(
        'Invalid authorization code: Google authorization codes always begin with "4/". You appear to have copied the state token from the browser address bar. Please switch to the opened Google authorization tab and click the "Copy to Clipboard" button (or copy the code in the box), then paste it here.'
      );
      return;
    }

    setIsSubmitting(true);
    setAgyProcessingStep('Exchanging authorization code with Google OAuth...');
    try {
      // Ensure minimum 850ms so the user clearly perceives the active processing feedback
      const [res] = await Promise.all([
        submitAntigravityAuthCode(raw),
        new Promise((r) => setTimeout(r, 850)),
      ]);

      if (res.success) {
        setAgyProcessingStep('Verifying Antigravity CLI credentials & active session...');
        closeGeminiCliLoginPopup();
        setTimeout(() => closeGeminiCliLoginPopup(), 200);
        setTimeout(() => closeGeminiCliLoginPopup(), 600);
        let updated = await fetchCliStatus(true);
        if (!updated.antigravity?.linked) {
          await new Promise((r) => setTimeout(r, 700));
          updated = await fetchCliStatus(true);
        }
        setCliStatus(updated);
        onCliStatusChange?.(updated);
        setAgySuccess(true);
        setAgyProcessingStep('Antigravity CLI linked successfully! 🎉');
        await new Promise((r) => setTimeout(r, 900));
        setAgyCodeInput('');
        setShowAgyCodeInput(false);
        setAgySuccess(false);
      } else {
        setAgyAuthError(
          res.error ||
            'Could not verify Antigravity authorization code. Please click "Link Antigravity CLI" to get a fresh URL and try again.'
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit authorization code';
      setAgyAuthError(msg);
    } finally {
      setIsSubmitting(false);
      setAgyProcessingStep(null);
    }
  };

  const handleUnlinkGeminiCli = async () => {
    closeGeminiCliLoginPopup();
    setUnlinkingCli('antigravity');
    setAuthError(null);
    try {
      await unlinkGeminiCli();
      const updated = await fetchCliStatus();
      setCliStatus(updated);
      onCliStatusChange?.(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to unlink Antigravity CLI';
      setAuthError(msg);
    } finally {
      setUnlinkingCli(null);
    }
  };

  // Claude CLI Authentication state & handlers
  const [claudeAuthMode, setClaudeAuthMode] = useState<'console' | 'claudeai'>('console');
  const [claudeCodeInput, setClaudeCodeInput] = useState('');
  const [showClaudeCodeInput, setShowClaudeCodeInput] = useState(false);

  const handleLinkClaudeCli = async () => {
    setIsSubmitting(true);
    setAuthError(null);
    try {
      const res = await openClaudeCliLoginPopup(claudeAuthMode);
      if (res.success) {
        const updated = await fetchCliStatus();
        setCliStatus(updated);
        onCliStatusChange?.(updated);
        try {
          await refreshAuthToken();
        } catch {}
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Claude CLI linking was cancelled';
      setAuthError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnlinkClaudeCli = async () => {
    setUnlinkingCli('claude');
    setAuthError(null);
    try {
      await unlinkClaudeCli();
      const updated = await fetchCliStatus();
      setCliStatus(updated);
      onCliStatusChange?.(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to unlink Claude CLI';
      setAuthError(msg);
    } finally {
      setUnlinkingCli(null);
    }
  };

  const handleSubmitClaudeCode = async () => {
    if (!claudeCodeInput.trim()) return;
    setIsSubmitting(true);
    try {
      const success = await submitClaudeAuthCode(claudeCodeInput.trim());
      if (success) {
        setClaudeCodeInput('');
        setShowClaudeCodeInput(false);
        const updated = await fetchCliStatus();
        setCliStatus(updated);
        onCliStatusChange?.(updated);
      } else {
        setAuthError('Invalid code or Claude process not waiting for code');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLinkCodexCli = async () => {
    if (isSubmitting || codexProcessingStep) return;
    setIsSubmitting(true);
    setAuthError(null);
    setCodexAuthError(null);
    setCodexSuccess(false);
    setCodexProcessingStep('Opening OpenAI OAuth browser popup...');

    try {
      const popupPromise = openCodexCliLoginPopup();
      setCodexProcessingStep('Waiting for ChatGPT / OpenAI authorization in popup...');
      const res = await popupPromise;

      if (res.success) {
        setCodexProcessingStep('Verifying Codex CLI credentials & active session...');
        let updated = await fetchCliStatus(true);
        if (!updated.codex?.linked) {
          await new Promise((r) => setTimeout(r, 700));
          updated = await fetchCliStatus(true);
        }
        setCliStatus(updated);
        onCliStatusChange?.(updated);
        try {
          await refreshAuthToken();
        } catch {}
        setCodexSuccess(true);
        setCodexProcessingStep('OpenAI Codex CLI linked successfully! 🎉');
        await new Promise((r) => setTimeout(r, 1200));
        setCodexSuccess(false);
        setCodexProcessingStep(null);
      } else {
        // First verify if actually linked before assuming failure
        const freshStatus = await fetchCliStatus(true).catch(() => null);
        if (freshStatus?.codex?.linked) {
          setCliStatus(freshStatus);
          onCliStatusChange?.(freshStatus);
          try {
            await refreshAuthToken();
          } catch {}
          setCodexSuccess(true);
          setCodexProcessingStep('OpenAI Codex CLI linked successfully! 🎉');
          await new Promise((r) => setTimeout(r, 1200));
          setCodexSuccess(false);
          setCodexProcessingStep(null);
          return;
        }

        // Fallback: If popup was closed early or blocked by browser, fetch device code directly
        setCodexProcessingStep(null);
        try {
          const details = await getCodexAuthUrl();
          if (details?.userCode) {
            setPendingDeviceAuth({
              platform: 'codex_subscription',
              userCode: details.userCode,
              verificationUri: details.authUrl,
              deviceCode: details.sessionId,
            });
            // Check status immediately on window focus, or via a gentle 8s fallback interval
            let pollTimer: ReturnType<typeof setInterval> | null = null;
            const checkDeviceAuthStatus = async () => {
              const status = await fetchCliStatus(true);
              if (status.codex?.linked) {
                if (pollTimer) clearInterval(pollTimer);
                window.removeEventListener('focus', checkDeviceAuthStatus);
                setPendingDeviceAuth(null);
                setCliStatus(status);
                onCliStatusChange?.(status);
                try {
                  await refreshAuthToken();
                } catch {}
              }
            };
            window.addEventListener('focus', checkDeviceAuthStatus);
            pollTimer = setInterval(checkDeviceAuthStatus, 8000);
            setTimeout(() => {
              if (pollTimer) clearInterval(pollTimer);
              window.removeEventListener('focus', checkDeviceAuthStatus);
            }, 120000);
          } else {
            setCodexAuthError('Authorization window closed without completing login. Please try again.');
          }
        } catch {
          setCodexAuthError('Authorization window closed without completing login. Please try again.');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Codex CLI linking was cancelled';
      setCodexAuthError(msg);
      setCodexProcessingStep(null);
    } finally {
      setIsSubmitting(false);
      if (!codexSuccess) {
        setCodexProcessingStep(null);
      }
    }
  };

  const handleUnlinkCodexCli = async () => {
    closeCodexCliLoginPopup();
    setUnlinkingCli('codex');
    setAuthError(null);
    setCodexAuthError(null);
    try {
      await unlinkCodexCli();
      const updated = await fetchCliStatus(true);
      setCliStatus(updated);
      onCliStatusChange?.(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to unlink Codex CLI';
      setCodexAuthError(msg);
    } finally {
      setUnlinkingCli(null);
    }
  };

  // Device Code authorization state
  const [pendingDeviceAuth, setPendingDeviceAuth] = useState<{
    platform: 'claude_subscription' | 'codex_subscription';
    userCode: string;
    verificationUri: string;
    deviceCode: string;
  } | null>(null);

  if (!isOpen) return null;

  const handleGoogleClick = async () => {
    setIsSubmitting(true);
    setAuthError(null);
    try {
      const result = await signInWithGoogle();
      await onGoogleLogin(result.idToken, result.email, result.name, result.avatarUrl);
    } catch (err: unknown) {
      console.error('Firebase Google Sign-In error:', err);
      const msg = err instanceof Error ? err.message : 'Google sign-in was cancelled';
      if (msg.includes('popup-closed-by-user')) {
        setAuthError('Sign-in cancelled: Popup window was closed.');
      } else if (msg.includes('popup-blocked')) {
        setAuthError('Pop-up was blocked by your browser. Please click "Preferences" on the notification bar at the top of Firefox (or the pop-up icon in your address bar) and select "Allow pop-ups", then click Continue with Google again.');
      } else {
        setAuthError(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDeviceAuth = async () => {
    if (!pendingDeviceAuth) return;
    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/v1/auth/device/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceCode: pendingDeviceAuth.deviceCode,
          platform: pendingDeviceAuth.platform,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await onLinkSubscription(pendingDeviceAuth.platform);
        setPendingDeviceAuth(null);
      }
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-surface-container-low border border-outline-variant/40 shadow-2xl p-4 sm:p-6 text-on-surface relative">
        {/* Close Button */}
        <button
          onClick={() => {
            closeGeminiCliLoginPopup();
            onClose();
          }}
          className="absolute top-3.5 right-3.5 w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-surface-container/70 hover:bg-surface-container-high border border-outline-variant/30 flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-all cursor-pointer shadow-xs active:scale-95 z-10"
          title="Close modal"
        >
          <span className="material-symbols-outlined text-[16px] sm:text-[18px]">close</span>
        </button>

        {/* STEP 1: NOT LOGGED IN -> Platform Sign-In */}
        {!currentUser ? (
          <div className="space-y-space-md text-center py-2">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-surface-container border border-outline-variant/40 flex items-center justify-center text-primary shadow-sm group">
              <AtelierLogo className="w-7 h-7" size={30} withGlow />
            </div>

            <div>
              <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
                Sign in to Atelier
              </h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant max-w-xs mx-auto mt-1">
                Log in with your Google account to access your workspace and AI agents.
              </p>
            </div>

            {authError && (
              <div className="p-space-sm rounded-lg bg-error-container/20 border border-error/40 text-error text-body-sm text-left flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] shrink-0 leading-none select-none">error</span>
                <span className="text-xs break-words leading-none">{authError}</span>
              </div>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={handleGoogleClick}
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl bg-white text-gray-900 font-semibold text-sm hover:bg-gray-100 active:scale-[0.99] shadow-md transition-all cursor-pointer border border-gray-200 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <span className="material-symbols-outlined text-[18px] animate-spin text-[#4285F4]">sync</span>
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    <span>Continue with Google</span>
                  </>
                )}
              </button>
            </div>

            <div className="pt-space-xs">
              <span className="font-label-sm text-label-sm text-outline">
                Cloud-native multi-model execution sandbox with real telemetry.
              </span>
            </div>
          </div>
        ) : (
          /* STEP 2: LOGGED IN -> Link Claude & ChatGPT Subscriptions */
          <div className="space-y-space-md">
            {/* Modal Header */}
            <div className="flex items-center gap-2.5 pb-3 pr-8 border-b border-outline-variant/20">
              <UserAvatar name={currentUser.name} avatarUrl={currentUser.avatarUrl} size="md" />
              <div className="min-w-0">
                <h3 className="font-semibold text-sm sm:text-base text-on-surface truncate">
                  Link AI Subscriptions
                </h3>
                <p className="text-[11px] sm:text-xs text-outline truncate" title={currentUser.email}>
                  Connected as <strong className="text-on-surface font-medium">{currentUser.email}</strong>
                </p>
              </div>
            </div>

            {authError && (
              <div className="p-3 rounded-xl bg-error-container/20 border border-error/40 text-error text-xs flex items-center gap-2 animate-fadeIn">
                <span className="material-symbols-outlined text-[18px] shrink-0 leading-none select-none">error</span>
                <span className="break-words leading-snug flex-1">{authError}</span>
                <button
                  type="button"
                  onClick={() => setAuthError(null)}
                  className="p-1 hover:bg-error/10 rounded cursor-pointer text-error/80 hover:text-error"
                  title="Dismiss error"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </div>
            )}

            {pendingDeviceAuth ? (
              /* Device Code Authorization Card */
              <div className="p-space-md rounded-xl bg-surface-container-lowest border border-primary/40 space-y-space-md">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[20px]">
                      open_in_browser
                    </span>
                    <span className="font-label-md text-label-md font-semibold text-on-surface">
                      Approve in Browser
                    </span>
                  </div>
                  <span className="font-code-sm text-code-sm text-secondary bg-secondary/10 px-2 py-0.5 rounded border border-secondary/20">
                    AWAITING
                  </span>
                </div>

                <p className="font-body-sm text-xs text-on-surface-variant">
                  Authorize your{' '}
                  {pendingDeviceAuth.platform === 'claude_subscription'
                    ? 'Claude Pro / Team'
                    : 'ChatGPT Plus / Codex'}{' '}
                  subscription in your browser using this code:
                </p>

                <div className="flex items-center justify-between p-space-sm rounded-lg bg-surface-container border border-outline-variant/30 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-code-lg text-base text-secondary font-bold tracking-widest font-mono">
                      {pendingDeviceAuth.userCode}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyCode(pendingDeviceAuth.userCode)}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-sm text-xs cursor-pointer border border-outline-variant/30 transition-all active:scale-95 shrink-0"
                      title="Copy code to clipboard"
                    >
                      <span className="material-symbols-outlined text-[14px] text-tertiary">
                        {copiedCode ? 'check' : 'content_copy'}
                      </span>
                      <span className="text-[11px] font-medium">{copiedCode ? 'Copied!' : 'Copy'}</span>
                    </button>
                  </div>

                  <a
                    href={pendingDeviceAuth.verificationUri}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 px-3 py-1 rounded-md bg-primary text-on-primary font-label-md text-xs font-semibold hover:bg-primary-fixed-dim shrink-0"
                  >
                    <span>Open {new URL(pendingDeviceAuth.verificationUri).hostname}</span>
                    <span className="material-symbols-outlined text-[14px]">launch</span>
                  </a>
                </div>

                <p className="font-body-sm text-[11px] text-on-surface-variant/80">
                  Click <strong>Confirm Link</strong> below to bind your subscription session to the cloud sandbox.
                </p>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    onClick={() => setPendingDeviceAuth(null)}
                    className="px-3 py-1 rounded-lg text-outline hover:text-on-surface font-label-md text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmDeviceAuth}
                    disabled={isSubmitting}
                    className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-secondary text-on-secondary font-label-md text-xs font-semibold shadow-md cursor-pointer hover:bg-secondary-container"
                  >
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    <span>Confirm Link</span>
                  </button>
                </div>
              </div>
            ) : (
              /* Subscriptions List */
              <div className="space-y-space-sm">
                {/* Claude Code CLI (claude) Status Card */}
                <div className="p-3 sm:p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/20 flex flex-col gap-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3">
                    <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-lg bg-[#D97706]/15 border border-[#D97706]/30 flex items-center justify-center p-2 shrink-0">
                        <img src="/provider-icons/claude.svg" alt="Claude" className="w-5 h-5 object-contain" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-xs sm:text-sm text-on-surface flex items-center gap-1.5 flex-wrap">
                          <span>Claude Code CLI (claude)</span>
                          {cliStatus?.claude?.linked ? (
                            <span className="text-secondary font-mono text-[10px] bg-secondary/10 px-1.5 py-0.5 rounded border border-secondary/20 whitespace-nowrap">
                              LINKED
                            </span>
                          ) : (
                            <span className="text-outline font-mono text-[10px] bg-surface-container-high px-1.5 py-0.5 rounded border border-outline-variant/30 whitespace-nowrap">
                              NOT LINKED
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] sm:text-xs text-outline line-clamp-2 sm:line-clamp-1 mt-0.5">
                          {cliStatus?.claude?.linked
                            ? `Authorized via ${cliStatus.claude.authMethod || 'Claude CLI'} · Ready for model execution`
                            : 'Click Link Claude CLI to authorize in a browser popup'}
                        </div>
                      </div>
                    </div>

                    <div className="w-full sm:w-auto shrink-0 flex items-center justify-end sm:justify-start">
                      {cliStatus?.claude?.linked ? (
                        <button
                          type="button"
                          onClick={handleUnlinkClaudeCli}
                          disabled={isSubmitting || unlinkingCli === 'claude'}
                          className="w-full sm:w-auto px-3 py-1.5 rounded-lg border border-error/30 text-error hover:bg-error/10 font-medium text-xs transition-all cursor-pointer text-center flex items-center justify-center gap-1.5 disabled:opacity-50"
                          title="Unlink Claude CLI"
                        >
                          {unlinkingCli === 'claude' ? (
                            <>
                              <span className="material-symbols-outlined text-[13px] animate-spin">progress_activity</span>
                              <span>Unlinking...</span>
                            </>
                          ) : (
                            'Unlink'
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleLinkClaudeCli}
                          disabled={isSubmitting}
                          className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3.5 py-2 sm:py-1.5 rounded-lg bg-[#D97706] text-white hover:bg-[#B45309] font-semibold text-xs transition-all cursor-pointer shadow-sm disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                          <span>Link Claude CLI</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {!cliStatus?.claude?.linked && (
                    <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-outline-variant/15 text-[11px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-outline shrink-0">Mode:</span>
                        <div className="inline-flex rounded-md p-0.5 bg-surface-container border border-outline-variant/30">
                          <button
                            type="button"
                            onClick={() => setClaudeAuthMode('console')}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                              claudeAuthMode === 'console'
                                ? 'bg-primary text-on-primary shadow-xs'
                                : 'text-on-surface-variant hover:text-on-surface'
                            }`}
                            title="Anthropic Console (API billing / free credits, no Claude Pro subscription needed)"
                          >
                            Console (Free / API)
                          </button>
                          <button
                            type="button"
                            onClick={() => setClaudeAuthMode('claudeai')}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                              claudeAuthMode === 'claudeai'
                                ? 'bg-primary text-on-primary shadow-xs'
                                : 'text-on-surface-variant hover:text-on-surface'
                            }`}
                            title="Claude.ai (Pro or Team web subscription)"
                          >
                            Claude.ai (Subscription)
                          </button>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setShowClaudeCodeInput(!showClaudeCodeInput)}
                        className="text-outline hover:text-on-surface transition-colors cursor-pointer text-left sm:text-right"
                      >
                        {showClaudeCodeInput ? 'Hide manual code' : 'Paste code manually?'}
                      </button>
                    </div>
                  )}

                  {showClaudeCodeInput && !cliStatus?.claude?.linked && (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 pt-1.5">
                      <input
                        type="text"
                        placeholder="Paste authorization code here if prompted..."
                        value={claudeCodeInput}
                        onChange={(e) => setClaudeCodeInput(e.target.value)}
                        className="flex-1 bg-surface-container-lowest border border-outline-variant/30 rounded-md px-2.5 py-1.5 text-xs text-on-surface outline-none focus:border-primary font-mono"
                      />
                      <button
                        type="button"
                        onClick={handleSubmitClaudeCode}
                        disabled={!claudeCodeInput.trim() || isSubmitting}
                        className="px-3.5 py-1.5 rounded-md bg-secondary text-on-secondary font-medium text-xs cursor-pointer disabled:opacity-40 text-center flex items-center justify-center gap-1.5 shrink-0"
                      >
                        {isSubmitting ? (
                          <>
                            <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                            <span>Submitting...</span>
                          </>
                        ) : (
                          'Submit'
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {/* OpenAI Codex CLI (codex) */}
                <div className={`p-3 sm:p-4 rounded-xl border transition-all flex flex-col gap-2.5 relative overflow-hidden ${
                  codexProcessingStep
                    ? 'bg-[#10A37F]/5 border-[#10A37F]/50 shadow-md shadow-[#10A37F]/10 ring-1 ring-[#10A37F]/20'
                    : codexAuthError
                    ? 'bg-error-container/10 border-error/30'
                    : 'bg-surface-container-lowest border-outline-variant/20'
                }`}>
                  {/* Indeterminate loading bar when processing */}
                  {codexProcessingStep && (
                    <div className="absolute top-0 left-0 right-0 h-1 bg-[#10A37F]/20 overflow-hidden">
                      <div className="w-1/2 h-full bg-gradient-to-r from-[#10A37F] via-[#2DD4BF] to-[#10A37F] rounded-full animate-indeterminate" />
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3">
                    <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-lg bg-[#10A37F]/15 border border-[#10A37F]/30 flex items-center justify-center p-2 shrink-0">
                        <img src="/provider-icons/codex.svg" alt="OpenAI Codex CLI" className="w-5 h-5 object-contain" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-xs sm:text-sm text-on-surface flex items-center gap-1.5 flex-wrap">
                          <span>OpenAI Codex CLI (codex)</span>
                          {cliStatus?.codex?.linked ? (
                            <span className="text-secondary font-mono text-[10px] bg-secondary/10 px-1.5 py-0.5 rounded border border-secondary/20 whitespace-nowrap">
                              LINKED
                            </span>
                          ) : (
                            <span className="text-outline font-mono text-[10px] bg-surface-container-high px-1.5 py-0.5 rounded border border-outline-variant/30 whitespace-nowrap">
                              NOT LINKED
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] sm:text-xs text-outline line-clamp-2 sm:line-clamp-1 mt-0.5">
                          {cliStatus?.codex?.linked
                            ? (cliStatus.codex.email
                                ? `Authorized as ${cliStatus.codex.email} · Ready for model execution`
                                : 'Authorized via ChatGPT Account · Ready for model execution')
                            : 'Connect via one-click OAuth browser popup (ChatGPT Free or Plus)'}
                        </div>
                      </div>
                    </div>

                    <div className="w-full sm:w-auto shrink-0 flex items-center justify-end sm:justify-start">
                      {cliStatus?.codex?.linked ? (
                        <button
                          type="button"
                          onClick={handleUnlinkCodexCli}
                          disabled={isSubmitting || unlinkingCli === 'codex'}
                          className="w-full sm:w-auto px-3 py-1.5 rounded-lg border border-error/30 text-error hover:bg-error/10 font-medium text-xs transition-all cursor-pointer text-center flex items-center justify-center gap-1.5 disabled:opacity-50"
                          title="Unlink OpenAI Codex CLI"
                        >
                          {unlinkingCli === 'codex' ? (
                            <>
                              <span className="material-symbols-outlined text-[13px] animate-spin">progress_activity</span>
                              <span>Unlinking...</span>
                            </>
                          ) : (
                            'Unlink'
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleLinkCodexCli}
                          disabled={isSubmitting || Boolean(codexProcessingStep)}
                          className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3.5 py-2 sm:py-1.5 rounded-lg bg-[#10A37F] text-white hover:bg-[#0E8A6C] font-semibold text-xs transition-all cursor-pointer shadow-sm disabled:opacity-50"
                        >
                          {codexProcessingStep ? (
                            <>
                              <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                              <span>Authorizing...</span>
                            </>
                          ) : (
                            <>
                              <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                              <span>Link Codex CLI</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Linked Success Message */}
                  {cliStatus?.codex?.linked ? (
                    <div className="pt-2 border-t border-outline-variant/15 flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
                      <span className="material-symbols-outlined text-[14px]">check_circle</span>
                      <span>Codex CLI is linked! You can now safely close the OpenAI authorization popup.</span>
                    </div>
                  ) : null}

                  {/* Dynamic Processing Status Card */}
                  {codexProcessingStep && (
                    <div className={`flex items-center gap-3 p-3 rounded-xl border text-xs text-on-surface animate-fadeIn transition-all ${
                      codexSuccess
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-[#10A37F]/10 border-[#10A37F]/30 shadow-xs'
                    }`}>
                      {codexSuccess ? (
                        <div className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[18px]">check_circle</span>
                        </div>
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-[#10A37F]/20 text-[#10A37F] flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                        </div>
                      )}
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="font-semibold text-on-surface text-xs leading-tight">
                          {codexProcessingStep}
                        </span>
                        {!codexSuccess && (
                          <span className="text-[10px] text-outline mt-0.5">
                            Complete authorization in the opened browser popup window...
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Inline Error Card */}
                  {codexAuthError && !codexProcessingStep && (
                    <div className="flex items-start gap-2.5 p-3 rounded-xl bg-error-container/20 border border-error/40 text-error text-xs animate-fadeIn">
                      <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5 leading-none">error</span>
                      <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                        <span className="leading-snug break-words">{codexAuthError}</span>
                        <div className="flex items-center gap-2 pt-0.5">
                          <button
                            type="button"
                            onClick={handleLinkCodexCli}
                            className="px-2.5 py-1 rounded-md bg-error/15 hover:bg-error/25 text-error font-medium text-[11px] cursor-pointer transition-colors"
                          >
                            Open Sign-in again
                          </button>
                          <button
                            type="button"
                            onClick={() => setCodexAuthError(null)}
                            className="px-2 py-1 text-outline hover:text-on-surface text-[11px] cursor-pointer"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Antigravity CLI Status Card */}
                <div className="p-3 sm:p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/20 flex flex-col gap-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3">
                    <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-lg bg-[#4285F4]/15 border border-[#4285F4]/30 flex items-center justify-center p-2 shrink-0">
                        <img src="/provider-icons/antigravity.svg" alt="Antigravity CLI" className="w-5 h-5 object-contain" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-xs sm:text-sm text-on-surface flex items-center gap-1.5 flex-wrap">
                          <span>Antigravity CLI (agy)</span>
                          {cliStatus?.antigravity?.linked ? (
                            <span className="text-secondary font-mono text-[10px] bg-secondary/10 px-1.5 py-0.5 rounded border border-secondary/20 whitespace-nowrap">
                              LINKED
                            </span>
                          ) : (
                            <span className="text-outline font-mono text-[10px] bg-surface-container-high px-1.5 py-0.5 rounded border border-outline-variant/30 whitespace-nowrap">
                              NOT LINKED
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] sm:text-xs text-outline line-clamp-2 sm:line-clamp-1 mt-0.5">
                          {cliStatus?.antigravity?.linked
                            ? (cliStatus.antigravity?.details ||
                                `Authorized as ${cliStatus.antigravity?.email || 'Google Account'}`)
                            : 'Sign in with Google to authorize Antigravity CLI without API keys'}
                        </div>
                      </div>
                    </div>

                    <div className="w-full sm:w-auto shrink-0 flex items-center justify-end sm:justify-start">
                      {cliStatus?.antigravity?.linked ? (
                        <button
                          type="button"
                          onClick={handleUnlinkGeminiCli}
                          disabled={isSubmitting || unlinkingCli === 'antigravity'}
                          className="w-full sm:w-auto px-3 py-1.5 rounded-lg border border-error/30 text-error hover:bg-error/10 font-medium text-xs transition-all cursor-pointer text-center flex items-center justify-center gap-1.5 disabled:opacity-50"
                          title="Unlink Antigravity CLI"
                        >
                          {unlinkingCli === 'antigravity' ? (
                            <>
                              <span className="material-symbols-outlined text-[13px] animate-spin">progress_activity</span>
                              <span>Unlinking...</span>
                            </>
                          ) : (
                            'Unlink'
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleLinkGeminiCli}
                          disabled={isSubmitting}
                          className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3.5 py-2 sm:py-1.5 rounded-lg bg-[#4285F4] text-white hover:bg-[#3367D6] font-semibold text-xs transition-all cursor-pointer shadow-sm disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                          <span>Link Antigravity CLI</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {cliStatus?.antigravity?.linked ? (
                    <div className="pt-2 border-t border-outline-variant/15 flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
                      <span className="material-symbols-outlined text-[14px]">check_circle</span>
                      <span>Antigravity CLI is linked! You can now safely close the Google sign-in window.</span>
                    </div>
                  ) : (
                    <>
                      <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2 border-t border-outline-variant/15 text-[11px]">
                        <span className="text-outline text-[11px] leading-snug">
                          Opens Google sign-in tab &rarr; Authorize &rarr; paste the code below
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowAgyCodeInput(!showAgyCodeInput)}
                          className="text-outline hover:text-on-surface transition-colors cursor-pointer self-start sm:self-auto shrink-0"
                        >
                          {showAgyCodeInput ? 'Hide code input' : 'Paste code manually'}
                        </button>
                      </div>

                      {showAgyCodeInput && (
                        <div
                          ref={agyInputContainerRef}
                          className={`p-3.5 rounded-xl border transition-all flex flex-col gap-3 mt-1 relative overflow-hidden ${
                          agyProcessingStep 
                            ? 'bg-[#4285F4]/5 border-[#4285F4]/50 shadow-md shadow-[#4285F4]/10 ring-1 ring-[#4285F4]/20' 
                            : agyAuthError
                            ? 'bg-error-container/10 border-error/30'
                            : 'bg-surface-container/40 border-outline-variant/20'
                        }`}>
                          {/* Indeterminate loading bar when processing */}
                          {agyProcessingStep && (
                            <div className="absolute top-0 left-0 right-0 h-1 bg-[#4285F4]/20 overflow-hidden">
                              <div className="w-1/2 h-full bg-gradient-to-r from-[#4285F4] via-[#669DF6] to-[#34A853] rounded-full animate-indeterminate" />
                            </div>
                          )}

                          <div className="text-[11px] text-on-surface-variant flex flex-col gap-0.5">
                            <span className="font-semibold text-on-surface">3-Step Authorization:</span>
                            <span>1. Click <strong>Link Antigravity CLI</strong> to open Google sign-in.</span>
                            <span>2. Sign in, then click the <strong>Copy to Clipboard</strong> button on the webpage (starts with <strong>4/</strong>). Do not copy the URL bar.</span>
                            <span>3. Paste the code below and click <strong>Submit Code</strong> (you can then close the Google window).</span>
                          </div>

                          {/* Dynamic Processing Status Card */}
                          {agyProcessingStep && (
                            <div className={`flex items-center gap-3 p-3 rounded-xl border text-xs text-on-surface animate-fadeIn transition-all ${
                              agySuccess
                                ? 'bg-emerald-500/10 border-emerald-500/30'
                                : 'bg-[#4285F4]/10 border-[#4285F4]/30 shadow-xs'
                            }`}>
                              {agySuccess ? (
                                <div className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                                </div>
                              ) : (
                                <div className="w-7 h-7 rounded-full bg-[#4285F4]/20 text-[#4285F4] flex items-center justify-center shrink-0">
                                  <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                                </div>
                              )}
                              <div className="flex flex-col flex-1 min-w-0">
                                <span className="font-semibold text-on-surface text-xs leading-tight">
                                  {agyProcessingStep}
                                </span>
                                {!agySuccess && (
                                  <span className="text-[10px] text-outline mt-0.5">
                                    Communicating with OAuth server & activating CLI sandbox link...
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Inline Error Card */}
                          {agyAuthError && !agyProcessingStep && (
                            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-error-container/20 border border-error/40 text-error text-xs animate-fadeIn">
                              <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5 leading-none">error</span>
                              <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                                <span className="leading-snug break-words">{agyAuthError}</span>
                                <div className="flex items-center gap-2 pt-0.5">
                                  <button
                                    type="button"
                                    onClick={handleLinkGeminiCli}
                                    className="px-2.5 py-1 rounded-md bg-error/15 hover:bg-error/25 text-error font-medium text-[11px] cursor-pointer transition-colors"
                                  >
                                    Open Google Sign-in again
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setAgyAuthError(null)}
                                    className="px-2 py-1 text-outline hover:text-on-surface text-[11px] cursor-pointer"
                                  >
                                    Dismiss
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5">
                            <div className="relative flex-1">
                              <input
                                type="text"
                                placeholder="Paste authorization code (starts with 4/)..."
                                value={agyCodeInput}
                                onChange={(e) => {
                                  setAgyCodeInput(e.target.value);
                                  if (agyAuthError) setAgyAuthError(null);
                                }}
                                disabled={Boolean(agyProcessingStep)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !agyProcessingStep) handleSubmitAgyCode();
                                }}
                                className={`w-full bg-surface-container-lowest border rounded-lg px-3 py-2 text-xs text-on-surface outline-none font-mono transition-all ${
                                  agyProcessingStep
                                    ? 'opacity-60 border-[#4285F4]/50 cursor-not-allowed bg-surface-container-low pl-8'
                                    : agyAuthError
                                    ? 'border-error/50 focus:border-error'
                                    : 'border-outline-variant/30 focus:border-primary'
                                }`}
                              />
                              {agyProcessingStep && (
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-[15px] text-[#4285F4] animate-spin">
                                  sync
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={handleSubmitAgyCode}
                              disabled={!agyCodeInput.trim() || isSubmitting || Boolean(agyProcessingStep)}
                              className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg font-semibold text-xs transition-all text-center shrink-0 min-w-[125px] cursor-pointer ${
                                agySuccess
                                  ? 'bg-emerald-600 text-white shadow-sm'
                                  : agyProcessingStep
                                  ? 'bg-[#4285F4]/80 text-white cursor-wait shadow-sm'
                                  : 'bg-[#4285F4] text-white hover:bg-[#3367D6] shadow-sm disabled:opacity-40 disabled:cursor-not-allowed'
                              }`}
                            >
                              {agySuccess ? (
                                <>
                                  <span className="material-symbols-outlined text-[15px]">check</span>
                                  <span>Linked!</span>
                                </>
                              ) : agyProcessingStep ? (
                                <>
                                  <span className="material-symbols-outlined text-[15px] animate-spin">progress_activity</span>
                                  <span>Verifying...</span>
                                </>
                              ) : (
                                <>
                                  <span className="material-symbols-outlined text-[15px]">send</span>
                                  <span>Submit Code</span>
                                </>
                              )}
                            </button>
                          </div>
                          {agyCodeInput.trim() && !agyCodeInput.trim().startsWith('4/') && !agyCodeInput.includes('code=') && !agyProcessingStep && !agyAuthError && (
                            <div className="flex items-center gap-1.5 text-[11px] text-amber-400 font-medium">
                              <span className="material-symbols-outlined text-[14px]">warning</span>
                              <span>Authorization codes start with <strong>4/</strong>. Please copy the code displayed on the webpage, not the address bar.</span>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Toggle BYOK Collapsible */}
                <div className="pt-space-xs text-right">
                  <button
                    onClick={() => setShowByok(!showByok)}
                    className="text-outline hover:text-on-surface font-label-sm text-xs transition-colors cursor-pointer"
                  >
                    {showByok ? 'Hide API Key Option' : '+ Or use pay-per-token API Key'}
                  </button>
                </div>

                {showByok && (
                  <div className="p-space-sm rounded-lg bg-surface-container border border-outline-variant/20 flex gap-2">
                    <select
                      value={selectedKeyPlatform}
                      onChange={(e) => setSelectedKeyPlatform(e.target.value as AIPlatform)}
                      className="bg-surface-container-lowest border border-outline-variant/30 rounded-md px-2 py-1 font-code-sm text-xs text-on-surface outline-none"
                    >
                      <option value="anthropic">Claude Key</option>
                      <option value="openai">OpenAI Key</option>
                    </select>
                    <input
                      type="password"
                      placeholder="sk-ant-... / sk-..."
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      className="flex-1 bg-surface-container-lowest border border-outline-variant/30 rounded-md px-2 py-1 font-code-sm text-xs text-on-surface placeholder:text-outline outline-none focus:border-primary"
                    />
                    <button
                      onClick={() => {
                        if (apiKeyInput.trim()) {
                          onConnectApiKey(selectedKeyPlatform, apiKeyInput.trim());
                          setApiKeyInput('');
                        }
                      }}
                      disabled={!apiKeyInput.trim() || isSubmitting}
                      className="px-3 py-1 rounded-md bg-primary text-on-primary font-label-md text-xs disabled:opacity-40 cursor-pointer"
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
