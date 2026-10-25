import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionResult, type Abi, type PublicClient } from "viem";
import { JournalBus } from "@/chain/journal";
import { currentVenue, setCurrentVenue } from "@/state/venueStore";
import { AGENT_BAY, MAP_BAY, clearDeck, deckSlots, lockSlot, resetDeckToDefault, slotSurface } from "@/state/deckStore";
import { toolByName, toolSpecs, type AgentToolContext } from "@/agent/tools";
import { _liveAtlasAbis } from "@/chain/liveAtlas";

/**
 * The dashboard tool family (§7.11 path b; the session-63 slot rework):
 * schema + bay effects + the placement-RIGHTS law (col3-bottom
 * exclusively, col2-bottom when unlocked, any EMPTY compatible bay) + the
 * load-bearing GUARANTEE that they never touch the gate (the fake ctx
 * recorders must stay empty) and never reach the chain.
 *
 * focus_map's live path (session-67) mocks @/chain/client FILE-WIDE (the
 * planStaleness precedent): the default impl is a DEAD client so the
 * fallback row stays honest, and the live-coordinate test swaps the impl.
 */

vi.mock("@/chain/client", () => ({
  makeClient: (url: string) => clientImpl(url),
}));

type ClientFactory = (url: string) => PublicClient;
let clientImpl: ClientFactory = () => deadClient();

const HECKE_ADDR = "0x29a924d9b0233026b9844f2afeb202f1791d7593";

function deadClient(): PublicClient {
  return {
    multicall: async () => {
      throw new Error("HTTP endpoint terminated");
    },
    call: async () => {
      throw new Error("HTTP endpoint terminated");
    },
  } as unknown as PublicClient;
}

function liveClient(waat: bigint, longitude: bigint, latitude: bigint): PublicClient {
  return {
    multicall: async () => [
      { status: "success", result: "Fresh QING" },
      { status: "success", result: "FRESH" },
      { status: "success", result: waat },
    ],
    call: async (req: { to: string }) => {
      if (req.to.toLowerCase() !== HECKE_ADDR) throw new Error("unexpected call target");
      return encodeFunctionResult({
        abi: _liveAtlasAbis.heckeComplimentAbi as unknown as Abi[],
        functionName: "Compliment",
        result: [longitude, latitude],
      });
    },
  } as unknown as PublicClient;
}

const PHOBOS = "0xb0ba7d36b7f0505879179ece7401f24eb653c6e1"; // config-pinned first QING
const NOT_A_VENUE = "0x0000000000000000000000000000000000000001";

interface RecordingCtx extends AgentToolContext {
  __requests: unknown[];
}

function fakeCtx(): RecordingCtx {
  const requests: unknown[] = [];
  const ctx: AgentToolContext = {
    rpcUrl: "http://127.0.0.1:9999",
    account: null,
    snapshot: null,
    journal: new JournalBus(),
    walletMode: "A",
    chatToolsEnabled: false,
    gateDryRun: async (req) => {
      requests.push(req);
      throw new Error("dashboard tools must never reach the gate");
    },
    gateSend: async (req) => {
      requests.push(req);
      throw new Error("dashboard tools must never reach the gate");
    },
    refreshSnapshot: () => {
      requests.push("refreshSnapshot");
    },
    takeNote: () => {
      throw new Error("dashboard tools never journal");
    },
    simToolsEnabled: false,
  };
  return Object.assign(ctx, { __requests: requests }) as RecordingCtx;
}

beforeEach(() => {
  clearDeck();
  setCurrentVenue(null);
});

