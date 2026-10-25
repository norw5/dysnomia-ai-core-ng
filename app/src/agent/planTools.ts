import { proposePlan, currentPlan, PLAN_GOAL_MAX, PLAN_MAX_STEPS, PLAN_NOTE_MAX } from "@/state/planStore";
import type { AgentTool } from "@/agent/tools";
import { SIM_TOOLS, toolCatalog } from "@/agent/tools";

/**
 * The L1 plan tool family (IA-PLAN §7.8/§7.11.4 — session-47). `propose_plan`
 * is schema-fenced and PURE with respect to the gate: it stores the proposed
 * checklist for the human's ONE approval on the DECK and surfaces the plan
 * widget. Nothing executes at proposal time — reads and DRYRUNs the model
 * wants FIRST belong in the proposing turn (their results inform the steps).
 * `send` inside step args is IGNORED; the runner injects send=true only for
 * steps the human saw flagged SEND, and every such send still resolves
 * through THE gate (per-tx approval card in wallet mode A/B — plan approval
 * is checklist approval, not transaction approval).
 */

/** caps mirrored into the tool schema below */
export const PLAN_ARGS_CHAR_CAP = 1200;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** tools a plan may NEVER script */
function forbiddenStepTools(chatToolsEnabled: boolean, simToolsEnabled: boolean): string[] {
  // journal_note: a plan's lesson is its stopReason (code-derived); notes
  // are the MODEL's mid-run observation, and a scripted checklist is not
  // the model observing anything (§7.10, session-54). next_goals: same
  // class (session-74) — the menu is the executor's own structured close,
  // and a scripted checklist cannot close a cycle
  const forbidden = new Set<string>(["propose_plan", "get_plan", "journal_note", "next_goals"]);
  if (!chatToolsEnabled) {
    forbidden.add("send_chat");
    forbidden.add("send_world_chat");
  }
  // the §8 SIM family rides the sim-only catalog gate: outside sim mode the
  // tools are UNKNOWN (the schema fence rejects them as unknown tools);
  // inside it they stay scriptable like any act tool (their execute
  // re-guards sim mode, so an RPC switch mid-plan stops honestly)
  if (!simToolsEnabled) {
    forbidden.add("world_code");
    forbidden.add("spawn_gwat");
    forbidden.add("encrypt_note");
  }
  return [...forbidden];
}

export function validatePlanSteps(
  steps: unknown,
  chatToolsEnabled: boolean,
  simToolsEnabled = false
): { ok: true; steps: Array<{ tool: string; args: Record<string, unknown>; note: string; sends: boolean }> } | { ok: false; error: string } {
  if (!Array.isArray(steps)) return { ok: false, error: "steps must be an array" };
  if (steps.length === 0) return { ok: false, error: "at least one step is required" };
  if (steps.length > PLAN_MAX_STEPS) return { ok: false, error: `${steps.length} steps > cap ${PLAN_MAX_STEPS}` };
  const known = new Set(toolCatalog(chatToolsEnabled, simToolsEnabled).map((t) => t.name));
  const forbidden = new Set(forbiddenStepTools(chatToolsEnabled, simToolsEnabled));
  const out: Array<{ tool: string; args: Record<string, unknown>; note: string; sends: boolean }> = [];
  for (let i = 0; i < steps.length; i++) {
    const raw = steps[i]!;
    if (!isPlainObject(raw)) return { ok: false, error: `step ${i + 1}: must be an object` };
    const tool = typeof raw["tool"] === "string" ? raw["tool"].trim() : "";
    if (tool.length === 0) return { ok: false, error: `step ${i + 1}: tool is required` };
    if (!known.has(tool)) {
      const simNote = !simToolsEnabled && SIM_TOOLS.has(tool) ? " (SIM-only — the layer has no live addresses on this RPC)" : "";
      return { ok: false, error: `step ${i + 1}: unknown tool "${tool}"${simNote}` };
    }
    if (forbidden.has(tool)) {
      const chat = tool === "send_chat" || tool === "send_world_chat";
      return { ok: false, error: `step ${i + 1}: "${tool}" cannot be scripted inside a plan${chat ? " (chat tools are OFF — the §7.4 opt-in)" : ""}` };
    }
    const args = isPlainObject(raw["args"]) ? raw["args"] : {};
    const serialized = JSON.stringify(args);
    if (serialized.length > PLAN_ARGS_CHAR_CAP) {
      return { ok: false, error: `step ${i + 1}: args ${serialized.length} chars > cap ${PLAN_ARGS_CHAR_CAP}` };
    }
    if ("send" in args) {
      return { ok: false, error: `step ${i + 1}: do not set args.send — declare the step-level "sends" flag instead (the human approves THAT flag)` };
    }
    const note = typeof raw["note"] === "string" ? raw["note"].trim() : "";
    if (note.length > PLAN_NOTE_MAX) return { ok: false, error: `step ${i + 1}: note ${note.length} chars > ${PLAN_NOTE_MAX}` };
    out.push({ tool, args, note, sends: raw["sends"] === true });
  }
  return { ok: true, steps: out };
}

