import type { Journal, JournalEvent } from "@/chain/journal";
import type { GateEnvelope } from "@/chain/txGate";
import type { WireMessage } from "@/agent/openrouter";
import { DEFAULT_RUN_MAX_TOKENS } from "@/agent/graph";
import { toolByName } from "@/agent/tools";

/**
 * The headless fleet driver's pure machinery (session 61, the owner round:
 * HEADLESS-DRIVE + OBSERVER). The entry (entry.ts) composes these with the
 * SAME app stack — runAgent + the tool catalog + THE gate — imported, never
 * re-implemented. Three seams live here so they are unit-testable:
 *
 *  - the DRIVE PLAN schema (the manifest policy block the python
 *    harbormaster emits — the RECORDED operator consent the approval
 *    callback honors; a DRIVER choice, never a gate bypass: the gate still
 *    classifies, DRYRUNs, meters and journals every send);
 *  - the SCRIPTED FETCH seam (deterministic harness runs): the model rides
 *    the real chatCompletion adapter, answered at the fetch boundary — the
 *    graph, budgets, tools and gate all run for real;
 *  - the recorded-approval decider (which risk classes the policy file
 *    auto-acks; privileged/value sends refuse honestly).
 */

export interface DriveAutoApprove {
  standard: boolean;
  unknownContract: boolean;
  privileged: boolean;
  value: boolean;
}

/** the manifest policy block — the app's SETTINGS → Agent knobs mirrored headless (TIGHTEN-ONLY there) */
export interface DrivePolicy {
  model: string;
  reasoning: boolean;
  maxSteps: number;
  maxTokens: number;
  maxAgentTxPerRun: number;
  maxConsecutiveToolFailures: number;
  checkpointEverySteps: number;
  /** the §7.4 opt-in, recorded per run by the operator */
  chatToolsEnabled: boolean;
  autoApprove: DriveAutoApprove;
}

export interface DriveRosterRow {
  name: string;
  address: string;
  lau: string | null;
  yue: string | null;
  vessel: string;
  /** the ephemeral LOCAL-FORK burner key (anvil-lifetime only, never in outputs) */
  key: string;
  persona: string | null;
  /**
   * The per-agent tool subset (session-62 flagship: the capability
   * asymmetry). null/absent = the full catalog; an array = the ONLY tools
   * advertised + executable for this agent (the ctx allowlist honors it at
   * both seams). Unknown names refuse the plan honestly — a typo'd subset
   * would silently disarm an agent.
   */
  tools: string[] | null;
}

export interface DriveTurn {
  agent: string;
  prompt: string;
}

export interface DrivePlan {
  rpc: string;
  forkBlock: number | null;
  /** the venue the in-memory current-venue store points at (chat/venue tools) */
  venue: string | null;
  policy: DrivePolicy;
  roster: DriveRosterRow[];
  turns: DriveTurn[];
}

