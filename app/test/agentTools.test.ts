import { afterEach, describe, expect, it } from "vitest";
import { keccak256, stringToBytes } from "viem";
import { JournalBus } from "@/chain/journal";
import { setCurrentVenue, currentVenue } from "@/state/venueStore";
import { NEW_QING_TOPIC } from "@/chain/venueDeed";
import { pendingLau, resetPendingLauForTests, setPendingLau } from "@/state/pendingLau";
import { setHomeVenue, resetHomeVenueForTests } from "@/state/homeVenue";
import { addr } from "@config/addresses";
import { toolByName, toolSpecs, type AgentToolContext } from "@/agent/tools";

/**
 * The agent tool catalog: schema/advertising rules + calldata correctness
 * (selectors self-checked against keccak, the s34 discipline) + the
 * DRYRUN-first act semantics. Chain reads are exercised through fake gate
 * contexts; the real RPC paths are the same loaders the manual views test.
 */

const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as `0x${string}`;
const LAU = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const VENUE = "0xb0ba7d36b7f0505879179ece7401f24eb653c6e1" as `0x${string}`; // Phobos (config-pinned)

function selector(sig: string): string {
  return keccak256(stringToBytes(sig)).slice(0, 10);
}

/** fakeCtx + a recorder for gate requests (typed once, used everywhere) */
interface RecordingCtx extends AgentToolContext {
  __requests: Array<{ to: string | null; data: string; meta?: unknown }>;
  __notes: string[];
  __refreshes(): number;
}

function fakeCtx(overrides: Partial<AgentToolContext> = {}): RecordingCtx {
  const requests: Array<{ to: string | null; data: string; meta?: unknown }> = [];
  const notes: string[] = [];
  const refreshes = { n: 0 };
  const ctx: AgentToolContext = {
    rpcUrl: "http://127.0.0.1:9999",
    account: ACCT,
    snapshot: null,
    journal: new JournalBus(),
    walletMode: "B",
    chatToolsEnabled: false,
    gateDryRun: async (req) => {
      requests.push({ to: req.to, data: req.data, meta: req.meta });
      return {
        request: req,
        cls: { risk: "standard", tier: "perimeter", gate: null, metered: false, reverts: [], contract: "TEST", functionSig: null },
        policy: { allowed: true, reasons: [], risk: "standard", tier: "perimeter", requiresExtraAck: false },
        sim: { ok: true, result: "0x", gas: 700_000n, error: null },
      };
    },
    gateSend: async (req) => {
      requests.push({ to: req.to, data: req.data, meta: req.meta });
      return {
        status: "sent",
        envelope: {} as never,
        txHash: "0xabc",
        receipt: { status: "success", gasUsed: 600_000n, logs: [], blockNumber: 27_674_001n, contractAddress: null },
        receiptError: null,
        movements: [],
        capBreaches: [],
      };
    },
    refreshSnapshot: () => {
      refreshes.n += 1;
    },
    takeNote: (text: string) => {
      notes.push(text);
    },
    simToolsEnabled: false,
    ...overrides,
  };
  return Object.assign(ctx, { __requests: requests, __notes: notes, __refreshes: () => refreshes.n }) as RecordingCtx;
}

function ctxWithSnapshot(): RecordingCtx {
  return fakeCtx({
    snapshot: {
      account: ACCT,
      lau: LAU,
      yue: null,
      lauName: "Test Lau",
      lauSymbol: "TLAU",
      username: "captain",
      yueName: null,
      yueSymbol: null,
      balances: {
        pls: { wallet: 100n, lau: 0n, yue: 0n },
        affection: { wallet: 0n, lau: 0n, yue: 0n },
        choa: { wallet: 0n, lau: 0n, yue: 0n },
      },
      yuanChoa: 0n,
      blockNumber: 27_674_000n,
      fetchedAt: Date.now(),
    },
  }) as RecordingCtx;
}

afterEach(() => {
  resetPendingLauForTests();
  setCurrentVenue(null); // create_venue SENDs now select their venue (69.2) — isolate
});

describe("tool advertising", () => {
  it("ships the §7.3 catalog", () => {
    const names = toolSpecs(false).map((t) => t.function.name);
    for (const n of ["get_state", "get_venue", "search_venues", "get_lau", "read_contract", "search_kb", "explain", "join_venue", "run_beat", "settle_venue", "take_venue", "create_venue", "create_lau", "set_username", "start_yue", "register", "purchase_affection", "redeem_affection", "exchange_hong", "exchange_hung"]) {
      expect(names, `missing ${n}`).toContain(n);
    }
  });

  it("hides send_chat unless the §7.4 opt-in is on (OFF by default)", () => {
    expect(toolSpecs(false).map((t) => t.function.name)).not.toContain("send_chat");
    expect(toolSpecs(true).map((t) => t.function.name)).toContain("send_chat");
  });

  it("journal_note is ALWAYS advertised (session-54 owner round: local memory write, review-gated)", () => {
    expect(toolSpecs(false).map((t) => t.function.name)).toContain("journal_note");
    expect(toolSpecs(true).map((t) => t.function.name)).toContain("journal_note");
  });

  it("every advertised tool declares a JSON-schema parameters object", () => {
    for (const spec of toolSpecs(true)) {
      expect(spec.function.parameters.type).toBe("object");
      expect(spec.function.description.length).toBeGreaterThan(0);
    }
  });
});

