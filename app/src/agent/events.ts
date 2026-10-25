import type { RunEvent } from "@/agent/graph";

/**
 * The lifted RunEvent bus (IA-PLAN §7.11, session-46): the agent store pipes
 * every run event here while keeping its own React state for the transcript;
 * app-global surfaces (the DECK's auto-surfacing) subscribe without reaching
 * into the provider. Same events, one emitter — the store's onEvent remains
 * the single tap.
 */

type Listener = (e: RunEvent) => void;

const listeners = new Set<Listener>();

export function emitRunEvent(e: RunEvent): void {
  for (const fn of listeners) fn(e);
}

export function subscribeRunEvents(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
