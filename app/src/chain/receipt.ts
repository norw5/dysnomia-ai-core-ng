import type { PublicClient, TransactionReceipt } from "viem";
import { makeClient } from "@/chain/client";
import { normalizeRpcUrl, rpcHost } from "@/chain/rpc";
import type { ReceiptLike } from "@/chain/txGate";

/**
 * Resilient receipt confirmation (session-84, the owner's Beat report).
 *
 * THE BUG WE PAID FOR: the app's gate waited only 12s for a receipt — less
 * than one PulseChain block (~10s) plus index lag. A Beat mined at
 * 28,105,481 (tx 0x787cdc…cc139) was reported as `status: sent` +
 * `receiptError: Timed out...`; the agent then had no way to confirm it
 * (and `read_contract` on a tx hash is the wrong probe), so it stopped
 * before the DSS/chat. The transaction had succeeded all along.
 *
 * THE POLICY: a broadcast tx is NOT a failed tx. Wait 3 minutes, polling
 * every 3s; after 20s (and once at the deadline) check the known PUBLIC
 * fallback RPCs READ-ONLY for the receipt. The selected RPC stays the only
 * send path — never auto-failover a send (double-spend risk). On a loopback
 * anvil fork the caller passes NO fallbacks: a public RPC would answer for
 * the LIVE chain, never the fork.
 *
 * The timeout error distinguishes "tx not observed" from "tx IS mined but
 * the receipt index is lagging" so the agent/operator knows the broadcast
 * likely succeeded. `tx_status` (agent/txTools.ts) reuses the same read
 * policy for a hash checked later.
 */

export interface ReceiptRead {
  receipt: ReceiptLike;
  /** "selected RPC" or the fallback host that answered */
  source: string;
}

export interface ReceiptWaitOptions {
  client: PublicClient;
  txHash: `0x${string}`;
  /** total wait (the app gate: 180_000; the headless runner: 180_000) */
  timeoutMs: number;
  /** poll cadence, default 3_000 */
  pollMs?: number;
  /**
   * Read-only fallback endpoints (the known mainnet list, filtered by the
   * caller to exclude the selected RPC). EMPTY on a loopback fork.
   */
  fallbackUrls?: readonly string[];
  /** journal/telemetry hook when a fallback answers */
  onFallback?: (source: string) => void;
  /** test seam */
  makeFallbackClient?: (url: string) => PublicClient;
  /** test seam */
  sleep?: (ms: number) => Promise<void>;
}

/** map a viem receipt into the gate's transport-agnostic shape */
export function toReceiptLike(r: TransactionReceipt, source?: string): ReceiptLike {
  return {
    status: r.status === "success" ? "success" : "reverted",
    gasUsed: r.gasUsed,
    logs: r.logs.map((l) => ({ address: l.address, topics: [...l.topics], data: l.data })),
    blockNumber: r.blockNumber,
    contractAddress: r.contractAddress ?? null,
    ...(source !== undefined ? { source } : {}),
  };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function waitForReceiptResilient(opts: ReceiptWaitOptions): Promise<ReceiptRead> {
  const timeoutMs = Math.max(1_000, Math.trunc(opts.timeoutMs));
  const pollMs = Math.max(250, Math.trunc(opts.pollMs ?? 3_000));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const factory = opts.makeFallbackClient ?? makeClient;

  // dedupe the fallback list; the caller has already removed the selected RPC
  const seen = new Set<string>();
  const fallbacks: Array<{ url: string; client: PublicClient }> = [];
  for (const url of opts.fallbackUrls ?? []) {
    const key = normalizeRpcUrl(url).toLowerCase();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    fallbacks.push({ url, client: factory(url) });
  }

  let lastError = "";
  let txSeen = false;
  let txBlock: bigint | null = null;
  let transportErrors = 0;
  const MAX_TRANSPORT_ERRORS = 2;

  const fallbackSweep = async (): Promise<ReceiptRead | null> => {
    for (const fb of fallbacks) {
      try {
        const r = await fb.client.getTransactionReceipt({ hash: opts.txHash });
        if (r) {
          const source = rpcHost(fb.url);
          opts.onFallback?.(source);
          return { receipt: toReceiptLike(r, source), source };
        }
      } catch (e) {
        lastError = errText(e);
      }
    }
    return null;
  };

  const started = Date.now();
  let nextFallbackAt = started + Math.min(20_000, Math.max(pollMs * 3, 5_000));

  while (Date.now() - started < timeoutMs) {
    try {
      const r = await opts.client.getTransactionReceipt({ hash: opts.txHash });
      if (r) return { receipt: toReceiptLike(r, "selected RPC"), source: "selected RPC" };
    } catch (e) {
      const msg = errText(e);
      lastError = msg;
      // "not found" is the normal pending state — keep waiting. Anything
      // else is a transport/RPC failure; when there are NO fallbacks (a
      // loopback fork or a dead endpoint) there is nothing to wait for —
      // bail early so the gate reports the broadcast honestly instead of
      // hanging the UI for three minutes.
      if (/not found|TransactionReceiptNotFoundError/i.test(msg)) transportErrors = 0;
      else transportErrors += 1;
      if (fallbacks.length === 0 && transportErrors >= MAX_TRANSPORT_ERRORS) {
        throw new Error(
          `receipt unobservable — the selected RPC is unreachable (${msg}). The transaction may have been broadcast; check the explorer or call tx_status("${opts.txHash}") before retrying.`
        );
      }
    }
    try {
      const t = await opts.client.getTransaction({ hash: opts.txHash });
      if (t) {
        txSeen = true;
        if (t.blockNumber !== null) txBlock = t.blockNumber;
      }
    } catch {
      /* not propagated yet — the receipt poll is the authority */
    }
    if (fallbacks.length > 0 && Date.now() >= nextFallbackAt) {
      nextFallbackAt = Date.now() + 15_000;
      const got = await fallbackSweep();
      if (got !== null) return got;
    }
    await sleep(pollMs);
  }

  // one final sweep — the selected RPC may have lagged the whole window
  const got = await fallbackSweep();
  if (got !== null) return got;

  const state =
    txBlock !== null
      ? `the tx IS MINED at block ${txBlock.toString()}, but the receipt index never caught up`
      : txSeen
        ? "the tx was observed, but no receipt was returned"
        : "the tx was not observed by the selected RPC or the fallbacks";
  throw new Error(
    `receipt not observed within ${timeoutMs}ms — ${state}. The transaction may still have succeeded: check the explorer or call tx_status("${opts.txHash}") before retrying.${lastError.length > 0 ? ` Last RPC error: ${lastError}` : ""}`
  );
}