export const DEFAULT_DRIVE_POLICY: DrivePolicy = {
  model: "deepseek/deepseek-v4.1-flash",
  reasoning: false,
  maxSteps: 32,
  maxTokens: DEFAULT_RUN_MAX_TOKENS,
  maxAgentTxPerRun: 4,
  maxConsecutiveToolFailures: 3,
  checkpointEverySteps: 0,
  chatToolsEnabled: false,
  autoApprove: { standard: true, unknownContract: true, privileged: false, value: false },
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function bool(v: unknown, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}

function num(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : d;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export class DrivePlanError extends Error {
  constructor(reason: string) {
    super(`invalid drive plan: ${reason}`);
    this.name = "DrivePlanError";
  }
}

export function parseDrivePlan(doc: unknown): DrivePlan {
  if (!isObj(doc)) throw new DrivePlanError("not an object");
  const rpc = str(doc["rpc"]);
  if (rpc === null) throw new DrivePlanError("rpc is required");
  const policyRaw = isObj(doc["policy"]) ? doc["policy"] : {};
  const autoRaw = isObj(policyRaw["autoApprove"]) ? policyRaw["autoApprove"] : {};
  const policy: DrivePolicy = {
    model: str(policyRaw["model"]) ?? DEFAULT_DRIVE_POLICY.model,
    reasoning: bool(policyRaw["reasoning"], false),
    maxSteps: num(policyRaw["maxSteps"], DEFAULT_DRIVE_POLICY.maxSteps), // explicit 0 = no step limit
    maxTokens: num(policyRaw["maxTokens"], DEFAULT_DRIVE_POLICY.maxTokens) || DEFAULT_DRIVE_POLICY.maxTokens,
    maxAgentTxPerRun: num(policyRaw["maxAgentTxPerRun"], DEFAULT_DRIVE_POLICY.maxAgentTxPerRun),
    maxConsecutiveToolFailures: num(policyRaw["maxConsecutiveToolFailures"], DEFAULT_DRIVE_POLICY.maxConsecutiveToolFailures) || 3,
    checkpointEverySteps: num(policyRaw["checkpointEverySteps"], 0),
    chatToolsEnabled: bool(policyRaw["chatToolsEnabled"], false),
    autoApprove: {
      standard: bool(autoRaw["standard"], true),
      unknownContract: bool(autoRaw["unknownContract"], true),
      privileged: bool(autoRaw["privileged"], false),
      value: bool(autoRaw["value"], false),
    },
  };
  if (!Array.isArray(doc["roster"]) || doc["roster"].length === 0) throw new DrivePlanError("roster is required");
  const roster: DriveRosterRow[] = [];
  for (const row of doc["roster"]) {
    if (!isObj(row)) throw new DrivePlanError("roster row malformed");
    const name = str(row["name"]);
    const address = str(row["address"]);
    const key = str(row["key"]);
    if (name === null || address === null || key === null) throw new DrivePlanError("roster rows need name/address/key");
    let tools: string[] | null = null;
    if (row["tools"] !== undefined && row["tools"] !== null) {
      if (!Array.isArray(row["tools"]) || row["tools"].length === 0 || row["tools"].some((t) => typeof t !== "string" || t.length === 0)) {
        throw new DrivePlanError(`roster row ${name}: tools must be a non-empty string array (or absent for the full catalog)`);
      }
      tools = (row["tools"] as string[]).map((t) => t);
      const unknown = tools.filter((t) => toolByName(t) === null);
      if (unknown.length > 0) throw new DrivePlanError(`roster row ${name}: unknown tools ${unknown.join(", ")}`);
    }
    roster.push({
      name,
      address,
      lau: str(row["lau"]),
      yue: str(row["yue"]),
      vessel: str(row["vessel"]) ?? "atropa",
      key,
      persona: str(row["persona"]),
      tools,
    });
  }
  if (!Array.isArray(doc["turns"]) || doc["turns"].length === 0) throw new DrivePlanError("turns are required");
  const turns: DriveTurn[] = [];
  for (const t of doc["turns"]) {
    if (!isObj(t)) throw new DrivePlanError("turn malformed");
    const agent = str(t["agent"]);
    const prompt = typeof t["prompt"] === "string" ? t["prompt"] : null;
    if (agent === null || prompt === null || prompt.length === 0) throw new DrivePlanError("turns need agent + prompt");
    if (!roster.some((r) => r.name === agent)) throw new DrivePlanError(`turn references unknown agent ${agent}`);
    turns.push({ agent, prompt });
  }
  return {
    rpc,
    forkBlock: typeof doc["forkBlock"] === "number" ? doc["forkBlock"] : null,
    venue: str(doc["venue"]),
    policy,
    roster,
    turns,
  };
}

// ---- the scripted fetch seam (deterministic harness runs) ----

export interface ScriptedToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ScriptedTurn {
  text: string | null;
  toolCalls: ScriptedToolCall[];
}

export class ScriptedFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptedFetchError";
  }
}

export function parseFetchScript(doc: unknown): ScriptedTurn[] {
  if (!isObj(doc) || !Array.isArray(doc["turns"])) throw new ScriptedFetchError("script needs a turns array");
  const out: ScriptedTurn[] = [];
  for (const t of doc["turns"]) {
    if (!isObj(t)) throw new ScriptedFetchError("script turn malformed");
    const calls: ScriptedToolCall[] = [];
    if (Array.isArray(t["toolCalls"])) {
      for (const c of t["toolCalls"]) {
        if (!isObj(c) || typeof c["name"] !== "string") throw new ScriptedFetchError("script toolCall malformed");
        calls.push({
          name: c["name"],
          args: isObj(c["args"]) ? (c["args"] as Record<string, unknown>) : {},
        });
      }
    }
    out.push({ text: typeof t["text"] === "string" ? t["text"] : null, toolCalls: calls });
  }
  return out;
}

