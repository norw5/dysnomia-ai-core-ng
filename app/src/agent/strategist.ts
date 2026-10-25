import { runAgent, type AgentRunResult } from "@/agent/graph";
import {
  STRATEGIST_MAX_STEPS,
  STRATEGIST_MAX_TOKENS,
  STRATEGIST_READ_TOOLS,
  STRATEGIST_SYSTEM_SUFFIX,
  parseStrategistGoal,
  strategistUserText,
} from "@/agent/fullAuto";
import type { AgentToolContext } from "@/agent/tools";
import type { PlayerSnapshot } from "@/chain/identity";
import type { Journal } from "@/chain/journal";
import type { FullAutoCycleRecord } from "@/agent/fullAuto";

/**
 * THE TWO-TIER STRATEGIST (session-74, the owner round — opt-in, default
 * OFF): one bounded call between FULL-AUTO cycles where a STRONGER model
 * (the operator's BYOK key, per-call model choice) with READ-ONLY tools
 * picks the next goal from the operator objective + the menu + the ledger
 * + PLAYER_STATE; the executor model keeps working the cycles. The flash
 * executor stays the DEFAULT path — any strategist error, budget-stop, or
 * missing GOAL: line falls back to kickoff self-goaling (the store seam
 * decides and says so honestly). Its tokens count toward the full-auto
 * session cap like any model burn while engaged.
 */

export interface StrategistInput {
  apiKey: string;
  apiKeySource: "byok" | "dev-env" | null;
  /** the stronger model (SETTINGS → Agent; the toggle + a non-empty id) */
  model: string;
  persona: string | null;
  objective: string | null;
  menu: string[] | null;
  menuCycle: number | null;
  /** the current engagement's ledger rows (the strategist reads the record) */
  ledger: FullAutoCycleRecord[];
  nextCycle: number;
  snapshot: PlayerSnapshot | null;
  /** the executor-grade ctx — the strategist OVERRIDES the allowlist to its
   * read-only set (act tools refuse at the execute seam even if scripted) */
  toolCtx: AgentToolContext;
  signal: AbortSignal;
  journal: Journal;
  fetchImpl?: typeof fetch;
}

export interface StrategistResult {
  /** the parsed GOAL: line — null = fall back to kickoff self-goaling */
  goal: string | null;
  tokens: number;
  steps: number;
  status: AgentRunResult["status"];
  error: string | null;
}

export async function runStrategist(input: StrategistInput): Promise<StrategistResult> {
  const result = await runAgent({
    apiKey: input.apiKey,
    apiKeySource: input.apiKeySource,
    model: input.model,
    persona: input.persona,
    systemSuffix: STRATEGIST_SYSTEM_SUFFIX,
    history: [],
    userText: strategistUserText({
      nextCycle: input.nextCycle,
      objective: input.objective,
      menu: input.menu,
      menuCycle: input.menuCycle,
      ledger: input.ledger,
    }),
    snapshot: input.snapshot,
    previousPayload: null,
    toolCtx: { ...input.toolCtx, toolAllowlist: STRATEGIST_READ_TOOLS },
    budget: { maxSteps: STRATEGIST_MAX_STEPS, maxTokens: STRATEGIST_MAX_TOKENS },
    signal: input.signal,
    journal: input.journal,
    ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
  });
  // the pick = the LAST GOAL: line in the strategist's final answer (a
  // fresh window: only its own turns are in messages)
  const lastAssistant = [...result.messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content !== null && m.content.trim().length > 0);
  const goal = parseStrategistGoal(lastAssistant?.content ?? null);
  return {
    goal,
    tokens: result.tokens,
    steps: result.steps,
    status: result.status,
    error:
      goal !== null
        ? null
        : result.status !== "done"
          ? `strategist call ended ${result.status}${result.error !== null ? ` — ${result.error}` : ""}`
          : "no GOAL: line in the strategist's answer",
  };
}
