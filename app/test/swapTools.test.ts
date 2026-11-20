import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, toFunctionSelector, type Address } from "viem";
import { JournalBus } from "@/chain/journal";
import { addr, WPLS } from "@config/addresses";
import { loadSwapQuote, SWAP_ROUTER } from "@/chain/swap";
import { resetPendingLauForTests, setPendingLau } from "@/state/pendingLau";
import { toolByName, toolSpecs, type AgentToolContext } from "@/agent/tools";
import { _swapRouterAbi } from "@/chain/swap";

/**
 * swap_pls_for_token (session-83): DRYRUN-first exact-output through THE
 * gate, the native-value route's ZERO approve legs, recipient semantics
 * (wallet/lau/yue/address — the pending-LAU window included), the price
 * impact + maxPls guards, the seed-floor warnings, and the honest read
 * failures. The quote loader is mocked at its module seam; its own chain
 * behavior is swap.test.ts + the harness.
 */

vi.mock("@/chain/swap", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadSwapQuote: vi.fn(),
}));
vi.mock("@/chain/client", () => ({
  makeClient: () => ({
    getBalance: async () => WALLET_PLS,
    readContract: async () => DECIMALS,
  }),
}));

const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as Address;
const LAU = "0x1111111111111111111111111111111111111111" as Address;
const YUE = "0x4444444444444444444444444444444444444444" as Address;
const PAIR = "0xa55898a7159f3f0f592e8ea77ccacc5ba4dde9d7" as Address;
const FOMAL = addr("WorldChatSHIO") as Address;
const UNIT = 10n ** 18n;

let WALLET_PLS = 100_000n * UNIT;
let DECIMALS = 18;
let quoteInWei = 754_507n;
let quoteImpactBps: number | null = 28;

function baseQuote(over: Partial<Awaited<ReturnType<typeof loadSwapQuote>>> = {}): Awaited<ReturnType<typeof loadSwapQuote>> {
  return {
    token: FOMAL,
    tokenLabel: "Fomalhaute (WorldChatSHIO)",
    symbol: "SHIO",
    name: "WorldChatSHIO",
    decimals: 18,
    amountOutWei: 2n,
    amountInWei: quoteInWei,
    pair: PAIR,
    token0: FOMAL,
    reserveInWei: 10_396_380_842_148_617_437_714_048n,
    reserveOutWei: 27_638_259_713_817_574_305n,
    spotInWei: 752_376_273_959_569_910n,
    priceImpactBps: quoteImpactBps,
    blockNumber: 27_674_000n,
    fetchedAt: Date.now(),
    errors: [],
    ...over,
  };
}

interface RecordingCtx extends AgentToolContext {
  __requests: Array<{ to: string | null; data: `0x${string}`; value?: bigint | undefined; meta?: { source: "manual" | "agent"; label?: string | undefined } | undefined }>;
  __sends(): number;
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
        cls: { risk: "unknown-contract", tier: "unknown", gate: null, metered: false, reverts: [], contract: null, functionSig: null },
        policy: { allowed: true, reasons: [], risk: "unknown-contract", tier: "unknown", requiresExtraAck: true },
        sim: { ok: true, result: "0x", gas: 130_000n, error: null },
      };
    },
    gateSend: async (req) => {
      sends += 1;
      requests.push({ to: req.to, data: req.data, value: req.value, meta: req.meta });
      const dec = decodeFunctionData({ abi: _swapRouterAbi, data: req.data });
      const [, , to] = dec.args as readonly [bigint, readonly Address[], Address, bigint];
      return {
        status: "sent" as const,
        envelope: {} as never,
        txHash: "0xswap" as `0x${string}`,
        receipt: { status: "success" as const, gasUsed: 125_615n, logs: [], blockNumber: 27_674_001n, contractAddress: null },
        receiptError: null,
        movements: [{ token: FOMAL, from: PAIR, to, amount: 2n }],
        capBreaches: [],
      };
    },
    refreshSnapshot: () => {},
    takeNote: () => {},
    simToolsEnabled: false,
    ...overrides,
  };
  return Object.assign(ctx, { __requests: requests, __sends: () => sends }) as RecordingCtx;
}

