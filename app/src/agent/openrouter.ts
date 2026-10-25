import { DEV_ENV } from "virtual:dys-dev-env";

/**
 * The OpenRouter adapter (IA-PLAN §7.1, session-45): plain chat-completions
 * wire format over fetch — no model SDK lock-in, LangGraph only owns the
 * graph. Key resolution: the runtime BYOK field first, then the dev/test
 * `.env` channel (virtual:dys-dev-env — structurally absent from builds).
 * The key is NEVER journaled, logged, or echoed in errors; error surfaces
 * are classified so "credits low/exhausted" reaches the owner visibly.
 */

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/**
 * owner verdict (IA-PLAN §7.1) — the canonical OpenRouter id (live-verified
 * session-45: 462 models listed; the bare name is NOT resolvable to text —
 * the namespaced id + reasoning-off is the working combo). The live
 * model-list fetch can replace it in SETTINGS.
 */
export const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface AssistantTurn {
  text: string | null;
  /** the structured `reasoning` field (present only when the model+toggle give one) */
  reasoning: string | null;
  toolCalls: ToolCall[];
  finishReason: string | null;
  usage: Usage | null;
}

export type KeySource = "byok" | "dev-env";

export interface ResolvedKey {
  key: string | null;
  source: KeySource | null;
}

export function resolveApiKey(byokKey: string | null | undefined): ResolvedKey {
  const byok = byokKey?.trim();
  if (byok && byok.length > 0) return { key: byok, source: "byok" };
  const dev = DEV_ENV["OPENROUTER_API_KEY"];
  if (dev && dev.length > 0) return { key: dev, source: "dev-env" };
  return { key: null, source: null };
}

export class OpenRouterError extends Error {
  readonly status: number | null;
  readonly classif: "no-key" | "invalid-key" | "credits" | "rate-limit" | "server" | "network" | "unknown";

  constructor(classif: OpenRouterError["classif"], message: string, status: number | null) {
    super(message);
    this.name = "OpenRouterError";
    this.classif = classif;
    this.status = status;
  }

  /** the owner-facing line — surfaced in the pane + SYS tab when credits run low */
  ownerLine(): string {
    switch (this.classif) {
      case "no-key":
        return "no API key — SETTINGS → Agent (BYOK), or app/.env for dev runs";
      case "invalid-key":
        return "API key rejected (401) — check the BYOK field / the scoped key";
      case "credits":
        return "OpenRouter credits low or exhausted (402) — the owner should top up the scoped key";
      case "rate-limit":
        return "rate limited (429) — back off and retry";
      case "network":
        return "network failure reaching openrouter.ai";
      default:
        return `OpenRouter error${this.status !== null ? ` (HTTP ${this.status})` : ""}`;
    }
  }
}

function classifyStatus(status: number): OpenRouterError["classif"] {
  if (status === 401 || status === 403) return "invalid-key";
  if (status === 402) return "credits";
  if (status === 429) return "rate-limit";
  if (status >= 500) return "server";
  return "unknown";
}

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } | string };
    if (typeof j.error === "string") return j.error;
    if (j.error && typeof j.error.message === "string") return j.error.message;
  } catch {
    /* non-JSON error body */
  }
  return `HTTP ${res.status}`;
}

export interface ChatOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  messages: WireMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
  temperature?: number;
  /**
   * deepseek-v4.1-flash is a reasoning model: with reasoning on, small
   * max_tokens get eaten by hidden chain-of-thought and content comes back
   * null (live-verified). The deck runs reasoning OFF by default — flash-
   * class tool calling needs no hidden CoT, and spend caps stay predictable.
   * The §7.11 native-reasoning toggle (per-model, opt-in) turns it ON: the
   * structured `reasoning` field is surfaced verbatim — never `<think>`
   * string-munging — and reasoning tokens are BILLED (stated in settings).
   */
  reasoning?: boolean;
  signal?: AbortSignal;
  /** fetch injectable for tests */
  fetchImpl?: typeof fetch;
}

