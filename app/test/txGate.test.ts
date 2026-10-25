import { describe, expect, it } from "vitest";
import { encodeFunctionData, keccak256, stringToBytes, toHex } from "viem";
import choaAbi from "@abi/CHOA.json";
import { FACTS } from "@/chain/facts";
import { JournalBus } from "@/chain/journal";
import {
  DEFAULT_POLICY,
  freshCounters,
  policyCheck,
  recordSpend,
  type PolicyConfig,
} from "@/chain/policy";
import {
  decodeCustomError,
  dryRun,
  extractMovements,
  sendTransaction,
  type GateClient,
  type GateDeps,
  type GateSigner,
  type ReceiptLike,
} from "@/chain/txGate";
import type { Abi } from "viem";

const CHOA = FACTS.byAddress["0x0f5a352fd4ca4850c2099c15b3600ff085b66197"]!;
const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as `0x${string}`;

function choaChatData(lau: string, msg: string): `0x${string}` {
  return encodeFunctionData({ abi: choaAbi as Abi, functionName: "Chat", args: [lau as `0x${string}`, msg] });
}

function fakeClient(opts: { callError?: { message: string; data?: `0x${string}` }; gas?: bigint } = {}): {
  client: GateClient;
  callCount: () => number;
} {
  let count = 0;
  const client: GateClient = {
    call: async () => {
      count++;
      if (opts.callError) {
        throw Object.assign(new Error(opts.callError.message), { data: opts.callError.data });
      }
      return "0x000000000000000000000000000000000000000000000000000000000000002a";
    },
    estimateGas: async () => opts.gas ?? 700_000n,
    waitForReceipt: async () =>
      ({
        status: "success",
        gasUsed: 640_000n,
        blockNumber: 27_666_001n,
        logs: [
          {
            address: "0x0f5a352fd4ca4850c2099c15b3600ff085b66197",
            topics: [
              "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
              "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
              "0x0000000000000000000000001111111111111111111111111111111111111111",
            ],
            data: toHex(1_000_000n, { size: 32 }),
          },
        ],
        contractAddress: null,
      }) satisfies ReceiptLike,
  };
  return { client, callCount: () => count };
}

function fakeSigner(mode: "A" | "B" | "C"): { signer: GateSigner; sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    signer: {
      mode,
      account: ACCT,
      sendTransaction: async (args) => {
        sent.push(args);
        return "0xabc0000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;
      },
    },
    sent,
  };
}

function deps(overrides: Partial<GateDeps> = {}): GateDeps {
  return {
    client: fakeClient().client,
    signer: fakeSigner("B").signer,
    signerMode: "B",
    facts: FACTS,
    policy: { ...DEFAULT_POLICY, ...overrides.policy } as PolicyConfig,
    journal: new JournalBus(),
    counters: overrides.counters ?? freshCounters(new Date()),
    ...overrides,
  };
}

describe("risk classification (fn_tables-derived)", () => {
  it("CHOA.Chat(address,string) on the perimeter = standard, public gate, metered", async () => {
    const env = await dryRun(deps(), {
      to: CHOA.contract.address,
      data: choaChatData(ACCT, "hi"),
      account: ACCT,
    });
    expect(env.cls.risk).toEqual("standard");
    expect(env.cls.gate).toEqual("public");
    expect(env.cls.metered).toEqual(true);
    expect(env.cls.functionSig).toEqual("Chat(address,string)");
  });

  it("a view function classifies as read and policy routes it away from sends", async () => {
    const env = await dryRun(deps(), {
      to: CHOA.contract.address,
      data: "0x18160ddd", // totalSupply()
      account: ACCT,
    });
    expect(env.cls.risk).toEqual("read");
    expect(env.policy.allowed).toEqual(false);
  });

  it("an owners-gated mutator classifies as privileged with extra-ack", async () => {
    // SHIO.Generate is owners-gated per fn_tables; ErisSHIO is the live instance
    const eris = FACTS.byAddress["0xe843765114992e18061498aed708537ce9d924fa"]!;
    const fn = eris.contract.functions["Generate(uint64,uint64,uint64)"]!;
    expect(fn.gate).toEqual("owners");
    const env = await dryRun(deps(), {
      to: eris.contract.address,
      data: fn.selector as `0x${string}`,
      account: ACCT,
    });
    expect(env.cls.risk).toEqual("privileged");
    expect(env.policy.requiresExtraAck).toEqual(true);
  });

  it("off-perimeter destination = unknown-contract; disabled in policy = denied", async () => {
    const d = deps();
    const env = await dryRun(d, { to: "0x1111111111111111111111111111111111111111", data: "0x12345678", account: ACCT });
    expect(env.cls.risk).toEqual("unknown-contract");
    expect(env.policy.requiresExtraAck).toEqual(true);
    expect(env.policy.allowed).toEqual(true); // manual default allows with ack
    const strict = deps({ policy: { ...DEFAULT_POLICY, allowUnknownDestinations: false } });
    const denied = await dryRun(strict, { to: "0x1111111111111111111111111111111111111111", data: "0x12345678", account: ACCT });
    expect(denied.policy.allowed).toEqual(false);
  });
});

