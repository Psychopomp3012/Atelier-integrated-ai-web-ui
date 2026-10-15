export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompactionResult {
  formattedPrompt: string;
  originalMessageCount: number;
  retainedMessageCount: number;
  wasCompacted: boolean;
}

/**
 * Intelligently manages conversation history to prevent context window explosion
 * even in sessions with 500+ messages.
 *
 * Strategy:
 * 1. If history <= maxUncompactedTurns (e.g. 10 turns): keep all in full.
 * 2. If history > 10 turns:
 *    - Anchor 1: Keep the very first user message (the original objective/project task).
 *    - Anchor 2: Compact middle turns into a distilled summary.
 *    - Anchor 3: Keep the most recent N turns (last 8-10 messages) in full fidelity.
 * 3. Enforce a strict total character budget (e.g. max 12,000 chars ~ 3,000 tokens)
 *    so latency and token costs remain minimal.
 */
export function compactConversationHistory(
  history: HistoryMessage[],
  currentPrompt: string,
  options: {
    maxRecentTurns?: number;
    maxTotalChars?: number;
  } = {}
): CompactionResult {
  const maxRecent = options.maxRecentTurns ?? 8;
  const maxChars = options.maxTotalChars ?? 14000;

  if (!history || history.length <= 1) {
    return {
      formattedPrompt: currentPrompt,
      originalMessageCount: history?.length || 0,
      retainedMessageCount: history?.length || 0,
      wasCompacted: false,
    };
  }

  // If history is small enough, format directly
  if (history.length <= maxRecent + 2) {
    const priorTurns = history.slice(0, -1);
    const priorFormatted = priorTurns
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${truncateMessage(m.content, 2000)}`)
      .join('\n\n');

    const promptText = `[Conversation History]\n${priorFormatted}\n\n[Current User Instruction]\n${currentPrompt}`;
    return {
      formattedPrompt: clampString(promptText, maxChars),
      originalMessageCount: history.length,
      retainedMessageCount: history.length,
      wasCompacted: false,
    };
  }

  // History is long (e.g. 20, 50, 500 messages) -> Apply Intelligent Compaction
  const firstMsg = history[0];
  const recentMessages = history.slice(-maxRecent);
  const middleMessages = history.slice(1, -maxRecent);
  const omittedCount = middleMessages.length;

  // Extract key milestones/topics from middle messages
  const topicSnippets: string[] = [];
  for (let i = 0; i < middleMessages.length; i += 2) {
    const userTurn = middleMessages[i];
    if (userTurn && userTurn.content) {
      const firstLine = userTurn.content.trim().split('\n')[0].substring(0, 80);
      topicSnippets.push(`- Turn #${i + 2}: ${firstLine}`);
    }
    if (topicSnippets.length >= 6) break;
  }

  const compactedSummary = [
    `[Compacted History: ${omittedCount} intermediate turns summarized to preserve context]`,
    `Initial Session Goal: "${truncateMessage(firstMsg.content, 250)}"`,
    topicSnippets.length > 0 ? `Intermediate Steps Completed:\n${topicSnippets.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const recentFormatted = recentMessages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${truncateMessage(m.content, 1800)}`)
    .join('\n\n');

  const finalFormatted = `[Session Context]\n${compactedSummary}\n\n[Recent Conversation (Last ${recentMessages.length} turns)]\n${recentFormatted}\n\n[Current User Instruction]\n${currentPrompt}`;

  return {
    formattedPrompt: clampString(finalFormatted, maxChars),
    originalMessageCount: history.length,
    retainedMessageCount: recentMessages.length + 1,
    wasCompacted: true,
  };
}

function truncateMessage(content: string, maxLen: number): string {
  if (!content) return '';
  if (content.length <= maxLen) return content;
  const half = Math.floor(maxLen / 2);
  return `${content.substring(0, half)}\n... [truncated ${content.length - maxLen} chars] ...\n${content.substring(content.length - half)}`;
}

function clampString(str: string, maxChars: number): string {
  if (str.length <= maxChars) return str;
  return str.substring(str.length - maxChars);
}
