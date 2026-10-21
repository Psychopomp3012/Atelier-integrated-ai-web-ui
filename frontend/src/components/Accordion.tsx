import React, { useState, useEffect } from 'react';
import type { StepItem } from '../types';

interface AccordionProps {
  title?: string;
  steps: StepItem[];
  isExecuting?: boolean;
  sandboxName?: string | null;
}

export const isStepCompleted = (s: StepItem): boolean =>
  s.completed !== undefined ? Boolean(s.completed) : s.status === 'completed';

export const Accordion: React.FC<AccordionProps> = ({
  title,
  steps,
  isExecuting,
  sandboxName,
}) => {
  const hasIncompleteSteps = steps.some((s) => !isStepCompleted(s));
  const activeExecuting = isExecuting !== undefined ? isExecuting : hasIncompleteSteps;

  // Track if user explicitly clicked main accordion toggle: null means track activeExecuting automatically
  const [userToggled, setUserToggled] = useState<boolean | null>(null);

  // Set of individual step IDs that are expanded to view terminal command & stdout
  const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Auto-expand steps that have output or are actively running
  useEffect(() => {
    setUserToggled(null);
    setExpandedStepIds((prev) => {
      const next = new Set(prev);
      for (const step of steps) {
        if (!isStepCompleted(step) || (step.output && step.output.length > 0)) {
          next.add(step.id);
        }
      }
      return next;
    });
  }, [activeExecuting, steps.length]);

  const isOpen = userToggled !== null ? userToggled : activeExecuting;
  const completedCount = steps.filter(isStepCompleted).length;

  const displayTitle =
    title ||
    (activeExecuting
      ? (sandboxName ? 'Autonomous Cloud Sandbox Execution in Progress' : 'Cloud Agent Execution in Progress')
      : (sandboxName ? 'Autonomous Cloud Sandbox Execution Completed' : 'Cloud Agent Execution Completed'));

  const compactTitle =
    title ||
    (activeExecuting
      ? (sandboxName ? 'Sandbox Executing' : 'Agent Executing')
      : (sandboxName ? 'Sandbox Completed' : 'Execution Completed'));

  const toggleStepDetails = (stepId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExpandedStepIds((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  const copyToClipboard = async (text: string, id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  const getStepIcon = (step: StepItem) => {
    const isCompleted = isStepCompleted(step);
    const t = (step.text || step.description || '').toLowerCase();
    const tool = (step.tool || '').toLowerCase();

    if (tool === 'run_command' || t.includes('running command') || t.includes('terminal')) {
      return (
        <span className={`material-symbols-outlined text-[16px] ${isCompleted ? 'text-secondary' : 'text-primary animate-pulse'}`}>
          terminal
        </span>
      );
    }
    if (tool === 'read_file' || t.includes('reading file') || t.includes('viewing file')) {
      return (
        <span className={`material-symbols-outlined text-[16px] ${isCompleted ? 'text-secondary' : 'text-primary'}`}>
          description
        </span>
      );
    }
    if (tool === 'write_file' || t.includes('writing artifact') || t.includes('editing code')) {
      return (
        <span className={`material-symbols-outlined text-[16px] ${isCompleted ? 'text-secondary' : 'text-primary'}`}>
          edit_document
        </span>
      );
    }
    if (tool === 'list_dir' || t.includes('scanning directory') || t.includes('directory')) {
      return (
        <span className={`material-symbols-outlined text-[16px] ${isCompleted ? 'text-secondary' : 'text-primary'}`}>
          folder_open
        </span>
      );
    }
    if (
      t.includes('reasoning') ||
      t.includes('analyzing') ||
      t.includes('formulating') ||
      t.includes('plan') ||
      t.includes('thinking') ||
      t.includes('thought') ||
      t.includes('reasoned')
    ) {
      return (
        <span className={`material-symbols-outlined text-[16px] ${isCompleted ? 'text-secondary' : 'text-primary animate-pulse'}`}>
          settings
        </span>
      );
    }
    if (isCompleted) {
      return (
        <span className="material-symbols-outlined text-[16px] text-secondary">
          check_circle
        </span>
      );
    }
    return (
      <span className="material-symbols-outlined text-[16px] text-primary animate-spin">
        progress_activity
      </span>
    );
  };

  return (
    <div className="rounded-xl bg-surface-container-low overflow-hidden shadow-sm border border-outline-variant/30 transition-all">
      {/* Header Bar */}
      <button
        type="button"
        onClick={() => setUserToggled(!isOpen)}
        className="w-full px-space-md py-space-sm bg-surface-container flex items-center justify-between gap-2 text-left transition-colors hover:bg-surface-container-high cursor-pointer select-none overflow-hidden"
      >
        <div className="flex items-center gap-1.5 sm:gap-space-sm min-w-0 flex-1 overflow-hidden">
          {activeExecuting ? (
            <span className="shrink-0 material-symbols-outlined text-[18px] text-primary animate-spin">
              progress_activity
            </span>
          ) : (
            <span className="shrink-0 material-symbols-outlined text-[18px] text-secondary">
              check_circle
            </span>
          )}
          <span className="font-label-md text-label-md font-semibold text-on-surface truncate min-w-0">
            <span className="hidden sm:inline">{displayTitle}</span>
            <span className="inline sm:hidden">{compactTitle}</span>
          </span>

          {/* Progress / Step Count Badge */}
          {activeExecuting ? (
            <span className="shrink-0 whitespace-nowrap font-code-sm text-code-sm text-primary bg-primary/10 px-1.5 sm:px-space-xs py-0.5 rounded border border-primary/20 flex items-center gap-1 text-[11px] sm:text-xs font-medium">
              <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
              <span>{completedCount}/{steps.length} <span className="hidden sm:inline">IN PROGRESS</span><span className="sm:hidden">ACTIVE</span></span>
            </span>
          ) : (
            <span className="shrink-0 whitespace-nowrap font-code-sm text-code-sm text-secondary bg-secondary/10 px-1.5 sm:px-space-xs py-0.5 rounded border border-secondary/20 text-[11px] sm:text-xs font-medium">
              {completedCount}/{steps.length} <span className="hidden sm:inline">STEPS READY</span><span className="sm:hidden">READY</span>
            </span>
          )}
        </div>

        <span
          className={`shrink-0 material-symbols-outlined text-[18px] text-outline transition-transform duration-200 ${
            isOpen ? 'rotate-180' : 'rotate-0'
          }`}
        >
          expand_more
        </span>
      </button>

      {/* Expanded Step List */}
      {isOpen && (
        <div className="p-space-md space-y-space-sm bg-surface-container-lowest/60 border-t border-outline-variant/15">
          {steps.map((step) => {
            const hasDetails = Boolean(step.command || step.output);
            const isStepExpanded = expandedStepIds.has(step.id);
            const isCompleted = isStepCompleted(step);
            const stepText = step.text || step.description || '';
            const stepDuration = isCompleted
              ? step.duration || (step.durationMs ? `${step.durationMs}ms` : '0ms')
              : 'running...';

            return (
              <div
                key={step.id}
                className={`font-code-sm text-code-sm rounded-lg border transition-all overflow-hidden ${
                  isCompleted
                    ? 'bg-surface-container-low/40 border-outline-variant/20 hover:border-outline-variant/40'
                    : 'bg-primary/5 border-primary/30 shadow-xs'
                }`}
              >
                {/* Step Row Header */}
                <div
                  onClick={() => hasDetails && toggleStepDetails(step.id)}
                  className={`flex items-center justify-between p-space-sm transition-colors ${
                    hasDetails ? 'cursor-pointer hover:bg-surface-container/50' : ''
                  }`}
                >
                  <div className="flex items-center gap-space-sm min-w-0 pr-2">
                    {getStepIcon(step)}
                    <span className={`truncate ${isCompleted ? 'text-on-surface' : 'text-on-surface font-semibold'}`}>
                      {stepText}
                    </span>

                    {/* Tool Badge if present */}
                    {step.tool && (
                      <span className="hidden md:inline-block font-mono text-[10px] text-primary/80 bg-primary/10 px-1.5 py-0.2 rounded border border-primary/20 uppercase tracking-wider">
                        {step.tool}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`font-mono text-[11px] ${isCompleted ? 'text-outline' : 'text-primary font-semibold'}`}>
                      {stepDuration}
                    </span>

                    {/* Expand/Collapse Chevron for details */}
                    {hasDetails && (
                      <button
                        onClick={(e) => toggleStepDetails(step.id, e)}
                        className="text-outline hover:text-on-surface transition-colors p-0.5 rounded flex items-center justify-center cursor-pointer"
                        title={isStepExpanded ? 'Hide execution details' : 'View execution details'}
                      >
                        <span
                          className={`material-symbols-outlined text-[16px] transition-transform duration-200 ${
                            isStepExpanded ? 'rotate-180 text-primary' : 'rotate-0'
                          }`}
                        >
                          expand_more
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Step Details & Terminal Execution Panel */}
                {hasDetails && isStepExpanded && (
                  <div className="px-space-sm pb-space-sm pt-1 space-y-space-xs border-t border-outline-variant/15 bg-surface-container-lowest/80">
                    {/* Command Prompt Line */}
                    {step.command && (
                      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-surface-container-high/60 border border-outline-variant/30 font-mono text-xs">
                        <div className="flex items-center gap-2 min-w-0 overflow-x-auto">
                          <span className="text-primary font-bold select-none">$</span>
                          <code className="text-on-surface font-medium truncate select-text">
                            {step.command}
                          </code>
                        </div>
                        <button
                          onClick={(e) => copyToClipboard(step.command!, `cmd-${step.id}`, e)}
                          className="shrink-0 text-outline hover:text-primary transition-colors text-[11px] flex items-center gap-1 cursor-pointer"
                          title="Copy command"
                        >
                          <span className="material-symbols-outlined text-[13px]">
                            {copiedId === `cmd-${step.id}` ? 'check' : 'content_copy'}
                          </span>
                          <span className="text-[10px]">{copiedId === `cmd-${step.id}` ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                    )}

                    {/* Terminal Output Display */}
                    {step.output && (
                      <div className="rounded-md border border-outline-variant/30 overflow-hidden shadow-2xs">
                        <div className="flex items-center justify-between px-2.5 py-1.5 bg-surface-container-high/70 dark:bg-surface-container-highest/70 text-[11px] font-mono text-on-surface-variant select-none border-b border-outline-variant/20">
                          <span className="flex items-center gap-1.5 font-medium">
                            <span className="material-symbols-outlined text-[14px] text-secondary">
                              {step.command ? 'terminal' : 'settings'}
                            </span>
                            {step.command ? 'Terminal Output' : 'Reasoning & Execution Trace'}
                          </span>
                          <div className="flex items-center gap-2">
                            {step.exitCode !== undefined && (
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded border font-mono font-medium ${
                                  step.exitCode === 0
                                    ? 'bg-secondary/10 text-secondary border-secondary/25'
                                    : 'bg-error/10 text-error border-error/25'
                                }`}
                              >
                                exit code: {step.exitCode}
                              </span>
                            )}
                            <button
                              onClick={(e) => copyToClipboard(step.output!, `out-${step.id}`, e)}
                              className="text-outline hover:text-on-surface transition-colors text-[10px] flex items-center gap-0.5 cursor-pointer px-1.5 py-0.5 rounded hover:bg-surface-container-highest/50"
                              title="Copy terminal output"
                            >
                              <span className="material-symbols-outlined text-[12px]">
                                {copiedId === `out-${step.id}` ? 'check' : 'content_copy'}
                              </span>
                              <span>{copiedId === `out-${step.id}` ? 'Copied' : 'Copy'}</span>
                            </button>
                          </div>
                        </div>
                        <pre className="p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text bg-surface-container-lowest text-slate-800 dark:bg-[#0b0f19] dark:text-emerald-300/90 max-h-56 overflow-y-auto">
                          {step.output}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
