import { useSyncExternalStore } from "react";

/**
 * The L1 plan store (IA-PLAN §7.8/§7.11.4 — session-47): ONE app-global plan
 * at a time, the deckStore/venueStore pattern. Lifecycle:
 *
 *   proposed → approved → running → done | stopped
 *      ↘ rejected
 *
 * The human approves ONCE (the deck's plan widget); execution is driven by
 * the thin dedicated runner (`agent/planRunner.ts`), which owns the
 * stop-conditions and the rollback-to-L0. Plan approval does NOT bypass THE
 * gate: a step flagged `sends` still resolves through the per-tx approval
 * card in wallet mode A/B (the conservative default — approving a plan
 * approves the CHECKLIST, not the transactions).
 */

export type PlanStatus = "proposed" | "approved" | "running" | "done" | "stopped" | "rejected";

export type PlanStepStatus = "pending" | "running" | "ok" | "err" | "skipped";

export interface PlanStep {
  id: number;
  /** the tool to call (validated against the catalog at proposal time) */
  tool: string;
  /** verbatim tool args; `send` is injected by the runner from `sends` */
  args: Record<string, unknown>;
  /** one-line human summary shown in the checklist the human approves */
  note: string;
  /** declared send intent — the flag the human approves, the only way send=true happens */
  sends: boolean;
  status: PlanStepStatus;
  /** capped result summary for the checklist (never full payloads) */
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  status: PlanStatus;
  /** terminal explanation (stop-condition, rejection) — the honest ledger */
  stopReason: string | null;
  /** the human's STOP while running — honored by the runner between steps */
  stopRequested: boolean;
  createdAt: number;
  updatedAt: number;
}

/** schema fences (mirrored in the propose_plan tool schema) */
export const PLAN_MAX_STEPS = 12;
export const PLAN_GOAL_MAX = 280;
export const PLAN_NOTE_MAX = 160;

export interface PlanStepInput {
  tool: string;
  args?: Record<string, unknown>;
  note?: string;
  sends?: boolean;
}

export interface ProposeResult {
  plan: Plan | null;
  error: string | null;
}

let plan: Plan | null = null;
let nextStepId = 1;
let planSeq = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function currentPlan(): Plan | null {
  return plan;
}

export function proposePlan(goal: string, steps: PlanStepInput[]): ProposeResult {
  if (plan !== null && plan.status !== "done" && plan.status !== "stopped" && plan.status !== "rejected") {
    return { plan: null, error: `plan "${plan.goal}" is ${plan.status} — stop, reject, or let it finish before proposing another` };
  }
  const cleanGoal = goal.trim();
  if (cleanGoal.length === 0) return { plan: null, error: "goal is required" };
  if (cleanGoal.length > PLAN_GOAL_MAX) return { plan: null, error: `goal ${cleanGoal.length} chars > ${PLAN_GOAL_MAX}` };
  if (!Array.isArray(steps) || steps.length === 0) return { plan: null, error: "at least one step is required" };
  if (steps.length > PLAN_MAX_STEPS) return { plan: null, error: `${steps.length} steps > cap ${PLAN_MAX_STEPS}` };
  const built: PlanStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const tool = typeof s.tool === "string" ? s.tool.trim() : "";
    if (tool.length === 0) return { plan: null, error: `step ${i + 1}: tool is required` };
    const args = typeof s.args === "object" && s.args !== null && !Array.isArray(s.args) ? (s.args as Record<string, unknown>) : {};
    const note = typeof s.note === "string" ? s.note.trim().slice(0, PLAN_NOTE_MAX) : "";
    built.push({
      id: nextStepId++,
      tool,
      args,
      note,
      sends: s.sends === true,
      status: "pending",
      result: null,
      error: null,
    });
  }
  planSeq += 1;
  plan = {
    id: `plan-${planSeq}`,
    goal: cleanGoal,
    steps: built,
    status: "proposed",
    stopReason: null,
    stopRequested: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  notify();
  return { plan, error: null };
}

/** the approve-once moment: proposed → approved (the runner takes it from here) */
export function approvePlan(id: string): boolean {
  if (plan === null || plan.id !== id || plan.status !== "proposed") return false;
  plan = { ...plan, status: "approved", updatedAt: Date.now() };
  notify();
  return true;
}

export function rejectPlan(id: string): boolean {
  if (plan === null || plan.id !== id || plan.status !== "proposed") return false;
  plan = { ...plan, status: "rejected", stopReason: "rejected by the operator", updatedAt: Date.now() };
  notify();
  return true;
}

/** terminal; returns false when a step is still running (the runner finishes it) */
export function markRunning(id: string): boolean {
  if (plan === null || plan.id !== id || plan.status !== "approved") return false;
  plan = { ...plan, status: "running", updatedAt: Date.now() };
  notify();
  return true;
}

export function stepStarted(id: string, stepId: number): void {
  if (plan === null || plan.id !== id) return;
  plan = {
    ...plan,
    updatedAt: Date.now(),
    steps: plan.steps.map((s) => (s.id === stepId ? { ...s, status: "running" } : s)),
  };
  notify();
}

export function stepFinished(id: string, stepId: number, patch: { result?: Record<string, unknown>; error?: string }): void {
  if (plan === null || plan.id !== id) return;
  plan = {
    ...plan,
    updatedAt: Date.now(),
    steps: plan.steps.map((s) =>
      s.id === stepId
        ? {
            ...s,
            status: patch.error !== undefined ? "err" : "ok",
            result: patch.result !== undefined ? capStepResult(patch.result) : s.result,
            error: patch.error ?? null,
          }
        : s
    ),
  };
  notify();
}

export function planFinished(id: string, status: "done" | "stopped", stopReason: string | null): void {
  if (plan === null || plan.id !== id) return;
  plan = {
    ...plan,
    status,
    stopReason,
    updatedAt: Date.now(),
    steps: plan.steps.map((s) => (s.status === "pending" ? { ...s, status: "skipped" } : s)),
  };
  notify();
}

/** the human's lever — honored by the runner between steps */
export function stopPlan(reason: string): boolean {
  if (plan === null) return false;
  if (plan.status === "approved") {
    plan = { ...plan, status: "stopped", stopReason: reason, updatedAt: Date.now() };
    notify();
    return true;
  }
  if (plan.status !== "running") return false;
  plan = { ...plan, stopRequested: true, updatedAt: Date.now() };
  notify();
  return true;
}

/** runner read: did the human hit STOP? */
export function planStopRequested(id: string): boolean {
  return plan !== null && plan.id === id && plan.stopRequested;
}

export function clearPlan(): void {
  plan = null;
  notify();
}

function capStepResult(result: Record<string, unknown>): Record<string, unknown> {
  try {
    const json = JSON.stringify(result);
    if (json.length <= 480) return JSON.parse(json) as Record<string, unknown>;
    return { head: json.slice(0, 460), note: "capped for the checklist" };
  } catch {
    return { note: "non-serializable result" };
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const subscribePlan = subscribe;

export function usePlan(): Plan | null {
  return useSyncExternalStore(subscribePlan, currentPlan, currentPlan);
}
