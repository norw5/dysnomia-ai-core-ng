import { describe, expect, it } from "vitest";
import {
  DEFAULT_DRIVE_POLICY,
  RunnerJournal,
  parseDrivePlan,
  parseFetchScript,
  parseSession,
  recordedApproval,
  scriptedChatFetch,
} from "@/runner/drive";
import { parseRecording } from "@/agent/recording";

/**
 * The headless driver's pure seams (session 61): the drive-plan schema
 * (the manifest policy block = the RECORDED operator consent), the
 * scripted-fetch boundary (the model rides the real adapter — the response
 * is a wire-format body), and the approval decider (a DRIVER choice at
 * the approve-callback seam, never a gate bypass).
 */

const BASE = {
  rpc: "http://127.0.0.1:8547",
  roster: [
    { name: "AGENT-1", address: "0x" + "a1".repeat(20), key: "0x" + "11".repeat(32), vessel: "vitruv", lau: null, yue: null, persona: null },
    { name: "AGENT-2", address: "0x" + "b2".repeat(20), key: "0x" + "22".repeat(32), vessel: "kestrel", lau: null, yue: null, persona: null },
  ],
  turns: [{ agent: "AGENT-1", prompt: "seal the note" }],
};

describe("parseDrivePlan", () => {
  it("parses the manifest block with defaults mirroring the app's L2 knobs", () => {
    const plan = parseDrivePlan(BASE);
    expect(plan.policy.maxAgentTxPerRun).toBe(DEFAULT_DRIVE_POLICY.maxAgentTxPerRun);
    expect(plan.policy.maxConsecutiveToolFailures).toBe(3);
    expect(plan.policy.chatToolsEnabled).toBe(false); // §7.4 opt-in OFF unless recorded
    expect(plan.forkBlock).toBeNull();
    // the default step budget mirrors the app (32); an explicit 0 is
    // PRESERVED (no step limit — the token budget remains the guard)
    expect(plan.policy.maxSteps).toBe(DEFAULT_DRIVE_POLICY.maxSteps);
    expect(parseDrivePlan({ ...BASE, policy: { maxSteps: 0 } }).policy.maxSteps).toBe(0);
    expect(parseDrivePlan({ ...BASE, policy: { maxSteps: 12 } }).policy.maxSteps).toBe(12);
  });

  it("refuses roster rows without keys, unknown agents in turns, missing rpc", () => {
    expect(() => parseDrivePlan({ ...BASE, rpc: "" })).toThrow(/rpc/);
    expect(() => parseDrivePlan({ ...BASE, roster: [{ name: "X", address: "0x1" }] })).toThrow(/name\/address\/key/);
    expect(() => parseDrivePlan({ ...BASE, turns: [{ agent: "GHOST", prompt: "x" }] })).toThrow(/unknown agent/);
  });

  it("session-62: roster rows carry a per-agent tool subset; unknown names refuse the plan", () => {
    const plan = parseDrivePlan({
      ...BASE,
      roster: BASE.roster.map((r, i) => ({ ...r, tools: i === 0 ? ["get_venue", "encrypt_note", "decrypt_note"] : undefined })),
    });
    expect(plan.roster[0]!.tools).toEqual(["get_venue", "encrypt_note", "decrypt_note"]);
    expect(plan.roster[1]!.tools).toBeNull(); // absent = the full catalog
    // a typo'd subset would silently disarm an agent — refuse honestly
    expect(() => parseDrivePlan({ ...BASE, roster: BASE.roster.map((r) => ({ ...r, tools: ["get_venu"] })) })).toThrow(/unknown tools get_venu/);
    expect(() => parseDrivePlan({ ...BASE, roster: BASE.roster.map((r) => ({ ...r, tools: [] })) })).toThrow(/tools must be a non-empty/);
  });
});