describe("advertising + schema", () => {
  it("ships the family ALWAYS (both §7.4 states); arrange_deck is DEAD", () => {
    for (const enabled of [false, true]) {
      const names = toolSpecs(enabled).map((t) => t.function.name);
      for (const n of ["show_widget", "focus_map", "pin_widget", "dismiss_widget", "reset_deck"]) {
        expect(names, `missing ${n} (chatTools=${enabled})`).toContain(n);
      }
      expect(names).not.toContain("arrange_deck"); // slots, not order — the 63 law
    }
  });

  it("every dashboard tool declares a JSON-schema parameters object", () => {
    for (const name of ["show_widget", "focus_map", "pin_widget", "dismiss_widget", "reset_deck"]) {
      const t = toolByName(name)!;
      expect(t.parameters.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.risk).not.toBe("act"); // pure UI, never an act tool
    }
  });

  it("show_widget offers a slot arg over the four bays", () => {
    const params = toolByName("show_widget")!.parameters as { properties: Record<string, { enum?: string[] }> };
    expect(params.properties["slot"]!.enum).toEqual(["col2-top", "col2-bottom", "col3-top", "col3-bottom"]);
  });

  it("the ONE-INSTANCE law: an explicit slot never forks a duplicate (the 71.3 owner find)", async () => {
    const ctx = fakeCtx();
    resetDeckToDefault(); // the seeded composition (task_graph locked in col3-top)
    // task_graph shows in the seeded col3-top; the agent asks for col3-bottom
    const out = (await toolByName("show_widget")!.execute({ kind: "task_graph", slot: "col3-bottom" }, ctx)) as Record<string, unknown>;
    expect(out["surfaced"]).toBe(true);
    expect(out["redirected"]).toBe(true);
    expect(out["slot"]).toBe("col3-top"); // refreshed the seeded instance
    expect(String(out["note"])).toContain("col3-bottom");
    // exactly ONE task_graph on the deck
    const kinds = Object.values(deckSlots()).map((s) => s.kind);
    expect(kinds.filter((k) => k === "task_graph")).toHaveLength(1);
  });

  it("the one-instance redirect also fires for unlocked duplicates (kb_excerpt refresh)", async () => {
    const ctx = fakeCtx();
    const first = (await toolByName("show_widget")!.execute({ kind: "kb_excerpt", query: "beat gas budget" }, ctx)) as Record<string, unknown>;
    expect(first["slot"]).toBe(AGENT_BAY);
    const second = (await toolByName("show_widget")!.execute({ kind: "kb_excerpt", query: "hecke compliment", slot: "col2-bottom" }, ctx)) as Record<string, unknown>;
    expect(second["redirected"]).toBe(true);
    expect(second["slot"]).toBe(AGENT_BAY); // refreshed in place, props swapped
    expect(deckSlots()[AGENT_BAY].props["query"]).toBe("hecke compliment");
  });
});

describe("show_widget (routing + rights)", () => {
  it("routes a kb_excerpt and answers with the bay it took + the deck summary", async () => {
    const ctx = fakeCtx();
    const out = await toolByName("show_widget")!.execute({ kind: "kb_excerpt", query: "beat gas budget" }, ctx);
    expect(out.surfaced).toBe(true);
    expect(out.kind).toBe("kb_excerpt");
    expect(out.slot).toBe(AGENT_BAY); // empty deck → the agent's bay via its designated list
    expect(deckSlots()[AGENT_BAY].props).toEqual({ query: "beat gas budget" });
    expect(out.bays).toHaveLength(4);
    expect(ctx.__requests).toHaveLength(0); // no gate, no chain, no snapshot refetch
  });

  it("rejects unknown kinds + the dead/operator kinds (snapshot, fleet_score, proposal, onboarding, plan)", async () => {
    const ctx = fakeCtx();
    for (const kind of ["hologram", "snapshot", "fleet_score", "proposal", "onboarding", "plan"]) {
      const out = await toolByName("show_widget")!.execute({ kind }, ctx);
      expect(out.error, kind).toContain("unknown widget kind");
    }
  });

  it("venue kinds need an address or a current venue selection", async () => {
    const ctx = fakeCtx();
    const none = await toolByName("show_widget")!.execute({ kind: "venue" }, ctx);
    expect(none.error).toContain("no address");
    setCurrentVenue({ a: PHOBOS, n: "phobos", s: "PHOBOS", lat: 0.5, band: 30, blk: 1 });
    const cur = await toolByName("show_widget")!.execute({ kind: "chat_monitor" }, ctx);
    expect(cur.surfaced).toBe(true);
    expect(deckSlots()[AGENT_BAY].props).toMatchObject({ address: PHOBOS, channel: "venue" });
    setCurrentVenue(null);
  });

  it("validates per-kind props (address shape, non-empty query, decimal waat)", async () => {
    const ctx = fakeCtx();
    expect((await toolByName("show_widget")!.execute({ kind: "profile", address: "nope" }, ctx)).error).toContain("address");
    expect((await toolByName("show_widget")!.execute({ kind: "kb_excerpt", query: " " }, ctx)).error).toContain("query");
    expect((await toolByName("show_widget")!.execute({ kind: "beat_sim", waat: "12x" }, ctx)).error).toContain("waat");
  });

  it("an explicit slot within rights lands there; the result names the bay", async () => {
    const ctx = fakeCtx();
    const out = await toolByName("show_widget")!.execute({ kind: "beat_sim", slot: AGENT_BAY }, ctx);
    expect(out.surfaced).toBe(true);
    expect(out.slot).toBe(AGENT_BAY);
  });

  it("rights: the agent's bay EXCLUSIVELY + col2-bottom when unlocked + any EMPTY compatible bay", async () => {
    const ctx = fakeCtx();
    // col2-bottom is fine when unlocked (even non-empty — the swap right)
    slotSurface(MAP_BAY, "kb_excerpt", { query: "x" });
    const mapBay = await toolByName("show_widget")!.execute({ kind: "beat_sim", slot: MAP_BAY }, ctx);
    expect(mapBay.surfaced).toBe(true);
    expect(deckSlots()[MAP_BAY].kind).toBe("beat_sim");
    // an OCCUPIED non-right bay refuses honestly (col2-top holds something)
    slotSurface("col2-top", "beat_sim", {});
    const refused = await toolByName("show_widget")!.execute({ kind: "profile", address: "0x" + "11".repeat(20), slot: "col2-top" }, ctx);
    expect(refused.error).toContain("your rights are");
    // an EMPTY bay is free real estate
    clearDeck();
    const empty = await toolByName("show_widget")!.execute({ kind: "kb_excerpt", query: "y", slot: "col2-top" }, ctx);
    expect(empty.error).toContain("does not fit"); // TALL kind in a SHORT empty bay — class-refused
    const fits = await toolByName("show_widget")!.execute({ kind: "beat_sim", slot: "col2-top" }, ctx);
    expect(fits.surfaced).toBe(true);
    expect(fits.slot).toBe("col2-top");
  });

  it("rights: a LOCKED target bay always refuses (the operator spoke)", async () => {
    const ctx = fakeCtx();
    lockSlot(AGENT_BAY, true);
    const out = await toolByName("show_widget")!.execute({ kind: "kb_excerpt", query: "q", slot: AGENT_BAY }, ctx);
    expect(out.error).toContain("LOCKED");
  });
});

