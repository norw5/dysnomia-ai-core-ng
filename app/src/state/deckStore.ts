import { useCallback, useSyncExternalStore } from "react";
import type { RunEvent } from "@/agent/graph";
import { subscribeRunEvents } from "@/agent/events";
import { currentPlan } from "@/state/planStore";

/**
 * The DECK store, VERSION 2 (session-63, the owner's SLOT REDESIGN round):
 * a SEMI-FIXED instrument panel with typed bays — the auto-flow grid is
 * gone. Column 1 is the identity CHROME (IdentityPane, not slots); columns
 * 2 + 3 each carry a SHORT top bay + a TALL bottom bay:
 *
 *   col2-top    (short) onboarding → yuan_ledger (the GENTLE swap)
 *   col2-bottom (tall)  map_focus  — the MAP bay
 *   col3-top    (short) task_graph
 *   col3-bottom (tall)  chat_monitor (initially) — the AGENT's bay AND the
 *                       VENUE bay: venue-family results + current-venue
 *                       selections SWAP its content (the one-venue law)
 *
 * SLOT CLASSES, not per-slot kinds: kinds declare short|tall; a tall bay
 * hosts ANY kind (room to spare), a short bay hosts short kinds only. The
 * per-slot PICKER offers only fitting kinds; the pin/lock toggle is
 * PER SLOT (a locked bay is frozen — routing never writes it).
 *
 * AUTO-SURFACING IS ROUTING: each tool-result kind maps to a designated
 * bay; placement order = the kind's designated bay → the agent's bay
 * (col3-bottom, swaps anything when unlocked) → any EMPTY compatible slot
 * (free real estate, destroys nothing) → an honest JOURNALED refusal (the
 * operator sees it in SYSTEM_LOGS via the refusal sink). Eviction-by-age
 * and MAX_WIDGETS are dead.
 *
 * MIGRATION: `dys.deck.v1` migrates by CLEAN RESEED — slot semantics do
 * not map 1:1 and the deck is cheap to rebuild. The whole v2 slot map
 * (content + locks) persists.
 */

export type WidgetKind =
  | "onboarding"
  | "yuan_ledger"
  | "venue"
  | "profile"
  | "beat_sim"
  | "chat_monitor"
  | "kb_excerpt"
  | "task_graph"
  | "map_focus"
  | "plan";

export const WIDGET_KINDS: WidgetKind[] = [
  "onboarding",
  "yuan_ledger",
  "venue",
  "profile",
  "beat_sim",
  "chat_monitor",
  "kb_excerpt",
  "task_graph",
  "map_focus",
  "plan",
];

export type SlotId = "col2-top" | "col2-bottom" | "col3-top" | "col3-bottom";

export const SLOT_IDS: SlotId[] = ["col2-top", "col2-bottom", "col3-top", "col3-bottom"];

export type SlotClass = "short" | "tall";

export const SLOT_CLASS: Record<SlotId, SlotClass> = {
  "col2-top": "short",
  "col2-bottom": "tall",
  "col3-top": "short",
  "col3-bottom": "tall",
};

/** the AGENT's bay (its exclusive write-right) — also the VENUE bay */
export const AGENT_BAY: SlotId = "col3-bottom";
/** the venue-family's designated bay (col3-bottom carries both roles) */
export const VENUE_BAY: SlotId = "col3-bottom";
/** focus_map "ensures" this bay (map_focus's designated home) */
export const MAP_BAY: SlotId = "col2-bottom";

export const KIND_CLASS: Record<WidgetKind, SlotClass> = {
  onboarding: "short",
  yuan_ledger: "short",
  task_graph: "short",
  beat_sim: "short",
  profile: "short",
  map_focus: "tall",
  venue: "tall",
  chat_monitor: "tall",
  kb_excerpt: "tall",
  plan: "tall",
};

/** a tall bay hosts any kind; a short bay hosts short kinds only */
export function kindFitsSlot(kind: WidgetKind, slot: SlotId): boolean {
  return SLOT_CLASS[slot] === "tall" || KIND_CLASS[kind] === "short";
}