describe("act tools are DRYRUN-first with send gated behind send=true", () => {
  it("join_venue encodes QING.Join(LAU) with the canonical selector and DRYRUNs by default", async () => {
    const ctx = ctxWithSnapshot();
    const tool = toolByName("join_venue")!;
    const out = await tool.execute({ address: VENUE }, ctx);
    expect(out.mode).toBe("DRYRUN");
    const req = ctx.__requests[0]!;
    expect(req.to!.toLowerCase()).toBe(VENUE.toLowerCase());
    expect(req.data.slice(0, 10)).toBe(selector("Join(address)"));
    expect(req.data).toContain(LAU.slice(2).toLowerCase());
  });

  it("join_venue with send=true routes through gateSend", async () => {
    const ctx = ctxWithSnapshot();
    const out = await toolByName("join_venue")!.execute({ address: VENUE, send: true }, ctx);
    expect(out.status).toBe("sent");
    expect(out.txHash).toBe("0xabc");
  });

  it("join_venue refuses without a LAU", async () => {
    const out = await toolByName("join_venue")!.execute({ address: VENUE }, fakeCtx());
    expect(out.error).toContain("LAU");
  });

  it("run_beat encodes META.Beat(waat) against the perimeter META", async () => {
    const ctx = ctxWithSnapshot();
    const out = await toolByName("run_beat")!.execute({ waat: "12345" }, ctx);
    expect(out.mode).toBe("DRYRUN");
    expect(out.waat).toBe("12345");
    const req = ctx.__requests[0]!;
    expect(req.to!.toLowerCase()).toBe("0xe77bdae31b2219e032178d88504cc0170a5b9b97");
    expect(req.data.slice(0, 10)).toBe(selector("Beat(uint256)"));
  });

  it("settle_venue encodes CHEON.Su(venue) and DRYRUNs by default", async () => {
    const ctx = fakeCtx({
      snapshot: { ...ctxWithSnapshot().snapshot!, yue: "0x2222222222222222222222222222222222222222" },
    });
    const tool = toolByName("settle_venue")!;
    const out = await tool.execute({ address: VENUE }, ctx);
    expect(out.mode).toBe("DRYRUN");
    expect(out.venue).toBe(VENUE);
    const req = ctx.__requests[0]!;
    expect(req.to!.toLowerCase()).toBe("0x3d23084ca3f40465553797b5138cfc456e61fb5d"); // CHEON (config-pinned)
    expect(req.data.slice(0, 10)).toBe(selector("Su(address)"));
    expect(req.data.slice(10)).toContain(VENUE.slice(2).toLowerCase());
  });

  it("settle_venue: a dead-RPC live leg (unreadable ≠ absent) falls to the DRYRUN instead of claiming 'no YUE'", async () => {
    // 65.1: the friendly no-YUE refusal fires only when the live leg READS
    // null (pinned in planStaleness.test.ts); here the rpcUrl is dead so
    // absence is NOT proven — the gate DRYRUN arbitrates
    const out = await toolByName("settle_venue")!.execute({ address: VENUE }, ctxWithSnapshot());
    expect(out.error).toBeUndefined();
    expect(out.mode).toBe("DRYRUN");
  });

  it("settle_venue with send=true routes through gateSend", async () => {
    const withYue = fakeCtx({
      snapshot: { ...ctxWithSnapshot().snapshot!, yue: "0x2222222222222222222222222222222222222222" },
    });
    const out = await toolByName("settle_venue")!.execute({ address: VENUE, send: true }, withYue);
    expect(out.status).toBe("sent");
    expect(out.txHash).toBe("0xabc");
  });

  it("create_lau encodes LAUFactory.New(string,string) and refuses when a LAU exists", async () => {
    const fresh = fakeCtx();
    const out = await toolByName("create_lau")!.execute({ name: "A", symbol: "B" }, fresh);
    expect(out.mode).toBe("DRYRUN");
    expect(fresh.__requests[0]!.to!.toLowerCase()).toBe("0xba6ccd38992839aee20d5bf9125b1d94190b091c");
    expect(fresh.__requests[0]!.data.slice(0, 10)).toBe(selector("New(string,string)"));

    const again = await toolByName("create_lau")!.execute({ name: "A", symbol: "B" }, ctxWithSnapshot());
    expect(again.error).toContain("already has a LAU");
  });

  it("set_username enforces the 12-BYTE cap pre-send (MaximumLength is a real revert)", async () => {
    const tool = toolByName("set_username")!;
    const tooLong = await tool.execute({ username: "abcdefghijklm" }, ctxWithSnapshot()); // 13 bytes
    expect(tooLong.error).toContain("12");
    const ok = await tool.execute({ username: "abcdefghijkl" }, ctxWithSnapshot()); // exactly 12
    expect(ok.mode).toBe("DRYRUN");
  });

  it("start_yue enforces the Username-before-Start onchain gate order", async () => {
    const noUser = fakeCtx({
      snapshot: {
        ...ctxWithSnapshot().snapshot!,
        username: null,
      },
    });
    const out = await toolByName("start_yue")!.execute({ name: "V", symbol: "VV" }, noUser);
    expect(out.error).toContain("Username must be set before SEI.Start");

    const ok = await toolByName("start_yue")!.execute({ name: "V", symbol: "VV" }, ctxWithSnapshot());
    expect(ok.mode).toBe("DRYRUN");
    expect(ctxWithSnapshot().__requests).toBeDefined();
  });

  it("send_chat refuses when the opt-in is off, enforces the 280-char schema fence", async () => {
    const tool = toolByName("send_chat")!;
    const ctx = ctxWithSnapshot();
    const disabled = await tool.execute({ message: "hi", send: true }, ctx);
    expect(disabled.error).toContain("§7.4 opt-in");

    setCurrentVenue({ a: VENUE, n: "phobos", s: "PHOBOS", lat: 0.1, band: 30, blk: 27_000_000 });
    const enabled = fakeCtx({ chatToolsEnabled: true, snapshot: ctx.snapshot });
    const tooLong = await tool.execute({ message: "x".repeat(281) }, enabled);
    expect(tooLong.error).toContain("280");
    const ok = await tool.execute({ message: "hello venue" }, enabled);
    expect(ok.mode).toBe("DRYRUN");
    setCurrentVenue(null);
  });

  it("chat SEND results carry the venue (the deck's chat-monitor surface reads it — 69.2)", async () => {
    setCurrentVenue({ a: VENUE, n: "phobos", s: "PHOBOS", lat: 0.1, band: 30, blk: 27_000_000 });
    const base = ctxWithSnapshot();
    const ctx = fakeCtx({
      chatToolsEnabled: true,
      snapshot: { ...base.snapshot!, yue: "0x2222222222222222222222222222222222222222" },
    });
    const out = await toolByName("send_chat")!.execute({ message: "landed line", send: true }, ctx);
    expect(out.status).toBe("sent");
    expect((out.venue as string).toLowerCase()).toBe(VENUE);
    const world = await toolByName("send_world_chat")!.execute({ message: "landed line", send: true }, ctx);
    expect(world.status).toBe("sent");
    expect((world.venue as string).toLowerCase()).toBe(VENUE);
    setCurrentVenue(null);
  });

  it("take_venue encodes DO.Take(venue) with the chain-verified selector and DRYRUNs by default", async () => {
    const ctx = fakeCtx();
    const tool = toolByName("take_venue")!;
    const out = await tool.execute({ address: VENUE }, ctx);
    expect(out.mode).toBe("DRYRUN");
    expect(out.venue).toBe(VENUE);
    const req = ctx.__requests[0]!;
    expect(req.to!.toLowerCase()).toBe("0x98dbd5e4f78e53884c77573407727c3779ca3bad"); // DO-2 (config-pinned)
    expect(req.data.slice(0, 10)).toBe("0x8f26e8d5"); // Take(address) — kb/dev/do.md [chain]
    expect(req.data.slice(10).toLowerCase()).toContain(VENUE.slice(2).toLowerCase());
  });

  it("take_venue with send=true routes through gateSend", async () => {
    const ctx = fakeCtx();
    const out = await toolByName("take_venue")!.execute({ address: VENUE, send: true }, ctx);
    expect(out.status).toBe("sent");
    expect(out.venue).toBe(VENUE);
  });

  it("take_venue refuses without an account; resolves the current venue store", async () => {
    const none = await toolByName("take_venue")!.execute({ address: VENUE }, fakeCtx({ account: null }));
    expect(none.error).toContain("no account");
    setCurrentVenue({ a: VENUE, n: "phobos", s: "PHOBOS", lat: 0.1, band: 30, blk: 27_000_000 });
    const ctx = fakeCtx();
    await toolByName("take_venue")!.execute({}, ctx);
    expect(ctx.__requests[0]!.data.slice(10).toLowerCase()).toContain(VENUE.slice(2).toLowerCase());
    setCurrentVenue(null);
  });

  it("create_venue encodes MAP.New(asset) against the perimeter MAP and DRYRUNs by default", async () => {
    const ctx = fakeCtx();
    const tool = toolByName("create_venue")!;
    const asset = "0x81a6923ca480fada78cb15254c8d8cc382d2fbc0";
    const out = await tool.execute({ asset }, ctx);
    expect(out.mode).toBe("DRYRUN");
    const req = ctx.__requests[0]!;
    expect(req.to!.toLowerCase()).toBe("0xd3a7a95012edd46ea115c693b74c5e524b3dda75"); // MAP (config-pinned)
    expect(req.data.slice(0, 10)).toBe(selector("New(address)"));
    expect(req.data.slice(10).toLowerCase()).toContain(asset.slice(2).toLowerCase());
  });

  it("create_venue refuses a non-address asset", async () => {
    const out = await toolByName("create_venue")!.execute({ asset: "not-an-address" }, fakeCtx());
    expect(out.error).toContain("0x");
  });

  it("create_venue with send=true decodes the new QING from the receipt's NewQing log", async () => {
    const qing = "0x3333333333333333333333333333333333333333" as `0x${string}`;
    const asset = "0x81a6923ca480fada78cb15254c8d8cc382d2fbc0";
    const waat = 12345678901234567890n;
    const body =
      qing.slice(2).toLowerCase().padStart(64, "0") +
      asset.slice(2).toLowerCase().padStart(64, "0") +
      waat.toString(16).padStart(64, "0");
    const ctx = fakeCtx({
      gateSend: async () => {
        return {
          status: "sent" as const,
          envelope: {} as never,
          txHash: "0xnew",
          receipt: {
            status: "success" as const,
            gasUsed: 4_000_000n,
            logs: [{ address: "0xd3a7a95012edd46ea115c693b74c5e524b3dda75", topics: [NEW_QING_TOPIC], data: ("0x" + body) as `0x${string}` }],
            blockNumber: 27_674_100n,
            contractAddress: null,
          },
          receiptError: null,
          movements: [],
          capBreaches: [],
        };
      },
    });
    const out = await toolByName("create_venue")!.execute({ asset, send: true }, ctx);
    expect(out.status).toBe("sent");
    expect((out.venue as string).toLowerCase()).toBe(qing);
    expect(out.newWaat).toBe(waat.toString());
    expect(String(out.note)).toContain("auto-staffed");
    // session-69.2: a landed create becomes the app's CURRENT venue (the
    // manual card's set-as-current, agent-side) — the follow-up join/settle
    // in the same plan resolves it without an explicit address
    expect(out.selected).toBe(true);
    expect(currentVenue()?.a.toLowerCase()).toBe(qing);
  });
});

