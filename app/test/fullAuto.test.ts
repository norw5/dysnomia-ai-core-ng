import { afterEach, describe, expect, it } from "vitest";
import {
  FULL_AUTO_CHAT_MIN_INTERVAL_MS,
  FULL_AUTO_MAX_CYCLES,
  FULL_AUTO_MAX_TOKENS,
  FULL_AUTO_OBSERVED_CYCLE_TOKENS,
  NEXT_GOAL_CAP,
  NEXT_GOALS_MAX,
  OBJECTIVE_CAP,
  STRATEGIST_GOAL_CAP,
  STRATEGIST_MAX_STEPS,
  STRATEGIST_MAX_TOKENS,
  STRATEGIST_READ_TOOLS,
  STRATEGIST_SYSTEM_SUFFIX,
  fullAutoCapsHint,
  fullAutoContinues,
  fullAutoCycleText,
  fullAutoKickoffText,
  fullAutoTokenFence,
  parseObjectiveWhisper,
  parseStrategistGoal,
  sanitizeNextGoals,
  sanitizeObjective,
  strategistUserText,
} from "@/agent/fullAuto";
import { DEFAULT_BUDGET, DEFAULT_RUN_MAX_TOKENS } from "@/agent/graph";
import { toolByName, type AgentToolContext } from "@/agent/tools";
import { JournalBus } from "@/chain/journal";
import { resetHomeVenueForTests } from "@/state/homeVenue";

/**
 * FULL-AUTO (session-65, questions 7+8): the loop's stop/continue verdict —
 * only a CLEAN done continues; every fence (spend/failure, checkpoint,
 * error, abort, the cycle backstop) disengages. Plus the §7.4 chat cadence
 * governor binding on the chat tools (min-interval between chat SENDS in
 * full-auto; free otherwise).
 */

const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as `0x${string}`;

describe("fullAutoContinues — the loop's fences", () => {
  it("a clean done continues (below the cycle backstop)", () => {
    expect(fullAutoContinues("done", 1)).toEqual({ next: true, reason: null });
    expect(fullAutoContinues("done", FULL_AUTO_MAX_CYCLES - 1).next).toBe(true);
  });
  it("every non-done status disengages with the honest reason", () => {
    expect(fullAutoContinues("budget-stop", 1).next).toBe(false);
    expect(fullAutoContinues("budget-stop", 1).reason).toContain("fence");
    expect(fullAutoContinues("checkpoint", 1).next).toBe(false);
    expect(fullAutoContinues("error", 1).next).toBe(false);
    expect(fullAutoContinues("aborted", 1).reason).toContain("STOP");
  });
  it("the cycle backstop stops even a clean done", () => {
    const v = fullAutoContinues("done", FULL_AUTO_MAX_CYCLES);
    expect(v.next).toBe(false);
    expect(v.reason).toContain("backstop");
  });
  it("the operator-set cycle backstop tightens the loop (the 12 is just the default)", () => {
    expect(fullAutoContinues("done", 1, 1).next).toBe(false);
    expect(fullAutoContinues("done", 1, 1).reason).toContain("cycle backstop (1)");
    expect(fullAutoContinues("done", 1, 4).next).toBe(true);
  });
  it("the session token fence: cumulative tokens while engaged bound the LOOP (0 = off)", () => {
    // below the cap → continues
    expect(fullAutoTokenFence(0, 500_000)).toEqual({ stop: false, reason: null });
    expect(fullAutoTokenFence(499_999, 500_000).stop).toBe(false);
    // at/over the cap → the honest reason names SETTINGS
    const v = fullAutoTokenFence(500_000, 500_000);
    expect(v.stop).toBe(true);
    expect(v.reason).toContain("token cap (500000)");
    expect(v.reason).toContain("SETTINGS");
    // 0 = off — unbounded tokens never trip it
    expect(fullAutoTokenFence(Number.MAX_SAFE_INTEGER, 0).stop).toBe(false);
  });
  it("the fence default is the settings default (one source)", () => {
    expect(FULL_AUTO_MAX_TOKENS).toBe(500_000);
  });
  it("the driver texts are full-auto explicit (the core prompt contract)", () => {
    expect(fullAutoKickoffText()).toContain("FULL-AUTO engaged");
    expect(fullAutoKickoffText()).toContain("cadence governor");
    expect(fullAutoCycleText(3)).toContain("FULL-AUTO cycle 3");
  });
});

