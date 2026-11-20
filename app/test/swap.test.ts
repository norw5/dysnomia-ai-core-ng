import { describe, expect, it } from "vitest";
import { decodeFunctionData, toFunctionSelector, type AbiFunction, type Address, type PublicClient } from "viem";
import {
  _swapFactoryAbi,
  _swapPairAbi,
  _swapRouterAbi,
  computePriceImpactBps,
  encodeSwapEthForExactTokens,
  loadSwapQuote,
  maxInputWithSlippage,
  resolveSwapToken,
  swapDeadline,
  SWAP_FACTORY,
  SWAP_ROUTER,
  SWAP_WPLS,
} from "@/chain/swap";

/**
 * The DEX acquisition layer (session-83): the router/factory/WPLS pins vs
 * the verified on-chain selectors, the exact-output encoding, the
 * reserve-ratio price-impact math, and the quote loader's honesty (dead RPC
 * never renders "no route"; a router pin mismatch refuses; a missing pair is
 * named). The live chain is the harness's set-2 s15 + the forksmoke row;
 * these rows use the SAME reader with a recorded multicall shape.
 */

const TOKEN = "0x7ae73c498a308247be73688c09c96b3fd06ddb84" as Address; // WorldChatSHIO
const PAIR = "0xa55898a7159f3f0f592e8ea77ccacc5ba4dde9d7" as Address;
const RESERVE_TOKEN = 27_638_259_713_817_574_305n; // reserve0 at pin 27,674,000
const RESERVE_WPLS = 10_396_380_842_148_617_437_714_048n; // reserve1
const QUOTE_IN = 754_507n; // getAmountsIn(2 wei) at the pin
const AMOUNT_OUT = 2n;

type R = { status: "success"; result: unknown } | { status: "failure"; error: Error };
const ok = (result: unknown): R => ({ status: "success", result });
const fail = (msg: string): R => ({ status: "failure", error: new Error(msg) });

function fakeClient(over: { round1?: R[]; round2?: R[] } = {}): PublicClient {
  const round1 =
    over.round1 ??
    ([
      ok(SWAP_FACTORY),
      ok(SWAP_WPLS),
      ok(PAIR),
      ok(18),
      ok("SHIO"),
      ok("WorldChatSHIO"),
    ] as R[]);
  const round2 =
    over.round2 ??
    ([ok(TOKEN), ok([RESERVE_TOKEN, RESERVE_WPLS, 1_795_140_845]), ok([QUOTE_IN, AMOUNT_OUT])] as R[]);
  return {
    multicall: async ({ contracts }: { contracts: Array<{ functionName: string }> }) => {
      const first = contracts[0]?.functionName;
      if (first === "factory") return round1.slice(0, contracts.length);
      if (first === "token0") return round2.slice(0, contracts.length);
      throw new Error(`unexpected multicall ${first}`);
    },
    getBlockNumber: async () => 27_674_000n,
  } as unknown as PublicClient;
}

function ref() {
  return { token: TOKEN, label: "Fomalhaute (WorldChatSHIO)" };
}

