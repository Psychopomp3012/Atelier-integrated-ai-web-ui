import React, { useState } from 'react';

export interface CodeFile {
  filename: string;
  icon: string;
  code: string;
}

interface CodeArtifactProps {
  files?: CodeFile[];
  onRunSandbox?: (file: CodeFile) => void;
}

export const CodeArtifact: React.FC<CodeArtifactProps> = ({
  files = [],
  onRunSandbox,
}) => {
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runSuccess, setRunSuccess] = useState(false);

  if (!files || files.length === 0) return null;

  const currentFile = files[activeFileIndex] || files[0];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentFile.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleRun = () => {
    setIsRunning(true);
    onRunSandbox?.(currentFile);
    setTimeout(() => {
      setIsRunning(false);
      setRunSuccess(true);
      setTimeout(() => setRunSuccess(false), 2000);
    }, 700);
  };

  return (
    <div className="rounded-xl overflow-hidden bg-surface-container-lowest shadow-xl border border-outline-variant/20">
      {/* IDE File Bar & Control Bar */}
      <div className="px-space-md py-space-xs bg-surface-container flex flex-wrap items-center justify-between gap-space-sm border-b border-outline-variant/10">
        <div className="flex items-center gap-2 overflow-x-auto">
          {files.map((file, idx) => {
            const isActive = idx === activeFileIndex;
            return (
              <button
                key={file.filename}
                onClick={() => setActiveFileIndex(idx)}
                className={`flex items-center gap-space-xs px-space-sm py-1 rounded font-code-sm text-code-sm cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-surface-container-lowest text-on-surface shadow-sm font-medium border border-outline-variant/30'
                    : 'hover:bg-surface-container-high text-on-surface-variant'
                }`}
              >
                <span
                  className={`material-symbols-outlined text-[14px] ${
                    isActive ? 'text-tertiary' : 'text-outline'
                  }`}
                >
                  {file.icon}
                </span>
                <span>{file.filename}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-space-xs">
          <button
            onClick={handleRun}
            disabled={isRunning}
            className="flex items-center gap-space-xs px-space-md py-1 rounded bg-primary text-on-primary hover:bg-primary-fixed-dim font-label-md text-label-md font-semibold shadow-[0_0_12px_rgba(192,193,255,0.25)] transition-all cursor-pointer disabled:opacity-80"
          >
            {isRunning ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">refresh</span>
                <span>Executing...</span>
              </>
            ) : runSuccess ? (
              <>
                <span className="material-symbols-outlined text-[16px]">done</span>
                <span>Hot Reloaded</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                <span>Run in Cloud Sandbox</span>
              </>
            )}
          </button>

          <button
            onClick={handleCopy}
            className="flex items-center gap-space-xs p-1.5 rounded hover:bg-surface-container-high text-outline hover:text-on-surface transition-colors cursor-pointer"
            title="Copy snippet"
          >
            <span className="material-symbols-outlined text-[16px]">
              {copied ? 'check' : 'content_copy'}
            </span>
          </button>
        </div>
      </div>

      {/* Code Block with Syntax Emulation */}
      <div className="p-space-lg font-code-md text-code-md overflow-x-auto leading-relaxed select-text bg-surface-container-lowest">
        <pre className="text-on-surface-variant font-mono">
          <code>
            {currentFile.filename.endsWith('.ts') ? (
              currentFile.code.split('\n').map((line, lineIdx) => {
                // Subtle custom token styling
                let styledLine: React.ReactNode = line;
                if (line.startsWith('//')) {
                  styledLine = <span className="text-outline">{line}</span>;
                } else if (line.includes('import ') || line.includes('from ') || line.includes('const ') || line.includes('await ')) {
                  const parts = line.split(/(import|from|const|await|new|return)/g);
                  styledLine = parts.map((part, pIdx) => {
                    if (['import', 'from', 'const', 'await', 'new', 'return'].includes(part)) {
                      return <span key={pIdx} className="text-primary font-medium">{part}</span>;
                    }
                    if (part.includes("'") || part.includes('"')) {
                      return <span key={pIdx} className="text-secondary">{part}</span>;
                    }
                    return <span key={pIdx}>{part}</span>;
                  });
                }
                return (
                  <div key={lineIdx} className="table-row">
                    <span className="table-cell pr-4 text-outline select-none opacity-40 text-right w-6">
                      {lineIdx + 1}
                    </span>
                    <span className="table-cell">{styledLine}</span>
                  </div>
                );
              })
            ) : (
              currentFile.code
            )}
          </code>
        </pre>
      </div>
    </div>
  );
};
