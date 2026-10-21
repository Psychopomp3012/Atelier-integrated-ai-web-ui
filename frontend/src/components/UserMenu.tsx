import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import type { UserProfile } from '../types';
import { UserAvatar } from './UserAvatar';
import { currentUserAtom, isAuthModalOpenAtom } from '../state';

interface UserMenuProps {
  user?: UserProfile | null;
  onOpenAuthModal?: () => void;
  onLogout: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({
  user: propUser,
  onOpenAuthModal: propOnOpenAuthModal,
  onLogout,
}) => {
  const atomUser = useAtomValue(currentUserAtom);
  const setIsAuthModalOpen = useSetAtom(isAuthModalOpenAtom);

  const user = propUser !== undefined ? propUser : atomUser;
  const onOpenAuthModal = propOnOpenAuthModal ?? (() => setIsAuthModalOpen(true));
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) {
    return (
      <button
        onClick={onOpenAuthModal}
        className="h-[34px] inline-flex items-center gap-1.5 px-3 rounded-lg bg-primary text-on-primary hover:bg-primary-fixed-dim font-label-md text-xs font-semibold transition-all shadow-xs cursor-pointer whitespace-nowrap shrink-0"
      >
        <span className="material-symbols-outlined text-[16px] leading-none">login</span>
        <span className="hidden sm:inline leading-none">Sign in with Google</span>
        <span className="sm:hidden leading-none">Sign In</span>
      </button>
    );
  }

  return (
    <div className="relative shrink-0 flex items-center" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="h-[34px] w-[34px] md:w-auto p-0 md:pl-1 md:pr-2.5 md:gap-1.5 rounded-full bg-surface-container-low hover:bg-surface-container transition-colors cursor-pointer border border-outline-variant/30 shrink-0 shadow-xs inline-flex items-center justify-center overflow-hidden"
        title="Developer Profile & Connected AI Platforms"
      >
        <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="header" />
        <div className="hidden md:flex flex-col items-start text-left pr-0.5 justify-center leading-none">
          <span className="font-label-md text-xs text-on-surface font-semibold leading-none">
            {user.name}
          </span>
          {user.email && (
            <span className="font-code-sm text-[10px] text-outline truncate max-w-[130px] leading-none mt-0.5">
              {user.email}
            </span>
          )}
        </div>
      </button>

      {/* Popover Dropdown (Desktop) & Mobile Modal via React Portal */}
      {isOpen && (
        <>
          {/* Desktop Popover (hidden sm:block) */}
          <div className="hidden sm:block absolute right-0 top-full mt-2 w-72 rounded-xl bg-surface-container-lowest border border-outline-variant/30 shadow-2xl p-space-md text-on-surface z-50 animate-in fade-in zoom-in-95 duration-150">
            {/* User Details */}
            <div className="flex items-center gap-space-sm pb-space-sm border-b border-outline-variant/20 mb-space-sm">
              <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="lg" />
              <div className="min-w-0">
                <div className="font-label-md text-label-md font-semibold text-on-surface truncate">
                  {user.name}
                </div>
                <div className="font-code-sm text-code-sm text-outline truncate">
                  {user.email}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenAuthModal();
                }}
                className="w-full flex items-center gap-2 px-space-sm py-1.5 rounded-lg hover:bg-surface-container text-on-surface font-label-md text-label-md transition-colors text-left cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px] text-primary">add_link</span>
                <span>Manage / Link AI Accounts</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onLogout();
                }}
                className="w-full flex items-center gap-2 px-space-sm py-1.5 rounded-lg hover:bg-error-container/20 text-error font-label-md text-label-md transition-colors text-left cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">logout</span>
                <span>Sign out</span>
              </button>
            </div>
          </div>

          {/* Mobile Modal via React Portal */}
          {createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs sm:hidden animate-fade-in"
              onClick={(e) => {
                if (e.target === e.currentTarget) setIsOpen(false);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="user-profile-title"
                className="w-full max-w-sm bg-surface-container-lowest border border-outline-variant/30 rounded-2xl shadow-2xl p-4 animate-in fade-in zoom-in-95 duration-150 flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Modal Header / User Profile */}
                <div className="flex items-center justify-between pb-3.5 mb-3 border-b border-outline-variant/20 shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="lg" />
                    <div className="min-w-0">
                      <h3 id="user-profile-title" className="text-sm font-bold text-on-surface tracking-wide truncate">
                        {user.name}
                      </h3>
                      <p className="font-code-sm text-xs text-outline truncate">{user.email}</p>
                    </div>
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

                {/* Actions */}
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      onOpenAuthModal();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-surface-container-low hover:bg-surface-container border border-outline-variant/30 text-on-surface font-label-md text-xs font-semibold transition-all text-left cursor-pointer shadow-xs active:scale-[0.99]"
                  >
                    <span className="material-symbols-outlined text-[18px] text-primary">add_link</span>
                    <span>Manage / Link AI Accounts</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      onLogout();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-error-container/10 hover:bg-error-container/20 border border-error/30 text-error font-label-md text-xs font-semibold transition-all text-left cursor-pointer shadow-xs active:scale-[0.99]"
                  >
                    <span className="material-symbols-outlined text-[18px]">logout</span>
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
        </>
      )}
    </div>
  );
};
