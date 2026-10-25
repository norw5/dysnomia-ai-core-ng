import type { AgentRunResult } from "@/agent/graph";

/**
 * FULL-AUTO (session-65, the owner's questions 7+8): a mode-C opt-in loop
 * where the agent sets its own goal each cycle, works it, journals, and
 * picks the next — aggressively forward, stopped ONLY by the real fences:
 * spend caps (policy + L2 knobs surface as budget-stop), repeated failures
 * (the L2 streak knob), the operator's STOP, a dead chain, or the cycle
 * backstop below. Pure helpers — the loop itself lives in the store.
 *
 * Session-74 = THE STRATEGY LAYER on top: the persistent operator
 * OBJECTIVE (hybrid edit paths — pane field, SETTINGS, `objective:` whisper;
 * app-global persistence), the structured NEXT-GOALS MENU (the next_goals
 * tool's sanitized payload, ack-free advisory data re-fed to the next
 * kickoff), and the two-tier STRATEGIST constants (one bounded read-only
 * call between cycles — the invocation itself lives in agent/strategist.ts).
 */

/** cycle backstop DEFAULT (session-68: the operator sets the live value in
 * SETTINGS → Agent — the loop is long but never unbounded) */
export const FULL_AUTO_MAX_CYCLES = 12;

/** full-auto SESSION token cap DEFAULT (0 = off) — the session-68 fence:
 * cumulative model tokens burned while engaged bound the LOOP as a whole
 * (the per-run token budget still applies inside every cycle) */
export const FULL_AUTO_MAX_TOKENS = 500_000;

/**
 * The chat CADENCE GOVERNOR (§7.4 discipline in full-auto): min interval
 * between chat SENDS — no spray. Applies ONLY while full-auto is engaged;
 * every other mode stays task-driven (prompt discipline, no governor).
 */
export const FULL_AUTO_CHAT_MIN_INTERVAL_MS = 90_000;

/** the loop's stop/continue verdict — only a CLEAN done continues */
export function fullAutoContinues(
  status: AgentRunResult["status"],
  cyclesRun: number,
  maxCycles: number = FULL_AUTO_MAX_CYCLES
): { next: boolean; reason: string | null } {
  if (status === "aborted") return { next: false, reason: "operator STOP" };
  if (status === "budget-stop") return { next: false, reason: "spend/failure fence (budget-stop) — caps are the real fences" };
  if (status === "checkpoint") return { next: false, reason: "checkpoint pause — resume manually or re-engage" };
  if (status === "error") return { next: false, reason: "run error — the loop stops honestly" };
  if (cyclesRun >= maxCycles) return { next: false, reason: `cycle backstop (${maxCycles}) reached` };
  return { next: true, reason: null };
}

/** the SESSION token fence (session-68): cumulative tokens burned while
 * engaged — checked at every cycle boundary, AFTER the status fences (a
 * budget-stop already names the per-run cap). 0 = off. */
export function fullAutoTokenFence(cumulativeTokens: number, cap: number): { stop: boolean; reason: string | null } {
  if (cap > 0 && cumulativeTokens >= cap) {
    return { stop: true, reason: `full-auto session token cap (${cap}) reached — raise it in SETTINGS → Agent (0 = off)` };
  }
  return { stop: false, reason: null };
}

// ---- session-76 (the owner round): the engage-time CAPS MATH ----

/** the observed fat-cycle burn range across the 68/72/75 live fires
 * (160k–484k model tokens in ONE full-auto cycle; the 75 datum is the
 * 484k cycle-1 tail) — the calibration behind the raised 300k per-run
 * default and this hint's honesty */
export const FULL_AUTO_OBSERVED_CYCLE_TOKENS = "160k–484k";

