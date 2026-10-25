import { beforeEach, describe, expect, it } from "vitest";
import { JournalBus } from "@/chain/journal";
import { subscribeRunEvents } from "@/agent/events";
import type { RunEvent } from "@/agent/graph";
import type { AgentToolContext } from "@/agent/tools";
import { executePlan } from "@/agent/planRunner";
import { approvePlan, clearPlan, currentPlan, proposePlan, stopPlan } from "@/state/planStore";

/**
 * The L1 plan runner (§7.8/§7.11.4): the approved checklist executes
 * verbatim (send injected ONLY from the declared flag), per-step RunEvents
 * hit the lifted bus (the deck's auto-surface), and the stop-conditions —
 * step error, send outcome ≠ sent, user STOP, abort — roll back to L0 with
 * remaining steps skipped.
 */

const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as const;
const LAU = "0x1111111111111111111111111111111111111111" as const;
const VENUE = "0xb0ba7d36b7f0505879179ece7401f24eb653c6e1";

type SendOutcome = { status: string } & Record<string, unknown>;

function fakeCtx(sendOutcome: () => SendOutcome = () => ({ status: "sent" })): AgentToolContext & { gateSends: unknown[] } {
  const gateSends: unknown[] = [];
  const ctx: AgentToolContext = {
    rpcUrl: "http://127.0.0.1:9999",
    account: ACCT,
    snapshot: {
      account: ACCT,
      lau: LAU,
      yue: null,
      lauName: "T",
      lauSymbol: "TL",
      username: "captain",
      yueName: null,
      yueSymbol: null,
      balances: { pls: { wallet: 1n, lau: 0n, yue: 0n }, affection: { wallet: 0n, lau: 0n, yue: 0n }, choa: { wallet: 0n, lau: 0n, yue: 0n } },
      yuanChoa: 0n,
      blockNumber: 27_674_000n,
      fetchedAt: Date.now(),
    },
    journal: new JournalBus(),
    walletMode: "B",
    chatToolsEnabled: false,
    gateDryRun: async () => {
      throw new Error("plan send steps call gateSend, never bare dryRun");
    },
    gateSend: async (req) => {
      gateSends.push(req);
      const out = sendOutcome();
      // the real tools unpack gate outcomes — carry the fields they read
      if (out.status === "sent") {
        return {
          status: "sent",
          envelope: {} as never,
          txHash: "0xplansent",
          receipt: { status: "success", gasUsed: 600_000n, logs: [], blockNumber: 27_674_001n, contractAddress: null },
          receiptError: null,
          movements: [],
          capBreaches: [],
        } as never;
      }
      if (out.status === "sim-failed") {
        return {
          status: "sim-failed",
          envelope: { sim: { ok: false, result: null, gas: null, error: { message: "revert", decoded: "PayCover()", data: null } } } as never,
        } as never;
      }
      return out as never;
    },
    refreshSnapshot: () => {},
    takeNote: () => {},
    simToolsEnabled: false,
  };
  return Object.assign(ctx, { gateSends });
}

const idle = new AbortController();

beforeEach(() => {
  clearPlan();
});

describe("happy path", () => {
  it("executes the checklist verbatim, emits per-step RunEvents on the bus, finishes done", async () => {
    const res = proposePlan("kb tour", [
      { tool: "search_kb", args: { query: "venue" } },
      { tool: "show_widget", args: { kind: "kb_excerpt", query: "venue" } },
    ]);
    approvePlan(res.plan!.id);
    const seen: RunEvent[] = [];
    const unsub = subscribeRunEvents((e) => seen.push(e));
    const out = await executePlan(currentPlan()!, fakeCtx(), new JournalBus(), idle.signal);
    unsub();

    expect(out.status).toBe("done");
    expect(out.steps).toEqual([
      { tool: "search_kb", ok: true },
      { tool: "show_widget", ok: true },
    ]);
    expect(currentPlan()!.status).toBe("done");
    expect(currentPlan()!.steps.every((s) => s.status === "ok")).toBe(true);
    // the lifted bus carried tool-call/tool-result per step (deck auto-surface path)
    expect(seen.filter((e) => e.type === "tool-call").map((e) => (e as { name: string }).name)).toEqual(["search_kb", "show_widget"]);
    expect(seen.filter((e) => e.type === "tool-result")).toHaveLength(2);
    // the §7.10 record shape: tool names + outcomes, never args/payloads
    expect(out.record).toMatchObject({ kind: "plan", goal: "kb tour", outcome: "done", tokens: 0 });
    expect(out.record.steps).toEqual(out.steps);
  });

  it("injects send:true ONLY for declared-SEND steps and routes them through the gate", async () => {
    const res = proposePlan("join flow", [
      { tool: "join_venue", args: { address: VENUE }, sends: true },
    ]);
    approvePlan(res.plan!.id);
    const ctx = fakeCtx();
    const out = await executePlan(currentPlan()!, ctx, new JournalBus(), idle.signal);
    expect(out.status).toBe("done");
    expect(ctx.gateSends).toHaveLength(1);
    expect(out.steps[0]!.ok).toBe(true);
  });

  it("65.1: a sends-step answered by a benign NO-OP satisfies the step (register's already-registered — SEI.Start Enters)", async () => {
    // the default fakeCtx snapshot carries lau = LAU → register answers
    // already-registered (noop) with NO gate send — the plan must COMPLETE,
    // not stop on "did not send" (the send was never needed)
    const res = proposePlan("finish registration", [
      { tool: "register", args: {}, sends: true },
    ]);
    approvePlan(res.plan!.id);
    const ctx = fakeCtx();
    const out = await executePlan(currentPlan()!, ctx, new JournalBus(), idle.signal);
    expect(out.status).toBe("done");
    expect(ctx.gateSends).toHaveLength(0); // nothing to send — the goal was already true
    expect(out.steps[0]!.ok).toBe(true);
    expect(currentPlan()!.status).toBe("done");
  });
});

