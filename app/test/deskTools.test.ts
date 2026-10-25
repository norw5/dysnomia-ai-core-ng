import { beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, stringToBytes, toFunctionSelector } from "viem";
import { JournalBus } from "@/chain/journal";
import { setCurrentVenue } from "@/state/venueStore";
import { toolByName, toolSpecs, type AgentToolContext } from "@/agent/tools";
import { _erc20ApproveAbi } from "@/agent/deskTools";
import { loadVenueState } from "@/chain/venueState";
import { loadVenuePurchaseLeg, loadVenueRedeemLeg, loadYueDesk } from "@/chain/yueDesk";

/**
 * The MARKET desk agent tools (session-55): selector pins vs keccak, the
 * DRYRUN-first semantics, the auto-approve-when-short owner decision (one
 * call may issue TWO gate sends — approve leg first, main leg skipped when
 * the approve does not land), the no-rate / no-route honest refusals, and
 * the fork-pinned honesty stories riding the results (thin escrow, thin
 * pot, vault counterparty). Chain reads are mocked at the LOADER seam —
 * the same loaders the manual views test with fake clients.
 */

vi.mock("@/chain/venueState", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadVenueState: vi.fn(),
}));
vi.mock("@/chain/yueDesk", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadYueDesk: vi.fn(),
  loadVenueRedeemLeg: vi.fn(),
  loadVenuePurchaseLeg: vi.fn(),
}));

const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as `0x${string}`;
const YUE = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const VENUE = "0xb0ba7d36b7f0505879179ece7401f24eb653c6e1" as `0x${string}`; // Phobos (config-pinned)
const ASSET = "0x81a6923ca480fada78cb15254c8d8cc382d2fbc0" as `0x${string}`;
const AFFECTION = "0x24f0154c1dce548adf15da2098fdd8b8a3b8151d" as `0x${string}`;
const UNIT = 10n ** 18n;

function selector(sig: string): string {
  return keccak256(stringToBytes(sig)).slice(0, 10);
}

interface RecordingCtx extends AgentToolContext {
  __requests: Array<{ to: string | null; data: string; meta?: { source: "manual" | "agent"; label?: string | undefined } | undefined }>;
  __sends: number;
}

function fakeCtx(overrides: Partial<AgentToolContext> = {}): RecordingCtx {
  const requests: RecordingCtx["__requests"] = [];
  let sends = 0;
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
        sim: { ok: true, result: "0x", gas: 200_000n, error: null },
      };
    },
    gateSend: async (req) => {
      sends += 1;
      requests.push({ to: req.to, data: req.data, meta: req.meta });
      return {
        status: "sent" as const,
        envelope: {} as never,
        txHash: `0xsend${sends}`,
        receipt: { status: "success" as const, gasUsed: 120_000n, logs: [], blockNumber: 27_674_001n, contractAddress: null },
        receiptError: null,
        movements: [],
        capBreaches: [],
      };
    },
    refreshSnapshot: () => {},
    takeNote: () => {},
    simToolsEnabled: false,
    ...overrides,
  };
  return Object.assign(ctx, { __requests: requests, get __sends() { return sends; } }) as RecordingCtx;
}

function snapshotWith(over: { yue?: `0x${string}` | null; walletAffection?: bigint } = {}): AgentToolContext["snapshot"] {
  return {
    account: ACCT,
    lau: "0x1111111111111111111111111111111111111111" as `0x${string}`,
    yue: over.yue ?? null,
    lauName: "Test Lau",
    lauSymbol: "TLAU",
    username: "captain",
    yueName: null,
    yueSymbol: null,
    balances: {
      pls: { wallet: 100n, lau: 0n, yue: 0n },
      affection: { wallet: over.walletAffection ?? 10n * UNIT, lau: 0n, yue: 0n },
      choa: { wallet: 0n, lau: 0n, yue: 0n },
    },
    yuanChoa: 0n,
    blockNumber: 27_674_000n,
    fetchedAt: Date.now(),
  };
}

// ---- the loader mocks (the loader seam the manual views test beneath) ----

