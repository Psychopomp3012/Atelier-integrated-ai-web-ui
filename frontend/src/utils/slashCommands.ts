import type { ModelProvider } from '../types';

export type SlashCategory = 'antigravity' | 'codex';

export interface SlashCommand {
  id: string;
  command: string; // e.g. "/plan"
  label: string;
  description: string;
  category: SlashCategory;
  icon: string;
  iconColor: string;
  hint?: string; // e.g. "<path>", "<task>"
  alias?: string; // e.g. "/settings", "/quota"
  actionType: 'insert' | 'clear' | 'files' | 'voice';
}

/**
 * Official Antigravity CLI (`agy`) Slash Commands
 * Sourced directly from official Google Antigravity documentation:
 * https://antigravity.google/docs/cli/reference
 */
export const AGY_SLASH_COMMANDS: SlashCommand[] = [
  // Core Reasoning & Planning
  {
    id: 'agy-plan',
    command: '/plan',
    label: 'Plan',
    description: 'Formulate a step-by-step architectural execution plan before code changes',
    category: 'antigravity',
    icon: 'assignment',
    iconColor: 'text-[#4285F4]',
    hint: '<task>',
    alias: '/planning',
    actionType: 'insert',
  },
  {
    id: 'agy-grill-me',
    command: '/grill-me',
    label: 'Grill Me',
    description: 'Interactive interview session where AI questions you to uncover edge cases and design decisions',
    category: 'antigravity',
    icon: 'psychology',
    iconColor: 'text-[#4285F4]',
    hint: '<topic>',
    actionType: 'insert',
  },
  {
    id: 'agy-boost',
    command: '/boost',
    label: 'Boost',
    description: 'Run on-demand multi-agent deep reasoning loops for intensive engineering tasks',
    category: 'antigravity',
    icon: 'rocket_launch',
    iconColor: 'text-[#4285F4]',
    hint: '<task>',
    actionType: 'insert',
  },
  {
    id: 'agy-goal',
    command: '/goal',
    label: 'Goal',
    description: 'Autonomously set sub-goals and execute iteratively until completion',
    category: 'antigravity',
    icon: 'flag',
    iconColor: 'text-[#4285F4]',
    hint: '<objective>',
    actionType: 'insert',
  },
  {
    id: 'agy-teamwork',
    command: '/teamwork-preview',
    label: 'Teamwork',
    description: 'Launch collaborative multi-agent teams partitioned by domain for complex projects',
    category: 'antigravity',
    icon: 'groups',
    iconColor: 'text-[#4285F4]',
    hint: '<task>',
    alias: '/teamwork',
    actionType: 'insert',
  },
  {
    id: 'agy-learn',
    command: '/learn',
    label: 'Learn',
    description: 'Save user preferences, guidelines, or repository rules to AGENTS.md / SKILL.md',
    category: 'antigravity',
    icon: 'school',
    iconColor: 'text-[#4285F4]',
    hint: '<instruction>',
    actionType: 'insert',
  },
  {
    id: 'agy-btw',
    command: '/btw',
    label: 'By The Way',
    description: 'Ask a side question in the background without interrupting the main conversation',
    category: 'antigravity',
    icon: 'help_center',
    iconColor: 'text-[#4285F4]',
    hint: '<query>',
    actionType: 'insert',
  },

  // Tools & Tasks
  {
    id: 'agy-agents',
    command: '/agents',
    label: 'Agents',
    description: 'Open the Agent Manager panel to switch custom agents and monitor background subagents',
    category: 'antigravity',
    icon: 'smart_toy',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },
  {
    id: 'agy-tasks',
    command: '/tasks',
    label: 'Tasks',
    description: 'Open the Task Manager panel to monitor background shell execution logs',
    category: 'antigravity',
    icon: 'checklist',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },
  {
    id: 'agy-artifact',
    command: '/artifact',
    label: 'Artifacts',
    description: 'Open the Artifact Review panel for inspecting generated code artifacts',
    category: 'antigravity',
    icon: 'preview',
    iconColor: 'text-[#4285F4]',
    actionType: 'files',
  },
  {
    id: 'agy-skills',
    command: '/skills',
    label: 'Skills',
    description: 'Browse loaded local and global Agent Skills',
    category: 'antigravity',
    icon: 'psychology_alt',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },
  {
    id: 'agy-plugin',
    command: '/plugin',
    label: 'Plugins',
    description: 'Open interactive Plugins Manager (install, uninstall, enable, disable, list)',
    category: 'antigravity',
    icon: 'extension',
    iconColor: 'text-[#4285F4]',
    alias: '/plugins',
    actionType: 'insert',
  },
  {
    id: 'agy-mcp',
    command: '/mcp',
    label: 'MCP',
    description: 'Open the Model Context Protocol (MCP) server manager',
    category: 'antigravity',
    icon: 'hub',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },
  {
    id: 'agy-hooks',
    command: '/hooks',
    label: 'Hooks',
    description: 'Browse active pre-flight and post-format script hooks',
    category: 'antigravity',
    icon: 'sync_alt',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },

  // Workspace & Utilities
  {
    id: 'agy-diff',
    command: '/diff',
    label: 'Diff',
    description: 'Open the interactive diff viewer to review workspace changes, turns, and commits',
    category: 'antigravity',
    icon: 'difference',
    iconColor: 'text-[#4285F4]',
    actionType: 'files',
  },
  {
    id: 'agy-add-dir',
    command: '/add-dir',
    label: 'Add Directory',
    description: 'Add an extra directory path dynamically to the active workspace',
    category: 'antigravity',
    icon: 'create_new_folder',
    iconColor: 'text-[#4285F4]',
    hint: '<path>',
    actionType: 'insert',
  },
  {
    id: 'agy-open',
    command: '/open',
    label: 'Open',
    description: 'Force a file path to open inside your default system editor',
    category: 'antigravity',
    icon: 'file_open',
    iconColor: 'text-[#4285F4]',
    hint: '<path>',
    actionType: 'insert',
  },
  {
    id: 'agy-context',
    command: '/context',
    label: 'Context',
    description: 'Open the context usage visualization and token breakdown panel',
    category: 'antigravity',
    icon: 'pie_chart',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },
  {
    id: 'agy-copy',
    command: '/copy',
    label: 'Copy',
    description: 'Copy the last agent response to the system clipboard',
    category: 'antigravity',
    icon: 'content_copy',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },
  {
    id: 'agy-clear',
    command: '/clear',
    label: 'Clear',
    description: 'Clear the terminal and reset active conversational contexts',
    category: 'antigravity',
    icon: 'delete_sweep',
    iconColor: 'text-red-400',
    alias: '/new',
    actionType: 'clear',
  },
  {
    id: 'agy-resume',
    command: '/resume',
    label: 'Resume',
    description: 'Open conversation picker overlay to select and load previous threads',
    category: 'antigravity',
    icon: 'history',
    iconColor: 'text-[#4285F4]',
    alias: '/switch, /conversation',
    actionType: 'insert',
  },
  {
    id: 'agy-fork',
    command: '/fork',
    label: 'Fork',
    description: 'Clone the current conversation thread into a new parallel session',
    category: 'antigravity',
    icon: 'fork_right',
    iconColor: 'text-[#4285F4]',
    alias: '/branch',
    actionType: 'insert',
  },
  {
    id: 'agy-rewind',
    command: '/rewind',
    label: 'Rewind',
    description: 'Roll back your conversation history to a previous message',
    category: 'antigravity',
    icon: 'undo',
    iconColor: 'text-[#4285F4]',
    alias: '/undo',
    actionType: 'insert',
  },
  {
    id: 'agy-rename',
    command: '/rename',
    label: 'Rename',
    description: 'Rename the current session thread',
    category: 'antigravity',
    icon: 'edit',
    iconColor: 'text-[#4285F4]',
    hint: '<name>',
    actionType: 'insert',
  },

  // Configuration & Environment
  {
    id: 'agy-model',
    command: '/model',
    label: 'Model',
    description: 'Choose your preferred reasoning model (persists across sessions)',
    category: 'antigravity',
    icon: 'tune',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },
  {
    id: 'agy-permissions',
    command: '/permissions',
    label: 'Permissions',
    description: 'Open the interactive tool permissions manager panel',
    category: 'antigravity',
    icon: 'security',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },
  {
    id: 'agy-config',
    command: '/config',
    label: 'Config',
    description: 'Open the interactive Settings Editor overlay',
    category: 'antigravity',
    icon: 'settings',
    iconColor: 'text-[#4285F4]',
    alias: '/settings',
    actionType: 'insert',
  },
  {
    id: 'agy-fast',
    command: '/fast',
    label: 'Fast Mode',
    description: 'Enable fast mode (bypass reasoning plans) for quick actions',
    category: 'antigravity',
    icon: 'speed',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },
  {
    id: 'agy-statusline',
    command: '/statusline',
    label: 'Statusline',
    description: 'Open the Status Bar customization overlay',
    category: 'antigravity',
    icon: 'view_timeline',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },
  {
    id: 'agy-keybindings',
    command: '/keybindings',
    label: 'Keybindings',
    description: 'Open the interactive Keyboard Shortcut Editor',
    category: 'antigravity',
    icon: 'keyboard',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },
  {
    id: 'agy-remote-control',
    command: '/remote-control',
    label: 'Remote Control',
    description: 'Toggle Remote Control for the active terminal session [on/off]',
    category: 'antigravity',
    icon: 'settings_remote',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },
  {
    id: 'agy-title',
    command: '/title',
    label: 'Title',
    description: 'Toggle or set terminal window title updates [on/off]',
    category: 'antigravity',
    icon: 'subtitles',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },

  // Account & System
  {
    id: 'agy-credits',
    command: '/credits',
    label: 'Credits',
    description: 'View remaining G1 credits and purchase links',
    category: 'antigravity',
    icon: 'account_balance_wallet',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },
  {
    id: 'agy-usage',
    command: '/usage',
    label: 'Usage',
    description: 'Display model quota usage and remaining limits',
    category: 'antigravity',
    icon: 'analytics',
    iconColor: 'text-[#4285F4]',
    alias: '/quota',
    actionType: 'insert',
  },
  {
    id: 'agy-voice',
    command: '/voice',
    label: 'Voice',
    description: 'Dictate a prompt using your microphone',
    category: 'antigravity',
    icon: 'mic',
    iconColor: 'text-[#4285F4]',
    alias: '/record',
    actionType: 'voice',
  },
  {
    id: 'agy-feedback',
    command: '/feedback',
    label: 'Feedback',
    description: 'Open the feedback submission panel',
    category: 'antigravity',
    icon: 'chat',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },
  {
    id: 'agy-help',
    command: '/help',
    label: 'Help',
    description: 'Open the help panel showing commands and shortcuts',
    category: 'antigravity',
    icon: 'help_outline',
    iconColor: 'text-[#4285F4]',
    actionType: 'insert',
  },
  {
    id: 'agy-logout',
    command: '/logout',
    label: 'Logout',
    description: 'Disconnect profile and purge tokens from secure keyring',
    category: 'antigravity',
    icon: 'logout',
    iconColor: 'text-red-400',
    actionType: 'insert',
  },
  {
    id: 'agy-exit',
    command: '/exit',
    label: 'Exit',
    description: 'Close the TUI session and restore host shell',
    category: 'antigravity',
    icon: 'power_settings_new',
    iconColor: 'text-red-400',
    alias: '/quit',
    actionType: 'insert',
  },
];