describe("focus_map", () => {
  it("sets the app-global venue from the seed and ENSURES the map bay", async () => {
    const ctx = fakeCtx();
    const out = await toolByName("focus_map")!.execute({ address: PHOBOS }, ctx);
    expect(out.focused).toBe(PHOBOS);
    expect(out.band).toBe(75); // the render-seed row for Phobos
    expect(currentVenue()?.a.toLowerCase()).toBe(PHOBOS.toLowerCase());
    expect(deckSlots()[MAP_BAY].kind).toBe("map_focus");
    expect(ctx.__requests).toHaveLength(0);
    setCurrentVenue(null);
  });

  it("re-claims a displaced map bay; reports a LOCKED one honestly", async () => {
    const ctx = fakeCtx();
    slotSurface(MAP_BAY, "kb_excerpt", { query: "x" });
    const reclaim = await toolByName("focus_map")!.execute({ address: PHOBOS }, ctx);
    expect(reclaim.mapBay).toContain("reclaimed");
    expect(deckSlots()[MAP_BAY].kind).toBe("map_focus");
    lockSlot(MAP_BAY, true);
    slotSurface(MAP_BAY, "kb_excerpt", { query: "y" });
    const locked = await toolByName("focus_map")!.execute({ address: PHOBOS }, ctx);
    expect(locked.mapBay).toContain("LOCKED");
    expect(deckSlots()[MAP_BAY].kind).toBe("kb_excerpt"); // untouched
    expect(locked.focused).toBe(PHOBOS); // the selection still went app-global
  });

  it("an address OUTSIDE the atlas seed on a DEAD rpc falls back to the metadata-only row (honest no-marker)", async () => {
    clientImpl = () => deadClient();
    const out = await toolByName("focus_map")!.execute({ address: NOT_A_VENUE }, fakeCtx());
    // never a hard refusal: the venue panel + channel follow even when the
    // HECKE read fails (no marker, coords honestly unavailable)
    expect(out.error).toBeUndefined();
    expect(out.inAtlasSeed).toBe(false);
    expect(out.hecke).toBeNull();
    expect(out.marker).toBe("none");
    expect(out.note).toContain("coordinates unavailable");
    expect(currentVenue()?.a.toLowerCase()).toBe(NOT_A_VENUE.toLowerCase());
    expect(deckSlots()[MAP_BAY].kind).toBe("map_focus");
    setCurrentVenue(null);
  });

  it("67: an address OUTSIDE the seed computes TRUE coordinates live (HECKE.Compliment) — the marker draws", async () => {
    const waat = 378814830703436350975436945425663138519237484768630413256454076449062763743n;
    const longitude = -2997199354317605840785995082216040074375754563771530840832866547481581850n;
    const latitude = 400000000000000000000000000000000000000000000000000000000000000000000000n;
    clientImpl = () => liveClient(waat, longitude, latitude);
    const out = await toolByName("focus_map")!.execute({ address: NOT_A_VENUE }, fakeCtx());
    expect(out.error).toBeUndefined();
    expect(out.inAtlasSeed).toBe(false);
    expect(out.marker).toBe("live");
    expect(out.band).toBeGreaterThan(33);
    expect(out.hecke).toMatch(/lon -?\d+\.\d lat -?\d+\.\d/);
    expect(out.note).toContain("TRUE live-computed");
    // the store row carries REAL coords (the zeros of the old placeholder
    // synthesis are gone — the atlas marker + every consumer read them)
    const cur = currentVenue();
    expect(cur?.a.toLowerCase()).toBe(NOT_A_VENUE.toLowerCase());
    expect(cur?.band).toBe(out.band);
    expect(cur?.n).toBe("Fresh QING");
    expect(deckSlots()[MAP_BAY].kind).toBe("map_focus");
    setCurrentVenue(null);
    clientImpl = () => deadClient();
  });
});

