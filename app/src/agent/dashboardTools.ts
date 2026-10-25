import type { Address } from "viem";
import { loadRenderRows, renderRowAsVenueRow } from "@/state/atlas";
import { currentVenue, setCurrentVenue } from "@/state/venueStore";
import { makeClient } from "@/chain/client";
import { liveRenderRow, type LiveRenderRow } from "@/chain/liveAtlas";
import { liveVenueRow } from "@/chain/venueDeed";
import {
  AGENT_BAY,
  KIND_CLASS,
  MAP_BAY,
  SLOT_IDS,
  WIDGET_KINDS,
  clearSlot,
  deckSlots,
  kindFitsSlot,
  lockSlot,
  resetDeckToDefault,
  surfaceWidget,
  type SlotId,
  type WidgetKind,
} from "@/state/deckStore";
import type { AgentTool } from "@/agent/tools";

/**
 * The `dashboard` tool family (IA-PLAN §7.11 path b — agent-directed
 * surfacing; the session-63 SLOT REDESIGN rework): pure UI side-effects on
 * the DECK's BAYS. They send NOTHING — no gate call, no RPC write, no
 * signer — and are journaled as agent.tool by the graph like every tool.
 *
 * PLACEMENT RIGHTS (the owner's landed law): the agent may take the
 * col3-bottom bay EXCLUSIVELY + col2-bottom when unlocked + ANY EMPTY
 * compatible slot (free real estate, destroys nothing). `show_widget`
 * takes an optional `slot` arg — rights-validated, and the result names
 * the bay it took. `arrange_deck` is dead (slots, not order);
 * `pin_widget`/`dismiss_widget` are the per-slot LOCK/CLEAR.
 */

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** kinds the AGENT may surface — onboarding is operator chrome, plan is planStore-driven */
export const AGENT_WIDGET_KINDS: WidgetKind[] = WIDGET_KINDS.filter((k) => k !== "onboarding" && k !== "plan");

/** the bays the agent may WRITE (when unlocked) beyond free real estate */
export const AGENT_WRITABLE_BAYS: SlotId[] = [AGENT_BAY, MAP_BAY];

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function deckSummary(): Record<string, unknown> {
  const s = deckSlots();
  return {
    bays: SLOT_IDS.map((id) => ({ slot: id, kind: s[id].kind, locked: s[id].locked, origin: s[id].origin })),
  };
}

/** resolve a venue address arg → current selection → error */
function resolveVenueArg(addressArg: unknown): Address | { error: string } {
  const a = str(addressArg);
  if (a.length > 0) {
    return ADDRESS_RE.test(a) ? (a as Address) : { error: "invalid address" };
  }
  const cur = currentVenue();
  if (cur !== null && ADDRESS_RE.test(cur.a)) return cur.a as Address;
  return { error: "no address given and no current venue — pass one or select in MAP first" };
}

/** the placement-rights check for an EXPLICIT slot target */
function agentMayTake(slot: SlotId, kind: WidgetKind): { ok: true } | { ok: false; error: string } {
  const bay = deckSlots()[slot];
  if (bay.locked) {
    return { ok: false, error: `bay ${slot} is LOCKED — the operator froze it; try ${AGENT_BAY} or an empty bay` };
  }
  if (!kindFitsSlot(kind, slot)) {
    return { ok: false, error: `a ${KIND_CLASS[kind]}-class surface does not fit the ${slot} bay` };
  }
  if (AGENT_WRITABLE_BAYS.includes(slot)) return { ok: true };
  if (bay.kind === null) return { ok: true }; // free real estate destroys nothing
  return {
    ok: false,
    error: `bay ${slot} holds "${bay.kind}" — your rights are ${AGENT_BAY} (exclusively), ${MAP_BAY} when unlocked, or any EMPTY compatible bay`,
  };
}