/**
 * the ROUTING TABLE — each kind's designated bay, in order. A designated
 * slot is taken when EMPTY, when it holds the SAME kind (refresh in
 * place), or when a bay ROLE allows the swap (the venue bay takes
 * venue-family content; the map bay takes focus_map's ensure). Otherwise
 * placement falls through to the agent's bay.
 */
const DESIGNATED: Record<WidgetKind, readonly SlotId[]> = {
  onboarding: ["col2-top"],
  yuan_ledger: ["col2-top"],
  task_graph: ["col3-top"],
  map_focus: ["col2-bottom"],
  venue: [VENUE_BAY],
  chat_monitor: [AGENT_BAY],
  kb_excerpt: [AGENT_BAY, "col2-bottom"],
  beat_sim: ["col3-top", "col2-top"],
  profile: ["col3-top", "col2-top"],
  plan: [AGENT_BAY],
};

export interface DeckSlot {
  /** null = an EMPTY bay (the picker's "(empty)" state) */
  kind: WidgetKind | null;
  /** kind-specific plain-JSON props (persistable, loggable) */
  props: Record<string, unknown>;
  /** a locked bay is frozen: routing never writes it — the operator spoke */
  locked: boolean;
  origin: "auto" | "agent" | "user" | "seed";
  t: number;
}

export type SlotMap = Record<SlotId, DeckSlot>;

const KEY = "dys.deck.v2";
const LEGACY_KEY = "dys.deck.v1";

function emptySlot(): DeckSlot {
  return { kind: null, props: {}, locked: false, origin: "user", t: 0 };
}

let slots: SlotMap = load();
const listeners = new Set<() => void>();

function defaultSlot(kind: WidgetKind, locked: boolean): DeckSlot {
  return { kind, props: {}, locked, origin: "seed", t: 0 };
}

/** the DEFAULT COMPOSITION (session-63): the seeded first-run slot map */
export function defaultSlotMap(): SlotMap {
  return {
    "col2-top": defaultSlot("onboarding", true), // → yuan_ledger on completion (the gentle swap)
    "col2-bottom": defaultSlot("map_focus", true), // the MAP bay
    "col3-top": defaultSlot("task_graph", true),
    "col3-bottom": defaultSlot("chat_monitor", false), // the agent's bay — unlocked
  };
}

function load(): SlotMap {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) {
      // the v1 → v2 migration is a CLEAN RESEED (slot semantics don't map);
      // drop the legacy key so a downgrade never resurrects a stale deck
      try {
        window.localStorage.removeItem(LEGACY_KEY);
      } catch {
        /* best effort */
      }
      return defaultSlotMap();
    }
    const doc = JSON.parse(raw) as { slots?: unknown };
    const out = defaultSlotMap();
    if (typeof doc === "object" && doc !== null && typeof doc.slots === "object" && doc.slots !== null) {
      for (const id of SLOT_IDS) {
        const rec = (doc.slots as Record<string, unknown>)[id] as Partial<DeckSlot> | undefined;
        if (typeof rec !== "object" || rec === null) continue;
        out[id] = {
          kind: rec.kind === null || isWidgetKind(rec.kind) ? (rec.kind as WidgetKind | null) : null,
          props: typeof rec.props === "object" && rec.props !== null ? (rec.props as Record<string, unknown>) : {},
          locked: rec.locked === true,
          origin: rec.origin === "auto" || rec.origin === "agent" || rec.origin === "seed" ? rec.origin : "user",
          t: typeof rec.t === "number" ? rec.t : 0,
        };
      }
    }
    return out;
  } catch {
    return defaultSlotMap();
  }
}

function persist(): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 2, slots }));
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* storage unavailable */
  }
}

function isWidgetKind(v: unknown): v is WidgetKind {
  return typeof v === "string" && (WIDGET_KINDS as string[]).includes(v);
}

function isSlotId(v: unknown): v is SlotId {
  return typeof v === "string" && (SLOT_IDS as string[]).includes(v);
}