describe("pin_widget / dismiss_widget (per-slot lock/clear)", () => {
  it("act by bay id or by the kind a bay holds", async () => {
    const ctx = fakeCtx();
    await toolByName("show_widget")!.execute({ kind: "beat_sim" }, ctx);
    const byKind = await toolByName("pin_widget")!.execute({ target: "beat_sim" }, ctx);
    expect(byKind.locked).toBe(true);
    expect(byKind.slot).toBe("col3-top");
    expect(deckSlots()["col3-top"].locked).toBe(true);
    const byId = await toolByName("pin_widget")!.execute({ target: "col3-top", pinned: false }, ctx);
    expect(byId.locked).toBe(false);
    const gone = await toolByName("dismiss_widget")!.execute({ target: "beat_sim" }, ctx);
    expect(gone.cleared).toBe("col3-top");
    expect(deckSlots()["col3-top"].kind).toBeNull();
  });

  it("a LOCKED bay refuses the agent's clear (the lock protects content)", async () => {
    const ctx = fakeCtx();
    await toolByName("show_widget")!.execute({ kind: "beat_sim", slot: AGENT_BAY }, ctx);
    await toolByName("pin_widget")!.execute({ target: AGENT_BAY }, ctx);
    const out = await toolByName("dismiss_widget")!.execute({ target: AGENT_BAY }, ctx);
    expect(out.error).toContain("LOCKED");
    expect(deckSlots()[AGENT_BAY].kind).toBe("beat_sim");
  });

  it("errors honestly when nothing matches", async () => {
    const out = await toolByName("dismiss_widget")!.execute({ target: "map_focus" }, fakeCtx());
    expect(out.error).toContain("no bay matches");
  });
});

describe("reset_deck (reseed)", () => {
  it("reseeds ALL four bays to the default composition + default locks", async () => {
    const ctx = fakeCtx();
    await toolByName("show_widget")!.execute({ kind: "kb_excerpt", query: "temp" }, ctx);
    lockSlot("col2-top", false);
    const out = await toolByName("reset_deck")!.execute({}, ctx);
    expect(out.seeded).toEqual(["col2-top", "col2-bottom", "col3-top", "col3-bottom"]);
    const s = deckSlots();
    expect(s["col2-top"].kind).toBe("onboarding");
    expect(s[MAP_BAY].kind).toBe("map_focus");
    expect(s["col3-top"].kind).toBe("task_graph");
    expect(s[AGENT_BAY].kind).toBe("chat_monitor");
    expect(s[AGENT_BAY].locked).toBe(false);
    expect(ctx.__requests).toHaveLength(0);
  });

  it("matches the store's resetDeckToDefault exactly (one semantics, two callers)", async () => {
    const tool = await toolByName("reset_deck")!.execute({}, fakeCtx());
    clearDeck();
    const store = resetDeckToDefault();
    expect(tool.seeded as string[]).toEqual(store.seeded);
  });
});
