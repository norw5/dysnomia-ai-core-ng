import { beforeEach, describe, expect, it } from "vitest";
import { JournalBus } from "@/chain/journal";
import { clearDeck } from "@/state/deckStore";
import { clearPlan, currentPlan, proposePlan } from "@/state/planStore";
import { toolByName, toolSpecs, type AgentToolContext } from "@/agent/tools";
import { validatePlanSteps } from "@/agent/planTools";

/**
 * The L1 plan tool family (§7.8/§7.11.4): schema fences (steps validated
 * against the REAL catalog, no send in args, chat tools behind the §7.4
 * opt-in), the no-gate-touch guarantee at proposal time (proposal ≠
 * execution), and honest refusal while a plan is active.
 */

const VENUE = "0xb0ba7d36b7f0505879179ece7401f24eb653c6e1";

function fakeCtx(chatToolsEnabled = false): AgentToolContext & { __requests: unknown[] } {
  const requests: unknown[] = [];
  const ctx: AgentToolContext = {
    rpcUrl: "http://127.0.0.1:9999",
    account: null,
    snapshot: null,
    journal: new JournalBus(),
    walletMode: "A",
    chatToolsEnabled,
    gateDryRun: async (req) => {
      requests.push(req);
      throw new Error("propose_plan must never reach the gate");
    },
    gateSend: async (req) => {
      requests.push(req);
      throw new Error("propose_plan must never reach the gate");
    },
    refreshSnapshot: () => {
      requests.push("refresh");
    },
    takeNote: () => {
      throw new Error("plan tools never journal");
    },
    simToolsEnabled: false,
  };
  return Object.assign(ctx, { __requests: requests });
}

beforeEach(() => {
  clearPlan();
  clearDeck();
});

describe("advertising", () => {
  it("ships propose_plan + get_plan ALWAYS (both §7.4 states, non-act risk)", () => {
    for (const enabled of [false, true]) {
      const names = toolSpecs(enabled).map((t) => t.function.name);
      expect(names).toContain("propose_plan");
      expect(names).toContain("get_plan");
    }
    for (const n of ["propose_plan", "get_plan"]) {
      const t = toolByName(n)!;
      expect(t.parameters.type).toBe("object");
      expect(t.risk).not.toBe("act"); // pure at proposal time — sends happen in the runner, through the gate
    }
  });
});

describe("the schema fence (validatePlanSteps)", () => {
  it("accepts a clean checklist incl. dashboard tools and declared sends", () => {
    const v = validatePlanSteps(
      [
        { tool: "search_kb", args: { query: "beat" }, note: "read the KB" },
        { tool: "focus_map", args: { address: VENUE }, note: "focus the atlas" },
        { tool: "join_venue", args: { address: VENUE }, sends: true, note: "join through the gate" },
      ],
      false
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.steps[2]!.sends).toBe(true);
  });

  it("refuses unknown tools and plan-tool recursion", () => {
    expect(validatePlanSteps([{ tool: "warp_drive" }], false)).toMatchObject({ ok: false });
    expect(validatePlanSteps([{ tool: "propose_plan", args: { goal: "x", steps: [] } }], false)).toMatchObject({ ok: false });
    expect(validatePlanSteps([{ tool: "get_plan" }], false)).toMatchObject({ ok: false });
  });

  it("refuses args.send — the human approves the step-level sends flag, never hidden args", () => {
    const v = validatePlanSteps([{ tool: "join_venue", args: { send: true } }], false);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("sends");
  });

  it("caps step count, note length, and serialized args size", () => {
    const tooMany = Array.from({ length: 13 }, () => ({ tool: "search_kb" }));
    expect(validatePlanSteps(tooMany, false)).toMatchObject({ ok: false });
    expect(validatePlanSteps([{ tool: "search_kb", note: "x".repeat(161) }], false)).toMatchObject({ ok: false });
    const fatArgs = { q: "x".repeat(1300) };
    expect(validatePlanSteps([{ tool: "search_kb", args: fatArgs }], false)).toMatchObject({ ok: false });
  });

  it("send_chat is scriptable ONLY behind the §7.4 opt-in", () => {
    expect(validatePlanSteps([{ tool: "send_chat", args: { message: "hi" } }], false)).toMatchObject({ ok: false });
    const on = validatePlanSteps([{ tool: "send_chat", args: { message: "hi" }, sends: true }], true);
    expect(on.ok).toBe(true);
  });

  it("journal_note can NEVER be scripted in a plan (notes are the MODEL's mid-run observation — §7.10)", () => {
    const v = validatePlanSteps([{ tool: "journal_note", args: { text: "lesson" } }], true);
    expect(v).toMatchObject({ ok: false });
    expect((v as { error: string }).error).toContain("journal_note");
  });

  it("next_goals can NEVER be scripted in a plan (the menu is the executor's own structured close — session-74)", () => {
    const v = validatePlanSteps([{ tool: "next_goals", args: { goals: ["settle at Phobos"] } }], true);
    expect(v).toMatchObject({ ok: false });
    expect((v as { error: string }).error).toContain("next_goals");
  });

  it("the §8 SIM family is scriptable ONLY in sim mode (unknown tool outside — the session-59 fence)", () => {
    for (const tool of ["world_code", "spawn_gwat", "encrypt_note"]) {
      const v = validatePlanSteps([{ tool, args: {} }], false);
      expect(v).toMatchObject({ ok: false });
      expect((v as { error: string }).error).toContain("SIM-only");
      const on = validatePlanSteps([{ tool, args: {} }], false, true);
      expect(on.ok).toBe(true);
    }
  });
});

describe("propose_plan execution", () => {
  it("stores the plan and answers with the checklist summary — WITHOUT touching the gate", async () => {
    const ctx = fakeCtx();
    const out = await toolByName("propose_plan")!.execute(
      { goal: "onboard", steps: [{ tool: "search_kb", args: { query: "onboarding" }, note: "read first" }] },
      ctx
    );
    expect(out.proposed).toBe(true);
    expect(out.sendSteps).toBe(0);
    expect(currentPlan()!.goal).toBe("onboard");
    expect(currentPlan()!.status).toBe("proposed");
    expect(ctx.__requests).toHaveLength(0); // proposal ≠ execution: no gate, no chain, no refresh
  });

  it("reports schema-fence rejections as honest errors and stores nothing", async () => {
    const out = await toolByName("propose_plan")!.execute({ goal: "g", steps: [{ tool: "nope" }] }, fakeCtx());
    expect(String(out.error)).toContain("schema fence");
    expect(currentPlan()).toBeNull();
  });

  it("refuses while a plan is active (one plan at a time)", async () => {
    proposePlan("first", [{ tool: "search_kb" }]);
    const out = await toolByName("propose_plan")!.execute({ goal: "second", steps: [{ tool: "search_kb" }] }, fakeCtx());
    expect(String(out.error)).toContain("first");
  });

  it("get_plan reads the live state; null plan answers L0 honestly", async () => {
    const none = await toolByName("get_plan")!.execute({}, fakeCtx());
    expect(none.plan).toBeNull();
    expect(String(none.note)).toContain("L0");

    await toolByName("propose_plan")!.execute({ goal: "g", steps: [{ tool: "search_kb" }] }, fakeCtx());
    const p = await toolByName("get_plan")!.execute({}, fakeCtx());
    expect(p.status).toBe("proposed");
    expect(p.steps).toHaveLength(1);
  });
});