function notify(): void {
  for (const fn of listeners) fn();
}

export function deckSlots(): SlotMap {
  return slots;
}

/** the filled bays (count/list views) */
export function deckWidgets(): Array<DeckSlot & { slot: SlotId }> {
  return SLOT_IDS.map((id) => ({ ...slots[id], slot: id })).filter((s) => s.kind !== null);
}

// ---- THE REFUSAL SINK (routed surfaces that found no home) ----

let refusalSink: ((line: string, detail?: Record<string, unknown>) => void) | null = null;

/**
 * Wire the routing-refusal logger (App pipes it into the gate journal as
 * `agent.deck` events — the operator sees refusals in SYSTEM_LOGS).
 */
export function setDeckRefusalSink(fn: ((line: string, detail?: Record<string, unknown>) => void) | null): void {
  refusalSink = fn;
}

function refuse(kind: WidgetKind, reason: string): void {
  try {
    refusalSink?.(`deck routing refused: ${kind} — ${reason}`, { kind, reason });
  } catch {
    /* the sink must never break the deck */
  }
}

/**
 * A bay holding a NON-TERMINAL plan is PROTECTED (the design-time call for
 * the L1 checklist): the plan widget is a decision surface — the run's own
 * step results must not churn it out of its bay mid-approval/mid-run (the
 * task_graph bay carries the per-step spine). Routing treats a protected
 * bay like a locked one; the operator's picker/lock/clear bypass it.
 */
function bayProtected(id: SlotId): boolean {
  const s = slots[id];
  if (s.kind !== "plan") return false;
  const plan = currentPlan();
  return plan !== null && (plan.status === "proposed" || plan.status === "approved" || plan.status === "running");
}

/** routing writes require unlocked AND unprotected (same-kind refreshes pass) */
function bayWritable(id: SlotId, kind: WidgetKind): boolean {
  if (slots[id].locked) return false;
  if (bayProtected(id) && kind !== "plan") return false;
  return true;
}

// ---- placement ----

export interface SurfaceInput {
  kind: WidgetKind;
  props?: Record<string, unknown>;
  origin: "auto" | "agent" | "user" | "seed";
  /** an explicit target bay (the agent's rights are validated by the caller) */
  slot?: SlotId | undefined;
}

function writeSlot(id: SlotId, kind: WidgetKind, props: Record<string, unknown>, origin: DeckSlot["origin"], evictClones = false): void {
  slots = { ...slots, [id]: { kind, props, locked: slots[id].locked, origin, t: Date.now() } };
  // the ONE-VENUE law: exactly one venue widget at a time — a venue landing
  // anywhere clears the kind from every other bay. Routed surfaces evict
  // their kind's clones generally (one widget per kind per deck); picker
  // placements are the operator's and may coexist.
  if (kind === "venue" || evictClones) {
    for (const other of SLOT_IDS) {
      if (other !== id && slots[other].kind === kind && !(kind !== "venue" && slots[other].locked)) {
        slots = { ...slots, [other]: { ...emptySlot(), locked: slots[other].locked } };
      }
    }
  }
  persist();
  notify();
}

/**
 * ROUTE a surface onto the deck (the auto path + the agent's default
 * placement). Order: the kind's designated bay (empty / same-kind refresh
 * / role swap) → the agent's bay (swaps anything, unlocked only) → any
 * EMPTY compatible slot → honest journaled refusal. Returns the bay taken,
 * or null.
 */
