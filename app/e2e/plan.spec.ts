import { expect, test, type Page } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

/**
 * L1 PLAN AUTONOMY e2e (session-47, IA-PLAN §7.8/§7.11.4) + the §7.10
 * journal: a routed turn PROPOSES a plan, the DECK renders the plan envelope
 * (per-step preview + SEND badges), approve-once executes the scripted steps
 * with per-step widgets, a failing step stops the checklist and rolls back
 * to L0, and the memory (facts + runs) persists across a reload into the
 * system layer. No network: OpenRouter is routed, the RPC is dead (pure
 * client-side tools only).
 */

interface CapturedCompletion {
  model: string;
  messages: Array<{ role: string; content: string | null }>;
  tools?: Array<{ function: { name: string } }>;
}

async function routeOpenRouter(
  page: Page,
  script: Array<{ text?: string; reasoning?: string; toolCall?: { id: string; name: string; args: string } }>
): Promise<Array<CapturedCompletion>> {
  const captured: CapturedCompletion[] = [];
  let i = 0;
  await page.route("**openrouter.ai/api/v1/chat/completions", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as CapturedCompletion;
    captured.push(body);
    const step = script[Math.min(i, script.length - 1)]!;
    i += 1;
    const message: Record<string, unknown> = {};
    if (step.toolCall) {
      message.tool_calls = [{ id: step.toolCall.id, type: "function", function: { name: step.toolCall.name, arguments: step.toolCall.args } }];
    }
    if (step.text !== undefined) message.content = step.text;
    else if (!step.toolCall) message.content = "";
    if (step.reasoning !== undefined) message.reasoning = step.reasoning;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [{ message, finish_reason: step.toolCall ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
      }),
    });
  });
  return captured;
}

const DEAD_RPC = "/?rpc=http://127.0.0.1:9999";

async function activateByok(page: Page): Promise<void> {
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
  await page.getByTestId("agent-remember").check();
  await page.getByTestId("agent-save").click();
}