describe("read tools", () => {
  it("get_state answers honestly without an account", async () => {
    const out = await toolByName("get_state")!.execute({}, fakeCtx({ account: null }));
    expect(out.error).toContain("no snapshot");
    expect(out.error).toContain("connect an account");
  });

  it("get_state in the snapshot LOADING window never claims the wallet is missing (session-69: UNREADABLE ≠ ABSENT)", async () => {
    const ctx = fakeCtx({ account: ACCT }); // account bound, snapshot still null
    const out = await toolByName("get_state")!.execute({}, ctx);
    expect(out.error).toContain("account IS connected");
    expect(out.error).not.toContain("connect an account");
  });

  it("search_kb returns hits with source citations", async () => {
    const out = await toolByName("search_kb")!.execute({ query: "Yuan weights" }, fakeCtx());
    const hits = out.hits as Array<{ file: string }>;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.file === "deployed-semantics.md" || h.file === "the-ladder.md" || h.file === "economy.md")).toBe(true);
  });

  it("read_contract rejects non-view functions and unknown contracts", async () => {
    const ctx = fakeCtx();
    const mut = await toolByName("read_contract")!.execute({ contract: "CHOA", function: "Chat" }, ctx);
    expect(mut.error).toContain("only view/pure");
    const unknown = await toolByName("read_contract")!.execute({ contract: "NOSUCH", function: "Foo" }, ctx);
    expect(unknown.error).toContain("unknown perimeter contract");
  });

  it("read_contract name-misses teach the available views (one miss, one correction — the 69.2 video lesson)", async () => {
    const out = await toolByName("read_contract")!.execute({ contract: "MAP", function: "GetVenue", args: ["0xF9a5C1786f0a9522E51F78aee2ed0FF0Fe80A699"] }, fakeCtx());
    expect(String(out.error)).toContain("not found on MAP");
    expect(String(out.error)).toContain("GetQing(uint256)"); // the SIGNATURE rides the list (69.4)
    expect(String(out.error)).toContain("Forbidden(address)");
  });

  it("read_contract DISCOVERY — omitting `function` (or '?') lists every view/pure signature; non-views are counted, never listed as callable", async () => {
    const out = await toolByName("read_contract")!.execute({ contract: "MAP" }, fakeCtx());
    expect(out.contract).toBe("MAP");
    const views = out.views as string[];
    expect(views).toContain("GetQing(uint256)");
    expect(views).toContain("Forbidden(address)");
    expect(views.some((v) => v.startsWith("New("))).toBe(false); // non-view never listed
    expect(String(out.note)).toContain("non-view");
    const q = await toolByName("read_contract")!.execute({ contract: "MAP", function: "?" }, fakeCtx());
    expect((q.views as string[]).length).toBe(views.length);
    // arbitrary addresses discover the INSTANCE-UNION surface
    const uni = await toolByName("read_contract")!.execute({ contract: "0xF9a5C1786f0a9522E51F78aee2ed0FF0Fe80A699" }, fakeCtx());
    expect((uni.views as string[]).some((v) => v.startsWith("totalSupply("))).toBe(true);
    expect((uni.views as string[]).some((v) => v.startsWith("Waat("))).toBe(true); // the QING family
  });

  it("read_contract wrong-arity guesses name the expected signature (the video-2 GetMapQing(asset) case — the real sig is (int256,int256))", async () => {
    const out = await toolByName("read_contract")!.execute({ contract: "MAP", function: "GetMapQing", args: ["0xF9a5C1786f0a9522E51F78aee2ed0FF0Fe80A699"] }, fakeCtx());
    expect(String(out.error)).toContain("int256, int256");
    expect(String(out.error)).toContain("1 arg(s) given");
  });

  it("read_contract on an arbitrary address resolves through the INSTANCE-FAMILY union (QING+LAU+YUE views)", async () => {
    // totalSupply is a DYSNOMIA-base view the old QING-only fallback missed
    // (the video-2 diagnosis loop hit "totalSupply not found in QING.json"
    // on a LAU instance) — the union resolves it; the eth_call itself then
    // fails on this dead rpcUrl with the honest TRANSPORT error
    let msg = "";
    try {
      await toolByName("read_contract")!.execute(
        { contract: "0xF9a5C1786f0a9522E51F78aee2ed0FF0Fe80A699", function: "totalSupply" },
        fakeCtx()
      );
    } catch (e) {
      msg = String(e);
    }
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toContain("not found");
  });
});