export function surfaceWidget(input: SurfaceInput): SlotId | null {
  const { kind } = input;
  const props = input.props ?? {};
  if (input.slot !== undefined) {
    if (!isSlotId(input.slot)) return null;
    writeSlot(input.slot, kind, props, input.origin, true);
    return input.slot;
  }
  // the ONE-VENUE law comes FIRST: an UNLOCKED venue widget anywhere is THE
  // venue — a new selection swaps ITS content in place (wherever the
  // operator put it); a LOCKED one keeps its venue (the operator spoke)
  if (kind === "venue") {
    const holder = SLOT_IDS.find((id) => slots[id].kind === "venue");
    if (holder !== undefined) {
      if (!bayWritable(holder, kind)) {
        refuse(kind, slots[holder].locked ? "the locked venue bay keeps its venue (the operator spoke)" : "the venue bay is protected");
        return null;
      }
      writeSlot(holder, kind, props, input.origin, true);
      return holder;
    }
  }
  // 1. the designated bays, in order
  for (const id of DESIGNATED[kind]) {
    const cur = slots[id];
    if (!bayWritable(id, kind)) {
      // an unwritable bay already showing this kind IS the placement
      // (frozen, but correct — no churn, no fall-through to the agent's bay)
      if (cur.kind === kind) return id;
      continue;
    }
    if (
      cur.kind === null ||
      cur.kind === kind ||
      // the agent's bay swaps ANYTHING (it is the universal activity bay),
      // and the map bay takes focus_map's "ensure"
      id === AGENT_BAY ||
      (id === MAP_BAY && kind === "map_focus")
    ) {
      writeSlot(id, kind, props, input.origin, true);
      return id;
    }
  }
  // same-kind anywhere else: already showing → refresh in place when
  // writable, or accept the frozen placement when not (no churn)
  for (const id of SLOT_IDS) {
    if (slots[id].kind === kind) {
      if (!bayWritable(id, kind)) return id;
      writeSlot(id, kind, props, input.origin, true);
      return id;
    }
  }
  // 2. the agent's bay — swaps anything when writable
  if (bayWritable(AGENT_BAY, kind)) {
    writeSlot(AGENT_BAY, kind, props, input.origin, true);
    return AGENT_BAY;
  }
  // 3. free real estate: any EMPTY compatible slot destroys nothing
  for (const id of SLOT_IDS) {
    if (slots[id].kind === null && bayWritable(id, kind) && kindFitsSlot(kind, id)) {
      writeSlot(id, kind, props, input.origin, true);
      return id;
    }
  }
  refuse(kind, bayProtected(AGENT_BAY) ? "the agent's bay holds a live plan (protected) and the designated bays are locked" : "the designated bay and the agent's bay are locked");
  return null;
}

/** the operator's picker placement (any fitting kind; venue keeps one-venue) */
export function slotSurface(slot: SlotId, kind: WidgetKind | null, props: Record<string, unknown> = {}): void {
  if (kind !== null && !kindFitsSlot(kind, slot)) return;
  if (kind === null) {
    slots = { ...slots, [slot]: { ...emptySlot(), locked: slots[slot].locked } };
  } else {
    writeSlot(slot, kind, props, "user");
  }
}

/** per-slot lock/clear (the operator's frame controls; the agent's tools route through their own validators) */
export function lockSlot(slot: SlotId, locked: boolean): void {
  slots = { ...slots, [slot]: { ...slots[slot], locked } };
  persist();
  notify();
}

/** clear a bay (the operator's ✕ — locked or not, the operator spoke) */
export function clearSlot(slot: SlotId): void {
  slots = { ...slots, [slot]: { ...emptySlot(), locked: slots[slot].locked } };
  persist();
  notify();
}

export function clearDeck(): void {
  slots = {
    "col2-top": emptySlot(),
    "col2-bottom": emptySlot(),
    "col3-top": emptySlot(),
    "col3-bottom": emptySlot(),
  };
  persist();
  notify();
}

// ---- THE GENTLE SWAP (onboarding → yuan_ledger, session-63) ----

/**
 * After onboarding completes, col2-top promotes onboarding → yuan_ledger —
 * GENTLY: only when the SEEDED onboarding widget still occupies the slot.
 * An operator choice (picked something else, or dismissed it) is never
 * stomped. Returns true when the swap landed.
 */
export function promoteLedgerIfComplete(): boolean {
  const top = slots["col2-top"];
  if (top.kind !== "onboarding" || top.origin !== "seed") return false;
  writeSlot("col2-top", "yuan_ledger", {}, "seed");
  return true;
}

