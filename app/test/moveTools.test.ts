import { beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, stringToBytes, toFunctionSelector } from "viem";
import { JournalBus } from "@/chain/journal";
import { addr } from "@config/addresses";
import { loadAbi } from "@/chain/abiLoad";
import { parseAmountToDecimals } from "@/chain/deskMath";
import { loadErc20Hold, _erc20MetaAbi } from "@/chain/moveReads";
import { pickFn } from "@/agent/toolShared";
import { toolByName, toolSpecs, type AgentToolContext } from "@/agent/tools";
import { _erc20TransferAbi } from "@/agent/moveTools";

/**
 * The wallet-custody agent tools (session-56, the LAU/YUE move story):
 * selector pins vs keccak, DRYRUN-first, the SINGLE-LEG send semantics (no
 * approve pattern applies — a transfer needs no allowance), the PLS value
 * mode, the "max" fill, decimals-generalized parsing, and the honesty
 * stories (pays-msg.sender, unmetered, gate class notes). Chain reads are
 * mocked at the LOADER seam (loadErc20Hold) — the same seam the manual
 * views test beneath.
 */

vi.mock("@/chain/moveReads", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadErc20Hold: vi.fn(),
}));
vi.mock("@/chain/client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  makeClient: () => ({ getBalance: async () => plsBalance }),
}));

const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as `0x${string}`;
const LAU = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const DEST = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const TOKEN = "0x84b000b1bbe072730e75f37415b7b0a47e6418c5" as `0x${string}`; // a non-perimeter ERC-20
const AFFECTION = addr("AFFECTION") as `0x${string}`;
const UNIT = 10n ** 18n;

let plsBalance = 5n * UNIT;

function selector(sig: string): string {
  return keccak256(stringToBytes(sig)).slice(0, 10);
}