function snapshot(over: { lau?: Address | null; yue?: Address | null } = {}): AgentToolContext["snapshot"] {
  return {
    account: ACCT,
    lau: "lau" in over ? (over.lau ?? null) : LAU,
    yue: "yue" in over ? (over.yue ?? null) : YUE,
    lauName: "Test Lau",
    lauSymbol: "TLAU",
    username: "captain",
    yueName: "Test Yue",
    yueSymbol: "TYUE",
    balances: {
      pls: { wallet: WALLET_PLS, lau: 0n, yue: 0n },
      affection: { wallet: 0n, lau: 0n, yue: 0n },
      choa: { wallet: 0n, lau: 0n, yue: 0n },
    },
    yuanChoa: 0n,
    blockNumber: 27_674_000n,
    fetchedAt: Date.now(),
  };
}

function selector(sig: string): string {
  return toFunctionSelector(sig);
}

beforeEach(() => {
  vi.clearAllMocks();
  WALLET_PLS = 100_000n * UNIT;
  DECIMALS = 18;
  quoteInWei = 754_507n;
  quoteImpactBps = 28;
  vi.mocked(loadSwapQuote).mockImplementation(async () => baseQuote());
  resetPendingLauForTests();
});

afterEach(() => {
  resetPendingLauForTests();
});

describe("catalog + schema", () => {
  it("is ALWAYS advertised (not a chat/setup-gated tool)", () => {
    expect(toolSpecs(false).map((t) => t.function.name)).toContain("swap_pls_for_token");
  });

  it("pins the exact-output selector on the registered tool's request", async () => {
    const ctx = fakeCtx({ snapshot: snapshot() });
    await toolByName("swap_pls_for_token")!.execute({ token: "FOMALHAUTE", amountOutWei: "2" }, ctx);
    expect(ctx.__requests[0]!.data.slice(0, 10)).toBe(selector("swapETHForExactTokens(uint256,address[],address,uint256)"));
    expect(ctx.__requests[0]!.data.slice(0, 10)).toBe("0xfb3bdb41");
    expect(ctx.__requests[0]!.to).toBe(SWAP_ROUTER);
  });
});

describe("swap_pls_for_token — exact output", () => {
  it("DRYRUNs by default: exact tokens, native value = quote + slippage, no send", async () => {
    const ctx = fakeCtx({ snapshot: snapshot() });
    const out = await toolByName("swap_pls_for_token")!.execute({ token: "FOMALHAUTE", amountOutWei: "2", recipient: "lau" }, ctx);
    expect(out.mode).toBe("DRYRUN");
    expect(ctx.__sends()).toBe(0);
    expect(ctx.__requests).toHaveLength(1);
    const req = ctx.__requests[0]!;
    expect(req.value).toBe(762_053n); // ceil(754507 × 1.01)
    expect(String(out.gateClass)).toContain("unknown-contract");
    expect(String(out.route)).toContain("native PLS");
    const dec = decodeFunctionData({ abi: _swapRouterAbi, data: req.data });
    const [amountOut, path, to] = dec.args as readonly [bigint, readonly Address[], Address, bigint];
    expect(amountOut).toBe(2n);
    expect(path.map((p) => p.toLowerCase())).toEqual([WPLS.toLowerCase(), FOMAL.toLowerCase()]);
    expect(to.toLowerCase()).toBe(LAU.toLowerCase());
  });

  it("SEND is ONE leg — no approve leg exists on the native route; received is read from the receipt", async () => {
    const ctx = fakeCtx({ snapshot: snapshot() });
    const out = await toolByName("swap_pls_for_token")!.execute({ token: "FOMALHAUTE", amountOutWei: "2", recipient: "lau", send: true }, ctx);
    expect(ctx.__sends()).toBe(1);
    expect(ctx.__requests).toHaveLength(1); // no approve request
    expect(out.status).toBe("sent");
    expect(out.receivedWei).toBe("2");
    expect(String(out.refresh)).toContain("get_state");
    expect(ctx.__requests[0]!.meta?.source).toBe("agent");
  });

  it("whole-token amountOut uses the live decimals; an unreadable decimals refuses (no 18 assumption)", async () => {
    const ctx = fakeCtx({ snapshot: snapshot() });
    await toolByName("swap_pls_for_token")!.execute({ token: "FOMALHAUTE", amountOut: "0.001", recipient: "lau" }, ctx);
    expect(vi.mocked(loadSwapQuote).mock.calls[0]![2]).toBe(1_000_000_000_000_000n); // 1e15
    vi.mocked(loadSwapQuote).mockClear();
    DECIMALS = 0;
    const out = await toolByName("swap_pls_for_token")!.execute({ token: "FOMALHAUTE", amountOut: "0.001" }, ctx);
    // decimals 0 is readable, but "0.001" has fractional digits -> parsed null
    expect(String(out.error)).toContain("positive decimal");
    DECIMALS = 18;
  });

  it("a maxPls ceiling tighter than quote+slippage refuses BEFORE the gate; a looser one does not change value", async () => {
    const ctx = fakeCtx({ snapshot: snapshot() });
    const low = await toolByName("swap_pls_for_token")!.execute({ token: "FOMALHAUTE", amountOutWei: "2", maxPls: "0.0000000000007" }, ctx);
    expect(String(low.error)).toContain("exceeds maxPls");
    expect(ctx.__requests).toHaveLength(0);
    const okOut = await toolByName("swap_pls_for_token")!.execute({ token: "FOMALHAUTE", amountOutWei: "2", maxPls: "1" }, ctx);
    expect(okOut.mode).toBe("DRYRUN");
    expect(ctx.__requests[0]!.value).toBe(762_053n); // the computed cap, not 1 PLS
  });

  it("the price-impact guard refuses a thin-pool quote unless deliberately widened", async () => {
    quoteImpactBps = 600;
    const ctx = fakeCtx({ snapshot: snapshot() });
    const refused = await toolByName("swap_pls_for_token")!.execute({ token: "FOMALHAUTE", amountOutWei: "2" }, ctx);
    expect(String(refused.error)).toContain("price impact 600 bps");
    expect(ctx.__requests).toHaveLength(0);
    const pass = await toolByName("swap_pls_for_token")!.execute({ token: "FOMALHAUTE", amountOutWei: "2", maxImpactBps: 700 }, ctx);
    expect(pass.mode).toBe("DRYRUN");
  });

  it("refuses an uncomputable impact rather than swapping unguarded", async () => {
    quoteImpactBps = null;
    const out = await toolByName("swap_pls_for_token")!.execute({ token: "FOMALHAUTE", amountOutWei: "2" }, fakeCtx({ snapshot: snapshot() }));
    expect(String(out.error)).toContain("cannot compute the price impact");
  });
});