describe("policy caps + ledger", () => {
  it("session/day/value caps deny and day rollover resets", () => {
    const p = { ...DEFAULT_POLICY, maxTxPerSession: 1, maxTxPerDay: 10 };
    const c = freshCounters(new Date("2026-09-30T10:00:00Z"));
    const first = policyCheck({ to: CHOA.contract.address, data: choaChatData(ACCT, "x"), value: 0n, facts: FACTS }, p, c);
    expect(first.allowed).toEqual(true);
    const afterOne = { ...c, sessionTx: 1, dayTx: 1 };
    const second = policyCheck({ to: CHOA.contract.address, data: choaChatData(ACCT, "x"), value: 0n, facts: FACTS }, p, afterOne);
    expect(second.allowed).toEqual(false);
    expect(second.reasons[0]).toContain("session tx cap");
    const nextDay = freshCounters(new Date("2026-10-01T10:00:00Z"), afterOne);
    expect(nextDay.dayTx).toEqual(0);
    expect(nextDay.sessionTx).toEqual(0); // session counters are per page life; rollover resets all
  });

  it("per-token movement caps breach on out-transfer accounting", () => {
    const token = "0x0f5a352fd4ca4850c2099c15b3600ff085b66197";
    const p = { ...DEFAULT_POLICY, perTokenSessionCapWei: { [token]: 5n } };
    const c = freshCounters(new Date());
    const { counters, breaches } = recordSpend(
      c,
      0n,
      [{ token, from: ACCT, to: "0x1111111111111111111111111111111111111111", amount: 6n }],
      ACCT,
      p
    );
    expect(counters.tokenOutWei[token]).toEqual(6n);
    expect(breaches).toHaveLength(1);
    // inbound movements don't count against out-caps
    const inbound = recordSpend(
      c,
      0n,
      [{ token, from: "0x1111111111111111111111111111111111111111", to: ACCT, amount: 100n }],
      ACCT,
      p
    );
    expect(inbound.breaches).toHaveLength(0);
  });
});

describe("custom error decode + movements", () => {
  it("decodes MarketRateNotFound(address) from the canonical CHOA ABI", () => {
    const selector = keccak256(stringToBytes("MarketRateNotFound(address)")).slice(0, 10);
    const data = (selector +
      "0000000000000000000000001111111111111111111111111111111111111111") as `0x${string}`;
    expect(decodeCustomError(choaAbi as Abi, data)).toContain("MarketRateNotFound");
    expect(decodeCustomError(choaAbi as Abi, "0x12345678")).toEqual(null);
    expect(decodeCustomError(undefined, data)).toEqual(null);
  });

  it("session-73: revertDataOf walks viem's cause chain AND parses the details text — the revert data lived at err.cause.cause.data all along", async () => {
    const { revertDataOf } = await import("@/chain/txGate");
    const sel = keccak256(stringToBytes("QingAlreadyExists(address,address)")).slice(0, 10);
    const data = (sel +
      "000000000000000000000000f9a5c1786f0a9522e51f78aee2ed0ff0fe80a699" +
      "000000000000000000000000651fcbae1fba264ce7aef0b9646c73b14a98bf3e") as `0x${string}`;
    // the viem shape: CallExecutionError → cause → RequestRpcError(.data)
    const inner = Object.assign(new Error("RequestRpcError"), { data });
    const mid = Object.assign(new Error("CallApplicationExecutionError"), { cause: inner });
    const outer = Object.assign(new Error("CallExecutionError: execution reverted"), { cause: mid });
    expect(revertDataOf(outer)).toEqual(data);
    // the details-text fallback (no data anywhere)
    const textual = new Error("x");
    Object.assign(textual, { details: `execution reverted: custom error ${sel}: ${data.slice(10)}` });
    expect(revertDataOf(textual)).toEqual(data);
    expect(revertDataOf(new Error("no revert data"))).toEqual(null);
  });

  it("session-73: a viem-shaped client.call revert DECODES through dryRun (the full-auto video's 'no decoded reason' bug is dead)", async () => {
    const mapAbi = (await import("@abi/MAP.json")).default as Abi;
    const sel = keccak256(stringToBytes("QingAlreadyExists(address,address)")).slice(0, 10);
    const data = (sel +
      "000000000000000000000000f9a5c1786f0a9522e51f78aee2ed0ff0fe80a699" +
      "000000000000000000000000651fcbae1fba264ce7aef0b9646c73b14a98bf3e") as `0x${string}`;
    const inner = Object.assign(new Error("RequestRpcError"), { data });
    const viemShaped = Object.assign(new Error("CallExecutionError"), {
      cause: Object.assign(new Error("mid"), { cause: inner }),
    });
    const throwing: GateClient = {
      call: async () => {
        throw viemShaped;
      },
      estimateGas: async () => 3_000_000n,
      waitForReceipt: async () => {
        throw new Error("unused");
      },
    };
    const request = {
      to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      data: encodeFunctionData({ abi: mapAbi, functionName: "New", args: ["0xf9a5c1786f0a9522e51f78aee2ed0ff0fe80a699" as `0x${string}`] }),
      account: ACCT,
      abi: mapAbi,
      meta: { source: "agent" as const, label: "test" },
    };
    const env = await dryRun(deps({ client: throwing }), request);
    expect(env.sim?.ok).toBe(false);
    expect(env.sim?.error?.decoded).toContain("QingAlreadyExists");
    // viem checksums decoded addresses — match case-insensitively
    expect((env.sim?.error?.decoded ?? "").toLowerCase()).toContain("0x651fcbae1fba264ce7aef0b9646c73b14a98bf3e");
  });

  it("extractMovements parses ERC-20 Transfer logs", () => {
    const receipt: ReceiptLike = {
      status: "success",
      gasUsed: 1n,
      blockNumber: null,
      logs: [
        {
          address: "0x24f0154c1dce548adf15da2098fdd8b8a3b8151d",
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            "0x000000000000000000000000" + ACCT.slice(2).toLowerCase(),
            "0x0000000000000000000000002222222222222222222222222222222222222222",
          ],
          data: toHex(42n * 10n ** 18n, { size: 32 }),
        },
      ],
      contractAddress: null,
    };
    const mv = extractMovements(receipt);
    expect(mv).toHaveLength(1);
    expect(mv[0]!.from.toLowerCase()).toEqual(ACCT.toLowerCase());
    expect(mv[0]!.amount).toEqual(42n * 10n ** 18n);
  });
});

