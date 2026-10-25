import type { RunEvent } from "@/agent/graph";
import { emitRunEvent } from "@/agent/events";
import { toolByName, type AgentToolContext } from "@/agent/tools";
import type { Journal } from "@/chain/journal";
import type { AgentRunRecord } from "@/chain/runs";
import { markRunning, planFinished, planStopRequested, stepFinished, stepStarted, type Plan } from "@/state/planStore";

/**
 * The L1 plan runner (IA-PLAN §7.8/§7.11.4 — session-47): a thin DEDICATED
 * executor, not the model loop — the approved checklist runs verbatim with
 * zero model turns. Stop-conditions (any one → terminal `stopped` +
 * rollback-to-L0, remaining steps skipped):
 *   1. step error (a tool result carrying `error`, or a throw);
 *   2. send outcome ≠ sent (denied / DRYRUN revert — no overrides in plans /
 *      approval-card rejected / no-signer) — the DRYRUN-revert-class guard;
 *   3. the user's STOP (the pane STOP / the plan widget STOP) or an abort
 *      signal — honored between steps;
 *   4. budget: the step budget IS the checklist (finite, human-approved);
 *      gate policy counters still bound every send.
 * `send: true` is injected ONLY for steps the human saw flagged SEND — args
 * verbatim otherwise. Every step journals agent.tool and emits RunEvents on
 * the lifted bus, so the deck's auto-surface maps per-step widgets exactly
 * like model-driven calls.
 */

export interface PlanRunHooks {
  /** pane/system visibility — the agent store pushes display messages */
  onEvent?(e: RunEvent): void;
}

export interface PlanRunResult {
  status: "done" | "stopped";
  stopReason: string | null;
  steps: Array<{ tool: string; ok: boolean }>;
  record: Omit<AgentRunRecord, "id" | "t">;
}

/** a send outcome counts as sent only when the gate actually sent */
const SEND_OK_STATUSES = new Set(["sent"]);

/**
 * 65.1: a sends-step is ALSO satisfied by an explicit benign NO-OP — a tool
 * answering the step's goal already-true with nothing to send (`noop: true`,
 * e.g. register on a wallet SEI.Start already Entered). Stopping the plan
 * there ("did not send") was a false stop: the send was never needed.
 */
function sendStepSatisfied(result: Record<string, unknown>): boolean {
  return SEND_OK_STATUSES.has(String(result["status"] ?? "")) || result["noop"] === true;
}

function summarizeResult(result: Record<string, unknown>): { error: string | null; brief: Record<string, unknown> } {
  const err = result["error"];
  if (typeof err === "string" && err.length > 0) return { error: err, brief: result };
  return { error: null, brief: result };
}

export async function executePlan(
  plan: Plan,
  ctx: AgentToolContext,
  journal: Journal,
  signal: AbortSignal,
  hooks: PlanRunHooks = {}
): Promise<PlanRunResult> {
  const emit = (e: RunEvent): void => {
    emitRunEvent(e);
    hooks.onEvent?.(e);
  };
  const steps: Array<{ tool: string; ok: boolean }> = [];
  let stopReason: string | null = null;

  journal.emit("agent.plan", `plan ${plan.id} running · ${plan.goal} · ${plan.steps.length} steps`, { planId: plan.id, goal: plan.goal });
  markRunning(plan.id);

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]!;
    if (signal.aborted) {
      stopReason = "aborted";
      break;
    }
    if (planStopRequested(plan.id)) {
      stopReason = "user STOP";
      break;
    }
    stepStarted(plan.id, step.id);
    const callId = `${plan.id}-s${i + 1}`;
    const args: Record<string, unknown> = step.sends ? { ...step.args, send: true } : { ...step.args };
    emit({ type: "tool-call", id: callId, name: step.tool, args });
    journal.emit("agent.tool", `plan step ${i + 1}/${plan.steps.length}: ${step.tool}${step.sends ? " (SEND)" : ""}`, {
      planId: plan.id,
      step: i + 1,
      tool: step.tool,
      sends: step.sends,
    });
    let result: Record<string, unknown>;
    let threw = false;
    const tool = toolByName(step.tool);
    try {
      if (tool === null) throw new Error(`unknown tool: ${step.tool}`);
      result = await tool.execute(args, ctx);
    } catch (e) {
      threw = true;
      result = { error: e instanceof Error ? e.message : String(e) };
    }
    const { error } = summarizeResult(result);
    const stepOk = !threw && error === null && (!step.sends || sendStepSatisfied(result));
    emit({ type: "tool-result", id: callId, name: step.tool, result, ok: stepOk });
    journal.emit("agent.tool", `plan step ${i + 1} ${stepOk ? "ok" : "ERR"}: ${step.tool}`, { planId: plan.id, step: i + 1, tool: step.tool, ok: stepOk });
    steps.push({ tool: step.tool, ok: stepOk });
    if (!stepOk) {
      stepFinished(plan.id, step.id, { result, error: error ?? (step.sends ? `send outcome: ${String(result["status"] ?? "no-status")}` : "step failed") });
      stopReason = step.sends
        ? `send step ${i + 1} (${step.tool}) did not send — ${error ?? String(result["status"] ?? "no-status")}`
        : `step ${i + 1} (${step.tool}) failed — ${error ?? "tool error"}`;
      break;
    }
    stepFinished(plan.id, step.id, { result });
  }

  const status: PlanRunResult["status"] = stopReason !== null ? "stopped" : "done";
  planFinished(plan.id, status, stopReason);
  journal.emit(
    "agent.plan",
    status === "done" ? `plan ${plan.id} done · ${steps.length}/${plan.steps.length} steps ok` : `plan ${plan.id} STOPPED: ${stopReason} — rolled back to L0`,
    { planId: plan.id, status, stopReason, stepsOk: steps.filter((s) => s.ok).length }
  );
  // sends change state — lift a fresh snapshot whenever the plan carried any
  if (plan.steps.some((s) => s.sends)) ctx.refreshSnapshot();
  return {
    status,
    stopReason,
    steps,
    record: {
      kind: "plan",
      goal: plan.goal,
      outcome: status === "done" ? "done" : "stopped",
      lesson: stopReason,
      steps,
      tokens: 0,
    },
  };
}
