import React from 'react';

interface LoadingScreenProps {
  message?: string;
  subMessage?: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  message = 'Initializing Atelier Workspace',
  subMessage = 'Connecting to cloud microVMs & models...',
}) => {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-50/95 dark:bg-[#090d16]/95 backdrop-blur-md transition-colors duration-300 select-none animate-fadeIn"
      role="status"
      aria-live="polite"
    >
      {/* Background ambient decorative glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-gradient-to-tr from-sky-400/20 via-indigo-400/15 to-purple-400/20 dark:from-primary/20 dark:via-sky-500/15 dark:to-purple-500/20 blur-3xl pointer-events-none animate-pulse-glow" />

      {/* Center 3D rotating isometric cube container */}
      <div className="relative flex flex-col items-center justify-center mb-6">
        <div className="cube-viewport">
          <div className="cube-3d">
            <div className="cube-face cube-face-front">
              <div className="cube-facet-dot" />
            </div>
            <div className="cube-face cube-face-back">
              <div className="cube-facet-dot" />
            </div>
            <div className="cube-face cube-face-right">
              <div className="cube-facet-dot" />
            </div>
            <div className="cube-face cube-face-left">
              <div className="cube-facet-dot" />
            </div>
            <div className="cube-face cube-face-top">
              <div className="cube-facet-dot" />
            </div>
            <div className="cube-face cube-face-bottom">
              <div className="cube-facet-dot" />
            </div>
            <div className="cube-core" />
          </div>
          <div className="cube-shadow" />
        </div>
      </div>

      {/* Brand & Loading Label */}
      <div className="flex flex-col items-center text-center z-10 px-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-mono font-semibold tracking-[0.25em] text-sky-600 dark:text-sky-400 uppercase leading-none">
            ATELIER
          </span>
          <span className="relative flex h-2 w-2 items-center justify-center -translate-y-[1.5px]">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-500 dark:bg-sky-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-sky-500 dark:bg-sky-400" />
          </span>
        </div>
        <h2 className="text-base sm:text-lg font-medium text-slate-800 dark:text-white tracking-wide mb-1.5">
          {message}
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-normal max-w-xs">
          {subMessage}
        </p>

        {/* Minimal indeterminate progress line */}
        <div className="w-48 h-1 bg-slate-200 dark:bg-slate-800 rounded-full mt-6 overflow-hidden relative">
          <div className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-sky-500 dark:via-sky-400 to-transparent rounded-full animate-indeterminate" />
        </div>
      </div>
    </div>
  );
};
