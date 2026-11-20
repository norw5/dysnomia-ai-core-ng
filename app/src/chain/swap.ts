import { encodeFunctionData, isAddress, type Address, type PublicClient } from "viem";
import { addr, PULSEX_V2_FACTORY, PULSEX_V2_ROUTER, WPLS, type ContractName } from "@config/addresses";

/**
 * The DEX acquisition layer (session-83 — the owner's DEX/swap round).
 *
 * The Beat seed is ordinary ERC-20s; until this round the agent could only
 * move tokens it already held. This module is the READ + ENCODE half of the
 * one swap tool (agent/swapTools.ts): it pins the EXTERNAL PulseX V2
 * infrastructure and verifies the router on every quote.
 *
 * VERIFIED ON-CHAIN (session-83, live head 28,103,864 + the 27,674,000 fork):
 *   router  0x165C3410fC91EF562C50559f7d2289fEbed552d9  (PulseX Router02)
 *     factory() = 0x29eA7545DEf87022BAdc76323F373EA1e707C523
 *     WPLS()    = 0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 *   swapETHForExactTokens(uint256,address[],address,uint256) = 0xfb3bdb41
 *   getAmountsIn(uint256,address[])                         = 0x1f00ca74
 *   getAmountsOut(uint256,address[])                        = 0xd06ca61f
 *   swapExactETHForTokens(uint256,address[],address,uint256) = 0x7ff36ab5
 * The official PulseX docs name the same router/factory/WPLS (V2 — V1 is
 * the deprecated fee-bug deployment). The native-value route wraps the PLS
 * inside the router, so there is NO approve leg and no MaxUint allowance.
 *
 * THE MODE: exact-output (`swapETHForExactTokens`) is the honest seed ask —
 * "buy exactly N wei of this token, never pay more than the cap". The router
 * computes the required WPLS at execution and REFUNDS unused native value
 * (fork-verified session-83: sending 2,000 PLS for a ~674-PLS quote left
 * ~732 PLS including gas). The cap passed as `value` is quote × (1 +
 * slippage); the gate's value accounting therefore tracks the real spend
 * closely, and the exact tokens land at `to`.
 *
 * THIN POOLS: the four seed pairs are thin (Fornax ~33 tokens of depth,
 * Phobos ~1 token at the pin). `getAmountsIn` on a large target reverts
 * INSUFFICIENT_LIQUIDITY; the price-impact guard in the tool refuses a quote
 * whose input exceeds the reserve-ratio spot by maxImpactBps. Always quote
 * fresh — reserves move with every swap.
 */

export const SWAP_ROUTER: Address = PULSEX_V2_ROUTER;
export const SWAP_FACTORY: Address = PULSEX_V2_FACTORY;
export const SWAP_WPLS: Address = WPLS;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

