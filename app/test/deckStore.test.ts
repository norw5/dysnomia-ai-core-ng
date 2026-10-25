import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunEvent } from "@/agent/graph";

/**
 * The DECK store v2 (session-63 SLOT REDESIGN): the slot map (4 typed bays),
 * per-slot locks, ROUTING (designated → agent's bay → empty compatible →
 * journaled refusal), the one-venue law, the gentle onboarding→ledger
 * swap, persistence, the v1 clean-reseed migration, and the RunEvent →
 * routing mapping incl. the wired bus end-to-end.
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
const events = await import("@/agent/events");
// static (pre-resetModules) so the protection test shares deckStore's instance
const planStore = await import("@/state/planStore");

const {
  AGENT_BAY,
  MAP_BAY,
  SLOT_IDS,
  clearDeck,
  clearSlot,
  deckSlots,
  deckWidgets,
  dismissAutoWidgets,
  ensureFirstRunSeed,
  lockSlot,
  promoteLedgerIfComplete,
  resetDeckToDefault,
  resetUnlockedSlotsToDefaults,
  setDeckRefusalSink,
  slotSurface,
  surfaceWidget,
  widgetFromRunEvent,
  wireDeckToRunEvents,
} = deck;

const DEFAULT_KINDS = {
  "col2-top": "onboarding",
  "col2-bottom": "map_focus",
  "col3-top": "task_graph",
  "col3-bottom": "chat_monitor",
} as const;

beforeEach(() => {
  clearDeck();
  backing.clear();
  setDeckRefusalSink(null);
});

describe("the slot map + defaults", () => {
  it("fresh storage seeds the 4 default bays with their default locks (3 locked, the agent's bay free)", () => {
    expect(ensureFirstRunSeed()).toBe(true);
    const s = deckSlots();
    expect(s["col2-top"].kind).toBe("onboarding");
    expect(s["col2-bottom"].kind).toBe("map_focus");
    expect(s["col3-top"].kind).toBe("task_graph");
    expect(s["col3-bottom"].kind).toBe("chat_monitor");
    expect(s["col2-top"].locked).toBe(true);
    expect(s["col2-bottom"].locked).toBe(true);
    expect(s["col3-top"].locked).toBe(true);
    expect(s["col3-bottom"].locked).toBe(false); // the agent's bay
    for (const id of SLOT_IDS) expect(s[id].origin).toBe("seed");
  });

  it("seeding is ONCE per storage lifetime — an existing deck is never overridden", () => {
    ensureFirstRunSeed();
    clearDeck(); // persists the (now empty) doc — the KEY exists
    expect(ensureFirstRunSeed()).toBe(false);
    expect(deckWidgets()).toHaveLength(0);
  });

  it("the whole slot map persists and rehydrates (content + locks)", async () => {
    ensureFirstRunSeed();
    surfaceWidget({ kind: "kb_excerpt", props: { query: "q" }, origin: "agent" });
    lockSlot("col2-top", false);
    vi.resetModules();
    const redeck = await import("@/state/deckStore");
    const s = redeck.deckSlots();
    expect(s["col2-top"].kind).toBe("onboarding");
    expect(s["col2-top"].locked).toBe(false);
    expect(s[redeck.AGENT_BAY].kind).toBe("kb_excerpt");
    expect(s[redeck.AGENT_BAY].props).toEqual({ query: "q" });
    redeck.clearDeck();
    backing.clear();
  });

  it("the v1 deck migrates by CLEAN RESEED — the legacy key never resurrects", () => {
    backing.set("dys.deck.v1", JSON.stringify({ v: 1, widgets: [{ id: "x", kind: "venue", pinned: true }] }));
    vi.resetModules();
    return import("@/state/deckStore").then((redeck) => {
      const s = redeck.deckSlots();
      expect(s["col2-top"].kind).toBe("onboarding"); // the default composition
      expect(redeck.deckWidgets().every((w) => w.origin === "seed")).toBe(true);
      expect(backing.has("dys.deck.v1")).toBe(false); // dropped
      redeck.clearDeck();
      backing.clear();
    });
  });
});

describe("locks", () => {
  it("a locked bay is frozen — routing refreshes nothing, writes nothing", () => {
    clearDeck();
    expect(surfaceWidget({ kind: "venue", props: { address: "0xabc" }, origin: "auto" })).toBe(AGENT_BAY);
    lockSlot(AGENT_BAY, true);
    // the agent's bay is frozen, but free real estate still answers
    expect(surfaceWidget({ kind: "kb_excerpt", props: { query: "q" }, origin: "auto" })).toBe(MAP_BAY);
    expect(deckSlots()[AGENT_BAY].kind).toBe("venue"); // untouched
    // everything locked → honest refusal
    for (const id of SLOT_IDS) lockSlot(id, true);
    expect(surfaceWidget({ kind: "profile", props: { address: "0x1" }, origin: "auto" })).toBeNull();
    expect(deckSlots()[AGENT_BAY].kind).toBe("venue");
    lockSlot(AGENT_BAY, false);
    expect(surfaceWidget({ kind: "kb_excerpt", props: { query: "q2" }, origin: "auto" })).toBe(AGENT_BAY);
  });

  it("clearSlot empties any bay (the operator's ✕); slotSurface places fitting kinds only", () => {
    ensureFirstRunSeed();
    clearSlot("col2-top");
    expect(deckSlots()["col2-top"].kind).toBeNull();
    slotSurface("col2-top", "kb_excerpt"); // TALL kind in a SHORT bay — refused silently by fits
    expect(deckSlots()["col2-top"].kind).toBeNull();
    slotSurface("col2-top", "beat_sim", { waat: "77" });
    expect(deckSlots()["col2-top"].kind).toBe("beat_sim");
    expect(deckSlots()["col2-top"].origin).toBe("user");
  });
});

describe("ROUTING (designated → agent's bay → empty compatible → refusal)", () => {
  it("a same-kind surface lands in / refreshes its designated bay (never clones)", () => {
    clearDeck();
    expect(surfaceWidget({ kind: "task_graph", origin: "auto" })).toBe("col3-top");
    expect(surfaceWidget({ kind: "task_graph", origin: "auto" })).toBe("col3-top");
    expect(deckWidgets().filter((w) => w.kind === "task_graph")).toHaveLength(1);
  });

  it("short kinds take an empty designated short bay; chat_monitor holds the agent's bay and gets swapped", () => {
    clearDeck();
    expect(surfaceWidget({ kind: "chat_monitor", origin: "user" })).toBe(AGENT_BAY);
    const slot = surfaceWidget({ kind: "beat_sim", origin: "auto", props: { waat: "77" } });
    expect(slot).toBe("col3-top"); // designated [col3-top, col2-top] — col3-top empty
    // a tall kind with both designated paths busy swaps the agent's bay
    expect(surfaceWidget({ kind: "kb_excerpt", origin: "auto" })).toBe(AGENT_BAY);
    expect(deckSlots()[AGENT_BAY].kind).toBe("kb_excerpt"); // chat_monitor swapped out
  });

  it("kb_excerpt takes a tall bay: the agent's bay by default, an EMPTY tall bay when the agent's is locked", () => {
    clearDeck();
    expect(surfaceWidget({ kind: "kb_excerpt", origin: "auto" })).toBe(AGENT_BAY);
    clearSlot(AGENT_BAY);
    lockSlot(AGENT_BAY, true);
    // designated [agent, col2-bottom]: agent locked; col2-bottom EMPTY → free real estate
    expect(surfaceWidget({ kind: "kb_excerpt", origin: "auto" })).toBe(MAP_BAY);
  });

  it("an honest JOURNALED refusal when every path is locked (the sink sees it)", () => {
    clearDeck();
    for (const id of SLOT_IDS) lockSlot(id, true);
    const lines: string[] = [];
    setDeckRefusalSink((line) => lines.push(line));
    expect(surfaceWidget({ kind: "kb_excerpt", origin: "auto" })).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("deck routing refused: kb_excerpt");
  });

  it("a LIVE plan protects its bay — step results refuse rather than churn the checklist", () => {
    clearDeck();
    surfaceWidget({ kind: "plan", origin: "auto" }); // propose_plan routing
    lockSlot(MAP_BAY, true); // the seeded default state: no free real estate
    const proposed = planStore.proposePlan("test goal", [{ tool: "search_kb", args: { query: "x" }, note: "read" }]);
    expect(proposed.plan).not.toBeNull();
    const lines: string[] = [];
    setDeckRefusalSink((line) => lines.push(line));
    // the run's own step result may not displace the checklist
    expect(surfaceWidget({ kind: "kb_excerpt", origin: "auto" })).toBeNull();
    expect(lines[0]).toContain("live plan");
    expect(deckSlots()[AGENT_BAY].kind).toBe("plan");
    // terminal lifts the protection
    planStore.planFinished(proposed.plan!.id, "done", null);
    lockSlot(MAP_BAY, false);
    expect(surfaceWidget({ kind: "kb_excerpt", origin: "auto" })).toBe(AGENT_BAY);
  });

  it("the venue bay: venue-family surfaces SWAP content (chat_monitor initially); the ONE-VENUE law", () => {
    clearDeck();
    surfaceWidget({ kind: "chat_monitor", origin: "user" });
    expect(surfaceWidget({ kind: "venue", props: { address: "0xaaa" }, origin: "auto" })).toBe(AGENT_BAY);
    expect(deckSlots()[AGENT_BAY].kind).toBe("venue");
    // a NEW venue swaps the bay's content — exactly one venue widget exists
    expect(surfaceWidget({ kind: "venue", props: { address: "0xbbb" }, origin: "auto" })).toBe(AGENT_BAY);
    expect(deckSlots()[AGENT_BAY].props["address"]).toBe("0xbbb");
    // the operator's venue elsewhere: a routed venue swaps THAT slot (still one)
    slotSurface(MAP_BAY, "venue", { address: "0xccc" });
    expect(deckSlots()[MAP_BAY].props["address"]).toBe("0xccc");
    expect(surfaceWidget({ kind: "venue", props: { address: "0xddd" }, origin: "auto" })).toBe(MAP_BAY);
    expect(deckWidgets().filter((w) => w.kind === "venue")).toHaveLength(1);
    // a LOCKED venue elsewhere is THE venue — new selections refuse honestly
    lockSlot(MAP_BAY, true);
    const lines: string[] = [];
    setDeckRefusalSink((line) => lines.push(line));
    expect(surfaceWidget({ kind: "venue", props: { address: "0xeee" }, origin: "auto" })).toBeNull();
    expect(lines[0]).toContain("locked venue bay keeps its venue");
  });
});

describe("the GENTLE swap (onboarding → yuan_ledger)", () => {
  it("promotes ONLY the seeded onboarding widget in col2-top", () => {
    ensureFirstRunSeed();
    expect(promoteLedgerIfComplete()).toBe(true);
    expect(deckSlots()["col2-top"].kind).toBe("yuan_ledger");
    expect(deckSlots()["col2-top"].origin).toBe("seed");
    expect(promoteLedgerIfComplete()).toBe(false); // already the ledger
  });

  it("never stomps an operator choice in that bay", () => {
    clearDeck();
    slotSurface("col2-top", "onboarding");
    expect(promoteLedgerIfComplete()).toBe(false); // origin user — left alone
    expect(deckSlots()["col2-top"].kind).toBe("onboarding");
  });
});

describe("reset + the replay fold primitive", () => {
  it("resetDeckToDefault fully reseeds all four bays + default locks", () => {
    clearDeck();
    surfaceWidget({ kind: "kb_excerpt", origin: "agent" });
    lockSlot("col2-top", false);
    const r = resetDeckToDefault();
    expect(r.seeded).toEqual([...SLOT_IDS]);
    const s = deckSlots();
    for (const id of SLOT_IDS) {
      expect(s[id].kind).toBe(DEFAULT_KINDS[id]);
      expect(s[id].origin).toBe("seed");
    }
    expect(s[AGENT_BAY].locked).toBe(false);
  });

  it("resetUnlockedSlotsToDefaults: unlocked bays go back to defaults; locked bays persist (the operator spoke)", () => {
    ensureFirstRunSeed();
    surfaceWidget({ kind: "venue", props: { address: "0xabc" }, origin: "auto" }); // agent bay
    lockSlot("col2-top", true); // stays onboarding either way (default)
    clearSlot("col3-top");
    lockSlot("col3-top", false); // emptied AND unlocked — the fold's to-reset set
    slotSurface("col2-bottom", "venue", { address: "0xdef" });
    lockSlot("col2-bottom", true); // the operator locked a NON-default map bay
    const reset = resetUnlockedSlotsToDefaults();
    expect(reset).toContain("col3-top");
    expect(reset).toContain(AGENT_BAY);
    expect(reset).not.toContain("col2-bottom");
    const s = deckSlots();
    expect(s["col3-top"].kind).toBe("task_graph"); // re-defaulted
    expect(s[AGENT_BAY].kind).toBe("chat_monitor"); // re-defaulted
    expect(s["col2-bottom"].kind).toBe("venue"); // locked — untouched
  });
});

describe("RunEvent → routing mapping (path a)", () => {
  const okResult = (name: string, r: Record<string, unknown>): RunEvent => ({ type: "tool-result", id: "c1", name, result: r, ok: true });

  it("turn-start surfaces the task-graph checklist (routed to its bay)", () => {
    expect(widgetFromRunEvent({ type: "turn-start" })?.kind).toBe("task_graph");
  });

  it("session-75: the streaming text delta surfaces NOTHING (whole-message only)", () => {
    // the deck fold tolerates the new event kind by ignoring it — the pane's
    // live partial lane is the only consumer of deltas
    expect(widgetFromRunEvent({ type: "assistant-text-delta", text: "frag" })).toBeNull();
  });

  it("get_venue → venue widget; get_lau → profile", () => {
    const v = widgetFromRunEvent(okResult("get_venue", { venue: "0xAbC" }))!;
    expect(v.kind).toBe("venue");
    expect(v.props!["address"]).toBe("0xAbC");
    const p = widgetFromRunEvent(okResult("get_lau", { entity: "0xdE0" }))!;
    expect(p.kind).toBe("profile");
  });

  it("venue-family tools all route the venue kind (settle/take/desk/SIM verbs/create)", () => {
    for (const name of [
      "settle_venue",
      "take_venue",
      "purchase_affection",
      "redeem_affection",
      "exchange_hong",
      "exchange_hung",
      "world_code",
      "spawn_gwat",
      "create_venue",
    ]) {
      const v = widgetFromRunEvent(okResult(name, { venue: "0xAbC", mode: "SEND" }))!;
      expect(v.kind, name).toBe("venue");
    }
    expect(widgetFromRunEvent(okResult("create_venue", { mode: "DRYRUN" }))).toBeNull(); // no address yet
  });

  it("encrypt_note AND decrypt_note NEVER map to a widget (the §61 owner round)", () => {
    expect(widgetFromRunEvent(okResult("encrypt_note", { index: "4242", mode: "SEND" }))).toBeNull();
    expect(widgetFromRunEvent(okResult("decrypt_note", { plaintext: "hi", mode: "SEND" }))).toBeNull();
  });

  it("chat SENDS surface the chat monitor on the right channel (69.2): dss_snipe → world, send_chat/send_world_chat → the venue; DRYRUNs surface nothing", () => {
    const w = widgetFromRunEvent(okResult("dss_snipe", { mode: "SEND", status: "sent", dss: "0x1" }))!;
    expect(w.kind).toBe("chat_monitor");
    expect(w.props!["channel"]).toBe("world");
    expect(widgetFromRunEvent(okResult("dss_snipe", { mode: "DRYRUN" }))).toBeNull();
    expect(widgetFromRunEvent(okResult("dss_snipe", { mode: "SEND", status: "approve leg did not land" }))).toBeNull();
    const v = widgetFromRunEvent(okResult("send_chat", { mode: "SEND", status: "sent", venue: "0xAbC" }))!;
    expect(v.kind).toBe("chat_monitor");
    expect(v.props!["channel"]).toBe("venue");
    expect(v.props!["address"]).toBe("0xAbC");
    expect(widgetFromRunEvent(okResult("send_world_chat", { mode: "DRYRUN", venue: "0xAbC" }))).toBeNull();
    expect(widgetFromRunEvent(okResult("send_chat", { mode: "SEND", status: "sent" }))).toBeNull(); // no venue to point at
  });

  it("run_beat → beat_sim carrying the envelope; search_kb/explain → kb_excerpt", () => {
    const b = widgetFromRunEvent(okResult("run_beat", { mode: "DRYRUN", waat: "77", simOk: true }))!;
    expect(b.kind).toBe("beat_sim");
    expect((b.props!["envelope"] as Record<string, unknown>)["simOk"]).toBe(true);
    expect(widgetFromRunEvent(okResult("search_kb", { query: "gas" }))?.kind).toBe("kb_excerpt");
    expect(widgetFromRunEvent(okResult("explain", { topic: "ladder" }))?.kind).toBe("kb_excerpt");
  });

  it("propose_plan → the plan kind; failed results and unmapped tools surface nothing", () => {
    expect(widgetFromRunEvent(okResult("propose_plan", { planId: "p1" }))?.kind).toBe("plan");
    const failed: RunEvent = { type: "tool-result", id: "c1", name: "get_venue", result: { error: "x" }, ok: false };
    expect(widgetFromRunEvent(failed)).toBeNull();
    expect(widgetFromRunEvent(okResult("get_state", { account: "0x1" }))).toBeNull();
    expect(widgetFromRunEvent({ type: "assistant-text", text: "hi" })).toBeNull();
  });

  it("show_widget results carry their slot (63) — and pre-63 recordings (kind/props only) still re-surface", () => {
    const withSlot = widgetFromRunEvent(okResult("show_widget", { surfaced: true, slot: "col2-bottom", kind: "kb_excerpt", props: { query: "q" } }))!;
    expect(withSlot.kind).toBe("kb_excerpt");
    expect(withSlot.slot).toBe("col2-bottom");
    const legacy = widgetFromRunEvent(okResult("show_widget", { surfaced: true, kind: "kb_excerpt", props: { query: "old" }, dedupeKey: "old" }))!;
    expect(legacy.kind).toBe("kb_excerpt");
    expect(legacy.slot).toBeUndefined(); // re-routes through the router
    expect(widgetFromRunEvent(okResult("show_widget", { surfaced: true, kind: "snapshot", props: {} }))).toBeNull(); // dead kind
  });

  it("autoSurfaceFromRunEvent drives the store; the wired bus makes it live", () => {
    clearDeck();
    const unwire = wireDeckToRunEvents();
    events.emitRunEvent({ type: "tool-result", id: "c1", name: "search_kb", result: { query: "beat gas" }, ok: true });
    expect(deckSlots()[AGENT_BAY].kind).toBe("kb_excerpt");
    unwire();
    events.emitRunEvent({ type: "turn-start" });
    expect(deckSlots()["col3-top"].kind).toBeNull(); // no events after unwire
  });

  it("dismissAutoWidgets clears auto/agent content on unlocked bays (compat primitive)", () => {
    clearDeck();
    surfaceWidget({ kind: "kb_excerpt", origin: "auto" });
    surfaceWidget({ kind: "beat_sim", origin: "user" });
    expect(dismissAutoWidgets()).toBe(1);
    expect(deckSlots()[AGENT_BAY].kind).toBeNull();
    expect(deckWidgets()).toHaveLength(1); // the user's surface stays
  });
});
