import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, getContractAddress, type Address, type PublicClient } from "viem";
import dssFixedCreationHex from "@/data/dss_fixed.creation.hex?raw";
import { makeClient } from "@/chain/client";
import { addr } from "@config/addresses";

/**
 * The DSS self-snipe desk (session-66) + the LAU EMISSION surface.
 *
 * FORK-PINNED SEMANTICS (harness set-2 s7/s8/s14, pin 27,674,000):
 *  - every owner action on a LAU meters exactly 1 unit (1e18) into the
 *    LAU's OWN balance — a publicly purchasable pool at 1 Ⓐ/unit (the
 *    DYSNOMIA ctor posts the AFFECTION rate 1:1; `Purchase` is PUBLIC,
 *    so ANYONE can buy your emission — the front-run window)
 *  - `mintToCap()` mints SILENTLY (no world line) — batch self-mint does
 *    NOT need chat spam; ONE `Purchase(AFFECTION, N×1e18)` collects N
 *    units for N Ⓐ in a single tx
 *  - `LAU.Chat(text)` posts "<Username> text" onto the WORLD SHIO (the
 *    ZHOU route — the world channel's write path) AND meters 1 unit
 *  - the DSS (DysnomiaSelfSnipe, the community gist with the one-line
 *    constructor fix — harness fixture `dss-fixed`, runtime byte-pinned)
 *    bundles chat + pull-1-Ⓐ + Purchase + forward ATOMICALLY: no window
 *    between your line and your self-purchase. The as-shipped gist binds
 *    ILAU(0) and reverts — never shipped here.
 *  - the deploy itself: a CREATION tx (to: null). eth_call without `to`
 *    is the DRYRUN; the address is CREATE1 from the deployer's next
 *    nonce (prediction == receipt.contractAddress, fork-pinned).
 *
 * The DSS carries NO getter of any kind (no owner(), no LAU() view) — the
 * app holds the deployed address the way it holds the home QING:
 * captured at the creating send (state/dssStore.ts). A DSS deployed by
 * another frontend reads as "not deployed" — capture-at-create only.
 */

/** the one-line-fixed reference bytecode (verbatim copy of the harness fixture) */
export const DSS_FIXED_CREATION = ("0x" + dssFixedCreationHex.trim().replace(/^0x/, "")) as `0x${string}`;

const dssAbi = [
  { type: "function", name: "chatAndSnipe", stateMutability: "nonpayable", inputs: [{ name: "text", type: "string" }], outputs: [] },
  { type: "function", name: "chat", stateMutability: "nonpayable", inputs: [{ name: "text", type: "string" }], outputs: [] },
  { type: "function", name: "withdrawLAU", stateMutability: "payable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

const lauDeskAbi = [
  { type: "function", name: "mintToCap", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "Purchase", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "Chat", stateMutability: "nonpayable", inputs: [{ name: "text", type: "string" }], outputs: [] },
] as const;

const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

/** exposed for the selector regression test (never for direct calls) */
export const _dssAbi = dssAbi;
export const _lauDeskAbi = lauDeskAbi;

export const AFFECTION_UNIT = 10n ** 18n;

// ---- encodes (hand-pinned fragments; the selector test rows check them) ----

export function encodeDssDeploy(lau: Address): `0x${string}` {
  return (DSS_FIXED_CREATION + lau.slice(2).toLowerCase().padStart(64, "0")) as `0x${string}`;
}

export function dssChatAndSnipeData(text: string): `0x${string}` {
  return encodeFunctionData({ abi: dssAbi, functionName: "chatAndSnipe", args: [text] });
}

export function dssChatData(text: string): `0x${string}` {
  return encodeFunctionData({ abi: dssAbi, functionName: "chat", args: [text] });
}

export function dssWithdrawLauData(amount: bigint): `0x${string}` {
  return encodeFunctionData({ abi: dssAbi, functionName: "withdrawLAU", args: [amount] });
}

export function lauMintToCapData(): `0x${string}` {
  return encodeFunctionData({ abi: lauDeskAbi, functionName: "mintToCap" });
}

/** LAU.Purchase(AFFECTION, amount) — the direct collect leg (1 Ⓐ per unit) */
export function lauPurchaseData(amount: bigint): `0x${string}` {
  return encodeFunctionData({ abi: lauDeskAbi, functionName: "Purchase", args: [addr("AFFECTION"), amount] });
}

/** LAU.Chat(text) — the world-channel line without a snipe */
export function lauChatData(text: string): `0x${string}` {
  return encodeFunctionData({ abi: lauDeskAbi, functionName: "Chat", args: [text] });
}

/** Ⓐ approve (exact-amount — the standing rule; never MaxUint256) */
export function affectionApproveData(spender: Address, amount: bigint): `0x${string}` {
  return encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] });
}

