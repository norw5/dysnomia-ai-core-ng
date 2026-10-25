import { beforeEach, describe, expect, it } from "vitest";

/**
 * The L1 plan store (§7.8/§7.11.4): lifecycle proposed→approved→running→
 * done/stopped (+rejected), schema fences, step transitions, the STOP lever
 * (approved stops immediately; running records intent the runner honors),
 * and one-plan-at-a-time honesty.
 */

const store = await import("@/state/planStore");
const {
  approvePlan,
  clearPlan,
  currentPlan,
  markRunning,
  planFinished,
  planStopRequested,
  proposePlan,
  rejectPlan,
  stepFinished,
  stepStarted,
  stopPlan,
  PLAN_MAX_STEPS,
} = store;
type PlanStepInput = import("@/state/planStore").PlanStepInput;

function propose(goal = "onboard a fresh wallet", steps: PlanStepInput[] = [{ tool: "search_kb", args: { query: "onboarding" } }]): ReturnType<typeof proposePlan> {
  return proposePlan(goal, steps);
}

beforeEach(() => {
  clearPlan();
});

describe("proposal + fences", () => {
  it("stores a proposed plan with sanitized steps", () => {
    const res = propose("goal one", [
      { tool: "get_venue", args: { address: "0xabc" }, note: "read the venue", sends: false },
      { tool: "join_venue", args: { address: "0xabc" }, note: "join it", sends: true },
    ]);
    expect(res.error).toBeNull();
    expect(res.plan!.status).toBe("proposed");
    expect(res.plan!.steps).toHaveLength(2);
    expect(res.plan!.steps[1]!.sends).toBe(true);
    expect(res.plan!.steps[0]!.status).toBe("pending");
  });

  it("refuses empty goals, oversized goals, empty/oversized step lists", () => {
    expect(propose("   ").error).toContain("goal");
    expect(propose("x".repeat(281)).error).toContain("280");
    expect(propose("g", []).error).toContain("at least one step");
    const many = Array.from({ length: PLAN_MAX_STEPS + 1 }, () => ({ tool: "search_kb" }));
    expect(propose("g", many).error).toContain(String(PLAN_MAX_STEPS));
  });

  it("a new proposal REPLACES a terminal plan but never a live/proposed one", () => {
    propose("first");
    const refusedWhileProposed = propose("second");
    expect(refusedWhileProposed.error).toContain("proposed");
    approvePlan(currentPlan()!.id);
    markRunning(currentPlan()!.id);
    const refused = propose("second");
    expect(refused.error).toContain("running");

    planFinished(currentPlan()!.id, "done", null);
    const next = propose("second");
    expect(next.error).toBeNull();
    expect(next.plan!.goal).toBe("second");
  });
});

describe("lifecycle transitions", () => {
  it("approve only from proposed; reject only from proposed", () => {
    propose();
    const id = currentPlan()!.id;
    expect(approvePlan("wrong-id")).toBe(false);
    expect(approvePlan(id)).toBe(true);
    expect(currentPlan()!.status).toBe("approved");
    expect(rejectPlan(id)).toBe(false); // already approved

    clearPlan();
    propose();
    expect(rejectPlan(currentPlan()!.id)).toBe(true);
    expect(currentPlan()!.status).toBe("rejected");
    expect(currentPlan()!.stopReason).toContain("rejected");
  });

  it("markRunning only from approved; steps transition pending→running→ok/err", () => {
    propose("g", [{ tool: "search_kb" }, { tool: "explain" }]);
    const id = currentPlan()!.id;
    expect(markRunning(id)).toBe(false); // still proposed
    approvePlan(id);
    expect(markRunning(id)).toBe(true);

    const s1 = currentPlan()!.steps[0]!;
    stepStarted(id, s1.id);
    expect(currentPlan()!.steps[0]!.status).toBe("running");
    stepFinished(id, s1.id, { result: { hits: 2 } });
    expect(currentPlan()!.steps[0]!.status).toBe("ok");
    expect(currentPlan()!.steps[0]!.result).toEqual({ hits: 2 });

    const s2 = currentPlan()!.steps[1]!;
    stepFinished(id, s2.id, { error: "rpc dead" });
    expect(currentPlan()!.steps[1]!.status).toBe("err");
    expect(currentPlan()!.steps[1]!.error).toBe("rpc dead");
  });

  it("planFinished terminal: pending steps become skipped; stopReason recorded", () => {
    propose("g", [{ tool: "search_kb" }, { tool: "search_kb" }]);
    const id = currentPlan()!.id;
    approvePlan(id);
    markRunning(id);
    stepStarted(id, currentPlan()!.steps[0]!.id);
    stepFinished(id, currentPlan()!.steps[0]!.id, { result: {} });
    planFinished(id, "stopped", "user STOP");
    const p = currentPlan()!;
    expect(p.status).toBe("stopped");
    expect(p.stopReason).toBe("user STOP");
    expect(p.steps[1]!.status).toBe("skipped");
  });
});

describe("the STOP lever", () => {
  it("stops an APPROVED plan immediately (never started)", () => {
    propose();
    approvePlan(currentPlan()!.id);
    expect(stopPlan("user STOP")).toBe(true);
    expect(currentPlan()!.status).toBe("stopped");
    expect(currentPlan()!.stopReason).toBe("user STOP");
  });

  it("a RUNNING plan records stopRequested — the runner honors it between steps", () => {
    propose();
    const id = currentPlan()!.id;
    approvePlan(id);
    markRunning(id);
    expect(planStopRequested(id)).toBe(false);
    expect(stopPlan("user STOP")).toBe(true);
    expect(currentPlan()!.status).toBe("running"); // runner owns the terminal flip
    expect(planStopRequested(id)).toBe(true);
  });

  it("STOP is refused on proposed/terminal plans", () => {
    propose();
    expect(stopPlan("x")).toBe(false);
    approvePlan(currentPlan()!.id);
    markRunning(currentPlan()!.id);
    planFinished(currentPlan()!.id, "done", null);
    expect(stopPlan("x")).toBe(false);
  });
});

describe("step result capping", () => {
  it("caps large results for the checklist (the widget stays readable)", () => {
    propose("g", [{ tool: "search_kb" }]);
    const id = currentPlan()!.id;
    markRunning(approvePlan(id) ? id : id);
    const step = currentPlan()!.steps[0]!;
    stepFinished(id, step.id, { result: { blob: "x".repeat(2000) } });
    const stored = currentPlan()!.steps[0]!.result!;
    expect(Object.keys(stored)).toContain("head");
    expect(String(stored["note"])).toContain("capped");
  });
});