describe("recipient semantics + seed honesty", () => {
  it('"lau" resolves the pending LAU when the discovered snapshot is still null', async () => {
    setPendingLau(ACCT, LAU, null);
    const ctx = fakeCtx({ snapshot: snapshot({ lau: null }) });
    await toolByName("swap_pls_for_token")!.execute({ token: "FOMALHAUTE", amountOutWei: "2", recipient: "lau" }, ctx);
    const dec = decodeFunctionData({ abi: _swapRouterAbi, data: ctx.__requests[0]!.data });
    const [, , to] = dec.args as readonly [bigint, readonly Address[], Address, bigint];
    expect(to.toLowerCase()).toBe(LAU.toLowerCase());
  });

  it('"yue" resolves the snapshot YUE; "wallet" is the default; an explicit address passes through', async () => {
    const ctx = fakeCtx({ snapshot: snapshot() });
    await toolByName("swap_pls_for_token")!.execute({ token: "CHO", amountOutWei: "2", recipient: "yue" }, ctx);
    let dec = decodeFunctionData({ abi: _swapRouterAbi, data: ctx.__requests[0]!.data });
    expect((dec.args as readonly [bigint, readonly Address[], Address, bigint])[2].toLowerCase()).toBe(YUE.toLowerCase());
    await toolByName("swap_pls_for_token")!.execute({ token: "CHO", amountOutWei: "2" }, ctx);
    dec = decodeFunctionData({ abi: _swapRouterAbi, data: ctx.__requests[1]!.data });
    expect((dec.args as readonly [bigint, readonly Address[], Address, bigint])[2].toLowerCase()).toBe(ACCT.toLowerCase());
    await toolByName("swap_pls_for_token")!.execute({ token: "CHO", amountOutWei: "2", recipient: "0x2222222222222222222222222222222222222222" }, ctx);
    dec = decodeFunctionData({ abi: _swapRouterAbi, data: ctx.__requests[2]!.data });
    expect((dec.args as readonly [bigint, readonly Address[], Address, bigint])[2].toLowerCase()).toBe("0x2222222222222222222222222222222222222222");
  });

  it("refuses lau/yue when the account has neither (never a silent wallet fallback)", async () => {
    const ctx = fakeCtx({ snapshot: snapshot({ lau: null, yue: null }) });
    const lauOut = await toolByName("swap_pls_for_token")!.execute({ token: "FOMALHAUTE", amountOutWei: "2", recipient: "lau" }, ctx);
    expect(String(lauOut.error)).toContain("LAU");
    const yueOut = await toolByName("swap_pls_for_token")!.execute({ token: "CHO", amountOutWei: "2", recipient: "yue" }, ctx);
    expect(String(yueOut.error)).toContain("YUE");
    expect(ctx.__requests).toHaveLength(0);
  });

  it("warns when a SHIO leg is bought to the wallet or below the floors", async () => {
    const ctx = fakeCtx({ snapshot: snapshot() });
    const walletOut = await toolByName("swap_pls_for_token")!.execute({ token: "FORNAX", amountOutWei: "1", recipient: "wallet" }, ctx);
    expect(walletOut.warnings).toBeUndefined(); // non-seed warnings stay empty …
    const seed = (walletOut.seed as string[] | undefined)?.join(" ") ?? "";
    expect(seed).toContain("only counts for the Beat AT THE LAU"); // … the seed note carries it
    const fom = await toolByName("swap_pls_for_token")!.execute({ token: "FOMALHAUTE", amountOutWei: "1", recipient: "lau" }, ctx);
    expect(((fom.seed as string[]) ?? []).join(" ")).toContain("2 wei");
    const pho = await toolByName("swap_pls_for_token")!.execute({ token: "PHOBOS", amountOutWei: "1" }, ctx);
    expect(((pho.seed as string[]) ?? []).join(" ")).toContain("PHOBOS YUAN FLOOR");
  });

  it("the Fornax note names the live entropy draw and the no-ceiling correction", async () => {
    const out = await toolByName("swap_pls_for_token")!.execute({ token: "FORNAX", amountOutWei: "1000000000000000", recipient: "lau" }, fakeCtx({ snapshot: snapshot() }));
    const seed = ((out.seed as string[]) ?? []).join(" ");
    expect(seed).toContain("Entropy");
    expect(seed).toContain("no static ceiling");
    expect(seed).toContain("AT THE LAU");
  });
});

