import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { toReceiptLike, waitForReceiptResilient } from "@/chain/receipt";

/**
 * The session-84 resilient receipt wait: the 12s timeout that made a mined
 * Beat look unconfirmed. These rows pin the fallback policy (read-only
 * public RPCs; the selected RPC stays the send path), the pending vs
 * mined-index-lag distinction, and the timeout message the agent/operator
 * sees.
 */

const TX = "0x787cdc2867d74f0a0cd66b01dbc1385c92ef1ba3652120d8aa540957031cc139" as `0x${string}`;
const TO = "0x1111111111111111111111111111111111111111";
const FROM = "0x2222222222222222222222222222222222222222";

function receipt(over: Partial<{ status: "success" | "reverted"; blockNumber: bigint; gasUsed: bigint }> = {}) {
  return {
    status: over.status ?? "success",
    blockNumber: over.blockNumber ?? 28_105_481n,
    gasUsed: over.gasUsed ?? 1_916_004n,
    logs: [],
    contractAddress: null,
    from: FROM,
    to: TO,
  };
}

function fake(over: {
  receipt?: () => Promise<unknown>;
  tx?: () => Promise<unknown>;
}): PublicClient {
  return {
    getTransactionReceipt: over.receipt ?? (async () => receipt()),
    getTransaction: over.tx ?? (async () => ({ blockNumber: 28_105_481n, from: FROM, to: TO })),
  } as unknown as PublicClient;
}

const notFound = async (): Promise<never> => {
  throw new Error("TransactionReceiptNotFoundError");
};

describe("toReceiptLike", () => {
  it("maps the viem receipt shape and carries the source honesty", () => {
    const r = toReceiptLike(
      {
        status: "success",
        gasUsed: 1n,
        blockNumber: 2n,
        logs: [{ address: TO, topics: ["0xaa"], data: "0x" }],
        contractAddress: null,
      } as never,
      "pulsechain-rpc.publicnode.com"
    );
    expect(r.status).toBe("success");
    expect(r.gasUsed).toBe(1n);
    expect(r.blockNumber).toBe(2n);
    expect(r.contractAddress).toBeNull();
    expect(r.source).toBe("pulsechain-rpc.publicnode.com");
  });
});

describe("waitForReceiptResilient", () => {
  it("returns a primary receipt immediately (source 'selected RPC')", async () => {
    const read = await waitForReceiptResilient({
      client: fake({}),
      txHash: TX,
      timeoutMs: 100,
      pollMs: 1,
    });
    expect(read.source).toBe("selected RPC");
    expect(read.receipt.status).toBe("success");
    expect(read.receipt.gasUsed).toBe(1_916_004n);
  });

  it("falls back READ-ONLY to a public RPC when the selected RPC lags, and journals the source", async () => {
    const onFallback = vi.fn();
    const makeFallbackClient = vi.fn(() => fake({}));
    const read = await waitForReceiptResilient({
      client: fake({ receipt: notFound, tx: async () => ({ blockNumber: 28_105_481n, from: FROM, to: TO }) }),
      txHash: TX,
      timeoutMs: 30,
      pollMs: 1,
      fallbackUrls: ["https://pulsechain-rpc.publicnode.com"],
      makeFallbackClient,
      onFallback,
    });
    expect(read.source).toBe("pulsechain-rpc.publicnode.com");
    expect(read.receipt.source).toBe("pulsechain-rpc.publicnode.com");
    expect(onFallback).toHaveBeenCalledWith("pulsechain-rpc.publicnode.com");
    expect(makeFallbackClient).toHaveBeenCalledTimes(1);
  });

  it("a tx seen with a block number but no receipt is named MINED (the index lags) — not a failure", async () => {
    await expect(
      waitForReceiptResilient({
        client: fake({ receipt: notFound, tx: async () => ({ blockNumber: 28_105_481n }) }),
        txHash: TX,
        timeoutMs: 20,
        pollMs: 1,
      })
    ).rejects.toThrow(/IS MINED at block 28105481/);
  });

  it("a tx seen pending with no receipt is named observed/pending", async () => {
    await expect(
      waitForReceiptResilient({
        client: fake({ receipt: notFound, tx: async () => ({ blockNumber: null }) }),
        txHash: TX,
        timeoutMs: 20,
        pollMs: 1,
      })
    ).rejects.toThrow(/observed, but no receipt/);
  });

  it("a never-seen tx names the selected RPC + fallbacks and points at tx_status", async () => {
    await expect(
      waitForReceiptResilient({
        client: fake({ receipt: notFound, tx: notFound }),
        txHash: TX,
        timeoutMs: 20,
        pollMs: 1,
      })
    ).rejects.toThrow(/tx_status/);
  });

  it("a dead RPC with NO fallbacks bails after two transport errors (no 3-minute hang)", async () => {
    const receipt = vi.fn(async () => {
      throw new Error("HTTP request failed");
    });
    await expect(
      waitForReceiptResilient({
        client: fake({ receipt, tx: async () => { throw new Error("HTTP request failed"); } }),
        txHash: TX,
        timeoutMs: 10_000,
        pollMs: 1,
      })
    ).rejects.toThrow(/unreachable/);
    expect(receipt).toHaveBeenCalledTimes(2);
  });

  it("loopback forks pass NO fallbacks — a public RPC must never answer for the fork", async () => {
    const makeFallbackClient = vi.fn(() => fake({}));
    await expect(
      waitForReceiptResilient({
        client: fake({ receipt: notFound, tx: notFound }),
        txHash: TX,
        timeoutMs: 20,
        pollMs: 1,
        fallbackUrls: [],
        makeFallbackClient,
      })
    ).rejects.toThrow(/not observed/);
    expect(makeFallbackClient).not.toHaveBeenCalled();
  });
});