/** the CREATE1 prediction — the address iff this is your next included tx */
export async function predictDssAddress(client: PublicClient, account: Address): Promise<Address> {
  const nonce = await client.getTransactionCount({ address: account });
  return getContractAddress({ opcode: "CREATE", from: account, nonce: BigInt(nonce) });
}

// ---- reads (ONE anonymous batch; account-dependent legs take the account
// ---- as an ARGUMENT — the identity.ts/venueState.ts discipline) ----

export interface DssDeskState {
  /** the LAU's purchasable emission pool (units of 1e18 held by the LAU) */
  lauPool: bigint | null;
  myLau: bigint | null;
  myAffection: bigint | null;
  /** Ⓐ allowance player→LAU (the direct collect leg's spend) */
  affectionToLau: bigint | null;
  /** Ⓐ allowance player→DSS (the snipe leg's pull); null = no DSS captured */
  affectionToDss: bigint | null;
  /** code presence at the captured DSS address; null = read failed */
  dssDeployed: boolean | null;
  errors: string[];
  blockNumber: bigint | null;
  fetchedAt: number;
}

export async function loadDssDeskState(
  client: PublicClient,
  account: Address,
  lau: Address,
  dss: Address | null
): Promise<DssDeskState> {
  const contracts = [
    { address: lau, abi: erc20Abi, functionName: "balanceOf", args: [lau] as const },
    { address: lau, abi: erc20Abi, functionName: "balanceOf", args: [account] as const },
    { address: addr("AFFECTION"), abi: erc20Abi, functionName: "balanceOf", args: [account] as const },
    { address: addr("AFFECTION"), abi: erc20Abi, functionName: "allowance", args: [account, lau] as const },
    ...(dss !== null
      ? [
          { address: addr("AFFECTION"), abi: erc20Abi, functionName: "allowance", args: [account, dss] as const },
        ]
      : []),
  ];

  const rs = (await client.multicall({ allowFailure: true, contracts })) as unknown as Array<
    { status: "success"; result: unknown } | { status: "failure"; error: Error }
  >;

  // the viem transport-failure trap (session-41): an all-failed round is a dead RPC
  if (rs.length > 0 && rs.every((r) => r.status === "failure")) {
    const err = (rs[0] as { status: "failure"; error: Error }).error;
    throw new Error(`DSS desk reads failed (batch): ${err.message}`);
  }

  const errors: string[] = [];
  const labels = ["LAU pool", "my LAU", "my Ⓐ", "Ⓐ→LAU allowance"];
  if (dss !== null) labels.push("Ⓐ→DSS allowance");
  rs.forEach((r, i) => {
    if (r.status === "failure") errors.push(`${labels[i] ?? i}: ${r.error.message}`);
  });

  const okv = (i: number): bigint | null =>
    rs[i] && rs[i].status === "success" ? (rs[i].result as bigint) : null;

  const dssDeployed =
    dss !== null
      ? await client
          .getCode({ address: dss })
          .then((c) => c !== undefined && c !== "0x")
          .catch(() => null)
      : null;

  const blockNumber = await client.getBlockNumber().catch(() => null);
  return {
    lauPool: okv(0),
    myLau: okv(1),
    myAffection: okv(2),
    affectionToLau: okv(3),
    affectionToDss: dss !== null ? okv(4) : null,
    dssDeployed,
    errors,
    blockNumber,
    fetchedAt: Date.now(),
  };
}

/** the DSS address from a sent deploy outcome — the receipt is the truth */
export function captureDssFromReceipt(outcome: {
  status: string;
  receipt?: { contractAddress?: string | null } | null;
}): Address | null {
  if (outcome.status !== "sent") return null;
  const a = outcome.receipt?.contractAddress;
  return typeof a === "string" && a.length === 42 ? (a as Address) : null;
}

// ---- the desk reader hook (ONE anonymous batch per refresh) ----

export interface DssDeskHook {
  state: DssDeskState | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useDssDesk(
  rpcUrl: string,
  account: Address | null,
  lau: Address | null,
  dss: Address | null,
  /** bump to re-read (the pane re-reads on gate receipts) */
  refreshKey: bigint | number
): DssDeskHook {
  const client = useMemo(() => makeClient(rpcUrl), [rpcUrl]);
  const [state, setState] = useState<DssDeskState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (account === null || lau === null) {
      setState(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadDssDeskState(client, account, lau, dss)
      .then((s) => {
        if (!cancelled && alive.current) {
          setState(s);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        // a dead RPC throws (the batch law) — the last good state stays
        if (!cancelled && alive.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, account, lau, dss, refreshKey]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    loadDssDeskState(client, account!, lau!, dss)
      .then((s) => {
        if (alive.current) setState(s);
      })
      .catch((e: unknown) => {
        if (alive.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
  }, [client, account, lau, dss]);

  return { state, loading, error, refresh };
}
