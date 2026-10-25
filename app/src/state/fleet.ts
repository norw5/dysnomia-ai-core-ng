import { useSyncExternalStore } from "react";
import { makeClient } from "@/chain/client";
import { simLayerActive } from "@/chain/simMode";
import { loadFleetStates, rowsFromScoreSnapshots } from "@/chain/fleetReads";
import { rankFleetRows, scoreRowToJson, type FleetScoreRow } from "@/chain/fleetScore";
import { parseRecording, type Recording } from "@/agent/recording";

/**
 * The fleet scoreboard's app-global store (session 61): the composed
 * four-pillar rows + the recording it came from. Two load paths, one truth:
 *  - LIVE: a recording document (the runner's output, or an in-app capture
 *    export) + a loopback local fork → compose fresh from onchain state + the
 *    recording's committed receipts (the observer channel — the win law's
 *    "all from onchain state");
 *  - SNAPSHOT: a recording carrying score snapshots renders those offline
 *    (honest fallback — no RPC, no invented numbers).
 * The WIDGET renders this store; the 62 replay flagship re-feeds the event
 * stream and re-composes the same way.
 */

export interface FleetState {
  rows: FleetScoreRow[];
  ranked: FleetScoreRow[];
  source: "live" | "snapshot";
  recording: Recording | null;
  error: string | null;
  errors: string[];
  loadedAt: number | null;
  composing: boolean;
}

let state: FleetState = { rows: [], ranked: [], source: "snapshot", recording: null, error: null, errors: [], loadedAt: null, composing: false };
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function fleetState(): FleetState {
  return state;
}

function setFleet(next: Partial<FleetState>): void {
  state = { ...state, ...next };
  notify();
}

/** surface a load-time error (the widget's file-read catch path) */
export function setFleetError(error: string): void {
  setFleet({ error, composing: false });
}

/** reset to the honest empty board (no fleet state — the widget's idle copy) */
export function clearFleet(): void {
  setFleet({ rows: [], ranked: [], source: "snapshot", recording: null, error: null, errors: [], loadedAt: null, composing: false });
}

/**
 * Load a fleet recording (text) and compose the scoreboard. `rpcUrl` is the
 * app's ACTIVE RPC — live composition runs only on a loopback local fork
 * (the §8 composite rule); anywhere else the recording's own score
 * snapshots render, with an honest note when there are none.
 */
export async function loadFleetRecording(text: string, rpcUrl: string): Promise<void> {
  setFleet({ composing: true, error: null });
  let rec: Recording;
  try {
    rec = parseRecording(text);
  } catch (e) {
    setFleet({ composing: false, error: e instanceof Error ? e.message : String(e) });
    return;
  }
  if (rec.roster.length === 0) {
    setFleet({ recording: rec, composing: false, error: "the recording carries no roster" });
    return;
  }
  if (!simLayerActive(rpcUrl)) {
    // live RPC (or sim off): never read the fleet from a live endpoint —
    // the recording's snapshots are the only honest source
    const rows = rowsFromScoreSnapshots(rec);
    setFleet({
      recording: rec,
      composing: false,
      rows,
      ranked: rankFleetRows(rows),
      source: "snapshot",
      loadedAt: Date.now(),
      error: rows.length === 0 ? "no score snapshots in the recording — live composition needs a loopback local fork (the sim gate)" : null,
      errors: [],
    });
    return;
  }
  try {
    const composed = await loadFleetStates(makeClient(rpcUrl), rec.roster, rec);
    setFleet({
      recording: rec,
      composing: false,
      rows: composed.rows,
      ranked: composed.ranked,
      source: "live",
      loadedAt: Date.now(),
      error: null,
      errors: composed.errors,
    });
  } catch (e) {
    // compose failed (dead fork?): fall back to snapshots honestly
    const rows = rowsFromScoreSnapshots(rec);
    setFleet({
      recording: rec,
      composing: false,
      rows,
      ranked: rankFleetRows(rows),
      source: "snapshot",
      loadedAt: Date.now(),
      error: `live compose failed (${e instanceof Error ? e.message : String(e)})${rows.length > 0 ? " — rendering the recording's own snapshots" : ""}`,
      errors: [],
    });
  }
}

/** re-compose against the active RPC (the observer's live refresh during a run) */
export async function refreshFleet(rpcUrl: string): Promise<void> {
  const rec = state.recording;
  if (rec === null) {
    setFleet({ error: "no recording loaded — load a fleet recording first" });
    return;
  }
  await loadFleetRecording(JSON.stringify(rec), rpcUrl);
}

/** rows as JSON documents (the SYS export / snapshot attach shape) */
export function fleetRowsJson(): ReturnType<typeof scoreRowToJson>[] {
  return state.rows.map(scoreRowToJson);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const subscribeFleet = subscribe;

export function useFleet(): FleetState {
  return useSyncExternalStore(subscribe, fleetState, fleetState);
}
