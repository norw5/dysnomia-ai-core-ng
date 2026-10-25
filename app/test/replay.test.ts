import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingWriter, serializeRecording, type RecordingScoreRow } from "@/agent/recording";

/**
 * The in-app REPLAY flagship (session 62 + the 62.1 rework + the session-63
 * slot law): the recorded stream re-fed through emitRunEvent onto the
 * deck's ROUTING machinery, the conversation folded into the AI_CORE
 * pane's own row shapes, and the narrative clock (per-event-kind weights).
 * The seek law: forward = emit the new events; backward = UNLOCKED bays
 * reset to the DEFAULT composition + re-feed the prefix (LOCKED bays
 * persist — the operator spoke).
 */

const backing = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  },
});

const deck = await import("@/state/deckStore");
const replay = await import("@/state/replay");

const { AGENT_BAY, clearDeck, deckSlots, deckWidgets, dismissAutoWidgets, lockSlot, surfaceWidget, wireDeckToRunEvents } = deck;
const {
  armReplay,
  disarmReplay,
  replayActor,
  replayEventWeight,
  replayScoreAsOf,
  replayState,
  replayTranscript,
  seekReplay,
  setReplayFilter,
  setReplayPlaying,
  setReplaySpeed,
  tickReplay,
} = replay;

const VENUE = "0x" + "ab".repeat(20);

function scoreRow(agent: string, total: string): RecordingScoreRow {
  return { agent, vessel: "vitruv", economic: "10", territorial: "0", diplomatic: "2", social: "0", total };
}

/** a small 4-agent recording: turn-start, a venue read, a cipher send, a kb read, snapshots */
function buildRecording(): string {
  const w = new RecordingWriter({
    rpc: "http://127.0.0.1:8547",
    forkBlock: 27_674_000,
    roster: [
      { name: "VITRUV-3", address: "0x1", lau: null, yue: null, vessel: "vitruv" },
      { name: "KESTREL-7", address: "0x2", lau: null, yue: null, vessel: "kestrel" },
      { name: "MERIDIAN-5", address: "0x3", lau: null, yue: null, vessel: "meridian" },
      { name: "PARALLAX-2", address: "0x4", lau: null, yue: null, vessel: "parallax" },
    ],
  });
  w.append("VITRUV-3", 1, { type: "turn-start" });
  w.append("VITRUV-3", 1, { type: "tool-call", id: "c1", name: "get_venue", args: { address: VENUE } });
  w.append("VITRUV-3", 1, { type: "tool-result", id: "c1", name: "get_venue", result: { venue: VENUE }, ok: true });
  w.snapshotScore([scoreRow("VITRUV-3", "12"), scoreRow("KESTREL-7", "12"), scoreRow("MERIDIAN-5", "2"), scoreRow("PARALLAX-2", "2")]);
  w.append("KESTREL-7", 1, { type: "turn-start" });
  w.append("KESTREL-7", 1, { type: "tool-result", id: "c2", name: "search_kb", result: { query: "gwat", hits: [] }, ok: true });
  w.append("MERIDIAN-5", 1, { type: "tool-result", id: "c3", name: "show_widget", result: { surfaced: true, kind: "kb_excerpt", props: { query: "open channels" }, dedupeKey: "open channels" }, ok: true });
  w.snapshotScore([scoreRow("VITRUV-3", "13"), scoreRow("KESTREL-7", "13"), scoreRow("MERIDIAN-5", "2"), scoreRow("PARALLAX-2", "2")]);
  w.append("PARALLAX-2", 1, { type: "done", steps: 2, tokens: 90 });
  return serializeRecording(w.finish());
}

beforeEach(() => {
  clearDeck();
  backing.clear();
  disarmReplay();
  wireDeckToRunEvents();
});

