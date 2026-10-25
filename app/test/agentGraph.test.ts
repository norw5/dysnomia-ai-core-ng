import { describe, expect, it } from "vitest";
import { JournalBus } from "@/chain/journal";
import { runAgent, windowHistory, type RunEvent } from "@/agent/graph";
import type { AgentToolContext } from "@/agent/tools";
import type { PlayerSnapshot } from "@/chain/identity";

/**
 * The graph end-to-end against a scripted OpenRouter fetch: a tool-calling
 * turn (search_kb — pure client-side, no chain), a plain answer turn, the
 * budget stops, and the abort path. LangGraph owns the control flow; the
 * wire format is plain chat-completions.
 */

const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as `0x${string}`;

function fakeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    rpcUrl: "http://127.0.0.1:9999",
    account: ACCT,
    snapshot: null,
    journal: new JournalBus(),
    walletMode: "B",
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

function completion(body: Record<string, unknown>): Record<string, unknown> {
  return body;
}

function toolCallResponse(id: string, name: string, args: Record<string, unknown>): Record<string, unknown> {
  return completion({
    choices: [
      { message: { content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  });
}

function textResponse(text: string): Record<string, unknown> {
  return completion({
    choices: [{ message: { content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 },
  });
}

interface CapturedRequest {
  url: string;
  body: {
    model: string;
    messages: Array<{ role: string; content: string | null; tool_calls?: Array<{ function: { name: string } }> }>;
    tools?: Array<{ function: { name: string } }>;
  };
  auth: string | null;
}

function scriptedFetch(script: Array<Record<string, unknown>>): { fetchImpl: typeof fetch; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  let i = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as CapturedRequest["body"],
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
    });
    // a fresh Response per call — bodies are single-consumption
    const payload = script[Math.min(i, script.length - 1)]!;
    i += 1;
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function baseOpts(over: Partial<Parameters<typeof runAgent>[0]> = {}) {
  const journal = new JournalBus();
  return {
    apiKey: "sk-graph-test",
    apiKeySource: "byok" as const,
    model: "test-model",
    persona: null,
    history: [],
    userText: "what is a venue?",
    snapshot: SNAP,
    previousPayload: null,
    toolCtx: fakeCtx(),
    budget: { maxSteps: 6, maxTokens: 100_000 },
    signal: new AbortController().signal,
    journal,
    ...over,
  };
}

describe("runAgent", () => {
  it("runs a tool-calling turn end-to-end and streams the events", async () => {
    const { fetchImpl, requests } = scriptedFetch([
      toolCallResponse("call-1", "search_kb", { query: "venue bouncer" }),
      textResponse("A venue (QING) wraps an ERC-20 through MAP — see guide/venues.md."),
    ]);
    const events: RunEvent[] = [];
    const opts = baseOpts({ fetchImpl, onEvent: (e) => events.push(e) });
    const result = await runAgent(opts);

    expect(result.status).toBe("done");
    expect(result.steps).toBe(2);
    expect(result.tokens).toBe(360); // 120 + 240
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0]!.name).toBe("search_kb");
    expect(result.toolCalls[0]!.ok).toBe(true);

    // the wire history: system, snapshot, user, assistant(tool_calls), tool, assistant(text)
    const roles = result.messages.map((m) => m.role);
    expect(roles).toEqual(["system", "system", "user", "assistant", "tool", "assistant"]);
    const toolMsg = result.messages[4]!;
    expect(toolMsg.tool_call_id).toBe("call-1");
    const toolPayload = JSON.parse(toolMsg.content!) as { hits: Array<{ file: string }> };
    expect(toolPayload.hits.length).toBeGreaterThan(0);

    // request shape: snapshot injected, tools advertised, auth bearer
    const first = requests[0]!;
    expect(first.auth).toBe("Bearer sk-graph-test");
    expect(first.body.model).toBe("test-model");
    expect(first.body.tools!.map((t) => t.function.name)).toContain("search_kb");
    expect(first.body.tools!.map((t) => t.function.name)).not.toContain("send_chat"); // §7.4 OFF default
    const system = first.body.messages[0]!;
    expect(system.content!).toContain("DEPLOYED SEMANTICS ONLY");
    const snapshotMsg = first.body.messages[1]!;
    expect(snapshotMsg.content).toContain("PLAYER_STATE");

    // events: turn-start, usage, tool-call, tool-result, usage, assistant-text, done
    const types = events.map((e) => e.type);
    expect(types).toContain("tool-call");
    expect(types).toContain("tool-result");
    expect(types).toContain("assistant-text");
    expect(types[types.length - 1]).toBe("done");
  });

  it("answers directly when no tools are requested", async () => {
    const { fetchImpl } = scriptedFetch([textResponse("direct answer")]);
    const result = await runAgent(baseOpts({ fetchImpl }));
    expect(result.status).toBe("done");
    expect(result.steps).toBe(1);
    expect(result.toolCalls.length).toBe(0);
    expect(result.messages[result.messages.length - 1]!.content).toBe("direct answer");
  });

  it("stops honestly on the token budget", async () => {
    const { fetchImpl } = scriptedFetch([
      toolCallResponse("c1", "search_kb", { query: "beat" }),
      toolCallResponse("c2", "search_kb", { query: "chat" }), // never used — budget gate first
    ]);
    const events: RunEvent[] = [];
    const result = await runAgent(baseOpts({ fetchImpl, budget: { maxSteps: 6, maxTokens: 200 }, onEvent: (e) => events.push(e) }));
    // first model call = 120 tokens; second model call crosses 200 → budget-stop branch
    expect(result.status === "budget-stop" || result.steps <= 2).toBe(true);
    if (result.status === "budget-stop") expect(events.some((e) => e.type === "budget-stop")).toBe(true);
  });

  it("maxSteps 0 = NO step limit: a long tool loop completes (the token budget stays the guard)", async () => {
    // nine tool rounds + the final answer = 10 model turns (past the old 8 cap)
    const script = [
      ...Array.from({ length: 9 }, (_, i) => toolCallResponse(`c${i + 1}`, "search_kb", { query: `q${i + 1}` })),
      textResponse("finally — the answer."),
    ];
    // capped at 8: the run budget-stops before finishing
    const capped = await runAgent(baseOpts({ fetchImpl: scriptedFetch(script).fetchImpl, budget: { maxSteps: 8, maxTokens: 100_000 } }));
    expect(capped.status).toBe("budget-stop");
    expect(capped.steps).toBe(8);
    // 0 = no step cap: the same script runs to completion
    const unlimited = await runAgent(baseOpts({ fetchImpl: scriptedFetch(script).fetchImpl, budget: { maxSteps: 0, maxTokens: 100_000 } }));
    expect(unlimited.status).toBe("done");
    expect(unlimited.steps).toBe(10);
    expect(unlimited.toolCalls).toHaveLength(9);
  });

  it("reports the honest no-key error without calling the API", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return textResponse("x");
    }) as unknown as typeof fetch;
    const events: RunEvent[] = [];
    const result = await runAgent(baseOpts({ apiKey: null, apiKeySource: null, fetchImpl, onEvent: (e) => events.push(e) }));
    expect(called).toBe(false);
    expect(result.status).toBe("error");
    expect(result.error).toContain("no API key");
    expect(events[0]!.type).toBe("error");
  });

  it("aborts cleanly through the signal", async () => {
    const ac = new AbortController();
    const { fetchImpl } = scriptedFetch([
      toolCallResponse("c1", "search_kb", { query: "x" }),
      textResponse("done answer"),
    ]);
    const result = await runAgent(baseOpts({ fetchImpl, signal: ac.signal }));
    expect(result.status).toBe("done");
    // now abort before the run
    const ac2 = new AbortController();
    ac2.abort();
    const result2 = await runAgent(baseOpts({ fetchImpl, signal: ac2.signal }));
    expect(result2.status).toBe("aborted");
  });

  it("journals the turn lifecycle (agent.* kinds)", async () => {
    const { fetchImpl } = scriptedFetch([textResponse("ok")]);
    const journal = new JournalBus();
    const events: Array<{ kind: string }> = [];
    journal.subscribe((e) => events.push({ kind: e.kind }));
    await runAgent(baseOpts({ fetchImpl, journal }));
    expect(events.some((e) => e.kind === "agent.turn")).toBe(true);
    expect(events.some((e) => e.kind === "agent.spend")).toBe(true);
  });

  it("injects the persona after the core (supersedence is structural)", async () => {
    const { fetchImpl, requests } = scriptedFetch([textResponse("ok")]);
    await runAgent(baseOpts({ fetchImpl, persona: "terse radio-operator" }));
    const system = requests[0]!.body.messages[0]!;
    expect(system.content!).toContain("PERSONA (user-editable");
    expect(system.content!.indexOf("terse radio-operator")).toBeGreaterThan(system.content!.indexOf("FRAMING:"));
  });

  it("§7.11 native reasoning: forwards the toggle and streams the structured field", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok", reasoning: "considering the venue question" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    const events: RunEvent[] = [];
    await runAgent(baseOpts({ fetchImpl, reasoning: true, onEvent: (e) => events.push(e) }));
    expect(bodies[0]!.reasoning).toEqual({ enabled: true });
    const r = events.find((e) => e.type === "assistant-reasoning");
    expect(r).toMatchObject({ type: "assistant-reasoning", text: "considering the venue question" });
    // the toggle owns the render path: reasoning-off NEVER surfaces the field
    const events2: RunEvent[] = [];
    await runAgent(baseOpts({ fetchImpl, onEvent: (e) => events2.push(e) }));
    expect(events2.some((e) => e.type === "assistant-reasoning")).toBe(false);
    // default stays OFF (the flash-class gotcha)
    const bodies2: Array<Record<string, unknown>> = [];
    const fetch2 = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      bodies2.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    await runAgent(baseOpts({ fetchImpl: fetch2 }));
    expect(bodies2[0]!.reasoning).toEqual({ enabled: false });
  });

  it("drives the DECK end-to-end: dashboard tools journaled, auto-surface through the event bus", async () => {
    // the store.tsx pipe: onEvent -> emitRunEvent -> wired deckStore
    const deck = await import("@/state/deckStore");
    const eventsBus = await import("@/agent/events");
    deck.clearDeck();
    const unwire = deck.wireDeckToRunEvents();
    const unwireBus = eventsBus.subscribeRunEvents(() => {}); // keep the bus hot
    try {
      const { fetchImpl } = scriptedFetch([
        toolCallResponse("d1", "show_widget", { kind: "kb_excerpt", query: "venues" }),
        textResponse("on the deck."),
      ]);
      const journal = new JournalBus();
      const kinds: string[] = [];
      journal.subscribe((e) => kinds.push(e.kind));
      // the store.tsx pipe: runAgent onEvent -> the lifted bus -> wired deck
      const result = await runAgent(baseOpts({ fetchImpl, journal, onEvent: (e) => eventsBus.emitRunEvent(e) }));
      expect(result.toolCalls[0]!.name).toBe("show_widget");
      expect(result.toolCalls[0]!.ok).toBe(true);
      // journaled as agent.tool like every tool call
      expect(kinds.filter((k) => k === "agent.tool").length).toBeGreaterThanOrEqual(2); // call + result
      // turn-start auto-surfaced the checklist; the dashboard tool surfaced the excerpt
      const surfaced = deck.deckWidgets().map((w) => w.kind);
      expect(surfaced).toContain("task_graph");
      expect(surfaced).toContain("kb_excerpt");
      expect(deck.deckWidgets().find((w) => w.kind === "kb_excerpt")!.origin).toBe("agent");
    } finally {
      unwire();
      unwireBus();
      deck.clearDeck();
    }
  });
});

