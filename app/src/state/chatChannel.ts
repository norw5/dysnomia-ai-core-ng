import { useCallback, useSyncExternalStore } from "react";

/**
 * The CHAT view's channel pointer (session-44): `world` (the VOID channel —
 * the world-chat SHIO archive + tail) or `venue` (the selected QING's own
 * LogEvent channel). The VENUE it points at is the app-global current venue
 * (state/venueStore) — one selection, every view; this store only remembers
 * WHICH kind of channel CHAT is showing, so MAP and CHAT can look at the
 * same venue without forcing each other's mode.
 */

export type ChatChannelMode = "world" | "venue";

const KEY = "dys.chat.mode.v1";

let mode: ChatChannelMode = load();

function load(): ChatChannelMode {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === "venue" ? "venue" : "world";
  } catch {
    return "world";
  }
}

function persist(): void {
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    /* storage unavailable */
  }
}

const listeners = new Set<() => void>();

export function chatChannelMode(): ChatChannelMode {
  return mode;
}

export function setChatChannelMode(next: ChatChannelMode): void {
  mode = next;
  persist();
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const subscribeChatChannelMode = subscribe;

export function useChatChannelMode(): {
  mode: ChatChannelMode;
  setMode: (m: ChatChannelMode) => void;
} {
  const value = useSyncExternalStore(subscribe, chatChannelMode, chatChannelMode);
  const setMode = useCallback((m: ChatChannelMode) => setChatChannelMode(m), []);
  return { mode: value, setMode };
}