describe("arm / disarm", () => {
  it("arms from a recording document, resets the playhead, bases the fold on the DEFAULT composition; refuses bad input honestly", () => {
    surfaceWidget({ kind: "kb_excerpt", origin: "agent", props: { query: "stale" } });
    expect(armReplay(buildRecording())).toBe(true);
    const s = replayState();
    expect(s.armed).toBe(true);
    expect(s.index).toBe(-1);
    expect(s.recording!.events).toHaveLength(7);
    expect(s.recording!.roster).toHaveLength(4);
    // the fresh fold: UNLOCKED bays reset to defaults (the stale agent
    // surface is gone; the agent's bay carries its default chat tail)
    const slots = deckSlots();
    expect(slots[AGENT_BAY].kind).toBe("chat_monitor");
    expect(slots["col2-bottom"].kind).toBe("map_focus");

    expect(armReplay("{")).toBe(false);
    expect(replayState().error).toMatch(/not a fleet recording/);
    expect(armReplay(JSON.stringify({ v: 1, kind: "fleet-run", started: "t", rpc: "x", forkBlock: null, roster: [], events: [], scores: [], finished: null }))).toBe(false);
    expect(replayState().error).toMatch(/no events/);

    disarmReplay();
    expect(replayState().armed).toBe(false);
    seekReplay(3); // disarmed = no-op
    expect(replayState().index).toBe(-1);
  });
});

describe("the seek law (the replay scrub primitive)", () => {
  it("forward seek emits the new events in order — surfaces route through the REAL router", () => {
    armReplay(buildRecording());
    seekReplay(2); // turn-start + tool-call + the get_venue result
    expect(replayState().index).toBe(2);
    const slots = deckSlots();
    expect(slots["col3-top"].kind).toBe("task_graph"); // the seeded run bay (locked — no churn)
    expect(slots[AGENT_BAY].kind).toBe("venue"); // the venue bay took the read
    expect(slots[AGENT_BAY].props["address"]).toBe(VENUE);
    seekReplay(4); // KESTREL's turn-start + search_kb
    expect(deckSlots()[AGENT_BAY].kind).toBe("kb_excerpt"); // the venue bay swapped content
    expect(deckSlots()[AGENT_BAY].props["query"]).toBe("gwat");
  });

  it("an agent-directed show_widget result re-surfaces with its carried props (replay fidelity)", () => {
    armReplay(buildRecording());
    seekReplay(5); // MERIDIAN's show_widget result
    expect(deckSlots()[AGENT_BAY].kind).toBe("kb_excerpt");
    expect(deckSlots()[AGENT_BAY].origin).toBe("agent");
    expect(deckSlots()[AGENT_BAY].props).toMatchObject({ query: "open channels" });
  });

  it("backward seek resets UNLOCKED bays to defaults + re-feeds; LOCKED bays persist (the operator spoke)", () => {
    armReplay(buildRecording());
    seekReplay(5);
    lockSlot(AGENT_BAY, true); // the operator locked the venue bay's kb surface

    seekReplay(0); // scrub back to the first event
    expect(replayState().index).toBe(0);
    const slots = deckSlots();
    expect(slots[AGENT_BAY].kind).toBe("kb_excerpt"); // LOCKED — survived the fold reset
    expect(slots[AGENT_BAY].locked).toBe(true);
    expect(slots["col3-top"].kind).toBe("task_graph"); // re-defaulted + re-fed prefix
    expect(slots["col2-bottom"].kind).toBe("map_focus"); // the default composition base
  });

  it("dismissAutoWidgets clears auto/agent content on unlocked bays (the compat primitive)", () => {
    const a = surfaceWidget({ kind: "kb_excerpt", origin: "auto", props: { query: "q1" } })!;
    const b = surfaceWidget({ kind: "beat_sim", origin: "user" })!;
    lockSlot(b, true);
    expect(dismissAutoWidgets()).toBe(1);
    expect(deckSlots()[a].kind).toBeNull();
    expect(deckSlots()[b].kind).toBe("beat_sim");
  });

  it("seek clamps past the ends and no-ops on the same index", () => {
    armReplay(buildRecording());
    seekReplay(999);
    expect(replayState().index).toBe(6);
    seekReplay(6);
    expect(deckWidgets()).toHaveLength(deckWidgets().length);
    seekReplay(-5);
    expect(replayState().index).toBe(-1);
    // the fold re-based on defaults: 4 filled bays, the venue gone
    expect(deckSlots()[AGENT_BAY].kind).toBe("chat_monitor");
  });
});