test.describe("L1 plan autonomy on the DECK", () => {
  test("a routed turn proposes → the deck renders → approve-once executes with per-step widgets", async ({ page }) => {
    await routeOpenRouter(page, [
      {
        text: "▸ plan: propose the KB tour as an L1 plan.",
        toolCall: {
          id: "p1",
          name: "propose_plan",
          args: JSON.stringify({
            goal: "KB venue tour on the deck",
            steps: [
              { tool: "search_kb", args: { query: "venue bouncer" }, note: "pull the venue facts" },
              { tool: "show_widget", args: { kind: "kb_excerpt", query: "venue bouncer" }, note: "pin the excerpt" },
            ],
          }),
        },
      },
      { text: "plan is on the deck — approve it once." },
    ]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await activateByok(page);

    await page.getByTestId("rail-deck").click();
    await page.getByTestId("agent-input").fill("tour the venue KB for me");
    await page.getByTestId("agent-exec").click();

    // the plan envelope surfaces with the per-step preview (the agent's bay)
    const planCell = page.getByTestId("deck-grid").locator('[data-kind="plan"]');
    await expect(planCell).toBeVisible({ timeout: 15_000 });
    await expect(planCell.getByTestId("widget-plan-status")).toHaveText("AWAITING APPROVAL");
    const steps = planCell.getByTestId("widget-plan-steps");
    await expect(steps).toContainText("1. search_kb");
    await expect(steps).toContainText("2. show_widget");
    await expect(steps).toContainText("pull the venue facts");

    // approve ONCE — the checklist executes with no further model turns; a
    // LIVE plan PROTECTS its bay (session-63): the run's own step surfaces
    // refuse honestly instead of churning the checklist out
    await planCell.getByTestId("widget-plan-approve").click();
    await expect(planCell.getByTestId("widget-plan-status")).toHaveText("DONE", { timeout: 15_000 });
    await expect(page.getByTestId("deck-grid").locator('[data-kind="plan"]')).toBeVisible(); // held its bay

    // the per-step spine carried the run (the task_graph bay is the designed
    // instrument for step visibility during a plan)
    const spine = page.getByTestId("deck-grid").locator('[data-slot="col3-top"]');
    await expect(spine).toHaveAttribute("data-kind", "task_graph");
    await expect(spine.getByTestId("widget-taskgraph")).toContainText("search_kb", { timeout: 10_000 });
    // the pane narrates the execution
    await expect(page.getByTestId("agent-chat")).toContainText("PLAN approved", { timeout: 10_000 });
    await expect(page.getByTestId("agent-chat")).toContainText("PLAN done", { timeout: 10_000 });
  });

  test("a failing step stops the checklist and rolls back to L0 (remaining steps skipped)", async ({ page }) => {
    await routeOpenRouter(page, [
      {
        toolCall: {
          id: "p2",
          name: "propose_plan",
          args: JSON.stringify({
            goal: "doomed tour",
            steps: [
              { tool: "search_kb", args: { query: "ladder" }, note: "ok step" },
              { tool: "read_contract", args: { contract: "NOSUCH", function: "Foo" }, note: "this one fails" },
              { tool: "search_kb", args: { query: "never" }, note: "never reached" },
            ],
          }),
        },
      },
      { text: "proposed." },
    ]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await activateByok(page);

    await page.getByTestId("rail-deck").click();
    await page.getByTestId("agent-input").fill("run the doomed plan");
    await page.getByTestId("agent-exec").click();

    const planCell = page.getByTestId("deck-grid").locator('[data-kind="plan"]');
    await expect(planCell).toBeVisible({ timeout: 15_000 });
    await planCell.getByTestId("widget-plan-approve").click();

    await expect(planCell.getByTestId("widget-plan-status")).toHaveText("STOPPED — L0", { timeout: 15_000 });
    await expect(planCell.getByTestId("widget-plan-stopped")).toContainText("rolled back to L0");
    await expect(planCell.getByTestId("widget-plan-steps")).toContainText("[-] 3. search_kb"); // skipped
    await expect(page.getByTestId("agent-chat")).toContainText("PLAN STOPPED", { timeout: 10_000 });
  });

  test("SEND steps are badged and an unsignable send stops the plan honestly", async ({ page }) => {
    await routeOpenRouter(page, [
      {
        toolCall: {
          id: "p3",
          name: "propose_plan",
          args: JSON.stringify({
            goal: "join without a wallet",
            steps: [{ tool: "join_venue", args: { address: "0xb0ba7d36b7f0505879179ece7401f24eb653c6e1" }, sends: true, note: "needs an account" }],
          }),
        },
      },
      { text: "proposed." },
    ]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await activateByok(page);

    await page.getByTestId("rail-deck").click();
    await page.getByTestId("agent-input").fill("join phobos");
    await page.getByTestId("agent-exec").click();

    const planCell = page.getByTestId("deck-grid").locator('[data-kind="plan"]');
    await expect(planCell).toBeVisible({ timeout: 15_000 });
    await expect(planCell.getByTestId("widget-plan-steps")).toContainText("SEND");
    // the conservative-default hint is on the envelope BEFORE approval
    await expect(planCell).toContainText("per-tx approval card");

    await planCell.getByTestId("widget-plan-approve").click();
    await expect(planCell.getByTestId("widget-plan-status")).toHaveText("STOPPED — L0", { timeout: 15_000 });
    await expect(planCell.getByTestId("widget-plan-steps")).toContainText("no account"); // the honest error
  });

  test("§7.10 memory: facts persist across a reload and inject into the system layer; runs land in the SYS ledger", async ({ page }) => {
    await routeOpenRouter(page, [{ text: "ack." }]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await activateByok(page);

    // write the operator facts through the SYS tab (wait for the IDB ack —
    // a reload racing the commit would drop the write)
    await page.getByTestId("agent-tab-sys").click();
    const facts = page.getByTestId("sys-memory-facts");
    await facts.fill("operator prefers the Phobos venue; keep Beat previews DRYRUN-first");
    await page.getByTestId("sys-memory-save").click();
    await expect(page.getByTestId("sys-memory-saved")).toBeVisible({ timeout: 5_000 });

    // reload — facts + the previous session's runs must survive
    await page.reload();
    await page.getByTestId("rail-deck").click();
    await page.getByTestId("agent-input").fill("ping");
    await page.getByTestId("agent-exec").click();
    await expect(page.getByTestId("agent-answer").last()).toContainText("ack.", { timeout: 15_000 });

    // SYS shows the session ledger growing (this turn is run #1 of THIS session)
    await page.getByTestId("agent-tab-sys").click();
    await expect(page.getByTestId("sys-memory-summary")).toContainText("session memory injected", { timeout: 10_000 });
    await expect(page.getByTestId("sys-runs")).toContainText("ping → done", { timeout: 10_000 });
  });
});

test.describe("§7.10 session-start injection (routed capture)", () => {
  test("facts written last session ride into the next session's system messages", async ({ page }) => {
    const captured = await routeOpenRouter(page, [
      { text: "▸ plan: search the KB first.", toolCall: { id: "m1", name: "search_kb", args: JSON.stringify({ query: "phobos" }) } },
      { text: "done" },
    ]);

    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await activateByok(page);

    // write facts, then start a NEW session (reload only after the IDB ack)
    await page.getByTestId("agent-tab-sys").click();
    await page.getByTestId("sys-memory-facts").fill("operator prefers Phobos");
    await page.getByTestId("sys-memory-save").click();
    await expect(page.getByTestId("sys-memory-saved")).toBeVisible({ timeout: 5_000 });
    await page.reload();
    await page.getByTestId("rail-deck").click();

    await page.getByTestId("agent-input").fill("where should I hang out");
    await page.getByTestId("agent-exec").click();
    await expect(page.getByTestId("agent-answer").last()).toContainText("done", { timeout: 15_000 });

    // the system layer AFTER the fixed core: messages[0] = core+persona, then SESSION_MEMORY
    expect(captured.length).toBeGreaterThan(0);
    const msgs = captured[0]!.messages;
    expect(msgs[0]!.role).toBe("system");
    expect(String(msgs[0]!.content)).toContain("AI core of Dysnomia Terminal");
    const mem = msgs.find((m) => String(m.content ?? "").startsWith("SESSION_MEMORY"));
    expect(mem, "session memory must inject after the fixed core").toBeDefined();
    expect(String(mem!.content)).toContain("operator prefers Phobos");
  });
});