function mockVenueState(over: { rate?: bigint | null; known?: boolean; asset?: `0x${string}` | null } = {}): void {
  vi.mocked(loadVenueState).mockResolvedValue({
    venue: VENUE,
    waat: 1n,
    asset: over.asset ?? ASSET,
    entropy: 0n,
    totalSupply: 100n,
    coverCharge: 0n,
    bouncerDivisor: 0n,
    marketRateAffection: over.rate ?? UNIT,
    marketRateKnown: over.known ?? true,
    admitted: true,
    myBalance: 5n * UNIT,
    gwat: false,
    noCrows: false,
    myBouncer: false,
    myOwner: false,
    myHypobar: null,
    myEpibar: null,
    assetOwnerPass: null,
    assetIsUserToken: false,
    errors: [],
    blockNumber: 27_674_000n,
    fetchedAt: Date.now(),
  } as never);
}

function mockPurchaseLeg(allowance: bigint | null): void {
  vi.mocked(loadVenuePurchaseLeg).mockResolvedValue({
    affectionAllowance: allowance,
    errors: [],
    blockNumber: 27_674_000n,
    fetchedAt: Date.now(),
  } as never);
}

function mockRedeemLeg(over: { escrow?: bigint; selfAllowance?: bigint; myQing?: bigint } = {}): void {
  vi.mocked(loadVenueRedeemLeg).mockResolvedValue({
    affectionEscrow: over.escrow ?? 10n * UNIT,
    selfAllowance: over.selfAllowance ?? 0n,
    myQing: over.myQing ?? 5n * UNIT,
    errors: [],
    blockNumber: 27_674_000n,
    fetchedAt: Date.now(),
  } as never);
}