export async function chatCompletion(opts: ChatOptions): Promise<AssistantTurn> {
  const f = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl ?? OPENROUTER_BASE}/chat/completions`;
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: false,
  };
  if (opts.tools !== undefined && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.reasoning !== undefined) body.reasoning = { enabled: opts.reasoning };

  let res: Response;
  try {
    res = await f(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // the key rides only this header — never into any log or journal
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
  } catch (e) {
    if (opts.signal?.aborted) throw new OpenRouterError("network", "aborted", null);
    throw new OpenRouterError("network", e instanceof Error ? e.message : String(e), null);
  }
  if (!res.ok) {
    throw new OpenRouterError(classifyStatus(res.status), await parseErrorBody(res), res.status);
  }
  const j = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null; reasoning?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string | null }>;
    usage?: Usage;
  };
  const choice = j.choices?.[0];
  return {
    text: choice?.message?.content ?? null,
    // the structured field only — no <think> regex munging (§7.11)
    reasoning: typeof choice?.message?.reasoning === "string" && choice.message.reasoning.length > 0 ? choice.message.reasoning : null,
    toolCalls: choice?.message?.tool_calls ?? [],
    finishReason: choice?.finish_reason ?? null,
    usage: j.usage ?? null,
  };
}

// ---- the streaming completion path (session-75) ----

/**
 * One yielded frame of the streaming path: `text`/`reasoning` carry the
 * INCREMENTAL fragment exactly as the provider chunked it; the stream ends
 * with exactly one `turn` frame — the fully-assembled AssistantTurn (the
 * finalized message; usage + finish_reason arrive in the tail chunks).
 */
export type StreamEvent =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "turn"; turn: AssistantTurn };

/**
 * A rejected-promise tripwire so a STALLED body still aborts on the signal
 * (a real undici fetch ties its body stream to the signal; a test/fake
 * Response does not — the race makes both behave identically).
 */
function abortTripwire(signal: AbortSignal | undefined): Promise<never> | null {
  if (signal === undefined) return null;
  return new Promise((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * The streaming chat completion (session-75, the SETTINGS per-model
 * `streamingModels` opt-in): the same wire request with `stream: true`,
 * answered as SSE. Yields the content/reasoning fragments as they arrive
 * and finishes with the assembled turn — billing is IDENTICAL to the
 * non-streaming call (cost honesty: the toggle never changes spend, and
 * STOP mid-generation still burns the tokens already produced).
 */
export async function* chatCompletionStream(opts: ChatOptions): AsyncGenerator<StreamEvent, void, void> {
  const f = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl ?? OPENROUTER_BASE}/chat/completions`;
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
  };
  if (opts.tools !== undefined && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.reasoning !== undefined) body.reasoning = { enabled: opts.reasoning };

  let res: Response;
  try {
    res = await f(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
  } catch (e) {
    if (opts.signal?.aborted) throw new OpenRouterError("network", "aborted", null);
    throw new OpenRouterError("network", e instanceof Error ? e.message : String(e), null);
  }
  if (!res.ok) {
    throw new OpenRouterError(classifyStatus(res.status), await parseErrorBody(res), res.status);
  }
  if (res.body === null) {
    throw new OpenRouterError("server", "the stream response carried no body", res.status);
  }

  let text = "";
  let reasoning: string | null = null;
  let finishReason: string | null = null;
  let usage: Usage | null = null;
  // tool calls stream as INDEXED fragments: id + function.name on the first,
  // function.arguments appended across the rest — assembled by index
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();

  function* handleLine(raw: string): Generator<StreamEvent> {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith(":")) return; // keep-alive comments
    if (!line.startsWith("data:")) return; // event:/id:/retry: — ignored
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;
    let j: {
      choices?: Array<{ delta?: { content?: string | null; reasoning?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } } | null> } | null; finish_reason?: string | null }>;
      usage?: Usage;
    };
    try {
      j = JSON.parse(data) as typeof j;
    } catch {
      return; // a malformed frame never kills a nearly-complete stream
    }
    const choice = j.choices?.[0];
    const delta = choice?.delta;
    if (typeof delta?.content === "string" && delta.content.length > 0) {
      text += delta.content;
      yield { kind: "text", text: delta.content };
    }
    if (typeof delta?.reasoning === "string" && delta.reasoning.length > 0) {
      reasoning = (reasoning as string | null ?? "") + delta.reasoning;
      yield { kind: "reasoning", text: delta.reasoning };
    }
    if (Array.isArray(delta?.tool_calls)) {
      for (const tc of delta.tool_calls) {
        if (tc === null || typeof tc !== "object") continue;
        const idx = typeof tc.index === "number" ? tc.index : 0;
        const cur = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
        if (typeof tc.id === "string" && tc.id.length > 0) cur.id = tc.id;
        if (typeof tc.function?.name === "string" && tc.function.name.length > 0) cur.name = tc.function.name;
        if (typeof tc.function?.arguments === "string") cur.args += tc.function.arguments;
        toolAcc.set(idx, cur);
      }
    }
    if (typeof choice?.finish_reason === "string" && choice.finish_reason.length > 0) finishReason = choice.finish_reason;
    if (j.usage !== undefined && typeof j.usage.total_tokens === "number") usage = j.usage;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const tripwire = abortTripwire(opts.signal);
  try {
    let doneSentinel = false;
    readLoop: for (;;) {
      const read = reader.read();
      const step = tripwire !== null ? await Promise.race([read, tripwire]) : await read;
      if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
      if (step.done) break;
      buf += decoder.decode(step.value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        yield* handleLine(line);
        if (line.trim() === "data: [DONE]") {
          doneSentinel = true;
          break readLoop;
        }
      }
    }
    if (!doneSentinel) {
      // a trailing frame without its newline still counts
      yield* handleLine(buf.replace(/\r$/, ""));
    }
  } catch (e) {
    if (opts.signal?.aborted || (e instanceof Error && e.name === "AbortError")) {
      throw new OpenRouterError("network", "aborted", null);
    }
    throw new OpenRouterError("network", e instanceof Error ? e.message : String(e), null);
  } finally {
    void reader.cancel().catch(() => {
      /* already closed/errored — nothing to release */
    });
  }

  yield {
    kind: "turn",
    turn: {
      text: text.length > 0 ? text : null,
      // TS cannot see the handleLine mutations (the closure-narrowing trap) —
      // widen the tracker reads at the seam
      reasoning: (reasoning as string | null) !== null && (reasoning as string | null)!.length > 0 ? (reasoning as string | null) : null,
      toolCalls: [...toolAcc.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => ({ id: v.id, type: "function" as const, function: { name: v.name, arguments: v.args } })),
      finishReason,
      usage,
    },
  };
}

