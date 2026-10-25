import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decodeFunctionResult,
  encodeFunctionData,
  type Abi,
  type Address,
  type PublicClient,
} from "viem";
import { makeClient } from "@/chain/client";
import { loadAbi } from "@/chain/abiLoad";
import { addr } from "@config/addresses";

/**
 * Per-venue live state (IA-PLAN §4 venue panel, session-43; venue-depth
 * extension session-50): ONE anonymous Multicall3 `aggregate3` batch per
 * selected venue — Waat/Asset/Entropy/rates/bouncer/admission PLUS the
 * management-gate probes (GWAT/NoCROWS/bouncer(account)/owner(account),
 * kb §4) and your per-venue attendance bars (YUE.Bar — only when a YUE is
 * active). `from=` never set; account-dependent reads take the account as
 * an ARGUMENT, which keeps them anonymous. Same fail-fast discipline as
 * identity.ts: an all-failed round is a dead RPC, rendered as unreadable —
 * never as "venue has nothing".
 *
 * Expected per-call failures are honest data, not errors: a fresh venue's
 * `GetMarketRate(AFFECTION)` reverts MarketRateNotFound until an owner adds
 * a rate (kb §3 — the acquisition-path story the panel renders).
 */

const qingViewAbi = [
  { type: "function", name: "Waat", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "Asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "Entropy", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "CoverCharge", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "BouncerDivisor", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "GetMarketRate", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "Admitted", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  // session-50 venue depth: the management drawer's live gate reads (kb §4)
  { type: "function", name: "GWAT", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "NoCROWS", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "bouncer", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "bool" }] },
  // MultiOwnable two-arg membership (the no-arg owner() returns address(this) — kb/dev qing.md)
  { type: "function", name: "owner", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "bool" }] },
] as const;

const yueBarAbi = [
  // YUE.Bar(qing) — the per-venue bars VIEW (Hypogram/Epigram outputs = Hypobar/Epibar storage; yue.sol:130)
  { type: "function", name: "Bar", stateMutability: "view", inputs: [{ name: "qing", type: "address" }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
] as const;

/** the wrapped-asset stake probe — DO.Take's real gate (session-51 fork-verified) */
const assetOwnerAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "bool" }] },
] as const;

/** exposed for the selector regression test (never for direct calls) */
export const _qingViewAbi = qingViewAbi;
export const _yueBarAbi = yueBarAbi;
export const _assetOwnerAbi = assetOwnerAbi;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

export interface VenueLiveState {
  venue: Address;
  /** null = the read failed (named in `errors`) — never silently zero */
  waat: bigint | null;
  asset: Address | null;
  entropy: bigint | null;
  totalSupply: bigint | null;
  coverCharge: bigint | null;
  bouncerDivisor: bigint | null;
  /** null = no Ⓐ market rate (MarketRateNotFound — fresh venue, kb §3) or unreadable */
  marketRateAffection: bigint | null;
  marketRateKnown: boolean;
  /** account-dependent reads (only when an account is active) */
  admitted: boolean | null;
  myBalance: bigint | null;
  /** the creation-lottery escrow lock (kb §4): true = Withdraw permanently assert-blocked */
  gwat: boolean | null;
  /** true = the CROWS leg of the bouncer cascade is switched off (AllowCROWS(false) was run) */
  noCrows: boolean | null;
  /** the management drawer gates, evaluated live: door/staff pass for the account (or its LAU) */
  myBouncer: boolean | null;
  /** MultiOwnable membership of the account — the owners surface (AddMarketRate/Withdraw/AllowCROWS) */
  myOwner: boolean | null;
  /** your lifelong attendance bars at THIS venue (YUE.Bar — only when a YUE is active) */
  myHypobar: bigint | null;
  myEpibar: bigint | null;
  /**
   * The deed gate (session-51): DO.Take keys on the WRAPPED ASSET, not the
   * venue — `asset.owner(account)` probed directly on the asset. null =
   * the asset does not answer owner(address) (Take then reverts raw unless
   * the venue wraps your own account token); `assetIsUserToken` covers that
   * fast path (asset == your LAU → eligible outright).
   */
  assetOwnerPass: boolean | null;
  assetIsUserToken: boolean;
  /** named per-call failures for reads that may not legitimately fail */
  errors: string[];
  blockNumber: bigint | null;
  fetchedAt: number;
}

