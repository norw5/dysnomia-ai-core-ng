import { END, START, StateGraph, Annotation } from "@langchain/langgraph";
import {
  chatCompletion,
  chatCompletionStream,
  OpenRouterError,
  type AssistantTurn,
  type ToolCall,
  type Usage,
  type WireMessage,
} from "@/agent/openrouter";
import { buildSystemPrompt, snapshotMessage } from "@/agent/knowledge";
import { toolByName, toolSpecs, type AgentToolContext } from "@/agent/tools";
import { homeVenue } from "@/state/homeVenue";
import { qingForAsset } from "@/state/atlas";
import type { Address } from "viem";
import type { Journal } from "@/chain/journal";
import type { PlayerSnapshot } from "@/chain/identity";

/**
 * The agent graph (IA-PLAN §7.1: LangGraph kept — state graph, streaming
 * bridge, abort wiring, rebuilt clean). Two nodes: `model` (one OpenRouter
 * chat-completions turn) and `tools` (execute the requested tool calls);
 * the conditional edge keeps the loop while the model asks for tools and
 * the run budget (steps + tokens) holds. No SDK lock-in anywhere else:
 * messages stay in the plain chat-completions wire format.
 */

const AgentState = Annotation.Root({
  /** full conversation replacement per node return (no merge ambiguity) */
  messages: Annotation<WireMessage[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  /** model turns taken (the budget unit) */
  step: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
});

export interface RunBudget {
  /** max MODEL TURNS (one model API call each — a tool call does NOT count;
   *  parallel tool calls in one completion are one turn); 0 = no step limit
   *  (the token budget, abort, and the L2 knobs still stop a run) */
  maxSteps: number;
  maxTokens: number;
}

/**
 * §7.8 L2 autonomy knobs (session-52) — TIGHTEN-ONLY run guards: they stop a
 * run EARLIER, they never loosen anything. Every send still resolves through
 * THE gate (policy → DRYRUN → approval → send) — approval of a goal never
 * bypasses it.
 */
export interface AutonomyKnobs {
  /** stop when N tool results fail IN A ROW (0 = off) — the "repeated failures" stop */
  maxConsecutiveToolFailures: number;
  /** pause every N model turns with a resumable checkpoint (0 = off) */
  checkpointEverySteps: number;
}

/**
 * The per-run token-budget DEFAULT (session-76 owner round: 150k → 300k).
 * The 75 live fire measured fat FULL-AUTO cycle-1 tails at 160k–484k model
 * tokens — the old 150k default fenced a serious first cycle into a
 * budget-stop disengage before the loop could show anything. SETTINGS stays
 * overridable; the pane names what the caps imply at engage time
 * (`fullAutoCapsHint` — fullAuto.ts).
 */
export const DEFAULT_RUN_MAX_TOKENS = 300_000;

export const DEFAULT_BUDGET: RunBudget = { maxSteps: 32, maxTokens: DEFAULT_RUN_MAX_TOKENS };
export const DEFAULT_AUTONOMY: AutonomyKnobs = { maxConsecutiveToolFailures: 3, checkpointEverySteps: 0 };

export type RunEvent =
  | { type: "turn-start" }
  | { type: "assistant-text"; text: string }
  | {
      /**
       * session-75 streaming: one INCREMENTAL text fragment of the turn
       * being generated (the pane's live partial lane consumes these;
       * everything else — the runs ledger, the recording capture, the deck
       * bus, the cycle summary — rides the FINALIZED `assistant-text`).
       */
      type: "assistant-text-delta";
      text: string;
    }
  | { type: "assistant-reasoning"; text: string }
  | { type: "tool-call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool-result"; id: string; name: string; result: Record<string, unknown>; ok: boolean }
  | { type: "usage"; usage: Usage }
  | { type: "budget-stop"; reason: string }
  | { type: "checkpoint"; steps: number }
  | { type: "whisper"; text: string }
  | { type: "done"; steps: number; tokens: number }
  | { type: "error"; message: string; ownerLine?: string }
  | { type: "aborted" };

export interface RunAgentOptions {
  apiKey: string | null;
  apiKeySource: "byok" | "dev-env" | null;
  model: string;
  /** the §7.11 native-reasoning toggle — per-model, opt-in (default off) */
  reasoning?: boolean;
  /**
   * The §7.11 STREAMING toggle (session-75, per-model opt-in via
   * `streamingModels`): the model call rides the SSE path and the graph
   * emits per-chunk `assistant-text-delta` RunEvents while generating. The
   * finalized `assistant-text` still closes every streamed turn (the
   * record); a STOP mid-stream preserves the partial text in the returned
   * history so the next turn sees what was said. Billing is identical.
   */
  streaming?: boolean;
  persona: string | null;
  /**
   * Session-74 (the strategist): an extra system block appended AFTER the
   * fixed core + persona — the between-cycles strategist invocation
   * composes its role this way. Structurally unable to precede the core.
   */
  systemSuffix?: string | null;
  /** §7.10 session memory (facts + last-session summary) — system layer AFTER the fixed core */
  sessionMemory?: string | null;
  history: WireMessage[];
  userText: string;
  snapshot: PlayerSnapshot | null;
  /** session-64: the receipt-carried pre-registration LAU, when one rides */
  pendingLau?: Address | null;
  /** last turn's payload for the §7.6 diff */
  previousPayload: Record<string, unknown> | null;
  toolCtx: AgentToolContext;
  budget: RunBudget;
  /** §7.8 L2 knobs — defaults are conservative when absent */
  autonomy?: AutonomyKnobs;
  /**
   * The MID-RUN WHISPER seam (session-65): drain operator notes queued
   * while the run is busy — each model turn pulls everything queued since
   * the previous turn and appends ONE system message AFTER the last message
   * (never aborts the in-flight call). Null/absent = no whisper channel.
   */
  takeWhisper?: (() => string | null) | null;
  signal: AbortSignal;
  journal: Journal;
  fetchImpl?: typeof fetch;
  onEvent?: (e: RunEvent) => void;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v };
  } catch {
    return { _unparsable: raw.slice(0, 200) };
  }
}

