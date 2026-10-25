import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { JournalBus } from "@/chain/journal";
import { resetPendingLauForTests, setPendingLau } from "@/state/pendingLau";
import { toolByName, type AgentToolContext } from "@/agent/tools";

/**
 * The mid-plan staleness guards (session-64.1 — the owner's run finding):
 * the plan runner executes its whole checklist with ONE ctx whose snapshot
 * is FROZEN at approval time, so a step chained after a send must resolve
 * the discovery LIVE (CHO.GetUserTokenAddress + CHAN.Yan) instead of
 * refusing on facts that are already onchain. The client seam is mocked
 * here (this file only — the dead-RPC rows live in agentTools.test.ts).
 *
 * Session-65.1 rows: the owner's SECOND run hit the same refusal when the
 * live read itself FAILED (a transient RPC blip swallowed by the catch) —
 * UNREADABLE ≠ ABSENT: a failed leg falls through to the gate DRYRUN (the
 * arbiter), only a leg that READS null refuses.
 */

const ZERO = "0x0000000000000000000000000000000000000000";
const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as Address;
const LAU = "0x1111111111111111111111111111111111111111" as Address;
const YUE = "0x2222222222222222222222222222222222222222" as Address;
const VENUE = "0xb0ba7d36b7f0505879179ece7401f24eb653c6e1" as Address; // Phobos (config-pinned)

/** the live answers the mocked chain gives (patched per test) */
let liveLau: string = ZERO;
let liveYue: string = ZERO;
/** 65.1: per-leg READ FAILURES — unreadable ≠ absent */
let failLau: boolean = false;
let failYue: boolean = false;

vi.mock("@/chain/client", () => ({
  makeClient: () => ({
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "GetUserTokenAddress") {
        if (failLau) throw new Error("transient rpc blip (lau leg)");
        return liveLau;
      }
      if (functionName === "Yan") {
        if (failYue) throw new Error("transient rpc blip (yue leg)");
        return liveYue;
      }
      throw new Error(`unexpected read ${functionName}`);
    },
  }),
}));


function staleCtx(snapshot: AgentToolContext["snapshot"]): AgentToolContext {
  return {
    rpcUrl: "http://mocked",
    account: ACCT,
    snapshot, // the FROZEN pre-send snapshot
    journal: new JournalBus(),
    walletMode: "C",
    chatToolsEnabled: false,
    gateDryRun: async (req) => ({
      request: req,
      cls: { risk: "standard", tier: "perimeter", gate: null, metered: false, reverts: [], contract: "TEST", functionSig: null },
      policy: { allowed: true, reasons: [], risk: "standard", tier: "perimeter", requiresExtraAck: false },
      sim: { ok: true, result: "0x", gas: 500_000n, error: null },
    }),
    gateSend: async () => ({ status: "no-signer" }),
    refreshSnapshot: () => {},
    takeNote: () => {},
    simToolsEnabled: false,
  };
}

beforeEach(() => {
  resetPendingLauForTests();
  liveLau = ZERO;
  liveYue = ZERO;
  failLau = false;
  failYue = false;
});

afterEach(() => {
  resetPendingLauForTests();
});

describe("register: the step after start_yue must see the YUE it just created", () => {
  it("proceeds on the LIVE YUE read when the frozen snapshot still says none (the owner's exact run)", async () => {
    setPendingLau(ACCT, LAU);
    liveYue = YUE; // CHAN.Yan answers: the YUE start_yue just created
    const out = await toolByName("register")!.execute({}, staleCtx(null));
    expect(out.error).toBeUndefined();
    expect(out.mode).toBe("DRYRUN");
    expect((out.lau as string).toLowerCase()).toBe(LAU.toLowerCase());
  });

  it("still refuses when the live read ALSO says no YUE (the honest gate)", async () => {
    setPendingLau(ACCT, LAU);
    const out = await toolByName("register")!.execute({}, staleCtx(null));
    expect(out.error).toContain("YUE");
  });

  it("answers already-registered from the LIVE discovery when the snapshot pre-dates Play", async () => {
    liveLau = LAU; // CHO.GetUserTokenAddress answers: Play landed
    const out = await toolByName("register")!.execute({}, staleCtx(null));
    expect(out.ok).toBe(true);
    expect(out.registered).toBe(true);
  });

  it("65.1: a FAILED yue leg never masquerades as 'no YUE' — the DRYRUN arbitrates (the owner's second run)", async () => {
    setPendingLau(ACCT, LAU);
    failYue = true; // the live read blipped — absence NOT proven
    const out = await toolByName("register")!.execute({}, staleCtx(null));
    expect(out.error).toBeUndefined();
    expect(out.mode).toBe("DRYRUN"); // the gate DRYRUN decodes the real revert class
    expect((out.lau as string).toLowerCase()).toBe(LAU.toLowerCase());
  });

  it("65.1: one leg failing does not mask the other — a readable LAU still answers already-registered", async () => {
    failYue = true;
    liveLau = LAU; // Play actually landed; only the Yan read blipped
    const out = await toolByName("register")!.execute({}, staleCtx(null));
    expect(out.ok).toBe(true);
    expect(out.registered).toBe(true);
  });
});

describe("settle_venue: the step after start_yue must see the YUE", () => {
  it("passes the guard on the live read (the DRYRUN follows)", async () => {
    liveYue = YUE;
    const out = await toolByName("settle_venue")!.execute({ address: VENUE }, staleCtx(null));
    expect(out.error).toBeUndefined();
    expect(out.mode).toBe("DRYRUN");
    expect(out.venue).toBe(VENUE);
  });

  it("65.1: a FAILED yue leg proceeds to the DRYRUN instead of refusing (unreadable ≠ absent)", async () => {
    failYue = true;
    const out = await toolByName("settle_venue")!.execute({ address: VENUE }, staleCtx(null));
    expect(out.error).toBeUndefined();
    expect(out.mode).toBe("DRYRUN");
  });
});

describe("join_venue: the step after register must see the registered LAU", () => {
  it("resolves the LIVE discovery when the frozen snapshot pre-dates Play", async () => {
    liveLau = LAU;
    const out = await toolByName("join_venue")!.execute({ address: VENUE }, staleCtx(null));
    expect(out.error).toBeUndefined();
    expect(out.mode).toBe("DRYRUN");
    expect(out.venue).toBe(VENUE);
  });

  it("65.1: a FAILED lau leg falls back to the pending LAU (the same token when registration landed) — DRYRUN arbitrates", async () => {
    setPendingLau(ACCT, LAU);
    failLau = true;
    const out = await toolByName("join_venue")!.execute({ address: VENUE }, staleCtx(null));
    expect(out.error).toBeUndefined();
    expect(out.mode).toBe("DRYRUN");
  });

  it("65.1: a failed lau leg with NO LAU anywhere still refuses honestly", async () => {
    failLau = true;
    const out = await toolByName("join_venue")!.execute({ address: VENUE }, staleCtx(null));
    expect(out.error).toContain("LAU");
  });
});