describe("journal integration", () => {
  it("act tool sends carry meta.source=agent (the gate journal distinguishes them)", async () => {
    const ctx = ctxWithSnapshot();
    await toolByName("join_venue")!.execute({ address: VENUE, send: true }, ctx);
    // fakeCtx records meta — re-run with a recording wrapper
    const seen: unknown[] = [];
    const ctx2 = fakeCtx({
      snapshot: ctx.snapshot,
      gateSend: async (req) => {
        seen.push(req.meta);
        return { status: "sent", envelope: {} as never, txHash: "0x1", receipt: null, receiptError: null, movements: [], capBreaches: [] };
      },
    });
    await toolByName("join_venue")!.execute({ address: VENUE, send: true }, ctx2);
    expect(seen[0]).toMatchObject({ source: "agent" });
  });
});

describe("journal_note (§7.10 agent-authored lessons, session-54)", () => {  it("records a sanitized note through ctx.takeNote and answers with the review story", async () => {
    const ctx = fakeCtx();
    const out = await toolByName("journal_note")!.execute({ text: "the\u0000 operator prefers venue Phobos" }, ctx);
    expect(out.ok).toBe(true);
    expect(out.review).toContain("pending operator ack");
    expect(ctx.__notes).toEqual(["the operator prefers venue Phobos"]);
    expect(ctx.__requests).toHaveLength(0); // never touches the gate
  });

  it("caps long notes to NOTE_CAP and refuses empty ones", async () => {
    const ctx = fakeCtx();
    const long = await toolByName("journal_note")!.execute({ text: "y".repeat(400) }, ctx);
    expect((long.recorded as string).length).toBe(200);
    expect((long.recorded as string).endsWith("…")).toBe(true);
    const empty = await toolByName("journal_note")!.execute({ text: "   " }, ctx);
    expect(empty.error).toContain("empty note");
    expect(ctx.__notes).toHaveLength(1);
  });

  it("a later call in the same run replaces the earlier note (store-side last-wins)", async () => {
    const ctx = fakeCtx();
    await toolByName("journal_note")!.execute({ text: "first lesson" }, ctx);
    await toolByName("journal_note")!.execute({ text: "second lesson" }, ctx);
    expect(ctx.__notes).toEqual(["first lesson", "second lesson"]); // the store keeps the LAST (collectNote)
  });
});