describe("stop-conditions → stopped + rollback-to-L0", () => {
  it("a failing read step stops the plan; remaining steps are skipped", async () => {
    const res = proposePlan("doomed", [
      { tool: "read_contract", args: { contract: "NOSUCH", function: "Foo" } },
      { tool: "search_kb", args: { query: "never reached" } },
    ]);
    approvePlan(res.plan!.id);
    const out = await executePlan(currentPlan()!, fakeCtx(), new JournalBus(), idle.signal);
    expect(out.status).toBe("stopped");
    expect(out.stopReason).toContain("step 1");
    const p = currentPlan()!;
    expect(p.status).toBe("stopped");
    expect(p.steps[0]!.status).toBe("err");
    expect(p.steps[1]!.status).toBe("skipped");
    expect(out.record.outcome).toBe("stopped");
    expect(out.record.lesson).toBe(out.stopReason);
  });

  it("a send outcome ≠ sent stops the plan (approval rejected → aborted)", async () => {
    const res = proposePlan("join", [{ tool: "join_venue", args: { address: VENUE }, sends: true }]);
    approvePlan(res.plan!.id);
    const out = await executePlan(currentPlan()!, fakeCtx(() => ({ status: "aborted", reason: "rejected in approval card" })), new JournalBus(), idle.signal);
    expect(out.status).toBe("stopped");
    expect(out.stopReason).toContain("did not send");
    expect(currentPlan()!.steps[0]!.status).toBe("err");
  });

  it("the DRYRUN-revert guard: sim-failed send outcomes stop the plan (no overrides inside plans)", async () => {
    const res = proposePlan("beat", [{ tool: "run_beat", args: { waat: "5" }, sends: true }]);
    approvePlan(res.plan!.id);
    const out = await executePlan(currentPlan()!, fakeCtx(() => ({ status: "sim-failed" })), new JournalBus(), idle.signal);
    expect(out.status).toBe("stopped");
    expect(out.stopReason).toContain("did not send");
    expect(out.stopReason).toContain("DRYRUN reverted");
  });

  it("no-signer counts as a stop too (the honest cannot-send case)", async () => {
    const res = proposePlan("join", [{ tool: "join_venue", args: { address: VENUE }, sends: true }]);
    approvePlan(res.plan!.id);
    const out = await executePlan(currentPlan()!, fakeCtx(() => ({ status: "no-signer" })), new JournalBus(), idle.signal);
    expect(out.status).toBe("stopped");
  });

  it("the user's STOP between steps halts the run (honored before the next step)", async () => {
    const res = proposePlan("stoppable", [
      { tool: "search_kb", args: { query: "one" } },
      { tool: "search_kb", args: { query: "two" } },
      { tool: "search_kb", args: { query: "three" } },
    ]);
    approvePlan(res.plan!.id);
    const plan = currentPlan()!;
    let stopped = false;
    const unsub = subscribeRunEvents((e) => {
      if (e.type === "tool-result" && !stopped) {
        stopped = true;
        stopPlan("user STOP"); // the human hits STOP while step 1 just finished
      }
    });
    const out = await executePlan(plan, fakeCtx(), new JournalBus(), idle.signal);
    unsub();
    expect(out.status).toBe("stopped");
    expect(out.stopReason).toContain("user STOP");
    expect(out.steps).toHaveLength(1); // steps 2+3 never ran
    expect(currentPlan()!.steps[2]!.status).toBe("skipped");
  });

  it("an aborted signal stops before any step runs", async () => {
    const res = proposePlan("aborted", [{ tool: "search_kb" }]);
    approvePlan(res.plan!.id);
    const ac = new AbortController();
    ac.abort();
    const out = await executePlan(currentPlan()!, fakeCtx(), new JournalBus(), ac.signal);
    expect(out.status).toBe("stopped");
    expect(out.steps).toHaveLength(0);
    expect(currentPlan()!.steps[0]!.status).toBe("skipped");
  });
});

describe("journaled as agent.*", () => {
  it("emits agent.plan lines the SYS feed renders", async () => {
    const journal = new JournalBus();
    const lines: string[] = [];
    journal.subscribe((e) => lines.push(`${e.kind} ${e.line}`));
    const res = proposePlan("journaled", [{ tool: "search_kb" }]);
    approvePlan(res.plan!.id);
    await executePlan(currentPlan()!, fakeCtx(), journal, idle.signal);
    expect(lines.some((l) => l.startsWith("agent.plan") && l.includes("running"))).toBe(true);
    expect(lines.some((l) => l.startsWith("agent.plan") && l.includes("done"))).toBe(true);
    expect(lines.filter((l) => l.startsWith("agent.tool") && l.includes("plan step"))).toHaveLength(2);
  });

  it("tool errors surface in the pane through the bus with ok=false", async () => {
    const res = proposePlan("visible failure", [{ tool: "read_contract", args: { contract: "NOSUCH", function: "Foo" } }]);
    approvePlan(res.plan!.id);
    const results: Array<Extract<RunEvent, { type: "tool-result" }>> = [];
    const unsub = subscribeRunEvents((e) => {
      if (e.type === "tool-result") results.push(e);
    });
    await executePlan(currentPlan()!, fakeCtx(), new JournalBus(), idle.signal);
    unsub();
    expect(results[0]!.ok).toBe(false);
  });
});
