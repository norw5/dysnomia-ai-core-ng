import type { Address, PublicClient } from "viem";

/**
 * The wallet-move reads (session-56, the LAU/YUE move story): ONE anonymous
 * Multicall3 batch per lookup — `from=` never set; the holder rides as an
 * ARGUMENT (the identity.ts/yueDesk.ts discipline). Covers the move_tokens
 * preview (what the WALLET holds of an arbitrary ERC-20) and the sweep_lau
 * preview (what the LAU holds). All views — no not-view landmines here.
 *
 * Honesty rules: per-call failures surface as nulls + errors[] (a token
 * without symbol()/name() is legal); an ALL-failed round is a dead RPC and
 * THROWS (the session-41 viem trap — never render "holds nothing" off a
 * dead endpoint).
 */

const erc20MetaAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

/** exposed for the selector regression test (never for direct calls) */
export const _erc20MetaAbi = erc20MetaAbi;

export interface Erc20Hold {
  /** what `holder` holds of the token; null = read failed */
  balance: bigint | null;
  /** null = unreadable (caller falls back to 18, the family standard) */
  decimals: number | null;
  symbol: string | null;
  name: string | null;
  errors: string[];
  blockNumber: bigint | null;
  fetchedAt: number;
}

type MulticallResult<T> = { status: "success"; result: T } | { status: "failure"; error: Error };

function ok<T>(r: MulticallResult<T> | undefined): T | null {
  return r && r.status === "success" ? r.result : null;
}

export async function loadErc20Hold(client: PublicClient, token: Address, holder: Address): Promise<Erc20Hold> {
  const rs = (await client.multicall({
    allowFailure: true,
    contracts: [
      { address: token, abi: erc20MetaAbi, functionName: "balanceOf", args: [holder] as const },
      { address: token, abi: erc20MetaAbi, functionName: "decimals", args: [] as const },
      { address: token, abi: erc20MetaAbi, functionName: "symbol", args: [] as const },
      { address: token, abi: erc20MetaAbi, functionName: "name", args: [] as const },
    ],
  })) as MulticallResult<unknown>[];

  // the viem transport-failure trap (session-41): an all-failed round is a dead RPC
  if (rs.length > 0 && rs.every((r) => r.status === "failure")) {
    const err = (rs[0] as { status: "failure"; error: Error }).error;
    throw new Error(`token reads failed (batch): ${err.message}`);
  }

  const errors: string[] = [];
  const labels = ["balanceOf", "decimals", "symbol", "name"];
  rs.forEach((r, i) => {
    if (r.status === "failure") errors.push(`${labels[i]}: ${r.error.message}`);
  });

  const decimalsRaw = ok<number>(rs[1] as MulticallResult<number>);
  const decimals = decimalsRaw !== null && Number.isInteger(decimalsRaw) && decimalsRaw >= 0 && decimalsRaw <= 77 ? decimalsRaw : null;

  const blockNumber = await client.getBlockNumber().catch(() => null);
  return {
    balance: ok<bigint>(rs[0] as MulticallResult<bigint>),
    decimals,
    symbol: ok<string>(rs[2] as MulticallResult<string>),
    name: ok<string>(rs[3] as MulticallResult<string>),
    errors,
    blockNumber,
    fetchedAt: Date.now(),
  };
}