describe("next_goals (session-74: the structured next-goals menu, ack-free)", () => {
  it("is ALWAYS advertised like journal_note (local memory write, no gate)", () => {
    expect(toolSpecs(false).map((t) => t.function.name)).toContain("next_goals");
    expect(toolSpecs(true).map((t) => t.function.name)).toContain("next_goals");
  });

  it("records the sanitized menu through ctx.takeNextGoals (the store's collector)", async () => {
    const goals: string[][] = [];
    const ctx = fakeCtx({ takeNextGoals: (g) => goals.push(g) });
    const out = await toolByName("next_goals")!.execute({ goals: [" settle\u0000 at Phobos ", "join Deimos", "join Deimos", "", "x".repeat(400), 7] }, ctx);
    expect(out.ok).toBe(true);
    expect(goals).toHaveLength(1);
    expect(goals[0]!.length).toBe(3); // dedupe + junk dropped + the capped long one kept
    expect(goals[0]![0]).toBe("settle at Phobos");
    expect(goals[0]![1]).toBe("join Deimos");
    expect(goals[0]![2]!.endsWith("…")).toBe(true);
    expect(String(out.note)).toContain("advisory data");
    expect(ctx.__requests).toHaveLength(0); // never touches the gate
  });

  it("refuses junk payloads honestly", async () => {
    const goals: string[][] = [];
    const ctx = fakeCtx({ takeNextGoals: (g) => goals.push(g) });
    const notArray = await toolByName("next_goals")!.execute({ goals: "settle" }, ctx);
    expect(notArray.error).toContain("no usable goals");
    const empty = await toolByName("next_goals")!.execute({ goals: ["  ", null] }, ctx);
    expect(empty.error).toContain("no usable goals");
    expect(goals).toHaveLength(0);
  });

  it("refuses honestly without a collector (outside a full-auto host there is nothing to feed)", async () => {
    const ctx = fakeCtx(); // takeNextGoals deliberately absent
    const out = await toolByName("next_goals")!.execute({ goals: ["settle at Phobos"] }, ctx);
    expect(out.error).toContain("no menu collector");
    expect(ctx.__notes).toHaveLength(0);
  });
});

