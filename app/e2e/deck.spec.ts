import { expect, test, type Page } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

/**
 * THE DECK e2e (session-46; the session-63 SLOT REDESIGN re-pin): the
 * agent workspace as a semi-fixed instrument panel — 4 typed bays + the
 * identity chrome column, per-slot picker/lock/clear, routing (auto +
 * agent-directed), and the fleet surface OFF-DECK on SYS. OpenRouter is
 * ROUTED (scripted completions — no network, no real key); the dead RPC
 * keeps chain reads honest.
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

async function connectWallet(page: Page): Promise<void> {
  // the connectA idiom (gate.spec): settings → mode A → the mock provider
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("mode-a").click();
  await page.getByTestId("connect-io.dysnomia.mox").click();
  await expect(page.getByTestId("wallet-account")).toContainText("0xf39Fd6");
}

const BAYS = ["col2-top", "col2-bottom", "col3-top", "col3-bottom"] as const;

test.describe("THE DECK (the agent workspace)", () => {
  test("fresh storage seeds the default slot map; the composition persists across reload", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await expect(page.getByTestId("view-deck")).toBeVisible({ timeout: 10_000 });
    const grid = page.getByTestId("deck-grid");
    // the default composition: onboarding (pre-completion) / map / run spine / chat tail
    for (const [slot, kind] of [
      ["col2-top", "onboarding"],
      ["col2-bottom", "map_focus"],
      ["col3-top", "task_graph"],
      ["col3-bottom", "chat_monitor"],
    ] as const) {
      await expect(grid.locator(`[data-slot="${slot}"]`)).toHaveAttribute("data-kind", kind, { timeout: 15_000 });
    }
    // seeded locks: three bays LOCKED (toggle reads UNLOCK), the agent's bay free
    for (const slot of ["col2-top", "col2-bottom", "col3-top"]) {
      await expect(grid.locator(`[data-slot="${slot}"]`).getByTestId("deck-bay-lock")).toHaveText("UNLOCK");
    }
    await expect(grid.locator('[data-slot="col3-bottom"]').getByTestId("deck-bay-lock")).toHaveText("LOCK");
    await expect(grid.locator('[data-slot="col3-top"] .bay-origin')).toContainText("default");
    await page.reload();
    await expect(page.getByTestId("view-deck")).toBeVisible({ timeout: 10_000 });
    for (const [slot, kind] of [
      ["col2-top", "onboarding"],
      ["col2-bottom", "map_focus"],
      ["col3-top", "task_graph"],
      ["col3-bottom", "chat_monitor"],
    ] as const) {
      await expect(grid.locator(`[data-slot="${slot}"]`)).toHaveAttribute("data-kind", kind, { timeout: 15_000 });
    }
  });

  test("session-63 slot layout: identity column + col2 (wider) / col3, short tops + tall bottoms, page never scrolls", async ({
    page,
  }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await expect(page.getByTestId("view-deck")).toBeVisible({ timeout: 10_000 });
    const grid = page.getByTestId("deck-grid");
    for (const slot of BAYS) {
      await expect(grid.locator(`[data-slot="${slot}"]`)).toBeVisible({ timeout: 15_000 });
    }

    // GEOMETRY (not computed spans): the identity column sits left (~300px),
    // col2 is slightly wider than col3, the top row is SHORTER than the
    // bottom row, and the whole deck fits the viewport height
    const geo = await page.getByTestId("view-deck").evaluate((el) => {
      const layout = el.querySelector<HTMLElement>(".deck-layout")!.getBoundingClientRect();
      const gridEl = el.querySelector<HTMLElement>(".deck-grid")!.getBoundingClientRect();
      const box = (sel: string) => {
        const c = el.querySelector<HTMLElement>(sel)!.getBoundingClientRect();
        return { left: c.left - gridEl.left, top: c.top - gridEl.top, width: c.width, height: c.height };
      };
      const passport = el.querySelector<HTMLElement>(".deck-passport")!.getBoundingClientRect();
      return {
        layoutW: layout.width,
        gridW: gridEl.width,
        gridH: gridEl.height,
        passportW: passport.width,
        passportLeftOfGrid: gridEl.left - passport.right,
        top: box('[data-slot="col2-top"]'),
        bottom: box('[data-slot="col2-bottom"]'),
        col3Top: box('[data-slot="col3-top"]'),
      };
    });
    expect(geo.passportW).toBeGreaterThan(240); // the identity column, not a sliver
    expect(geo.passportLeftOfGrid).toBeGreaterThan(0);
    expect(geo.top.width).toBeGreaterThan(geo.col3Top.width); // col2 slightly wider
    expect(geo.bottom.height).toBeGreaterThan(geo.top.height * 1.3); // tall bottoms
    expect(geo.top.left).toBeLessThan(8); // col2 flush left of the bay field

    // the deck page never overflow-scrolls at desktop: overflow lives INSIDE bays
    const fits = await page.getByTestId("view-deck").evaluate((el) => el.scrollHeight <= el.clientHeight);
    expect(fits).toBe(true);
    const mainFits = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".deck-main");
      return el !== null && el.scrollHeight <= el.clientHeight;
    });
    expect(mainFits).toBe(true);

    // the compact atlas variant drives the map bay
    await expect(grid.locator('[data-slot="col2-bottom"]').getByTestId("atlas-hud-compact")).toBeVisible();
  });

  test("the bay picker places fitting kinds only; lock freezes a bay against routing", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await expect(page.getByTestId("view-deck")).toBeVisible({ timeout: 10_000 });
    const grid = page.getByTestId("deck-grid");
    const top = grid.locator('[data-slot="col2-top"]');

    // the SHORT bay's picker offers short kinds — never the tall venue/kb kinds
    const options = await top.getByTestId("deck-bay-picker").locator("option").evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
    expect(options).toContain("yuan_ledger");
    expect(options).toContain("beat_sim");
    expect(options).not.toContain("venue");
    expect(options).not.toContain("kb_excerpt");
    // onboarding drops out of the picker once the chain is complete — and in
    // the fresh default it is offered (the seeded state)
    expect(options).toContain("onboarding");

    // pick the ledger into the bay (the operator's swap, post-onboarding shape)
    // — no wallet connected, so the widget renders its honest no-state hint
    await top.getByTestId("deck-bay-picker").selectOption("yuan_ledger");
    await expect(top).toHaveAttribute("data-kind", "yuan_ledger");
    await expect(top.locator(".bay-body")).toContainText("no player state");

    // clear via the frame ✕ → the honest empty bay
    await top.getByTestId("deck-bay-clear").click();
    await expect(top).toHaveAttribute("data-kind", "empty");

    // the seeded map bay is LOCKED: the agent may not take it (rights)
    const mapBay = grid.locator('[data-slot="col2-bottom"]');
    await expect(mapBay.getByTestId("deck-bay-lock")).toHaveText("UNLOCK");
  });

  test("honest empty state after clearing every bay", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await expect(page.getByTestId("view-deck")).toBeVisible({ timeout: 10_000 });
    const grid = page.getByTestId("deck-grid");
    for (const slot of BAYS) {
      await grid.locator(`[data-slot="${slot}"]`).getByTestId("deck-bay-clear").click();
    }
    await expect(page.getByTestId("deck-empty")).toBeVisible();
    await expect(page.getByTestId("deck-empty")).toContainText(/agent offline|deck standing by/);
    await expect(page.getByTestId("deck-empty-map")).toBeVisible();
    await expect(page.getByTestId("deck-empty-chat")).toBeVisible();
    await expect(page.getByTestId("deck-empty-identity")).toBeVisible();
    // reset reseeds the default composition
    await page.getByTestId("deck-reset").click();
    await expect(grid.locator('[data-slot="col2-bottom"]')).toHaveAttribute("data-kind", "map_focus");
    await expect(grid.locator('[data-slot="col3-top"]')).toHaveAttribute("data-kind", "task_graph");
  });

  test("the identity column: NO OPERATOR without a wallet; rows raise after connect; the constellation block answers", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await expect(page.getByTestId("view-deck")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("passport-nooperator")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("passport-connect")).toBeVisible();

    await connectWallet(page);
    // connectWallet ends on SETTINGS — back to the deck the pane lives on
    await page.getByTestId("rail-deck").click();
    await expect(page.getByTestId("view-deck")).toBeVisible({ timeout: 10_000 });
    // dead RPC: the snapshot read fails honestly, but the pane tracks the
    // connected account (row + copy affordance + the constellation's honest error)
    await expect(page.getByTestId("passport-copy-wallet")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("passport-copy-wallet")).toContainText("0x");
    await expect(page.getByTestId("passport-nooperator")).toHaveCount(0);
    // session-66: the STATUS block — home QING + the DSS rows, honestly empty
    // on a dead RPC (no LAU discovered → "needs a LAU", no deploy affordance)
    await expect(page.getByTestId("passport-status")).toBeVisible();
    await expect(page.getByTestId("passport-home-qing")).toHaveText("not claimed");
    await expect(page.getByTestId("passport-dss")).toHaveText("needs a LAU");
    await expect(page.getByTestId("passport-dss-deploy")).toHaveCount(0);
    // session-64.1: the constellation lives in the yuan LEDGER bay (the
    // money bay — the owner's call), not the identity column — raise the
    // ledger through the bay picker and the power block answers there
    await expect(page.getByTestId("passport-power")).toHaveCount(0);
    const grid = page.getByTestId("deck-grid");
    await grid.locator('[data-slot="col2-top"]').getByTestId("deck-bay-picker").selectOption("yuan_ledger");
    await expect(grid.locator('[data-slot="col2-top"]').getByTestId("widget-yuan-power")).toBeVisible({ timeout: 10_000 });
  });

  test("session-64.1: the identity column SURVIVES view switches (the disappearing-content report)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await connectWallet(page);
    await page.getByTestId("rail-deck").click();

    // connected + read: the copy rows + the SAAT block render
    await expect(page.getByTestId("passport-copy-wallet")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("passport-copy-wallet")).toContainText("0x");
    await expect(page.getByTestId("passport-saat")).toBeVisible();

    // leave the deck for two other views, come back — the column must not
    // empty (stale-while-revalidate: refreshes keep the last good reads)
    await page.getByTestId("rail-map").click();
    await page.getByTestId("rail-identity").click();
    await page.getByTestId("rail-deck").click();
    await expect(page.getByTestId("deck-grid")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("passport-copy-wallet")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("passport-copy-wallet")).toContainText("0x");
    await expect(page.getByTestId("passport-saat")).toBeVisible();
    await expect(page.getByTestId("passport-nooperator")).toHaveCount(0);
  });

  test("the onboarding bay: checklist + the AGENT, ONBOARD ME handoff composes the chain into the core", async ({ page }) => {
    const captured = await routeOpenRouter(page, [{ text: "starting onboarding — first, your state." }]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await connectWallet(page);
    await activateByok(page);
    await page.getByTestId("rail-deck").click();

    const top = page.getByTestId("deck-grid").locator('[data-slot="col2-top"]');
    await expect(top.locator('[data-testid="onboarding-steps"]')).toBeVisible({ timeout: 10_000 });
    await expect(top.locator('[data-testid="onboarding-steps"]')).toContainText("connect an account");
    // session-64: the FOUR-step chain — the register step renders, the
    // Username copy says BYTES (the onchain cap is bytes, not chars)
    await expect(top.locator('[data-testid="onboarding-step-register"]')).toBeVisible();
    await expect(top.locator('[data-testid="onboarding-step-username"]')).toContainText("12 bytes");
    await expect(top.locator('[data-testid="onboarding-step-username"]')).not.toContainText("12 chars");
    await expect(top.getByTestId("onboarding-agent-handoff")).toBeVisible({ timeout: 10_000 });
    await top.getByTestId("onboarding-agent-handoff").click();
    await expect(page.getByTestId("agent-answer").last()).toContainText("starting onboarding", { timeout: 15_000 });
    // the composed handoff prompt is the turn's goal — the FOUR-step chain +
    // the DRYRUN/commit honesty clauses, verbatim
    const goal = captured[0]!.messages.find((m) => m.role === "user" && (m.content ?? "").includes("onboard me end to end"))?.content ?? "";
    expect(goal).toContain("register me (CHOA.Play)");
    expect(goal).toContain("State plainly whenever nothing has been sent yet");
    expect(goal).toContain("after each committed send confirm what changed");
  });

  test("a routed turn routes surfaces into bays and renders the intent line (old-site tool idiom in the pane)", async ({ page }) => {
    await routeOpenRouter(page, [
      { text: "▸ plan: search the KB for venue facts before answering.", toolCall: { id: "c1", name: "search_kb", args: JSON.stringify({ query: "venue bouncer" }) } },
      { text: "A QING wraps an ERC-20 through MAP (guide/venues.md)." },
    ]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await activateByok(page);

    await page.getByTestId("rail-deck").click();
    await expect(page.getByTestId("view-deck")).toBeVisible();
    await page.getByTestId("agent-input").fill("what is a venue?");
    await page.getByTestId("agent-exec").click();

    // the pane renders the ▸ plan: intent line + the old-site tool idiom
    await expect(page.getByTestId("agent-intent")).toContainText("search the KB", { timeout: 15_000 });
    await expect(page.getByTestId("agent-toolcall").first()).toContainText("CALLING TOOL: search_kb", { timeout: 15_000 });
    await expect(page.getByTestId("agent-toolresult").first()).toContainText("TOOL RESULT: search_kb ok");

    // the deck routed: the run spine keeps its bay; the KB excerpt takes the
    // agent's bay (corpus-evolution-robust: any REAL corpus source)
    const grid = page.getByTestId("deck-grid");
    await expect(grid.locator('[data-slot="col3-top"]')).toHaveAttribute("data-kind", "task_graph", { timeout: 15_000 });
    const kb = grid.locator('[data-kind="kb_excerpt"]');
    await expect(kb).toBeVisible({ timeout: 15_000 });
    await expect(kb).toContainText(/(guide\/|kb\/|contract-facts)/);
  });

  test("session-64 task-graph pairing: ONE row per tool call (no call/result duplicates); soft refusals mark [x]", async ({ page }) => {
    await routeOpenRouter(page, [
      { text: "▸ plan: read the KB, then try the (ungated) sweep to show honest refusals.", toolCall: { id: "p1", name: "search_kb", args: JSON.stringify({ query: "venue bouncer" }) } },
      { toolCall: { id: "p2", name: "sweep_lau", args: JSON.stringify({ token: "CHOA", amount: "1" }) } },
      { text: "the sweep refused honestly — no LAU on this chain." },
    ]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await connectWallet(page);
    await activateByok(page);

    await page.getByTestId("rail-deck").click();
    await page.getByTestId("agent-input").fill("pair the graph please");
    await page.getByTestId("agent-exec").click();
    await expect(page.getByTestId("agent-answer").last()).toContainText("refused honestly", { timeout: 15_000 });

    // the fold: 2 calls → 2 rows — search_kb [v], sweep_lau [x] (the soft
    // refusal arrives ok=true WITH an error payload; both are failures in truth)
    const steps = page.getByTestId("deck-grid").locator('[data-slot="col3-top"]').locator('[data-testid="taskgraph-steps"] > li');
    await expect(steps).toHaveCount(2, { timeout: 15_000 });
    await expect(steps.nth(0)).toContainText("search_kb");
    await expect(steps.nth(0)).toContainText("[v]");
    await expect(steps.nth(0)).not.toContainText("[x]");
    await expect(steps.nth(1)).toContainText("sweep_lau");
    await expect(steps.nth(1)).toContainText("[x]");
  });

  test("agent-directed surfacing: show_widget routes (or takes a rights-validated slot); focus_map ensures the map bay", async ({ page }) => {
    await routeOpenRouter(page, [
      { toolCall: { id: "d1", name: "show_widget", args: JSON.stringify({ kind: "kb_excerpt", query: "beat gas budget" }) } },
      { toolCall: { id: "d2", name: "focus_map", args: JSON.stringify({ address: "0xb0ba7d36b7f0505879179ece7401f24eb653c6e1" }) } },
      { text: "on the deck." },
    ]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await activateByok(page);

    await page.getByTestId("rail-deck").click();
    await page.getByTestId("agent-input").fill("put the beat budget on the deck and focus Phobos");
    await page.getByTestId("agent-exec").click();

    // the kb excerpt routed into the agent's bay (chat_monitor swapped out)
    const grid = page.getByTestId("deck-grid");
    await expect(grid.locator('[data-slot="col3-bottom"]')).toHaveAttribute("data-kind", "kb_excerpt", { timeout: 15_000 });
    // focus_map: the current venue is set app-global + the map bay ensured
    const map = grid.locator('[data-slot="col2-bottom"]');
    await expect(map).toHaveAttribute("data-kind", "map_focus", { timeout: 15_000 });
    await expect(map.locator("canvas")).toBeVisible();
    await expect(map).toContainText(/bound to the app-global venue store — selected /);

    // session-67: the focused venue surfaces the click-HUD card ON the deck
    // map — the agent-driven quick overview (focus_map drives the selection)
    const card = map.getByTestId("venue-hud-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("FIRST QING (PHOBOS)");
    await expect(card).toContainText("SEED · s32");
    // the affordance surfaces the venue bay (one-venue law, operator origin)
    await card.getByTestId("venue-hud-open-bay").click();
    await expect(grid.locator('[data-slot="col3-bottom"]')).toHaveAttribute("data-kind", "venue");

    // lock the kb bay, then clear it via the frame button; the spine + map stay
    const cell = grid.locator('[data-slot="col3-bottom"]');
    await cell.getByTestId("deck-bay-lock").click();
    await expect(cell.getByTestId("deck-bay-lock")).toHaveText("UNLOCK");
    await cell.getByTestId("deck-bay-clear").click();
    await expect(cell).toHaveAttribute("data-kind", "empty");
    await expect(grid.locator('[data-slot="col3-top"]')).toHaveAttribute("data-kind", "task_graph");
    await expect(grid.locator('[data-slot="col2-bottom"]')).toHaveAttribute("data-kind", "map_focus");
  });

  test("the fleet surface lives on SYS (off-deck): honest empty state, then rows from a recording's score snapshots", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);

    // no agent needed — the SYS tab is the operator surface (the dock is
    // open by default on desktop)
    await page.getByTestId("agent-tab-sys").click();
    await expect(page.getByTestId("sys-fleet-empty")).toBeVisible({ timeout: 10_000 });

    // load a recording carrying score snapshots: the dead RPC forces the
    // honest snapshot fallback (live compose needs a real fork)
    const recording = {
      v: 1,
      kind: "fleet-run",
      started: "2026-10-04T00:00:00.000Z",
      rpc: "http://127.0.0.1:9999",
      forkBlock: null,
      roster: [
        { name: "AGENT-1", address: "0x" + "a1".repeat(20), lau: null, yue: null, vessel: "vitruv" },
        { name: "AGENT-2", address: "0x" + "b2".repeat(20), lau: null, yue: null, vessel: "kestrel" },
      ],
      events: [
        { i: 0, agent: "AGENT-1", turn: 1, t: 1, e: { type: "turn-start" } },
        { i: 1, agent: "AGENT-2", turn: 1, t: 2, e: { type: "done", steps: 2, tokens: 112 } },
      ],
      scores: [
        {
          atEvent: 1,
          t: 2,
          rows: [
            { agent: "AGENT-1", vessel: "vitruv", economic: "1000000", territorial: "0", diplomatic: "2", social: "0", total: "1000002" },
            { agent: "AGENT-2", vessel: "kestrel", economic: "1000000", territorial: "0", diplomatic: "2", social: "0", total: "1000002" },
          ],
        },
      ],
      finished: "2026-10-04T00:01:00.000Z",
    };
    // session-79 a11y: the visible loader is a real button (keyboard-
    // focusable), not a styled <label> wrapping a hidden input
    const loadBtn = page.getByTestId("sys-fleet-load-label");
    await expect(loadBtn).toHaveJSProperty("tagName", "BUTTON");
    await loadBtn.focus();
    expect(await loadBtn.evaluate((el) => document.activeElement === el)).toBe(true);
    await page.getByTestId("sys-fleet-load").setInputFiles({
      name: "recording.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(recording), "utf8"),
    });
    await expect(page.getByTestId("sys-fleet-row")).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByTestId("sys-fleet-table")).toContainText("AGENT-1");
    await expect(page.getByTestId("sys-fleet-table")).toContainText("vitruv");
    // and the DECK carries no fleet machinery
    await page.getByTestId("rail-deck").click();
    await expect(page.getByTestId("deck-grid").locator('[data-kind="fleet_score"]')).toHaveCount(0);
  });

  test("native reasoning renders as a dimed collapsible when the per-model toggle is on", async ({ page }) => {
    await routeOpenRouter(page, [{ reasoning: "walking through the venue question", text: "the answer" }]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await activateByok(page);

    // default OFF — no reasoning surfaces
    await page.getByTestId("rail-deck").click();
    await page.getByTestId("agent-input").fill("ping");
    await page.getByTestId("agent-exec").click();
    await expect(page.getByTestId("agent-answer").last()).toContainText("the answer", { timeout: 15_000 });
    await expect(page.getByTestId("agent-reasoning")).toHaveCount(0);

    // opt the model in, run again — the structured field renders
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-reasoning").check();
    await expect(page.getByTestId("agent-reasoning")).toBeChecked();
    await page.getByTestId("rail-deck").click();
    await page.getByTestId("agent-input").fill("ping again");
    await page.getByTestId("agent-exec").click();
    await expect(page.getByTestId("agent-reasoning").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("agent-reasoning").first()).toContainText("walking through the venue question");
  });
});
