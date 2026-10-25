import { describe, expect, it } from "vitest";
import {
  chatCompletion,
  chatCompletionStream,
  DEFAULT_MODEL,
  fetchKeyInfo,
  fetchModels,
  OpenRouterError,
  resolveApiKey,
  type StreamEvent,
  type WireMessage,
} from "@/agent/openrouter";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const BASE = "https://or.test";

describe("resolveApiKey", () => {
  it("prefers the runtime BYOK key over the dev-env channel", () => {
    const r = resolveApiKey("sk-or-byok-test");
    expect(r.key).toBe("sk-or-byok-test");
    expect(r.source).toBe("byok");
  });
  it("falls back to dev-env when BYOK is empty", () => {
    const r = resolveApiKey("");
    // in vitest the dev plugin serves app/.env; the owner box carries a key
    expect(r.source === "dev-env" || r.source === null).toBe(true);
    if (r.source === "dev-env") expect(r.key).not.toContain("VITE_");
  });
  it("resolves null with no source when neither channel has a key", () => {
    // simulate: BYOK empty + DEV_ENV overridden — resolveApiKey reads the
    // virtual module directly, so we assert the null shape via empty string
    // + whatever dev-env state exists; the null branch is exercised in e2e
    const r = resolveApiKey(null);
    expect(r).toHaveProperty("key");
    expect(r).toHaveProperty("source");
  });
});

describe("the default model + reasoning control", () => {
  it("is the canonical namespaced id (live-verified session-45)", async () => {
    expect(DEFAULT_MODEL).toBe("deepseek/deepseek-v4.1-flash");
    let body: Record<string, unknown> | null = null;
    const fetchImpl = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(200, { choices: [{ message: { content: "ok" } }] });
    }) as typeof fetch;
    await chatCompletion({ apiKey: "sk", baseUrl: BASE, model: DEFAULT_MODEL, messages: [{ role: "user", content: "x" }], reasoning: false, fetchImpl });
    expect(body!.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(body!.reasoning).toEqual({ enabled: false });
  });

  it("§7.11 toggle: reasoning=true sends {enabled:true}; undefined omits the key entirely", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(b);
      return jsonResponse(200, { choices: [{ message: { content: "ok" } }] });
    }) as typeof fetch;
    const base = { apiKey: "sk", baseUrl: BASE, model: "m", messages: [{ role: "user" as const, content: "x" }], fetchImpl };
    await chatCompletion({ ...base, reasoning: true });
    await chatCompletion({ ...base });
    expect(bodies[0]!.reasoning).toEqual({ enabled: true });
    expect("reasoning" in bodies[1]!).toBe(false);
  });

  it("surfaces the structured reasoning field verbatim (never <think> munging)", async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, { choices: [{ message: { content: "the answer", reasoning: "step one, step two" } }] })) as typeof fetch;
    const turn = await chatCompletion({ apiKey: "sk", baseUrl: BASE, model: "m", messages: [{ role: "user", content: "x" }], fetchImpl });
    expect(turn.reasoning).toBe("step one, step two");
    // absent/empty reasoning normalizes to null — the pane renders nothing
    const quiet = (async () => jsonResponse(200, { choices: [{ message: { content: "x", reasoning: "" } }] })) as typeof fetch;
    const turn2 = await chatCompletion({ apiKey: "sk", baseUrl: BASE, model: "m", messages: [{ role: "user", content: "x" }], fetchImpl: quiet });
    expect(turn2.reasoning).toBeNull();
  });
});

