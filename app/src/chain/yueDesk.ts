import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address, PublicClient } from "viem";
import { makeClient } from "@/chain/client";
import { addr } from "@config/addresses";

/**
 * The YUE exchange desk reader (IA-REEVAL-49 B1.5, session-52) + the base
 * Ⓐ Redeem leg reads. ONE anonymous Multicall3 batch per refresh —
 * `from=` never set; account-dependent reads take the account as an
 * ARGUMENT (the identity.ts/venueState.ts discipline).
 *
 * FORK-PINNED FUNDING STORY (harness set-2 s12, pin 27,674,000): every
 * transfer inside YUE.Hong/Hung is called BY the YUE, so BOTH legs pay out
 * of the VAULT'S OWN INVENTORY — Hong pays venue tokens the vault already
 * holds (`venue.balanceOf(yue)`), Hung pays wrapped assets it holds
 * (`asset.balanceOf(yue)`). The venue's self-escrow is never the
 * counterparty on this desk (unlike the base Purchase/Redeem ON the venue,
 * which pay from the venue's escrow). A 0 `GetAssetRate` = no route
 * (`ExchangeRateNotFound` on use — fresh venues carry no rate for their
 * own asset); the direct pair returns the POSTED rate unchanged (the
 * 777-mod attenuation divides a zero accumulator on hop one).
 */

const yueDeskAbi = [
  // YUE.GetAssetRate(GwatAsset, Integrative) — the composed walk (a view; the
  // honest source of truth — never re-implemented client-side)
  { type: "function", name: "GetAssetRate", stateMutability: "view", inputs: [{ name: "gwat", type: "address" }, { name: "integrative", type: "address" }], outputs: [{ type: "uint256" }] },
  // YUE.IsValidAsset(GwatAsset, Integrative) — the ancestor check Hong/Hung gate on
  { type: "function", name: "IsValidAsset", stateMutability: "view", inputs: [{ name: "gwat", type: "address" }, { name: "integrative", type: "address" }], outputs: [{ type: "bool" }] },
] as const;

const erc20ViewAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

/** exposed for the selector regression test (never for direct calls) */
export const _yueDeskAbi = yueDeskAbi;
export const _erc20ViewAbi = erc20ViewAbi;

export interface YueDeskState {
  /** the composed walk (0 = no route — ExchangeRateNotFound on use); null = read failed */
  rate: bigint | null;
  /** IsValidAsset(venue, asset) — the pair check; null = read failed */
  pairValid: boolean | null;
  /** the vault's own venue-token inventory — Hong pays from THIS (fork-pinned) */
  yueQingPot: bigint | null;
  /** the vault's own wrapped-asset inventory — Hung pays from THIS (fork-pinned) */
  yueAssetPot: bigint | null;
  /** account-dependent (only when an account is active) */
  myQing: bigint | null;
  myAsset: bigint | null;
  /** venue-token allowance → the YUE (the Hung spend leg) */
  qingAllowance: bigint | null;
  /** wrapped-asset allowance → the YUE (the Hong spend leg) */
  assetAllowance: bigint | null;
  errors: string[];
  blockNumber: bigint | null;
  fetchedAt: number;
}

type MulticallResult<T> = { status: "success"; result: T } | { status: "failure"; error: Error };

function ok<T>(r: MulticallResult<T> | undefined): T | null {
  return r && r.status === "success" ? r.result : null;
}