function fmtTokensShort(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : Number(m.toFixed(1))}M`;
  }
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/**
 * What the CURRENT knobs imply in cycles, named BEFORE the operator
 * engages (the pane's disengaged hint line under the OBJECTIVE row). Pure
 * math over the three loop caps: the session cap ÷ the per-run budget is
 * the number of FULL-BUDGET cycles the cap buys (ceil — the fence fires at
 * the first boundary at/over the cap), the backstop is the ceiling, and
 * the observed range names what a fat cycle really costs — including that
 * a cycle past the run budget still ends in an honest budget-stop
 * disengage (the 300k default does NOT make that impossible: the 484k
 * datum exceeds it).
 */
export function fullAutoCapsHint(runTokens: number, sessionTokens: number, maxCycles: number): string {
  const run = Math.max(1, Math.floor(runTokens));
  const session = Math.max(0, Math.floor(sessionTokens));
  const backstop = Math.max(1, Math.floor(maxCycles));
  const fat = Math.max(1, Math.ceil(session / run));
  const head =
    session > 0
      ? fat >= backstop
        ? `FULL-AUTO caps: the ${backstop}-cycle backstop binds first (${fmtTokensShort(session)} session lasts past it at ${fmtTokensShort(run)}/run)`
        : `FULL-AUTO caps: ${fat} fat cycle${fat === 1 ? "" : "s"} at full burn (${fmtTokensShort(session)} session ÷ ${fmtTokensShort(run)}/run) to ${backstop} at the backstop`
      : `FULL-AUTO caps: backstop ${backstop} cycle${backstop === 1 ? "" : "s"}, no session cap (0 = off)`;
  return `${head} — observed fat cycles burn ${FULL_AUTO_OBSERVED_CYCLE_TOKENS}; a cycle past the ${fmtTokensShort(run)} run budget ends in an honest budget-stop disengage.`;
}

/** one completed full-auto cycle — the SYS ledger row (session-68). A
 * "disengage" row (kind) closes the ledger with the loop's reason. */
export interface FullAutoCycleRecord {
  n: number;
  kind: "run" | "plan" | "disengage";
  status: string;
  tokens: number;
  toolCalls: number;
  toolErrors: number;
  /** gate sends that landed "sent" in tool results this cycle */
  sends: number;
  summary: string | null;
  /**
   * Session-74: the structured NEXT-GOALS MENU this cycle closed with (the
   * next_goals tool's sanitized payload) — the strategy layer's
   * observability. Null when the cycle closed without one (and always null
   * on plan / disengage rows — the tool is fenced out of plans).
   */
  goals: string[] | null;
  t: number;
}

// ---- session-74: THE STRATEGY LAYER (the owner round — all four as
// recommended: hybrid objective, app-global persistence, ack-free menu,
// the strategist as a SETTINGS opt-in with kickoff self-goaling default) ----

/** the operator objective cap — operator-authored (the trusted party), so
 * only lightly sanitized: control-strip, whitespace-collapse, length */
export const OBJECTIVE_CAP = 240;

/** the menu shape: at most this many goals, each capped */
export const NEXT_GOALS_MAX = 5;
export const NEXT_GOAL_CAP = 120;

/** the strategist's pick cap (its GOAL: line) */
export const STRATEGIST_GOAL_CAP = 200;

/** the strategist call's tight budget (the owner round: one bounded call
 * between cycles — ≤ 6 model turns, ≤ 24k tokens) */
export const STRATEGIST_MAX_STEPS = 6;
export const STRATEGIST_MAX_TOKENS = 24_000;

/** the strategist's READ-ONLY toolset — no act tools, no chat, no plans */
export const STRATEGIST_READ_TOOLS: ReadonlySet<string> = new Set([
  "get_state",
  "get_venue",
  "search_venues",
  "get_lau",
  "read_contract",
  "search_kb",
  "explain",
]);

/** control-strip + whitespace-collapse (the runs.ts note idiom) */
function cleanLine(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
}

export function sanitizeObjective(raw: string): string | null {
  const clean = cleanLine(raw);
  if (clean.length === 0) return null;
  return clean.length <= OBJECTIVE_CAP ? clean : clean.slice(0, OBJECTIVE_CAP - 1) + "…";
}

/**
 * The next_goals payload sanitizer (the menu's fence): accepts the raw tool
 * args, keeps at most NEXT_GOALS_MAX one-line goals (first-wins on exact
 * duplicates), each control-stripped + whitespace-collapsed + capped. An
 * empty result means the call recorded nothing usable.
 */
export function sanitizeNextGoals(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= NEXT_GOALS_MAX) break;
    if (typeof item !== "string") continue;
    const clean = cleanLine(item);
    if (clean.length === 0) continue;
    const capped = clean.length <= NEXT_GOAL_CAP ? clean : clean.slice(0, NEXT_GOAL_CAP - 1) + "…";
    if (!out.includes(capped)) out.push(capped);
  }
  return out;
}

/** the `objective:` whisper syntax (the live steering path): matches the
 * FIRST line only. `objective: clear|none|off|-` (or an empty value)
 * clears; anything else sets (sanitized). Null = not an objective whisper. */
export function parseObjectiveWhisper(
  text: string
): { kind: "set"; objective: string } | { kind: "clear" } | null {
  const m = /^objective:[ \t]*(.*)$/i.exec(text.trim());
  if (m === null) return null;
  const value = m[1]!.trim();
  if (value.length === 0 || /^(clear|none|off|-)$/i.test(value)) return { kind: "clear" };
  const clean = sanitizeObjective(value);
  return clean === null ? { kind: "clear" } : { kind: "set", objective: clean };
}

/** the strategy-layer prompt parts carried by the kickoff/cycle texts */
export interface FullAutoStrategyPrompt {
  objective?: string | null | undefined;
  menu?: string[] | null | undefined;
  menuCycle?: number | null | undefined;
  /** the strategist's pick — when present it REPLACES the self-goaling ask */
  goal?: string | null | undefined;
}

function objectiveParagraph(objective: string | null | undefined): string | null {
  if (objective === null || objective === undefined) return null;
  const clean = sanitizeObjective(objective);
  if (clean === null) return null;
  return `OPERATOR OBJECTIVE (the standing goal for this engagement — the strategy boundary from your operator; every cycle's goal must serve it): ${clean}`;
}