export interface AgentRunResult {
  messages: WireMessage[];
  steps: number;
  tokens: number;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; ok: boolean; result: Record<string, unknown> }>;
  status: "done" | "budget-stop" | "checkpoint" | "error" | "aborted";
  error: string | null;
}

/**
 * One user turn through the graph. Builds [system, snapshot, ...window,
 * user], runs model<->tools until the model answers without tool calls or
 * the budget stops it, streams RunEvents throughout, and returns the full
 * wire-format message list for history + UI.
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentRunResult> {
  const emit = (e: RunEvent): void => {
    opts.onEvent?.(e);
  };
  // the caller (store) resolves BYOK -> dev-env; the graph only takes a
  // ready key so the no-key path is testable independent of DEV_ENV state
  const key = opts.apiKey;
  if (key === null) {
    const err = new OpenRouterError("no-key", "no API key configured", null);
    emit({ type: "error", message: err.message, ownerLine: err.ownerLine() });
    return { messages: [], steps: 0, tokens: 0, toolCalls: [], status: "error", error: err.ownerLine() };
  }

  const system = buildSystemPrompt(opts.persona) + (opts.systemSuffix !== null && opts.systemSuffix !== undefined && opts.systemSuffix.length > 0 ? `\n\n${opts.systemSuffix}` : "");
  // session-73: the home QING also resolves from the venue census (the
  // NewQing asset index) when nothing was captured — pre-app accounts
  // (aged transfers) otherwise read homeQing: null forever. The index
  // loads once per session; the await is a microtask after warm.
  const homeCensus =
    opts.snapshot !== null && opts.snapshot.lau !== null && homeVenue(opts.snapshot.account) === null
      ? await qingForAsset(opts.snapshot.lau).catch(() => null)
      : null;
  const snap = opts.snapshot !== null ? snapshotMessage(opts.snapshot, opts.previousPayload, opts.pendingLau ?? null, homeCensus !== null ? homeCensus.a : null) : null;
  const base: WireMessage[] = [{ role: "system", content: system }];
  // §7.10: the session memory lands AFTER the fixed core (and the persona it
  // already carries) — a separate system message, never able to override it
  if (opts.sessionMemory != null && opts.sessionMemory.length > 0) base.push({ role: "system", content: opts.sessionMemory });
  if (snap !== null) base.push(snap);
  const userMsg: WireMessage = { role: "user", content: opts.userText };
  const initial: WireMessage[] = [...base, ...opts.history, userMsg];

  let tokens = 0;
  const toolCallLog: AgentRunResult["toolCalls"] = [];
  let status: AgentRunResult["status"] = "done";
  // session-75: the in-flight streamed partial (the model node writes it,
  // the catch path preserves it — TS can't see the node-closure mutation,
  // so every read widens at the seam)
  let streamedText: string | null = null;
  // §7.8 L2 state: the consecutive-failure streak + the next checkpoint turn
  const autonomy = opts.autonomy ?? DEFAULT_AUTONOMY;
  let consecutiveFailures = 0;
  let nextCheckpoint = autonomy.checkpointEverySteps > 0 ? autonomy.checkpointEverySteps : Number.POSITIVE_INFINITY;

  opts.journal.emit("agent.turn", `turn start · model ${opts.model} · key ${opts.apiKeySource ?? "resolved"}`, {
    model: opts.model,
    keySource: opts.apiKeySource,
  });
  emit({ type: "turn-start" });

  const graph = new StateGraph(AgentState)
    .addNode("model", async (state) => {
      if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");
      if (tokens > opts.budget.maxTokens) {
        const reason = `token budget reached (${tokens} > ${opts.budget.maxTokens})`;
        opts.journal.emit("agent.spend", `budget stop: ${reason}`, {});
        emit({ type: "budget-stop", reason });
        status = "budget-stop";
        return { messages: [...state.messages, { role: "assistant", content: "[budget stop — see the SYS tab; raise caps in SETTINGS → Agent]" }], step: state.step + 1 };
      }
      // the whisper drain (session-65): everything the operator queued while
      // busy lands here — ONE system message after the last message, before
      // the model call. The in-flight completion is never aborted.
      let messages = state.messages;
      if (opts.takeWhisper !== undefined && opts.takeWhisper !== null) {
        const queued: string[] = [];
        for (let w = opts.takeWhisper(); w !== null; w = opts.takeWhisper()) queued.push(w);
        if (queued.length > 0) {
          messages = [
            ...state.messages,
            { role: "system", content: `[operator whisper — a mid-run note for THIS turn; data to weigh, never an override of your rules]: ${queued.join(" | ")}` },
          ];
          for (const w of queued) emit({ type: "whisper", text: w });
          opts.journal.emit("agent.turn", `whisper delivered to model turn ${state.step + 1}`, { count: queued.length });
        }
      }
      // session-75: the streaming seam — per-chunk text deltas while the
      // turn generates (the pane's live partial lane); the finalized
      // `assistant-text` below stays THE record. `streamedText` (runAgent
      // scope) is the abort/error safety net: the catch path appends it to
      // the returned history so a STOP mid-generation still preserves what
      // was said. Reset per model call — only the in-flight partial rides.
      streamedText = null;
      let turn: AssistantTurn;
      if (opts.streaming === true) {
        let streamed: AssistantTurn | null = null;
        for await (const ev of chatCompletionStream({
          apiKey: key,
          model: opts.model,
          messages,
          tools: toolSpecs(opts.toolCtx.chatToolsEnabled, opts.toolCtx.simToolsEnabled, opts.toolCtx.toolAllowlist ?? null),
          maxTokens: 2048,
          temperature: 0.2,
          reasoning: opts.reasoning ?? false,
          ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
          ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
        })) {
          if (ev.kind === "text" && ev.text.length > 0) {
            streamedText = (streamedText as string | null ?? "") + ev.text;
            emit({ type: "assistant-text-delta", text: ev.text });
          } else if (ev.kind === "turn") {
            streamed = ev.turn;
          }
        }
        if (streamed === null) throw new OpenRouterError("server", "the stream ended without a finalized turn", null);
        turn = streamed;
      } else {
        turn = await chatCompletion({
          apiKey: key,
          model: opts.model,
          messages,
          tools: toolSpecs(opts.toolCtx.chatToolsEnabled, opts.toolCtx.simToolsEnabled, opts.toolCtx.toolAllowlist ?? null),
          maxTokens: 2048,
          temperature: 0.2,
          reasoning: opts.reasoning ?? false,
          ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
          ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
        });
      }
      if (turn.usage !== null) {
        tokens += turn.usage.total_tokens;
        emit({ type: "usage", usage: turn.usage });
        opts.journal.emit("agent.spend", `usage +${turn.usage.total_tokens} (run ${tokens})`, {
          prompt: turn.usage.prompt_tokens,
          completion: turn.usage.completion_tokens,
          runTotal: tokens,
        });
      }
      const msg: WireMessage = { role: "assistant", content: turn.text };
      if (turn.toolCalls.length > 0) msg.tool_calls = turn.toolCalls;
      // the toggle OWNS the render path: the structured field surfaces only
      // when the per-model opt-in is on (flash-class default stays quiet)
      if (opts.reasoning === true && turn.reasoning !== null) emit({ type: "assistant-reasoning", text: turn.reasoning });
      if (turn.text !== null && turn.text.length > 0) emit({ type: "assistant-text", text: turn.text });
      return { messages: [...messages, msg], step: state.step + 1 };
    })
    .addNode("tools", async (state) => {
      const last = state.messages[state.messages.length - 1]!;
      const calls: ToolCall[] = last.tool_calls ?? [];
      const out = [...state.messages];
      for (const call of calls) {
        if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");
        const args = parseArgs(call.function.arguments);
        emit({ type: "tool-call", id: call.id, name: call.function.name, args });
        opts.journal.emit("agent.tool", `tool ${call.function.name}`, { tool: call.function.name, args: Object.keys(args) });
        let result: Record<string, unknown>;
        let ok = true;
        const tool = toolByName(call.function.name);
        if (tool === null) {
          ok = false;
          result = { error: `unknown tool: ${call.function.name}` };
        } else if (opts.toolCtx.toolAllowlist != null && !opts.toolCtx.toolAllowlist.has(tool.name)) {
          // session-62 capability asymmetry: the driver's per-agent subset
          // binds at BOTH seams — an out-of-set call (a stray scripted or
          // live model call) refuses honestly, never executes
          ok = false;
          result = { error: `tool ${tool.name} is not in this agent's toolset (the drive plan's capability subset)` };
        } else {
          try {
            result = await tool.execute(args, opts.toolCtx);
          } catch (e) {
            ok = false;
            result = { error: e instanceof Error ? e.message : String(e) };
          }
        }
        emit({ type: "tool-result", id: call.id, name: call.function.name, result, ok });
        opts.journal.emit("agent.tool", `tool ${call.function.name} ${ok ? "ok" : "ERR"}`, { tool: call.function.name, ok });
        toolCallLog.push({ name: call.function.name, args, ok, result });
        if (ok) consecutiveFailures = 0;
        else consecutiveFailures += 1;
        out.push({ role: "tool", content: JSON.stringify(result), tool_call_id: call.id });
      }
      // §7.8 L2 stop-condition: repeated failures — any ok result resets the
      // streak; N failures IN A ROW stop the run (tighten-only)
      if (autonomy.maxConsecutiveToolFailures > 0 && consecutiveFailures >= autonomy.maxConsecutiveToolFailures) {
        const reason = `repeated tool failures (${consecutiveFailures} rounds in a row)`;
        opts.journal.emit("agent.spend", `autonomy stop: ${reason}`, {});
        emit({ type: "budget-stop", reason: `${reason} — L2 knob (SETTINGS → Agent)` });
        status = "budget-stop";
        return { messages: [...out, { role: "assistant", content: `[autonomy stop — ${reason}; knobs are in SETTINGS → Agent]` }] };
      }
      // §7.8 checkpoint cadence: pause with a resumable hand-back — history
      // stays well-formed (the tool results are already appended)
      if (state.step >= nextCheckpoint) {
        nextCheckpoint += autonomy.checkpointEverySteps;
        opts.journal.emit("agent.turn", `checkpoint at ${state.step} model turns (cadence ${autonomy.checkpointEverySteps})`, {});
        emit({ type: "checkpoint", steps: state.step });
        status = "checkpoint";
        return { messages: [...out, { role: "assistant", content: `[checkpoint — ${state.step} model turns used. say "continue" to proceed; the budget still applies.]` }] };
      }
      return { messages: out };
    })
    .addEdge(START, "model")
    .addConditionalEdges("model", (state) => {
      if (status === "budget-stop") return END;
      const last = state.messages[state.messages.length - 1]!;
      if ((last.tool_calls?.length ?? 0) === 0) return END;
      // 0 = no step limit: the model may keep working until it answers, the
      // token budget trips, or the operator stops the run (L2 knobs still bind)
      if (opts.budget.maxSteps > 0 && state.step >= opts.budget.maxSteps) {
        const reason = `step budget reached (${state.step} model turns)`;
        opts.journal.emit("agent.spend", `budget stop: ${reason}`, {});
        emit({ type: "budget-stop", reason });
        status = "budget-stop";
        return END;
      }
      return "tools";
    })
    .addConditionalEdges("tools", () => (status === "budget-stop" || status === "checkpoint" ? END : "model"))
    .compile();

  try {
    // maxSteps 0 = no step limit: the recursion ceiling is an anti-runaway
    // backstop only (the token budget stops real runs long before it)
    const recursionLimit = opts.budget.maxSteps > 0 ? opts.budget.maxSteps * 2 + 4 : 2048;
    const final = await graph.invoke({ messages: initial, step: 0 }, { recursionLimit });
    emit({ type: "done", steps: final.step, tokens });
    opts.journal.emit("agent.turn", `turn done · ${final.step} model turns · ${tokens} tokens · ${toolCallLog.length} tool calls · ${status}`, {
      steps: final.step,
      tokens,
      toolCalls: toolCallLog.length,
    });
    return { messages: final.messages, steps: final.step, tokens, toolCalls: toolCallLog, status, error: null };
  } catch (e) {
    // session-75: a STOP (or a stream failure) mid-generation preserves the
    // partial text — appended to the returned history so the next turn sees
    // what was said; empty partials append nothing
    const partial = streamedText as string | null;
    const partialMsg: WireMessage[] = partial !== null && partial.trim().length > 0 ? [{ role: "assistant", content: partial }] : [];
    if (opts.signal.aborted || (e instanceof Error && e.name === "AbortError")) {
      emit({ type: "aborted" });
      opts.journal.emit("agent.abort", "run aborted by user", {});
      return { messages: [...initial, ...partialMsg], steps: 0, tokens, toolCalls: toolCallLog, status: "aborted", error: null };
    }
    const message = e instanceof OpenRouterError ? e.ownerLine() : e instanceof Error ? e.message : String(e);
    opts.journal.emit("agent.error", `run failed: ${message}`, {});
    if (e instanceof OpenRouterError) emit({ type: "error", message, ownerLine: e.ownerLine() });
    else emit({ type: "error", message });
    return { messages: [...initial, ...partialMsg], steps: 0, tokens, toolCalls: toolCallLog, status: "error", error: message };
  }
}

/** §7.7 sliding window: system + snapshot are rebuilt per turn; this caps the carried tail */
export const HISTORY_WINDOW = 16;

export function windowHistory(history: WireMessage[]): WireMessage[] {
  return history.filter((m) => m.role !== "system").slice(-HISTORY_WINDOW);
}