type MulticallResult<T> = { status: "success"; result: T } | { status: "failure"; error: Error };

function ok<T>(r: MulticallResult<T> | undefined): T | null {
  return r && r.status === "success" ? r.result : null;
}

function isMarketRateNotFound(r: MulticallResult<unknown> | undefined): boolean {
  if (!r || r.status !== "failure") return false;
  const msg = r.error.message ?? "";
  return msg.includes("MarketRateNotFound") || msg.includes("0x2ef7bb30");
}

export async function loadVenueState(
  client: PublicClient,
  venue: Address,
  account: Address | null,
  entities?: { lau?: Address | null; yue?: Address | null }
): Promise<VenueLiveState> {
  const lau = entities?.lau ?? null;
  const yue = entities?.yue ?? null;
  const contracts = [
    { address: venue, abi: qingViewAbi, functionName: "Waat", args: [] as const },
    { address: venue, abi: qingViewAbi, functionName: "Asset", args: [] as const },
    { address: venue, abi: qingViewAbi, functionName: "Entropy", args: [] as const },
    { address: venue, abi: qingViewAbi, functionName: "totalSupply", args: [] as const },
    { address: venue, abi: qingViewAbi, functionName: "CoverCharge", args: [] as const },
    { address: venue, abi: qingViewAbi, functionName: "BouncerDivisor", args: [] as const },
    { address: venue, abi: qingViewAbi, functionName: "GetMarketRate", args: [addr("AFFECTION")] as const },
    ...(account !== null
      ? [
          { address: venue, abi: qingViewAbi, functionName: "Admitted", args: [account] as const },
          { address: venue, abi: qingViewAbi, functionName: "balanceOf", args: [account] as const },
          // the management-gate probes (kb §4): _checkBouncer passes on tx.origin,
          // msg.sender OR the tx.origin's LAU — probe the account and its LAU
          { address: venue, abi: qingViewAbi, functionName: "bouncer", args: [account] as const },
          { address: venue, abi: qingViewAbi, functionName: "owner", args: [account] as const },
        ]
      : []),
    ...(account !== null && lau !== null
      ? [{ address: venue, abi: qingViewAbi, functionName: "bouncer", args: [lau] as const }]
      : []),
    { address: venue, abi: qingViewAbi, functionName: "GWAT", args: [] as const },
    { address: venue, abi: qingViewAbi, functionName: "NoCROWS", args: [] as const },
    // your history here: YUE.Bar(venue) — a pure view of the vault's two per-venue mappings
    ...(yue !== null ? [{ address: yue, abi: yueBarAbi, functionName: "Bar", args: [venue] as const }] : []),
  ];

  const rs = (await client.multicall({ allowFailure: true, contracts })) as MulticallResult<unknown>[];

  // the viem transport-failure trap (session-41): every per-call "failure"
  // on an all-failed round is a dead RPC, not an empty venue
  if (rs.length > 0 && rs.every((r) => r.status === "failure")) {
    const err = (rs[0] as { status: "failure"; error: Error }).error;
    throw new Error(`venue reads failed (batch): ${err.message}`);
  }

  const errors: string[] = [];
  const named = (i: number, label: string): void => {
    const r = rs[i];
    if (r && r.status === "failure" && !isMarketRateNotFound(r)) {
      errors.push(`${label}: ${r.error.message}`);
    }
  };
  named(0, "Waat");
  named(1, "Asset");
  named(2, "Entropy");
  named(3, "totalSupply");
  named(4, "CoverCharge");
  named(5, "BouncerDivisor");
  const hasLauProbe = account !== null && lau !== null;
  const gwatIdx = account !== null ? (hasLauProbe ? 12 : 11) : 7;
  const noCrowsIdx = gwatIdx + 1;
  const barIdx = noCrowsIdx + 1;
  if (account !== null) {
    named(7, "Admitted");
    named(8, "balanceOf");
    named(9, "bouncer");
    named(10, "owner");
    if (hasLauProbe) named(11, "bouncer(LAU)");
  }
  named(gwatIdx, "GWAT");
  named(noCrowsIdx, "NoCROWS");
  if (yue !== null) named(barIdx, "Bar");

  const rateRead = rs[6] as MulticallResult<bigint> | undefined;
  const blockNumber = await client.getBlockNumber().catch(() => null);

  const bouncerDirect = account !== null ? ok<boolean>(rs[9] as MulticallResult<boolean>) : null;
  const bouncerViaLau = hasLauProbe ? ok<boolean>(rs[11] as MulticallResult<boolean>) : null;
  const barRead = yue !== null ? (rs[barIdx] as MulticallResult<[bigint, bigint]> | undefined) : undefined;
  const bar = barRead && barRead.status === "success" ? barRead.result : null;

  // the deed gate: DO.Take probes the WRAPPED ASSET for the caller's stake
  // (fork-verified session-51). One follow-up read after the batch (the asset
  // address is a batch RESULT, so it cannot ride the same multicall). Your
  // own account token as the wrapped asset is the fast path (eligible
  // outright, no probe needed).
  const assetRead = ok<Address>(rs[1] as MulticallResult<Address>);
  let assetOwnerPass: boolean | null = null;
  let assetIsUserToken = false;
  if (account !== null && assetRead !== null && assetRead !== ZERO_ADDRESS) {
    if (lau !== null && assetRead.toLowerCase() === lau.toLowerCase()) {
      assetIsUserToken = true;
      assetOwnerPass = true;
    } else {
      try {
        const raw = await client.call({
          to: assetRead,
          data: encodeFunctionData({ abi: assetOwnerAbi as unknown as Abi[], functionName: "owner", args: [account] }),
        });
        const data = typeof raw === "string" ? (raw as `0x${string}`) : ((raw as { data: `0x${string}` }).data);
        assetOwnerPass = BigInt(data) !== 0n;
      } catch {
        assetOwnerPass = null;
      }
    }
  }

  return {
    venue,
    waat: ok<bigint>(rs[0] as MulticallResult<bigint>),
    asset: ok<Address>(rs[1] as MulticallResult<Address>),
    entropy: ok<bigint>(rs[2] as MulticallResult<bigint>),
    totalSupply: ok<bigint>(rs[3] as MulticallResult<bigint>),
    coverCharge: ok<bigint>(rs[4] as MulticallResult<bigint>),
    bouncerDivisor: ok<bigint>(rs[5] as MulticallResult<bigint>),
    marketRateAffection: ok<bigint>(rateRead),
    marketRateKnown: rateRead !== undefined && rateRead.status === "success",
    admitted: account !== null ? ok<boolean>(rs[7] as MulticallResult<boolean>) : null,
    myBalance: account !== null ? ok<bigint>(rs[8] as MulticallResult<bigint>) : null,
    gwat: ok<boolean>(rs[gwatIdx] as MulticallResult<boolean>),
    noCrows: ok<boolean>(rs[noCrowsIdx] as MulticallResult<boolean>),
    myBouncer:
      bouncerDirect === null && bouncerViaLau === null
        ? null
        : (bouncerDirect ?? false) || (bouncerViaLau ?? false),
    myOwner: account !== null ? ok<boolean>(rs[10] as MulticallResult<boolean>) : null,
    myHypobar: bar !== null ? (bar[0] ?? null) : null,
    myEpibar: bar !== null ? (bar[1] ?? null) : null,
    assetOwnerPass,
    assetIsUserToken,
    errors,
    blockNumber,
    fetchedAt: Date.now(),
  };
}

