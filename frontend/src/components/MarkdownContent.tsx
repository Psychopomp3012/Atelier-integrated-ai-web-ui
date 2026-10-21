import React from 'react';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

interface CodeBlockViewProps {
  code: string;
  lang?: string;
}

const CodeBlockView: React.FC<CodeBlockViewProps> = ({ code, lang = '' }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const cleanLang = lang.trim().toLowerCase();

  const getLangMeta = () => {
    if (!cleanLang || ['text', 'output', 'txt', 'terminal', 'sh', 'bash', 'zsh', 'console'].includes(cleanLang)) {
      return {
        hasBadge: false,
        label: '',
        icon: 'terminal',
        iconColor: 'text-primary dark:text-cyan-400',
        badgeBg: '',
      };
    }
    if (['ts', 'tsx', 'typescript'].includes(cleanLang)) {
      return {
        hasBadge: true,
        label: 'TYPESCRIPT',
        icon: 'code',
        iconColor: 'text-blue-600 dark:text-blue-400',
        badgeBg: 'bg-blue-500/10 text-blue-600 dark:text-blue-300 border-blue-500/20',
      };
    }
    if (['js', 'jsx', 'javascript'].includes(cleanLang)) {
      return {
        hasBadge: true,
        label: 'JAVASCRIPT',
        icon: 'code',
        iconColor: 'text-amber-600 dark:text-amber-400',
        badgeBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/20',
      };
    }
    if (['py', 'python'].includes(cleanLang)) {
      return {
        hasBadge: true,
        label: 'PYTHON',
        icon: 'terminal',
        iconColor: 'text-emerald-600 dark:text-emerald-400',
        badgeBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/20',
      };
    }
    if (['json', 'yaml', 'yml'].includes(cleanLang)) {
      return {
        hasBadge: true,
        label: cleanLang.toUpperCase(),
        icon: 'data_object',
        iconColor: 'text-purple-600 dark:text-purple-400',
        badgeBg: 'bg-purple-500/10 text-purple-600 dark:text-purple-300 border-purple-500/20',
      };
    }
    return {
      hasBadge: true,
      label: cleanLang.toUpperCase(),
      icon: 'code',
      iconColor: 'text-primary',
      badgeBg: 'bg-primary/10 text-primary border-primary/20',
    };
  };

  const meta = getLangMeta();

  return (
    <div className="my-3.5 rounded-xl overflow-hidden border border-outline-variant/25 dark:border-outline-variant/30 bg-[#f6f8fa] dark:bg-[#0d1117] shadow-md dark:shadow-xl backdrop-blur-md transition-all hover:border-outline-variant/50 group">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#eaeef2] dark:bg-[#161b22]/95 border-b border-outline-variant/15 dark:border-outline-variant/20 select-none">
        {/* Left: Bash-like icon on the left-most */}
        <div className="flex items-center gap-2">
          <span className={`material-symbols-outlined text-[15px] ${meta.iconColor}`}>
            {meta.icon}
          </span>
          {meta.hasBadge && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold tracking-wider border ${meta.badgeBg}`}>
              {meta.label}
            </span>
          )}
        </div>

        {/* Right: Copy Button */}
        <button
          type="button"
          onClick={handleCopy}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono font-medium transition-all cursor-pointer shadow-xs active:scale-95 border ${
            copied
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
              : 'bg-surface-container-high/60 dark:bg-surface-container/60 hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface border-outline-variant/30 hover:border-outline-variant/50'
          }`}
          title="Copy code to clipboard"
        >
          <span
            className={`material-symbols-outlined text-[13px] transition-colors ${
              copied ? 'text-emerald-600 dark:text-emerald-400' : 'text-outline'
            }`}
          >
            {copied ? 'check' : 'content_copy'}
          </span>
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>

      {/* Code / Output Content with Day & Dark Mode Text */}
      <pre className="p-3.5 sm:p-4 text-xs sm:text-sm font-mono overflow-x-auto text-[#24292f] dark:text-[#e6edf3] leading-relaxed selection:bg-primary/30 selection:text-white scrollbar-thin">
        <code>{code}</code>
      </pre>
    </div>
  );
};

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content, className = '' }) => {
  if (!content) return null;

  // Split content by lines / blocks
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];

  const flushList = () => {
    if (!currentList) return;
    const ListTag = currentList.type;
    const listKey = `list-${elements.length}`;
    elements.push(
      <ListTag
        key={listKey}
        className={`space-y-1.5 my-2 pl-6 text-on-surface ${
          currentList.type === 'ul' ? 'list-disc' : 'list-decimal'
        }`}
      >
        {currentList.items.map((item, idx) => (
          <li key={idx} className="leading-relaxed">
            {renderInline(item)}
          </li>
        ))}
      </ListTag>
    );
    currentList = null;
  };

  const flushCodeBlock = () => {
    if (!inCodeBlock) return;
    const code = codeBlockLines.join('\n');
    const blockKey = `code-${elements.length}`;
    elements.push(
      <CodeBlockView
        key={blockKey}
        code={code}
        lang={codeBlockLang}
      />
    );
    inCodeBlock = false;
    codeBlockLang = '';
    codeBlockLines = [];
  };

  const renderInline = (text: string): React.ReactNode => {
    // Parse inline bold, code, and italic
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let keyIdx = 0;

    while (remaining) {
      // Inline code `code`
      const codeMatch = remaining.match(/^`([^`]+)`/);
      if (codeMatch) {
        parts.push(
          <code
            key={`code-${keyIdx++}`}
            className="px-1.5 py-0.5 rounded bg-surface-container-high text-primary font-mono text-xs sm:text-sm border border-outline-variant/20"
          >
            {codeMatch[1]}
          </code>
        );
        remaining = remaining.slice(codeMatch[0].length);
        continue;
      }

      // Bold **bold**
      const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
      if (boldMatch) {
        parts.push(
          <strong key={`bold-${keyIdx++}`} className="font-semibold text-on-surface">
            {boldMatch[1]}
          </strong>
        );
        remaining = remaining.slice(boldMatch[0].length);
        continue;
      }

      // Italic *italic* or _italic_
      const italicMatch = remaining.match(/^(\*|_)([^*_]+)\1/);
      if (italicMatch) {
        parts.push(
          <em key={`italic-${keyIdx++}`} className="italic text-on-surface-variant">
            {italicMatch[2]}
          </em>
        );
        remaining = remaining.slice(italicMatch[0].length);
        continue;
      }

      // Markdown image ![alt](url)
      const imageMatch = remaining.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      if (imageMatch) {
        parts.push(
          <img
            key={`img-${keyIdx++}`}
            src={imageMatch[2]}
            alt={imageMatch[1] || 'image'}
            className="my-2 max-w-full rounded-lg border border-outline-variant/30 shadow-sm inline-block"
            loading="lazy"
          />
        );
        remaining = remaining.slice(imageMatch[0].length);
        continue;
      }

      // Markdown hyperlink [text](url)
      const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        const linkText = linkMatch[1];
        const rawHref = linkMatch[2].trim();
        const isExternal =
          /^(https?:\/\/|mailto:|tel:|ftp:\/\/)/i.test(rawHref) &&
          (typeof window === 'undefined' ||
            (!rawHref.startsWith(window.location.origin + '/home/user/workspace') &&
             !rawHref.startsWith(window.location.origin + '/workspace')));

        if (isExternal) {
          parts.push(
            <a
              key={`link-${keyIdx++}`}
              href={rawHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline hover:text-primary/80 transition-colors font-medium break-all"
            >
              {renderInline(linkText)}
            </a>
          );
        } else {
          // Internal sandbox workspace file or local document reference (non-clickable badge, no underlines, vertically aligned)
          parts.push(
            <span
              key={`file-chip-${keyIdx++}`}
              className="inline-flex items-center gap-1.5 font-mono text-xs sm:text-sm leading-none text-primary no-underline bg-primary/10 border border-primary/20 rounded px-1.5 py-0.5 align-middle select-text font-medium mx-0.5"
            >
              <span className="material-symbols-outlined text-[13px] leading-none text-tertiary shrink-0 select-none no-underline -translate-y-px">
                description
              </span>
              <span className="no-underline leading-none">{renderInline(linkText)}</span>
            </span>
          );
        }
        remaining = remaining.slice(linkMatch[0].length);
        continue;
      }

      // Plain text up to next special char
      const nextSpecial = remaining.search(/[`*_!\[]/);
      if (nextSpecial === -1) {
        parts.push(remaining);
        break;
      } else if (nextSpecial === 0) {
        parts.push(remaining[0]);
        remaining = remaining.slice(1);
      } else {
        parts.push(remaining.slice(0, nextSpecial));
        remaining = remaining.slice(nextSpecial);
      }
    }

    return parts;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check code blocks
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        flushCodeBlock();
      } else {
        flushList();
        inCodeBlock = true;
        codeBlockLang = line.trim().slice(3).trim();
        codeBlockLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Check headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const hClass =
        level === 1
          ? 'text-xl font-bold text-on-surface mt-4 mb-2'
          : level === 2
          ? 'text-lg font-bold text-on-surface mt-3 mb-1.5'
          : 'text-base font-semibold text-on-surface mt-2 mb-1';
      elements.push(
        <div key={`h-${i}`} className={hClass}>
          {renderInline(text)}
        </div>
      );
      continue;
    }

    // Check bullet lists
    const ulMatch = line.match(/^(\*|-|\+)\s+(.+)$/);
    if (ulMatch) {
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(ulMatch[2]);
      continue;
    }

    // Check ordered lists
    const olMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (olMatch) {
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(olMatch[2]);
      continue;
    }

    // If empty line, flush list and add small space
    if (!line.trim()) {
      flushList();
      continue;
    }

    // Standard paragraph line
    flushList();
    elements.push(
      <p key={`p-${i}`} className="my-1.5 leading-relaxed text-on-surface select-text">
        {renderInline(line)}
      </p>
    );
  }

  flushList();
  flushCodeBlock();

  return <div className={`space-y-1 font-body-lg text-body-lg text-sm sm:text-base ${className}`}>{elements}</div>;
};
