import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import type { Address, PublicClient } from "viem";
import { makeClient } from "@/chain/client";
import { addr } from "@config/addresses";
import type { TriBalance } from "@/chain/identity";

/**
 * The MARKET Power-tab reader (IA-PLAN §5, session-48): balances of the
 * four constellation power tokens across wallet/LAU/YUE + the Yuan view,
 * ONE anonymous Multicall3 `aggregate3` batch — the identity.ts discipline
 * (round reads can never legitimately revert onchain, so an all-failed
 * round is a dead RPC rendered as unreadable, never as "holds nothing").
 *
 * The four tokens are the deployed constellation channels (kb §1 — all
 * SHIO instances; Tethys is CHO itself, the hub's own channel):
 *   Fornax    = FornaxSHIO (YI's Psi)   — the ladder's Fornax constant
 *   Eris      = ErisSHIO   (YANG's)     — QI divides by Eris
 *   Fomalhaute= WorldChatSHIO (ZHOU's)  — XIA's modulus; carries world chat
 *   Tethys    = CHO                     — ZI's modulus; also the hub
 * Yuan per token = bal(wallet) + 10×bal(LAU) + 40×bal(YUE) — the deployed
 * CHOA weighting (02_choa.sol:28-33), the same shape identity.ts computes
 * for CHOA.
 */

export type PowerKey = "Fornax" | "Eris" | "Fomalhaute" | "Tethys";

export interface PowerTokenMeta {
  key: PowerKey;
  /** the perimeter name the address resolves through (config-driven) */
  config: "FornaxSHIO" | "ErisSHIO" | "WorldChatSHIO" | "CHO";
  note: string;
}

export const POWER_TOKENS: PowerTokenMeta[] = [
  { key: "Fornax", config: "FornaxSHIO", note: "YI's Psi — the ladder's Fornax constant; the deployed Goldilocks ceiling is real (kb §2)" },
  { key: "Eris", config: "ErisSHIO", note: "YANG's channel — QI divides by Eris" },
  { key: "Fomalhaute", config: "WorldChatSHIO", note: "ZHOU's channel — XIA's modulus; carries the world-chat LogEvent stream" },
  { key: "Tethys", config: "CHO", note: "ZI's modulus = CHO — the hub / address book is itself the fourth power token" },
];

const erc20Abi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export interface PowerTokenRow {
  key: PowerKey;
  address: Address;
  name: string | null;
  symbol: string | null;
  /** null per-slot on read failure — never silently zero */
  balances: TriBalance;
  /** wallet + 10×LAU + 40×YUE (null when any leg of the sum failed) */
  yuan: bigint | null;
}

export interface PowerTokenState {
  rows: PowerTokenRow[];
  errors: string[];
  blockNumber: bigint | null;
  fetchedAt: number;
}

type MulticallResult<T> = { status: "success"; result: T } | { status: "failure"; error: Error };

function failFast(results: MulticallResult<unknown>[]): void {
  if (results.length > 0 && results.every((r) => r.status === "failure")) {
    const err = (results[0] as { status: "failure"; error: Error }).error;
    throw new Error(`power-token reads failed (batch): ${err.message}`);
  }
}

