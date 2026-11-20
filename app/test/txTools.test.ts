import { beforeEach, describe, expect, it, vi } from "vitest";
import { toolByName, toolSpecs, type AgentToolContext } from "@/agent/tools";

/**
 * tx_status (session-84): the read-only confirmation probe for a BROADCAST
 * tx. It is the missing step after a send with status "sent" + receiptError
 * — the Beat run's dead end. Covers confirmed/reverted/pending/
 * mined-receipt-missing/unknown, the public fallback, the hash fence, and
 * the always-advertised catalog rule.
 */

const TX = "0x787cdc2867d74f0a0cd66b01dbc1385c92ef1ba3652120d8aa540957031cc139" as `0x${string}`;
const PRIMARY = "https://rpc.pulsechain.com";
const PUBLICNODE = "https://pulsechain-rpc.publicnode.com";
const TO = "0x1111111111111111111111111111111111111111";
const FROM = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const fakes = new Map<string, ReturnType<typeof fakeClient>>();

vi.mock("@/chain/client", () => ({
  makeClient: (url: string) => fakes.get(url) ?? fakeClient({ receipt: notFound, tx: notFound }),
}));

function fakeClient(over: {
  receipt?: () => Promise<unknown>;
  tx?: () => Promise<unknown>;
}) {
  return {
    getTransactionReceipt: over.receipt ?? (async () => null),
    getTransaction: over.tx ?? (async () => null),
  };
}

function receipt(status: "success" | "reverted" = "success") {
  const word = (a: string) => "0x" + "0".repeat(24) + a.slice(2).toLowerCase();
  return {
    status,
    blockNumber: 28_105_481n,
    gasUsed: 1_916_004n,
    contractAddress: null,
    from: FROM,
    to: TO,
    logs: [
      {
        address: TOKEN,
        topics: [TRANSFER, word(FROM), word(TO)],
        data: ("0x" + 123n.toString(16).padStart(64, "0")) as `0x${string}`,
      },
    ],
  };
}

const notFound = async (): Promise<never> => {
  throw new Error("TransactionReceiptNotFoundError");
};

function ctx(): AgentToolContext {
  return { rpcUrl: PRIMARY } as unknown as AgentToolContext;
}

beforeEach(() => {
  fakes.clear();
  fakes.set(PRIMARY, fakeClient({ receipt: notFound, tx: notFound }));
  fakes.set(PUBLICNODE, fakeClient({ receipt: notFound, tx: notFound }));
});

describe("catalog", () => {
  it("tx_status is ALWAYS advertised (a read tool, no opt-in)", () => {
    expect(toolSpecs(false).map((t) => t.function.name)).toContain("tx_status");
  });
});

describe("tx_status", () => {
  it("confirmed: receipt success + block/gas/movements/source/explorer", async () => {
    fakes.set(PRIMARY, fakeClient({ receipt: async () => receipt("success") }));
    const out = await toolByName("tx_status")!.execute({ hash: TX }, ctx());
    expect(out.status).toBe("confirmed");
    expect(out.blockNumber).toBe("28105481");
    expect(out.gasUsed).toBe("1916004");
    expect(out.source).toBe("selected RPC");
    expect(out.explorer).toBe(`https://ipfs.scan.pulsechain.com/tx/${TX}`);
    expect((out.movements as Array<Record<string, string>>)[0]?.amount).toBe("123");
  });

  it("reverted: receipt status 0 is named, never 'confirmed'", async () => {
    fakes.set(PRIMARY, fakeClient({ receipt: async () => receipt("reverted") }));
    const out = await toolByName("tx_status")!.execute({ hash: TX }, ctx());
    expect(out.status).toBe("reverted");
  });

  it("falls back READ-ONLY to a public RPC when the selected RPC is lagging", async () => {
    fakes.set(PUBLICNODE, fakeClient({ receipt: async () => receipt("success") }));
    const out = await toolByName("tx_status")!.execute({ hash: TX }, ctx());
    expect(out.status).toBe("confirmed");
    expect(out.source).toBe("pulsechain-rpc.publicnode.com");
  });

  it("pending: tx visible in the mempool, no block", async () => {
    fakes.set(PRIMARY, fakeClient({ receipt: notFound, tx: async () => ({ blockNumber: null, from: FROM, to: TO }) }));
    const out = await toolByName("tx_status")!.execute({ hash: TX }, ctx());
    expect(out.status).toBe("pending");
    expect(String(out.note)).toContain("do NOT retry");
  });

  it("mined-receipt-missing: the tx IS mined; the receipt index lags — do not retry", async () => {
    fakes.set(PRIMARY, fakeClient({ receipt: notFound, tx: async () => ({ blockNumber: 28_105_481n, from: FROM, to: TO }) }));
    const out = await toolByName("tx_status")!.execute({ hash: TX }, ctx());
    expect(out.status).toBe("mined-receipt-missing");
    expect(out.blockNumber).toBe("28105481");
    expect(String(out.note)).toContain("Do NOT retry");
  });

  it("unknown: every RPC fails — the errors survive and the explorer is still offered", async () => {
    const out = await toolByName("tx_status")!.execute({ hash: TX }, ctx());
    expect(out.status).toBe("unknown");
    expect(String((out.errors as string[])[0])).toContain("selected RPC");
    expect(String(out.explorer)).toContain(TX);
  });

  it("fences a malformed hash before any RPC call", async () => {
    const out = await toolByName("tx_status")!.execute({ hash: "0x123" }, ctx());
    expect(String(out.error)).toContain("32-byte transaction hash");
  });
});