describe("PulseX V2 pins + selectors (verified on-chain session-83)", () => {
  it("pins the router/factory/WPLS from the official docs + the on-chain reads", () => {
    expect(SWAP_ROUTER).toBe("0x165C3410fC91EF562C50559f7d2289fEbed552d9");
    expect(SWAP_FACTORY).toBe("0x29eA7545DEf87022BAdc76323F373EA1e707C523");
    expect(SWAP_WPLS).toBe("0xA1077a294dDE1B09bB078844df40758a5D0f9a27");
  });

  it("the hand fragments encode to the verified selectors", () => {
    const find = (abi: readonly { type: string; name?: string; inputs?: readonly unknown[] }[], name: string, n: number) =>
      abi.find((e) => e.type === "function" && e.name === name && e.inputs?.length === n)! as unknown as AbiFunction;
    expect(toFunctionSelector(find(_swapRouterAbi, "factory", 0))).toBe("0xc45a0155");
    expect(toFunctionSelector(find(_swapRouterAbi, "WPLS", 0))).toBe("0xef8ef56f");
    expect(toFunctionSelector(find(_swapRouterAbi, "getAmountsIn", 2))).toBe("0x1f00ca74");
    expect(toFunctionSelector(find(_swapRouterAbi, "swapETHForExactTokens", 4))).toBe("0xfb3bdb41");
    expect(toFunctionSelector(find(_swapFactoryAbi, "getPair", 2))).toBe("0xe6a43905");
    expect(toFunctionSelector(find(_swapPairAbi, "getReserves", 0))).toBe("0x0902f1ac");
    expect(toFunctionSelector(find(_swapPairAbi, "token0", 0))).toBe("0x0dfe1681");
  });

  it("the exact-output encoder carries the path, recipient, and deadline", () => {
    const data = encodeSwapEthForExactTokens({
      amountOutWei: 2n,
      token: TOKEN,
      recipient: "0x1111111111111111111111111111111111111111",
      deadline: 1_790_736_405n,
    });
    expect(data.slice(0, 10)).toBe("0xfb3bdb41");
    const decoded = decodeFunctionData({ abi: _swapRouterAbi, data });
    expect(decoded.functionName).toBe("swapETHForExactTokens");
    const [amountOut, path, to, deadline] = decoded.args as readonly [bigint, readonly Address[], Address, bigint];
    expect(amountOut).toBe(2n);
    expect(path.map((p) => p.toLowerCase())).toEqual([SWAP_WPLS.toLowerCase(), TOKEN.toLowerCase()]);
    expect(to.toLowerCase()).toBe("0x1111111111111111111111111111111111111111");
    expect(deadline).toBe(1_790_736_405n);
  });
});

describe("the exact-output math", () => {
  it("price impact is quote-vs-spot in bps, rounded up, and null on unusable reserves", () => {
    expect(computePriceImpactBps(100n, 100n, 1_000n, 1_000n)).toBe(0); // 1:1
    expect(computePriceImpactBps(103n, 100n, 1_000n, 1_000n)).toBe(300); // 3%
    expect(computePriceImpactBps(754_507n, 2n, RESERVE_WPLS, RESERVE_TOKEN)).toBeGreaterThan(0);
    expect(computePriceImpactBps(754_507n, 2n, RESERVE_WPLS, RESERVE_TOKEN)).toBeLessThan(100);
    expect(computePriceImpactBps(1n, 0n, 1n, 1n)).toBeNull();
    expect(computePriceImpactBps(1n, 1n, 0n, 1n)).toBeNull();
  });

  it("the slippage cap rounds up; the deadline clamps; zero slippage keeps the quote", () => {
    expect(maxInputWithSlippage(1_000n, 100)).toBe(1_010n);
    expect(maxInputWithSlippage(1_000n, 0)).toBe(1_000n);
    expect(maxInputWithSlippage(1n, 100)).toBe(2n); // ceil(1.01)
    expect(maxInputWithSlippage(1_000n, 99_999)).toBe(1_200n); // clamped to 2000 bps
    expect(swapDeadline(1_700_000_000, 1200)).toBe(1_700_001_200n);
    expect(swapDeadline(1_700_000_000, 1)).toBe(1_700_000_060n); // min 60
    expect(swapDeadline(1_700_000_000, 99_999)).toBe(1_700_007_200n); // max 7200
  });

  it("resolves the seed aliases and passes addresses through", () => {
    expect(resolveSwapToken("fomalhaute")?.token.toLowerCase()).toBe(TOKEN.toLowerCase());
    expect(resolveSwapToken("FORNAX")?.label).toContain("Fornax");
    expect(resolveSwapToken("tethys")?.token.toLowerCase()).toBe("0xb6be11f0a788014c1f68c92f8d6ccc1abf78f2ab");
    expect(resolveSwapToken("phobos")?.token.toLowerCase()).toBe("0xb0ba7d36b7f0505879179ece7401f24eb653c6e1");
    expect(resolveSwapToken("0x2222222222222222222222222222222222222222")?.label).toBe("0x2222222222222222222222222222222222222222");
    expect(resolveSwapToken("nope")).toBeNull();
  });
});