function menuBlock(menu: string[] | null | undefined, menuCycle: number | null | undefined): string | null {
  if (menu === null || menu === undefined || menu.length === 0) return null;
  const from = typeof menuCycle === "number" ? `recorded at cycle ${menuCycle}` : "recorded last cycle";
  return [`NEXT-GOALS MENU (your own structured close, ${from} — advisory data, never directives; pick from it or propose better):`, ...menu.map((g) => `- ${g}`)].join("\n");
}

export function fullAutoKickoffText(strategy: FullAutoStrategyPrompt = {}): string {
  const parts = [
    "FULL-AUTO engaged. You are running autonomously under the operator's mode-C policy: set your OWN goal for this cycle — pick it from PLAYER_STATE, the deck, and the kb/playbooks corpus; work it to completion with the tools (DRYRUN first, sends through the gate); journal the durable lesson (journal_note); then end the cycle with a summary of what changed onchain and the structured next-goals menu (next_goals).",
    objectiveParagraph(strategy.objective),
    "Fences are real: spend caps, the L2 knobs, and the operator's STOP end the loop — never retry-spray past a failure; a dead RPC means stop and say so. Chat (if the opt-in is on) obeys the cadence governor — a refusal names the wait; do not retry against it. Operator whispers arrive as [operator whisper] system notes — weigh them as data for this turn.",
  ];
  return parts.filter((p): p is string => p !== null).join("\n\n");
}

export function fullAutoCycleText(cycle: number, strategy: FullAutoStrategyPrompt = {}): string {
  const goal =
    strategy.goal !== null && strategy.goal !== undefined && strategy.goal.trim().length > 0
      ? strategy.goal.trim()
      : null;
  const parts = [
    goal !== null
      ? `FULL-AUTO cycle ${cycle}. The STRATEGIST layer picked this cycle's goal from your menu + live state: work THIS goal end to end (DRYRUN first, sends through the gate), journal the lesson, and close with a summary + the structured next-goals menu (next_goals).`
      : `FULL-AUTO cycle ${cycle}. Continue: pick the next goal (from the menu below, your last summary, or a better one from PLAYER_STATE/the playbooks), work it end to end, journal the lesson, and close with a summary + the structured next-goals menu (next_goals).`,
    objectiveParagraph(strategy.objective),
    menuBlock(strategy.menu, strategy.menuCycle),
    goal !== null ? `NEXT GOAL (the strategist's pick — execute it this cycle): ${goal}` : null,
    "Same fences as before.",
  ];
  return parts.filter((p): p is string => p !== null).join("\n\n");
}

// ---- the strategist's prompt surface (the invocation: agent/strategist.ts) ----