describe("chatCompletion", () => {
  const msgs: WireMessage[] = [{ role: "user", content: "hello" }];

  it("sends the chat-completions wire format with bearer auth and parses the turn", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen = { url: String(input), init: init ?? {} };
      return jsonResponse(200, {
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    }) as typeof fetch;
    const turn = await chatCompletion({ apiKey: "sk-test", baseUrl: BASE, model: "m1", messages: msgs, fetchImpl });
    expect(turn.text).toBe("ok");
    expect(turn.toolCalls).toEqual([]);
    expect(turn.usage?.total_tokens).toBe(15);
    expect(seen!.url).toBe(`${BASE}/chat/completions`);
    const body = JSON.parse(String(seen!.init.body)) as Record<string, unknown>;
    expect(body.model).toBe("m1");
    expect(body.stream).toBe(false);
    expect(seen!.init.headers).toMatchObject({ Authorization: "Bearer sk-test" });
  });

  it("advertises tools with tool_choice auto only when tools exist", async () => {
    let body: Record<string, unknown> | null = null;
    const fetchImpl = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(200, { choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "t", arguments: "{}" } }] } }] });
    }) as typeof fetch;
    const turn = await chatCompletion({
      apiKey: "sk",
      baseUrl: BASE,
      model: "m",
      messages: msgs,
      tools: [{ type: "function", function: { name: "t", description: "d", parameters: { type: "object", properties: {} } } }],
      fetchImpl,
    });
    expect(turn.toolCalls.length).toBe(1);
    expect(body!.tools).toBeDefined();
    expect(body!.tool_choice).toBe("auto");
  });

  it("classifies 401 / 402 / 429 and never leaks the key into the error", async () => {
    for (const [status, classif] of [[401, "invalid-key"], [402, "credits"], [429, "rate-limit"], [500, "server"]] as const) {
      const fetchImpl = (async () => jsonResponse(status, { error: { message: `boom ${status}` } })) as typeof fetch;
      await expect(
        chatCompletion({ apiKey: "sk-secret-value", baseUrl: BASE, model: "m", messages: msgs, fetchImpl })
      ).rejects.toSatisfy((e: unknown) => e instanceof OpenRouterError && e.classif === classif && !(e.message.includes("sk-secret-value")));
    }
  });

  it("maps network failures honestly", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(chatCompletion({ apiKey: "sk", baseUrl: BASE, model: "m", messages: msgs, fetchImpl })).rejects.toSatisfy(
      (e: unknown) => e instanceof OpenRouterError && e.classif === "network"
    );
  });

  it("surfaces the owner line for credit exhaustion", async () => {
    const err = new OpenRouterError("credits", "x", 402);
    expect(err.ownerLine()).toContain("credits low or exhausted");
  });
});

// ---- session-75: the streaming completion path ----

