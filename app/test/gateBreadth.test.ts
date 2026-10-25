import { describe, expect, it } from "vitest";
import { encodeFunctionData, type Abi } from "viem";
import shioAbi from "@abi/SHIO.json";
import { FACTS } from "@/chain/facts";
import { JournalBus } from "@/chain/journal";
import { DEFAULT_POLICY, freshCounters, type PolicyConfig } from "@/chain/policy";
import { sendTransaction, type GateClient, type GateDeps, type GateSigner, type ReceiptLike } from "@/chain/txGate";
import { loadGateSettings, saveGateSettings, DEFAULT_GATE_SETTINGS } from "@/chain/gateSettings";

/**
 * Session-65 — the YOLO RELAXATION: the mode-C BREADTH toggle auto-acks
 * unknown-CONTRACT sends (destination-based) while unknown-METHOD and
 * privileged gates keep asking. Policy caps still bind; modes A/B always
 * show the card; the headless runner is untouched (its RECORDED policy
 * answers the card itself, the same gate code).
 */

const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as `0x${string}`;
// a NON-perimeter destination (an instance address — the class the toggle widens)
const INSTANCE = "0x0000000000000000000000000000000000000abc" as `0x${string}`;
const CHOA = FACTS.byAddress["0x0f5a352fd4ca4850c2099c15b3600ff085b66197"]!;

function fakeClient(): GateClient {
  return {
    call: async () => "0x" as `0x${string}`,
    estimateGas: async () => 300_000n,
    waitForReceipt: async () =>
      ({ status: "success", gasUsed: 290_000n, blockNumber: 27_674_001n, logs: [], contractAddress: null }) satisfies ReceiptLike,
  };
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
    client: fakeClient(),
    signer: fakeSigner("C").signer,
    signerMode: "C",
    facts: FACTS,
    policy: { ...DEFAULT_POLICY, ...overrides.policy } as PolicyConfig,
    journal: new JournalBus(),
    counters: freshCounters(new Date()),
    ...overrides,
  };
}

/** the send fixture: a Log write to a non-perimeter instance */
function instanceRequest(): Parameters<typeof sendTransaction>[1] {
  return {
    to: INSTANCE,
    data: encodeFunctionData({
      abi: shioAbi as Abi,
      functionName: "Log",
      args: [1n, 2n, "x"],
    }),
    account: ACCT,
  };
}

describe("mode-C breadth (session-65 yolo relaxation)", () => {
  it("unknown-CONTRACT in mode C WITHOUT breadth: the card still shows", async () => {
    let asked = 0;
    const d = deps({
      approval: async () => {
        asked += 1;
        return true;
      },
    });
    const out = await sendTransaction(d, instanceRequest());
    expect(out.status).toEqual("sent");
    expect(asked).toEqual(1);
  });

  it("unknown-CONTRACT in mode C WITH breadth: auto-acked, no card, journal names it", async () => {
    let asked = 0;
    const journal = new JournalBus();
    const lines: string[] = [];
    journal.subscribe((e) => lines.push(`${e.kind} ${e.line}`));
    const d = deps({
      modeCBreadth: true,
      journal,
      approval: async () => {
        asked += 1;
        return true;
      },
    });
    const out = await sendTransaction(d, instanceRequest());
    expect(out.status).toEqual("sent");
    expect(asked).toEqual(0); // destination-based auto-ack
    expect(lines.some((l) => l.includes("mode-C breadth") && l.includes("auto-acked"))).toBe(true);
  });

  it("unknown-METHOD still asks even with breadth on (method-based, never auto-acked)", async () => {
    let asked = 0;
    const d = deps({
      modeCBreadth: true,
      approval: async () => {
        asked += 1;
        return true;
      },
    });
    // a selector with no facts row on a PERIMETER contract → unknown-method
    const out = await sendTransaction(d, {
      to: CHOA.contract.address,
      data: "0xdeadbeef",
      account: ACCT,
    });
    expect(out.status).toEqual("sent");
    expect(asked).toEqual(1);
  });

  it("modes A/B always show the card — breadth is a mode-C-only widening", async () => {
    let asked = 0;
    const d = deps({
      signerMode: "A",
      modeCBreadth: true,
      approval: async () => {
        asked += 1;
        return true;
      },
    });
    d.signer = fakeSigner("A").signer;
    const out = await sendTransaction(d, instanceRequest());
    expect(out.status).toEqual("sent");
    expect(asked).toEqual(1);
  });

  it("a policy DENIAL still wins — breadth never bypasses caps or the unknown-destination kill switch", async () => {
    let asked = 0;
    const d = deps({
      modeCBreadth: true,
      policy: { ...DEFAULT_POLICY, allowUnknownDestinations: false } as PolicyConfig,
      approval: async () => {
        asked += 1;
        return true;
      },
    });
    const out = await sendTransaction(d, instanceRequest());
    expect(out.status).toEqual("denied");
    expect(asked).toEqual(0);
  });

  it("a privileged gate still asks with breadth on (actor-gated, likely to fail)", async () => {
    // ErisSHIO Generate — owners-gated per the fn_tables
    const eris = FACTS.byAddress["0xe843765114992e18061498aed708537ce9d924fa"]!;
    let asked = 0;
    const d = deps({
      modeCBreadth: true,
      approval: async () => {
        asked += 1;
        return false;
      },
    });
    const out = await sendTransaction(d, {
      to: eris.contract.address,
      data: encodeFunctionData({ abi: shioAbi as Abi, functionName: "Generate", args: [1n, 2n, 3n] }),
      account: ACCT,
    });
    expect(out.status).toEqual("aborted"); // the card showed and was rejected
    expect(asked).toEqual(1);
  });
});