const showWidget: AgentTool = {
  name: "show_widget",
  risk: "knowledge",
  description:
    "Surface a widget in a DECK bay (the agent workspace the operator watches). Kinds: yuan_ledger (the custody tri-table), venue (live venue panel — THE venue bay), profile (entity profile), beat_sim (DRYRUN envelope + gas budget), chat_monitor (a channel tail: world or a venue), kb_excerpt (guide/KB hits for a query), map_focus (mini atlas), task_graph (run checklist). Placement rights: col3-bottom is yours exclusively, col2-bottom when unlocked, any EMPTY compatible bay; the seeded bays (col2-top, col2-bottom, col3-top) are LOCKED by default — do not ask for them. A kind already showing somewhere REFRESHES in place — it never forks into a second bay. Pure UI — sends nothing.",
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string", description: "widget kind", enum: [...AGENT_WIDGET_KINDS] },
      slot: {
        type: "string",
        description: "explicit target bay (rights-validated)",
        enum: [...SLOT_IDS],
      },
      address: { type: "string", description: "venue/entity address (venue, profile, chat_monitor; omit venue kinds to use the current venue)" },
      query: { type: "string", description: "the KB query (kb_excerpt)" },
      waat: { type: "string", description: "decimal waat (beat_sim)" },
    },
    required: ["kind"],
    additionalProperties: false,
  },
  async execute(args) {
    const kind = str(args["kind"]);
    if (!AGENT_WIDGET_KINDS.includes(kind as WidgetKind)) {
      return { error: `unknown widget kind "${kind}" — allowed: ${AGENT_WIDGET_KINDS.join(", ")}` };
    }
    const props: Record<string, unknown> = {};
    if (kind === "venue" || kind === "chat_monitor") {
      const venue = resolveVenueArg(args["address"]);
      if (typeof venue === "object") return { error: venue.error };
      props.address = venue;
      if (kind === "chat_monitor") props.channel = "venue";
    } else if (kind === "profile") {
      const a = str(args["address"]);
      if (!ADDRESS_RE.test(a)) return { error: "profile needs an entity address" };
      props.address = a;
    } else if (kind === "kb_excerpt") {
      const q = str(args["query"]);
      if (q.trim().length === 0) return { error: "kb_excerpt needs a query" };
      props.query = q;
    } else if (kind === "beat_sim") {
      const w = str(args["waat"]);
      if (w.length > 0 && !/^\d+$/.test(w)) return { error: "waat must be a decimal string" };
      if (w.length > 0) props.waat = w;
    }
    // session-63: an explicit slot is RIGHTS-VALIDATED here; the result
    // names the bay it took so a replayed stream re-surfaces exactly
    const slotArg = str(args["slot"]);
    if (slotArg.length > 0) {
      if (!(SLOT_IDS as string[]).includes(slotArg)) {
        return { error: `unknown bay "${slotArg}" — bays: ${SLOT_IDS.join(", ")}` };
      }
      const rights = agentMayTake(slotArg as SlotId, kind as WidgetKind);
      if (!rights.ok) return { error: rights.error, ...deckSummary() };
      // the ONE-INSTANCE law (the owner's double-task_graph find): a kind
      // already showing somewhere refreshes THERE via the router — an
      // explicit slot never forks a duplicate into a second bay
      const dupe = (SLOT_IDS as SlotId[]).find((id) => id !== slotArg && deckSlots()[id].kind === (kind as WidgetKind));
      if (dupe !== undefined) {
        const slot = surfaceWidget({ kind: kind as WidgetKind, props, origin: "agent" });
        if (slot !== null) {
          return { surfaced: true, slot, kind, props, redirected: true, note: `already showing in ${dupe} — refreshed it there instead of forking a duplicate into ${slotArg}`, ...deckSummary() };
        }
      }
    }
    const slot = surfaceWidget({
      kind: kind as WidgetKind,
      props,
      origin: "agent",
      slot: slotArg.length > 0 ? (slotArg as SlotId) : undefined,
    });
    if (slot === null) {
      // a ROUTING refusal is not an execution error (a live plan protecting
      // its bay, all bays locked …): report honestly, let runs continue
      return { surfaced: false, refused: true, reason: "no bay took the surface (designated + agent bays locked or protected, nothing empty)", ...deckSummary() };
    }
    return { surfaced: true, slot, kind, props, ...deckSummary() };
  },
};