export interface ModelInfo {
  id: string;
  name: string | null;
  contextLength: number | null;
}

export async function fetchModels(opts: { baseUrl?: string; fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): Promise<ModelInfo[]> {
  const f = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl ?? OPENROUTER_BASE}/models`;
  let res: Response;
  try {
    res = await f(url, { method: "GET", ...(opts.signal !== undefined ? { signal: opts.signal } : {}) });
  } catch (e) {
    throw new OpenRouterError("network", e instanceof Error ? e.message : String(e), null);
  }
  if (!res.ok) throw new OpenRouterError(classifyStatus(res.status), await parseErrorBody(res), res.status);
  const j = (await res.json()) as {
    data?: Array<{ id?: string; name?: string; context_length?: number }>;
  };
  const out: ModelInfo[] = [];
  for (const m of j.data ?? []) {
    if (typeof m.id === "string" && m.id.length > 0) {
      out.push({ id: m.id, name: typeof m.name === "string" ? m.name : null, contextLength: typeof m.context_length === "number" ? m.context_length : null });
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export interface KeyInfo {
  label: string | null;
  usage: number | null;
  limit: number | null;
  isFreeTier: boolean | null;
}

/**
 * Best-effort credit probe (the "tell the owner when credits run low" rule):
 * usage/limit in the provider's own credit denomination, surfaced raw —
 * never converted into any pseudo-USD price display for chain figures.
 */
export async function fetchKeyInfo(opts: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch; signal?: AbortSignal }): Promise<KeyInfo> {
  const f = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl ?? OPENROUTER_BASE}/key`;
  let res: Response;
  try {
    res = await f(url, { method: "GET", headers: { Authorization: `Bearer ${opts.apiKey}` }, ...(opts.signal !== undefined ? { signal: opts.signal } : {}) });
  } catch (e) {
    throw new OpenRouterError("network", e instanceof Error ? e.message : String(e), null);
  }
  if (!res.ok) throw new OpenRouterError(classifyStatus(res.status), await parseErrorBody(res), res.status);
  const j = (await res.json()) as { data?: { label?: string; usage?: number; limit?: number | null; is_free_tier?: boolean } };
  return {
    label: typeof j.data?.label === "string" ? j.data.label : null,
    usage: typeof j.data?.usage === "number" ? j.data.usage : null,
    limit: typeof j.data?.limit === "number" ? j.data.limit : null,
    isFreeTier: typeof j.data?.is_free_tier === "boolean" ? j.data.is_free_tier : null,
  };
}