describe("the send pipeline", () => {
  const req = () => ({
    to: CHOA.contract.address,
    data: choaChatData(ACCT, "gate test"),
    account: ACCT,
    abi: choaAbi as Abi,
    meta: { source: "manual" as const },
  });

  it("denied policy never reaches the signer", async () => {
    const { signer, sent } = fakeSigner("B");
    const d = deps({ policy: { ...DEFAULT_POLICY, maxTxPerSession: 0 }, signer, signerMode: "B" });
    const out = await sendTransaction(d, req());
    expect(out.status).toEqual("denied");
    expect(sent).toHaveLength(0);
  });

  it("mode B send: sim ok + approval granted → sent + receipt + counters", async () => {
    const { signer, sent } = fakeSigner("B");
    let asked = 0;
    const d = deps({
      signer,
      signerMode: "B",
      approval: async () => {
        asked++;
        return true;
      },
    });
    const out = await sendTransaction(d, req());
    expect(out.status).toEqual("sent");
    expect(asked).toEqual(1);
    expect(sent).toHaveLength(1);
    if (out.status !== "sent") throw new Error("unreachable");
    expect(out.receipt?.status).toEqual("success");
    expect(out.movements).toHaveLength(1);
    expect(d.counters.sessionTx).toEqual(0); // ledger write-back happens via onCounters
  });

  it("approval rejection aborts before the signer", async () => {
    const { signer, sent } = fakeSigner("A");
    const d = deps({ signer, signerMode: "A", approval: async () => false });
    const out = await sendTransaction(d, req());
    expect(out.status).toEqual("aborted");
    expect(sent).toHaveLength(0);
  });

  it("failed sim blocks the send unless explicitly overridden", async () => {
    const { signer, sent } = fakeSigner("B");
    const errClient = fakeClient({ callError: { message: "execution reverted" } });
    const d = deps({ client: errClient.client, signer, signerMode: "B" });
    const blocked = await sendTransaction(d, req());
    expect(blocked.status).toEqual("sim-failed");
    expect(sent).toHaveLength(0);
    const overridden = await sendTransaction(d, req(), { allowSimFailure: true, approvalAlreadyGranted: true });
    expect(overridden.status).toEqual("sent");
  });

  it("mode C auto-sends standard perimeter calls without asking", async () => {
    const { signer, sent } = fakeSigner("C");
    let asked = 0;
    const d = deps({
      signer,
      signerMode: "C",
      approval: async () => {
        asked++;
        return false;
      },
    });
    const out = await sendTransaction(d, req());
    expect(out.status).toEqual("sent");
    expect(asked).toEqual(0);
    expect(sent).toHaveLength(1);
  });

  it("mode C still asks on privileged/unknown (bounded by policy)", async () => {
    const { signer } = fakeSigner("C");
    let asked = 0;
    const d = deps({
      signer,
      signerMode: "C",
      approval: async () => {
        asked++;
        return true;
      },
    });
    const eris = FACTS.byAddress["0xe843765114992e18061498aed708537ce9d924fa"]!;
    const generate = eris.contract.functions["Generate(uint64,uint64,uint64)"]!;
    const out = await sendTransaction(d, {
      to: eris.contract.address,
      data: generate.selector as `0x${string}`,
      account: ACCT,
    });
    expect(out.status).toEqual("sent");
    expect(asked).toEqual(1);
  });
});
