import { describe, expect, it } from "vitest";
import { JournalBus } from "@/chain/journal";
import type { AgentToolContext } from "@/agent/tools";
import type { PlayerSnapshot } from "@/chain/identity";
import { runStrategist } from "@/agent/strategist";
import { STRATEGIST_MAX_STEPS, STRATEGIST_MAX_TOKENS, type FullAutoCycleRecord } from "@/agent/fullAuto";

/**
 * The two-tier strategist (session-74, the owner round): one bounded
 * read-only call between full-auto cycles — a stronger model picks the
 * next goal from the objective + the menu + the ledger. Scripted-fetch
 * end-to-end (the agentGraph pattern): the pick parses from the GOAL:
 * line, the read-only allowlist binds at the execute seam, and every
 * failure shape falls back to a null goal (kickoff self-goaling).
 */

const ACCT = "0xf39fd6e51aad88f6e4ce6ab8827279cfffb92266" as `0x${string}`;

function fakeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    rpcUrl: "http://127.0.0.1:9999",
    account: ACCT,
    snapshot: null,
    journal: new JournalBus(),
    walletMode: "C",
    chatToolsEnabled: false,
    gateDryRun: async () => {
      throw new Error("not exercised");
    },
    gateSend: async () => {
      throw new Error("not exercised");
    },
    refreshSnapshot: () => {},
    takeNote: () => {},
    simToolsEnabled: false,
    ...overrides,
  };
}

const SNAP: PlayerSnapshot = {
  account: ACCT,
  lau: null,
  yue: null,
  lauName: null,
  lauSymbol: null,
  username: null,
  yueName: null,
  yueSymbol: null,
  balances: {
    pls: { wallet: 10n, lau: 0n, yue: 0n },
    affection: { wallet: 0n, lau: 0n, yue: 0n },
    choa: { wallet: 0n, lau: 0n, yue: 0n },
  },
  yuanChoa: 0n,
  blockNumber: 27_674_000n,
  fetchedAt: 1_700_000_000_000,
};

function toolCallResponse(id: string, name: string, args: Record<string, unknown>): Record<string, unknown> {
  return {
    choices: [
      { message: { content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}

function textResponse(text: string): Record<string, unknown> {
  return {
    choices: [{ message: { content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 },
  };
}

interface CapturedRequest {
  model: string;
  messages: Array<{ role: string; content: string | null; tool_calls?: Array<{ function: { name: string } }> }>;
  tools?: Array<{ function: { name: string } }>;
}

function scriptedFetch(script: Array<Record<string, unknown>>): { fetchImpl: typeof fetch; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  let i = 0;
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as CapturedRequest);
    const payload = script[Math.min(i, script.length - 1)]!;
    i += 1;
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const LEDGER: FullAutoCycleRecord[] = [
  { n: 1, kind: "run", status: "done", tokens: 130, toolCalls: 2, toolErrors: 0, sends: 1, summary: "settled at Phobos", goals: ["beat the home QING"], t: Date.now() },
];

function baseInput(over: Partial<Parameters<typeof runStrategist>[0]> = {}) {
  return {
    apiKey: "sk-strategist-test",
    apiKeySource: "byok" as const,
    model: "stronger-model",
    persona: null,
    objective: "grow the home QING economy",
    menu: ["beat the home QING", "settle at Phobos again"],
    menuCycle: 1,
    ledger: LEDGER,
    nextCycle: 2,
    snapshot: SNAP,
    toolCtx: fakeCtx(),
    signal: new AbortController().signal,
    journal: new JournalBus(),
    ...over,
  };
}

describe("runStrategist (the bounded between-cycles call)", () => {
  it("picks the goal from the GOAL: line; the call carries the strategist model, the suffixed system, the composed inputs, and ONLY the read-only tools", async () => {
    const { fetchImpl, requests } = scriptedFetch([
      toolCallResponse("s1", "search_kb", { query: "beat home qing playbook" }),
      textResponse("The menu's first item matches state.\nGOAL: beat the home QING this cycle (Fornax ceiling-aware)"),
    ]);
    const r = await runStrategist({ ...baseInput(), fetchImpl });
    expect(r.goal).toBe("beat the home QING this cycle (Fornax ceiling-aware)");
    expect(r.tokens).toBe(360);
    expect(r.status).toBe("done");
    expect(r.error).toBeNull();
    // the strategist model, not the executor's
    expect(requests[0]!.model).toBe("stronger-model");
    // the system layer: the FIXED core first, the strategist role AFTER it
    const system = requests[0]!.messages.find((m) => m.role === "system")!.content!;
    expect(system.startsWith("You are the AI core of Dysnomia Terminal")).toBe(true);
    expect(system.indexOf("You are the AI core")).toBeLessThan(system.indexOf("STRATEGIST layer"));
    expect(system).toContain("READ-ONLY tools");
    // the user text: objective + menu + ledger
    const user = requests[0]!.messages.find((m) => m.role === "user")!.content!;
    expect(user).toContain("grow the home QING economy");
    expect(user).toContain("- beat the home QING");
    expect(user).toContain("#1 run done · 130 tok · 1 send — settled at Phobos");
    expect(user).toContain("cycle 2");
    // PLAYER_STATE rides its own message; the advertised tools are read-only
    expect(requests[0]!.messages.some((m) => m.role === "system" && (m.content ?? "").startsWith("PLAYER_STATE"))).toBe(true);
    const advertised = requests[0]!.tools!.map((t) => t.function.name);
    expect(advertised).toContain("get_state");
    expect(advertised).toContain("search_kb");
    for (const banned of ["run_beat", "settle_venue", "send_chat", "propose_plan", "move_tokens"]) {
      expect(advertised).not.toContain(banned);
    }
  });

  it("the read-only allowlist binds at the EXECUTE seam too — a scripted act call refuses honestly", async () => {
    const { fetchImpl, requests } = scriptedFetch([
      toolCallResponse("s1", "run_beat", { waat: "42", send: true }),
      textResponse("State is enough.\nGOAL: settle at Phobos"),
    ]);
    const r = await runStrategist({ ...baseInput(), fetchImpl });
    expect(r.goal).toBe("settle at Phobos"); // the refusal did not kill the call
    // the tool result fed back to the model is the honest allowlist refusal
    const toolMsg = requests[1]!.messages.find((m) => m.role === "tool");
    expect((toolMsg?.content ?? "")).toContain("not in this agent's toolset");
  });

  it("a missing GOAL: line falls back to a null goal with the honest error (kickoff self-goaling)", async () => {
    const { fetchImpl } = scriptedFetch([textResponse("I would settle at Phobos, all things considered.")]);
    const r = await runStrategist({ ...baseInput(), fetchImpl });
    expect(r.goal).toBeNull();
    expect(r.error).toContain("no GOAL: line");
  });

  it("the budget is the owner-round bound (≤ 6 turns, ≤ 24k tokens); a step-budget stop falls back honestly", async () => {
    expect(STRATEGIST_MAX_STEPS).toBe(6);
    expect(STRATEGIST_MAX_TOKENS).toBe(24_000);
    // 7 tool-calling turns: turns 1-6 execute; the 7th crosses the step
    // budget → the run stops with budget-stop BEFORE any final answer
    const script = Array.from({ length: 7 }, (_, i) => toolCallResponse(`s${i}`, "search_kb", { query: "beat" }));
    const { fetchImpl } = scriptedFetch(script);
    const r = await runStrategist({ ...baseInput(), fetchImpl });
    expect(r.goal).toBeNull();
    expect(r.status).toBe("budget-stop");
    expect(r.error).toContain("budget-stop");
  });
});
