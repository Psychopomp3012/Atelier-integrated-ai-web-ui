import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface SandboxPendingDelete {
  id: string;
  name: string;
  attachedCount: number;
  isCurrent?: boolean;
}

interface DeleteSandboxModalProps {
  isOpen: boolean;
  sandbox: SandboxPendingDelete | null;
  isDeleting: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DeleteSandboxModal: React.FC<DeleteSandboxModalProps> = ({
  isOpen,
  sandbox,
  isDeleting,
  error,
  onConfirm,
  onCancel,
}) => {
  // Listen for Escape key to close modal
  useEffect(() => {
    if (!isOpen || isDeleting) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDeleting, onCancel]);

  if (!isOpen || !sandbox) return null;

  const shortId = sandbox.id.length > 8 ? sandbox.id.substring(0, 8) : sandbox.id;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) {
          onCancel();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-sandbox-title"
    >
      <div
        className="w-full max-w-md bg-surface-container-low border border-outline-variant/35 rounded-2xl shadow-2xl p-5 sm:p-6 text-on-surface relative animate-in fade-in zoom-in-95 duration-150 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top glowing accent border */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-600/30 via-red-500 to-red-600/30" />

        {/* Close Button */}
        <button
          type="button"
          onClick={onCancel}
          disabled={isDeleting}
          className="absolute top-4 right-4 w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-surface-container/70 hover:bg-surface-container-high border border-outline-variant/30 flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-all cursor-pointer disabled:opacity-40"
          title="Cancel and close"
        >
          <span className="material-symbols-outlined text-[16px] sm:text-[18px]">close</span>
        </button>

        {/* Header with Danger Icon */}
        <div className="flex items-start gap-3.5 mb-4">
          <div className="w-11 h-11 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0 shadow-inner">
            <span className="material-symbols-outlined text-[24px]">delete_forever</span>
          </div>
          <div className="pr-6">
            <h3 id="delete-sandbox-title" className="text-base sm:text-lg font-semibold text-on-surface tracking-tight">
              Delete Cloud Sandbox
            </h3>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Permanently terminate microVM & release sandbox slot
            </p>
          </div>
        </div>

        {/* Sandbox Target Details Card */}
        <div className="p-3.5 rounded-xl bg-surface-container/80 border border-outline-variant/25 mb-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-[18px] text-tertiary shrink-0">deployed_code</span>
              <span className="text-sm font-semibold text-on-surface truncate" title={sandbox.name}>
                {sandbox.name}
              </span>
            </div>
            <span className="font-mono text-[11px] font-medium text-on-surface-variant px-2 py-0.5 rounded bg-surface-container-high border border-outline-variant/30 shrink-0">
              ID: {shortId}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant pt-2 border-t border-outline-variant/15">
            {sandbox.isCurrent && (
              <span className="text-[10px] bg-primary/20 text-primary border border-primary/30 px-2 py-0.5 rounded font-medium">
                Active in this chat
              </span>
            )}
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px] text-primary">link</span>
              <span>
                {sandbox.attachedCount} {sandbox.attachedCount === 1 ? 'chat attached' : 'chats attached'}
              </span>
            </span>
            <span className="text-outline">•</span>
            <span className="text-emerald-400 font-medium flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">check_circle</span>
              <span>Frees 1 quota slot</span>
            </span>
          </div>
        </div>

        {/* Warning / Impact Note */}
        {sandbox.attachedCount > 1 ? (
          <div className="p-3.5 rounded-xl bg-red-950/30 border border-red-500/40 text-red-200 text-xs mb-5 flex items-start gap-2.5">
            <span className="material-symbols-outlined text-[20px] text-red-400 shrink-0 mt-0.5">
              warning
            </span>
            <div className="leading-relaxed">
              <span className="font-semibold text-red-300">Multiple chats attached: </span>
              There are <strong className="font-bold underline text-white">{sandbox.attachedCount} chat sessions</strong> sharing this sandbox workspace. Deleting it will permanently terminate the cloud microVM and erase the workspace files for all of them.
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-xl bg-red-950/20 border border-red-500/30 text-on-surface-variant text-xs mb-5 flex items-start gap-2.5 leading-relaxed">
            <span className="material-symbols-outlined text-[18px] text-red-400 shrink-0 mt-0.5">
              info
            </span>
            <div>
              Are you sure you want to delete <span className="font-semibold text-on-surface">{sandbox.name}</span>? This will permanently terminate the cloud microVM, erase any uncommitted files in its filesystem, and release 1 sandbox quota slot.
            </div>
          </div>
        )}

        {/* Error message if API fails */}
        {error && (
          <div className="p-2.5 rounded-lg bg-red-950/40 border border-red-500/50 text-red-300 text-xs mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-red-400 shrink-0">error</span>
            <span className="truncate">{error}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 sm:py-2.5 rounded-xl border border-outline-variant/30 hover:bg-surface-container text-on-surface-variant hover:text-on-surface text-xs sm:text-sm font-medium transition-all cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2 sm:py-2.5 rounded-xl bg-red-600 hover:bg-red-500 active:bg-red-700 text-white active:scale-95 text-xs sm:text-sm font-semibold shadow-lg shadow-red-950/50 border border-red-500/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-60"
          >
            {isDeleting ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">sync</span>
                <span>Deleting...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">delete</span>
                <span>Delete Sandbox</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