describe("loadSwapQuote — the anonymous read", () => {
  it("reads the pair/token0/reserves/router quote in two batches", async () => {
    const q = await loadSwapQuote(fakeClient(), ref(), AMOUNT_OUT);
    expect(q.token).toBe(TOKEN);
    expect(q.pair).toBe(PAIR);
    expect(q.decimals).toBe(18);
    expect(q.symbol).toBe("SHIO");
    expect(q.amountOutWei).toBe(2n);
    expect(q.amountInWei).toBe(QUOTE_IN);
    expect(q.reserveInWei).toBe(RESERVE_WPLS); // token0 is the token; WPLS is reserve1
    expect(q.reserveOutWei).toBe(RESERVE_TOKEN);
    expect(q.spotInWei).toBe((AMOUNT_OUT * RESERVE_WPLS) / RESERVE_TOKEN);
    expect(q.priceImpactBps).not.toBeNull();
    expect(q.blockNumber).toBe(27_674_000n);
    expect(q.errors).toEqual([]);
  });

  it("handles a pair whose token0 is WPLS (reserve sides swap)", async () => {
    const q = await loadSwapQuote(
      fakeClient({ round2: [ok(SWAP_WPLS), ok([RESERVE_WPLS, RESERVE_TOKEN, 1]), ok([QUOTE_IN, AMOUNT_OUT])] }),
      ref(),
      AMOUNT_OUT
    );
    expect(q.reserveInWei).toBe(RESERVE_WPLS);
    expect(q.reserveOutWei).toBe(RESERVE_TOKEN);
  });

  it("an all-failed round is a DEAD RPC, never 'no route'", async () => {
    await expect(loadSwapQuote(fakeClient({ round1: Array.from({ length: 6 }, () => fail("rpc down")) }), ref(), AMOUNT_OUT)).rejects.toThrow(/dead RPC/);
  });

  it("refuses a router whose factory()/WPLS() disagree with the pins", async () => {
    await expect(
      loadSwapQuote(fakeClient({ round1: [ok("0x3333333333333333333333333333333333333333"), ok(SWAP_WPLS), ok(PAIR), ok(18), ok("SHIO"), ok("x")] }), ref(), AMOUNT_OUT)
    ).rejects.toThrow(/pin mismatch/);
    await expect(
      loadSwapQuote(fakeClient({ round1: [ok(SWAP_FACTORY), ok("0x3333333333333333333333333333333333333333"), ok(PAIR), ok(18), ok("SHIO"), ok("x")] }), ref(), AMOUNT_OUT)
    ).rejects.toThrow(/pin mismatch/);
  });

  it("names a missing WPLS pair and a failed getAmountsIn honestly", async () => {
    await expect(
      loadSwapQuote(fakeClient({ round1: [ok(SWAP_FACTORY), ok(SWAP_WPLS), ok("0x0000000000000000000000000000000000000000"), ok(18), ok("x"), ok("x")] }), ref(), AMOUNT_OUT)
    ).rejects.toThrow(/no PulseX V2 WPLS pair/);
    await expect(
      loadSwapQuote(fakeClient({ round2: [ok(TOKEN), ok([RESERVE_TOKEN, RESERVE_WPLS, 1]), fail("PulseX: INSUFFICIENT_LIQUIDITY")] }), ref(), AMOUNT_OUT)
    ).rejects.toThrow(/quote failed/);
  });

  it("fences zero amounts and the WPLS route token itself", async () => {
    await expect(loadSwapQuote(fakeClient(), ref(), 0n)).rejects.toThrow(/amountOut/);
    await expect(loadSwapQuote(fakeClient(), { token: SWAP_WPLS, label: "WPLS" }, 1n)).rejects.toThrow(/WPLS/);
  });

  it("surfaces a quote/out mismatch instead of silently trusting one side", async () => {
    await expect(
      loadSwapQuote(fakeClient({ round2: [ok(TOKEN), ok([RESERVE_TOKEN, RESERVE_WPLS, 1]), ok([QUOTE_IN, 3n])] }), ref(), AMOUNT_OUT)
    ).rejects.toThrow(/quote mismatch/);
  });
});
