import type { ViewLine } from "@/ui/chat/viewLine";

/**
 * The CHAT module's native search (session-71, the owner's 69.4 spec):
 * browser find-in-page cannot see paged/virtualized content, so the module
 * implements its own. Pure case-insensitive substring match over the
 * handle + body; results are LINE IDS (stable across window growth — the
 * jump path expands the rendered window to the id, never to an index).
 */

export interface ChatSearchResult {
  /** matched line ids, ascending line order */
  ids: string[];
  /** how many lines were searched (the honesty note's number) */
  searched: number;
}

export function chatSearchLines(lines: readonly ViewLine[], query: string): ChatSearchResult {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return { ids: [], searched: lines.length };
  const ids: string[] = [];
  for (const l of lines) {
    const hay = `${l.handle ?? ""} ${l.body}`.toLowerCase();
    if (hay.includes(q)) ids.push(l.id);
  }
  return { ids, searched: lines.length };
}