describe("deployment sends (session-66 — the DSS desk gate surface)", () => {
  const CREATION = ("0x" + "6080".repeat(200)) as `0x${string}`;

  /** a creation tx — to: null + bytecode */
  function deployRequest(): Parameters<typeof sendTransaction>[1] {
    return { to: null, data: CREATION, account: ACCT };
  }

  it("classifies as risk deploy (unknown tier) and the card shows in mode C WITHOUT breadth", async () => {
    let asked = 0;
    const d = deps({
      approval: async () => {
        asked += 1;
        return true;
      },
    });
    const out = await sendTransaction(d, deployRequest());
    expect(out.status).toEqual("sent");
    expect(asked).toEqual(1);
    expect(out.envelope.cls.risk).toEqual("deploy");
    expect(out.envelope.cls.tier).toEqual("unknown");
    expect(out.envelope.policy.requiresExtraAck).toBe(true);
  });

  it("mode C WITH breadth auto-acks the deploy too (the session-66 owner round)", async () => {
    let asked = 0;
    const journal = new JournalBus();
    const lines: string[] = [];
    journal.subscribe((e) => lines.push(`${e.kind} ${e.line}`));
    const d = deps({
      modeCBreadth: true,
      journal,
      approval: async () => {
        asked += 1;
        return true;
      },
    });
    const out = await sendTransaction(d, deployRequest());
    expect(out.status).toEqual("sent");
    expect(asked).toEqual(0);
    expect(lines.some((l) => l.includes("mode-C breadth") && l.includes("deploy") && l.includes("auto-acked"))).toBe(true);
  });

  it("modes A/B card the deploy — the widening is mode-C-only", async () => {
    let asked = 0;
    const d = deps({
      signerMode: "B",
      modeCBreadth: true,
      approval: async () => {
        asked += 1;
        return true;
      },
    });
    d.signer = fakeSigner("B").signer;
    const out = await sendTransaction(d, deployRequest());
    expect(out.status).toEqual("sent");
    expect(asked).toEqual(1);
  });

  it("allowUnknownDestinations=false DENIES the deploy (a creation tx is the ultimate unknown destination)", async () => {
    const d = deps({
      modeCBreadth: true,
      policy: { ...DEFAULT_POLICY, allowUnknownDestinations: false } as PolicyConfig,
      approval: async () => true,
    });
    const out = await sendTransaction(d, deployRequest());
    expect(out.status).toEqual("denied");
  });

  it("the creation receipt's contractAddress flows through the outcome (the DSS capture source)", async () => {
    const created = "0x0000000000000000000000000000000000000d55" as const;
    const { signer, sent } = fakeSigner("C");
    const d = deps({
      client: {
        call: async () => "0x" as `0x${string}`,
        estimateGas: async () => 400_000n,
        waitForReceipt: async () =>
          ({ status: "success", gasUsed: 380_000n, blockNumber: 27_674_001n, logs: [], contractAddress: created }) satisfies ReceiptLike,
      },
      signer,
      modeCBreadth: true,
    });
    const out = await sendTransaction(d, deployRequest());
    expect(out.status).toEqual("sent");
    if (out.status === "sent") expect(out.receipt?.contractAddress).toEqual(created);
    // the signer saw to: null (the deployment wire shape)
    expect((sent[0] as { to: string | null }).to).toEqual(null);
    expect((sent[0] as { data: string }).data).toEqual(CREATION);
  });
});

describe("gate settings shape", () => {
  it("defaults the breadth OFF and degrades gracefully without storage", () => {
    expect(DEFAULT_GATE_SETTINGS.modeCBreadth).toBe(false);
    // node test env has no window — loadGateSettings must answer the default
    expect(loadGateSettings().modeCBreadth).toBe(false);
    expect(() => saveGateSettings({ modeCBreadth: true })).not.toThrow();
  });
});