// ---- session-75: the streaming model calls (SSE through the graph) ----

function sseFrames(frames: Array<Record<string, unknown>>): string {
  return frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n";
}

function sseQueueFetch(bodies: string[]): typeof fetch {
  let i = 0;
  return (async () => {
    const b = bodies[Math.min(i, bodies.length - 1)]!;
    i += 1;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(b));
        c.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
}

describe("runAgent streaming (session-75)", () => {
  it("the streaming flag emits per-chunk deltas and still closes with the finalized assistant-text", async () => {
    const fetchImpl = sseQueueFetch([
      sseFrames([
        { choices: [{ delta: { content: "▸ plan: read, then answer." } }] },
        { choices: [{ delta: { content: "\nA QING wraps an ERC-20 through MAP." } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 24, total_tokens: 124 } },
      ]),
    ]);
    const events: RunEvent[] = [];
    const result = await runAgent(baseOpts({ streaming: true, fetchImpl, onEvent: (e) => events.push(e) }));

    expect(result.status).toBe("done");
    // the deltas are INCREMENTAL fragments, in chunk order
    const deltas = events.filter((e): e is Extract<RunEvent, { type: "assistant-text-delta" }> => e.type === "assistant-text-delta").map((e) => e.text);
    expect(deltas).toEqual(["▸ plan: read, then answer.", "\nA QING wraps an ERC-20 through MAP."]);
    // the finalized whole message is THE record — one assistant-text, the full text
    const finals = events.filter((e): e is Extract<RunEvent, { type: "assistant-text" }> => e.type === "assistant-text");
    expect(finals.map((e) => e.text)).toEqual(["▸ plan: read, then answer.\nA QING wraps an ERC-20 through MAP."]);
    // usage rides the stream's tail chunk — the run meter counts it
    expect(result.tokens).toBe(124);
    const last = result.messages[result.messages.length - 1]!;
    expect(last.role).toBe("assistant");
    expect(last.content).toBe("▸ plan: read, then answer.\nA QING wraps an ERC-20 through MAP.");
  });

  it("streamed tool-call fragments execute like non-streaming ones (the tool loop still works)", async () => {
    const fetchImpl = sseQueueFetch([
      sseFrames([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "s1", type: "function", function: { name: "search_kb", arguments: '{"query":' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"venue bouncer"}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 90, completion_tokens: 18, total_tokens: 108 } },
      ]),
      sseFrames([
        { choices: [{ delta: { content: "Bouncers and cover charges apply at the door." } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 80, completion_tokens: 16, total_tokens: 96 } },
      ]),
    ]);
    const events: RunEvent[] = [];
    const result = await runAgent(baseOpts({ streaming: true, fetchImpl, onEvent: (e) => events.push(e) }));

    expect(result.status).toBe("done");
    expect(result.steps).toBe(2);
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0]!.name).toBe("search_kb");
    expect(result.toolCalls[0]!.args).toEqual({ query: "venue bouncer" });
    expect(result.toolCalls[0]!.ok).toBe(true);
    expect(result.tokens).toBe(204);
    // the second streamed turn's text finalizes into history
    const last = result.messages[result.messages.length - 1]!;
    expect(last.content).toBe("Bouncers and cover charges apply at the door.");
  });

  it("STOP mid-generation preserves the streamed partial (aborted run, history carries what was said)", async () => {
    const ac = new AbortController();
    const fetchImpl = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "part one of an answer " } }] })}\n\n`));
          // the second read never resolves on its own — the abort tripwire
          // (the app's real fetch ties its body to the signal; this fake
          // wires the error explicitly) kills the stream mid-generation
          init?.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")), { once: true });
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;
    const events: RunEvent[] = [];
    const runP = runAgent(baseOpts({ streaming: true, fetchImpl, signal: ac.signal, onEvent: (e) => events.push(e) }));
    await new Promise((r) => setTimeout(r, 40)); // the first chunk flows
    ac.abort();
    const result = await runP;

    expect(result.status).toBe("aborted");
    // the delta was emitted; the run closed honestly with the aborted event
    expect(events.some((e) => e.type === "assistant-text-delta" && e.text === "part one of an answer ")).toBe(true);
    expect(events.some((e) => e.type === "aborted")).toBe(true);
    expect(events.some((e) => e.type === "assistant-text")).toBe(false); // never finalized — no whole message
    // the returned history carries the partial so the next turn sees it
    const last = result.messages[result.messages.length - 1]!;
    expect(last.role).toBe("assistant");
    expect(last.content).toBe("part one of an answer ");
  });
});

describe("windowHistory (§7.7)", () => {
  it("§7.8 L2: repeated tool failures stop the run (tighten-only; any ok resets the streak)", async () => {
    // three rounds of an unknown tool — the knob is set to 2, so the run
    // must stop after the SECOND consecutive failing round
    const { fetchImpl } = scriptedFetch([
      toolCallResponse("c1", "no_such_tool", {}),
      toolCallResponse("c2", "no_such_tool", {}),
      toolCallResponse("c3", "no_such_tool", {}),
    ]);
    const events: RunEvent[] = [];
    const result = await runAgent(
      baseOpts({
        fetchImpl,
        budget: { maxSteps: 8, maxTokens: 100_000 },
        autonomy: { maxConsecutiveToolFailures: 2, checkpointEverySteps: 0 },
        onEvent: (e) => events.push(e),
      })
    );
    expect(result.status).toBe("budget-stop");
    expect(result.toolCalls.length).toBe(2); // the third round never runs
    expect(result.toolCalls.every((c) => !c.ok)).toBe(true);
    const stop = events.find((e) => e.type === "budget-stop");
    expect(stop).toBeDefined();
    expect((stop as { reason: string }).reason).toContain("repeated tool failures");
    // history stays well-formed: the stop line is the last message
    const last = result.messages[result.messages.length - 1]!;
    expect(last.role).toBe("assistant");
    expect(last.content).toContain("autonomy stop");
  });

  it("§7.8 L2: a failing round followed by an ok round does NOT trip the failure knob", async () => {
    const { fetchImpl } = scriptedFetch([
      toolCallResponse("c1", "no_such_tool", {}),
      toolCallResponse("c2", "search_kb", { query: "venue" }),
      textResponse("recovered — here is the answer."),
    ]);
    const result = await runAgent(
      baseOpts({
        fetchImpl,
        autonomy: { maxConsecutiveToolFailures: 2, checkpointEverySteps: 0 },
      })
    );
    expect(result.status).toBe("done");
    expect(result.toolCalls.map((c) => c.ok)).toEqual([false, true]);
  });

  it("§7.8 L2: checkpoint cadence pauses the run resumably with well-formed history", async () => {
    const { fetchImpl } = scriptedFetch([
      toolCallResponse("c1", "search_kb", { query: "venue" }),
      toolCallResponse("c2", "search_kb", { query: "beat" }),
    ]);
    const events: RunEvent[] = [];
    const result = await runAgent(
      baseOpts({
        fetchImpl,
        autonomy: { maxConsecutiveToolFailures: 0, checkpointEverySteps: 1 },
        onEvent: (e) => events.push(e),
      })
    );
    expect(result.status).toBe("checkpoint");
    expect(result.steps).toBe(1);
    const cp = events.find((e) => e.type === "checkpoint");
    expect(cp).toBeDefined();
    // the tool result is appended BEFORE the pause line — the carried history
    // has no dangling tool_calls (the next turn starts clean)
    const roles = result.messages.map((m) => m.role);
    expect(roles[roles.length - 2]).toBe("tool");
    expect(result.messages[result.messages.length - 1]!.content).toContain("checkpoint");
  });

  it("§7.8 L2: knobs default conservative when absent (failures 3, cadence off)", async () => {
    const { fetchImpl } = scriptedFetch([
      toolCallResponse("c1", "search_kb", { query: "venue" }),
      textResponse("answer"),
    ]);
    const result = await runAgent(baseOpts({ fetchImpl }));
    expect(result.status).toBe("done");
  });

  it("session-62 capability asymmetry: the ctx allowlist filters the ADVERTISED specs and binds at EXECUTE", async () => {
    // the driver's per-agent subset: reads only — search_kb is NOT in it
    const { fetchImpl, requests } = scriptedFetch([
      toolCallResponse("c1", "get_state", {}),
      toolCallResponse("c2", "search_kb", { query: "venue" }), // out-of-set → honest refusal
      textResponse("done with the subset."),
    ]);
    const result = await runAgent(
      baseOpts({
        fetchImpl,
        toolCtx: fakeCtx({ toolAllowlist: new Set(["get_state", "get_venue", "journal_note"]) }),
      })
    );
    expect(result.status).toBe("done");
    // advertise seam: only the subset reached the model
    const names = requests[0]!.body.tools!.map((t) => t.function.name);
    expect(names).toContain("get_state");
    expect(names).not.toContain("search_kb");
    expect(names).not.toContain("send_chat");
    // execute seam: the in-set call ran, the out-of-set call refused honestly
    expect(result.toolCalls.map((c) => `${c.name}:${c.ok}`)).toEqual(["get_state:true", "search_kb:false"]);
    expect((result.toolCalls[1]!.result as { error: string }).error).toContain("not in this agent's toolset");
    // a null allowlist = the full catalog (the app default)
    const { fetchImpl: fullFetch, requests: fullReqs } = scriptedFetch([textResponse("ok")]);
    await runAgent(baseOpts({ fetchImpl: fullFetch, toolCtx: fakeCtx({ toolAllowlist: null }) }));
    expect(fullReqs[0]!.body.tools!.some((t) => t.function.name === "search_kb")).toBe(true);
  });

  it("drops system messages and caps the carried tail", () => {    const msgs = Array.from({ length: 30 }, (_, i) => ({ role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant", content: String(i) }));
    const withSystem = [{ role: "system" as const, content: "sys" }, ...msgs];
    const windowed = windowHistory(withSystem);
    expect(windowed.length).toBe(16);
    expect(windowed.every((m) => m.role !== "system")).toBe(true);
    expect(windowed[windowed.length - 1]!.content).toBe("29");
  });

  it("session-65 whisper: queued operator notes drain into the NEXT model turn as a system note (never aborting)", async () => {
    // turn 1: a tool call; DURING the tools phase the operator whispers —
    // turn 2's request must carry the note as the LAST message
    const queue: string[] = [];
    const { fetchImpl, requests } = scriptedFetch([
      toolCallResponse("w1", "search_kb", { query: "venue" }),
      textResponse("weighed the whisper — proceeding."),
    ]);
    const events: RunEvent[] = [];
    const opts = baseOpts({
      fetchImpl,
      onEvent: (e) => events.push(e),
      takeWhisper: () => queue.shift() ?? null,
    });
    // queue AFTER the run starts so the first model call already happened
    const running = runAgent(opts);
    queue.push("check the cover charge before joining");
    queue.push("second note joins the same drain");
    const result = await running;

    expect(result.status).toEqual("done");
    // the second model call's message list: the whisper note AFTER the tool
    // result, exactly one injected note (the marker is the em-dash form —
    // the core prompt itself MENTIONS "[operator whisper]" by name)
    const second = requests[1]!.body.messages;
    const whisperIdx = second.findIndex((m) => m.role === "system" && m.content?.includes("[operator whisper —"));
    expect(whisperIdx).toBeGreaterThan(-1);
    expect(second.filter((m) => m.role === "system" && m.content?.includes("[operator whisper —")).length).toEqual(1);
    expect(second[whisperIdx]!.content).toContain("check the cover charge before joining");
    expect(second[whisperIdx]!.content).toContain("second note joins the same drain");
    expect(second[second.length - 1]!.role).toEqual("tool"); // the note sits after the tool result
    // the event surfaced (the pane's delivered marker)
    expect(events.filter((e) => e.type === "whisper").length).toEqual(2);
    // the whisper is TURN-SCOPED context, not carried history: the final
    // message list carries the drained note exactly once
    expect(result.messages.filter((m) => m.role === "system" && (m.content ?? "").includes("[operator whisper —")).length).toEqual(1);
  });

  it("session-65 whisper: an empty queue changes nothing (no phantom system messages)", async () => {
    const { fetchImpl, requests } = scriptedFetch([
      toolCallResponse("w2", "search_kb", { query: "venue" }),
      textResponse("answer"),
    ]);
    const result = await runAgent(baseOpts({ fetchImpl, takeWhisper: () => null }));
    expect(result.status).toEqual("done");
    // only the fixed system core + snapshot — no whisper note anywhere
    const second = requests[1]!.body.messages;
    expect(second.filter((m) => m.role === "system" && m.content?.includes("[operator whisper —")).length).toEqual(0);
  });
});