describe("session-74: the strategy layer — objective + menu texts", () => {
  it("the default kickoff/cycle texts stay self-goaling (no objective, no menu)", () => {
    expect(fullAutoKickoffText()).not.toContain("OPERATOR OBJECTIVE");
    expect(fullAutoKickoffText()).not.toContain("NEXT-GOALS MENU");
    expect(fullAutoCycleText(2)).not.toContain("OPERATOR OBJECTIVE");
    expect(fullAutoCycleText(2)).not.toContain("NEXT-GOALS MENU");
    expect(fullAutoCycleText(2)).not.toContain("STRATEGIST");
  });

  it("the kickoff carries the OPERATOR OBJECTIVE as the strategy boundary", () => {
    const text = fullAutoKickoffText({ objective: "establish the home QING economy" });
    expect(text).toContain("OPERATOR OBJECTIVE");
    expect(text).toContain("strategy boundary");
    expect(text).toContain("establish the home QING economy");
  });

  it("the cycle text carries the menu (with its recording cycle) + the objective; the strategist pick replaces the self-goaling ask", () => {
    const selfGoal = fullAutoCycleText(4, { objective: "grow CHOA", menu: ["settle at Phobos", "join Deimos"], menuCycle: 3 });
    expect(selfGoal).toContain("FULL-AUTO cycle 4");
    expect(selfGoal).toContain("NEXT-GOALS MENU");
    expect(selfGoal).toContain("recorded at cycle 3");
    expect(selfGoal).toContain("- settle at Phobos");
    expect(selfGoal).toContain("- join Deimos");
    expect(selfGoal).toContain("grow CHOA");
    expect(selfGoal).not.toContain("STRATEGIST");
    const picked = fullAutoCycleText(4, { goal: "settle at Phobos and journal the bars" });
    expect(picked).toContain("STRATEGIST layer picked");
    expect(picked).toContain("NEXT GOAL (the strategist's pick — execute it this cycle): settle at Phobos and journal the bars");
  });

  it("sanitizeObjective: strips controls, collapses whitespace, caps at OBJECTIVE_CAP", () => {
    expect(sanitizeObjective("  grow   the \u0007home QING  ")).toBe("grow the home QING");
    expect(sanitizeObjective("")).toBeNull();
    expect(sanitizeObjective("   ")).toBeNull();
    expect(sanitizeObjective("x".repeat(400))!.length).toBe(OBJECTIVE_CAP);
    expect(sanitizeObjective("x".repeat(400))!.endsWith("…")).toBe(true);
  });

  it("sanitizeNextGoals: keeps ≤ NEXT_GOALS_MAX clean one-liners, first-wins dedupe, drops junk", () => {
    expect(sanitizeNextGoals("not-an-array")).toEqual([]);
    expect(sanitizeNextGoals([])).toEqual([]);
    expect(sanitizeNextGoals(["  ", null, 42, "settle at Phobos", "settle at Phobos"])).toEqual(["settle at Phobos"]);
    const six = ["a", "b", "c", "d", "e", "f"];
    expect(sanitizeNextGoals(six)).toEqual(["a", "b", "c", "d", "e"]);
    expect(sanitizeNextGoals(six).length).toBe(NEXT_GOALS_MAX);
    const capped = sanitizeNextGoals(["g".repeat(400)]);
    expect(capped[0]!.length).toBe(NEXT_GOAL_CAP);
    expect(capped[0]!.endsWith("…")).toBe(true);
    expect(sanitizeNextGoals(["beat\u0000 the\u0001 venue"]).join()).toBe("beat the venue");
  });

  it("parseObjectiveWhisper: sets, clears, and ignores non-objective whispers", () => {
    expect(parseObjectiveWhisper("objective: settle everything at Phobos")).toEqual({ kind: "set", objective: "settle everything at Phobos" });
    expect(parseObjectiveWhisper("OBJECTIVE: grow the home QING economy")).toEqual({ kind: "set", objective: "grow the home QING economy" });
    expect(parseObjectiveWhisper("objective: clear")).toEqual({ kind: "clear" });
    expect(parseObjectiveWhisper("objective: none")).toEqual({ kind: "clear" });
    expect(parseObjectiveWhisper("objective:")).toEqual({ kind: "clear" });
    expect(parseObjectiveWhisper("objective:   ")).toEqual({ kind: "clear" });
    expect(parseObjectiveWhisper("the objective: is to settle")).toBeNull(); // the FIRST line must START with the keyword
    expect(parseObjectiveWhisper("whisper something else")).toBeNull();
  });

  it("parseStrategistGoal: the LAST GOAL: line wins, capped, null when absent", () => {
    expect(parseStrategistGoal("reasoning…\nGOAL: first idea\nmore reasoning\nGOAL: settle at Phobos")).toBe("settle at Phobos");
    expect(parseStrategistGoal("GOAL:   spaced pick  ")).toBe("spaced pick");
    expect(parseStrategistGoal("no pick here")).toBeNull();
    expect(parseStrategistGoal(null)).toBeNull();
    expect(parseStrategistGoal(`GOAL: ${"x".repeat(400)}`)!.length).toBe(STRATEGIST_GOAL_CAP);
  });

  it("strategistUserText: names the cycle, the objective (or its honest absence), the menu, the ledger rows", () => {
    const text = strategistUserText({
      nextCycle: 3,
      objective: "grow CHOA presence",
      menu: ["settle at Phobos"],
      menuCycle: 2,
      ledger: [
        { n: 1, kind: "run", status: "done", tokens: 130, sends: 1, summary: "surveyed and settled" },
        { n: 2, kind: "run", status: "done", tokens: 130, sends: 0, summary: null },
      ],
    });
    expect(text).toContain("cycle 3");
    expect(text).toContain("grow CHOA presence");
    expect(text).toContain("recorded at cycle 2");
    expect(text).toContain("- settle at Phobos");
    expect(text).toContain("#1 run done · 130 tok · 1 send — surveyed and settled");
    expect(text).toContain("#2 run done · 130 tok · 0 sends");
    const first = strategistUserText({ nextCycle: 1, objective: null, menu: null, menuCycle: null, ledger: [] });
    expect(first).toContain("(none set");
    expect(first).toContain("(none recorded");
    expect(first).toContain("(empty — this is the first cycle)");
  });

  it("the strategist's read-only set carries no act/chat/plan tools", () => {
    for (const banned of ["join_venue", "run_beat", "settle_venue", "create_venue", "send_chat", "send_world_chat", "dss_snipe", "propose_plan", "move_tokens", "journal_note", "next_goals"]) {
      expect(STRATEGIST_READ_TOOLS.has(banned)).toBe(false);
    }
    expect(STRATEGIST_READ_TOOLS.has("get_state")).toBe(true);
    expect(STRATEGIST_READ_TOOLS.has("search_venues")).toBe(true);
  });
});