// ---- seeding / reset ----

/**
 * Seed the default slot map ONLY on fresh storage (the v2 key absent).
 * Any existing deck — even one the user emptied — is left alone.
 */
export function ensureFirstRunSeed(): boolean {
  let fresh = false;
  try {
    fresh = window.localStorage.getItem(KEY) === null;
  } catch {
    return false; // storage unavailable — no persistent deck either way
  }
  if (!fresh) return false;
  slots = defaultSlotMap();
  persist();
  notify();
  return true;
}

export interface DeckResetResult {
  /** all four bays reseeded to the default composition */
  seeded: SlotId[];
}

/**
 * Restore the default composition (the agent's reset_deck + the header
 * affordance): a FULL reseed — slot semantics are cheap to rebuild, and
 * reset is the operator's explicit "put it back" (session-63 law).
 */
export function resetDeckToDefault(): DeckResetResult {
  slots = defaultSlotMap();
  persist();
  notify();
  return { seeded: [...SLOT_IDS] };
}

/**
 * The replay fold's backward-seek primitive (session-63 law): UNLOCKED
 * slots reset to the DEFAULT composition (locked bays persist — the
 * operator spoke), then the prefix re-feeds. Returns the ids reset.
 */
export function resetUnlockedSlotsToDefaults(): SlotId[] {
  const defaults = defaultSlotMap();
  const reset: SlotId[] = [];
  const next = { ...slots };
  for (const id of SLOT_IDS) {
    // locked bays persist; a bay holding a LIVE plan is protected too (the
    // checklist is a decision surface — the fold must not drop it mid-run)
    if (slots[id].locked || bayProtected(id)) continue;
    next[id] = defaults[id];
    reset.push(id);
  }
  slots = next;
  if (reset.length > 0) {
    persist();
    notify();
  }
  return reset;
}

/**
 * Backward-compat fold reset: unlock-blind clear of auto/agent content.
 * (62's dismissAutoWidgets law is superseded — kept only as the seed of
 * the new primitive above; not used by the app.)
 */