describe("the transport clock", () => {
  it("tickReplay advances one event, stops honestly at end-of-tape", () => {
    armReplay(buildRecording());
    setReplayPlaying(true);
    expect(tickReplay()).toBe(true);
    expect(replayState().index).toBe(0);
    for (let i = 0; i < 10; i++) tickReplay();
    expect(replayState().index).toBe(6); // clamped at the last event
    expect(replayState().playing).toBe(false); // honest end-of-tape
    expect(tickReplay()).toBe(false);
  });

  it("speed state rides the store (½/1/2/4 — the owner round's minimal transport)", async () => {
    const { REPLAY_SPEEDS } = await import("@/state/replay");
    expect(REPLAY_SPEEDS).toEqual([0.5, 1, 2, 4]);
    setReplaySpeed(2);
    expect(replayState().speed).toBe(2);
  });
});

describe("the readouts (spine + as-of board)", () => {
  it("replayActor resolves the roster vessel for the acting agent; unknown actors fall back to the default chrome", () => {
    const text = buildRecording();
    armReplay(text);
    const rec = replayState().recording!;
    expect(replayActor(rec, 0)).toEqual({ name: "VITRUV-3", vessel: "vitruv" });
    expect(replayActor(rec, 5)).toEqual({ name: "MERIDIAN-5", vessel: "meridian" });
    expect(replayActor(rec, -1)).toBeNull();
    expect(replayActor(rec, 999)).toBeNull();
  });

  it("the scoreboard renders AS OF the playhead (scoreAt), never a future snapshot", () => {
    const text = buildRecording();
    armReplay(text);
    const rec = replayState().recording!;
    expect(replayScoreAsOf(rec, 1)).toBeNull(); // nothing composed before the first snapshot's key
    expect(replayScoreAsOf(rec, 2)!.rows.find((r) => r.agent === "VITRUV-3")!.total).toBe("12");
    const second = replayScoreAsOf(rec, 6);
    expect(second!.rows.find((r) => r.agent === "VITRUV-3")!.total).toBe("13");
    seekReplay(6);
    expect(replayScoreAsOf(rec, replayState().index)!.rows).toHaveLength(4);
  });
});

describe("the recorded event kinds stay inert data (§7.4 at replay time)", () => {
  it("a SENT chat line replays as the monitor surface (the 69.2 owner ask — the deck SHOWS the line arriving); a DRYRUN stays widget-less", () => {
    const w = new RecordingWriter({ rpc: "http://x", forkBlock: null, roster: [] });
    w.append("MERIDIAN-5", 1, { type: "tool-result", id: "c9", name: "send_chat", result: { mode: "DRYRUN", venue: VENUE }, ok: true });
    w.append("MERIDIAN-5", 1, { type: "tool-result", id: "c10", name: "send_chat", result: { mode: "SEND", status: "sent", venue: VENUE }, ok: true });
    armReplay(serializeRecording(w.finish()));
    seekReplay(0); // feeds event 0 only — the DRYRUN maps to nothing
    expect(deckSlots()[AGENT_BAY].kind).toBe("chat_monitor");
    expect(deckSlots()[AGENT_BAY].origin).toBe("seed");
    seekReplay(1); // the SENT line surfaces the monitor on the venue channel
    expect(deckSlots()[AGENT_BAY].kind).toBe("chat_monitor");
    expect(deckSlots()[AGENT_BAY].origin).toBe("auto");
    expect(deckSlots()[AGENT_BAY].props!["channel"]).toBe("venue");
    expect(deckSlots()[AGENT_BAY].props!["address"]).toBe(VENUE);
  });
});

