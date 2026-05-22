// Cross-conversation search utility
// Searches across all conversations' messages for matching text

import type { ContentBlock } from "../providers";

export interface SearchResult {
  conversationId: string;
  conversationTitle: string;
  messageId: string;
  messageRole: "user" | "assistant";
  matchText: string; // snippet containing the match
  createdAt: number;
}

/**
 * Extract plain text from ContentBlock[] for search purposes.
 */
function contentBlocksToSearchText(content: ContentBlock[]): string {
  return content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "thinking") return block.text;
      if (block.type === "voice") return block.text;
      if (block.type === "tool") return [block.input, block.output].filter(Boolean).join(" ");
      if (block.type === "attachment") return block.attachment.name;
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

/**
 * Create a snippet around the match position.
 */
function createSnippet(text: string, matchIndex: number, snippetLength = 120): string {
  const halfLen = Math.floor(snippetLength / 2);
  const start = Math.max(0, matchIndex - halfLen);
  const end = Math.min(text.length, matchIndex + halfLen);

  let snippet = text.slice(start, end).replace(/\s+/g, " ");
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

/**
 * Search all conversations for a query string.
 * Returns matching results sorted by relevance (most recent first).
 */
export function searchConversations(
  conversations: Conversation[],
  query: string,
  maxResults = 50,
): SearchResult[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];

  const results: SearchResult[] = [];

  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      const text = contentBlocksToSearchText(message.content);
      const lowerText = text.toLowerCase();
      const matchIndex = lowerText.indexOf(trimmed);

      if (matchIndex !== -1) {
        results.push({
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          messageId: message.id,
          messageRole: message.role,
          matchText: createSnippet(text, matchIndex),
          createdAt: message.createdAt ?? conversation.updatedAt,
        });
      }

      if (results.length >= maxResults) break;
    }
    if (results.length >= maxResults) break;
  }

  // Sort by most recent first
  results.sort((a, b) => b.createdAt - a.createdAt);
  return results;
}

/**
 * Search conversation titles only (for quick filtering).
 */
export function searchConversationTitles(
  conversations: Conversation[],
  query: string,
): Conversation[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return conversations;

  return conversations.filter(
    (c) => c.title.toLowerCase().includes(trimmed),
  );
}