export async function loadYueDesk(
  client: PublicClient,
  yue: Address,
  venue: Address,
  asset: Address,
  account: Address | null
): Promise<YueDeskState> {
  const contracts = [
    { address: yue, abi: yueDeskAbi, functionName: "GetAssetRate", args: [venue, asset] as const },
    { address: yue, abi: yueDeskAbi, functionName: "IsValidAsset", args: [venue, asset] as const },
    { address: venue, abi: erc20ViewAbi, functionName: "balanceOf", args: [yue] as const },
    { address: asset, abi: erc20ViewAbi, functionName: "balanceOf", args: [yue] as const },
    ...(account !== null
      ? [
          { address: venue, abi: erc20ViewAbi, functionName: "balanceOf", args: [account] as const },
          { address: asset, abi: erc20ViewAbi, functionName: "balanceOf", args: [account] as const },
          { address: venue, abi: erc20ViewAbi, functionName: "allowance", args: [account, yue] as const },
          { address: asset, abi: erc20ViewAbi, functionName: "allowance", args: [account, yue] as const },
        ]
      : []),
  ];

  const rs = (await client.multicall({ allowFailure: true, contracts })) as MulticallResult<unknown>[];

  // the viem transport-failure trap (session-41): an all-failed round is a dead RPC
  if (rs.length > 0 && rs.every((r) => r.status === "failure")) {
    const err = (rs[0] as { status: "failure"; error: Error }).error;
    throw new Error(`desk reads failed (batch): ${err.message}`);
  }

  const errors: string[] = [];
  const named = (i: number, label: string): void => {
    const r = rs[i];
    if (r && r.status === "failure") errors.push(`${label}: ${r.error.message}`);
  };
  for (let i = 0; i < (account !== null ? 8 : 4); i++) {
    named(i, ["GetAssetRate", "IsValidAsset", "vault qing pot", "vault asset pot", "my qing", "my asset", "qing allowance", "asset allowance"][i]!);
  }

  const blockNumber = await client.getBlockNumber().catch(() => null);
  return {
    rate: ok<bigint>(rs[0] as MulticallResult<bigint>),
    pairValid: ok<boolean>(rs[1] as MulticallResult<boolean>),
    yueQingPot: ok<bigint>(rs[2] as MulticallResult<bigint>),
    yueAssetPot: ok<bigint>(rs[3] as MulticallResult<bigint>),
    myQing: account !== null ? ok<bigint>(rs[4] as MulticallResult<bigint>) : null,
    myAsset: account !== null ? ok<bigint>(rs[5] as MulticallResult<bigint>) : null,
    qingAllowance: account !== null ? ok<bigint>(rs[6] as MulticallResult<bigint>) : null,
    assetAllowance: account !== null ? ok<bigint>(rs[7] as MulticallResult<bigint>) : null,
    errors,
    blockNumber,
    fetchedAt: Date.now(),
  };
}

