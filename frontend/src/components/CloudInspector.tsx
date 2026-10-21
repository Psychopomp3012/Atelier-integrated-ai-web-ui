import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { apiFetch } from '../utils/api.util';
import {
  currentUserAtom,
  isAuthModalOpenAtom,
  isInspectorOpenAtom,
  currentSessionIdAtom,
  selectedSandboxIdAtom,
  inspectorTargetFilePathAtom,
  sandboxUsageAtom,
} from '../state';

export interface SandboxFileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  extension?: string;
  children?: SandboxFileNode[];
}

interface CloudInspectorProps {
  isOpen?: boolean;
  onClose?: () => void;
  sessionId?: string;
  sandboxId?: string;
  userId?: string;
  onOpenAuthModal?: () => void;
  refreshTrigger?: number | string;
}

export const CloudInspector: React.FC<CloudInspectorProps> = ({
  isOpen: propIsOpen,
  onClose: propOnClose,
  sessionId: propSessionId,
  sandboxId: propSandboxId,
  userId: propUserId,
  onOpenAuthModal: propOnOpenAuthModal,
  refreshTrigger,
}) => {
  const [atomInspectorOpen, setAtomInspectorOpen] = useAtom(isInspectorOpenAtom);
  const atomCurrentUser = useAtomValue(currentUserAtom);
  const atomSessionId = useAtomValue(currentSessionIdAtom);
  const atomSandboxId = useAtomValue(selectedSandboxIdAtom);
  const setIsAuthModalOpen = useSetAtom(isAuthModalOpenAtom);
  const [targetFilePath, setTargetFilePath] = useAtom(inspectorTargetFilePathAtom);

  const isOpen = propIsOpen !== undefined ? propIsOpen : atomInspectorOpen;
  const onClose = propOnClose ?? (() => setAtomInspectorOpen(false));
  const sessionId = propSessionId !== undefined ? propSessionId : (atomSessionId || undefined);
  const effectiveSandboxId = propSandboxId !== undefined ? propSandboxId : (atomSandboxId || undefined);
  const userId = propUserId !== undefined ? propUserId : (atomCurrentUser?.id || undefined);
  const onOpenAuthModal = propOnOpenAuthModal ?? (() => setIsAuthModalOpen(true));
  const [files, setFiles] = useState<SandboxFileNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['src']));
  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    name: string;
    content: string;
    dataUrl?: string;
    isImage?: boolean;
    isSvg?: boolean;
    size?: number;
  } | null>(null);
  const [activePreviewTab, setActivePreviewTab] = useState<'preview' | 'source'>('preview');
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  const [copiedCode, setCopiedCode] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [quotaUsage, setQuotaUsage] = useAtom(sandboxUsageAtom);

  const currentSandbox = useMemo(() => {
    if (!userId || !quotaUsage?.sandboxes || quotaUsage.sandboxes.length === 0) return null;
    if (effectiveSandboxId) {
      const found = quotaUsage.sandboxes.find((sb) => sb.sandboxId === effectiveSandboxId);
      if (found) return found;
    }
    return quotaUsage.sandboxes[0];
  }, [userId, quotaUsage, effectiveSandboxId]);

  const fetchFiles = useCallback(async (quiet = false) => {
    if (!userId) {
      setFiles([]);
      return;
    }
    if (!quiet) setIsLoading(true);
    else setIsRefreshing(true);
    setErrorMessage(null);

    try {
      const activeSession = sessionId || 'default';
      const targetSb = effectiveSandboxId || currentSandbox?.sandboxId;
      const params = new URLSearchParams();
      if (targetSb) params.set('sandboxId', targetSb);
      params.set('sessionId', activeSession);
      params.set('userId', userId);
      const url = `/api/v1/sandbox/files?${params.toString()}`;
      const res = await apiFetch(url);
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setFiles(data.data);
      } else {
        setFiles([]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch sandbox files';
      setErrorMessage(msg);
      setFiles([]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [userId, sessionId, effectiveSandboxId, currentSandbox?.sandboxId]);

  const [isStartingSandbox, setIsStartingSandbox] = useState(false);

  const handleStartSandbox = async () => {
    if (!userId) {
      onOpenAuthModal?.();
      return;
    }
    setIsStartingSandbox(true);
    try {
      const activeSession = (sessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32);
      const res = await apiFetch('/api/v1/sandbox/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSession }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.data?.usage) {
          setQuotaUsage(data.data.usage);
        }
        await fetchFiles(true);
      }
    } catch (err) {
      console.error('Failed to start sandbox VM', err);
    } finally {
      setIsStartingSandbox(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchFiles(true);
    }
  }, [isOpen, refreshTrigger, fetchFiles]);

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  };

  const handleOpenFile = async (file: SandboxFileNode) => {
    setIsLoadingFile(true);
    try {
      const activeSession = sessionId || 'default';
      const targetSb = effectiveSandboxId || currentSandbox?.sandboxId;
      const params = new URLSearchParams();
      params.set('path', file.path);
      if (targetSb) params.set('sandboxId', targetSb);
      params.set('sessionId', activeSession);
      if (userId) params.set('userId', userId);
      const url = `/api/v1/sandbox/file?${params.toString()}`;

      const res = await apiFetch(url);
      const data = await res.json();
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svg'].includes(ext);
      const isSvg = ext === 'svg';

      if (data.success && data.data) {
        setSelectedFile({
          path: file.path,
          name: file.name,
          content: data.data.content ?? '',
          dataUrl: data.data.dataUrl,
          isImage: data.data.isImage !== undefined ? Boolean(data.data.isImage) : isImg,
          isSvg: data.data.isSvg !== undefined ? Boolean(data.data.isSvg) : isSvg,
          size: file.size,
        });
        setActivePreviewTab('preview');
        setZoomLevel(100);
      } else {
        setSelectedFile({
          path: file.path,
          name: file.name,
          content: data.error?.message || '// Unable to load file content from sandbox.',
          size: file.size,
        });
      }
    } catch (err: unknown) {
      setSelectedFile({
        path: file.path,
        name: file.name,
        content: err instanceof Error ? err.message : '// Unable to load file content from sandbox.',
        size: file.size,
      });
    } finally {
      setIsLoadingFile(false);
    }
  };

  useEffect(() => {
    if (!targetFilePath) return;

    let clean = targetFilePath.trim();
    if (clean.startsWith('file://')) {
      clean = clean.replace(/^file:\/\//, '');
    }
    if (typeof window !== 'undefined' && clean.startsWith(window.location.origin)) {
      clean = clean.slice(window.location.origin.length);
    }
    clean = clean.split('#')[0].split('?')[0];
    clean = clean.replace(/^\/home\/user\/workspace\/?/, '');
    clean = clean.replace(/^\/workspace\/?/, '');
    clean = clean.replace(/^\.\//, '');
    clean = clean.replace(/^\/+/, '');

    const fileName = clean.split('/').pop() || clean || 'file';

    const pathParts = clean.split('/');
    if (pathParts.length > 1) {
      const folderPath = pathParts.slice(0, -1).join('/');
      setExpandedFolders((prev) => new Set([...prev, folderPath]));
    }

    setTargetFilePath(null);
    setAtomInspectorOpen(true);

    handleOpenFile({
      path: clean,
      name: fileName,
      type: 'file',
    });
  }, [targetFilePath, setTargetFilePath, setAtomInspectorOpen, sessionId, effectiveSandboxId, currentSandbox?.sandboxId, userId]);

  const handleCopy = () => {
    if (!selectedFile) return;
    navigator.clipboard.writeText(selectedFile.content);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const formatFileSize = (bytes?: number): string => {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getCleanSvgMarkup = (content?: string): string => {
    if (!content) return '';
    let str = content.trim();
    if (str.startsWith('data:image/svg+xml;base64,')) {
      try {
        const base64Data = str.split(',')[1];
        str = atob(base64Data);
      } catch {}
    } else if (str.startsWith('data:image/svg+xml;utf8,')) {
      str = decodeURIComponent(str.split(',')[1]);
    }
    str = str.replace(/<\?xml[^>]*\?>/gi, '').replace(/<!DOCTYPE[^>]*>/gi, '').trim();
    if (!str.includes('preserveAspectRatio') && str.startsWith('<svg')) {
      str = str.replace('<svg', '<svg preserveAspectRatio="xMidYMid meet"');
    }
    return str;
  };

  const getFileIcon = (fileName: string, ext?: string) => {
    const extension = (ext || fileName.split('.').pop() || '').toLowerCase();
    switch (extension) {
      case 'ts':
      case 'tsx':
        return { icon: 'javascript', color: 'text-primary', label: 'TypeScript' };
      case 'js':
      case 'jsx':
        return { icon: 'javascript', color: 'text-amber-400', label: 'JavaScript' };
      case 'py':
        return { icon: 'terminal', color: 'text-emerald-400', label: 'Python' };
      case 'json':
        return { icon: 'data_object', color: 'text-emerald-400', label: 'JSON' };
      case 'md':
        return { icon: 'description', color: 'text-outline', label: 'Markdown' };
      case 'sh':
      case 'bash':
        return { icon: 'terminal', color: 'text-sky-400', label: 'Shell' };
      case 'html':
      case 'css':
        return { icon: 'code', color: 'text-rose-400', label: extension.toUpperCase() };
      case 'svg':
        return { icon: 'palette', color: 'text-pink-400', label: 'SVG Vector' };
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'webp':
      case 'gif':
      case 'ico':
      case 'bmp':
        return { icon: 'image', color: 'text-emerald-400', label: 'Image' };
      case 'pdf':
        return { icon: 'picture_as_pdf', color: 'text-red-400', label: 'PDF Document' };
      case 'csv':
      case 'xlsx':
        return { icon: 'table_chart', color: 'text-teal-400', label: 'Dataset' };
      default:
        return { icon: 'description', color: 'text-outline', label: 'File' };
    }
  };

  const renderTree = (nodes: SandboxFileNode[], level = 0) => {
    return nodes.map((node) => {
      const isDir = node.type === 'directory';
      const isExpanded = expandedFolders.has(node.path);
      const isSelected = selectedFile?.path === node.path;

      if (isDir) {
        return (
          <div key={node.path} className="space-y-0.5">
            <button
              type="button"
              onClick={() => toggleFolder(node.path)}
              style={{ paddingLeft: `${Math.max(4, level * 16)}px` }}
              className="w-full flex items-center justify-between py-1 px-1.5 rounded-lg hover:bg-surface-container/60 cursor-pointer text-left transition-colors group"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="material-symbols-outlined text-[16px] text-amber-400 shrink-0">
                  {isExpanded ? 'folder_open' : 'folder'}
                </span>
                <span className="font-medium text-xs text-on-surface truncate">{node.name}</span>
              </div>
              {node.children && (
                <span className="text-[10px] text-outline font-mono opacity-60 group-hover:opacity-100">
                  {node.children.length}
                </span>
              )}
            </button>

            {isExpanded && node.children && node.children.length > 0 && (
              <div className="border-l border-outline-variant/20 ml-3.5 space-y-0.5">
                {renderTree(node.children, level + 1)}
              </div>
            )}
          </div>
        );
      }

      const fileMeta = getFileIcon(node.name, node.extension);

      return (
        <button
          key={node.path}
          type="button"
          onClick={() => handleOpenFile(node)}
          style={{ paddingLeft: `${Math.max(4, level * 16)}px` }}
          className={`w-full flex items-center justify-between py-1 px-1.5 rounded-lg text-left transition-all cursor-pointer ${
            isSelected
              ? 'bg-primary/10 text-on-surface border border-primary/30 shadow-xs'
              : 'hover:bg-surface-container/60 text-on-surface-variant hover:text-on-surface border border-transparent'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`material-symbols-outlined text-[15px] ${fileMeta.color} shrink-0`}>
              {fileMeta.icon}
            </span>
            <span className="font-mono text-xs truncate">{node.name}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {node.size !== undefined && (
              <span className="text-[10px] text-outline font-mono">{formatFileSize(node.size)}</span>
            )}
            <span className="text-[9px] text-outline uppercase">{fileMeta.label}</span>
          </div>
        </button>
      );
    });
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs xl:hidden animate-fade-in"
        />
      )}

      <aside
        className={`fixed right-0 top-0 bottom-0 w-[340px] max-w-[90vw] xl:w-[380px] bg-surface-container-low border-l border-outline-variant/30 flex flex-col z-50 transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full'
        }`}
      >
        {/* Inspector Header */}
        <div className="h-14 border-b border-outline-variant/20 flex items-center justify-between px-space-md shrink-0">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-[18px] text-tertiary">folder_open</span>
            <span className="font-headline-sm text-headline-sm font-semibold text-on-surface tracking-tight">
              Cloud Inspector
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                fetchFiles(false);
              }}
              disabled={isLoading || isRefreshing}
              className="flex items-center gap-1.5 font-code-sm text-code-sm text-on-surface-variant hover:text-on-surface bg-surface-container hover:bg-surface-container-high px-2 py-1 rounded-lg border border-outline-variant/30 cursor-pointer transition-colors shadow-2xs active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Reload sandbox files & telemetry"
            >
              <span
                className={`material-symbols-outlined text-[14px] ${
                  isLoading || isRefreshing ? 'text-primary animate-spin' : 'text-outline'
                }`}
              >
                sync
              </span>
              <span className="text-[11px] font-medium">
                {isLoading || isRefreshing ? 'RELOADING...' : 'RELOAD'}
              </span>
            </button>

            {/* Close Button */}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="w-7 h-7 rounded-lg bg-surface-container/70 hover:bg-surface-container-high border border-outline-variant/30 flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-all cursor-pointer shadow-sm active:scale-95"
                title="Close Inspector"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            )}
          </div>
        </div>

        {/* Workspace File Tree Sub-header with Active Sandbox Info, Quota Badge and Delete Action */}
        <div className="border-b border-outline-variant/20 px-space-md py-2 bg-surface-container-lowest flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0 mr-2">
            <span className={`material-symbols-outlined text-[15px] shrink-0 ${currentSandbox ? 'text-primary' : 'text-outline'}`}>
              {currentSandbox ? 'cloud_queue' : 'cloud_off'}
            </span>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-on-surface truncate" title={currentSandbox?.name}>
                  {currentSandbox ? currentSandbox.name : 'No Sandbox (Standby)'}
                </span>
                {quotaUsage && (
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded border shrink-0 transition-colors ${
                      currentSandbox
                        ? quotaUsage.used >= quotaUsage.max
                          ? 'bg-amber-500/15 text-amber-400 border-amber-500/40 font-bold'
                          : 'bg-surface-container text-on-surface-variant border-outline-variant/30'
                        : 'bg-surface-container text-outline border-outline-variant/20'
                    }`}
                    title={`Active Cloud Sandboxes: ${quotaUsage.used} of ${quotaUsage.max} maximum allowed`}
                  >
                    {quotaUsage.used}/{quotaUsage.max}
                  </span>
                )}
              </div>
              {currentSandbox ? (
                <span className="text-[10px] text-outline flex items-center gap-1">
                  <span className="material-symbols-outlined text-[11px] text-primary">cloud_done</span>
                  <span>Active Cloud MicroVM</span>
                </span>
              ) : (
                <span className="text-[10px] text-outline">Offline • No VM started</span>
              )}
            </div>
          </div>

          {!currentSandbox && (
            <button
              type="button"
              onClick={handleStartSandbox}
              disabled={isStartingSandbox}
              className="flex items-center gap-1 text-[11px] bg-primary hover:bg-primary-fixed-dim text-on-primary px-2.5 py-1 rounded-md shadow-xs transition-all cursor-pointer shrink-0 font-medium disabled:opacity-50"
              title="Start a dedicated cloud microVM"
            >
              <span className="material-symbols-outlined text-[13px]">
                {isStartingSandbox ? 'sync' : 'bolt'}
              </span>
              <span>{isStartingSandbox ? 'Starting...' : 'Start VM'}</span>
            </button>
          )}
        </div>

        {/* Selected File Viewer Overlay or Main Tree View */}
        {selectedFile ? (
          <div className="flex-1 flex flex-col min-h-0 bg-surface-container-lowest animate-in fade-in duration-150">
            {/* Viewer Header */}
            <div className="flex items-center justify-between px-space-md py-2 border-b border-outline-variant/20 bg-surface-container/40">
              <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
                <button
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  className="flex items-center gap-0.5 text-primary hover:underline text-xs cursor-pointer font-medium shrink-0"
                >
                  <span className="material-symbols-outlined text-[15px]">arrow_back</span>
                  <span>Files</span>
                </button>
                <span className="text-outline shrink-0">/</span>
                <span className="font-mono text-xs font-semibold text-on-surface truncate" title={selectedFile.name}>
                  {selectedFile.name}
                </span>
                {selectedFile.size !== undefined && (
                  <span className="text-[10px] text-outline font-mono shrink-0">
                    ({formatFileSize(selectedFile.size)})
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {/* Download Button */}
                <a
                  href={
                    selectedFile.dataUrl ||
                    (selectedFile.isSvg
                      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(selectedFile.content)}`
                      : `data:text/plain;charset=utf-8,${encodeURIComponent(selectedFile.content)}`)
                  }
                  download={selectedFile.name}
                  className="p-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface cursor-pointer border border-outline-variant/30 transition-all active:scale-95 shrink-0 flex items-center justify-center"
                  title={`Download ${selectedFile.name}`}
                >
                  <span className="material-symbols-outlined text-[14px]">download</span>
                </a>

                {/* Copy Button */}
                <button
                  type="button"
                  onClick={handleCopy}
                  className="p-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface cursor-pointer border border-outline-variant/30 transition-all active:scale-95 shrink-0 flex items-center justify-center"
                  title={copiedCode ? 'Copied to clipboard!' : 'Copy file contents'}
                >
                  <span className="material-symbols-outlined text-[14px] text-tertiary">
                    {copiedCode ? 'check' : 'content_copy'}
                  </span>
                </button>
              </div>
            </div>

            {/* Sub-header Tabs for SVGs */}
            {selectedFile.isSvg && (
              <div className="flex items-center justify-between px-space-md py-1.5 border-b border-outline-variant/20 bg-surface-container-lowest text-xs">
                <div className="flex items-center rounded-lg bg-surface-container p-0.5 border border-outline-variant/20 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setActivePreviewTab('preview')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      activePreviewTab === 'preview'
                        ? 'bg-surface-container-highest text-primary font-medium shadow-xs'
                        : 'text-outline hover:text-on-surface'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[13px]">visibility</span>
                    <span>Preview</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePreviewTab('source')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      activePreviewTab === 'source'
                        ? 'bg-surface-container-highest text-primary font-medium shadow-xs'
                        : 'text-outline hover:text-on-surface'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[13px]">code</span>
                    <span>Source</span>
                  </button>
                </div>

                <div className="flex items-center gap-1 text-[11px] font-mono text-outline">
                  <span className="material-symbols-outlined text-[13px] text-pink-400">palette</span>
                  <span>Vector Graphics</span>
                </div>
              </div>
            )}

            {/* Viewer Content */}
            <div className="flex-1 overflow-auto bg-surface-container-lowest/80 text-on-surface flex flex-col min-h-0">
              {isLoadingFile ? (
                <div className="flex-1 flex items-center justify-center py-12 text-outline">
                  <span className="material-symbols-outlined animate-spin text-[20px] mr-2">progress_activity</span>
                  <span>Loading file content...</span>
                </div>
              ) : selectedFile.isImage && activePreviewTab === 'preview' ? (
                <div className="flex-1 flex flex-col items-center justify-between p-space-md relative min-h-[300px] overflow-auto">
                  {/* Backdrop for Visual Transparency */}
                  <div className="relative w-full max-w-full flex-1 min-h-[260px] max-h-[460px] p-4 rounded-xl border border-outline-variant/30 bg-surface-container/40 shadow-inner flex items-center justify-center overflow-auto">
                    {selectedFile.isSvg ? (
                      <div
                        style={{
                          transform: `scale(${zoomLevel / 100})`,
                          transformOrigin: 'center center',
                          transition: 'transform 150ms ease-out',
                        }}
                        className="w-full h-full min-h-[220px] flex items-center justify-center select-none overflow-hidden [&>svg]:w-full [&>svg]:h-auto [&>svg]:max-h-[380px] [&>svg]:object-contain [&>svg]:drop-shadow-sm"
                        dangerouslySetInnerHTML={{
                          __html: getCleanSvgMarkup(selectedFile.content),
                        }}
                      />
                    ) : (
                      <img
                        src={selectedFile.dataUrl || selectedFile.content}
                        alt={selectedFile.name}
                        style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'center center' }}
                        className="max-h-[380px] max-w-full object-contain rounded-md transition-transform duration-150 select-none shadow-sm"
                      />
                    )}
                  </div>

                  {/* Zoom Controls & Metadata Pill */}
                  <div className="flex items-center justify-between w-full max-w-sm mt-3 px-3 py-1.5 rounded-lg bg-surface-container-high/90 border border-outline-variant/20 text-xs">
                    <div className="flex items-center gap-1.5 font-mono text-[11px] text-outline">
                      <span className="material-symbols-outlined text-[14px] text-secondary">
                        {selectedFile.isSvg ? 'palette' : 'image'}
                      </span>
                      <span>{selectedFile.isSvg ? 'SVG Vector' : 'Raster Image'}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setZoomLevel((z) => Math.max(50, z - 25))}
                        disabled={zoomLevel <= 50}
                        className="p-1 rounded hover:bg-surface-container-highest text-outline hover:text-on-surface disabled:opacity-40 cursor-pointer"
                        title="Zoom out"
                      >
                        <span className="material-symbols-outlined text-[14px]">remove</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setZoomLevel(100)}
                        className="px-1.5 py-0.5 rounded font-mono text-[10px] text-outline hover:text-on-surface hover:bg-surface-container-highest cursor-pointer"
                        title="Reset zoom"
                      >
                        {zoomLevel}%
                      </button>
                      <button
                        type="button"
                        onClick={() => setZoomLevel((z) => Math.min(250, z + 25))}
                        disabled={zoomLevel >= 250}
                        className="p-1 rounded hover:bg-surface-container-highest text-outline hover:text-on-surface disabled:opacity-40 cursor-pointer"
                        title="Zoom in"
                      >
                        <span className="material-symbols-outlined text-[14px]">add</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-auto p-space-md font-mono text-xs">
                  {selectedFile.content ? (
                    <pre className="whitespace-pre font-mono text-xs leading-relaxed select-text">
                      <code>{selectedFile.content}</code>
                    </pre>
                  ) : (
                    <div className="text-outline text-xs italic py-12 text-center flex flex-col items-center justify-center gap-2">
                      <span className="material-symbols-outlined text-[26px] opacity-40">description</span>
                      <span>This file is empty (0 bytes).</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* File Tree Explorer Content */
          <div className="flex-1 bg-surface-container-lowest p-space-md font-code-sm text-code-sm overflow-y-auto">
            <div className="text-outline border-b border-outline-variant/10 pb-space-xs mb-space-sm font-label-sm text-label-sm flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span>WORKSPACE ROOT</span>
                <button
                  type="button"
                  onClick={() => {
                    fetchFiles(false);
                  }}
                  disabled={isLoading || isRefreshing}
                  className="p-0.5 rounded text-outline hover:text-primary transition-colors cursor-pointer disabled:cursor-not-allowed"
                  title={isLoading || isRefreshing ? 'Syncing workspace files...' : 'Reload workspace files'}
                >
                  <span
                    className={`material-symbols-outlined text-[13px] ${
                      isLoading || isRefreshing ? 'text-primary animate-spin' : 'hover:scale-110'
                    }`}
                  >
                    sync
                  </span>
                </button>
              </div>
              <span className="text-[10px] text-outline font-mono">/workspace</span>
            </div>

            {(isLoading || isRefreshing) && files.length > 0 && (
              <div className="flex items-center justify-between px-2 py-1 mb-2 rounded bg-primary/10 border border-primary/20 text-primary text-[10px] animate-pulse">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[12px] animate-spin">sync</span>
                  <span className="font-medium">Reloading workspace files...</span>
                </div>
              </div>
            )}

            {(isLoading || isRefreshing) && files.length === 0 ? (
              <div className="space-y-2.5 px-space-xs py-4">
                <div className="flex items-center gap-2.5 p-2 rounded-lg bg-surface-container/60 border border-outline-variant/15 animate-pulse">
                  <div className="w-4 h-4 rounded bg-primary/30 shrink-0" />
                  <div className="h-3.5 bg-outline-variant/30 rounded w-2/3" />
                </div>
                <div className="flex items-center gap-2.5 p-2 rounded-lg bg-surface-container/40 border border-outline-variant/10 animate-pulse delay-75">
                  <div className="w-4 h-4 rounded bg-outline-variant/20 shrink-0" />
                  <div className="h-3.5 bg-outline-variant/20 rounded w-1/2" />
                </div>
                <div className="flex items-center gap-2.5 p-2 rounded-lg bg-surface-container/30 border border-outline-variant/10 animate-pulse delay-150">
                  <div className="w-4 h-4 rounded bg-outline-variant/20 shrink-0" />
                  <div className="h-3.5 bg-outline-variant/20 rounded w-3/4" />
                </div>
                <div className="flex items-center justify-center gap-1.5 pt-3 text-primary/80">
                  <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                  <span className="text-[11px] font-medium tracking-wide">Syncing workspace files...</span>
                </div>
              </div>
            ) : errorMessage ? (
              <div className="py-6 px-3 text-center text-outline">
                <span className="material-symbols-outlined text-[24px] text-amber-400 mb-1">warning</span>
                <p className="text-xs text-on-surface-variant font-medium">Unable to connect to sandbox</p>
                <p className="text-[11px] text-outline mt-1">{errorMessage}</p>
                <button
                  type="button"
                  onClick={() => fetchFiles()}
                  className="mt-3 px-3 py-1 rounded-md bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-xs text-primary font-medium cursor-pointer"
                >
                  Retry
                </button>
              </div>
            ) : !userId ? (
              <div className="py-12 px-4 text-center text-outline space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-surface-container mx-auto flex items-center justify-center text-primary mb-1 shadow-inner">
                  <span className="material-symbols-outlined text-[28px]">lock</span>
                </div>
                <p className="font-semibold text-xs text-on-surface">Sign In Required</p>
                <p className="text-[11px] text-outline max-w-xs mx-auto leading-relaxed">
                  Cloud sandboxes and file workspaces are strictly private to each user. Sign in to boot, access, and inspect your microVMs.
                </p>
                <button
                  type="button"
                  onClick={() => onOpenAuthModal?.()}
                  className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary-fixed-dim text-on-primary text-xs font-semibold shadow-xs transition-all cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[15px]">login</span>
                  <span className="hidden sm:inline">Sign in with Google</span>
                  <span className="sm:hidden">Sign In</span>
                </button>
              </div>
            ) : !currentSandbox ? (
              <div className="py-12 px-4 text-center text-outline space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-surface-container mx-auto flex items-center justify-center text-outline mb-1 shadow-inner">
                  <span className="material-symbols-outlined text-[28px] text-primary">rocket_launch</span>
                </div>
                <p className="font-semibold text-xs text-on-surface">No Sandbox VM Active</p>
                <p className="text-[11px] text-outline max-w-xs mx-auto leading-relaxed">
                  This session is in standby. Start a cloud sandbox VM to execute code, run bash commands, and view workspace files in real time.
                </p>
                <button
                  type="button"
                  onClick={handleStartSandbox}
                  disabled={isStartingSandbox}
                  className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary-fixed-dim text-on-primary text-xs font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[15px]">
                    {isStartingSandbox ? 'sync' : 'bolt'}
                  </span>
                  <span>{isStartingSandbox ? 'Starting Cloud VM...' : 'Start Sandbox VM'}</span>
                </button>
              </div>
            ) : files.length === 0 ? (
              <div className="py-12 px-4 text-center text-outline space-y-2">
                <span className="material-symbols-outlined text-[32px] text-outline/40">
                  folder_off
                </span>
                <p className="font-semibold text-xs text-on-surface-variant">Sandbox workspace is empty</p>
                <p className="text-[11px] text-outline">
                  Files created during agent execution or cloud commands will appear here in real time.
                </p>
              </div>
            ) : (
              <div className="space-y-1 select-none font-mono text-xs">
                {renderTree(files)}
              </div>
            )}
          </div>
        )}

        {/* Inspector Footer */}
        <div className="p-space-sm border-t border-outline-variant/20 bg-surface-container flex items-center justify-between text-outline font-code-sm text-code-sm shrink-0">
          <span>Sandbox FS • Read-Only</span>
          <span className="text-secondary font-medium flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary inline-block" />
            <span>SYNCED</span>
          </span>
        </div>
      </aside>
    </>
  );
};