export function dismissAutoWidgets(): number {
  let removed = 0;
  const next = { ...slots };
  for (const id of SLOT_IDS) {
    const s = slots[id];
    if (!s.locked && !bayProtected(id) && (s.origin === "auto" || s.origin === "agent")) {
      next[id] = { ...emptySlot(), locked: s.locked };
      removed += 1;
    }
  }
  slots = next;
  if (removed > 0) {
    persist();
    notify();
  }
  return removed;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const subscribeDeck = subscribe;

export function useDeck(): { slots: SlotMap } {
  const snapshot = useSyncExternalStore(subscribe, deckSlots, deckSlots);
  return { slots: snapshot };
}

export function useDeckDispatch(): {
  lock: (slot: SlotId, locked: boolean) => void;
  clear: (slot: SlotId) => void;
  pick: (slot: SlotId, kind: WidgetKind | null) => void;
  clearAll: () => void;
} {
  const lock = useCallback((slot: SlotId, locked: boolean) => lockSlot(slot, locked), []);
  const clear = useCallback((slot: SlotId) => clearSlot(slot), []);
  const pick = useCallback((slot: SlotId, kind: WidgetKind | null) => slotSurface(slot, kind), []);
  const clearAll = useCallback(() => clearDeck(), []);
  return { lock, clear, pick, clearAll };
}

// ---- AUTO-SURFACING = ROUTING (RunEvent stream → designated bay) ----

/**
 * The tool → preferred-widget map (unchanged kinds; placement is now the
 * ROUTER's job). Only ok results surface (errors stay in the pane's tool
 * cards — a failed read is not deck-worthy state).
 */
export function widgetFromRunEvent(e: RunEvent): SurfaceInput | null {
  if (e.type === "turn-start") {
    // the run checklist is the deck's spine — one bay, refreshed per turn
    return { kind: "task_graph", origin: "auto" };
  }
  if (e.type !== "tool-result" || !e.ok) return null;
  const r = e.result;
  switch (e.name) {
    case "run_beat":
      return { kind: "beat_sim", origin: "auto", props: { waat: r["waat"] ?? null, envelope: r } };
    case "get_lau": {
      const address = typeof r["entity"] === "string" ? r["entity"] : null;
      if (address === null) return null;
      return { kind: "profile", origin: "auto", props: { address } };
    }
    case "get_venue": {
      const address = typeof r["venue"] === "string" ? r["venue"] : null;
      if (address === null) return null;
      return { kind: "venue", origin: "auto", props: { address, result: r } };
    }
    case "settle_venue":
    case "take_venue":
    case "purchase_affection":
    case "redeem_affection":
    case "exchange_hong":
    case "exchange_hung":
    case "world_code":
    case "spawn_gwat": {
      // settling / taking the deed / a desk send (balances + supply moved,
      // session-55) refreshes the venue card; the SIM world verbs (session
      // 59) point at the same bay — the panel's WORLD/GWAT blocks re-read
      const address = typeof r["venue"] === "string" ? r["venue"] : null;
      if (address === null) return null;
      return { kind: "venue", origin: "auto", props: { address, result: r } };
    }
    case "create_venue": {
      // only a SENT create knows the fresh QING address (the DRYRUN has none)
      const address = typeof r["venue"] === "string" ? r["venue"] : null;
      if (address === null) return null;
      return { kind: "venue", origin: "auto", props: { address, result: r } };
    }
    case "dss_snipe": {
      // a LANDED world line surfaces the world-channel monitor (the owner's
      // session-69 ask: the deck should SHOW the line arriving); DRYRUNs
      // and failed snipes surface nothing
      if (r["status"] !== "sent") return null;
      return { kind: "chat_monitor", origin: "auto", props: { channel: "world" } };
    }
    case "send_chat":
    case "send_world_chat": {
      // both post to a VENUE channel (the CHANNELS fact — send_world_chat's
      // name is the trap); the monitor follows the landed line there
      if (r["status"] !== "sent") return null;
      const address = typeof r["venue"] === "string" ? r["venue"] : null;
      if (address === null) return null;
      return { kind: "chat_monitor", origin: "auto", props: { channel: "venue", address } };
    }
    case "search_kb":
    case "explain":
      return {
        kind: "kb_excerpt",
        origin: "auto",
        props: { query: r["query"] ?? r["topic"] ?? null, result: r },
      };
    case "propose_plan":
      // the L1 plan envelope — ONE bay, the widget reads the plan store live
      return { kind: "plan", origin: "auto" };
    case "show_widget": {
      // session-63: the agent-directed surface carries its explicit SLOT
      // (rights were validated at execute time); pre-63 recordings carry
      // kind/props only and re-route through the same router — the fold
      // stays deterministic because backward seeks reset unlocked bays to
      // the default composition before re-feeding
      if (r["surfaced"] !== true) return null;
      const kind = typeof r["kind"] === "string" && isWidgetKind(r["kind"]) ? (r["kind"] as WidgetKind) : null;
      if (kind === null) return null;
      const props = typeof r["props"] === "object" && r["props"] !== null && !Array.isArray(r["props"]) ? (r["props"] as Record<string, unknown>) : {};
      const slot = isSlotId(r["slot"]) ? (r["slot"] as SlotId) : undefined;
      return { kind, props, origin: "agent", slot };
    }
    default:
      return null;
  }
}

export function autoSurfaceFromRunEvent(e: RunEvent): SlotId | null {
  const input = widgetFromRunEvent(e);
  if (input === null) return null;
  return surfaceWidget(input);
}

let wired = false;

/**
 * Install the routing subscription (idempotent — App calls it once at
 * mount; unit tests call it to exercise the mapping end-to-end).
 */
export function wireDeckToRunEvents(): () => void {
  if (wired) return () => {};
  wired = true;
  const unsub = subscribeRunEvents(autoSurfaceFromRunEvent);
  return () => {
    unsub();
    wired = false;
  };
}