function planSummary(p: { id: string; goal: string; status: string; steps: Array<{ tool: string; sends: boolean; status: string; note: string }> }): Record<string, unknown> {
  return {
    planId: p.id,
    goal: p.goal,
    status: p.status,
    steps: p.steps.map((s, i) => ({ i: i + 1, tool: s.tool, sends: s.sends, note: s.note.length > 0 ? s.note : undefined })),
  };
}

const proposePlanTool: AgentTool = {
  name: "propose_plan",
  risk: "knowledge",
  description: `Propose an L1 PLAN for multi-step work: the human approves it ONCE on the DECK (per-step preview), then the app executes the checklist deterministically — no further model turns needed. Each step = one tool call with fixed args (dashboard tools allowed — the deck choreography runs too). Declare "sends": true on steps that must SEND through the gate; all other act steps stay DRYRUN-only. Sends still show the per-tx approval card in wallet mode A/B — approving the plan approves the checklist, NOT the transactions. Stop-conditions: any step error, any send outcome other than sent (denied / DRYRUN revert / approval rejected / no signer), your STOP button — on stop the plan rolls back to L0 (one action per approval). Steps must be self-contained: propose AFTER doing the reads/DRYRUNs that inform them. Max ${PLAN_MAX_STEPS} steps.`,
  parameters: {
    type: "object",
    properties: {
      goal: { type: "string", description: `the plan goal, one line (max ${PLAN_GOAL_MAX} chars)` },
      steps: {
        type: "array",
        description: "ordered steps; fixed args, executed verbatim",
        items: {
          type: "object",
          properties: {
            tool: { type: "string", description: "tool name from the catalog" },
            args: { type: "object", description: "fixed tool args (no send flag — use sends)" },
            note: { type: "string", description: `one-line human summary shown in the approval checklist (max ${PLAN_NOTE_MAX} chars)` },
            sends: { type: "boolean", description: "true = this step SENDS through the gate (per-tx approval still applies in mode A/B); false/default = DRYRUN/read only" },
          },
          required: ["tool"],
        },
      },
    },
    required: ["goal", "steps"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const goal = typeof args["goal"] === "string" ? args["goal"] : "";
    const validated = validatePlanSteps(args["steps"], ctx.chatToolsEnabled, ctx.simToolsEnabled);
    if (!validated.ok) return { error: `plan rejected by the schema fence: ${validated.error}` };
    const res = proposePlan(goal, validated.steps);
    if (res.error !== null || res.plan === null) return { error: res.error ?? "plan refused" };
    const sends = res.plan.steps.filter((s) => s.sends).length;
    return {
      proposed: true,
      ...planSummary(res.plan),
      sendSteps: sends,
      note: "the plan is on the DECK awaiting the operator's ONE approval — tell them, then wait; execution reports per-step results",
    };
  },
};

const getPlanTool: AgentTool = {
  name: "get_plan",
  risk: "knowledge",
  description: "Read the current plan's state (goal, per-step status, stop reason). Use it before re-proposing after a stop.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute() {
    const p = currentPlan();
    if (p === null) return { plan: null, note: "no plan — L0 (one action per approval)" };
    return {
      ...planSummary(p),
      stepStates: p.steps.map((s, i) => ({ i: i + 1, tool: s.tool, status: s.status, error: s.error ?? undefined })),
      stopReason: p.stopReason,
    };
  },
};

export const PLAN_TOOLS: AgentTool[] = [proposePlanTool, getPlanTool];