/**
 * Build the fetchImpl answering chat/completions from the script,
 * positionally. The RESPONSE is a wire-format chat-completions body — the
 * real adapter parses it, so tool-call ids, usage accounting and the
 * finish-reason handling all run for real. Non-chat URLs fall through to
 * the real fetch (model-list probes etc.).
 */
export function scriptedChatFetch(script: ScriptedTurn[], state: { consumed: number }): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/chat/completions")) {
      return fetch(input as Parameters<typeof fetch>[0], init);
    }
    const turn = script[state.consumed];
    state.consumed += 1;
    if (turn === undefined) {
      return new Response(JSON.stringify({ error: { message: `script exhausted at model call ${state.consumed} (harness wrote too few turns)` } }), { status: 500 });
    }
    const toolCalls = turn.toolCalls.map((c, i) => ({
      id: `call_${state.consumed}_${i}`,
      type: "function",
      function: { name: c.name, arguments: JSON.stringify(c.args) },
    }));
    const body = {
      choices: [
        {
          message: {
            content: turn.text,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
        },
      ],
      usage: { prompt_tokens: 32, completion_tokens: 24, total_tokens: 56 },
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

// ---- the recorded-approval decider (the DRIVER choice seam) ----

/**
 * The approval callback the headless gate deps carry. It NEVER loosens the
 * gate: policy denial and sim failure still stop sends inside txGate — this
 * only answers the per-tx approval card, per the RECORDED policy block.
 * Unknown methods (a facts-less selector on a perimeter contract) refuse —
 * SIM-layer sends classify unknown-CONTRACT, which the block may ack.
 */
export function recordedApproval(auto: DriveAutoApprove, journal: Journal): (envelope: GateEnvelope) => Promise<boolean> {
  return async (envelope): Promise<boolean> => {
    const risk = envelope.cls.risk;
    const allow =
      risk === "standard" ? auto.standard : risk === "unknown-contract" ? auto.unknownContract : risk === "privileged" ? auto.privileged : risk === "value" ? auto.value : false;
    journal.emit("gate.approval", `headless approval ${allow ? "GRANTED" : "REJECTED"} (recorded policy · risk ${risk})`, { risk, allow });
    return allow;
  };
}

// ---- the headless journal (no IDB — the entry prints + the recording captures) ----

export class RunnerJournal implements Journal {
  private listeners = new Set<(e: JournalEvent) => void>();
  private nextId = 1;
  private quiet: boolean;

  constructor(quiet = false) {
    this.quiet = quiet;
  }

  emit(kind: JournalEvent["kind"], line: string, detail?: Record<string, unknown>): JournalEvent {
    const e: JournalEvent = { id: this.nextId++, t: Date.now(), kind, line, ...(detail !== undefined ? { detail } : {}) };
    if (!this.quiet) console.log(`[journal] ${kind} ${line}`);
    for (const fn of this.listeners) fn(e);
    return e;
  }

  subscribe(fn: (e: JournalEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  snapshot(): readonly JournalEvent[] {
    return [];
  }

  async wipe(): Promise<void> {}
}

// ---- session histories (the orchestrator shuttles them between invocations) ----

export interface DriveSession {
  histories: Record<string, WireMessage[]>;
}

export function emptySession(names: string[]): DriveSession {
  const histories: Record<string, WireMessage[]> = {};
  for (const n of names) histories[n] = [];
  return { histories };
}

export function parseSession(doc: unknown, names: string[]): DriveSession {
  if (!isObj(doc) || !isObj(doc["histories"])) return emptySession(names);
  const histories: Record<string, WireMessage[]> = {};
  for (const n of names) {
    const h = doc["histories"][n];
    histories[n] = Array.isArray(h) ? (h as WireMessage[]) : [];
  }
  return { histories };
}
