import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address, PublicClient } from "viem";
import { makeClient } from "@/chain/client";
import { addr, MULTICALL3 } from "@config/addresses";

/**
 * Read-only entity profile (DIRECTORY skeleton, session-44): ONE anonymous
 * Multicall3 batch per viewed LAU — PLS/Ⓐ/CHOA balances of the LAU contract
 * itself plus its name()/symbol()/Username() (Username reverts while unset —
 * the identity.ts semantics: the failure IS the answer). `from=` never set;
 * a dead RPC is an ERROR (fail-fast on an all-failed round), never an empty
 * profile.
 *
 * Session-48 family extras (same batch, one per entity kind): a SHIO adds
 * Rod()/Cone() — the channel's two SHA endpoints, the fact that actually
 * distinguishes a channel (every SHIO names itself "CHATLOG Shio"); a YUE
 * adds Origin() — the owner wallet at read time.
 */

const erc20BalanceAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const mc3Abi = [
  { type: "function", name: "getEthBalance", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const lauAbi = [
  { type: "function", name: "Username", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;
const shioAbi = [
  { type: "function", name: "Rod", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "Cone", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
const yueAbi = [
  { type: "function", name: "Origin", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export type EntityKind = "lau" | "shio" | "yue";

export interface EntityProfile {
  entity: Address;
  pls: bigint;
  affection: bigint;
  choa: bigint;
  /** Username() reverts while unset — null is the honest "unset" */
  username: string | null;
  name: string | null;
  symbol: string | null;
  /** SHIO only: the channel's Rod-end SHA (null when not a SHIO / read failed) */
  rod: Address | null;
  /** SHIO only: the channel's Cone-end SHA */
  cone: Address | null;
  /** YUE only: the owner wallet at read time (ChangeOrigin can move it) */
  origin: Address | null;
  blockNumber: bigint | null;
  fetchedAt: number;
}

type MulticallResult<T> = { status: "success"; result: T } | { status: "failure"; error: Error };

function ok<T>(r: MulticallResult<T> | undefined): T | null {
  return r && r.status === "success" ? r.result : null;
}

export async function loadEntityProfile(client: PublicClient, entity: Address, kind: EntityKind = "lau"): Promise<EntityProfile> {
  // built as a variable (not an inline literal) so viem's multicall typing
  // resolves the union the same way identity.ts's mixed batch does
  const contracts = [
    { address: MULTICALL3, abi: mc3Abi, functionName: "getEthBalance", args: [entity] as const },
    { address: addr("AFFECTION"), abi: erc20BalanceAbi, functionName: "balanceOf", args: [entity] as const },
    { address: addr("CHOA"), abi: erc20BalanceAbi, functionName: "balanceOf", args: [entity] as const },
    { address: entity, abi: lauAbi, functionName: "Username", args: [] as const },
    { address: entity, abi: lauAbi, functionName: "name", args: [] as const },
    { address: entity, abi: lauAbi, functionName: "symbol", args: [] as const },
    ...(kind === "shio"
      ? [
          { address: entity, abi: shioAbi, functionName: "Rod", args: [] as const },
          { address: entity, abi: shioAbi, functionName: "Cone", args: [] as const },
        ]
      : []),
    ...(kind === "yue" ? [{ address: entity, abi: yueAbi, functionName: "Origin", args: [] as const }] : []),
  ];
  const rs = (await client.multicall({
    allowFailure: true,
    contracts,
  })) as MulticallResult<unknown>[];

  // the session-41 viem trap: an all-failed round is a dead RPC, not an empty profile
  if (rs.length > 0 && rs.every((r) => r.status === "failure")) {
    const err = (rs[0] as { status: "failure"; error: Error }).error;
    throw new Error(`entity reads failed (batch): ${err.message}`);
  }

  const blockNumber = await client.getBlockNumber().catch(() => null);
  return {
    entity,
    pls: ok<bigint>(rs[0] as MulticallResult<bigint>) ?? 0n,
    affection: ok<bigint>(rs[1] as MulticallResult<bigint>) ?? 0n,
    choa: ok<bigint>(rs[2] as MulticallResult<bigint>) ?? 0n,
    username: ok<string>(rs[3] as MulticallResult<string>) ?? null,
    name: ok<string>(rs[4] as MulticallResult<string>) ?? null,
    symbol: ok<string>(rs[5] as MulticallResult<string>) ?? null,
    rod: kind === "shio" ? ok<Address>(rs[6] as MulticallResult<Address>) : null,
    cone: kind === "shio" ? ok<Address>(rs[7] as MulticallResult<Address>) : null,
    origin: kind === "yue" ? ok<Address>(rs[6] as MulticallResult<Address>) : null,
    blockNumber,
    fetchedAt: Date.now(),
  };
}

export interface EntityStateHook {
  state: EntityProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useEntityProfile(rpcUrl: string, entity: Address | null, kind: EntityKind = "lau"): EntityStateHook {
  const [state, setState] = useState<EntityProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const client = useMemo(() => makeClient(rpcUrl), [rpcUrl]);

  useEffect(() => {
    if (entity === null) {
      setState(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadEntityProfile(client, entity, kind)
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setState(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, entity, kind, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { state, loading, error, refresh };
}