/**
 * Official OpenAI Codex CLI (`codex`) Slash Commands
 * Sourced directly from official OpenAI Codex documentation:
 * https://developers.openai.com/codex
 */
export const CODEX_SLASH_COMMANDS: SlashCommand[] = [
  // Session & Execution
  {
    id: 'codex-model',
    command: '/model',
    label: 'Model',
    description: 'Select or switch active model and reasoning effort (low, medium, high)',
    category: 'codex',
    icon: 'tune',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },
  {
    id: 'codex-goal',
    command: '/goal',
    label: 'Goal',
    description: 'Direct Codex to work toward a specific objective with validation loops (pause, resume, clear)',
    category: 'codex',
    icon: 'flag',
    iconColor: 'text-[#10A37F]',
    hint: '<objective>',
    actionType: 'insert',
  },
  {
    id: 'codex-plan',
    command: '/plan',
    label: 'Plan',
    description: 'Activate plan mode to formulate multi-step execution architecture',
    category: 'codex',
    icon: 'assignment',
    iconColor: 'text-[#10A37F]',
    hint: '<task>',
    actionType: 'insert',
  },
  {
    id: 'codex-review',
    command: '/review',
    label: 'Review',
    description: 'Inspect and run an automated code review on current working tree diffs',
    category: 'codex',
    icon: 'rate_review',
    iconColor: 'text-[#10A37F]',
    hint: '[files]',
    actionType: 'insert',
  },
  {
    id: 'codex-diff',
    command: '/diff',
    label: 'Diff',
    description: 'Interactive diff viewer to inspect proposed workspace modifications',
    category: 'codex',
    icon: 'difference',
    iconColor: 'text-[#10A37F]',
    actionType: 'files',
  },
  {
    id: 'codex-init',
    command: '/init',
    label: 'Init',
    description: 'Initialize repository configuration and generate AGENTS.md instructions',
    category: 'codex',
    icon: 'auto_awesome_motion',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },
  {
    id: 'codex-compact',
    command: '/compact',
    label: 'Compact',
    description: 'Compress and summarize conversation transcript to free context tokens',
    category: 'codex',
    icon: 'compress',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },
  {
    id: 'codex-status',
    command: '/status',
    label: 'Status',
    description: 'Check active session state, rate limit resets, and context percentage',
    category: 'codex',
    icon: 'info',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },

  // Agent, Threads & Tools
  {
    id: 'codex-agent',
    command: '/agent',
    label: 'Agent',
    description: 'Switch between active parallel agent threads and inspect subagent tasks',
    category: 'codex',
    icon: 'smart_toy',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },
  {
    id: 'codex-permissions',
    command: '/permissions',
    label: 'Permissions',
    description: 'Adjust tool execution permissions, sandbox policies, and network access',
    category: 'codex',
    icon: 'security',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },
  {
    id: 'codex-apps',
    command: '/apps',
    label: 'Apps',
    description: 'Browse, authenticate, and insert connected apps into your workflow',
    category: 'codex',
    icon: 'apps',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },
  {
    id: 'codex-mcp',
    command: '/mcp',
    label: 'MCP',
    description: 'Manage external Model Context Protocol (MCP) servers for Codex',
    category: 'codex',
    icon: 'hub',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },
  {
    id: 'codex-ps',
    command: '/ps',
    label: 'Processes',
    description: 'View running background terminal processes and agent jobs',
    category: 'codex',
    icon: 'terminal',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },
  {
    id: 'codex-stop',
    command: '/stop',
    label: 'Stop',
    description: 'Terminate running background terminal process or cancel active turn',
    category: 'codex',
    icon: 'stop_circle',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },

  // Session & Workspace Management
  {
    id: 'codex-resume',
    command: '/resume',
    label: 'Resume',
    description: 'Resume a previous interactive session from thread history picker',
    category: 'codex',
    icon: 'history',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },
  {
    id: 'codex-fork',
    command: '/fork',
    label: 'Fork',
    description: 'Fork the current chat into a new session preserving transcript history',
    category: 'codex',
    icon: 'fork_right',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },
  {
    id: 'codex-clear',
    command: '/clear',
    label: 'Clear',
    description: 'Clear conversation viewport and start a fresh thread session',
    category: 'codex',
    icon: 'delete_sweep',
    iconColor: 'text-red-400',
    actionType: 'clear',
  },
  {
    id: 'codex-usage',
    command: '/usage',
    label: 'Usage',
    description: 'Display Codex token usage, turn limits, and rate-limit reset timers',
    category: 'codex',
    icon: 'analytics',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },
  {
    id: 'codex-voice',
    command: '/voice',
    label: 'Voice',
    description: 'Toggle real-time voice mode or dictation (/voice stop)',
    category: 'codex',
    icon: 'mic',
    iconColor: 'text-[#10A37F]',
    actionType: 'voice',
  },
  {
    id: 'codex-vim',
    command: '/vim',
    label: 'Vim Mode',
    description: 'Toggle Vim navigation and editing modal bindings inside composer',
    category: 'codex',
    icon: 'text_fields',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },
  {
    id: 'codex-keymap',
    command: '/keymap',
    label: 'Keymap',
    description: 'Inspect and customize TUI keyboard bindings in tui.keymap',
    category: 'codex',
    icon: 'keyboard',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },
  {
    id: 'codex-experimental',
    command: '/experimental',
    label: 'Experimental',
    description: 'Inspect and toggle experimental features in config.toml',
    category: 'codex',
    icon: 'science',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },
  {
    id: 'codex-feedback',
    command: '/feedback',
    label: 'Feedback',
    description: 'Submit diagnostics or bug report directly to OpenAI Codex',
    category: 'codex',
    icon: 'chat',
    iconColor: 'text-[#10A37F]',
    actionType: 'insert',
  },
  {
    id: 'codex-logout',
    command: '/logout',
    label: 'Logout',
    description: 'Remove stored authentication credentials and sign out',
    category: 'codex',
    icon: 'logout',
    iconColor: 'text-red-400',
    actionType: 'insert',
  },
];