interface RecordingCtx extends AgentToolContext {
  __requests: Array<{ to: string | null; data: string; value?: bigint | undefined; meta?: { source: "manual" | "agent"; label?: string | undefined } | undefined }>;
  __sendCount(): number;
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
      requests.push({ to: req.to, data: req.data, value: req.value, meta: req.meta });
      return {
        request: req,
        cls: { risk: "standard", tier: "perimeter", gate: null, metered: false, reverts: [], contract: "TEST", functionSig: null },
        policy: { allowed: true, reasons: [], risk: "standard", tier: "perimeter", requiresExtraAck: false },
        sim: { ok: true, result: "0x", gas: 60_000n, error: null },
      };
    },
    gateSend: async (req) => {
      sends += 1;
      requests.push({ to: req.to, data: req.data, value: req.value, meta: req.meta });
      return {
        status: "sent" as const,
        envelope: {} as never,
        txHash: `0xsend${sends}` as `0x${string}`,
        receipt: { status: "success" as const, gasUsed: 60_000n, logs: [], blockNumber: 27_674_001n, contractAddress: null },
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
  // NB: a getter would be flattened by Object.assign (snapshotted at 0) — a
  // reader function keeps the closure live
  return Object.assign(ctx, { __requests: requests, __sendCount: () => sends }) as RecordingCtx;
}

function snapshotWith(over: { lau?: `0x${string}` | null } = {}): AgentToolContext["snapshot"] {
  return {
    account: ACCT,
    lau: "lau" in over ? (over.lau ?? null) : LAU,
    yue: null,
    lauName: "Test Lau",
    lauSymbol: "TLAU",
    username: "captain",
    yueName: null,
    yueSymbol: null,
    balances: {
      pls: { wallet: 100n * UNIT, lau: 0n, yue: 0n },
      affection: { wallet: 10n * UNIT, lau: 3n * UNIT, yue: 0n },
      choa: { wallet: 0n, lau: 0n, yue: 0n },
    },
    yuanChoa: 0n,
    blockNumber: 27_674_000n,
    fetchedAt: Date.now(),
  };
}

function mockHold(over: { balance?: bigint | null; decimals?: number | null; symbol?: string | null; name?: string | null; errors?: string[] } = {}): void {
  vi.mocked(loadErc20Hold).mockResolvedValue({
    balance: "balance" in over ? (over.balance ?? null) : 10n * UNIT,
    decimals: "decimals" in over ? (over.decimals ?? null) : 18,
    symbol: "symbol" in over ? (over.symbol ?? null) : "TST",
    name: "name" in over ? (over.name ?? null) : "Test Token",
    errors: over.errors ?? [],
    blockNumber: 27_674_000n,
    fetchedAt: Date.now(),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  plsBalance = 5n * UNIT;
  mockHold();
});

describe("catalog + selectors", () => {
  it("ships both custody tools always advertised (no §7.4-style opt-in)", () => {
    const names = toolSpecs(false).map((t) => t.function.name);
    for (const n of ["move_tokens", "sweep_lau"]) {
      expect(names, `missing ${n}`).toContain(n);
    }
  });

  it("the hand-pinned transfer/meta fragments + the LAU Withdraw row match keccak", async () => {
    expect(toFunctionSelector(_erc20TransferAbi[0])).toBe(selector("transfer(address,uint256)"));
    expect(toFunctionSelector(_erc20TransferAbi[0])).toBe("0xa9059cbb");
    expect(toFunctionSelector(_erc20MetaAbi[0])).toBe(selector("balanceOf(address)"));
    expect(toFunctionSelector(_erc20MetaAbi[1])).toBe(selector("decimals()"));
    expect(toFunctionSelector(_erc20MetaAbi[2])).toBe(selector("symbol()"));
    expect(toFunctionSelector(_erc20MetaAbi[3])).toBe(selector("name()"));
    const lau = await loadAbi("LAU.json");
    expect(toFunctionSelector(pickFn(lau, "Withdraw", 2))).toBe(selector("Withdraw(address,uint256)"));
  });
});

describe("move_tokens — ERC-20 mode", () => {
  it("DRYRUNs by default: token.transfer(to, amount) with the preview riding along", async () => {
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("move_tokens")!.execute({ token: TOKEN, to: DEST, amount: "1.5" }, ctx);
    expect(out.mode).toBe("DRYRUN");
    expect(ctx.__requests).toHaveLength(1); // DRYRUN never sends
    const req = ctx.__requests[0]!;
    expect(req.to!.toLowerCase()).toBe(TOKEN.toLowerCase()); // the TOKEN contract is the tx target
    expect(req.data.slice(0, 10)).toBe("0xa9059cbb");
    expect(req.data.slice(10, 74).toLowerCase()).toBe(DEST.slice(2).toLowerCase().padStart(64, "0")); // word 1 = destination
    expect(req.data.slice(-64)).toBe((1_500_000_000_000_000_000n).toString(16).padStart(64, "0")); // word 2 = 1.5e18
    expect(String(out.gateClass)).toContain("unknown-contract"); // non-perimeter token honesty
    expect(String(out.tokenLabel)).toContain("TST");
  });

  it("send is a SINGLE leg — no approve pattern (a transfer needs no allowance)", async () => {
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("move_tokens")!.execute({ token: TOKEN, to: DEST, amount: "1", send: true }, ctx);
    expect(ctx.__sendCount()).toBe(1);
    expect(ctx.__requests).toHaveLength(1);
    expect(out.status).toBe("sent"); // top-level — the plan runner's send-stop reads THIS
    expect(String(out.refresh)).toContain("get_state");
    expect(ctx.__requests[0]!.meta?.source).toBe("agent");
  });

  it('"max" fills the whole live balance', async () => {
    mockHold({ balance: 7n * UNIT });
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("move_tokens")!.execute({ token: TOKEN, to: DEST, amount: "max", send: true }, ctx);
    expect(ctx.__requests[0]!.data.slice(-64)).toBe((7n * UNIT).toString(16).padStart(64, "0"));
    expect(String(out.amount)).toContain("max");
  });

  it("non-18-decimals tokens scale through the live decimals read", async () => {
    mockHold({ decimals: 6, balance: 2_000_000n });
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("move_tokens")!.execute({ token: TOKEN, to: DEST, amount: "1.5" }, ctx);
    expect(ctx.__requests[0]!.data.slice(-64)).toBe((1_500_000n).toString(16).padStart(64, "0")); // 1.5 × 10^6
    expect(out.decimals).toBe(6);
  });

  it("an unreadable decimals read falls back to 18 WITH the honesty warning", async () => {
    mockHold({ decimals: null });
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("move_tokens")!.execute({ token: TOKEN, to: DEST, amount: "1" }, ctx);
    expect(out.decimals).toBe(18);
    expect((out.warnings as string[]).join(" ")).toContain("assumed 18");
  });

  it("warns when the wallet is short and when the destination is the token contract itself", async () => {
    mockHold({ balance: 1n * UNIT });
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("move_tokens")!.execute({ token: TOKEN, to: TOKEN, amount: "2" }, ctx);
    const warnings = (out.warnings as string[]).join(" ");
    expect(warnings).toContain("DysnomiaInsufficientBalance");
    expect(warnings).toContain("TOKEN CONTRACT ITSELF");
  });

  it("fences the args (bad to / bad token / bad amount / max with no balance read)", async () => {
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    for (const args of [
      { token: TOKEN, to: "nope", amount: "1" },
      { token: "PLS", to: "nope", amount: "1" },
      { token: "not-a-token", to: DEST, amount: "1" },
      { token: TOKEN, to: DEST, amount: "abc" },
      { token: TOKEN, to: DEST, amount: "0" },
      { token: TOKEN, to: DEST, amount: "1.2.3" },
    ]) {
      const out = await toolByName("move_tokens")!.execute(args, ctx);
      expect(String(out.error), JSON.stringify(args)).toBeTruthy();
    }
    mockHold({ balance: null });
    const out = await toolByName("move_tokens")!.execute({ token: TOKEN, to: DEST, amount: "max" }, ctx);
    expect(String(out.error)).toContain("max");
    expect(ctx.__requests).toHaveLength(0);
  });

  it("Ⓐ carries its unknown-method honesty (facts interface covers only mint/burn)", async () => {
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("move_tokens")!.execute({ token: AFFECTION, to: DEST, amount: "1" }, ctx);
    expect(String(out.gateClass)).toContain("unknown-method");
    expect(String(out.gateClass)).toContain("mint/burn");
  });
});

describe("move_tokens — native PLS mode", () => {
  it("DRYRUNs by default: plain value tx, empty calldata, destination as target", async () => {
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("move_tokens")!.execute({ token: "pls", to: DEST, amount: "2.5" }, ctx);
    expect(out.mode).toBe("DRYRUN");
    const req = ctx.__requests[0]!;
    expect(req.to!.toLowerCase()).toBe(DEST.toLowerCase());
    expect(req.data).toBe("0x");
    expect(req.value).toBe(2_500_000_000_000_000_000n);
    expect(String(out.token)).toContain("PLS");
  });

  it("send carries value + the policy-cap note; max fills the live balance and warns about gas", async () => {
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("move_tokens")!.execute({ token: "PLS", to: DEST, amount: "max", send: true }, ctx);
    expect(ctx.__requests[0]!.value).toBe(5n * UNIT);
    expect(out.status).toBe("sent");
    expect((out.notes as string[]).join(" ")).toContain("value caps");
    expect((out.notes as string[]).join(" ")).toContain("gas");
  });
});

describe("sweep_lau", () => {
  it("refuses without a LAU (the pocket lives on it)", async () => {
    const ctx = fakeCtx({ snapshot: snapshotWith({ lau: null }) });
    const out = await toolByName("sweep_lau")!.execute({ token: "AFFECTION", amount: "1" }, ctx);
    expect(String(out.error)).toContain("LAU");
  });

  it("DRYRUNs by default: LAU.Withdraw(what, amount) on YOUR LAU, pays-msg.sender honesty rides along", async () => {
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("sweep_lau")!.execute({ token: "AFFECTION", amount: "2" }, ctx);
    expect(out.mode).toBe("DRYRUN");
    expect(ctx.__requests).toHaveLength(1);
    const req = ctx.__requests[0]!;
    expect(req.to!.toLowerCase()).toBe(LAU.toLowerCase());
    expect(req.data.slice(0, 10)).toBe(selector("Withdraw(address,uint256)"));
    expect(req.data.slice(10, 74).toLowerCase()).toBe(AFFECTION.slice(2).toLowerCase().padStart(64, "0")); // word 1 = the token
    expect(req.data.slice(-64)).toBe((2n * UNIT).toString(16).padStart(64, "0"));
    expect(String(out.pays)).toContain("msg.sender");
    expect(out.metered).toBe(false); // unmetered — fork-pinned session-53
    expect(String(out.gateClass)).toContain("unknown-contract");
  });

  it('"max" fills the LAU\'s full holding (the loader reads the LAU as holder)', async () => {
    mockHold({ balance: 3n * UNIT });
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("sweep_lau")!.execute({ token: "CHOA", amount: "max", send: true }, ctx);
    expect(vi.mocked(loadErc20Hold).mock.calls[0]![2].toLowerCase()).toBe(LAU.toLowerCase()); // holder = the LAU
    expect(ctx.__requests[0]!.data.slice(10, 74).toLowerCase()).toBe((addr("CHOA") as string).slice(2).toLowerCase().padStart(64, "0"));
    expect(ctx.__requests[0]!.data.slice(-64)).toBe((3n * UNIT).toString(16).padStart(64, "0"));
    expect(out.status).toBe("sent");
    expect(ctx.__sendCount()).toBe(1); // single leg
  });

  it("custom token addresses pass through; named presets resolve through config", async () => {
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    await toolByName("sweep_lau")!.execute({ token: TOKEN, amount: "1" }, ctx);
    expect(ctx.__requests[0]!.data.slice(10, 74).toLowerCase()).toBe(TOKEN.slice(2).toLowerCase().padStart(64, "0"));
  });

  it("fences the token arg and refuses a max against an unreadable holding", async () => {
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("sweep_lau")!.execute({ token: "bogus", amount: "1" }, ctx);
    expect(String(out.error)).toContain("token");
    mockHold({ balance: null });
    const out2 = await toolByName("sweep_lau")!.execute({ token: "CHOA", amount: "max" }, ctx);
    expect(String(out2.error)).toContain("max");
    expect(ctx.__requests).toHaveLength(0);
  });

  it("warns when the LAU holds less than the sweep amount", async () => {
    mockHold({ balance: 1n * UNIT });
    const ctx = fakeCtx({ snapshot: snapshotWith() });
    const out = await toolByName("sweep_lau")!.execute({ token: "CHOA", amount: "2" }, ctx);
    expect((out.warnings as string[]).join(" ")).toContain("DysnomiaInsufficientBalance");
  });
});

describe("parseAmountToDecimals (the deskMath generalization)", () => {
  it("parses and rejects at the right boundaries per decimals", () => {
    expect(parseAmountToDecimals("1.5", 6)).toBe(1_500_000n);
    expect(parseAmountToDecimals("1.5", 18)).toBe(1_500_000_000_000_000_000n);
    expect(parseAmountToDecimals("0.0000001", 6)).toBeNull(); // 7 frac digits > 6
    expect(parseAmountToDecimals("0.0000001", 18)).toBe(100_000_000_000n);
    expect(parseAmountToDecimals("abc", 18)).toBeNull();
    expect(parseAmountToDecimals("1", 99)).toBeNull(); // absurd decimals refused
  });
});