describe("session-64 onboarding completion: the pending-LAU carriage + the registrar", () => {
  it("set_username falls back to the PENDING LAU when discovery has not landed", async () => {
    setPendingLau(ACCT, LAU, "0xabc");
    const ctx = fakeCtx(); // no snapshot at all
    const out = await toolByName("set_username")!.execute({ username: "alice" }, ctx);
    expect(out.mode).toBe("DRYRUN");
    expect(ctx.__requests[0]!.to!.toLowerCase()).toBe(LAU.toLowerCase());
    expect(ctx.__requests[0]!.data.slice(0, 10)).toBe(selector("Username(string)"));
    expect(String(out.note)).toContain("PENDING");
  });

  it("start_yue resolves the pending LAU (the registered-path Username guard does not block it)", async () => {
    setPendingLau(ACCT, LAU);
    const ctx = fakeCtx({ snapshot: null as unknown as RecordingCtx["snapshot"] });
    const out = await toolByName("start_yue")!.execute({ name: "V", symbol: "VV" }, ctx);
    expect(out.mode).toBe("DRYRUN");
    const req = ctx.__requests[0]!;
    expect(req.to!.toLowerCase()).toBe(addr("SEI").toLowerCase());
    expect(req.data.slice(10).toLowerCase()).toContain(LAU.slice(2).toLowerCase());
    expect(String(out.note)).toContain("PENDING");
  });

  it("create_lau refuses when a PENDING LAU exists (the snapshot-only guard allowed repeats)", async () => {
    setPendingLau(ACCT, LAU);
    const out = await toolByName("create_lau")!.execute({ name: "A", symbol: "B" }, fakeCtx());
    expect(out.error).toContain("PENDING");
  });

  it("create_lau SEND captures the created LAU into the pending store + refreshes the snapshot", async () => {
    const ctx = fakeCtx({
      gateSend: async (req) => {
        const predicted = "0x" + LAU.slice(2).toLowerCase().padStart(64, "0");
        return {
          status: "sent" as const,
          envelope: {
            request: req,
            cls: { risk: "standard", tier: "perimeter", gate: null, metered: false, reverts: [], contract: "TEST", functionSig: null },
            policy: { allowed: true, reasons: [], risk: "standard", tier: "perimeter", requiresExtraAck: false },
            sim: { ok: true, result: predicted as `0x${string}`, gas: 11_000_000n, error: null },
          },
          txHash: "0xnew",
          receipt: { status: "success" as const, gasUsed: 11_000_000n, logs: [], blockNumber: 27_674_100n, contractAddress: null },
          receiptError: null,
          movements: [],
          capBreaches: [],
        };
      },
    });
    const out = await toolByName("create_lau")!.execute({ name: "A", symbol: "B", send: true }, ctx);
    expect(out.status).toBe("sent");
    expect((out.lau as string).toLowerCase()).toBe(LAU.toLowerCase());
    expect(out.pendingRegistration).toBe(true);
    expect(pendingLau(ACCT)?.lau.toLowerCase()).toBe(LAU.toLowerCase());
    expect(ctx.__refreshes()).toBe(1); // the belt-and-braces refresh fired
  });

  it("create_lau DRYRUN decodes the predicted address (New returns it)", async () => {
    const ctx = fakeCtx({
      gateDryRun: async (req) => {
        const predicted = "0x" + LAU.slice(2).toLowerCase().padStart(64, "0");
        return {
          request: req,
          cls: { risk: "standard", tier: "perimeter", gate: null, metered: false, reverts: [], contract: "TEST", functionSig: null },
          policy: { allowed: true, reasons: [], risk: "standard", tier: "perimeter", requiresExtraAck: false },
          sim: { ok: true, result: predicted as `0x${string}`, gas: 11_000_000n, error: null },
        };
      },
    });
    const out = await toolByName("create_lau")!.execute({ name: "A", symbol: "B" }, ctx);
    expect(out.mode).toBe("DRYRUN");
    expect((out.predictedLau as string).toLowerCase()).toBe(LAU.toLowerCase());
  });

  it("register encodes CHOA.Play(lau) against the perimeter CHOA and DRYRUNs by default", async () => {
    setPendingLau(ACCT, LAU);
    // pre-registration shape: CHAN.Yan resolves the YUE, discovery has NOT landed
    const ctx = fakeCtx({
      snapshot: { ...ctxWithSnapshot().snapshot!, lau: null, yue: "0x2222222222222222222222222222222222222222" },
    });
    const out = await toolByName("register")!.execute({}, ctx);
    expect(out.mode).toBe("DRYRUN");
    expect((out.lau as string).toLowerCase()).toBe(LAU.toLowerCase());
    const req = ctx.__requests[0]!;
    expect(req.to!.toLowerCase()).toBe(addr("CHOA").toLowerCase());
    expect(req.data.slice(0, 10)).toBe(selector("Play(address)"));
    expect(req.data.slice(10).toLowerCase()).toContain(LAU.slice(2).toLowerCase());
  });

  it("register refuses without any LAU; a dead-RPC yue leg (unreadable ≠ absent) proceeds to the DRYRUN", async () => {
    const none = await toolByName("register")!.execute({}, fakeCtx());
    expect(none.error).toContain("you need a LAU first");
    setPendingLau(ACCT, LAU);
    // 65.1: the live leg on this dead rpcUrl FAILS — absence not proven, so
    // the gate DRYRUN arbitrates (the readable-null refusal is pinned in
    // planStaleness.test.ts)
    const out = await toolByName("register")!.execute({}, fakeCtx());
    expect(out.error).toBeUndefined();
    expect(out.mode).toBe("DRYRUN");
  });

  it("register answers the already-registered state without touching the gate", async () => {
    const ctx = ctxWithSnapshot(); // snapshot.lau set
    const out = await toolByName("register")!.execute({}, ctx);
    expect(out.ok).toBe(true);
    expect(out.registered).toBe(true);
    expect(ctx.__requests).toHaveLength(0);
  });

  it("register SEND announces the discovery flip + refreshes", async () => {
    setPendingLau(ACCT, LAU);
    const withYue = fakeCtx({
      snapshot: { ...ctxWithSnapshot().snapshot!, lau: null, yue: "0x2222222222222222222222222222222222222222" },
    });
    const out = await toolByName("register")!.execute({ send: true }, withYue);
    expect(out.status).toBe("sent");
    expect(String(out.note)).toContain("discovery");
    expect(withYue.__refreshes()).toBe(1);
  });
});

