import React, { useEffect, useRef } from 'react';
import type { SlashCommand, SlashCategory } from '../utils/slashCommands';

interface SlashCommandPaletteProps {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelectCommand: (cmd: SlashCommand) => void;
  providerCategory: SlashCategory;
  searchQuery: string;
}

export const SlashCommandPalette: React.FC<SlashCommandPaletteProps> = ({
  commands,
  selectedIndex,
  onSelectCommand,
  providerCategory,
  searchQuery,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll<HTMLButtonElement>('[data-command-item]');
    const activeItem = items[selectedIndex];
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const providerMeta: Record<
    SlashCategory,
    { name: string; cli: string; icon: string; badgeClass: string; iconClass: string }
  > = {
    antigravity: {
      name: 'Antigravity CLI',
      cli: 'agy',
      icon: 'auto_awesome',
      badgeClass: 'bg-[#4285F4]/15 text-[#4285F4] border-[#4285F4]/30',
      iconClass: 'text-[#4285F4]',
    },
    codex: {
      name: 'OpenAI Codex CLI',
      cli: 'codex',
      icon: 'code',
      badgeClass: 'bg-[#10A37F]/15 text-[#10A37F] border-[#10A37F]/30',
      iconClass: 'text-[#10A37F]',
    },
  };

  const currentMeta = providerMeta[providerCategory];

  return (
    <div
      className="absolute bottom-[calc(100%+8px)] left-0 right-0 sm:left-2 sm:right-2 z-50 rounded-2xl bg-surface-container-low/95 dark:bg-[#1E1F22]/95 backdrop-blur-xl border border-outline-variant/30 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150 select-none max-w-full"
      role="listbox"
      aria-label="Slash Commands"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-outline-variant/15 bg-surface-container-high/40 text-xs">
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${currentMeta.badgeClass}`}>
            <span className="material-symbols-outlined text-[14px]">{currentMeta.icon}</span>
            <span>{currentMeta.name}</span>
            <span className="opacity-70 font-mono text-[10px]">({currentMeta.cli})</span>
          </div>

          <span className="text-[11px] font-mono text-outline">
            {commands.length} command{commands.length === 1 ? '' : 's'}
          </span>

          {searchQuery && (
            <span className="text-[11px] font-mono text-primary font-semibold truncate max-w-[140px]">
              filter: /{searchQuery}
            </span>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-2 text-[10px] text-outline font-mono">
          <span><kbd className="px-1 py-0.5 rounded bg-surface-container-highest border border-outline-variant/30">↑</kbd> <kbd className="px-1 py-0.5 rounded bg-surface-container-highest border border-outline-variant/30">↓</kbd> navigate</span>
          <span>•</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-surface-container-highest border border-outline-variant/30">↵</kbd> select</span>
          <span>•</span>
          <span><kbd className="px-1 py-0.5 rounded bg-surface-container-highest border border-outline-variant/30">esc</kbd> close</span>
        </div>
      </div>

      {/* Command items list */}
      <div
        ref={listRef}
        className="max-h-72 sm:max-h-80 overflow-y-auto scrollbar-thin p-1.5 flex flex-col gap-0.5"
      >
        {commands.length === 0 ? (
          <div className="py-8 px-4 text-center">
            <span className="material-symbols-outlined text-outline text-[32px] block mb-1.5">
              search_off
            </span>
            <p className="text-xs text-outline font-medium">
              No matching commands in {currentMeta.name} for <span className="font-mono text-on-surface">/{searchQuery}</span>
            </p>
          </div>
        ) : (
          commands.map((cmd, index) => {
            const isSelected = index === selectedIndex;

            return (
              <button
                key={cmd.id}
                type="button"
                data-command-item
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent blurring textarea
                  onSelectCommand(cmd);
                }}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-primary/15 text-primary border-l-3 border-primary shadow-xs ring-1 ring-primary/20'
                    : 'hover:bg-surface-container text-on-surface hover:text-on-surface border-l-3 border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      isSelected
                        ? 'bg-primary/20 text-primary'
                        : 'bg-surface-container-high ' + cmd.iconColor
                    }`}
                  >
                    <span className="material-symbols-outlined text-[17px]">
                      {cmd.icon}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-xs font-bold text-on-surface tracking-tight">
                        {cmd.command}
                      </span>
                      {cmd.hint && (
                        <span className="font-mono text-[10px] text-outline font-normal">
                          {cmd.hint}
                        </span>
                      )}
                      {cmd.alias && (
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-surface-container-highest text-outline/80">
                          {cmd.alias}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-on-surface-variant/80 truncate max-w-[280px] sm:max-w-md">
                      {cmd.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase tracking-wider ${currentMeta.badgeClass}`}
                  >
                    {currentMeta.cli}
                  </span>
                  {isSelected && (
                    <span className="material-symbols-outlined text-[15px] text-primary hidden sm:block animate-pulse">
                      keyboard_return
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