export async function loadPowerTokens(
  client: PublicClient,
  account: Address | null,
  lau: Address | null,
  yue: Address | null
): Promise<PowerTokenState> {
  // per token: name, symbol, bal(wallet), bal(LAU)?, bal(YUE)? — one flat batch
  const contracts: Array<{ address: Address; abi: typeof erc20Abi; functionName: string; args: readonly unknown[] }> = [];
  const legs: Array<{ token: number; field: "name" | "symbol" | "wallet" | "lau" | "yue" }> = [];
  POWER_TOKENS.forEach((meta, i) => {
    const address = addr(meta.config);
    contracts.push({ address, abi: erc20Abi, functionName: "name", args: [] });
    legs.push({ token: i, field: "name" });
    contracts.push({ address, abi: erc20Abi, functionName: "symbol", args: [] });
    legs.push({ token: i, field: "symbol" });
    contracts.push({ address, abi: erc20Abi, functionName: "balanceOf", args: [account] });
    legs.push({ token: i, field: "wallet" });
    if (lau !== null) {
      contracts.push({ address, abi: erc20Abi, functionName: "balanceOf", args: [lau] });
      legs.push({ token: i, field: "lau" });
    }
    if (yue !== null) {
      contracts.push({ address, abi: erc20Abi, functionName: "balanceOf", args: [yue] });
      legs.push({ token: i, field: "yue" });
    }
  });

  const rs = (await client.multicall({ allowFailure: true, contracts })) as MulticallResult<unknown>[];
  failFast(rs);

  const errors: string[] = [];
  const rows: PowerTokenRow[] = POWER_TOKENS.map((meta) => ({
    key: meta.key,
    address: addr(meta.config),
    name: null,
    symbol: null,
    balances: { wallet: 0n, lau: 0n, yue: 0n },
    yuan: null,
  }));
  const haveLeg = new Set<string>();
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    const row = rows[leg.token]!;
    const key = `${leg.token}:${leg.field}`;
    const r = rs[i] as MulticallResult<unknown> | undefined;
    if (!r || r.status === "failure") {
      errors.push(`${row.key}.${leg.field}: ${r ? r.error.message : "missing"}`);
      continue;
    }
    haveLeg.add(key);
    if (leg.field === "name") row.name = r.result as string;
    else if (leg.field === "symbol") row.symbol = r.result as string;
    else row.balances[leg.field] = r.result as bigint;
  }
  // the Yuan view only computes when every leg of its sum read cleanly
  for (const row of rows) {
    const need = ["wallet", ...(lau !== null ? ["lau"] : []), ...(yue !== null ? ["yue"] : [])];
    if (need.every((f) => haveLeg.has(`${POWER_TOKENS.findIndex((m) => m.key === row.key)}:${f}`))) {
      row.yuan = row.balances.wallet + 10n * row.balances.lau + 40n * row.balances.yue;
    }
  }

  const blockNumber = await client.getBlockNumber().catch(() => null);
  return { rows, errors, blockNumber, fetchedAt: Date.now() };
}

/** static scaffold rows — the config-pinned four, balances unread (the offline/no-account shape) */
export function scaffoldPowerRows(): PowerTokenRow[] {
  return POWER_TOKENS.map((meta) => ({
    key: meta.key,
    address: addr(meta.config),
    name: null,
    symbol: null,
    balances: { wallet: 0n, lau: 0n, yue: 0n },
    yuan: null,
  }));
}

export interface PowerTokensHook {
  state: PowerTokenState | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function usePowerTokens(
  rpcUrl: string,
  account: Address | null,
  lau: Address | null,
  yue: Address | null
): PowerTokensHook {
  const client = useMemo(() => makeClient(rpcUrl), [rpcUrl]);
  const [state, setState] = useState<PowerTokenState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const identityKey = `${account ?? ""}|${lau ?? ""}|${yue ?? ""}`;
  const lastIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    // session-64.1 (the disappearing-content find): rows only clear when
    // the IDENTITY changes — a failed or in-flight refresh keeps the last
    // good state (stale-while-revalidate), so a transient read failure or
    // the 12s tick no longer wipes the block
    const identityChanged = lastIdentityRef.current !== identityKey;
    lastIdentityRef.current = identityKey;
    if (account === null) {
      setState(null);
      setError(null);
      return;
    }
    if (identityChanged) setState(null);
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadPowerTokens(client, account, lau, yue)
      .then((s) => {
        if (!cancelled && alive.current) setState(s);
      })
      .catch((e: unknown) => {
        // session-64.1 (the disappearing-content find): a failed REFRESH
        // keeps the last good rows (stale-while-revalidate) — the error
        // rides alongside; a transient read failure no longer wipes the
        // block. State only truly clears when the identity changes.
        if (!cancelled && alive.current) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled && alive.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, account, lau, yue, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { state, loading, error, refresh };
}
