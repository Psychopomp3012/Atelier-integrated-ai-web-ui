import React, { useState } from 'react';
import type { ModelType, UserProfile, GeminiQuotaStats, CodexQuotaStats, ModelOption } from '../types';
import { getModelDisplayInfo } from '../types';
import type { CliStatus } from '../services/cliAuth.service';
import { checkModelQuotaExhausted } from '../utils/quota.util';
import { ModelSelectorDropdown } from './ModelSelectorDropdown';
import { SlashCommandPalette } from './SlashCommandPalette';
import {
  type SlashCommand,
  resolveProviderCategory,
  getCommandsForProvider,
  filterSlashCommands,
} from '../utils/slashCommands';

export interface AttachedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  content?: string;
  base64?: string;
}

interface PromptBarProps {
  onSendMessage: (prompt: string, attachedFiles?: AttachedFile[]) => void;
  onStopGeneration?: () => void;
  onClearSession?: () => void;
  onOpenInspector?: () => void;
  onExportSession?: () => void;
  selectedModel: ModelType;
  onSelectModel: (model: ModelType) => void;
  currentUser?: UserProfile | null;
  cliStatus?: CliStatus | null;
  isLoading?: boolean;
  geminiQuota?: GeminiQuotaStats | null;
  codexQuota?: CodexQuotaStats | null;
  availableModels?: ModelOption[];
  activeSandbox?: { sandboxId: string; name: string } | null;
  sandboxUsage?: any;
  onStartSandboxVM?: () => void;
  onAttachExistingSandbox?: (sandboxId: string) => void;
  isStartingSandbox?: boolean;
  isAttachingSandbox?: string | null;
  onRefreshModels?: () => void;
  onOpenAuthModal?: () => void;
}