export interface VenueStateHook {
  state: VenueLiveState | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useVenueState(
  rpcUrl: string,
  venue: Address | null,
  account: Address | null,
  entities?: { lau?: Address | null; yue?: Address | null }
): VenueStateHook {
  const client = useMemo(() => makeClient(rpcUrl), [rpcUrl]);
  const lau = entities?.lau ?? null;
  const yue = entities?.yue ?? null;
  const [state, setState] = useState<VenueLiveState | null>(null);
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

  useEffect(() => {
    if (venue === null) {
      setState(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadVenueState(client, venue, account, { lau, yue })
      .then((s) => {
        if (!cancelled && alive.current) setState(s);
      })
      .catch((e: unknown) => {
        if (!cancelled && alive.current) {
          setError(e instanceof Error ? e.message : String(e));
          setState(null);
        }
      })
      .finally(() => {
        if (!cancelled && alive.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, venue, account, lau, yue, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { state, loading, error, refresh };
}

/**
 * Eta readiness (kb §3, session-40 amendments): the deployed third-revision
 * RING.Eta() is NON-VIEW — it is read as a SIMULATED call from the caller
 * (a pure preview; committed results can differ). Fresh callers get
 * `(14, 0, 0, 0)` and META.Beat then panics 0x12 (division by an Eta slot)
 * at ANY funding level; aged callers (months of vault-advancing activity)
 * carry nonzero slots and Beat works — "Yeo is always 0 on your first Beat"
 * is exactly this. Yuan holdings are NOT a gate.
 */
export type EtaSlots = [bigint, bigint, bigint, bigint];

export interface EtaReadiness {
  slots: EtaSlots;
  /** any nonzero slot past the head = vault lineage exists → Beat can run */
  ready: boolean;
}

export function etaReadiness(slots: EtaSlots): EtaReadiness {
  return { slots, ready: slots[1] !== 0n || slots[2] !== 0n || slots[3] !== 0n };
}

/** the reference (14, 7973995094115691, 50653, 69343957)-shape fresh marker */
export function isFreshEta(slots: EtaSlots): boolean {
  return slots[0] === 14n && slots[1] === 0n && slots[2] === 0n && slots[3] === 0n;
}

/**
 * The Eta floor BELOW the floor (fork-verified, session-43): a caller with
 * NO vault at all (no YUE lineage) makes the simulated Eta() itself revert
 * `0x12efd467(sender)` instead of returning zero slots. Three states:
 * no-lineage revert → (14,0,0,0) fresh (Beat panics 0x12) → nonzero aged.
 */
export const ETA_NO_LINEAGE_SELECTOR = "0x12efd467";

export function isEtaNoLineageError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes(ETA_NO_LINEAGE_SELECTOR);
}

let ringEtaFragment: Promise<Abi> | null = null;

/** simulated RING.Eta() from `account` (from= set — an explicit preview, §9) */
export async function readEtaSlots(client: PublicClient, account: Address): Promise<EtaSlots> {
  if (!ringEtaFragment) {
    ringEtaFragment = loadAbi("RING.json").then((abi) =>
      (abi as unknown as { type: "function"; name: "Eta" }[]).filter(
        (e) => e.type === "function" && e.name === "Eta"
      ) as unknown as Abi
    );
  }
  const fragment = await ringEtaFragment;
  const data = encodeFunctionData({ abi: fragment, functionName: "Eta" });
  const raw = await client.call({ to: addr("RING"), data, account });
  const decoded = decodeFunctionResult({
    abi: fragment,
    functionName: "Eta",
    data: typeof raw === "string" ? (raw as `0x${string}`) : ((raw as { data: `0x${string}` }).data),
  });
  const slots = decoded as unknown as [bigint, bigint, bigint, bigint];
  return [slots[0] ?? 0n, slots[1] ?? 0n, slots[2] ?? 0n, slots[3] ?? 0n];
}