describe("session-76: the engage-time CAPS MATH + the raised per-run default (the owner round)", () => {
  it("the per-run token default is 300k everywhere (the 150k default fenced fat first cycles into budget-stops)", () => {
    expect(DEFAULT_RUN_MAX_TOKENS).toBe(300_000);
    expect(DEFAULT_BUDGET.maxTokens).toBe(DEFAULT_RUN_MAX_TOKENS);
  });

  it("the default knobs name the honest math: 500k session ÷ 300k/run = 2 fat cycles, to 12 at the backstop", () => {
    const line = fullAutoCapsHint(300_000, 500_000, 12);
    expect(line).toContain("2 fat cycles at full burn");
    expect(line).toContain("500k session ÷ 300k/run");
    expect(line).toContain("to 12 at the backstop");
  });

  it("the observed fat-cycle range + the budget-stop caveat ride EVERY shape (the 484k datum still exceeds 300k)", () => {
    for (const line of [fullAutoCapsHint(300_000, 500_000, 12), fullAutoCapsHint(150_000, 0, 4), fullAutoCapsHint(1_000_000, 10_000_000, 8)]) {
      expect(line).toContain(FULL_AUTO_OBSERVED_CYCLE_TOKENS);
      expect(line).toContain("budget-stop disengage");
    }
  });

  it("session cap off → the backstop phrasing (no session math)", () => {
    const line = fullAutoCapsHint(150_000, 0, 4);
    expect(line).toContain("backstop 4 cycles");
    expect(line).toContain("no session cap (0 = off)");
    expect(line).not.toContain("session ÷");
  });

  it("the math ceils — a cap that buys a partial cycle still allows that cycle", () => {
    expect(fullAutoCapsHint(300_000, 700_000, 12)).toContain("3 fat cycles");
    expect(fullAutoCapsHint(300_000, 100_000, 12)).toContain("1 fat cycle");
    expect(fullAutoCapsHint(300_000, 2_500_000, 12)).toContain("2.5M session");
  });

  it("when the backstop binds before the session cap, the line says so (no phantom 334-cycle loops)", () => {
    const line = fullAutoCapsHint(300_000, 100_000_000, 12);
    expect(line).toContain("backstop binds first");
    expect(line).not.toContain("334 fat cycles");
  });

  it("the strategist suffix demands the GOAL: line EARLY and names the window in its own constants (the 75 chatty-model datum)", () => {
    expect(STRATEGIST_SYSTEM_SUFFIX).toContain("EARLY");
    expect(STRATEGIST_SYSTEM_SUFFIX).toContain(`${STRATEGIST_MAX_STEPS} model turns`);
    expect(STRATEGIST_SYSTEM_SUFFIX).toContain(`${STRATEGIST_MAX_TOKENS} tokens`);
    expect(STRATEGIST_SYSTEM_SUFFIX).toContain("falls back to self-goaling");
  });
});

