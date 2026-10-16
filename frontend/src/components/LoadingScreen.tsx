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
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#090d16]/90 backdrop-blur-md transition-opacity duration-500 select-none animate-fadeIn"
      role="status"
      aria-live="polite"
    >
      {/* Background ambient decorative glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-gradient-to-tr from-primary/20 via-sky-500/15 to-purple-500/20 blur-3xl pointer-events-none animate-pulse-glow" />

      {/* Center 3D rotating square container */}
      <div className="relative flex items-center justify-center w-28 h-28 mb-8">
        {/* Outer glowing aura */}
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-sky-500/30 to-purple-600/30 blur-lg animate-pulse" />

        {/* Outer rotating 3D square */}
        <div className="w-20 h-20 rounded-2xl border-2 border-transparent bg-gradient-to-br from-sky-400 via-indigo-500 to-purple-500 p-[2px] animate-rotate-3d-square shadow-[0_0_25px_rgba(56,189,248,0.35)]">
          <div className="w-full h-full rounded-[14px] bg-[#0d1322]/90 backdrop-blur-sm flex items-center justify-center">
            {/* Inner counter-rotating square */}
            <div className="w-10 h-10 rounded-lg border border-sky-400/60 bg-sky-500/10 animate-rotate-3d-inner flex items-center justify-center shadow-[inset_0_0_10px_rgba(56,189,248,0.2)]">
              {/* Core pulsing accent dot */}
              <div className="w-2.5 h-2.5 rounded-sm bg-gradient-to-tr from-sky-400 to-indigo-300 animate-pulse shadow-[0_0_8px_#38bdf8]" />
            </div>
          </div>
        </div>
      </div>

      {/* Brand & Loading Label */}
      <div className="flex flex-col items-center text-center z-10 px-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-mono font-semibold tracking-[0.25em] text-sky-400 uppercase">
            ATELIER
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
        </div>
        <h2 className="text-base sm:text-lg font-medium text-white tracking-wide mb-1.5">
          {message}
        </h2>
        <p className="text-xs sm:text-sm text-slate-400 font-normal max-w-xs">
          {subMessage}
        </p>

        {/* Minimal indeterminate progress line */}
        <div className="w-48 h-1 bg-slate-800 rounded-full mt-6 overflow-hidden relative">
          <div className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-sky-400 to-transparent rounded-full animate-indeterminate" />
        </div>
      </div>
    </div>
  );
};
