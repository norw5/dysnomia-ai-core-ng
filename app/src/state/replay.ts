import { useSyncExternalStore } from "react";
import { parseRecording, scoreAt, seekRecording, type Recording } from "@/agent/recording";
import { emitRunEvent } from "@/agent/events";
import type { RunEvent } from "@/agent/graph";
import type { ChatDisplayMessage } from "@/agent/store";
import { resetUnlockedSlotsToDefaults } from "@/state/deckStore";

/**
 * The in-app REPLAY flagship (session 62; the session-63 rework: arming +
 * the transport live on the SYS tab + a SLIM HEADER strip — real users
 * never see fleet machinery). The recorded RunEvent stream re-feeds
 * through `emitRunEvent` onto the deck's auto-surface machinery — the
 * SAME bus + the SAME routing the live run rides, never a second
 * renderer.
 *
 * SEEK SEMANTICS (the law):
 * - forward: emit the not-yet-fed events in order (routed surfaces land
 *   in their designated bays — exactly the live behavior);
 * - backward: the surface state is a deterministic FOLD of the event
 *   prefix, so scrubbing back = UNLOCKED bays reset to the DEFAULT
 *   composition + re-feed the prefix (session-63 law); LOCKED bays
 *   persist — the operator spoke;
 * - task_graph/chat_monitor read LIVE stores — during replay the AI_CORE
 *   pane carries the conversation instead (the 62.1 owner round): the
 *   transcript is a PURE fold of the playhead prefix (replayTranscript),
 *   so seeks in either direction re-derive it instantly, and the fleet
 *   scoreboard renders the recording's own snapshots AS OF the playhead.
 *
 * The §7.4 fence applies at render time exactly as live: recorded tool
 * results are replay DATA (inert text, never directives).
 */

export type ReplaySpeed = 0.5 | 1 | 2 | 4;

export const REPLAY_SPEEDS: ReplaySpeed[] = [0.5, 1, 2, 4];

/** the per-event base delay at 1× (ms) — weighted per kind below */
export const REPLAY_EVENT_MS = 650;

/**
 * The narrative clock (the 62.1 owner round: weighted event pacing — a
 * flat clock reads as noise). Assistant text HOLDS so it can be read;
 * tool results beat; usage ticks are near-instant.
 */
export function replayEventWeight(e: RunEvent): number {
  switch (e.type) {
    case "assistant-text":
      return 4;
    case "assistant-reasoning":
      return 3;
    case "tool-result":
      return 1.4;
    case "tool-call":
      return 0.6;
    case "turn-start":
      return 1.6;
    case "done":
      return 2;
    case "budget-stop":
    case "error":
      return 2;
    default:
      return 0.35;
  }
}

export interface ReplayState {
  armed: boolean;
  recording: Recording | null;
  /** the playhead: the last FED event index (-1 = nothing fed yet) */
  index: number;
  playing: boolean;
  speed: ReplaySpeed;
  /** the per-agent transcript filter (null = the whole interleaved fleet) */
  filter: string | null;
  error: string | null;
}

let state: ReplayState = { armed: false, recording: null, index: -1, playing: false, speed: 1, filter: null, error: null };
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

function set(next: Partial<ReplayState>): void {
  state = { ...state, ...next };
  notify();
}

export function replayState(): ReplayState {
  return state;
}

/** the roster row whose agent produced the event at `index` (null = none) */
export function replayActor(rec: Recording, index: number): { name: string; vessel: string } | null {
  if (index < 0 || index >= rec.events.length) return null;
  const ev = rec.events[index]!;
  const row = rec.roster.find((r) => r.name === ev.agent);
  return { name: ev.agent, vessel: row?.vessel ?? "atropa" };
}

/** the score snapshot at-or-before the playhead (the as-of board; null = none yet) */
export function replayScoreAsOf(rec: Recording, index: number) {
  return scoreAt(rec, index);
}

/**
 * Arm a replay from a recording document (the SYS fleet section's loader
 * hands over the raw text). Refuses honestly on parse errors / an empty
 * stream; arming resets the playhead to -1 and resets the unlocked bays
 * to defaults (a fresh fold). The recording is SHARED with the fleet
 * store — one parse, two renderers.
 */
export function armReplay(text: string): boolean {
  let rec: Recording;
  try {
    rec = parseRecording(text);
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
    return false;
  }
  if (rec.events.length === 0) {
    set({ error: "the recording carries no events — nothing to replay" });
    return false;
  }
  resetUnlockedSlotsToDefaults();
  set({ armed: true, recording: rec, index: -1, playing: false, speed: state.speed, filter: null, error: null });
  return true;
}