describe("session-66 dss_snipe (the world-channel write path, §7.4-fenced)", () => {
  const DSS = "0x5555555555555555555555555555555555555555" as `0x${string}`;

  it("rides the §7.4 opt-in with the chat family (OFF by default)", () => {
    expect(toolSpecs(false).map((t) => t.function.name)).not.toContain("dss_snipe");
    expect(toolSpecs(true).map((t) => t.function.name)).toContain("dss_snipe");
  });

  it("refuses when the opt-in is off even with a captured DSS", async () => {
    const ctx = fakeCtx({ chatToolsEnabled: false, dss: DSS });
    const out = await toolByName("dss_snipe")!.execute({ message: "hi" }, ctx);
    expect(out.error).toContain("§7.4");
  });

  it("refuses honestly when no DSS is captured (deploy first — the contract has no getter)", async () => {
    const ctx = fakeCtx({ chatToolsEnabled: true, snapshot: ctxWithSnapshot().snapshot! });
    const out = await toolByName("dss_snipe")!.execute({ message: "hi" }, ctx);
    expect(out.error).toContain("no DSS captured");
  });

  it("DRYRUN with a short/unreadable Ⓐ allowance previews the REAL two-leg path (session-69: the raw snipe preview reverts while short — never reads as a broken bundler)", async () => {
    const ctx = fakeCtx({ chatToolsEnabled: true, dss: DSS, snapshot: ctxWithSnapshot().snapshot! });
    const out = await toolByName("dss_snipe")!.execute({ message: "world hello" }, ctx);
    expect(out.mode).toBe("DRYRUN");
    expect(String(out.allowance)).toContain("short");
    expect(ctx.__requests).toHaveLength(2);
    const [approve, snipe] = ctx.__requests;
    expect(approve!.to!.toLowerCase()).toBe(addr("AFFECTION").toLowerCase());
    expect(approve!.data.slice(0, 10)).toBe("0x095ea7b3");
    expect(approve!.data.slice(-64)).toEqual((10n ** 18n).toString(16).padStart(64, "0")); // exact 1 Ⓐ
    expect(approve!.data.toLowerCase()).toContain(DSS.slice(2).toLowerCase()); // spender = the DSS
    expect(snipe!.to!.toLowerCase()).toBe(DSS.toLowerCase());
    expect(snipe!.data.slice(0, 10)).toBe(selector("chatAndSnipe(string)"));
    expect(snipe!.data.toLowerCase()).toContain("776f726c642068656c6c6f".slice(0, 12)); // the string arg rides
    expect(out.legs).toHaveLength(2);
    expect(String(out.note)).toContain("EXPECTED");
  });

  it("the 280-char fence applies (a public permanent line)", async () => {
    const ctx = fakeCtx({ chatToolsEnabled: true, dss: DSS, snapshot: ctxWithSnapshot().snapshot! });
    const out = await toolByName("dss_snipe")!.execute({ message: "x".repeat(281) }, ctx);
    expect(out.error).toContain("280");
  });

  it("send with an unreadable allowance (dead rpcUrl) issues the exact-1e18 APPROVE leg first, then the snipe", async () => {
    const ctx = fakeCtx({ chatToolsEnabled: true, dss: DSS, snapshot: ctxWithSnapshot().snapshot! });
    const out = await toolByName("dss_snipe")!.execute({ message: "snipe it", send: true }, ctx);
    expect(out.status).toBe("sent");
    expect(ctx.__requests).toHaveLength(2);
    const [approve, snipe] = ctx.__requests;
    expect(approve!.to!.toLowerCase()).toBe(addr("AFFECTION").toLowerCase());
    expect(approve!.data.slice(0, 10)).toBe("0x095ea7b3");
    expect(approve!.data.slice(-64)).toEqual((10n ** 18n).toString(16).padStart(64, "0")); // exact 1 Ⓐ
    expect(approve!.data.toLowerCase()).toContain(DSS.slice(2).toLowerCase()); // spender = the DSS
    expect(snipe!.to!.toLowerCase()).toBe(DSS.toLowerCase());
    expect(snipe!.data.slice(0, 10)).toBe(selector("chatAndSnipe(string)"));
    expect(out.legs).toHaveLength(2);
  });

  it("consults the FULL-AUTO chat cadence governor with its send intent", async () => {
    let sawSend: boolean | null = null;
    const ctx = fakeCtx({
      chatToolsEnabled: true,
      dss: DSS,
      snapshot: ctxWithSnapshot().snapshot!,
      chatGate: (send) => {
        sawSend = send;
        return { ok: false, error: "FULL-AUTO chat cadence governor: wait ~42s" };
      },
    });
    const out = await toolByName("dss_snipe")!.execute({ message: "hi", send: true }, ctx);
    expect(sawSend).toBe(true);
    expect(out.error).toContain("cadence");
    expect(ctx.__requests).toHaveLength(0);
  });

  it("get_state answers the captured dss", async () => {
    const ctx = fakeCtx({ chatToolsEnabled: true, dss: DSS, snapshot: ctxWithSnapshot().snapshot! });
    const out = await toolByName("get_state")!.execute({}, ctx);
    expect(out.dss).toEqual(DSS);
  });
});