/**
 * Resolves whether the active model corresponds to Antigravity CLI (agy) or OpenAI Codex CLI (codex).
 */
export function resolveProviderCategory(
  provider: ModelProvider,
  modelId?: string,
  modelName?: string
): 'antigravity' | 'codex' {
  const combined = `${modelId || ''} ${modelName || ''}`.toLowerCase();
  if (
    provider === 'codex' ||
    combined.includes('gpt') ||
    combined.startsWith('o1') ||
    combined.startsWith('o3') ||
    combined.includes('codex') ||
    combined.includes('openai')
  ) {
    return 'codex';
  }
  // Default to Antigravity CLI (agy) for Google Gemini and Antigravity native models
  return 'antigravity';
}

/**
 * Returns all authentic slash commands for the specified provider CLI.
 */
export function getCommandsForProvider(
  category: 'antigravity' | 'codex'
): SlashCommand[] {
  return category === 'codex' ? CODEX_SLASH_COMMANDS : AGY_SLASH_COMMANDS;
}

/**
 * Filters commands against user search query (e.g. "pl" for "/pl").
 */
export function filterSlashCommands(
  commands: SlashCommand[],
  query: string
): SlashCommand[] {
  const clean = query.trim().toLowerCase().replace(/^\//, '');
  if (!clean) return commands;
  return commands.filter(
    (cmd) =>
      cmd.command.toLowerCase().includes(clean) ||
      cmd.label.toLowerCase().includes(clean) ||
      cmd.description.toLowerCase().includes(clean) ||
      (cmd.alias && cmd.alias.toLowerCase().includes(clean))
  );
}