function mockYueDesk(over: { rate?: bigint; pairValid?: boolean; yueQingPot?: bigint; yueAssetPot?: bigint; myQing?: bigint; myAsset?: bigint; qingAllowance?: bigint; assetAllowance?: bigint } = {}): void {
  vi.mocked(loadYueDesk).mockResolvedValue({
    rate: over.rate ?? UNIT,
    pairValid: over.pairValid ?? true,
    yueQingPot: over.yueQingPot ?? 100n * UNIT,
    yueAssetPot: over.yueAssetPot ?? 100n * UNIT,
    myQing: over.myQing ?? 50n * UNIT,
    myAsset: over.myAsset ?? 50n * UNIT,
    qingAllowance: over.qingAllowance ?? 0n,
    assetAllowance: over.assetAllowance ?? 0n,
    errors: [],
    blockNumber: 27_674_000n,
    fetchedAt: Date.now(),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVenueState();
  mockPurchaseLeg(0n);
  mockRedeemLeg();
  mockYueDesk();
});

describe("catalog + selectors", () => {
  it("ships the four desk tools always advertised (no §7.4-style opt-in)", () => {
    const names = toolSpecs(false).map((t) => t.function.name);
    for (const n of ["purchase_affection", "redeem_affection", "exchange_hong", "exchange_hung"]) {
      expect(names, `missing ${n}`).toContain(n);
    }
    expect(names).toContain("purchase_affection");
  });

  it("the hand-pinned approve fragment + the desk selectors match keccak", () => {
    expect(toFunctionSelector(_erc20ApproveAbi[0])).toBe(selector("approve(address,uint256)"));
    expect(toFunctionSelector(_erc20ApproveAbi[0])).toBe("0x095ea7b3");
    expect(selector("Purchase(address,uint256)")).toBe("0x2499a533");
    expect(selector("Redeem(address,uint256)")).toBe("0x222838db");
    expect(selector("Hong(address,address,uint256)")).toBe("0xb3bde122");
    expect(selector("Hung(address,address,uint256)")).toBe("0x518945cd");
  });
});

describe("purchase_affection", () => {
  it("DRYRUNs by default: QING.Purchase(AFFECTION, amount) on the venue, preview rides along", async () => {
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("purchase_affection")!.execute({ address: VENUE, amount: "1.5" }, ctx);
    expect(out.mode).toBe("DRYRUN");
    expect(ctx.__requests).toHaveLength(1); // DRYRUN never auto-approves
    const req = ctx.__requests[0]!;
    expect(req.to!.toLowerCase()).toBe(VENUE.toLowerCase());
    expect(req.data.slice(0, 10)).toBe("0x2499a533");
    expect(req.data.toLowerCase()).toContain(AFFECTION.slice(2).toLowerCase());
    expect(out.cost).toContain("1.5"); // 1.5 × 1.0 rate
    expect(out.needsApprove).toBe(true); // allowance 0
  });

  it("send with a short allowance issues the exact-amount APPROVE then the Purchase (the owner two-leg decision)", async () => {
    mockPurchaseLeg(0n);
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("purchase_affection")!.execute({ address: VENUE, amount: "2", send: true }, ctx);
    expect(ctx.__requests).toHaveLength(2);
    const [approve, purchase] = ctx.__requests;
    expect(approve!.to!.toLowerCase()).toBe(AFFECTION.toLowerCase());
    expect(approve!.data.slice(0, 10)).toBe("0x095ea7b3");
    expect(approve!.data.toLowerCase()).toContain(VENUE.slice(2).toLowerCase()); // spender = the venue
    expect(approve!.data.slice(-64)).toBe((2n * UNIT).toString(16).padStart(64, "0")); // exact cost
    expect(purchase!.data.slice(0, 10)).toBe("0x2499a533");
    expect(out.status).toBe("sent"); // top-level: the plan runner's send-stop reads THIS, not the legs
    expect(out.legs).toHaveLength(2);
    expect((out.legs as Array<{ status: string }>)[1]!.status).toBe("sent");
    expect(String(out.budgetNote)).toContain("2 txs"); // the L2 cap honesty
  });

  it("send with a sufficient allowance is a single Purchase leg", async () => {
    mockPurchaseLeg(100n * UNIT);
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    await toolByName("purchase_affection")!.execute({ address: VENUE, amount: "1", send: true }, ctx);
    expect(ctx.__requests).toHaveLength(1);
    expect(ctx.__requests[0]!.data.slice(0, 10)).toBe("0x2499a533");
  });

  it("a failed approve leg SKIPS the purchase (never sends past a broken prerequisite)", async () => {
    const ctx = fakeCtx({
      snapshot: snapshotWith(),
      gateSend: async (req) => {
        return req.data.slice(0, 10) === "0x095ea7b3"
          ? { status: "denied" as const, envelope: {} as never, reasons: ["policy cap"] }
          : { status: "sent" as const, envelope: {} as never, txHash: "0xbad" as `0x${string}`, receipt: null, receiptError: null, movements: [], capBreaches: [] };
      },
    });
    const out = await toolByName("purchase_affection")!.execute({ address: VENUE, amount: "1", send: true }, ctx);
    const legs = out.legs as Array<{ leg: string; status: string; token: string; spender: string; exactAmount: string; reasons?: string[] }>;
    expect(legs).toHaveLength(1);
    expect(legs[0]!.leg).toBe("approve-allowance");
    expect(legs[0]!.status).toBe("denied");
    expect(out.status).toBe("denied"); // the top-level mirrors the last attempted leg → the plan stops on it
    expect(legs[0]!.token.toLowerCase()).toBe(AFFECTION);
    expect(legs[0]!.spender.toLowerCase()).toBe(VENUE);
    expect(legs[0]!.exactAmount).toBe((1n * UNIT).toString());
    expect(legs[0]!.reasons).toEqual(["policy cap"]);
    expect(String(out.note)).toContain("did not send");
  });

  it("refuses honestly on a venue with no Ⓐ rate (MarketRateNotFound)", async () => {
    mockVenueState({ known: false, rate: null });
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("purchase_affection")!.execute({ address: VENUE, amount: "1", send: true }, ctx);
    expect(String(out.error)).toContain("MarketRateNotFound");
    expect(ctx.__requests).toHaveLength(0);
  });

  it("fences the amount arg (decimal, > 0)", async () => {
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    for (const bad of ["abc", "0", "-1", "1.2.3"]) {
      const out = await toolByName("purchase_affection")!.execute({ address: VENUE, amount: bad }, ctx);
      expect(String(out.error), bad).toContain("amount");
    }
    expect(ctx.__requests).toHaveLength(0);
  });
});

describe("redeem_affection", () => {
  it("DRYRUNs by default and renders the thin-escrow honesty when the escrow is short", async () => {
    mockRedeemLeg({ escrow: 0n, selfAllowance: 0n, myQing: 5n * UNIT });
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("redeem_affection")!.execute({ address: VENUE, amount: "2" }, ctx);
    expect(out.mode).toBe("DRYRUN");
    expect(ctx.__requests[0]!.data.slice(0, 10)).toBe("0x222838db");
    expect((out.warnings as string[]).join(" ")).toContain("THIN ESCROW");
  });

  it("send self-approves with spender == THE VENUE ITSELF (the quirk stays in code)", async () => {
    mockRedeemLeg({ selfAllowance: 0n });
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("redeem_affection")!.execute({ address: VENUE, amount: "1", send: true }, ctx);
    expect(ctx.__requests).toHaveLength(2);
    const approve = ctx.__requests[0]!;
    expect(approve.to!.toLowerCase()).toBe(VENUE.toLowerCase()); // the venue-token approve targets the venue token...
    expect(approve.data.slice(34, 74).toLowerCase()).toBe(VENUE.slice(2).toLowerCase()); // ...and encodes the venue as spender (word 1)
    expect(approve.data.slice(0, 10)).toBe("0x095ea7b3");
    expect(ctx.__requests[1]!.data.slice(0, 10)).toBe("0x222838db");
    expect((out.legs as Array<{ leg: string }>)[0]!.leg).toBe("approve-allowance");
    expect(String(out.budgetNote)).toContain("2 txs");
  });
});

describe("exchange_hong", () => {
  it("refuses without a YUE (the desk lives ON the vault)", async () => {
    const ctx = fakeCtx({ snapshot: snapshotWith({ yue: null }) });
    const out = await toolByName("exchange_hong")!.execute({ address: VENUE, amount: "1" }, ctx);
    expect(String(out.error)).toContain("YUE");
  });

  it("DRYRUN encodes YUE.Hong(asset, venue, amount) in that arg order", async () => {
    const ctx = fakeCtx({ snapshot: snapshotWith({ yue: YUE }) });
    const out = await toolByName("exchange_hong")!.execute({ address: VENUE, amount: "1" }, ctx);
    expect(out.mode).toBe("DRYRUN");
    const req = ctx.__requests[0]!;
    expect(req.to!.toLowerCase()).toBe(YUE.toLowerCase());
    expect(req.data.slice(0, 10)).toBe("0xb3bde122");
    const w1 = req.data.slice(10, 74).toLowerCase(); // word 1 = the SPEND asset
    const w2 = req.data.slice(74, 138).toLowerCase(); // word 2 = the venue
    expect(w1).toBe(ASSET.slice(2).toLowerCase().padStart(64, "0"));
    expect(w2).toBe(VENUE.slice(2).toLowerCase().padStart(64, "0"));
    expect(String(out.counterparty)).toContain("vault is the counterparty");
  });

  it("send approves the wrapped ASSET → the YUE, then Hong", async () => {
    mockYueDesk({ assetAllowance: 0n });
    const ctx = fakeCtx({ snapshot: snapshotWith({ yue: YUE }) });
    const out = await toolByName("exchange_hong")!.execute({ address: VENUE, amount: "1", send: true }, ctx);
    expect(ctx.__requests).toHaveLength(2);
    expect(ctx.__requests[0]!.to!.toLowerCase()).toBe(ASSET.toLowerCase());
    expect(ctx.__requests[0]!.data.toLowerCase()).toContain(YUE.slice(2).toLowerCase()); // spender = the YUE
    expect(ctx.__requests[1]!.data.slice(0, 10)).toBe("0xb3bde122");
    expect((out.warnings as string[]).join(" ")).not.toContain("THIN POT"); // 100-token pot vs 1
  });

  it("renders the THIN POT honesty when the vault's own venue-token pot is short", async () => {
    mockYueDesk({ yueQingPot: 0n });
    const ctx = fakeCtx({ snapshot: snapshotWith({ yue: YUE }) });
    const out = await toolByName("exchange_hong")!.execute({ address: VENUE, amount: "1" }, ctx);
    expect((out.warnings as string[]).join(" ")).toContain("THIN POT");
  });
});

describe("exchange_hung", () => {
  it("DRYRUN encodes YUE.Hung(venue, asset, amount) in that arg order (the legs swap vs Hong)", async () => {
    const ctx = fakeCtx({ snapshot: snapshotWith({ yue: YUE }) });
    const out = await toolByName("exchange_hung")!.execute({ address: VENUE, amount: "1" }, ctx);
    expect(out.mode).toBe("DRYRUN");
    const req = ctx.__requests[0]!;
    expect(req.data.slice(0, 10)).toBe("0x518945cd");
    expect(req.data.slice(10, 74).toLowerCase()).toBe(VENUE.slice(2).toLowerCase().padStart(64, "0")); // word 1 = the VENUE
    expect(req.data.slice(74, 138).toLowerCase()).toBe(ASSET.slice(2).toLowerCase().padStart(64, "0")); // word 2 = the asset
  });

  it("a 0 GetAssetRate is the honest NO-ROUTE refusal — nothing reaches the gate", async () => {
    mockYueDesk({ rate: 0n });
    const ctx = fakeCtx({ snapshot: snapshotWith({ yue: YUE }) });
    const out = await toolByName("exchange_hung")!.execute({ address: VENUE, amount: "1", send: true }, ctx);
    expect(String(out.error)).toContain("NO ROUTE");
    expect(String(out.error)).toContain("ExchangeRateNotFound");
    expect(ctx.__requests).toHaveLength(0);
  });

  it("send approves the VENUE TOKEN → the YUE, then Hung; the payout is the rate-scaled cost", async () => {
    mockYueDesk({ qingAllowance: 0n, yueAssetPot: 2n * UNIT });
    const ctx = fakeCtx({ snapshot: snapshotWith({ yue: YUE }) });
    const out = await toolByName("exchange_hung")!.execute({ address: VENUE, amount: "1", send: true }, ctx);
    expect(ctx.__requests).toHaveLength(2);
    expect(ctx.__requests[0]!.to!.toLowerCase()).toBe(VENUE.toLowerCase());
    expect(ctx.__requests[0]!.data.slice(0, 10)).toBe("0x095ea7b3");
    expect(ctx.__requests[1]!.data.slice(0, 10)).toBe("0x518945cd");
    expect(String(out.youReceive)).toContain("1"); // 1 × 1.0 rate of the asset
  });

  it("the thin-pot check compares the asset pot against the rate-scaled payout, not the raw amount", async () => {
    // GetAssetRate 3.0: 1 venue token redeems into 3.0 asset — a pot of 2 is short
    // even though 2 > the raw amount 1
    mockYueDesk({ qingAllowance: 10n * UNIT, yueAssetPot: 2n * UNIT, rate: 3n * UNIT });
    const ctx = fakeCtx({ snapshot: snapshotWith({ yue: YUE }) });
    const out = await toolByName("exchange_hung")!.execute({ address: VENUE, amount: "1" }, ctx);
    expect((out.warnings as string[]).join(" ")).toContain("THIN POT");
  });
});

describe("venue resolution + journal", () => {
  it("the desk tools resolve the app-global current venue (no address arg)", async () => {
    setCurrentVenue({ a: VENUE, n: "phobos", s: "PHOBOS", lat: 0.1, band: 30, blk: 27_000_000 });
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("purchase_affection")!.execute({ amount: "1" }, ctx);
    expect(out.venue).toBe(VENUE);
    setCurrentVenue(null);
  });

  it("every desk send carries meta.source=agent (the gate journal distinguishes them)", async () => {
    const seen: unknown[] = [];
    const ctx = fakeCtx({
      snapshot: snapshotWith(),
      gateSend: async (req) => {
        seen.push(req.meta);
        return { status: "sent" as const, envelope: {} as never, txHash: "0x1" as `0x${string}`, receipt: null, receiptError: null, movements: [], capBreaches: [] };
      },
    });
    await toolByName("purchase_affection")!.execute({ address: VENUE, amount: "1", send: true }, ctx);
    expect(seen).toHaveLength(2);
    for (const meta of seen as Array<{ source: string }>) {
      expect(meta.source).toBe("agent");
    }
  });
});