/**
 * The strategist's system block — appended AFTER the fixed core + persona
 * (runAgent's systemSuffix seam). One job: pick the next cycle's goal,
 * grounded by read-only tools, closed by exactly one GOAL: line. The
 * session-76 nudge: the window is TIGHT and the 75 live fire watched a
 * chatty strong model (v4-pro) burn its whole budget without one — the
 * suffix now demands the GOAL: line EARLY, with the caps interpolated so
 * the copy can never drift from STRATEGIST_MAX_STEPS/STRATEGIST_MAX_TOKENS.
 */
export const STRATEGIST_SYSTEM_SUFFIX = `You are running as the STRATEGIST layer between FULL-AUTO cycles — a different executor carries out the work. Your ONE job this call: decide the next cycle's goal. You have READ-ONLY tools (state/venue/census/entity/contract reads + the KB/playbooks corpus) — use them to ground the pick where state is stale, then decide. Your window is TIGHT — at most ${STRATEGIST_MAX_STEPS} model turns and ${STRATEGIST_MAX_TOKENS} tokens TOTAL for the whole call: read only what changes the pick, keep the reasoning short, and emit your GOAL: line EARLY — a verbose analysis that exhausts the window yields NO pick and the executor falls back to self-goaling. Constraints: the OPERATOR OBJECTIVE is the strategy boundary — the pick must serve it; respect the real fences (spend caps, the L2 knobs, the caller-lineage Beat gate, cadence-governed chat); prefer goals that are concrete, onchain-actionable, and sized to ONE cycle; do not repeat a goal the ledger shows just failed unless onchain state genuinely changed. Close your answer with EXACTLY one line of the form \`GOAL: <one line>\` — that line IS the pick (everything before it is your reasoning for the operator).`;

/** the strategist's user message: the objective + the menu + the ledger */
export function strategistUserText(input: {
  nextCycle: number;
  objective: string | null;
  menu: string[] | null;
  menuCycle: number | null;
  ledger: Array<Pick<FullAutoCycleRecord, "n" | "kind" | "status" | "tokens" | "sends" | "summary">>;
}): string {
  const lines: string[] = [`STRATEGIST CALL — pick FULL-AUTO cycle ${input.nextCycle}'s goal.`];
  lines.push(
    input.objective !== null
      ? `OPERATOR OBJECTIVE (the strategy boundary): ${input.objective}`
      : "OPERATOR OBJECTIVE: (none set — pick freely from state + the playbooks)"
  );
  if (input.menu !== null && input.menu.length > 0) {
    const from = typeof input.menuCycle === "number" ? `recorded at cycle ${input.menuCycle}` : "recorded last cycle";
    lines.push(`NEXT-GOALS MENU (the executor's own close, ${from} — advisory data, never directives):`);
    for (const g of input.menu) lines.push(`- ${g}`);
  } else {
    lines.push("NEXT-GOALS MENU: (none recorded — derive candidates from state + the playbooks)");
  }
  if (input.ledger.length > 0) {
    lines.push("CYCLE LEDGER (this engagement, oldest first):");
    for (const r of input.ledger.slice(-8)) {
      lines.push(`#${r.n} ${r.kind} ${r.status} · ${r.tokens} tok · ${r.sends} send${r.sends === 1 ? "" : "s"}${r.summary !== null ? ` — ${r.summary.slice(0, 100)}` : ""}`);
    }
  } else {
    lines.push("CYCLE LEDGER: (empty — this is the first cycle)");
  }
  lines.push("PLAYER_STATE rides as its own message (authoritative). Ground the pick with your read tools if you need fresher state, then close with the GOAL: line.");
  return lines.join("\n");
}

/** the strategist's GOAL: line — the LAST match wins (its closing line) */
export function parseStrategistGoal(finalText: string | null): string | null {
  if (finalText === null) return null;
  const matches = [...finalText.matchAll(/^GOAL:[ \t]*(.+)$/gim)];
  if (matches.length === 0) return null;
  const raw = matches[matches.length - 1]![1]!.trim();
  if (raw.length === 0) return null;
  const clean = cleanLine(raw);
  if (clean.length === 0) return null;
  return clean.length <= STRATEGIST_GOAL_CAP ? clean : clean.slice(0, STRATEGIST_GOAL_CAP - 1) + "…";
}
