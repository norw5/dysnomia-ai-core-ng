import { useCallback, useEffect, useMemo, useState } from "react";
import { type Abi, type Address, type PublicClient } from "viem";
import { makeClient } from "@/chain/client";
import { loadAbi } from "@/chain/abiLoad";
import { addr } from "@config/addresses";
import { simAddr, type SimLayerName } from "@/chain/simMode";

/**
 * The WORLD tile reads (session 58, SIM-only surfaces). All calls go to the
 * harness set-3 fixture stack (simMode resolves the FIXED WORLD/WAR variants
 * — the verbatim sources are undeployable, HARNESS §5). Fork-pinned truths
 * riding these reads:
 *
 * - Code's bounds check destructures HECKE.Compliment's (lon, lat) return as
 *   (qlat, qlon) — Code's "Latitude" IS Compliment's FIRST word. The claim
 *   affordance passes (lon, lat) and every tile read uses the same order.
 * - Tail(venue, 1) is the cauda probe — position 1 is the first creator
 *   slot; 0 = no claim chain (pre-claim).
 * - Beat's outputs (the VITUS mint + the Buzz credit) are Yuan-weighted and
 *   need the caller's ladder lineage (the Eta fresh floor) — a fresh caller
 *   sees an honest readiness note, not a silent zero.
 * - the WAR CO2 counter is the one system-wide cumulative-activity ledger.
 */

