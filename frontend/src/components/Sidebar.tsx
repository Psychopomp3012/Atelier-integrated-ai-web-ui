import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type { ChatSession } from '../types';
import { AtelierLogo } from './AtelierLogo';
import { sessionsAtom, currentSessionIdAtom, isTelemetryModalOpenAtom } from '../state';

interface SidebarProps {
  sessions?: ChatSession[];
  currentSessionId?: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession?: (id: string) => void;
  onNewSession: () => void;
  isOpen?: boolean;
  onClose?: () => void;
  isSyncing?: boolean;
  onRefreshSessions?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions: propSessions,
  currentSessionId: propCurrentSessionId,
  onSelectSession,
  onDeleteSession,
  onNewSession,
  isOpen = false,
  onClose,
  isSyncing = false,
  onRefreshSessions,
}) => {
  const atomSessions = useAtomValue(sessionsAtom);
  const atomCurrentSessionId = useAtomValue(currentSessionIdAtom);
  const setIsTelemetryOpen = useSetAtom(isTelemetryModalOpenAtom);

  const sessions = propSessions !== undefined ? propSessions : atomSessions;
  const currentSessionId = propCurrentSessionId !== undefined ? propCurrentSessionId : atomCurrentSessionId;
  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs lg:hidden animate-fade-in"
        />
      )}

      {/* Sidebar Drawer Container */}
      <aside
        className={`fixed left-0 top-0 bottom-0 w-[260px] bg-surface-container-lowest border-r border-outline-variant/30 flex flex-col z-50 transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'
          }`}
      >
        {/* Brand Header */}
        <div className="h-14 px-margin flex items-center justify-between border-b border-outline-variant/20">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-surface-container/70 border border-outline-variant/40 flex items-center justify-center text-primary shadow-xs group transition-all hover:border-primary/50">
              <AtelierLogo className="w-5 h-5 transition-transform duration-300 group-hover:scale-110" withGlow />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5 leading-none">
                <span className="font-headline-sm text-sm text-on-surface font-semibold tracking-tight">
                  Atelier
                </span>
                <span className="text-[9px] font-mono font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 tracking-wider uppercase">
                  Studio
                </span>
              </div>
              <span className="text-[10px] text-on-surface-variant font-code-sm tracking-wide mt-0.5">
                Cloud Workspace
              </span>
            </div>
          </div>

          {/* Mobile Close Button */}
          {onClose && (
            <button
              onClick={onClose}
              className="lg:hidden w-7 h-7 rounded-lg bg-surface-container/70 hover:bg-surface-container-high border border-outline-variant/30 flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-all cursor-pointer shadow-sm active:scale-95"
              title="Close sidebar"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          )}
        </div>

        {/* New Session Button */}
        <div className="p-space-md border-b border-outline-variant/20">
          <button
            onClick={() => {
              onNewSession();
              onClose?.();
            }}
            className="w-full flex items-center justify-between px-space-md py-space-sm bg-primary hover:bg-primary-fixed-dim text-on-primary rounded-xl transition-all shadow-[0_0_16px_rgba(99,102,241,0.25)] group cursor-pointer"
          >
            <div className="flex items-center gap-space-sm">
              <span className="material-symbols-outlined text-[18px]">add_circle</span>
              <span className="font-label-md text-label-md font-semibold tracking-wide">NEW SESSION</span>
            </div>
            <kbd className="font-code-sm text-code-sm bg-on-primary/20 px-space-xs rounded text-on-primary">
              ⌘N
            </kbd>
          </button>
        </div>

        {/* Chat Sessions Stream */}
        <div className="flex-1 overflow-y-auto px-space-sm py-space-md space-y-space-md">
          <div className="px-space-sm flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">
                Recent Chats
              </span>
              <button
                type="button"
                onClick={onRefreshSessions}
                disabled={isSyncing}
                className="p-0.5 rounded text-outline hover:text-primary transition-colors cursor-pointer disabled:cursor-not-allowed"
                title={isSyncing ? 'Syncing cloud sessions...' : 'Reload cloud sessions'}
              >
                <span
                  className={`material-symbols-outlined text-[13px] ${isSyncing ? 'text-primary animate-spin' : 'hover:scale-110'
                    }`}
                >
                  sync
                </span>
              </button>
            </div>
            <span className="font-code-sm text-code-sm text-outline">
              {isSyncing ? '...' : sessions.length}
            </span>
          </div>

          {isSyncing && sessions.length === 0 ? (
            <div className="space-y-2.5 px-space-sm py-3">
              <div className="flex items-center gap-2.5 p-2 rounded-lg bg-surface-container/60 border border-outline-variant/15 animate-pulse">
                <div className="w-4 h-4 rounded bg-primary/30 shrink-0" />
                <div className="h-3.5 bg-outline-variant/30 rounded w-3/4" />
              </div>
              <div className="flex items-center gap-2.5 p-2 rounded-lg bg-surface-container/40 border border-outline-variant/10 animate-pulse delay-75">
                <div className="w-4 h-4 rounded bg-outline-variant/20 shrink-0" />
                <div className="h-3.5 bg-outline-variant/20 rounded w-1/2" />
              </div>
              <div className="flex items-center gap-2.5 p-2 rounded-lg bg-surface-container/30 border border-outline-variant/10 animate-pulse delay-150">
                <div className="w-4 h-4 rounded bg-outline-variant/20 shrink-0" />
                <div className="h-3.5 bg-outline-variant/20 rounded w-2/3" />
              </div>
              <div className="flex items-center justify-center gap-1.5 pt-2 text-primary/80">
                <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                <span className="text-[11px] font-medium tracking-wide">Syncing cloud sessions...</span>
              </div>
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-space-sm py-6 text-center text-outline">
              <span className="material-symbols-outlined text-[28px] opacity-40 mb-1 block">
                chat_bubble_outline
              </span>
              <p className="font-body-sm text-[12px] opacity-80">No recent chats yet.</p>
              <p className="font-body-sm text-[11px] opacity-60 mt-0.5">
                Send a prompt to start a session.
              </p>
            </div>
          ) : (
            <nav className="space-y-1">
              {sessions.map((session) => {
                const isActive = session.id === currentSessionId;
                return (
                  <div
                    key={session.id}
                    className={`group relative flex items-center justify-between rounded-lg transition-colors ${isActive
                      ? 'bg-surface-container text-on-surface border-l-2 border-primary font-medium'
                      : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                      }`}
                  >
                    <button
                      onClick={() => {
                        onSelectSession(session.id);
                        onClose?.();
                      }}
                      className="flex-1 min-w-0 flex items-center gap-2 px-space-sm py-2 text-left cursor-pointer truncate"
                      title={session.title}
                    >
                      <span
                        className={`material-symbols-outlined text-[15px] shrink-0 ${isActive ? 'text-primary' : 'text-outline'
                          }`}
                      >
                        chat_bubble
                      </span>
                      <span className="truncate font-body-sm text-[13px]">{session.title}</span>
                    </button>

                    {onDeleteSession && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(session.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 mr-1 text-outline hover:text-error transition-all rounded hover:bg-surface-container-high cursor-pointer"
                        title="Delete chat session"
                      >
                        <span className="material-symbols-outlined text-[14px]">delete</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </nav>
          )}
        </div>

        {/* CLI Telemetry & Quotas Quick Access Card */}
        <div className="p-3 border-t border-outline-variant/20 shrink-0">
          <button
            type="button"
            onClick={() => {
              setIsTelemetryOpen(true);
              onClose?.();
            }}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-surface-container/60 hover:bg-surface-container border border-outline-variant/30 hover:border-primary/40 transition-all duration-200 group cursor-pointer text-left shadow-xs"
            title="Inspect CLI Quota, Real Limits & Telemetry"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-6 h-6 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-[15px]">speed</span>
              </div>
              <div className="min-w-0 flex flex-col">
                <span className="text-[11px] font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
                  CLI Telemetry & Quotas
                </span>
                <span className="text-[9px] text-outline font-mono truncate">
                  Live limits & session analytics
                </span>
              </div>
            </div>
            <span className="material-symbols-outlined text-[16px] text-outline group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0">
              chevron_right
            </span>
          </button>
        </div>

        {/* App Version Box */}
        <div className="px-3 pb-3 pt-0 bg-surface-container-lowest/70 backdrop-blur-xs shrink-0">
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-surface-container/50 hover:bg-surface-container border border-outline-variant/30 hover:border-primary/40 transition-all duration-300 group cursor-default shadow-xs">
            <span className="text-[12px] font-medium text-on-surface tracking-tight group-hover:text-primary transition-colors">
              Atelier Studio
            </span>
            <div className="px-2 py-0.5 rounded-md bg-primary/10 border border-primary/25 text-primary text-[10px] font-mono font-semibold tracking-wider shadow-[0_0_8px_rgba(99,102,241,0.15)] group-hover:shadow-[0_0_12px_rgba(99,102,241,0.3)] transition-all">
              v0.1.6
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