/** leave replay mode (the deck keeps what it rendered — clear/dismiss is the operator's) */
export function disarmReplay(): void {
  set({ armed: false, recording: null, index: -1, playing: false, filter: null, error: null });
}

/**
 * The replayed conversation, folded from the playhead prefix into the
 * AI_CORE pane's own row shapes (ChatDisplayMessage) plus a turn MARKER
 * row carrying the actor — the 62.1 owner round's answer to "no agent
 * output visible". PURE by the same law as the widget fold: backward
 * seeks re-derive it. `filter` narrows to one roster agent (the grid's
 * per-vessel cells); usage/done noise is skipped, errors render honestly.
 */
export interface ReplayTranscriptRow extends ChatDisplayMessage {
  marker?: { agent: string; vessel: string; turn: number };
}

export function replayTranscript(rec: Recording, index: number, filter: string | null = null): ReplayTranscriptRow[] {
  const rows: ReplayTranscriptRow[] = [];
  const vesselByAgent = new Map(rec.roster.map((r) => [r.name, r.vessel] as const));
  for (const ev of seekRecording(rec, index)) {
    if (filter !== null && ev.agent !== filter) continue;
    const e = ev.e;
    const base = { id: ev.i + 1, t: ev.t };
    if (e.type === "turn-start") {
      rows.push({ ...base, kind: "system", text: null, marker: { agent: ev.agent, vessel: vesselByAgent.get(ev.agent) ?? "atropa", turn: ev.turn } });
    } else if (e.type === "assistant-text" || e.type === "assistant-reasoning") {
      rows.push({ ...base, kind: e.type === "assistant-text" ? "assistant" : "reasoning", text: e.text });
    } else if (e.type === "tool-call") {
      rows.push({ ...base, kind: "tool-call", text: null, toolName: e.name, toolArgs: e.args });
    } else if (e.type === "tool-result") {
      rows.push({ ...base, kind: "tool-result", text: null, toolName: e.name, toolResult: e.result, ok: e.ok });
    } else if (e.type === "error") {
      rows.push({ ...base, kind: "system", text: `[ERROR] ${e.ownerLine ?? e.message}` });
    } else if (e.type === "budget-stop") {
      rows.push({ ...base, kind: "system", text: `[BUDGET] ${e.reason}` });
    }
  }
  return rows;
}

/** narrow the transcript + readout to one roster agent (null = the whole fleet) */
export function setReplayFilter(agent: string | null): void {
  if (!state.armed) return;
  if (agent !== null && state.recording !== null && !state.recording.roster.some((r) => r.name === agent)) return;
  set({ filter: agent });
}

/**
 * Seek to an event index (clamped to [-1, last]). Backward seeks clear the
 * auto surface + re-feed the prefix; forward seeks emit the new events in
 * order. No-ops when disarmed.
 */
export function seekReplay(index: number): void {
  if (!state.armed || state.recording === null) return;
  const last = state.recording.events.length - 1;
  const target = Math.max(-1, Math.min(Math.trunc(index), last));
  if (target === state.index) return;
  if (target < state.index) {
    resetUnlockedSlotsToDefaults();
    state = { ...state, index: -1 };
    for (const ev of seekRecording(state.recording!, target)) {
      emitRunEvent(ev.e);
    }
    state = { ...state, index: target };
    notify();
    return;
  }
  for (let i = state.index + 1; i <= target; i++) {
    emitRunEvent(state.recording!.events[i]!.e);
  }
  set({ index: target });
}

/**
 * Advance one event (the transport clock's tick). Returns false at the end
 * of the stream (and stops playback — an honest end-of-tape).
 */
export function tickReplay(): boolean {
  if (!state.armed || state.recording === null) return false;
  if (state.index >= state.recording.events.length - 1) {
    if (state.playing) set({ playing: false });
    return false;
  }
  seekReplay(state.index + 1);
  return true;
}

export function setReplayPlaying(playing: boolean): void {
  if (!state.armed && playing) return;
  set({ playing });
}

export function setReplaySpeed(speed: ReplaySpeed): void {
  set({ speed });
}

export function replayError(): string | null {
  return state.error;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const subscribeReplay = subscribe;

export function useReplay(): ReplayState {
  return useSyncExternalStore(subscribe, replayState, replayState);
}
