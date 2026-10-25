import { decodeFunctionResult, encodeFunctionData, type Abi, type Address, type PublicClient } from "viem";
import { addr } from "@config/addresses";

/**
 * The deed + creation layer (session-51, IA-REEVAL-49 B1.4/8):
 *
 * - DO.Take(qing) — the venue-claim deed. DO has NO recovered source
 *   (kb/dev/do.md — heimdall classification, selector chain-verified
 *   `0x8f26e8d5`), so the fragment below is the minimal hand-pinned encode
 *   surface, NOT a generated ABI: sends to DO classify unknown-contract
 *   (extra ack — intended). The per-venue taken-once flag has NO public
 *   getter, so the DRYRUN is the honest pre-check; a taken venue's Take
 *   reverts, as does one where the caller already passes another owner path.
 *
 * - MAP.New(asset) — venue creation. Perimeter contract (generated ABI via
 *   abiLoad); NewQing(Qing, Integrative, Waat) has NO indexed args, so the
 *   post-send decode reads the data words of the raw log.
 */

/** the hand-pinned Take fragment (kb/dev/do.md §5 — [chain]-verified selector) */
export const doTakeAbi = [
  { type: "function", name: "Take", stateMutability: "nonpayable", inputs: [{ name: "qing", type: "address" }], outputs: [] },
] as const;

/** selector pin (regression-tested — never assume, always assert) */
export const DO_TAKE_SELECTOR = "0x8f26e8d5";

export function encodeTake(qing: Address): `0x${string}` {
  return encodeFunctionData({ abi: doTakeAbi as unknown as Abi, functionName: "Take", args: [qing] });
}

/** NewQing(address,address,uint256) — args NOT indexed (kb/dev/map.md §5) */
export const NEW_QING_TOPIC = "0x692bc76be0a4b0d71d90e36ee97b1f3c4141095ea3c22b01b9f620da2e4b5e2e";

export interface NewQingFacts {
  qing: Address;
  asset: Address;
  /** the Waat == the drawn De × Meridians[0] passed to the QING constructor */
  waat: bigint;
}

/** decode NewQing from a sent receipt's logs (data words — nothing is indexed) */
export function decodeNewQing(logs: ReadonlyArray<{ address: string; topics: string[]; data: `0x${string}` }>): NewQingFacts | null {
  const log = logs.find((l) => l.topics[0]?.toLowerCase() === NEW_QING_TOPIC);
  if (!log || log.data.length < 10) return null;
  try {
    const body = log.data.slice(2);
    const word = (i: number): bigint => BigInt("0x" + body.slice(i * 64, (i + 1) * 64));
    const qing = ("0x" + body.slice(24, 64)) as Address;
    const asset = ("0x" + body.slice(88, 128)) as Address;
    const waat = word(2);
    if (qing === "0x0000000000000000000000000000000000000000") return null;
    return { qing, asset, waat };
  } catch {
    return null;
  }
}

export interface CreatePrecheck {
  /** MAP.Forbidden(asset), read WITH the account as tx.origin — the WITHOUT ban leg is tx.origin-keyed, so this is the caller-honest answer */
  forbidden: boolean | null;
  /** best-effort asset probes (the rename only runs when both staticcalls answer) */
  assetName: string | null;
  assetSymbol: string | null;
  error: string | null;
}

const mapPrecheckAbi = [
  { type: "function", name: "Forbidden", stateMutability: "view", inputs: [{ name: "Asset", type: "address" }], outputs: [{ type: "bool" }] },
] as const;

const erc20MetaAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

/**
 * The pre-create reads (one per call, all cheap): Forbidden(asset) with
 * `from` set (a WITHOUT holder reads forbidden for EVERY asset — the honest
 * per-caller answer), plus the asset's name/symbol the rename would use.
 * `null` fields = unreadable — never rendered as a confident "not forbidden".
 */
export async function readCreatePrecheck(
  client: PublicClient,
  asset: Address,
  account: Address | null
): Promise<CreatePrecheck> {
  let forbidden: boolean | null = null;
  let assetName: string | null = null;
  let assetSymbol: string | null = null;
  let error: string | null = null;
  try {
    const raw = await client.call({
      to: addr("MAP"),
      data: encodeFunctionData({ abi: mapPrecheckAbi as unknown as Abi, functionName: "Forbidden", args: [asset] }),
      ...(account !== null ? { account } : {}),
    });
    const data = typeof raw === "string" ? (raw as `0x${string}`) : ((raw as { data: `0x${string}` }).data);
    forbidden = BigInt(data) !== 0n;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  for (const fn of ["name", "symbol"] as const) {
    try {
      const data = encodeFunctionData({ abi: erc20MetaAbi as unknown as Abi, functionName: fn });
      const raw = await client.call({ to: asset, data });
      const ret = typeof raw === "string" ? (raw as `0x${string}`) : ((raw as { data: `0x${string}` }).data);
      const decoded = decodeFunctionResult({ abi: erc20MetaAbi as unknown as Abi, functionName: fn, data: ret });
      if (typeof decoded === "string" && decoded.length > 0) {
        if (fn === "name") assetName = decoded;
        else assetSymbol = decoded;
      }
    } catch {
      /* unreadable metadata is a real state — the onchain rename skips it too */
    }
  }
  return { forbidden, assetName, assetSymbol, error };
}

const qingMetaAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

/**
 * Synthesize a store VenueRow for a freshly-created venue (it has no seed
 * row until the next seed regen — the panel renders that honestly). Reads
 * name/symbol live; block comes from the creating receipt.
 */
export async function liveVenueRow(
  client: PublicClient,
  venue: Address,
  block: number
): Promise<{ a: string; n: string; s: string; lat: number; band: number; blk: number }> {
  let n = "";
  let s = "";
  try {
    const rs = (await client.multicall({
      allowFailure: true,
      contracts: [
        { address: venue, abi: qingMetaAbi as unknown as Abi[], functionName: "name" },
        { address: venue, abi: qingMetaAbi as unknown as Abi[], functionName: "symbol" },
      ],
    })) as Array<{ status: "success"; result: unknown } | { status: "failure"; error: Error }>;
    if (rs[0]?.status === "success" && typeof rs[0].result === "string") n = rs[0].result;
    if (rs[1]?.status === "success" && typeof rs[1].result === "string") s = rs[1].result;
  } catch {
    /* nameless is a real state */
  }
  // lat/band: unknown until the render seed regenerates — 0 is a placeholder
  // the panel NEVER renders (the render===null branch shows the no-seed note)
  return { a: venue, n, s, lat: 0, band: 0, blk: block };
}