describe("the chat cadence governor (§7.4 discipline in full-auto)", () => {
  afterEach(() => {
    resetHomeVenueForTests();
  });

  function ctxWith(governor: boolean): { ctx: AgentToolContext; gate: (send: boolean) => { ok: true } | { ok: false; error: string } } {
    let last = 0;
    const gate = (send: boolean): { ok: true } | { ok: false; error: string } => {
      if (!governor || !send) return { ok: true };
      const now = Date.now();
      const elapsed = now - last;
      if (last > 0 && elapsed < FULL_AUTO_CHAT_MIN_INTERVAL_MS) {
        return { ok: false, error: `FULL-AUTO chat cadence governor: wait` };
      }
      last = now;
      return { ok: true };
    };
    return {
      ctx: {
        rpcUrl: "http://127.0.0.1:9999",
        account: ACCT,
        snapshot: null,
        journal: new JournalBus(),
        walletMode: "C",
        chatToolsEnabled: true,
        gateDryRun: async () => {
          throw new Error("not exercised");
        },
        gateSend: async () => {
          throw new Error("not exercised");
        },
        refreshSnapshot: () => {},
        takeNote: () => {},
        simToolsEnabled: false,
        chatGate: governor ? gate : null,
      },
      gate,
    };
  }

  it("send_chat consults the governor before anything else (a refusal names it)", async () => {
    const { ctx } = ctxWith(true);
    const tool = toolByName("send_chat")!;
    // the first SEND consumes the cadence window (it fails later at the
    // identity gate — the governor already passed it, anti-spray conservative)
    const first = (await tool.execute({ message: "hi", send: true }, ctx)) as { error?: string };
    expect(first.error).toContain("LAU");
    // the second SEND within the window refuses AT THE GOVERNOR
    const out = (await tool.execute({ message: "again", send: true }, ctx)) as { error?: string };
    expect(out.error).toContain("cadence governor");
  });

  it("send_world_chat consults the same seam", async () => {
    const { ctx } = ctxWith(true);
    const tool = toolByName("send_world_chat")!;
    await tool.execute({ message: "hi", send: true }, ctx);
    const out = (await tool.execute({ message: "again", send: true }, ctx)) as { error?: string };
    expect(out.error).toContain("cadence governor");
  });

  it("DRYRUNs pass the governor free (only real send intent consumes cadence)", async () => {
    const { ctx } = ctxWith(true);
    const tool = toolByName("send_chat")!;
    const out = (await tool.execute({ message: "hi", send: false }, ctx)) as { error?: string };
    expect(out.error).not.toContain("cadence governor");
    expect(out.error).toContain("LAU");
  });

  it("without a governor the chat tools refuse on their own honest gates (no account state here)", async () => {
    const { ctx } = ctxWith(false);
    const tool = toolByName("send_chat")!;
    // chatToolsEnabled=true, governor absent → proceeds to the identity gate
    const out = (await tool.execute({ message: "hi" }, ctx)) as { error?: string };
    expect(out.error).toContain("LAU");
  });
});