describe("fences + read honesty", () => {
  it("fences the amount args and token names", async () => {
    const ctx = fakeCtx({ snapshot: snapshot() });
    const cases: Array<Record<string, unknown>> = [
      { token: "FOMALHAUTE" },
      { token: "FOMALHAUTE", amountOutWei: "2", amountOut: "0.001" },
      { token: "FOMALHAUTE", amountOutWei: "two" },
      { token: "FOMALHAUTE", amountOutWei: "0" },
      { token: "NOPE", amountOutWei: "2" },
      { token: "FOMALHAUTE", amountOutWei: "2", recipient: "bogus" },
      { token: "FOMALHAUTE", amountOutWei: "2", slippageBps: 9999 },
      { token: "FOMALHAUTE", amountOutWei: "2", maxImpactBps: 10001 },
      { token: "FOMALHAUTE", amountOutWei: "2", deadlineSec: 1 },
      { token: "FOMALHAUTE", amountOutWei: "2", maxPls: "-1" },
    ];
    for (const args of cases) {
      const out = await toolByName("swap_pls_for_token")!.execute(args, ctx);
      expect(String(out.error), JSON.stringify(args)).toBeTruthy();
    }
    expect(ctx.__requests).toHaveLength(0);
  });

  it("refuses WPLS itself and the router as the target", async () => {
    const ctx = fakeCtx({ snapshot: snapshot() });
    const wpls = await toolByName("swap_pls_for_token")!.execute({ token: WPLS, amountOutWei: "1" }, ctx);
    expect(String(wpls.error)).toContain("WPLS");
    const router = await toolByName("swap_pls_for_token")!.execute({ token: SWAP_ROUTER, amountOutWei: "1" }, ctx);
    expect(String(router.error)).toContain("router");
  });

  it("a quote read failure is honest (the dead-RPC e2e path) and never reaches the gate", async () => {
    vi.mocked(loadSwapQuote).mockRejectedValue(new Error("swap reads failed (dead RPC / all calls reverted): boom"));
    const ctx = fakeCtx({ snapshot: snapshot() });
    const out = await toolByName("swap_pls_for_token")!.execute({ token: "FOMALHAUTE", amountOutWei: "2" }, ctx);
    expect(String(out.error)).toContain("swap reads failed");
    expect(ctx.__requests).toHaveLength(0);
  });

  it("warns when the wallet PLS is below the max input", async () => {
    WALLET_PLS = 1n;
    const out = await toolByName("swap_pls_for_token")!.execute({ token: "FOMALHAUTE", amountOutWei: "2" }, fakeCtx({ snapshot: snapshot() }));
    expect(((out.warnings as string[]) ?? []).join(" ")).toContain("below the max input");
  });
});
