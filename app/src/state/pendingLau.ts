import { useSyncExternalStore } from "react";
import type { Address } from "viem";
import type { GateOutcome } from "@/chain/txGate";

/**
 * The receipt-carried LAU forward (session-64, the onboarding completion):
 * `LAUFactory.New` CREATES the account token but does NOT register it — the
 * wallet→LAU discovery (`snapshot.lau` = CHO.GetUserTokenAddress) is written
 * only by CHOA.Play → Cho().Enter. This store carries the created LAU from
 * the create_lau SEND receipt until that onchain discovery resolves, so the
 * onboarding chain (Username → YUE → register) can proceed pre-registration.
 *
 * Per account (lowercased key), persisted like the other app-global stores;
 * cleared when discovery resolves (the snapshot supersedes) or on an
 * explicit clear (account switch does NOT clear — entries are keyed).
 */

const KEY = "dys.lau.pending.v1";

export interface PendingLau {
  /** the created LAU (LAUFactory.New receipt) */
  lau: Address;
  /** the creating tx, when known — honesty for the identity column */
  txHash: string | null;
  t: number;
}

type PendingMap = Record<string, PendingLau>;

function load(): PendingMap {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PendingMap;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

let pending: PendingMap = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    /* storage unavailable */
  }
}

function notify(): void {
  for (const fn of listeners) fn();
}

function keyOf(account: Address): string {
  return account.toLowerCase();
}

export function pendingLau(account: Address | null): PendingLau | null {
  if (account === null) return null;
  return pending[keyOf(account)] ?? null;
}

/** record the created LAU (create_lau's SEND path; discovery has not landed) */
export function setPendingLau(account: Address, lau: Address, txHash: string | null = null): void {
  const k = keyOf(account);
  const prev = pending[k];
  if (prev !== undefined && prev.lau.toLowerCase() === lau.toLowerCase()) return;
  pending = { ...pending, [k]: { lau, txHash, t: Date.now() } };
  persist();
  notify();
}

/**
 * Discovery resolved (snapshot.lau is truth) — drop the carriage for the
 * account. Returns the cleared entry for callers that want to notice.
 */
export function clearPendingLau(account: Address): PendingLau | null {
  const k = keyOf(account);
  const prev = pending[k];
  if (prev === undefined) return null;
  const next = { ...pending };
  delete next[k];
  pending = next;
  persist();
  notify();
  return prev;
}

export function pendingLauSnapshot(): PendingMap {
  return pending;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const subscribePendingLau = subscribe;

export function usePendingLau(account: Address | null): PendingLau | null {
  const value = useSyncExternalStore(subscribe, pendingLauSnapshot, pendingLauSnapshot);
  return account !== null ? (value[account.toLowerCase()] ?? null) : null;
}

/** test seam — restore a clean slate between rows */
export function resetPendingLauForTests(): void {
  pending = {};
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
  notify();
}

// ---- the receipt capture (pure — no store access) ----

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function asAddress(hex: string): Address | null {
  return /^0x[0-9a-fA-F]{40}$/.test(hex) && hex.toLowerCase() !== ZERO_ADDRESS ? (hex as Address) : null;
}

/**
 * Extract the LAU a `LAUFactory.New` SEND created. Preference order:
 *  1. the gate's own DRYRUN return data (New RETURNS the predicted address —
 *     the envelope carries it on the send path);
 *  2. the receipt's constructor-mint movement (from == 0x0);
 *  3. the receipt's Transfer(from=0x0) log emitted by someone OTHER than the
 *     factory (the fresh LAU's own mint).
 * Null = nothing captured (an honest miss — the operator still has the
 * explorer; the register step can take an explicit address).
 */
export function captureCreatedLau(outcome: GateOutcome, factory: Address): Address | null {
  if (outcome.status !== "sent") return null;
  // 1 — the envelope's sim result (the eth_call preview of New's return)
  const simResult = outcome.envelope.sim?.result ?? null;
  if (simResult !== null && simResult.length >= 66) {
    try {
      const word = BigInt(`0x${simResult.slice(2, 66)}`);
      const predicted = asAddress(`0x${word.toString(16).padStart(40, "0")}`);
      if (predicted !== null) return predicted;
    } catch {
      /* not decodable — fall through */
    }
  }
  // 2 — movements: the constructor mint (from == 0x0)
  for (const m of outcome.movements) {
    if (m.from.toLowerCase() === ZERO_ADDRESS) {
      const token = asAddress(m.token);
      if (token !== null && token.toLowerCase() !== factory.toLowerCase()) return token;
    }
  }
  // 3 — receipt logs: Transfer(from=0x0) whose emitter is not the factory
  const receipt = outcome.receipt;
  if (receipt !== null) {
    for (const log of receipt.logs) {
      if (log.topics.length !== 3 || log.topics[0]!.toLowerCase() !== TRANSFER_TOPIC) continue;
      const from = "0x" + log.topics[1]!.slice(26);
      if (from.toLowerCase() !== ZERO_ADDRESS) continue;
      if (log.address.toLowerCase() === factory.toLowerCase()) continue;
      const token = asAddress(log.address);
      if (token !== null) return token;
    }
  }
  return null;
}

/** decode New's DRYRUN return (the predicted LAU) — `null` when not decodable */
export function decodeNewPreview(simResult: `0x${string}` | null): Address | null {
  if (simResult === null || simResult.length < 66) return null;
  try {
    const word = BigInt(`0x${simResult.slice(2, 66)}`);
    return asAddress(`0x${word.toString(16).padStart(40, "0")}`);
  } catch {
    return null;
  }
}
