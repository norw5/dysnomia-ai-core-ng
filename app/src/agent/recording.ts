import type { RunEvent } from "@/agent/graph";

/**
 * The fleet recording format (session 61, the multi-agent arc): the
 * serialized RunEvent stream a fleet run leaves behind — the INPUT the 62
 * in-app replay flagship re-feeds through the deck's auto-surface
 * machinery, and the substrate the ffmpeg grid renders from.
 *
 * FORMAT LAWS (the owner round's "recording = BOTH" decision):
 * - VERSIONED envelope (`v`) — a parser that does not know the version
 *   refuses honestly, never guesses;
 * - APPEND-ONLY events: the array order IS the capture order, the index `i`
 *   of each event is its position (seekable by index — replay slices
 *   `events[0..k]` to seek);
 * - every event carries its ACTOR (the roster agent's name) — multi-agent
 *   streams interleave but stay attributable;
 * - tool results ride VERBATIM as captured (already capped at the tool
 *   layer, §7.7) — they are replay DATA; the §7.4 fence applies at RENDER
 *   time like it does live (inert text, never directives);
 * - score snapshots attach keyed by the event index they were composed at
 *   (live during a run, from the recording afterwards);
 * - NO secrets: the manifest's ephemeral fork keys never enter a recording
 *   (the roster rows carry addresses/vessels only).
 */

export interface RecordingRosterRow {
  name: string;
  address: string;
  lau: string | null;
  yue: string | null;
  vessel: string;
}

export interface RecordedEvent {
  /** position in the events array — the seek key (monotone from 0) */
  i: number;
  /** the roster agent that produced the event ("operator" for in-app captures) */
  agent: string;
  /** 1-based turn number within the run (per agent runs are `runAgent` turns) */
  turn: number;
  t: number;
  e: RunEvent;
}

export interface RecordingScoreRow {
  agent: string;
  vessel: string;
  /** pillar points as decimal strings (bigint-safe over JSON) */
  economic: string;
  territorial: string;
  diplomatic: string;
  social: string;
  total: string;
}

export interface RecordingScoreSnapshot {
  /** the event index this snapshot was composed after (seek key) */
  atEvent: number;
  t: number;
  rows: RecordingScoreRow[];
}

export interface Recording {
  v: 1;
  kind: "fleet-run";
  started: string;
  /** the fork/RPC the run played against (observer live-compose + honesty) */
  rpc: string;
  forkBlock: number | null;
  roster: RecordingRosterRow[];
  /** append-only; index == position */
  events: RecordedEvent[];
  /** composed at capture time, keyed by event index */
  scores: RecordingScoreSnapshot[];
  finished: string | null;
}

export const RECORDING_VERSION = 1;

/** the mutable accumulator the writer (runner or in-app capture) holds */
export class RecordingWriter {
  private readonly rec: Recording;

  constructor(init: {
    rpc: string;
    forkBlock: number | null;
    roster: RecordingRosterRow[];
    started?: string;
  }) {
    this.rec = {
      v: RECORDING_VERSION,
      kind: "fleet-run",
      started: init.started ?? new Date().toISOString(),
      rpc: init.rpc,
      forkBlock: init.forkBlock,
      roster: init.roster,
      events: [],
      scores: [],
      finished: null,
    };
  }

  append(agent: string, turn: number, e: RunEvent): RecordedEvent {
    const ev: RecordedEvent = { i: this.rec.events.length, agent, turn, t: Date.now(), e };
    this.rec.events.push(ev);
    return ev;
  }

  snapshotScore(rows: RecordingScoreRow[]): RecordingScoreSnapshot {
    const snap: RecordingScoreSnapshot = { atEvent: this.rec.events.length - 1, t: Date.now(), rows };
    this.rec.scores.push(snap);
    return snap;
  }

  finish(): Recording {
    this.rec.finished = new Date().toISOString();
    return this.rec;
  }

  /** read-only view (the accumulator keeps ownership) */
  current(): Readonly<Recording> {
    return this.rec;
  }
}

export function serializeRecording(rec: Readonly<Recording>): string {
  return JSON.stringify(rec);
}