export const PromptBar: React.FC<PromptBarProps> = ({
  onSendMessage,
  onStopGeneration,
  onClearSession,
  onOpenInspector,
  onExportSession,
  selectedModel,
  onSelectModel,
  currentUser,
  cliStatus,
  isLoading = false,
  geminiQuota,
  codexQuota,
  availableModels,
  activeSandbox,
  sandboxUsage,
  onStartSandboxVM,
  onAttachExistingSandbox,
  isStartingSandbox = false,
  isAttachingSandbox = null,
  onRefreshModels,
  onOpenAuthModal,
}) => {
  const [prompt, setPrompt] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isSlashDismissed, setIsSlashDismissed] = useState(false);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);

  const dragCounterRef = React.useRef(0);
  const lastDropTimeRef = React.useRef(0);
  const recognitionRef = React.useRef<any>(null);
  const basePromptRef = React.useRef<string>('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const prevPromptRef = React.useRef<string>('');

  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = 220; // Auto-grow vertically up to ~8-9 lines
    if (el.scrollHeight > maxHeight) {
      el.style.height = `${maxHeight}px`;
      el.style.overflowY = 'auto';
    } else {
      el.style.height = `${Math.max(el.scrollHeight, 40)}px`;
      el.style.overflowY = 'hidden';
    }
  }, [prompt]);

  const selectedModelInfo = React.useMemo(() => {
    return getModelDisplayInfo(selectedModel, availableModels);
  }, [selectedModel, availableModels]);

  const providerCategory = React.useMemo(() => {
    return resolveProviderCategory(
      selectedModelInfo.provider,
      selectedModel,
      selectedModelInfo.baseName
    );
  }, [selectedModelInfo, selectedModel]);

  const isAnyCliLinked = React.useMemo(() => {
    return Boolean(
      cliStatus?.antigravity?.linked ||
      cliStatus?.gemini?.linked ||
      cliStatus?.claude?.linked ||
      cliStatus?.codex?.linked
    );
  }, [cliStatus]);

  const isBlockedByNoCli = Boolean(currentUser && !isAnyCliLinked);

  // Detect slash command trigger at cursor / prompt
  const slashMatch = React.useMemo(() => {
    if (isSlashDismissed) return null;
    const match = prompt.match(/(?:^|\n)\/([a-zA-Z0-9_-]*)$/);
    if (!match) return null;
    return {
      query: match[1].toLowerCase(),
      fullMatch: match[0],
    };
  }, [prompt, isSlashDismissed]);

  const activeProviderCommands = React.useMemo(() => {
    return getCommandsForProvider(providerCategory);
  }, [providerCategory]);

  const filteredCommands = React.useMemo(() => {
    if (!slashMatch) return [];
    return filterSlashCommands(activeProviderCommands, slashMatch.query);
  }, [slashMatch, activeProviderCommands]);

  // Reset selected slash index when query changes
  React.useEffect(() => {
    setSelectedSlashIndex(0);
  }, [slashMatch?.query]);

  // Re-enable slash menu if user types slash again or modifies prompt
  React.useEffect(() => {
    if (prompt !== prevPromptRef.current) {
      if (isSlashDismissed && prompt.includes('/')) {
        setIsSlashDismissed(false);
      }
      prevPromptRef.current = prompt;
    }
  }, [prompt, isSlashDismissed]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const getFileIcon = (fileName: string, mimeType?: string): { icon: string; colorClass: string } => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (ext === 'svg' || mimeType === 'image/svg+xml') {
      return { icon: 'palette', colorClass: 'text-pink-400' };
    }
    if (mimeType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|ico|bmp|tiff)$/i.test(fileName)) {
      return { icon: 'image', colorClass: 'text-emerald-400' };
    }
    if (mimeType?.startsWith('video/') || /\.(mp4|webm|mkv|mov|avi)$/i.test(fileName)) {
      return { icon: 'video_file', colorClass: 'text-purple-400' };
    }
    if (mimeType?.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a)$/i.test(fileName)) {
      return { icon: 'audio_file', colorClass: 'text-rose-400' };
    }
    if (ext === 'pdf' || mimeType === 'application/pdf') {
      return { icon: 'picture_as_pdf', colorClass: 'text-red-400' };
    }
    if (/\.(zip|tar|gz|7z|rar|bz2)$/i.test(fileName)) {
      return { icon: 'folder_zip', colorClass: 'text-amber-400' };
    }
    if (/\.(csv|tsv|xlsx?)$/i.test(fileName)) {
      return { icon: 'table_chart', colorClass: 'text-teal-400' };
    }
    if (
      /\.(ts|tsx|js|jsx|py|sh|bash|json|html|css|sql|rs|go|cpp|c|java|php|rb|xml|toml|ini|conf|md|txt|yaml|yml)$/i.test(
        fileName
      )
    ) {
      return { icon: 'code', colorClass: 'text-primary' };
    }
    return { icon: 'description', colorClass: 'text-secondary' };
  };

  const processFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;

    const newAttachments: AttachedFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let content: string | undefined = undefined;
      let base64: string | undefined = undefined;

      // Provide a descriptive timestamped name if clipboard pasted an unnamed file/image
      let fileName = file.name;
      if (!fileName || fileName === 'image.png' || fileName === 'blob') {
        let ext = 'png';
        if (file.type) {
          ext = file.type.split('/')[1]?.replace('+xml', '') || 'png';
          if (ext === 'jpeg') ext = 'jpg';
        }
        const now = new Date();
        const timeStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
        fileName = file.type?.startsWith('image/')
          ? (ext === 'svg' ? `Pasted-Graphic-${timeStamp}.svg` : `Pasted-Image-${timeStamp}.${ext}`)
          : `Pasted-File-${timeStamp}.${ext}`;
      }

      // Read text/code/svg files up to 2MB
      const isTextOrCode =
        file.type.startsWith('text/') ||
        file.type === 'image/svg+xml' ||
        file.type.includes('json') ||
        file.type.includes('xml') ||
        file.type.includes('yaml') ||
        /\.(ts|tsx|js|jsx|json|py|md|txt|html|css|sh|bash|yml|yaml|csv|tsv|env|sql|go|rs|c|cpp|h|java|php|rb|svg|xml|toml|ini|conf)$/i.test(
          fileName
        );

      if (isTextOrCode && file.size < 2 * 1024 * 1024) {
        try {
          content = await file.text();
        } catch {
          // Fallback if unable to read text
        }
      }

      // Read file as Base64 so it can be written to the sandbox disk for any file type (binary or text)
      try {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = reader.result as string;
            const commaIdx = res.indexOf(',');
            resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        base64 = base64Data;
      } catch {
        // Fallback if unable to read base64
      }

      newAttachments.push({
        id: `${fileName}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        name: fileName,
        size: file.size,
        type: file.type || 'application/octet-stream',
        content,
        base64,
      });
    }

    if (newAttachments.length > 0) {
      // Deduplicate files by filename & size to eliminate duplicate rendering
      setAttachedFiles((prev) => {
        const existingKeys = new Set(prev.map((f) => `${f.name}:${f.size}`));
        const unique = newAttachments.filter((f) => {
          const key = `${f.name}:${f.size}`;
          if (existingKeys.has(key)) return false;
          existingKeys.add(key);
          return true;
        });
        return [...prev, ...unique];
      });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processFiles(files);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const filesToProcess: File[] = [];
    const seenKeys = new Set<string>();

    const addFile = (file: File | null) => {
      if (!file) return;
      const key = `${file.name}-${file.size}-${file.type}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        filesToProcess.push(file);
      }
    };

    if (clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        addFile(clipboardData.files[i]);
      }
    }

    if (clipboardData.items && clipboardData.items.length > 0) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.kind === 'file') {
          addFile(item.getAsFile());
        }
      }
    }

    // Check for clipboard data with SVG format
    const svgData = clipboardData.getData('image/svg+xml');
    if (svgData && filesToProcess.length === 0) {
      const now = new Date();
      const timeStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
      const svgFile = new File([svgData], `Pasted-Graphic-${timeStamp}.svg`, { type: 'image/svg+xml' });
      addFile(svgFile);
    }

    if (filesToProcess.length > 0) {
      // Prevent default pasting of raw file path into textarea
      e.preventDefault();
      await processFiles(filesToProcess);
    }
  };

  // Window-level drag-and-drop file staging with debounce to prevent duplicate attachments
  React.useEffect(() => {
    const handleWindowDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      dragCounterRef.current++;
      if (dragCounterRef.current === 1) {
        setIsDraggingOver(true);
      }
    };

    const handleWindowDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleWindowDragLeave = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDraggingOver(false);
      }
    };

    const handleWindowDrop = async (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();

      const now = Date.now();
      if (now - lastDropTimeRef.current < 500) {
        return; // Guard against duplicated or bubbling drop triggers
      }
      lastDropTimeRef.current = now;

      dragCounterRef.current = 0;
      setIsDraggingOver(false);

      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        await processFiles(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, []);

  const handleRemoveFile = (id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const isQuotaExhausted = React.useMemo(() => {
    if (selectedModel === 'none') return false;
    return checkModelQuotaExhausted(selectedModelInfo.parentModel, geminiQuota, codexQuota, cliStatus);
  }, [selectedModel, selectedModelInfo, geminiQuota, codexQuota, cliStatus]);

  const isModelSelected = selectedModel !== 'none';

  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      alert('Speech recognition is not supported in this browser. Please use Chrome, Edge, Safari, or Chromium.');
      return;
    }

    try {
      const recognition = new SpeechRecognitionAPI();
      recognitionRef.current = recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || 'en-US';

      basePromptRef.current = prompt;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        const base = basePromptRef.current;
        const separator = base && !base.endsWith(' ') && !transcript.startsWith(' ') ? ' ' : '';
        setPrompt(`${base}${separator}${transcript}`);
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'not-allowed') {
          alert('Microphone permission was denied. Please allow microphone access in your browser settings.');
        } else if (event.error !== 'no-speech') {
          console.warn('Speech recognition notice:', event.error);
        }
        if (event.error !== 'no-speech') {
          setIsListening(false);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch (err) {
      console.error('Failed to initialize speech recognition:', err);
      setIsListening(false);
    }
  };

  React.useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
    };
  }, []);

  const handleSelectCommand = (cmd: SlashCommand) => {
    if (cmd.actionType === 'clear') {
      onClearSession?.();
      setPrompt('');
      setIsSlashDismissed(false);
      return;
    }
    if (cmd.actionType === 'files') {
      onOpenInspector?.();
      setPrompt('');
      setIsSlashDismissed(false);
      return;
    }
    if (cmd.actionType === 'voice') {
      toggleListening();
      setPrompt('');
      setIsSlashDismissed(false);
      return;
    }
    if ((cmd as any).actionType === 'export') {
      onExportSession?.();
      setPrompt('');
      setIsSlashDismissed(false);
      return;
    }

    // Insert command into the prompt replacing trailing slash query
    const updated = prompt.replace(/(?:^|\n)\/([a-zA-Z0-9_-]*)$/, (match) => {
      const leadingChar = match.startsWith('\n') ? '\n' : '';
      return `${leadingChar}${cmd.command} `;
    });
    setPrompt(updated);
    setIsSlashDismissed(false);

    // Keep textarea focused and place cursor immediately after inserted command
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(updated.length, updated.length);
      }
    }, 10);
  };

  const handleToggleSlashPalette = () => {
    if (slashMatch) {
      setIsSlashDismissed(true);
    } else {
      setIsSlashDismissed(false);
      const newPrompt = prompt.trim().length === 0 ? '/' : `${prompt}\n/`;
      setPrompt(newPrompt);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newPrompt.length, newPrompt.length);
        }
      }, 10);
    }
  };

  const handleSubmit = () => {
    if (isListening && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      setIsListening(false);
    }

    if (isLoading) return;

    if (!currentUser) {
      onOpenAuthModal?.();
      return;
    }

    if (!isAnyCliLinked) {
      onOpenAuthModal?.();
      return;
    }

    const trimmed = prompt.trim();

    // Check for direct client action commands
    if (trimmed === '/clear') {
      onClearSession?.();
      setPrompt('');
      return;
    }
    if (trimmed === '/files') {
      onOpenInspector?.();
      setPrompt('');
      return;
    }
    if (trimmed === '/export') {
      onExportSession?.();
      setPrompt('');
      return;
    }

    if (!isModelSelected || isQuotaExhausted) return;

    const hasPrompt = Boolean(trimmed);
    const hasFiles = attachedFiles.length > 0;
    if (!hasPrompt && !hasFiles) return;

    let finalPrompt = trimmed;

    if (hasFiles) {
      const filesSummary = attachedFiles
        .map((f) => {
          if (f.content !== undefined) {
            const ext = f.name.split('.').pop() || 'text';
            return `[File: ./attachments/${f.name}]\n\`\`\`${ext}\n${f.content}\n\`\`\``;
          }
          return `[Attached file available in workspace: ./attachments/${f.name} (${formatFileSize(f.size)})]`;
        })
        .join('\n\n');

      finalPrompt = finalPrompt ? `${filesSummary}\n\n${finalPrompt}` : filesSummary;
    }

    if (!activeSandbox) {
      onSendMessage(finalPrompt, [...attachedFiles]);
      return;
    }

    onSendMessage(finalPrompt, [...attachedFiles]);
    setPrompt('');
    setAttachedFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Keyboard navigation when slash command palette is visible
    if (slashMatch && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSlashIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSlashIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const cmd = filteredCommands[selectedSlashIndex];
        if (cmd) {
          handleSelectCommand(cmd);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsSlashDismissed(true);
        return;
      }
    }

    if (e.key === 'Escape' && isLoading) {
      e.preventDefault();
      onStopGeneration?.();
      return;
    }

    // Normal Enter sends user message (Shift + Enter inserts newline)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!isLoading && (isModelSelected || prompt.trim().startsWith('/') || isBlockedByNoCli) && !isQuotaExhausted) {
        handleSubmit();
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!isLoading && (isModelSelected || prompt.trim().startsWith('/') || isBlockedByNoCli) && !isQuotaExhausted) {
        handleSubmit();
      }
    }
  };

  const handleButtonClick = () => {
    if (isLoading) {
      onStopGeneration?.();
      return;
    }
    handleSubmit();
  };

  const hasInput = Boolean(prompt.trim()) || attachedFiles.length > 0;
  const canSubmit = !isLoading && (isModelSelected || prompt.trim().startsWith('/')) && !isQuotaExhausted && hasInput && !isBlockedByNoCli;

  return (
    <div className="w-full max-w-4xl mx-auto px-space-md sm:px-gutter-desktop pb-space-lg pt-space-xs relative">
      {/* Dynamic Context-Aware Slash Command Palette */}
      {slashMatch && (
        <SlashCommandPalette
          commands={filteredCommands}
          selectedIndex={selectedSlashIndex}
          onSelectCommand={handleSelectCommand}
          providerCategory={providerCategory}
          searchQuery={slashMatch.query}
        />
      )}

      <div className="relative rounded-2xl bg-surface-container-low border border-outline-variant/40 shadow-xl focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10 transition-all p-space-sm sm:p-space-md">
        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Attached Files Preview Shelf */}
        {attachedFiles.length > 0 && (
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-outline-variant/15 overflow-x-auto scrollbar-thin">
            {attachedFiles.map((file) => {
              const { icon, colorClass } = getFileIcon(file.name, file.type);
              return (
                <div
                  key={file.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-container-high border border-outline-variant/30 text-xs text-on-surface shrink-0 shadow-xs group"
                >
                  <span className={`material-symbols-outlined text-[15px] ${colorClass}`}>
                    {icon}
                  </span>
                  <span className="font-mono text-xs font-medium max-w-[140px] sm:max-w-[180px] truncate">
                    {file.name}
                  </span>
                  <span className="text-[10px] text-outline font-mono">
                    ({formatFileSize(file.size)})
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveFile(file.id)}
                    className="p-0.5 rounded hover:bg-surface-container-highest text-outline hover:text-red-400 transition-colors cursor-pointer"
                    title={`Remove ${file.name}`}
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Main Text Input Area */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            isBlockedByNoCli
              ? 'Link an AI CLI to send messages...'
              : !isModelSelected
              ? 'Select a model or type / for commands...'
              : 'Ask anything or type / for commands...'
          }
          className="w-full bg-transparent resize-none border-none outline-none font-body-lg text-body-lg text-on-surface placeholder:text-outline/70 placeholder:truncate focus:ring-0 px-space-xs py-1.5 leading-relaxed overflow-y-hidden transition-[height] duration-75 scrollbar-thin"
        />

        {/* Action Tray */}
        <div className="flex items-center justify-between pt-space-sm border-t border-outline-variant/15 mt-space-xs gap-1 sm:gap-2 flex-nowrap w-full">
          {/* Quick Context, Attach Actions & Model Selector */}
          <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1 shrink flex-nowrap">
            <button
              type="button"
              onClick={handleAttachClick}
              className="p-1.5 rounded-md bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface border border-outline-variant/20 transition-colors cursor-pointer active:scale-95 flex items-center justify-center shrink-0"
              title="Attach Code, File, or Document"
            >
              <span className="material-symbols-outlined text-[18px] text-primary">add</span>
            </button>

            {/* Provider and Model Selector right next to Attach */}
            <ModelSelectorDropdown
              selectedModel={selectedModel}
              onSelectModel={onSelectModel}
              currentUser={currentUser}
              cliStatus={cliStatus}
              disabled={isLoading}
              geminiQuota={geminiQuota}
              codexQuota={codexQuota}
              availableModels={availableModels}
              onOpenAuthModal={onOpenAuthModal}
              activeSandbox={activeSandbox}
              sandboxUsage={sandboxUsage}
              onStartSandboxVM={onStartSandboxVM}
              onAttachExistingSandbox={onAttachExistingSandbox}
              isStartingSandbox={isStartingSandbox}
              isAttachingSandbox={isAttachingSandbox}
              onRefreshModels={onRefreshModels}
            />

            {/* Dynamic Slash Commands Quick Button */}
            <button
              type="button"
              onClick={handleToggleSlashPalette}
              className={`hidden xs:flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border transition-all cursor-pointer font-mono shrink-0 ${
                slashMatch
                  ? 'bg-primary/20 text-primary border-primary/40 ring-1 ring-primary/30'
                  : 'bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface border-outline-variant/20'
              }`}
              title="Toggle Dynamic CLI Slash Commands (/)"
            >
              <span className="material-symbols-outlined text-[14px] text-primary">terminal</span>
              <span>Commands</span>
              <span className="text-[10px] text-outline px-1 rounded bg-surface-container-highest border border-outline-variant/20 font-mono">/</span>
            </button>

            {/* Target Sandbox Indicator Button */}
            {!activeSandbox ? (
              <button
                type="button"
                onClick={() => document.getElementById('cloud-sandboxes-menu-button')?.click()}
                className="hidden xs:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono text-amber-400 bg-amber-500/10 border border-amber-500/25 hover:bg-amber-500/20 transition-all cursor-pointer shrink-0"
                title="No cloud sandbox selected. Click to select a Sandbox microVM"
              >
                <span className="material-symbols-outlined text-[14px]">cloud_off</span>
                <span>Select Sandbox</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => document.getElementById('cloud-sandboxes-menu-button')?.click()}
                className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono text-on-surface-variant hover:text-on-surface bg-surface-container hover:bg-surface-container-high border border-outline-variant/20 transition-all cursor-pointer shrink-0"
                title={`Target Sandbox: ${activeSandbox.name}. Click to switch.`}
              >
                <span className="material-symbols-outlined text-[14px] text-primary">cloud</span>
                <span className="max-w-[110px] truncate">{activeSandbox.name}</span>
              </button>
            )}
          </div>

          {/* Action & Submit/Stop Button */}
          <div className="flex items-center gap-1 sm:gap-space-xs shrink-0 ml-auto">
            <button
              type="button"
              onClick={toggleListening}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all cursor-pointer shrink-0 ${
                isListening
                  ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30 animate-pulse ring-2 ring-red-500/50'
                  : 'hover:bg-surface-container text-outline hover:text-on-surface'
              }`}
              title={isListening ? 'Listening... Click to stop' : 'Voice Input (Dictation)'}
            >
              <span className={`material-symbols-outlined text-[18px] ${isListening ? 'text-red-500' : ''}`}>
                {isListening ? 'graphic_eq' : 'mic'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleButtonClick}
              disabled={!isLoading && !canSubmit && !isBlockedByNoCli}
              title={
                isLoading
                  ? 'Stop response (Esc)'
                  : isBlockedByNoCli
                  ? 'Link an AI CLI to send messages (Antigravity, Claude, or Codex)'
                  : !isModelSelected && !prompt.trim().startsWith('/')
                  ? 'Select a model to send prompt'
                  : isQuotaExhausted
                  ? `Quota limit reached for ${selectedModelInfo.baseName} — select an available model`
                  : !canSubmit
                  ? 'Type a message to send'
                  : 'Send prompt (Enter)'
              }
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all shrink-0 ${
                isLoading
                  ? 'bg-primary hover:bg-primary-fixed-dim text-on-primary shadow-md cursor-pointer active:scale-95 ring-2 ring-primary/20'
                  : isBlockedByNoCli
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 cursor-pointer shadow-sm active:scale-95'
                  : (!isModelSelected && !prompt.trim().startsWith('/')) || isQuotaExhausted
                  ? 'bg-surface-container-high text-outline border border-outline-variant/30 cursor-not-allowed opacity-60 shadow-none'
                  : canSubmit
                  ? 'bg-primary hover:bg-primary-fixed-dim text-on-primary shadow-md cursor-pointer active:scale-95'
                  : 'bg-surface-container-high text-outline/60 border border-outline-variant/20 cursor-not-allowed shadow-none'
              }`}
            >
              {isLoading ? (
                <span className="material-symbols-outlined text-[18px]">stop</span>
              ) : isBlockedByNoCli ? (
                <span className="material-symbols-outlined text-[16px]">link</span>
              ) : (!isModelSelected && !prompt.trim().startsWith('/')) || isQuotaExhausted ? (
                <span className="material-symbols-outlined text-[16px]">lock</span>
              ) : (
                <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="text-center mt-space-xs hidden sm:block">
        <span className="font-label-sm text-label-sm text-outline">
          {isBlockedByNoCli ? (
            <button
              type="button"
              onClick={onOpenAuthModal}
              className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors cursor-pointer"
            >
              No AI CLI linked. Click here to link Antigravity, Claude, or Codex CLI to send messages.
            </button>
          ) : !isModelSelected ? (
            'Select a model to execute in isolated cloud sandbox, or type / for commands'
          ) : isQuotaExhausted ? (
            `Quota limit reached for ${selectedModelInfo.baseName}. Select another model or provider to continue.`
          ) : (
            'Press Enter to send, Shift + Enter for new line • Type / for commands'
          )}
        </span>
      </div>

      {/* Full-Screen Glassmorphic Drag-and-Drop Staging Overlay */}
      {isDraggingOver && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-background/85 backdrop-blur-md animate-in fade-in duration-200 pointer-events-none select-none"
        >
          <div className="relative w-full max-w-xl p-10 rounded-3xl border-2 border-dashed border-primary/70 bg-surface-container-low/95 shadow-2xl flex flex-col items-center justify-center text-center gap-4 ring-8 ring-primary/10">
            {/* Animated Upload Icon */}
            <div className="w-20 h-20 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary shadow-lg animate-bounce">
              <span className="material-symbols-outlined text-[44px]">upload_file</span>
            </div>

            <div>
              <h3 className="text-xl font-bold text-on-surface tracking-tight">
                Drop files to stage to sandbox
              </h3>
              <p className="text-sm text-on-surface-variant/80 mt-1.5 max-w-md">
                Images, SVGs, documents, datasets, or code files will be staged into <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-surface-container-highest text-primary">attachments/</span> in your cloud workspace.
              </p>
            </div>

            <div className="flex items-center gap-2 mt-2 text-xs font-mono text-outline">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] text-emerald-400">check_circle</span>
                All file formats supported
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] text-primary">folder</span>
                Isolated workspace
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
