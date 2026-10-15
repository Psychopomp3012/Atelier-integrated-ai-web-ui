import React, { useState, useRef, useEffect } from 'react';
import type { UserProfile } from '../types';
import { UserAvatar } from './UserAvatar';

interface UserMenuProps {
  user: UserProfile | null;
  onOpenAuthModal: () => void;
  onLogout: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({
  user,
  onOpenAuthModal,
  onLogout,
}) => {
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
        className="flex items-center gap-space-xs px-space-md py-1.5 rounded-lg bg-primary text-on-primary hover:bg-primary-fixed-dim font-label-md text-label-md font-semibold transition-all shadow-sm cursor-pointer"
      >
        <span className="material-symbols-outlined text-[16px]">login</span>
        <span>Sign in with Google</span>
      </button>
    );
  }

  const hasAnthropic = user.linkedPlatforms.some((p) => p.platform === 'anthropic' && p.hasValidSession);
  const hasOpenAI = user.linkedPlatforms.some((p) => p.platform === 'openai' && p.hasValidSession);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 p-1 rounded-full hover:bg-surface-container transition-colors cursor-pointer border border-outline-variant/30"
        title="Developer Profile & Connected AI Platforms"
      >
        <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="md" />
        <div className="hidden md:flex flex-col items-start text-left pr-1.5">
          <span className="font-label-md text-label-md text-on-surface font-semibold leading-none">
            {user.name}
          </span>
          <div className="flex items-center gap-1 mt-0.5">
            {hasAnthropic && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#F59E0B]" title="Anthropic Active" />
            )}
            {hasOpenAI && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#10A37F]" title="OpenAI Active" />
            )}
            <span className="font-code-sm text-[10px] text-outline">Dual AI</span>
          </div>
        </div>
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-2xl p-space-md text-on-surface z-50 animate-fade-in">
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
      )}
    </div>
  );
};
