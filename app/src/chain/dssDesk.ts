import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, getContractAddress, type Address, type PublicClient } from "viem";
import dssFixedCreationHex from "@/data/dss_fixed.creation.hex?raw";
import dssFixedRuntimeHex from "@/data/dss_fixed.runtime.hex?raw";
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
 * captured at the creating send (state/dssStore.ts), or adopted after the
 * structural validation below (fixed runtime + owner slot + LAU slot) when
 * it was deployed by another frontend/wallet (session-82.1).
 */

/** the one-line-fixed reference bytecode (verbatim copy of the harness fixture) */
export const DSS_FIXED_CREATION = ("0x" + dssFixedCreationHex.trim().replace(/^0x/, "")) as `0x${string}`;

/** the fixed RUNTIME code (the constructor binds the LAU in storage; the runtime is constant) */
export const DSS_FIXED_RUNTIME = ("0x" + dssFixedRuntimeHex.trim().replace(/^0x/, "")).toLowerCase() as `0x${string}`;

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

export interface DssDeploymentResolution {
  address: Address | null;
  source: "receipt" | "predicted" | null;
  note: string;
}

/**
 * Resolve a just-sent creation address when the receipt is lagging
 * (session-82.1 follow-up: load-balanced RPCs can be a block behind, and a
 * timeout/missing contractAddress must not lose a fresh DSS). The CREATE1
 * prediction is deterministic from the deployer nonce captured just before
 * the send; poll `getCode` at it for a few seconds. The receipt's
 * contractAddress always wins.
 */
export async function resolveDssDeployment(
  client: Pick<PublicClient, "getCode">,
  predicted: Address | null,
  receiptAddress: string | null,
  opts: { attempts?: number; delayMs?: number; validate?: (address: Address) => Promise<boolean> } = {}
): Promise<DssDeploymentResolution> {
  if (typeof receiptAddress === "string" && /^0x[0-9a-fA-F]{40}$/.test(receiptAddress)) {
    return { address: receiptAddress as Address, source: "receipt", note: "creation receipt" };
  }
  if (predicted === null) {
    return {
      address: null,
      source: null,
      note: "the receipt carried no contractAddress and no CREATE1 prediction was available — the node may be lagging; adopt the address manually once it appears (desk → USE THIS DSS, or agent dss_setup)",
    };
  }
  const attempts = Math.max(1, opts.attempts ?? 6);
  const delayMs = Math.max(0, opts.delayMs ?? 1_500);
  for (let i = 0; i < attempts; i++) {
    try {
      const code = await client.getCode({ address: predicted });
      if (typeof code === "string" && code !== "0x") {
        if (opts.validate !== undefined) {
          const ok = await opts.validate(predicted).catch(() => false);
          if (!ok) {
            return {
              address: null,
              source: null,
              note: "the predicted address carries code but it is not the fixed DSS (the account nonce moved) — use the receipt address, or adopt the real address manually",
            };
          }
        }
        return {
          address: predicted,
          source: "predicted",
          note: "the receipt was lagging/lacked contractAddress; the predicted CREATE1 address now carries the fixed DSS code",
        };
      }
    } catch {
      /* a lagging/rotating node — retry */
    }
    if (i < attempts - 1 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
  return {
    address: null,
    source: null,
    note: "the receipt carried no contractAddress and the predicted address has no code yet — the node may still be lagging; adopt the address manually once it appears (desk → USE THIS DSS, or agent dss_setup)",
  };
}

/**
 * Validate a DSS deployed by another frontend/wallet (session-82.1, the
 * owner's manual-deploy report). The contract has no getter, so the check
 * is structural:
 *   - code at the address equals the fixed runtime byte-for-byte;
 *   - storage slot 0 (ownerAddress) is the active account (the onlyOwner
 *     gate the agent's sends pass);
 *   - storage slot 1 (LAUAddress) is the active LAU (the binding the
 *     chatAndSnipe path uses).
 * Slot 2 is the baked AFFECTION constant; slots 3-5 are the cached
 * interfaces. A mismatch is an honest refusal; an unreadable slot is
 * "could not validate", never a false invalid.
 */
export interface DssValidation {
  ok: boolean;
  code: "match" | "mismatch" | "empty" | "unreadable";
  owner: Address | null;
  ownerMatches: boolean | null;
  lau: Address | null;
  lauMatches: boolean | null;
  reason: string | null;
}

function slotAddress(slot: string | null | undefined): Address | null {
  if (typeof slot !== "string") return null;
  const hex = slot.replace(/^0x/, "");
  if (hex.length !== 64) return null;
  return (`0x${hex.slice(24)}` as Address);
}

export async function validateDss(
  client: PublicClient,
  address: Address,
  account: Address,
  lau: Address
): Promise<DssValidation> {
  const base: Pick<DssValidation, "owner" | "ownerMatches" | "lau" | "lauMatches"> = {
    owner: null,
    ownerMatches: null,
    lau: null,
    lauMatches: null,
  };
  let code: string | undefined;
  try {
    code = await client.getCode({ address });
  } catch (e) {
    return {
      ...base,
      ok: false,
      code: "unreadable",
      reason: `could not read the code at ${address}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (typeof code !== "string" || code === "0x") {
    return { ...base, ok: false, code: "empty", reason: "no contract code at that address (wrong chain, or not deployed)" };
  }
  if (code.toLowerCase() !== DSS_FIXED_RUNTIME) {
    return {
      ...base,
      ok: false,
      code: "mismatch",
      reason: "the code does not match the fixed DSS runtime (a different DSS build or an unrelated contract)",
    };
  }
  let ownerSlot: string | undefined;
  let lauSlot: string | undefined;
  try {
    [ownerSlot, lauSlot] = await Promise.all([
      client.getStorageAt({ address, slot: "0x0" }),
      client.getStorageAt({ address, slot: "0x1" }),
    ]);
  } catch (e) {
    return {
      ...base,
      ok: false,
      code: "match",
      reason: `the code matches but the owner/LAU slots were unreadable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const owner = slotAddress(ownerSlot);
  const bound = slotAddress(lauSlot);
  const ownerMatches = owner !== null && owner.toLowerCase() === account.toLowerCase();
  const lauMatches = bound !== null && bound.toLowerCase() === lau.toLowerCase();
  const reasons: string[] = [];
  if (!ownerMatches) reasons.push(`the DSS owner is ${owner ?? "unreadable"}, not the active account ${account}`);
  if (!lauMatches) reasons.push(`the DSS binds ${bound ?? "unreadable"}, not your LAU ${lau}`);
  return {
    ok: ownerMatches && lauMatches,
    code: "match",
    owner,
    ownerMatches,
    lau: bound,
    lauMatches,
    reason: reasons.length > 0 ? reasons.join("; ") : null,
  };
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