describe("scriptedChatFetch (the deterministic harness seam)", () => {
  interface WireBody {
    choices: Array<{
      message: { content?: string | null; tool_calls?: Array<{ function: { name: string; arguments: string } }> };
      finish_reason: string;
    }>;
  }

  it("answers chat/completions positionally in the wire format the real adapter parses", async () => {
    const script = parseFetchScript({
      turns: [
        { toolCalls: [{ name: "encrypt_note", args: { to: "7777", key: "k", message: "m", send: true } }] },
        { text: "▸ plan: done.\nsealed." },
      ],
    });
    const state = { consumed: 0 };
    const f = scriptedChatFetch(script, state);
    const r1 = await f("https://openrouter.ai/api/v1/chat/completions", { method: "POST" });
    const j1 = (await r1.json()) as WireBody;
    expect(j1.choices[0]!.message.tool_calls![0]!.function.name).toBe("encrypt_note");
    expect(JSON.parse(j1.choices[0]!.message.tool_calls![0]!.function.arguments)).toEqual({ to: "7777", key: "k", message: "m", send: true });
    expect(j1.choices[0]!.finish_reason).toBe("tool_calls");
    const r2 = await f("https://openrouter.ai/api/v1/chat/completions", { method: "POST" });
    const j2 = (await r2.json()) as WireBody;
    expect(j2.choices[0]!.message.content).toContain("sealed");
    expect(j2.choices[0]!.finish_reason).toBe("stop");
    expect(state.consumed).toBe(2);
  });

  it("an exhausted script answers HTTP 500 with the honest message (the run errors visibly)", async () => {
    const script = parseFetchScript({ turns: [] });
    const f = scriptedChatFetch(script, { consumed: 0 });
    const r = await f("https://openrouter.ai/api/v1/chat/completions", { method: "POST" });
    expect(r.status).toBe(500);
  });
});

describe("recordedApproval (the approve-callback seam — never a bypass)", () => {
  const envelope = (risk: string) => ({
    request: { to: "0x1", data: "0x00" },
    cls: { risk, tier: "unknown", gate: null, metered: true, reverts: [], contract: null, functionSig: null },
    policy: { allowed: true, reasons: [], risk, tier: "unknown", requiresExtraAck: true },
    sim: null,
  }) as never;

  it("acks standard + unknown-contract per the policy block (SIM sends are unknown-contract)", async () => {
    const jrn = new RunnerJournal(true);
    const approve = recordedApproval({ standard: true, unknownContract: true, privileged: false, value: false }, jrn);
    expect(await approve(envelope("standard"))).toBe(true);
    expect(await approve(envelope("unknown-contract"))).toBe(true);
  });

  it("refuses privileged + value + unknown-method even when recorded (tighten-only)", async () => {
    const jrn = new RunnerJournal(true);
    const approve = recordedApproval({ standard: true, unknownContract: true, privileged: false, value: false }, jrn);
    expect(await approve(envelope("privileged"))).toBe(false);
    expect(await approve(envelope("value"))).toBe(false);
    expect(await approve(envelope("unknown-method"))).toBe(false);
  });

  it("a policy block that did NOT ack unknown-contract refuses SIM sends", async () => {
    const jrn = new RunnerJournal(true);
    const approve = recordedApproval({ standard: true, unknownContract: false, privileged: false, value: false }, jrn);
    expect(await approve(envelope("unknown-contract"))).toBe(false);
  });
});

describe("session shuttling", () => {
  it("round-trips per-agent histories; unknown agents start empty", () => {
    const s = parseSession({ histories: { "AGENT-1": [{ role: "user", content: "hi" }] } }, ["AGENT-1", "AGENT-2"]);
    expect(s.histories["AGENT-1"]).toEqual([{ role: "user", content: "hi" }]);
    expect(s.histories["AGENT-2"]).toEqual([]);
  });
});

describe("the RunnerJournal (no IDB under node)", () => {
  it("emits + subscribes without any DOM/IndexedDB touch", () => {
    const jrn = new RunnerJournal(true);
    const seen: string[] = [];
    jrn.subscribe((e) => seen.push(e.kind));
    const e = jrn.emit("agent.tool", "tool encrypt_note ok", { tool: "encrypt_note" });
    expect(e.kind).toBe("agent.tool");
    expect(seen).toEqual(["agent.tool"]);
  });
});

describe("format cross-pins (the entry + the app share one truth)", () => {
  it("the runner's recording parses with the app parser (agent/turn attribution survives)", () => {
    // the shape the entry writes after merge: base events + shifted addenda
    const doc = {
      v: 1,
      kind: "fleet-run",
      started: "2026-10-04T00:00:00.000Z",
      rpc: "http://127.0.0.1:8547",
      forkBlock: 27674000,
      roster: [{ name: "AGENT-1", address: "0x1", lau: null, yue: null, vessel: "vitruv" }],
      events: [
        { i: 0, agent: "AGENT-1", turn: 1, t: 1, e: { type: "turn-start" } },
        { i: 1, agent: "AGENT-2", turn: 1, t: 2, e: { type: "turn-start" } },
      ],
      scores: [{ atEvent: 1, t: 2, rows: [] }],
      finished: "2026-10-04T00:01:00.000Z",
    };
    const rec = parseRecording(JSON.stringify(doc));
    expect(rec.events.map((e) => e.agent)).toEqual(["AGENT-1", "AGENT-2"]);
  });
});