export const swapRouterAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "WPLS", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    type: "function",
    name: "getAmountsIn",
    stateMutability: "view",
    inputs: [
      { name: "amountOut", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapETHForExactTokens",
    stateMutability: "payable",
    inputs: [
      { name: "amountOut", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

export const swapFactoryAbi = [
  {
    type: "function",
    name: "getPair",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    outputs: [{ name: "pair", type: "address" }],
  },
] as const;

export const swapPairAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
] as const;

export const erc20SwapMetaAbi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

/** exposed for the selector regression test (never for direct calls) */
export const _swapRouterAbi = swapRouterAbi;
export const _swapFactoryAbi = swapFactoryAbi;
export const _swapPairAbi = swapPairAbi;

/**
 * The symbolic names the agent may use instead of an address. The four Beat
 * seed tokens get their canonical labels (onchain SHIO symbols are all just
 * "SHIO", and Phobos' QING symbol is a glyph string — the label is the useful
 * identity). Everything else is a plain 0x… ERC-20 address.
 */
export const SWAP_TOKEN_ALIASES: Readonly<Record<string, { contract: ContractName; label: string }>> = {
  FOMALHAUTE: { contract: "WorldChatSHIO", label: "Fomalhaute (WorldChatSHIO)" },
  WORLDCHATSHIO: { contract: "WorldChatSHIO", label: "Fomalhaute (WorldChatSHIO)" },
  FORNAX: { contract: "FornaxSHIO", label: "Fornax (FornaxSHIO)" },
  CHO: { contract: "CHO", label: "CHO (Tethys)" },
  TETHYS: { contract: "CHO", label: "CHO (Tethys)" },
  PHOBOS: { contract: "PhobosQING", label: "Phobos (QING)" },
  ERIS: { contract: "ErisSHIO", label: "Eris (ErisSHIO)" },
  AFFECTION: { contract: "AFFECTION", label: "AFFECTION" },
  CHOA: { contract: "CHOA", label: "CHOA" },
};

export interface SwapTokenRef {
  token: Address;
  label: string;
}

/** resolve a symbolic seed-token name or a 0x… ERC-20 address */
export function resolveSwapToken(raw: string): SwapTokenRef | null {
  const text = raw.trim();
  if (text.length === 0) return null;
  if (isAddress(text, { strict: false })) return { token: text as Address, label: text };
  const alias = SWAP_TOKEN_ALIASES[text.toUpperCase()];
  if (alias === undefined) return null;
  return { token: addr(alias.contract) as Address, label: alias.label };
}

/** the true token identities the seed recipe must warn about */
export function isSeedShio(token: Address): boolean {
  const t = token.toLowerCase();
  return t === addr("WorldChatSHIO").toLowerCase() || t === addr("FornaxSHIO").toLowerCase();
}

export function isFomalhaute(token: Address): boolean {
  return token.toLowerCase() === addr("WorldChatSHIO").toLowerCase();
}

export function isFornax(token: Address): boolean {
  return token.toLowerCase() === addr("FornaxSHIO").toLowerCase();
}

export function isCho(token: Address): boolean {
  return token.toLowerCase() === addr("CHO").toLowerCase();
}

export function isPhobos(token: Address): boolean {
  return token.toLowerCase() === addr("PhobosQING").toLowerCase();
}

type MulticallResult<T> = { status: "success"; result: T } | { status: "failure"; error: Error };

function ok<T>(r: MulticallResult<T> | undefined): T | null {
  return r && r.status === "success" ? r.result : null;
}

export interface SwapQuote {
  token: Address;
  tokenLabel: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  amountOutWei: bigint;
  /** the router's exact-input requirement at the quoted block */
  amountInWei: bigint;
  pair: Address;
  token0: Address;
  /** WPLS reserve */
  reserveInWei: bigint;
  /** token reserve */
  reserveOutWei: bigint;
  /** amountOut × reserveIn ÷ reserveOut — the no-impact input (fee included in the delta) */
  spotInWei: bigint;
  /**
   * quote vs the reserve-ratio spot, in bps — INCLUDES the pool fee (the
   * deployed V2 fee is not re-derived here; the guard is conservative).
   * null = reserves unusable.
   */
  priceImpactBps: number | null;
  blockNumber: bigint | null;
  fetchedAt: number;
  /** per-call read failures that did not kill the quote (decimals/symbol/name) */
  errors: string[];
}

/** quote vs the reserve-ratio spot; null when the pool data cannot support it */
export function computePriceImpactBps(amountInWei: bigint, amountOutWei: bigint, reserveInWei: bigint, reserveOutWei: bigint): number | null {
  if (amountOutWei <= 0n || reserveInWei <= 0n || reserveOutWei <= 0n) return null;
  const spot = (amountOutWei * reserveInWei) / reserveOutWei;
  if (spot <= 0n) return null;
  if (amountInWei <= spot) return 0;
  const diff = amountInWei - spot;
  const bps = (diff * 10_000n + spot - 1n) / spot; // ceil
  // a sane ceiling for a display number; a bigger value still exceeds any guard
  return bps > 1_000_000n ? 1_000_000 : Number(bps);
}

/** the exact-output value cap: quote × (1 + slippage), rounded up */
export function maxInputWithSlippage(amountInWei: bigint, slippageBps: number): bigint {
  const slip = BigInt(Math.max(0, Math.min(2000, Math.trunc(slippageBps))));
  return (amountInWei * (10_000n + slip) + 9_999n) / 10_000n;
}

export function swapDeadline(nowSec: number, deadlineSec: number): bigint {
  const sec = Math.max(60, Math.min(7200, Math.trunc(deadlineSec)));
  return BigInt(Math.trunc(nowSec) + sec);
}

/** encode the exact-output swap — the ONLY swap encoding this app produces */
export function encodeSwapEthForExactTokens(args: {
  amountOutWei: bigint;
  token: Address;
  recipient: Address;
  deadline: bigint;
}): `0x${string}` {
  return encodeFunctionData({
    abi: swapRouterAbi,
    functionName: "swapETHForExactTokens",
    args: [args.amountOutWei, [SWAP_WPLS, args.token], args.recipient, args.deadline],
  });
}

/**
 * The anonymous quote read: ONE Multicall3 round for the router/factory
 * identity + token meta + pair, ONE for token0/reserves/the router quote.
 * `from=` is never set; the wallet is only a balance read elsewhere. An
 * all-failed round is a DEAD RPC and throws (the session-41 viem trap) —
 * never "no route" off a broken endpoint.
 */
export async function loadSwapQuote(client: PublicClient, ref: SwapTokenRef, amountOutWei: bigint): Promise<SwapQuote> {
  if (amountOutWei <= 0n) throw new Error("amountOut must be > 0");
  if (ref.token.toLowerCase() === SWAP_WPLS.toLowerCase()) throw new Error("cannot swap PLS for WPLS — WPLS is the wrapped native route token itself");

  const round1 = (await client.multicall({
    allowFailure: true,
    contracts: [
      { address: SWAP_ROUTER, abi: swapRouterAbi, functionName: "factory", args: [] as const },
      { address: SWAP_ROUTER, abi: swapRouterAbi, functionName: "WPLS", args: [] as const },
      { address: SWAP_FACTORY, abi: swapFactoryAbi, functionName: "getPair", args: [SWAP_WPLS, ref.token] as const },
      { address: ref.token, abi: erc20SwapMetaAbi, functionName: "decimals", args: [] as const },
      { address: ref.token, abi: erc20SwapMetaAbi, functionName: "symbol", args: [] as const },
      { address: ref.token, abi: erc20SwapMetaAbi, functionName: "name", args: [] as const },
    ],
  })) as MulticallResult<unknown>[];

  if (round1.length > 0 && round1.every((r) => r.status === "failure")) {
    const err = (round1[0] as { status: "failure"; error: Error }).error;
    throw new Error(`swap reads failed (dead RPC / all calls reverted): ${err.message}`);
  }

  const routerFactory = ok<Address>(round1[0] as MulticallResult<Address>);
  const routerWpls = ok<Address>(round1[1] as MulticallResult<Address>);
  if (routerFactory === null || routerWpls === null) {
    throw new Error("PulseX router identity read failed — cannot verify the pinned router/factory/WPLS");
  }
  if (routerFactory.toLowerCase() !== SWAP_FACTORY.toLowerCase()) {
    throw new Error(`PulseX router pin mismatch: factory() = ${routerFactory}, config = ${SWAP_FACTORY} — refusing to swap through an unknown deployment`);
  }
  if (routerWpls.toLowerCase() !== SWAP_WPLS.toLowerCase()) {
    throw new Error(`PulseX router pin mismatch: WPLS() = ${routerWpls}, config = ${SWAP_WPLS} — refusing to swap through an unknown deployment`);
  }

  const pairRaw = ok<Address>(round1[2] as MulticallResult<Address>);
  if (pairRaw === null) throw new Error("PulseX factory getPair read failed");
  if (pairRaw.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`no PulseX V2 WPLS pair for ${ref.label} — this token has no direct route from the router's WPLS`);
  }
  const pair = pairRaw as Address;

  const round2 = (await client.multicall({
    allowFailure: true,
    contracts: [
      { address: pair, abi: swapPairAbi, functionName: "token0", args: [] as const },
      { address: pair, abi: swapPairAbi, functionName: "getReserves", args: [] as const },
      { address: SWAP_ROUTER, abi: swapRouterAbi, functionName: "getAmountsIn", args: [amountOutWei, [SWAP_WPLS, ref.token]] as const },
    ],
  })) as MulticallResult<unknown>[];

  const token0 = ok<Address>(round2[0] as MulticallResult<Address>);
  const reserves = ok<readonly [bigint, bigint, number]>(round2[1] as MulticallResult<readonly [bigint, bigint, number]>);
  const amounts = ok<readonly bigint[]>(round2[2] as MulticallResult<readonly bigint[]>);
  if (token0 === null || reserves === null) throw new Error("PulseX pair reads failed — no quote (never a phantom route)");
  if (amounts === null || amounts.length !== 2) {
    const q = round2[2];
    const why = q !== undefined && q.status === "failure" ? q.error.message : "malformed getAmountsIn result";
    throw new Error(`PulseX quote failed for ${ref.label} (amountOut ${amountOutWei.toString()}): ${why}`);
  }
  const amountInWei = amounts[0]!;
  if (amounts[1] !== amountOutWei) {
    throw new Error(`PulseX quote mismatch: getAmountsIn returned out=${amounts[1]?.toString() ?? "?"} for requested ${amountOutWei.toString()}`);
  }
  const wplsIs0 = token0.toLowerCase() === SWAP_WPLS.toLowerCase();
  const reserveInWei = wplsIs0 ? reserves[0] : reserves[1];
  const reserveOutWei = wplsIs0 ? reserves[1] : reserves[0];

  const errors: string[] = [];
  const meta = ["decimals", "symbol", "name"];
  for (let i = 0; i < 3; i++) {
    const r = round1[3 + i];
    if (r !== undefined && r.status === "failure") errors.push(`${meta[i]}: ${r.error.message}`);
  }
  const decimalsRaw = ok<number>(round1[3] as MulticallResult<number>);
  const decimals = decimalsRaw !== null && Number.isInteger(decimalsRaw) && decimalsRaw >= 0 && decimalsRaw <= 77 ? decimalsRaw : null;

  const blockNumber = await client.getBlockNumber().catch(() => null);
  return {
    token: ref.token,
    tokenLabel: ref.label,
    symbol: ok<string>(round1[4] as MulticallResult<string>),
    name: ok<string>(round1[5] as MulticallResult<string>),
    decimals,
    amountOutWei,
    amountInWei,
    pair,
    token0,
    reserveInWei,
    reserveOutWei,
    spotInWei: (amountOutWei * reserveInWei) / reserveOutWei,
    priceImpactBps: computePriceImpactBps(amountInWei, amountOutWei, reserveInWei, reserveOutWei),
    blockNumber,
    fetchedAt: Date.now(),
    errors,
  };
}