describe("session-73 — the agent world-model round", () => {
  const SIRIN_LAU = "0xf9a5c1786f0a9522e51f78aee2ed0ff0fe80a699" as `0x${string}`;
  const SIRIN_QING = "0x651fcbae1fba264ce7aef0b9646c73b14a98bf3e";

  afterEach(() => {
    resetHomeVenueForTests();
  });

  it("stringifyBigints covers scalars, arrays, and nesting (the balanceOf 'unserializable BigInt' bug is dead)", async () => {
    const { stringifyBigints } = await import("@/agent/tools");
    expect(stringifyBigints(12345n)).toBe("12345");
    expect(stringifyBigints([1n, 2n])).toEqual(["1", "2"]);
    expect(stringifyBigints({ a: 7n, b: { c: 9n }, d: "x", e: true, f: null })).toEqual({ a: "7", b: { c: "9" }, d: "x", e: true, f: null });
    expect(JSON.stringify({ result: stringifyBigints(42n) })).toBe('{"result":"42"}');
  });

  it("search_venues finds the SIRIN venue from the REAL census (name + the asset index)", async () => {
    const out = await toolByName("search_venues")!.execute({ query: "sirin" }, fakeCtx());
    const hit = (out.rows as Array<{ a: string; n: string; asset: string | null }>).find((r) => r.n === "ΣΕΙΡΗΝ QING");
    expect(hit).toBeDefined();
    expect(hit!.asset).toBe(SIRIN_LAU);
    expect(hit!.a).toBe(SIRIN_QING);
  });

  it("search_venues answers exact-band queries and the empty-query head", async () => {
    const band = await toolByName("search_venues")!.execute({ query: "84", limit: 5 }, fakeCtx());
    expect(band.total).toBeGreaterThanOrEqual(1);
    // the empty-query HEAD: 24 default rows would ride past the tool-output
    // cap (capOutput's truncated shape carries no rows) — assert the total
    const head = await toolByName("search_venues")!.execute({ query: "" }, fakeCtx());
    expect(head.total).toBeGreaterThanOrEqual(940);
  });

  it("qingForAsset resolves via the seam: match, miss, and pre-73 rows without asset", async () => {
    const atlas = await import("@/state/atlas");
    type R = import("@/state/atlas").RenderRow;
    const row = (over: Partial<R>): R =>
      ({ a: "0xaaa", n: "x", s: "x", f: 0, band: 1, blk: 1, south: false, sys: false, w: "1", lon: 0, lat: 0, ln: 0, ...over }) as R;
    const rows = [row({ a: "0xq1", asset: "0xasset1" }), row({ a: "0xq2" }), row({ a: "0xq3", asset: "0xasset3" })];
    expect((await atlas.qingForAsset("0xASSET1", rows))!.a).toBe("0xq1");
    expect(await atlas.qingForAsset("0xnone", rows)).toBeNull();
    expect(await atlas.qingForAsset("0xq2", rows)).toBeNull(); // no asset field → honestly null
  });

  it("create_venue DRYRUN surfaces the EXISTING venue from a decoded QingAlreadyExists (the chain's asset→QING oracle)", async () => {
    const ctx = fakeCtx({
      gateDryRun: async (req) => ({
        request: req,
        cls: { risk: "standard", tier: "perimeter", gate: null, metered: false, reverts: [], contract: "MAP", functionSig: null },
        policy: { allowed: true, reasons: [], risk: "standard", tier: "perimeter", requiresExtraAck: false },
        sim: {
          ok: false,
          result: null,
          gas: null,
          error: { message: "execution reverted", decoded: `QingAlreadyExists(${SIRIN_LAU}, 0x651FCbaE1fba264ce7AEf0b9646c73B14A98BF3E)`, data: "0xc0136ba1" },
        },
      }),
    });
    const out = await toolByName("create_venue")!.execute({ asset: SIRIN_LAU }, ctx);
    expect(out.mode).toBe("DRYRUN");
    expect(out.existingVenue).toBe(SIRIN_QING);
    expect(out.simErrorDecoded).toContain("QingAlreadyExists");
  });

  it("get_state resolves the home QING from the CENSUS for pre-app accounts (the aged-account blind spot is dead)", async () => {
    resetHomeVenueForTests();
    const ctx = fakeCtx({ snapshot: { ...ctxWithSnapshot().snapshot!, lau: SIRIN_LAU } });
    const out = await toolByName("get_state")!.execute({}, ctx);
    expect(out.homeVenue).toBe(SIRIN_QING);
    expect(out.homeVenueSource).toBe("census");
  });

  it("get_state prefers the CAPTURED home QING when one exists", async () => {
    setHomeVenue(ACCT, { venue: "0x4444444444444444444444444444444444444444" as `0x${string}`, asset: SIRIN_LAU, waat: "1", txHash: null });
    const ctx = fakeCtx({ snapshot: { ...ctxWithSnapshot().snapshot!, lau: SIRIN_LAU } });
    const out = await toolByName("get_state")!.execute({}, ctx);
    expect(out.homeVenue).toBe("0x4444444444444444444444444444444444444444");
    expect(out.homeVenueSource).toBe("captured");
  });
});
