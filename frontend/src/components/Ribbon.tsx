import React from 'react';

interface RibbonProps {
  onShareSession: () => void;
  onExportLogs: () => void;
}

export const Ribbon: React.FC<RibbonProps> = ({
  onShareSession,
  onExportLogs,
}) => {
  return (
    <div
      className="sticky top-14 z-30 w-full bg-surface-container-lowest/90 backdrop-blur-md px-3 md:px-margin-desktop py-2 flex items-center justify-end gap-space-sm shadow-sm border-b border-outline-variant/10"
    >
      {/* Quick Action Commands Toolbar */}
      <div className="flex items-center gap-1 sm:gap-space-sm shrink-0">
        <button
          onClick={onShareSession}
          className="flex items-center gap-space-xs px-2 sm:px-space-sm py-1 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface font-label-md text-xs sm:text-label-md transition-colors cursor-pointer"
          title="Share Session"
        >
          <span className="material-symbols-outlined text-[15px]">share</span>
          <span className="hidden sm:inline">Share</span>
        </button>

        <button
          onClick={onExportLogs}
          className="flex items-center gap-space-xs px-2 sm:px-space-sm py-1 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface font-label-md text-xs sm:text-label-md transition-colors cursor-pointer"
          title="Export Logs"
        >
          <span className="material-symbols-outlined text-[15px]">download</span>
          <span className="hidden sm:inline">Export</span>
        </button>
      </div>
    </div>
  );
};
