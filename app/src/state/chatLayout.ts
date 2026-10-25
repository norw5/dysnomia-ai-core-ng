import { useSyncExternalStore } from "react";

/**
 * The CHAT module's display layout (session-71, the owner's 69.4 spec): a
 * compact IRC style (the session-44 idiom) and a modern chat-app style with
 * message bubbles + sigil pfps. One persisted preference, default IRC — the
 * terminal idiom stays the law until the reader asks for rich.
 */

export type ChatLayout = "irc" | "rich";

const KEY = "dys.chat.layout.v1";

let layout: ChatLayout = load();

function load(): ChatLayout {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === "rich" ? "rich" : "irc";
  } catch {
    return "irc";
  }
}

function persist(): void {
  try {
    window.localStorage.setItem(KEY, layout);
  } catch {
    /* storage unavailable */
  }
}

const listeners = new Set<() => void>();

export function chatLayout(): ChatLayout {
  return layout;
}

export function setChatLayout(next: ChatLayout): void {
  layout = next;
  persist();
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const subscribeChatLayout = subscribe;

export function useChatLayout(): { layout: ChatLayout; setLayout: (l: ChatLayout) => void } {
  const value = useSyncExternalStore(subscribe, chatLayout, chatLayout);
  return { layout: value, setLayout: setChatLayout };
}
