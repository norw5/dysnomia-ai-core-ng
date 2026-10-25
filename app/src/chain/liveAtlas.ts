import {
  decodeFunctionResult,
  encodeFunctionData,
  type Abi,
  type Address,
  type PublicClient,
} from "viem";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addr } from "@config/addresses";
import {
  heckeCoords,
  loadAtlasMath,
  synthesizeRenderRow,
  type RenderRow,
} from "@/state/atlas";
import { currentVenue, setCurrentVenue, type VenueRow } from "@/state/venueStore";
import { makeClient } from "@/chain/client";

/**
 * LIVE-venue atlas synthesis (session-67, the agent-driven map UX round): a
 * venue created after the last render-seed regen has NO seed row — until now
 * that meant "no map marker, no coordinates". But the coordinates are fully
 * onchain: `QING.Waat()` + `HECKE.Compliment(waat) → (int256 Longitude,
 * int256 Latitude)` (both views, kb §9) + the meridian table shipped verbatim
 * in the render seed's meta → the EXACT same math the generator runs
 * (`state/atlas.ts heckeCoords`, pinned to the tool by the self-check test).
 *
 * TWO anonymous round-trips (waat feeds Compliment): one Multicall3 batch
 * for name/symbol/Waat on the venue, one eth_call on the PERIMETER HECKE.
 * A dead RPC THROWS — callers render the honest "live coords unavailable"
 * note, never a phantom position (UNREADABLE ≠ ABSENT).
 */

const venueMetaAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "Waat", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const heckeComplimentAbi = [
  {
    type: "function",
    name: "Compliment",
    stateMutability: "view",
    inputs: [{ name: "Waat", type: "uint256" }],
    outputs: [{ name: "Longitude", type: "int256" }, { name: "Latitude", type: "int256" }],
  },
] as const;

/** exposed for the selector regression test (never for direct calls) */
export const _liveAtlasAbis = { venueMetaAbi, heckeComplimentAbi };

export interface LiveRenderRow {
  row: RenderRow;
  /** the raw Compliment ints — the HUD card's "HECKE live-computed" grounding */
  raw: { longitude: bigint; latitude: bigint };
}

/**
 * Read a not-yet-seeded venue's TRUE atlas row live. `block` is the creation
 * block when known (the creating receipt) — 0 renders as "unknown" upstream,
 * never as a false block 0.
 */
export async function liveRenderRow(
  client: PublicClient,
  venue: Address,
  block = 0
): Promise<LiveRenderRow> {
  const rs = (await client.multicall({
    allowFailure: true,
    contracts: [
      { address: venue, abi: venueMetaAbi as unknown as Abi[], functionName: "name" },
      { address: venue, abi: venueMetaAbi as unknown as Abi[], functionName: "symbol" },
      { address: venue, abi: venueMetaAbi as unknown as Abi[], functionName: "Waat" },
    ],
  })) as Array<{ status: "success"; result: unknown } | { status: "failure"; error: Error }>;
  const name = rs[0]?.status === "success" && typeof rs[0].result === "string" ? rs[0].result : "";
  const symbol = rs[1]?.status === "success" && typeof rs[1].result === "string" ? rs[1].result : "";
  if (rs[2]?.status !== "success" || typeof rs[2].result !== "bigint") {
    throw new Error(`${venue} is not readable as a venue (no Waat)`);
  }
  const waat = rs[2].result;

  const data = encodeFunctionData({
    abi: heckeComplimentAbi as unknown as Abi[],
    functionName: "Compliment",
    args: [waat],
  });
  const raw = await client.call({ to: addr("HECKE"), data });
  const ret = typeof raw === "string" ? (raw as `0x${string}`) : ((raw as { data: `0x${string}` }).data);
  const [longitude, latitude] = decodeFunctionResult({
    abi: heckeComplimentAbi as unknown as Abi[],
    functionName: "Compliment",
    data: ret,
  }) as [bigint, bigint];

  const math = await loadAtlasMath();
  const coords = heckeCoords(waat, longitude, latitude, math);
  return {
    row: synthesizeRenderRow({ a: venue, n: name, s: symbol, blk: block }, coords, waat.toString()),
    raw: { longitude, latitude },
  };
}

// ---- the React binding (the useVenueState discipline) ----

export interface LiveRenderRowHook {
  /** the resolved atlas row (seed hit or live-computed) */
  row: RenderRow | null;
  /** seed = the render seed; live = HECKE-computed this session; null = unresolved */
  source: "seed" | "live" | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Resolve the CURRENT venue's atlas row: the seed when it holds one, else a
 * live HECKE computation (name/symbol/Waat + Compliment). A successful live
 * read also ENRICHES the app-global store row in place (real band/fold —
 * liveVenueRow's zeros were placeholders every consumer had to dodge);
 * identity-scoped stale-while-revalidate: state clears only when the venue
 * ADDRESS changes (the 64.1 law), never on refetch failure.
 */
export function useLiveRenderRow(
  rpcUrl: string,
  current: VenueRow | null,
  seedRows: RenderRow[] | null
): LiveRenderRowHook {
  const client = useMemo(() => makeClient(rpcUrl), [rpcUrl]);
  const [live, setLive] = useState<{ a: string; row: RenderRow } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const address = current !== null ? current.a.toLowerCase() : null;
  const seedRow = useMemo(
    () =>
      address !== null && seedRows !== null
        ? seedRows.find((r) => r.a === address) ?? null
        : null,
    [seedRows, address]
  );

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    // identity change clears (address-scoped); a refetch failure keeps the
    // last good row — stale-while-revalidate
    if (address === null) {
      setLive(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLive((prev) => (prev !== null && prev.a !== address ? null : prev));
    if (seedRows === null || seedRow !== null) {
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const storeRow = currentVenue();
    const knownBlock = storeRow !== null && storeRow.a.toLowerCase() === address && storeRow.blk > 0 ? storeRow.blk : 0;
    liveRenderRow(client, address as Address, knownBlock)
      .then(({ row }) => {
        if (cancelled || !alive.current) return;
        setLive({ a: address, row });
        setLoading(false);
        // enrich the store row with the TRUE band/fold (placeholder zeros
        // from liveVenueRow/focus_map become real; blk preserved when known)
        const cur = currentVenue();
        if (
          cur !== null &&
          cur.a.toLowerCase() === address &&
          (cur.band !== row.band || cur.lat !== row.f || (cur.blk === 0 && row.blk > 0))
        ) {
          setCurrentVenue({ ...cur, band: row.band, lat: row.f, blk: cur.blk > 0 ? cur.blk : row.blk });
        }
      })
      .catch((e: unknown) => {
        if (cancelled || !alive.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, address, seedRow, seedRows, tick]);

  if (seedRow !== null) return { row: seedRow, source: "seed", error: null, loading: false, refresh };
  if (live !== null && live.a === address) return { row: live.row, source: "live", error, loading, refresh };
  return { row: null, source: null, error, loading, refresh };
}