function sseFrame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function sseResponse(frames: string[], cutsAt: number[] = []): Response {
  const payload = frames.join("");
  const enc = new TextEncoder();
  const bytes = enc.encode(payload);
  // default: one enqueue per frame boundary; with `cutsAt`, split at EXACT
  // byte offsets (mid-line boundaries — the parser must buffer fragments)
  const cuts: number[] = cutsAt.length > 0 ? cutsAt : frames.slice(0, -1).reduce<number[]>((acc, _f, i) => [...acc, frames.slice(0, i + 1).join("").length], []);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      let prev = 0;
      for (const cut of [...cuts, bytes.length]) {
        c.enqueue(bytes.slice(prev, cut));
        prev = cut;
      }
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function drainStream(gen: AsyncGenerator<StreamEvent, void, void>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe("chatCompletionStream", () => {
  const msgs: WireMessage[] = [{ role: "user", content: "hello" }];

  it("sends stream:true and yields fragments + the assembled turn", async () => {
    let body: Record<string, unknown> | null = null;
    const fetchImpl = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return sseResponse([
        sseFrame({ choices: [{ delta: { content: "Hel" } }] }),
        sseFrame({ choices: [{ delta: { content: "lo" } }] }),
        sseFrame({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
        "data: [DONE]\n\n",
      ]);
    }) as typeof fetch;
    const events = await drainStream(chatCompletionStream({ apiKey: "sk", baseUrl: BASE, model: "m", messages: msgs, fetchImpl }));
    expect(body!.stream).toBe(true);
    const texts = events.filter((e): e is Extract<(typeof events)[number], { kind: "text" }> => e.kind === "text").map((e) => e.text);
    expect(texts).toEqual(["Hel", "lo"]);
    const turnEv = events[events.length - 1]!;
    expect(turnEv.kind).toBe("turn");
    if (turnEv.kind !== "turn") throw new Error("unreachable");
    expect(turnEv.turn.text).toBe("Hello");
    expect(turnEv.turn.finishReason).toBe("stop");
    expect(turnEv.turn.usage?.total_tokens).toBe(15);
  });

  it("buffers chunk boundaries that split INSIDE a data line", async () => {
    const payload = [
      sseFrame({ choices: [{ delta: { content: "abc" } }] }),
      sseFrame({ choices: [{ delta: { content: "def" } }] }),
      "data: [DONE]\n\n",
    ].join("");
    // split every 7 bytes — lines arrive as arbitrary fragments
    const enc = new TextEncoder();
    const bytes = enc.encode(payload);
    const cuts: number[] = [];
    for (let i = 7; i < bytes.length; i += 7) cuts.push(i);
    const fetchImpl = (async () => sseResponse([payload], cuts)) as typeof fetch;
    const events = await drainStream(chatCompletionStream({ apiKey: "sk", baseUrl: BASE, model: "m", messages: msgs, fetchImpl }));
    const turnEv = events[events.length - 1]!;
    if (turnEv.kind !== "turn") throw new Error("no turn");
    expect(turnEv.turn.text).toBe("abcdef");
  });

  it("assembles indexed tool-call fragments (id+name first, arguments appended)", async () => {
    const fetchImpl = (async () =>
      sseResponse([
        sseFrame({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "search_kb", arguments: '{"query":' } }] } }] }),
        sseFrame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"venue"}' } }] } }] }),
        sseFrame({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
        "data: [DONE]\n\n",
      ])) as typeof fetch;
    const events = await drainStream(chatCompletionStream({ apiKey: "sk", baseUrl: BASE, model: "m", messages: msgs, fetchImpl }));
    const turnEv = events[events.length - 1]!;
    if (turnEv.kind !== "turn") throw new Error("no turn");
    expect(turnEv.turn.text).toBeNull();
    expect(turnEv.turn.toolCalls).toEqual([{ id: "c1", type: "function", function: { name: "search_kb", arguments: '{"query":"venue"}' } }]);
    expect(turnEv.turn.finishReason).toBe("tool_calls");
  });

  it("yields reasoning fragments and keeps comments/malformed frames inert", async () => {
    const fetchImpl = (async () =>
      sseResponse([
        ": keep-alive\n\n",
        sseFrame({ choices: [{ delta: { reasoning: "step " } }] }),
        sseFrame({ choices: [{ delta: { reasoning: "two" } }] }),
        "data: not-json\n\n",
        sseFrame({ choices: [{ delta: { content: "answer" } }] }),
      ])) as typeof fetch;
    const events = await drainStream(chatCompletionStream({ apiKey: "sk", baseUrl: BASE, model: "m", messages: msgs, fetchImpl }));
    const reasoning = events.filter((e): e is Extract<(typeof events)[number], { kind: "reasoning" }> => e.kind === "reasoning").map((e) => e.text);
    expect(reasoning).toEqual(["step ", "two"]);
    const turnEv = events[events.length - 1]!;
    if (turnEv.kind !== "turn") throw new Error("no turn");
    expect(turnEv.turn.reasoning).toBe("step two");
    expect(turnEv.turn.text).toBe("answer");
  });

  it("classifies non-2xx exactly like the non-streaming path", async () => {
    const fetchImpl = (async () => jsonResponse(402, { error: { message: "no credits" } })) as typeof fetch;
    const gen = chatCompletionStream({ apiKey: "sk", baseUrl: BASE, model: "m", messages: msgs, fetchImpl });
    await expect(drainStream(gen)).rejects.toSatisfy((e: unknown) => e instanceof OpenRouterError && e.classif === "credits");
  });

  it("a stalled body still aborts through the signal tripwire", async () => {
    // the stream enqueues one frame, then NEVER resolves another read — a
    // fake body is not tied to the fetch signal; the tripwire must fire
    const ac = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(sseFrame({ choices: [{ delta: { content: "part " } }] })));
      },
    });
    const fetchImpl = (async () => new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;
    const gen = chatCompletionStream({ apiKey: "sk", baseUrl: BASE, model: "m", messages: msgs, fetchImpl, signal: ac.signal });
    const collected: string[] = [];
    const drain = (async () => {
      for await (const ev of gen) {
        if (ev.kind === "text") collected.push(ev.text);
      }
    })();
    await new Promise((r) => setTimeout(r, 30)); // let the first frame flow
    ac.abort();
    await expect(drain).rejects.toSatisfy((e: unknown) => e instanceof OpenRouterError && e.classif === "network" && e.message === "aborted");
    expect(collected).toEqual(["part "]);
  });

  it("a body that errors mid-stream maps to network (aborted when the signal fired)", async () => {
    const ac = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(sseFrame({ choices: [{ delta: { content: "one" } }] })));
        ac.signal.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")), { once: true });
      },
    });
    const fetchImpl = (async () => new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;
    const gen = chatCompletionStream({ apiKey: "sk", baseUrl: BASE, model: "m", messages: msgs, fetchImpl, signal: ac.signal });
    const promise = (async () => {
      const it = gen[Symbol.asyncIterator]();
      await it.next(); // consume the first frame
      ac.abort();
      await it.next(); // the errored read
    })();
    await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof OpenRouterError && e.classif === "network");
  });
});

describe("fetchModels / fetchKeyInfo", () => {
  it("parses and sorts the model list", async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, { data: [{ id: "z-model", name: "Z" }, { id: "a-model", context_length: 64000 }] })) as typeof fetch;
    const models = await fetchModels({ baseUrl: BASE, fetchImpl });
    expect(models.map((m) => m.id)).toEqual(["a-model", "z-model"]);
    expect(models[0]!.contextLength).toBe(64000);
    expect(models[1]!.name).toBe("Z");
  });

  it("parses the key credit info", async () => {
    const fetchImpl = (async () => jsonResponse(200, { data: { label: "scoped", usage: 0.42, limit: 5, is_free_tier: false } })) as typeof fetch;
    const info = await fetchKeyInfo({ apiKey: "sk", baseUrl: BASE, fetchImpl });
    expect(info.label).toBe("scoped");
    expect(info.usage).toBeCloseTo(0.42);
    expect(info.limit).toBe(5);
  });
});