const focusMap: AgentTool = {
  name: "focus_map",
  risk: "knowledge",
  description:
    "Focus the atlas on a venue: sets the app-global current venue (the MAP page, its click-HUD venue card, the deck's map widget, and channel selection all follow) and ENSURES the map bay (col2-bottom holds map_focus — unless the operator locked it, which the result reports honestly). Works for seed venues (atlas coords) AND freshly-created/live venues not yet in the seed — the latter get TRUE coordinates computed live (QING.Waat + HECKE.Compliment, kb §9's exact transform) and draw a real marker on the MAP page + the deck map widget. Pure UI — sends nothing.",
  parameters: {
    type: "object",
    properties: {
      address: { type: "string", description: "venue (QING) address" },
    },
    required: ["address"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const a = str(args["address"]);
    if (!ADDRESS_RE.test(a)) return { error: "invalid address" };
    const rows = await loadRenderRows();
    const row = rows.find((r) => r.a.toLowerCase() === a.toLowerCase());
    let note = "current venue set app-global; the atlas bay + the venue card follow";
    let hecke: string | null = null;
    let band: number | null = null;
    let marker: "seed" | "live" | "none" = "seed";
    if (row !== undefined) {
      setCurrentVenue(renderRowAsVenueRow(row));
      hecke = `lon ${row.lon.toFixed(1)} lat ${row.lat.toFixed(1)}`;
      band = row.band;
    } else {
      // session-67: a LIVE venue not in the seed — compute TRUE coordinates
      // (QING.Waat + HECKE.Compliment + the seed's meridian table); the
      // marker draws on the MAP page + the deck map widget. A failed read
      // falls back to the metadata-only row (name/symbol, no marker).
      const client = makeClient(ctx.rpcUrl);
      let computed: LiveRenderRow | null = null;
      try {
        computed = await liveRenderRow(client, a as Address, 0);
      } catch {
        computed = null;
      }
      if (computed !== null) {
        setCurrentVenue(renderRowAsVenueRow(computed.row));
        note = "current venue set app-global with TRUE live-computed coordinates (HECKE.Compliment) — the marker draws on the atlas (the row joins the seed only at its next regen)";
        hecke = `lon ${computed.row.lon.toFixed(1)} lat ${computed.row.lat.toFixed(1)}`;
        band = computed.row.band;
        marker = "live";
      } else {
        const meta = await liveVenueRow(client, a as Address, 0);
        setCurrentVenue(meta);
        note = "current venue set from live name/symbol reads — coordinates unavailable (the HECKE read failed; no marker draws, the venue panel + channel still follow)";
        marker = "none";
      }
    }
    // ENSURE the map bay: take col2-bottom for map_focus unless locked
    const mapBay = deckSlots()[MAP_BAY];
    let mapNote = "map bay ensured";
    let slot: string | null = null;
    if (mapBay.kind === "map_focus") {
      slot = MAP_BAY;
    } else if (!mapBay.locked) {
      slot = surfaceWidget({ kind: "map_focus", origin: "agent", slot: MAP_BAY });
      mapNote = slot !== null ? `map bay reclaimed (${MAP_BAY})` : "map bay reclaim failed";
    } else {
      mapNote = `map bay (${MAP_BAY}) is LOCKED with "${mapBay.kind}" — the operator froze it; the selection still went app-global`;
    }
    const current = currentVenue();
    return {
      focused: current?.a ?? a,
      name: current !== null && current.n.length > 0 ? current.n : null,
      symbol: current?.s ?? null,
      band,
      hecke,
      inAtlasSeed: row !== undefined,
      marker,
      mapBay: mapNote,
      slot,
      note,
    };
  },
};

/** target = a bay id, or a kind (resolves to the bay holding it) */
function resolveBayTarget(target: string): SlotId | null {
  if ((SLOT_IDS as string[]).includes(target)) return target as SlotId;
  const s = deckSlots();
  const byKind = SLOT_IDS.find((id) => s[id].kind === target);
  return byKind ?? null;
}

const pinWidgetTool: AgentTool = {
  name: "pin_widget",
  risk: "knowledge",
  description:
    "LOCK a DECK bay (a locked bay is frozen — routing never writes it; unlocks re-open it). Target = bay id (col2-top/col2-bottom/col3-top/col3-bottom) or the kind currently in a bay. Pure UI.",
  parameters: {
    type: "object",
    properties: {
      target: { type: "string", description: "bay id or the kind it holds" },
      pinned: { type: "boolean", description: "true (default) locks the bay; false unlocks" },
    },
    required: ["target"],
    additionalProperties: false,
  },
  async execute(args) {
    const target = str(args["target"]);
    const slot = resolveBayTarget(target);
    if (slot === null) return { error: `no bay matches "${target}" — bays: ${SLOT_IDS.join(", ")}`, ...deckSummary() };
    const locked = args["pinned"] !== false;
    lockSlot(slot, locked);
    return { locked, slot, ...deckSummary() };
  },
};

const dismissWidgetTool: AgentTool = {
  name: "dismiss_widget",
  risk: "knowledge",
  description:
    "CLEAR a DECK bay (it goes empty — the operator's picker can refill it). Target = bay id or the kind it holds. LOCKED bays refuse honestly (the lock protects content). Pure UI — sends nothing.",
  parameters: {
    type: "object",
    properties: {
      target: { type: "string", description: "bay id or the kind it holds" },
    },
    required: ["target"],
    additionalProperties: false,
  },
  async execute(args) {
    const target = str(args["target"]);
    const slot = resolveBayTarget(target);
    if (slot === null) return { error: `no bay matches "${target}" — bays: ${SLOT_IDS.join(", ")}`, ...deckSummary() };
    if (deckSlots()[slot].locked) {
      return { error: `bay ${slot} is LOCKED with "${deckSlots()[slot].kind}" — unlock it first`, ...deckSummary() };
    }
    const kind = deckSlots()[slot].kind;
    if (kind === null) return { error: `bay ${slot} is already empty`, ...deckSummary() };
    clearSlot(slot);
    return { cleared: slot, kind, ...deckSummary() };
  },
};

const resetDeck: AgentTool = {
  name: "reset_deck",
  risk: "knowledge",
  description:
    "Restore the default DECK composition (onboarding/ledger, mini atlas, run checklist, world chat tail — all four bays reseeded with their default locks). Pure UI — sends nothing.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async execute() {
    const r = resetDeckToDefault();
    return { seeded: r.seeded, note: "all four bays reseeded to the default composition", ...deckSummary() };
  },
};

export const DASHBOARD_TOOLS: AgentTool[] = [showWidget, focusMap, pinWidgetTool, dismissWidgetTool, resetDeck];