export class RecordingParseError extends Error {
  constructor(reason: string) {
    super(`not a fleet recording: ${reason}`);
    this.name = "RecordingParseError";
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse + validate a recording document. Refuses honestly on: wrong shape,
 * unknown version, non-monotone event indices, score snapshots pointing
 * past the stream. Never throws raw JSON errors at the caller.
 */
export function parseRecording(text: string): Recording {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new RecordingParseError("invalid JSON");
  }
  if (!isObj(doc)) throw new RecordingParseError("not an object");
  if (doc["v"] !== RECORDING_VERSION) throw new RecordingParseError(`version ${String(doc["v"])} (supported: ${RECORDING_VERSION})`);
  if (doc["kind"] !== "fleet-run") throw new RecordingParseError(`kind ${String(doc["kind"])}`);
  for (const key of ["started", "rpc", "roster", "events", "scores"] as const) {
    if (doc[key] === undefined) throw new RecordingParseError(`missing ${key}`);
  }
  if (!Array.isArray(doc["roster"]) || !Array.isArray(doc["events"]) || !Array.isArray(doc["scores"])) {
    throw new RecordingParseError("roster/events/scores must be arrays");
  }
  const events = doc["events"] as unknown[];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!isObj(ev) || !isObj(ev["e"])) throw new RecordingParseError(`event ${i} malformed`);
    if (ev["i"] !== i) throw new RecordingParseError(`event ${i} carries index ${String(ev["i"])} — the stream must be append-only`);
    if (typeof ev["agent"] !== "string" || typeof ev["t"] !== "number") throw new RecordingParseError(`event ${i} missing agent/t`);
  }
  const scores = doc["scores"] as unknown[];
  for (const s of scores) {
    if (!isObj(s) || typeof s["atEvent"] !== "number" || !Array.isArray(s["rows"])) {
      throw new RecordingParseError("score snapshot malformed");
    }
    if (s["atEvent"] < 0 || s["atEvent"] >= events.length) {
      throw new RecordingParseError(`score snapshot at ${String(s["atEvent"])} points past the stream (${events.length} events)`);
    }
  }
  return {
    v: RECORDING_VERSION,
    kind: "fleet-run",
    started: String(doc["started"]),
    rpc: String(doc["rpc"]),
    forkBlock: typeof doc["forkBlock"] === "number" ? doc["forkBlock"] : null,
    roster: (doc["roster"] as unknown[]).map((r) => {
      if (!isObj(r) || typeof r["name"] !== "string" || typeof r["address"] !== "string") {
        throw new RecordingParseError("roster row malformed");
      }
      return {
        name: r["name"] as string,
        address: r["address"] as string,
        lau: typeof r["lau"] === "string" ? (r["lau"] as string) : null,
        yue: typeof r["yue"] === "string" ? (r["yue"] as string) : null,
        vessel: typeof r["vessel"] === "string" ? (r["vessel"] as string) : "atropa",
      };
    }),
    events: events as RecordedEvent[],
    scores: scores as RecordingScoreSnapshot[],
    finished: typeof doc["finished"] === "string" ? (doc["finished"] as string) : null,
  };
}

/** seek = the prefix slice [0..index] inclusive — replay's scrub primitive */
export function seekRecording(rec: Recording, index: number): RecordedEvent[] {
  if (index < 0) return [];
  return rec.events.slice(0, Math.min(index + 1, rec.events.length));
}

/** the latest score snapshot at-or-before an event index (null = none yet) */
export function scoreAt(rec: Recording, index: number): RecordingScoreSnapshot | null {
  let best: RecordingScoreSnapshot | null = null;
  for (const s of rec.scores) {
    if (s.atEvent <= index) best = s;
    else break;
  }
  return best;
}

/**
 * Fold a recording prefix into the deck's auto-surface inputs — the exact
 * mapping `wireDeckToRunEvents` applies live (deckStore.widgetFromRunEvent
 * stays the ONE authority; this just re-emits the captured events in order
 * so 62's replay reuses the store untouched).
 */
export function replayEventSlice(rec: Recording, index: number): RunEvent[] {
  return seekRecording(rec, index).map((ev) => ev.e);
}