const worldViewAbi = [
  { type: "function", name: "Tail", stateMutability: "view", inputs: [{ name: "caude", type: "address" }, { name: "position", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "Bun", stateMutability: "view", inputs: [{ name: "latitude", type: "int256" }, { name: "longitude", type: "int256" }, { name: "caude", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "Buzz", stateMutability: "view", inputs: [{ name: "latitude", type: "int256" }, { name: "coder", type: "address" }, { name: "caude", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const warViewAbi = [
  { type: "function", name: "CO2", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const heckeViewAbi = [
  { type: "function", name: "Compliment", stateMutability: "view", inputs: [{ name: "waat", type: "uint256" }], outputs: [{ type: "int256" }, { type: "int256" }] },
] as const;

export const _worldViewAbi = worldViewAbi;
export const _warViewAbi = warViewAbi;
export const _heckeViewAbi = heckeViewAbi;

export interface WorldTileState {
  /** the venue's anchor in Code's (Latitude, Longitude) convention — swapped vs Compliment's (lon, lat) */
  anchorLat: bigint | null;
  anchorLon: bigint | null;
  /** tile mass at the anchor (Hypobar-weighted; 0 is a real state) */
  bun: bigint | null;
  /** the first creator slot's credit — 0 = no claim chain yet */
  tail: bigint | null;
  /** the active YUE's creator credit at the anchor (only when a YUE is known) */
  buzz: bigint | null;
  /** the system-wide cumulative-activity counter */
  co2: bigint | null;
  errors: string[];
  fetchedAt: number;
}

type Mc<T> = { status: "success"; result: T } | { status: "failure"; error: Error };

function okv<T>(r: Mc<T> | undefined): T | null {
  return r && r.status === "success" ? r.result : null;
}

export async function loadWorldTiles(
  client: PublicClient,
  rpcUrl: string,
  venue: Address,
  waat: bigint | null,
  yue: Address | null
): Promise<WorldTileState> {
  const world = simAddr("WORLD" as SimLayerName, rpcUrl);
  const war = simAddr("WAR" as SimLayerName, rpcUrl);
  const rs = (await client.multicall({
    allowFailure: true,
    contracts: [
      { address: addr("HECKE"), abi: heckeViewAbi, functionName: "Compliment", args: [waat ?? 0n] },
      { address: war, abi: warViewAbi, functionName: "CO2", args: [] },
    ],
  })) as Mc<unknown>[];
  const comp = okv<[bigint, bigint]>(rs[0] as Mc<[bigint, bigint]>);
  // the viem transport-failure trap (session-41 discipline): an all-failed
  // round is a dead RPC (or no fixture deployed) — throw, never render zeros
  if (rs.every((r) => r.status === "failure")) {
    const err = (rs[0] as { status: "failure"; error: Error }).error;
    throw new Error(`world reads failed (fixture batch): ${err.message}`);
  }
  // Code's convention: "Latitude" = Compliment's FIRST word (lon), "Longitude" = the second (lat)
  const anchorLat = comp ? comp[0] : null;
  const anchorLon = comp ? comp[1] : null;

  const second = (await client.multicall({
    allowFailure: true,
    contracts: [
      ...(comp !== null
        ? [
            { address: world, abi: worldViewAbi, functionName: "Bun" as const, args: [comp[0], comp[1], venue] as const },
            ...(yue !== null
              ? [{ address: world, abi: worldViewAbi, functionName: "Buzz" as const, args: [comp[0], yue, venue] as const }]
              : []),
          ]
        : []),
      { address: world, abi: worldViewAbi, functionName: "Tail" as const, args: [venue, 1n] as const },
    ],
  })) as Mc<unknown>[];

  const errors: string[] = [];
  if (rs[0] && rs[0].status === "failure") errors.push(`Compliment: ${rs[0].error.message}`);
  if (rs[1] && rs[1].status === "failure") errors.push(`CO2: ${rs[1].error.message}`);
  second.forEach((r, i) => {
    if (r.status === "failure") errors.push(`tile[${i}]: ${r.error.message}`);
  });

  const bunIdx = 0;
  const buzzIdx = 1;
  const tailIdx = comp !== null ? (yue !== null ? 2 : 1) : 0;

  return {
    anchorLat,
    anchorLon,
    bun: comp !== null ? okv<bigint>(second[bunIdx] as Mc<bigint>) : null,
    buzz: comp !== null && yue !== null ? okv<bigint>(second[buzzIdx] as Mc<bigint>) : null,
    tail: okv<bigint>(second[tailIdx] as Mc<bigint>),
    co2: okv<bigint>(rs[1] as Mc<bigint>),
    errors,
    fetchedAt: Date.now(),
  };
}

export interface WorldTilesHook {
  state: WorldTileState | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useWorldTiles(
  rpcUrl: string,
  venue: Address | null,
  waat: bigint | null,
  yue: Address | null
): WorldTilesHook {
  const client = useMemo(() => makeClient(rpcUrl), [rpcUrl]);
  const [state, setState] = useState<WorldTileState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (venue === null) {
      setState(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadWorldTiles(client, rpcUrl, venue, waat, yue)
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
  }, [client, rpcUrl, venue, waat, yue, tick]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { state, loading, error, refresh };
}

let worldCodeFragment: Promise<Abi> | null = null;

/** the Code-claim calldata builder — (lat, lon) in Code's swapped convention */
export async function encodeWorldCode(lat: bigint, lon: bigint, venue: Address): Promise<`0x${string}`> {
  if (!worldCodeFragment) {
    worldCodeFragment = loadAbi("WORLD.json").then((abi) =>
      (abi as unknown as { type: "function"; name: string }[]).filter(
        (e) => e.type === "function" && e.name === "Code"
      ) as unknown as Abi
    );
  }
  const fragment = await worldCodeFragment;
  const { encodeFunctionData } = await import("viem");
  return encodeFunctionData({ abi: fragment, functionName: "Code", args: [lat, lon, venue] });
}

let worldAbiCache: Promise<Abi> | null = null;

/** the full WORLD ABI for the gate's custom-error decode (OutOfRange etc.) */
export function worldAbi(): Promise<Abi> {
  if (!worldAbiCache) worldAbiCache = loadAbi("WORLD.json");
  return worldAbiCache;
}

const simLedgerAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export const _simLedgerAbi = simLedgerAbi;

/** your YUE's VITUS royalties + H2O water (SIM fixtures; one anonymous batch) */
export async function loadSimLedger(
  client: PublicClient,
  rpcUrl: string,
  yue: Address
): Promise<{ vitus: bigint | null; h2o: bigint | null }> {
  const vitus = simAddr("VITUS", rpcUrl);
  const h2o = simAddr("H2O", rpcUrl);
  const rs = (await client.multicall({
    allowFailure: true,
    contracts: [
      { address: vitus, abi: simLedgerAbi, functionName: "balanceOf", args: [yue] },
      { address: h2o, abi: simLedgerAbi, functionName: "balanceOf", args: [yue] },
    ],
  })) as Mc<unknown>[];
  return {
    vitus: okv<bigint>(rs[0] as Mc<bigint>),
    h2o: okv<bigint>(rs[1] as Mc<bigint>),
  };
}

// ---- the GWAT spawn surface (session 59, SIM-only — venue panel) ----

/**
 * MAP.Forbidden(asset) — the wrapped-asset veto leg of GWAT.Gwat (the same
 * live-MAP view the create pre-check rides; the spawn reverts ForbiddenToken
 * on a forbidden asset). null = unreadable — never a confident "not forbidden".
 */
export const gwatForbiddenAbi = [
  { type: "function", name: "Forbidden", stateMutability: "view", inputs: [{ name: "Asset", type: "address" }], outputs: [{ type: "bool" }] },
] as const;

/** exposed for the selector regression test (never for direct calls) */
export const _gwaterForbiddenAbi = gwatForbiddenAbi;

export async function readGwatForbidden(client: PublicClient, asset: Address): Promise<boolean | null> {
  const { encodeFunctionData } = await import("viem");
  try {
    const raw = await client.call({
      to: addr("MAP"),
      data: encodeFunctionData({ abi: gwatForbiddenAbi as unknown as Abi[], functionName: "Forbidden", args: [asset] }),
    });
    const data = typeof raw === "string" ? (raw as `0x${string}`) : ((raw as { data: `0x${string}` }).data);
    return BigInt(data) !== 0n;
  } catch {
    return null;
  }
}

let gwatAbiCache: Promise<Abi> | null = null;

/** the full GWAT ABI for the gate's custom-error decode (SpawningFailure…) */
export function gwatAbi(): Promise<Abi> {
  if (!gwatAbiCache) gwatAbiCache = loadAbi("GWAT.json");
  return gwatAbiCache;
}

/**
 * GWAT.Gwat(qing, lin) — the spawn encode. `lin` is the cauda POSITION the
 * draw rides (position 1 = the first creator slot — the same slot Tail@1
 * probes); each attempt is a FRESH draw (Faa advances the ring per call).
 */
export async function encodeGwatSpawn(qing: Address, lin: bigint, rpcUrl: string): Promise<{ to: Address; data: `0x${string}`; abi: Abi }> {
  const abi = await gwatAbi();
  const { encodeFunctionData } = await import("viem");
  return {
    to: simAddr("GWAT", rpcUrl),
    data: encodeFunctionData({ abi, functionName: "Gwat", args: [qing, lin] }),
    abi,
  };
}

/**
 * Decode a Gwat DRYRUN result — the call returns the spawned QING (an
 * address). The committed spawn lands at the same nonce-derived address only
 * on a quiet fork (the preview's create is not committed) — render it as a
 * PREVIEW, the receipt's NewQing is the proof.
 */
export function decodeGwatSpawned(result: `0x${string}`): Address | null {
  try {
    if (result.length < 66) return null;
    const a = ("0x" + result.slice(2, 66).slice(24)) as Address;
    return a === "0x0000000000000000000000000000000000000000" ? null : a;
  } catch {
    return null;
  }
}