export interface YueDeskHook {
  state: YueDeskState | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useYueDesk(
  rpcUrl: string,
  yue: Address | null,
  venue: Address | null,
  asset: Address | null,
  account: Address | null
): YueDeskHook {
  const client = useMemo(() => makeClient(rpcUrl), [rpcUrl]);
  const [state, setState] = useState<YueDeskState | null>(null);
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
    if (yue === null || venue === null || asset === null) {
      setState(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadYueDesk(client, yue, venue, asset, account)
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
  }, [client, yue, venue, asset, account, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { state, loading, error, refresh };
}

/**
 * The base Ⓐ Redeem leg reads (session-52): `QING.Redeem(AFFECTION, a)` is
 * PUBLIC, pulls `a` of the VENUE TOKEN from the caller with the allowance
 * spender == THE VENUE ITSELF (the base Redeem calls
 * `DYSNOMIA(address(this)).transferFrom` — fork-pinned in s12 (g)), and
 * pays `a × rate / 1e18` Ⓐ out of the venue's Ⓐ escrow (filled by
 * Purchases). The preview renders all three honestly.
 */
export interface VenueRedeemLeg {
  /** the venue's Ⓐ escrow — what Redeem can actually pay out */
  affectionEscrow: bigint | null;
  /** your venue-token allowance with spender == the venue (the quirky prerequisite) */
  selfAllowance: bigint | null;
  /** your venue tokens (redeemable) */
  myQing: bigint | null;
  errors: string[];
  blockNumber: bigint | null;
  fetchedAt: number;
}

export async function loadVenueRedeemLeg(
  client: PublicClient,
  venue: Address,
  account: Address | null
): Promise<VenueRedeemLeg> {
  const contracts = [
    { address: addr("AFFECTION"), abi: erc20ViewAbi, functionName: "balanceOf", args: [venue] as const },
    ...(account !== null
      ? [
          { address: venue, abi: erc20ViewAbi, functionName: "allowance", args: [account, venue] as const },
          { address: venue, abi: erc20ViewAbi, functionName: "balanceOf", args: [account] as const },
        ]
      : []),
  ];

  const rs = (await client.multicall({ allowFailure: true, contracts })) as MulticallResult<unknown>[];
  if (rs.length > 0 && rs.every((r) => r.status === "failure")) {
    const err = (rs[0] as { status: "failure"; error: Error }).error;
    throw new Error(`redeem-leg reads failed (batch): ${err.message}`);
  }

  const errors: string[] = [];
  const labels = ["Ⓐ escrow", "self-allowance", "my venue tokens"];
  rs.forEach((r, i) => {
    if (r.status === "failure") errors.push(`${labels[i]}: ${r.error.message}`);
  });

  const blockNumber = await client.getBlockNumber().catch(() => null);
  return {
    affectionEscrow: ok<bigint>(rs[0] as MulticallResult<bigint>),
    selfAllowance: account !== null ? ok<bigint>(rs[1] as MulticallResult<bigint>) : null,
    myQing: account !== null ? ok<bigint>(rs[2] as MulticallResult<bigint>) : null,
    errors,
    blockNumber,
    fetchedAt: Date.now(),
  };
}

/**
 * The base Ⓐ Purchase leg reads (session-55): `QING.Purchase(AFFECTION, a)`
 * pulls `a × rate / 1e18` Ⓐ from the SENDER via transferFrom — the
 * prerequisite is the Ⓐ allowance with spender == THE VENUE (exact-amount
 * APPROVE first when short, the manual desk's conditional button).
 */
export interface VenuePurchaseLeg {
  /** your Ⓐ allowance with spender == the venue (the Purchase prerequisite) */
  affectionAllowance: bigint | null;
  errors: string[];
  blockNumber: bigint | null;
  fetchedAt: number;
}

export async function loadVenuePurchaseLeg(
  client: PublicClient,
  venue: Address,
  account: Address | null
): Promise<VenuePurchaseLeg> {
  if (account === null) {
    return { affectionAllowance: null, errors: [], blockNumber: await client.getBlockNumber().catch(() => null), fetchedAt: Date.now() };
  }
  const rs = (await client.multicall({
    allowFailure: true,
    contracts: [{ address: addr("AFFECTION"), abi: erc20ViewAbi, functionName: "allowance", args: [account, venue] as const }],
  })) as MulticallResult<unknown>[];
  if (rs.length > 0 && rs.every((r) => r.status === "failure")) {
    const err = (rs[0] as { status: "failure"; error: Error }).error;
    throw new Error(`purchase-leg read failed (batch): ${err.message}`);
  }
  const blockNumber = await client.getBlockNumber().catch(() => null);
  return {
    affectionAllowance: ok<bigint>(rs[0] as MulticallResult<bigint>),
    errors: rs[0]?.status === "failure" ? [`Ⓐ allowance: ${(rs[0] as { status: "failure"; error: Error }).error.message}`] : [],
    blockNumber,
    fetchedAt: Date.now(),
  };
}

export function useVenueRedeemLeg(rpcUrl: string, venue: Address | null, account: Address | null): {
  state: VenueRedeemLeg | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const client = useMemo(() => makeClient(rpcUrl), [rpcUrl]);
  const [state, setState] = useState<VenueRedeemLeg | null>(null);
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
    loadVenueRedeemLeg(client, venue, account)
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
  }, [client, venue, account, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { state, loading, error, refresh };
}
