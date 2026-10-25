import { afterEach, describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  captureCreatedLau,
  clearPendingLau,
  decodeNewPreview,
  pendingLau,
  resetPendingLauForTests,
  setPendingLau,
} from "@/state/pendingLau";
import type { GateOutcome, GateEnvelope, GateRequest } from "@/chain/txGate";

/**
 * The receipt-carried LAU forward (session-64): the per-account store
 * lifecycle + the pure capture helpers (envelope preview → movements →
 * receipt logs), pinned against the shapes the gate actually returns.
 */

const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as Address;
const ACCT2 = "0x2222222222222222222222222222222222222222" as Address;
const LAU = "0x1111111111111111111111111111111111111111" as Address;
const FACTORY = "0xba6ccd38992839aee20d5bf9125b1d94190b091c" as Address; // config-pinned
const ZERO = "0x0000000000000000000000000000000000000000";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

afterEach(() => {
  resetPendingLauForTests();
});

describe("the pending-LAU store lifecycle", () => {
  it("round-trips per account and survives a reload-shaped re-read", () => {
    expect(pendingLau(ACCT)).toBeNull();
    setPendingLau(ACCT, LAU, "0xabc");
    const p = pendingLau(ACCT)!;
    expect(p.lau.toLowerCase()).toBe(LAU.toLowerCase());
    expect(p.txHash).toBe("0xabc");
    expect(pendingLau(ACCT2)).toBeNull(); // keyed per account
  });

  it("clears on discovery and reports what it cleared", () => {
    setPendingLau(ACCT, LAU);
    expect(clearPendingLau(ACCT)?.lau.toLowerCase()).toBe(LAU.toLowerCase());
    expect(pendingLau(ACCT)).toBeNull();
    expect(clearPendingLau(ACCT)).toBeNull(); // a second clear is a no-op
  });

  it("null account reads null", () => {
    setPendingLau(ACCT, LAU);
    expect(pendingLau(null)).toBeNull();
  });
});

function envelope(simResult: `0x${string}` | null): GateEnvelope {
  return {
    request: {} as GateRequest,
    cls: { risk: "standard", tier: "perimeter", gate: null, metered: false, reverts: [], contract: "TEST", functionSig: null },
    policy: { allowed: true, reasons: [], risk: "standard", tier: "perimeter", requiresExtraAck: false },
    sim: { ok: simResult !== null, result: simResult, gas: 11_000_000n, error: null },
  };
}

function sentOutcome(patch: Partial<Extract<GateOutcome, { status: "sent" }>> = {}): Extract<GateOutcome, { status: "sent" }> {
  return {
    status: "sent",
    envelope: envelope(null),
    txHash: "0xtx",
    receipt: { status: "success", gasUsed: 11_000_000n, logs: [], blockNumber: 27_674_100n, contractAddress: null },
    receiptError: null,
    movements: [],
    capBreaches: [],
    ...patch,
  };
}

describe("captureCreatedLau (preference order)", () => {
  it("1 — decodes the envelope's New return (the predicted address)", () => {
    const word = "0x" + LAU.slice(2).toLowerCase().padStart(64, "0");
    const out = sentOutcome({ envelope: envelope(word as `0x${string}`) });
    expect(captureCreatedLau(out, FACTORY)?.toLowerCase()).toBe(LAU.toLowerCase());
  });

  it("2 — falls back to the constructor-mint movement (from == 0x0)", () => {
    const out = sentOutcome({ movements: [{ token: LAU, from: ZERO, to: ACCT, amount: 1n }] });
    expect(captureCreatedLau(out, FACTORY)?.toLowerCase()).toBe(LAU.toLowerCase());
  });

  it("3 — falls back to the receipt's Transfer(from=0x0) log from a non-factory emitter", () => {
    const out = sentOutcome({
      receipt: {
        status: "success",
        gasUsed: 11_000_000n,
        blockNumber: 27_674_100n,
        logs: [{ address: LAU, topics: [TRANSFER_TOPIC, ("0x" + "0".repeat(64)) as `0x${string}`, ("0x" + ACCT.slice(2).toLowerCase().padStart(64, "0")) as `0x${string}`], data: ("0x" + "1".padStart(64, "0")) as `0x${string}` }],
        contractAddress: null,
      },
    });
    expect(captureCreatedLau(out, FACTORY)?.toLowerCase()).toBe(LAU.toLowerCase());
  });

  it("ignores non-mint movements and factory-emitted logs; misses honestly", () => {
    const ordinary = sentOutcome({ movements: [{ token: LAU, from: ACCT, to: ACCT2, amount: 5n }] });
    expect(captureCreatedLau(ordinary, FACTORY)).toBeNull();
    const factoryLog = sentOutcome({
      receipt: {
        status: "success",
        gasUsed: 1n,
        blockNumber: null,
        logs: [{ address: FACTORY, topics: [TRANSFER_TOPIC, ("0x" + "0".repeat(64)) as `0x${string}`, "0x" + ACCT.slice(2).padStart(64, "0")], data: "0x" as `0x${string}` }],
        contractAddress: null,
      },
    });
    expect(captureCreatedLau(factoryLog, FACTORY)).toBeNull();
  });

  it("non-sent outcomes capture nothing", () => {
    const denied: GateOutcome = { status: "denied", envelope: envelope(null), reasons: ["cap"] };
    expect(captureCreatedLau(denied, FACTORY)).toBeNull();
  });
});

describe("decodeNewPreview", () => {
  it("decodes the predicted address from New's DRYRUN return", () => {
    const word = "0x" + LAU.slice(2).toLowerCase().padStart(64, "0");
    expect(decodeNewPreview(word as `0x${string}`)?.toLowerCase()).toBe(LAU.toLowerCase());
  });

  it("null on short/zero/undecodable results", () => {
    expect(decodeNewPreview(null)).toBeNull();
    expect(decodeNewPreview("0x")).toBeNull();
    expect(decodeNewPreview(("0x" + "0".repeat(128)) as `0x${string}`)).toBeNull(); // zero address
  });
});