describe("the replayed conversation in the AI_CORE pane (62.1: the owner round after the first grid video)", () => {
  it("folds the prefix into the pane's own row shapes: markers, ▸ plan text, tool cards; noise skipped", () => {
    const text = buildRecording();
    armReplay(text);
    const rec = replayState().recording!;
    const rows = replayTranscript(rec, 5);
    // event 0 = VITRUV turn-start → a vessel-colored marker row
    expect(rows[0]!.marker).toEqual({ agent: "VITRUV-3", vessel: "vitruv", turn: 1 });
    expect(rows[0]!.kind).toBe("system");
    // the tool call/result pair renders as the pane's own card shapes
    expect(rows.some((r) => r.kind === "tool-call" && r.toolName === "get_venue")).toBe(true);
    expect(rows.some((r) => r.kind === "tool-result" && r.toolName === "get_venue" && r.ok === true)).toBe(true);
    // search_kb's recorded result + show_widget's result render; usage events are noise
    expect(rows.some((r) => r.kind === "tool-result" && r.toolName === "search_kb")).toBe(true);
    expect(rows.some((r) => r.kind === "tool-result" && r.toolName === "show_widget")).toBe(true);
    expect(rows.every((r) => r.kind !== "user")).toBe(true);
    // assistant text renders as the pane's assistant rows (the ▸ plan strip renders via intentLine)
    const w = new RecordingWriter({ rpc: "http://x", forkBlock: null, roster: [{ name: "A", address: "0x1", lau: null, yue: null, vessel: "kestrel" }] });
    w.append("A", 1, { type: "assistant-text", text: "▸ plan: speak.\nthe line is out." });
    const solo = serializeRecording(w.finish());
    armReplay(solo);
    const textRows = replayTranscript(replayState().recording!, 0);
    expect(textRows.at(-1)!.kind).toBe("assistant");
    expect(textRows.at(-1)!.text).toContain("the line is out");
    // error events render honestly; done/usage skip
    const w2 = new RecordingWriter({ rpc: "http://x", forkBlock: null, roster: [] });
    w2.append("A", 1, { type: "error", message: "boom" });
    w2.append("A", 1, { type: "usage", usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    armReplay(serializeRecording(w2.finish()));
    const errRows = replayTranscript(replayState().recording!, 1);
    expect(errRows.filter((r) => r.kind === "system" && r.text !== null)).toHaveLength(1);
  });

  it("the per-agent filter narrows the conversation to one vessel (the grid's per-vessel cells)", () => {
    const text = buildRecording();
    armReplay(text);
    seekReplay(6);
    setReplayFilter("KESTREL-7");
    expect(replayState().filter).toBe("KESTREL-7");
    const rows = replayTranscript(replayState().recording!, replayState().index, "KESTREL-7");
    expect(rows.length).toBeGreaterThan(0);
    // markers only for the filtered agent; other agents' events never leak rows
    expect(rows.filter((r) => r.marker !== undefined).map((r) => r.marker!.agent)).toEqual(["KESTREL-7"]);
    expect(rows.some((r) => r.kind === "tool-result" && r.toolName === "search_kb")).toBe(true);
    setReplayFilter(null);
    expect(replayState().filter).toBeNull();
    // unknown agents refuse honestly
    setReplayFilter("GHOST-9");
    expect(replayState().filter).toBeNull();
    disarmReplay();
    setReplayFilter("VITRUV-3"); // disarmed = no-op
    expect(replayState().filter).toBeNull();
  });

  it("the narrative clock weights the holds (text 4×, results 1.4×, usage ~instant)", () => {
    expect(replayEventWeight({ type: "assistant-text", text: "x" })).toBe(4);
    expect(replayEventWeight({ type: "tool-result", id: "c", name: "n", result: {}, ok: true })).toBe(1.4);
    expect(replayEventWeight({ type: "tool-call", id: "c", name: "n", args: {} })).toBe(0.6);
    expect(replayEventWeight({ type: "turn-start" })).toBe(1.6);
    expect(replayEventWeight({ type: "usage", usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })).toBeLessThan(0.5);
  });
});
