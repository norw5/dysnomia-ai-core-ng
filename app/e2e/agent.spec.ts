import { expect, test, type Page } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

/**
 * The agent deck e2e (session-45): OpenRouter is ROUTED (scripted
 * completions — no network, no real key), the mock wallet + dead RPC keep
 * chain reads honest, and search_kb is exercised end-to-end because it is
 * pure client-side (guide corpus + TF-IDF).
 */

interface CapturedCompletion {
  model: string;
  messages: Array<{ role: string; content: string | null }>;
  tools?: Array<{ function: { name: string } }>;
}

async function routeOpenRouter(page: Page, script: Array<{ text?: string; toolCall?: { id: string; name: string; args: string } }>): Promise<Array<CapturedCompletion>> {
  const captured: CapturedCompletion[] = [];
  let i = 0;
  await page.route("**openrouter.ai/api/v1/chat/completions", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as CapturedCompletion;
    captured.push(body);
    const step = script[Math.min(i, script.length - 1)]!;
    i += 1;
    const message = step.toolCall
      ? { content: null, tool_calls: [{ id: step.toolCall.id, type: "function", function: { name: step.toolCall.name, arguments: step.toolCall.args } }] }
      : { content: step.text ?? "" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [{ message, finish_reason: step.toolCall ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
      }),
    });
  });
  await page.route("**openrouter.ai/api/v1/models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [{ id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek v4.1 Flash" }, { id: "other-model" }] }),
    });
  });
  await page.route("**openrouter.ai/api/v1/key", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { label: "e2e", usage: 0.1, limit: 5, is_free_tier: false } }),
    });
  });
  return captured;
}

const DEAD_RPC = "/?rpc=http://127.0.0.1:9999";

test.describe("agent deck (routed OpenRouter, mock wallet, dead RPC)", () => {
  test("honest no-key state without BYOK or .env", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    // wipe localStorage AND neutralize the dev-env key by overriding fetch to
    // the virtual module is impossible — instead clear storage and assert the
    // pane renders; on dev runs the .env key legitimately activates the deck
    await page.goto(DEAD_RPC);
    await expect(page.getByTestId("agent-dock")).toBeVisible({ timeout: 10_000 });
    const chip = page.getByTestId("agent-keychip");
    await expect(chip).toBeVisible();
    // either NO KEY (no .env on the box) or the dev-env indicator — both honest
    await expect(chip).toContainText(/NO KEY|DEV\.ENV/);
  });

  test("BYOK through SETTINGS → Agent: key chip flips, model list fetches", async ({ page }) => {
    await routeOpenRouter(page, []);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("agent-panel")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-save").click();
    await expect(page.getByTestId("agent-key-source")).toContainText("BYOK (this device)");

    await page.getByTestId("agent-models-refresh").click();
    await expect(page.getByTestId("agent-panel")).toContainText("2 models fetched", { timeout: 10_000 });

    await page.getByTestId("agent-credits").click();
    await expect(page.getByTestId("agent-credits-line")).toContainText("usage 0.1 / limit 5", { timeout: 10_000 });
  });

  test("§7.8 L2 autonomy knobs render in SETTINGS → Agent with the tighten-only note", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("agent-panel")).toBeVisible({ timeout: 10_000 });

    for (const id of ["agent-l2-failures", "agent-l2-checkpoint", "agent-l2-tx"]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await expect(page.getByTestId("agent-l2-failures")).toHaveValue("3");
    await expect(page.getByTestId("agent-l2-checkpoint")).toHaveValue("0");
    await expect(page.getByTestId("agent-l2-tx")).toHaveValue("4");
    // the invariant, in text: no knob bypasses THE gate
    await expect(page.getByTestId("agent-l2-note")).toContainText("TIGHTEN-ONLY");
    await expect(page.getByTestId("agent-l2-note")).toContainText("never bypasses THE gate");
  });

  test("full agent turn: system core + snapshot injected, search_kb executes, answer renders", async ({ page }) => {
    const captured = await routeOpenRouter(page, [
      { toolCall: { id: "c1", name: "search_kb", args: JSON.stringify({ query: "venue bouncer cover charge" }) } },
      { text: "A QING wraps an ERC-20 through MAP; bouncers and CoverCharge apply at the door (guide/venues.md)." },
    ]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);

    // BYOK via settings so the deck is active regardless of .env
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-save").click();

    await page.getByTestId("rail-map").click();
    await page.getByTestId("agent-input").fill("what is a venue?");
    await page.getByTestId("agent-exec").click();

    await expect(page.getByTestId("agent-toolcall").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("agent-toolresult").first()).toContainText("ok", { timeout: 15_000 });
    await expect(page.getByTestId("agent-answer").last()).toContainText("guide/venues.md", { timeout: 15_000 });
    await expect(page.getByTestId("agent-spend")).toContainText("tok this session");

    // the request shape: fixed core + §7.4 OFF default (no send_chat advertised)
    expect(captured.length).toBeGreaterThanOrEqual(2);
    const first = captured[0]!;
    expect(first.messages[0]!.content).toContain("DEPLOYED SEMANTICS ONLY");
    const advertised = first.tools?.map((t) => t.function.name) ?? [];
    expect(advertised).toContain("search_kb");
    expect(advertised).toContain("run_beat");
    expect(advertised).not.toContain("send_chat");
  });

  test("session-64 pane legibility: answers are NOT red, markdown renders, the INTENT strip carries the remainder", async ({ page }) => {
    await routeOpenRouter(page, [
      {
        text:
          "▸ plan: answer the venue question with the composed facts.\n" +
          "## What a venue is\n" +
          "A **QING** wraps an ERC-20 through MAP:\n" +
          "- bouncers and `CoverCharge` apply at the door\n" +
          "- gas is the only cost\n",
      },
    ]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-save").click();

    await page.getByTestId("rail-map").click();
    await page.getByTestId("agent-input").fill("what is a venue, nicely formatted?");
    await page.getByTestId("agent-exec").click();

    // the red-answer bug is dead: the answer block has its OWN class and
    // NEVER the red system class (red = system/error rows only)
    const answer = page.getByTestId("agent-answer").last();
    await expect(answer).toBeVisible({ timeout: 15_000 });
    await expect(answer).toHaveClass(/apane-msg-answer/);
    await expect(answer).not.toHaveClass(/apane-msg-system/);

    // compact markdown: the heading renders as a cyan heading element, bold
    // as strong, code as code — never raw ** / ` / ## text
    await expect(answer.locator(".apane-md-h")).toContainText("What a venue is");
    await expect(answer.locator("strong")).toContainText("QING");
    await expect(answer.locator("code")).toContainText("CoverCharge");
    await expect(answer.locator(".apane-md-ul li")).toHaveCount(2);
    await expect(answer).not.toContainText("**QING**");

    // the intent strip: labeled (INTENT chip, no fold-mimic glyph in the
    // rendered text), with the REMAINDER below it (not dropped)
    const intent = page.getByTestId("agent-intent");
    await expect(intent).toBeVisible();
    await expect(intent).toContainText("INTENT");
    await expect(intent).toContainText("answer the venue question");
    await expect(intent).not.toContainText("▸ plan:");
  });

  test("sys tab (the session-46 GOD rename): tool stats, spend meter, journal feed, exports", async ({ page }) => {
    await routeOpenRouter(page, [
      { toolCall: { id: "c1", name: "search_kb", args: JSON.stringify({ query: "beat gas" }) } },
      { text: "median 1,916,016 gas; the 3M limit is right but not generous." },
    ]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-save").click();

    await page.getByTestId("rail-map").click();
    await page.getByTestId("agent-input").fill("beat budget?");
    await page.getByTestId("agent-exec").click();
    await expect(page.getByTestId("agent-answer").last()).toContainText("1,916,016", { timeout: 15_000 });

    await page.getByTestId("agent-tab-sys").click();
    await expect(page.getByTestId("sys-tab")).toBeVisible();
    await expect(page.getByTestId("sys-tools").locator("tbody tr")).toHaveCount(1, { timeout: 10_000 });
    await expect(page.getByTestId("sys-lastrun")).toContainText("2 model turns");
    await expect(page.getByTestId("sys-tokens")).toContainText(/tok this session|\d+ \/ \d+ cap/);
    await expect(page.getByTestId("sys-feed").locator(".gm-feed-row").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("sys-export-json")).toBeVisible();
    await expect(page.getByTestId("sys-export-md")).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByTestId("sys-export-md").click();
    expect((await download).suggestedFilename()).toMatch(/dys-agent-run-.*\.md/);
  });

  test("send_chat appears in the advertised tools only after the §7.4 opt-in", async ({ page }) => {
    const captured = await routeOpenRouter(page, [{ text: "ack" }]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-save").click();

    await page.getByTestId("rail-map").click();
    await page.getByTestId("agent-input").fill("ping");
    await page.getByTestId("agent-exec").click();
    await expect(page.getByTestId("agent-answer").last()).toContainText("ack", { timeout: 15_000 });
    expect(captured[0]!.tools?.map((t) => t.function.name) ?? []).not.toContain("send_chat");

    // opt in, run again — now advertised
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-chat-tools").check();
    await expect(page.getByTestId("agent-chat-tools")).toBeChecked();
    await page.getByTestId("rail-map").click();
    await page.getByTestId("agent-input").fill("ping2");
    await page.getByTestId("agent-exec").click();
    await expect(page.getByTestId("agent-answer").last()).toContainText("ack", { timeout: 15_000 });
    expect(captured[captured.length - 1]!.tools?.map((t) => t.function.name) ?? []).toContain("send_chat");
  });

  test("journal_note (§7.10, session-54): pending in SYS → ack persists → injected next session", async ({ page }) => {
    const captured = await routeOpenRouter(page, [
      { toolCall: { id: "n1", name: "journal_note", args: JSON.stringify({ text: "the operator prefers Phobos venues" }) } },
      { text: "noted for the journal." },
    ]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-save").click();

    // the turn: journal_note is advertised by default + executes through the review story
    await page.getByTestId("rail-map").click();
    await page.getByTestId("agent-input").fill("remember my preference");
    await page.getByTestId("agent-exec").click();
    await expect(page.getByTestId("agent-answer").last()).toContainText("noted", { timeout: 15_000 });
    expect(captured[0]!.tools?.map((t) => t.function.name) ?? []).toContain("journal_note");

    // SYS review surface: the pending note renders + acks with a persisted indicator
    await page.getByTestId("agent-tab-sys").click();
    await expect(page.getByTestId("sys-notes")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("sys-note-text")).toContainText("the operator prefers Phobos venues");
    await page.getByTestId("sys-note-ack").click();
    await expect(page.getByTestId("sys-note-acked")).toBeVisible({ timeout: 5_000 }); // persisted-ack landed
    await expect(page.getByTestId("sys-notes")).toBeHidden(); // nothing left pending
    // the ack'd note rides the session run line
    await expect(page.getByTestId("sys-runs").locator("li").first()).toContainText("note: the operator prefers Phobos venues");

    // reload = a NEW session: the ack'd note joins SESSION_MEMORY and reaches the next prompt
    await page.reload();
    await page.getByTestId("rail-map").click();
    await page.getByTestId("agent-input").fill("where do i like to hang out?");
    await page.getByTestId("agent-exec").click();
    await expect(page.getByTestId("agent-answer").last()).toContainText("noted", { timeout: 15_000 });
    const sysMsgs = (captured[captured.length - 1]!.messages ?? []).filter((m) => m.role === "system").map((m) => m.content ?? "");
    // the core prompt's fence line also says "SESSION_MEMORY" — match the memory message's own header
    const memory = sysMsgs.find((c) => c.includes("SESSION_MEMORY (the local journal"));
    expect(memory).toBeDefined();
    expect(memory).toContain("note: the operator prefers Phobos venues");
  });

  test("session-73 world-model: search_venues answers from the LOCAL census (dead RPC), rows carry the wrapped asset", async ({ page }) => {
    const captured = await routeOpenRouter(page, [
      { toolCall: { id: "s1", name: "search_venues", args: JSON.stringify({ query: "sirin" }) } },
      { text: "found it — ΣΕΙΡΗΝ QING (qSIRIN), the SIRIN account's own venue." },
    ]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-save").click();

    await page.getByTestId("rail-map").click();
    await page.getByTestId("agent-input").fill("find the sirin venue in the census");
    await page.getByTestId("agent-exec").click();

    // the tool ships in the advertised catalog
    const advertised = captured[0]!.tools?.map((t) => t.function.name) ?? [];
    expect(advertised).toContain("search_venues");

    // the census is bundled — a dead RPC does not block discovery; the row
    // carries the venue name AND the wrapped asset (the asset→QING index)
    await expect(page.getByTestId("agent-toolresult").first()).toContainText("ΣΕΙΡΗΝ QING", { timeout: 15_000 });
    await expect(page.getByTestId("agent-toolresult").first()).toContainText("0xf9a5c178", { timeout: 5_000 });
    await expect(page.getByTestId("agent-answer").last()).toContainText("SIRIN", { timeout: 15_000 });
  });

  test("the desk tools (session-55): always advertised; a DRYRUN on a dead RPC answers the honest read failure", async ({ page }) => {
    const captured = await routeOpenRouter(page, [
      { toolCall: { id: "d1", name: "purchase_affection", args: JSON.stringify({ address: "0xb0ba7d36b7f0505879179ece7401f24eb653c6e1", amount: "1" }) } },
      { text: "the venue reads are unreachable right now — nothing was sent." },
    ]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-save").click();

    // the desk tools are account-dependent — connect the mock wallet (mode A)
    await page.getByTestId("mode-a").click();
    await page.getByTestId("connect-io.dysnomia.mox").click();
    await expect(page.getByTestId("wallet-account")).toContainText("0xf39Fd6");

    await page.getByTestId("rail-map").click();
    await page.getByTestId("agent-input").fill("buy 1 phobos");
    await page.getByTestId("agent-exec").click();

    // the four desk tools ship in the catalog (no opt-in — act tools, DRYRUN-first)
    const advertised = captured[0]!.tools?.map((t) => t.function.name) ?? [];
    for (const name of ["purchase_affection", "redeem_affection", "exchange_hong", "exchange_hung"]) {
      expect(advertised, name).toContain(name);
    }

    // dead RPC: the venue batch fails fast and the tool REFUSES with the honest
    // error — DRYRUN-only by default, so nothing ever reached the gate
    await expect(page.getByTestId("agent-toolresult").first()).toContainText("venue reads failed", { timeout: 15_000 });
    await expect(page.getByTestId("agent-answer").last()).toContainText("unreachable", { timeout: 15_000 });
  });

  test("the custody tools (session-56): advertised; PLS DRYRUN reaches the gate; sweep_lau refuses without a LAU", async ({ page }) => {
    const captured = await routeOpenRouter(page, [
      { toolCall: { id: "m1", name: "move_tokens", args: JSON.stringify({ token: "PLS", to: "0x2222222222222222222222222222222222222222", amount: "1" }) } },
      { toolCall: { id: "m2", name: "sweep_lau", args: JSON.stringify({ token: "CHOA", amount: "1" }) } },
      { text: "nothing moved on a dead chain — the honest state is rendered." },
    ]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-save").click();

    // account-dependent tools — connect the mock wallet (mode A)
    await page.getByTestId("mode-a").click();
    await page.getByTestId("connect-io.dysnomia.mox").click();
    await expect(page.getByTestId("wallet-account")).toContainText("0xf39Fd6");

    await page.getByTestId("rail-map").click();
    await page.getByTestId("agent-input").fill("move 1 pls and sweep my pocket");
    await page.getByTestId("agent-exec").click();

    const advertised = captured[0]!.tools?.map((t) => t.function.name) ?? [];
    for (const name of ["move_tokens", "sweep_lau"]) {
      expect(advertised, name).toContain(name);
    }

    // the PLS mode needs NO chain reads for an explicit amount: the value-tx
    // DRYRUN reaches THE gate (policy local, sim fails honestly on the dead RPC)
    const first = page.getByTestId("agent-toolresult").first();
    await expect(first).toContainText("PLS (native)", { timeout: 15_000 });
    await expect(first).toContainText('"mode": "DRYRUN"');
    await expect(first).toContainText('"policyAllowed": true');

    // the sweep is account-gated: no LAU on the dead snapshot → the honest refusal
    await expect(page.getByTestId("agent-toolresult").nth(1)).toContainText("you need a LAU first", { timeout: 15_000 });
    await expect(page.getByTestId("agent-answer").last()).toContainText("honest state", { timeout: 15_000 });
  });
});

test.describe("session-65: the whisper, FULL-AUTO, and the yolo-relaxation surfaces", () => {
  test("the mid-run WHISPER: input stays open while busy, the note queues and lands in the next model turn", async ({ page }) => {
    // a DELAYED first completion keeps the run busy long enough to whisper
    const captured: CapturedCompletion[] = [];
    let i = 0;
    const script = [
      { toolCall: { id: "w1", name: "search_kb", args: JSON.stringify({ query: "venue cover charge" }) } },
      { text: "weighed the whisper — nothing was sent, all reads." },
    ];
    await page.route("**openrouter.ai/api/v1/chat/completions", async (route) => {
      captured.push(JSON.parse(route.request().postData() ?? "{}") as CapturedCompletion);
      const step = script[Math.min(i, script.length - 1)]!;
      i += 1;
      if (i === 1) await new Promise((resolve) => setTimeout(resolve, 1500)); // the busy window
      const message = step.toolCall
        ? { content: null, tool_calls: [{ id: step.toolCall.id, type: "function", function: { name: step.toolCall.name, arguments: step.toolCall.args } }] }
        : { content: step.text ?? "" };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          choices: [{ message, finish_reason: step.toolCall ? "tool_calls" : "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
        }),
      });
    });
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-save").click();

    await page.getByTestId("rail-deck").click();
    await page.getByTestId("agent-input").fill("check the cover story");
    await page.getByTestId("agent-exec").click();
    // busy: the WHISPER button replaces EXEC (STOP still there)
    await expect(page.getByTestId("agent-whisper-send")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("agent-stop")).toBeVisible();
    // the queued note renders in the pane
    await page.getByTestId("agent-input").fill("also weigh the guest-list window");
    await page.getByTestId("agent-whisper-send").click();
    await expect(page.getByTestId("agent-whisper")).toContainText("guest-list window");
    // the run finishes; the SECOND model call carries the drained note
    await expect(page.getByTestId("agent-answer").last()).toContainText("weighed the whisper", { timeout: 15_000 });
    expect(captured.length).toBeGreaterThanOrEqual(2);
    const second = captured[1]!.messages;
    const whisperMsgs = second.filter((m) => m.role === "system" && (m.content ?? "").includes("[operator whisper —"));
    expect(whisperMsgs.length).toBe(1);
    expect(whisperMsgs[0]!.content).toContain("guest-list window");
  });

  test("FULL-AUTO: absent outside mode C; in mode C it engages, announces, and disengages without further cycles", async ({ page }) => {
    await routeOpenRouter(page, [
      { text: "▸ plan: survey state, then hold.\nCycle 1 done — read-only pass; next goal: settle a venue." },
      { text: "standing by." },
    ]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-save").click();
    // mode B wallet (not C) → the trigger must NOT render
    await page.getByTestId("mode-b").click();
    await page.getByTestId("import-priv").fill("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    await page.getByTestId("import-btn").click();
    await expect(page.getByTestId("wallet-account")).toContainText("0xf39Fd6");
    await page.getByTestId("rail-deck").click();
    await expect(page.getByTestId("agent-fullauto")).toHaveCount(0);

    // enter mode C (yolo) → the trigger appears IN THE HEADER (65.3: an extra
    // harness mode, not a per-message control) and engages
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("yolo-input").fill("DANGERS");
    await page.getByTestId("yolo-enter").click();
    await expect(page.getByTestId("wallet-mode")).toHaveText("YOLO");
    await page.getByTestId("rail-deck").click();
    await expect(page.locator(".dock-head").getByTestId("agent-fullauto")).toBeVisible();
    // and it is NOT in the input row anymore
    await expect(page.locator(".apane-input-row").getByTestId("agent-fullauto")).toHaveCount(0);
    await page.getByTestId("agent-fullauto").click();
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO engaged", { timeout: 10_000 });
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO engaged. You are running autonomously", { timeout: 10_000 });
    // the engaged button + cycle counter render; disengage stops the loop
    await expect(page.getByTestId("agent-fullauto")).toContainText("FULL-AUTO ●", { timeout: 15_000 });
    await page.getByTestId("agent-fullauto").click();
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO disengaged", { timeout: 10_000 });
  });

  test("the optional home-QING step rides the onboarding checklist (never blocks)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await expect(page.getByTestId("view-deck")).toBeVisible({ timeout: 10_000 });
    const step = page.getByTestId("onboarding-step-qing");
    await expect(step).toBeVisible();
    await expect(step).toContainText("optional");
    await expect(step).toContainText("home QING");
  });

  test("the yolo-relaxation toggles: mode-C breadth in policy, plan auto-approve in Agent (default off, persists)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("policy-panel")).toBeVisible({ timeout: 10_000 });

    // both default OFF
    await expect(page.getByTestId("gate-breadth")).not.toBeChecked();
    await expect(page.getByTestId("agent-auto-plans")).not.toBeChecked();

    // breadth toggles + persists across reload (gate settings storage)
    await page.getByTestId("gate-breadth").check();
    await expect(page.getByTestId("gate-breadth")).toBeChecked();
    await page.reload();
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("gate-breadth")).toBeChecked();
    await expect(page.getByTestId("policy-panel")).toContainText("unknown-METHOD + privileged gates still ask");

    // plan auto-approve rides the agent settings block (with the one-gate warning)
    await page.getByTestId("agent-auto-plans").check();
    await expect(page.getByTestId("agent-auto-plans")).toBeChecked();
    await page.reload();
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("agent-auto-plans")).toBeChecked();
    // leave the world clean
    await page.getByTestId("gate-breadth").uncheck();
    await page.getByTestId("agent-auto-plans").uncheck();
  });
});

test.describe("session-65.2: the unattended auto-approve + the onboarding preference contract", () => {
  test("plan auto-approve EXECUTES unattended in mode C — no click needed (the stale-busy fix)", async ({ page }) => {
    const captured = await routeOpenRouter(page, [
      { toolCall: { id: "pp1", name: "propose_plan", args: JSON.stringify({ goal: "read the KB", steps: [{ tool: "search_kb", args: { query: "venue" }, note: "one read" }] }) } },
      { text: "the plan is on the deck." },
    ]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);

    // mode B wallet → yolo (mode C), BYOK, and the auto-approve toggle ON
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-save").click();
    await page.getByTestId("mode-b").click();
    await page.getByTestId("import-priv").fill("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    await page.getByTestId("import-btn").click();
    await page.getByTestId("yolo-input").fill("DANGERS");
    await page.getByTestId("yolo-enter").click();
    await expect(page.getByTestId("wallet-mode")).toHaveText("YOLO");
    await page.getByTestId("agent-auto-plans").check();

    // ask for a plan — NEVER touch the plan widget's approve button
    await page.getByTestId("rail-deck").click();
    await page.getByTestId("agent-input").fill("propose a one-step read plan");
    await page.getByTestId("agent-exec").click();

    // the run ends → the post-run seam auto-approves AND EXECUTES (the
    // stale-busy bug ate the execution; the owner had to click)
    await expect(page.getByTestId("agent-chat")).toContainText("PLAN auto-approved (mode C toggle", { timeout: 15_000 });
    await expect(page.getByTestId("agent-chat")).toContainText("PLAN approved — executing 1 step", { timeout: 15_000 });
    await expect(page.getByTestId("agent-chat")).toContainText("PLAN done — 1 step ok.", { timeout: 15_000 });
    // the widget's ledger agrees: terminal done, never back to the buttons
    await expect(page.getByTestId("widget-plan").first()).toHaveAttribute("data-plan-status", "done", { timeout: 15_000 });
    expect(captured.length).toBeGreaterThanOrEqual(1);

    // 65.3 severity styling: an ACCEPTED approval is a success row (green),
    // never a red error box — red is reserved for hard stops
    const autoRow = page.locator(".apane-msg-system", { hasText: "PLAN auto-approved" });
    await expect(autoRow).toHaveClass(/apane-msg-ok/, { timeout: 15_000 });
    await expect(autoRow).not.toHaveClass(/apane-msg-err/);
    const doneRow = page.locator(".apane-msg-system", { hasText: "PLAN done — 1 step ok." });
    await expect(doneRow).toHaveClass(/apane-msg-ok/);
  });

  test("the onboarding preference inputs ride ABOVE the checklist and flow into the handoff", async ({ page }) => {
    const captured = await routeOpenRouter(page, [{ text: "checking state first." }]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-save").click();
    await page.getByTestId("mode-a").click();
    await page.getByTestId("connect-io.dysnomia.mox").click();
    await expect(page.getByTestId("wallet-account")).toContainText("0xf39Fd6");

    await page.getByTestId("rail-deck").click();
    // the controls block exists and sits ABOVE the checklist (geometry, not CSS)
    const controls = page.getByTestId("onboarding-controls");
    const checklist = page.getByTestId("onboarding-steps");
    await expect(controls).toBeVisible();
    const cBox = await controls.boundingBox();
    const lBox = await checklist.boundingBox();
    expect(cBox).not.toBeNull();
    expect(lBox).not.toBeNull();
    expect(cBox!.y).toBeLessThan(lBox!.y);

    // unspecified state says so; then specify + hand off
    await expect(controls).toContainText("unspecified — the agent will always stop");
    await page.getByTestId("onb-pref-name").fill("Nyx");
    await page.getByTestId("onb-pref-symbol").fill("NYX");
    await expect(controls).toContainText("specified — the agent uses these exactly");
    // the byte counter is live
    await expect(page.getByTestId("onb-pref-name")).toBeVisible();
    await page.getByTestId("onboarding-agent-handoff").click();

    // the handoff prompt carries the EXACT identity + the no-confirmation contract
    expect(captured.length).toBeGreaterThanOrEqual(1);
    const user = captured[0]!.messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("SPECIFIED");
    expect(user).toContain('Username "Nyx"');
    expect(user).toContain('LAU symbol "NYX"');
    expect(user).toContain("do NOT ask for further confirmation");
  });

  test("an over-cap preferred name is refused client-side (the 12-BYTE law before any handoff)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await expect(page.getByTestId("onboarding-controls")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("onb-pref-name").fill("abcdefghijklm"); // 13 bytes
    await expect(page.getByTestId("onb-pref-problem")).toContainText("bytes");
    await expect(page.getByTestId("onboarding-agent-handoff")).toBeDisabled();
  });
});

test.describe("session-68: the full-auto cycle ledger + the loop caps", () => {
  async function engageFullAuto(page: Page): Promise<void> {
    // yolo entry needs an unlocked mode-B wallet (the 65 idiom)
    await page.getByTestId("mode-b").click();
    await page.getByTestId("import-priv").fill("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    await page.getByTestId("import-pass").fill("");
    await page.getByTestId("import-btn").click();
    await expect(page.getByTestId("wallet-account")).toHaveAttribute("title", /^0xf39Fd6/i, { timeout: 10_000 });
    await page.getByTestId("yolo-input").fill("DANGERS");
    await page.getByTestId("yolo-enter").click();
    await expect(page.getByTestId("wallet-mode")).toHaveText("YOLO");
    await page.getByTestId("rail-deck").click();
    await page.getByTestId("agent-fullauto").click();
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO engaged. You are running autonomously", { timeout: 10_000 });
  }

  test("the operator cycle backstop tightens the loop; the SYS ledger carries the cycle + disengage rows", async ({ page }) => {
    await routeOpenRouter(page, [{ text: "▸ plan: survey, then hold.\nCycle done — read-only pass." }]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    // BYOK + the tightened backstop (default 12 → 1) ride the agent settings
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-fa-cycles").fill("1");
    await page.getByTestId("agent-save").click();
    await engageFullAuto(page);

    // cycle 1 completes → the backstop disengages with the honest reason
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO disengaged — cycle backstop (1) reached", { timeout: 15_000 });

    // the SYS ledger: one run row + the closing disengage row, newest first
    await page.getByTestId("agent-tab-sys").click();
    await expect(page.getByTestId("sys-fullauto-state")).toContainText("disengaged — the ledger holds the last engagement");
    const ledger = page.getByTestId("sys-fullauto-ledger");
    await expect(ledger).toBeVisible();
    await expect(ledger.locator('[data-kind="disengage"]')).toContainText("cycle backstop (1)");
    const runRow = ledger.locator('[data-kind="run"]');
    await expect(runRow).toContainText("done");
    await expect(runRow).toContainText("130"); // the scripted usage lands as the cycle's tokens
    await expect(runRow).toContainText("read-only pass"); // the summary line (session-69 stacked row)
  });

  test("the full-auto SESSION token cap disengages with the SETTINGS-naming reason", async ({ page }) => {
    await routeOpenRouter(page, [{ text: "▸ plan: one survey.\nCycle done." }]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    // cap 100 < the scripted 130-token cycle → the first boundary trips it
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-fa-tokens").fill("100");
    await page.getByTestId("agent-save").click();
    await engageFullAuto(page);

    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO disengaged — full-auto session token cap (100) reached", { timeout: 15_000 });
    await page.getByTestId("agent-tab-sys").click();
    await expect(page.getByTestId("sys-fullauto-ledger").locator('[data-kind="disengage"]')).toContainText("token cap (100)");
  });

  test("a clean cycle below both caps CHAINS: the ledger accumulates + the engaged state line is live", async ({ page }) => {
    // a DELAYED second completion holds cycle 2 busy long enough to read the
    // live spend line (the whisper-test idiom)
    const script = [
      { text: "▸ plan: survey.\nCycle 1 done — surveyed state; next: hold." },
      { text: "Cycle 2 done — holding." },
      { text: "standing by." },
    ];
    let completion = 0;
    await page.route("**openrouter.ai/api/v1/chat/completions", async (route) => {
      const step = script[Math.min(completion, script.length - 1)]!;
      completion += 1;
      if (completion === 2) await new Promise((resolve) => setTimeout(resolve, 1500));
      const message = { content: step.text ?? "" };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          choices: [{ message, finish_reason: "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
        }),
      });
    });
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-fa-cycles").fill("2");
    await page.getByTestId("agent-save").click();
    await engageFullAuto(page);

    // cycle 2 starts (the chained send passes the busy mirror) and holds —
    // the live spend line names the loop + the session token meter (the
    // kickoff names the cycle STARTING now: 1 done → "cycle 2", session-72 fix)
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO cycle 2 — the agent picks the next goal", { timeout: 15_000 });
    await expect(page.getByTestId("agent-spend")).toContainText("FULL-AUTO · 1 cycle done · 130 tok");
    // then the backstop(2) disengages — two run rows accumulated
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO disengaged — cycle backstop (2) reached", { timeout: 20_000 });
    await page.getByTestId("agent-tab-sys").click();
    const runRows = page.getByTestId("sys-fullauto-ledger").locator('[data-kind="run"]');
    await expect(runRows).toHaveCount(2);
    await expect(runRows.first()).toContainText("130"); // the scripted usage per cycle
    await expect(runRows.nth(1)).toContainText("130");
  });
});

test.describe("session-74: the strategy layer — objective + next-goals menu + the strategist", () => {
  async function enterModeC(page: Page): Promise<void> {
    await page.getByTestId("mode-b").click();
    await page.getByTestId("import-priv").fill("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    await page.getByTestId("import-pass").fill("");
    await page.getByTestId("import-btn").click();
    await expect(page.getByTestId("wallet-account")).toHaveAttribute("title", /^0xf39Fd6/i, { timeout: 10_000 });
    await page.getByTestId("yolo-input").fill("DANGERS");
    await page.getByTestId("yolo-enter").click();
    await expect(page.getByTestId("wallet-mode")).toHaveText("YOLO");
  }

  test("the pane OBJECTIVE field persists, the engage row names it, and the kickoff carries it as the strategy boundary", async ({ page }) => {
    const captured = await routeOpenRouter(page, [{ text: "▸ plan: survey.\nCycle done — read-only pass." }]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-fa-cycles").fill("1");
    await page.getByTestId("agent-save").click();
    await enterModeC(page);
    await page.getByTestId("rail-deck").click();

    // the pane field (mode C + key gated): type + Enter saves
    const field = page.getByTestId("fa-objective-input");
    await expect(field).toBeVisible();
    await field.fill("establish the home QING economy");
    await field.press("Enter");
    await expect(page.getByTestId("fa-objective-saved")).toBeVisible({ timeout: 5_000 });

    // engage: the row names the objective; the kickoff carries it (the
    // engaged VIEW chip is asserted in the whisper row, which holds its
    // cycle busy — this row's backstop-1 cycle completes instantly)
    await page.getByTestId("agent-fullauto").click();
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO engaged — mode C, objective: establish the home QING economy", { timeout: 10_000 });
    expect(captured.length).toBeGreaterThanOrEqual(1);
    const kickoff = captured[0]!.messages.filter((m) => m.role === "user").pop()?.content ?? "";
    expect(kickoff).toContain("OPERATOR OBJECTIVE");
    expect(kickoff).toContain("strategy boundary");
    expect(kickoff).toContain("establish the home QING economy");
    // the backstop(1) disengages (the engaged-only SYS objective chip is
    // asserted in the whisper row, which holds its cycle busy)
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO disengaged — cycle backstop (1) reached", { timeout: 15_000 });
    // persisted app-global: survives the reload (the SETTINGS field renders
    // in every wallet mode — the pane field is mode-C gated like the trigger)
    await page.reload();
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("agent-fa-objective")).toHaveValue("establish the home QING economy", { timeout: 10_000 });
  });

  test("the structured NEXT-GOALS MENU: cycle 1 records it, cycle 2's kickoff consumes it, the SYS ledger renders it", async ({ page }) => {
    const captured = await routeOpenRouter(page, [
      { toolCall: { id: "g1", name: "next_goals", args: JSON.stringify({ goals: ["settle at Phobos", "survey the atlas rim"] }) } },
      { text: "▸ plan: close the cycle.\nCycle 1 done — menu recorded." },
      { text: "Cycle 2 done — worked the menu head." },
    ]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-fa-cycles").fill("2");
    await page.getByTestId("agent-save").click();
    await enterModeC(page);
    await page.getByTestId("rail-deck").click();

    await page.getByTestId("agent-fullauto").click();
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO engaged", { timeout: 10_000 });
    // the next_goals call executes (client-side) and its result folds
    await expect(page.getByTestId("agent-toolcall").first()).toContainText("next_goals", { timeout: 10_000 });
    // cycle 2's kickoff consumes the menu (the third completion is cycle 2's close)
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO disengaged — cycle backstop (2) reached", { timeout: 25_000 });
    expect(captured.length).toBeGreaterThanOrEqual(3);
    // the LAST user message is cycle 2's driver (windowed history carries the
    // earlier kickoffs — the first user message would be the engagement text)
    const cycle2 = captured[2]!.messages.filter((m) => m.role === "user").pop()?.content ?? "";
    expect(cycle2).toContain("NEXT-GOALS MENU");
    expect(cycle2).toContain("recorded at cycle 1");
    expect(cycle2).toContain("- settle at Phobos");
    expect(cycle2).toContain("- survey the atlas rim");
    // the SYS ledger renders the menu on the run row (newest first → row 0 = cycle 2, row 1 = cycle 1)
    await page.getByTestId("agent-tab-sys").click();
    const runRow = page.getByTestId("sys-fullauto-ledger").locator('[data-kind="run"]').nth(1);
    await expect(runRow.getByTestId("sys-fullauto-goals")).toContainText("settle at Phobos");
  });

  test("the two-tier strategist: the bounded read-only call fires between cycles, picks the goal, and the next kickoff executes it", async ({ page }) => {
    // branch the script by MODEL: the executor (default flash) vs the strategist
    const captured: CapturedCompletion[] = [];
    let execI = 0;
    let stratI = 0;
    const execScript = [
      { text: "▸ plan: survey.\nCycle 1 done — read-only pass." },
      { text: "Cycle 2 done — worked the strategist's pick." },
    ];
    const stratScript = [{ text: "The menu is stale; state says settle.\nGOAL: settle at Phobos and journal the bars" }];
    await page.route("**openrouter.ai/api/v1/chat/completions", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as CapturedCompletion;
      captured.push(body);
      const isStrategist = body.model === "strategist-model-x";
      const script = isStrategist ? stratScript : execScript;
      const i = isStrategist ? stratI++ : execI++;
      const step = script[Math.min(i, script.length - 1)]!;
      // hold cycle 2 busy for a moment — a deterministic ENGAGED window for
      // the SYS state line (the strategist chip renders only while engaged)
      if (!isStrategist && i === 1) await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          choices: [{ message: { content: step.text ?? "" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
        }),
      });
    });
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-fa-cycles").fill("2");
    await page.getByTestId("agent-strategist-model").fill("strategist-model-x");
    await page.getByTestId("agent-save").click();
    await page.getByTestId("agent-strategist").check();
    await enterModeC(page);
    await page.getByTestId("rail-deck").click();

    await page.getByTestId("agent-fullauto").click();
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO engaged", { timeout: 10_000 });
    // the strategist call fires between cycles 1 and 2 (its own model + role)
    await expect(page.getByTestId("agent-chat")).toContainText("[STRATEGIST cycle 2 — picked: settle at Phobos and journal the bars", { timeout: 20_000 });
    const stratCalls = captured.filter((c) => c.model === "strategist-model-x");
    expect(stratCalls.length).toBeGreaterThanOrEqual(1);
    const stratSystem = stratCalls[0]!.messages.find((m) => m.role === "system")?.content ?? "";
    expect(stratSystem).toContain("STRATEGIST layer");
    expect(stratSystem).toContain("You are the AI core of Dysnomia Terminal"); // the fixed core still precedes it
    const stratUser = stratCalls[0]!.messages.filter((m) => m.role === "user").pop()?.content ?? "";
    expect(stratUser).toContain("STRATEGIST CALL");
    // its advertised tools are the read-only set
    const advertised = (stratCalls[0]!.tools ?? []).map((t) => t.function.name);
    expect(advertised).toContain("get_state");
    expect(advertised).not.toContain("run_beat");
    // cycle 2 is engaged + held busy — the SYS state line names the strategist
    await page.getByTestId("agent-tab-sys").click();
    await expect(page.getByTestId("sys-fullauto-state")).toContainText("ENGAGED", { timeout: 5_000 });
    await expect(page.getByTestId("sys-fa-strategist")).toContainText("strategist-model-x");
    await page.getByTestId("agent-tab-core").click();
    // the loop's cycle-2 kickoff carries the pick (the LAST user message —
    // windowed history carries the earlier kickoffs)
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO disengaged — cycle backstop (2) reached", { timeout: 25_000 });
    const execCalls = captured.filter((c) => c.model !== "strategist-model-x");
    const cycle2 = execCalls[execCalls.length - 1]!.messages.filter((m) => m.role === "user").pop()?.content ?? "";
    expect(cycle2).toContain("STRATEGIST layer picked");
    expect(cycle2).toContain("NEXT GOAL (the strategist's pick — execute it this cycle): settle at Phobos and journal the bars");
  });

  test("an `objective:` whisper steers the standing objective live mid-engagement", async ({ page }) => {
    // a DELAYED first completion holds cycle 1 busy long enough to whisper
    const script = [
      { text: "▸ plan: survey.\nCycle 1 done — noted the re-aim." },
      { text: "standing by." },
    ];
    let completion = 0;
    await page.route("**openrouter.ai/api/v1/chat/completions", async (route) => {
      const step = script[Math.min(completion, script.length - 1)]!;
      completion += 1;
      if (completion === 1) await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          choices: [{ message: { content: step.text ?? "" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
        }),
      });
    });
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-fa-cycles").fill("1");
    await page.getByTestId("agent-save").click();
    await enterModeC(page);
    await page.getByTestId("rail-deck").click();
    await page.getByTestId("agent-fullauto").click();
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO engaged", { timeout: 10_000 });

    // whisper the re-aim: the OBJECTIVE row lands + the whisper queues for the turn
    await expect(page.getByTestId("agent-whisper-send")).toBeVisible({ timeout: 5_000 });
    await page.getByTestId("agent-input").fill("objective: beat the home QING this week");
    await page.getByTestId("agent-whisper-send").click();
    await expect(page.getByTestId("agent-chat")).toContainText("[OBJECTIVE updated — every kickoff from the next cycle carries it: beat the home QING this week]", { timeout: 5_000 });
    await expect(page.getByTestId("agent-whisper")).toContainText("objective: beat the home QING this week");
    // the engaged view + the stored value both carry it
    await expect(page.getByTestId("fa-objective-view")).toContainText("beat the home QING this week");
    // cycle 1 is still held busy — the SYS state line names the objective while ENGAGED
    await page.getByTestId("agent-tab-sys").click();
    await expect(page.getByTestId("sys-fullauto-state")).toContainText("ENGAGED", { timeout: 5_000 });
    await expect(page.getByTestId("sys-fa-objective")).toContainText("beat the home QING this week");
    await page.getByTestId("agent-tab-core").click();
    // the backstop(1) disengages; after disengage the pane field shows the stored objective
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO disengaged — cycle backstop (1) reached", { timeout: 15_000 });
    await expect(page.getByTestId("fa-objective-input")).toHaveValue("beat the home QING this week", { timeout: 10_000 });
  });
});

// ---- session-76: the engage-time CAPS MATH (the owner round — the 484k fat-cycle datum) ----

test.describe("session-76: the engage-time caps math line + the strategist model-choice note", () => {
  test("the disengaged pane names what the CURRENT knobs imply in cycles; engaging yields it to the live spend meter", async ({ page }) => {
    // HOLD cycle 1 busy — a deterministic ENGAGED window (the 74 law:
    // engaged-only UI needs the held window; the instant script would
    // complete + disengage before the count assert could ever observe it)
    const captured: CapturedCompletion[] = [];
    let completion = 0;
    const script = [
      { text: "▸ plan: survey.\nCycle 1 done — read-only pass." },
      { text: "Cycle 2 done — held steady." },
    ];
    await page.route("**openrouter.ai/api/v1/chat/completions", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as CapturedCompletion;
      captured.push(body);
      const step = script[Math.min(completion, script.length - 1)]!;
      completion += 1;
      if (completion === 2) await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          choices: [{ message: { content: step.text ?? "" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
        }),
      });
    });
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);

    // SETTINGS: the strategist model-choice note names the 75 failure mode
    // (a chatty strong model burning its whole window without a GOAL: line)
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("agent-strategist-note")).toContainText("WHOLE window");
    await expect(page.getByTestId("agent-strategist-note")).toContainText("GOAL: line");
    await expect(page.getByTestId("agent-strategist-note")).toContainText("decides fast");

    // BYOK (the backstop stays DEFAULT here — the default math is the assert)
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    await page.getByTestId("agent-save").click();
    // mode C (the anvil#0 key — the 74 e2e law)
    await page.getByTestId("mode-b").click();
    await page.getByTestId("import-priv").fill("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    await page.getByTestId("import-pass").fill("");
    await page.getByTestId("import-btn").click();
    await page.getByTestId("yolo-input").fill("DANGERS");
    await page.getByTestId("yolo-enter").click();
    await expect(page.getByTestId("wallet-mode")).toHaveText("YOLO");
    await page.getByTestId("rail-deck").click();

    // fresh storage → the RAISED defaults: 300k/run, 500k session, 12 backstop
    // (the hint carries the honest cycle math + the observed fat-cycle range)
    const hint = page.getByTestId("fa-caps-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("2 fat cycles at full burn (500k session ÷ 300k/run) to 12 at the backstop");
    await expect(hint).toContainText("160k–484k");
    await expect(hint).toContainText("budget-stop disengage");

    // tightening the backstop below the session math flips the phrasing —
    // the BACKSTOP binds first (never a phantom 2-cycle promise at backstop 2)
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-fa-cycles").fill("2");
    await page.getByTestId("agent-save").click();
    await page.getByTestId("rail-deck").click();
    await expect(hint).toContainText("the 2-cycle backstop binds first (500k session lasts past it at 300k/run)");

    // engage → the hint is GONE while ENGAGED (disengaged-only row; the
    // spend line meters) — asserted inside the held cycle-2 busy window
    // (cycle 1 completes instantly; the 74 law: engaged-only UI needs the hold)
    await page.getByTestId("agent-fullauto").click();
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO engaged", { timeout: 10_000 });
    await expect(page.getByTestId("agent-spend")).toContainText("FULL-AUTO · 1 cycle done · 130 tok / 500000", { timeout: 15_000 });
    await expect(hint).toHaveCount(0);
    await expect(page.getByTestId("agent-fullauto")).toContainText("FULL-AUTO ●", { timeout: 5_000 });

    // the held cycle releases → backstop(2) disengages → the hint returns
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO disengaged — cycle backstop (2) reached", { timeout: 15_000 });
    expect(captured.length).toBeGreaterThanOrEqual(2);
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("backstop binds first");
  });

  test("the knobs drive the math live: raising the session cap re-rates the implied cycles", async ({ page }) => {
    await routeOpenRouter(page, [{ text: "standing by." }]);
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
    await page.getByTestId("agent-remember").check();
    // 1M session ÷ 300k/run = 4 fat cycles; backstop 12 stays the ceiling
    await page.getByTestId("agent-fa-tokens").fill("1000000");
    await page.getByTestId("agent-save").click();
    await page.getByTestId("mode-b").click();
    await page.getByTestId("import-priv").fill("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    await page.getByTestId("import-pass").fill("");
    await page.getByTestId("import-btn").click();
    await page.getByTestId("yolo-input").fill("DANGERS");
    await page.getByTestId("yolo-enter").click();
    await expect(page.getByTestId("wallet-mode")).toHaveText("YOLO");
    await page.getByTestId("rail-deck").click();

    const hint = page.getByTestId("fa-caps-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("4 fat cycles at full burn (1M session ÷ 300k/run)");

    // cap OFF (0) → the honest no-session-cap phrasing
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-fa-tokens").fill("0");
    await page.getByTestId("agent-save").click();
    await page.getByTestId("rail-deck").click();
    await expect(hint).toContainText("backstop 12 cycles, no session cap (0 = off)");
  });
});

// ---- session-75: STREAMING RESPONSES (the SSE path + the live partial lane) ----

/** the controllable SSE seam: window.fetch is overridden so the app's real
 *  streaming adapter reads a ReadableStream the TEST drives frame-by-frame
 *  (playwright's route.fulfill cannot stream) — real timing, real parser */
const SSE_FETCH_INIT = `
(() => {
  const orig = window.fetch.bind(window);
  window.__sse = { ctl: null, bodies: [] };
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("openrouter.ai/api/v1/chat/completions")) {
      window.__sse.bodies.push(JSON.parse(String(init?.body ?? "{}")));
      const stream = new ReadableStream({ start(c) { window.__sse.ctl = c; } });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    return orig(input, init);
  };
})();
`;

async function pushSse(page: Page, obj: unknown): Promise<void> {
  await page.evaluate((line) => {
    window.__sse!.ctl.enqueue(new TextEncoder().encode(line));
  }, `data: ${JSON.stringify(obj)}\n\n`);
}

async function pushSseDone(page: Page): Promise<void> {
  await page.evaluate((line) => {
    window.__sse!.ctl.enqueue(new TextEncoder().encode(line));
    window.__sse!.ctl.close();
  }, "data: [DONE]\n\n");
}

async function armStreamingByok(page: Page): Promise<void> {
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("agent-key-input").fill("sk-or-e2e-byok");
  await page.getByTestId("agent-remember").check();
  await page.getByTestId("agent-save").click();
  await page.getByTestId("agent-streaming").check();
  await page.getByTestId("rail-deck").click();
}

test.describe("session-75: streaming responses", () => {
  test("SETTINGS: the per-model streaming toggle renders off by default with the billing-honesty note", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("agent-panel")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("agent-streaming")).toBeVisible();
    await expect(page.getByTestId("agent-streaming")).not.toBeChecked();
    await expect(page.getByTestId("agent-streaming-note")).toContainText("IDENTICAL");
    await expect(page.getByTestId("agent-streaming-note")).toContainText("FINALIZED message only");
  });

  test("a streamed turn renders the live partial (INTENT mid-stream), then finalizes atomically", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.addInitScript(SSE_FETCH_INIT);
    await page.goto(DEAD_RPC);
    await armStreamingByok(page);

    await page.getByTestId("agent-input").fill("stream me the atlas story");
    await page.getByTestId("agent-exec").click();
    await expect(page.getByTestId("agent-processing")).toBeVisible({ timeout: 10_000 });

    // the request rode the SSE path
    await page.waitForFunction(() => window.__sse!.bodies.length >= 1);
    expect(await page.evaluate(() => window.__sse!.bodies[0]!.stream)).toBe(true);

    // chunk 1: the partial row appears and the INTENT strip is already live
    await pushSse(page, { choices: [{ delta: { content: "▸ plan: walk the atlas." } }] });
    await expect(page.getByTestId("agent-streaming")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("agent-streaming").getByTestId("agent-intent")).toContainText("walk the atlas");

    // chunk 2: the partial grows in place (one row, not two)
    await pushSse(page, { choices: [{ delta: { content: "\nThe atlas renders 940 venues." } }] });
    await expect(page.getByTestId("agent-streaming")).toContainText("940 venues");
    await expect(page.getByTestId("agent-streaming")).toHaveCount(1);

    // the tail: finish + usage + DONE — the finalized row replaces the partial atomically
    await pushSse(page, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } });
    await pushSseDone(page);
    await expect(page.getByTestId("agent-processing")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId("agent-streaming")).toHaveCount(0);
    await expect(page.getByTestId("agent-answer").last()).toContainText("The atlas renders 940 venues.");
    await expect(page.getByTestId("agent-intent").last()).toContainText("walk the atlas");
    // usage from the stream's tail chunk counts like any turn
    await expect(page.getByTestId("agent-spend")).toContainText("130 tok this session");
  });

  test("STOP mid-generation keeps the partial in the pane and in the next turn's history", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.addInitScript(SSE_FETCH_INIT);
    await page.goto(DEAD_RPC);
    await armStreamingByok(page);

    await page.getByTestId("agent-input").fill("go long");
    await page.getByTestId("agent-exec").click();
    await expect(page.getByTestId("agent-processing")).toBeVisible({ timeout: 10_000 });
    await page.waitForFunction(() => window.__sse!.bodies.length >= 1);

    // one fragment lands, then the operator STOPS mid-generation
    await pushSse(page, { choices: [{ delta: { content: "partial wisdom about venues " } }] });
    await expect(page.getByTestId("agent-streaming")).toContainText("partial wisdom", { timeout: 5_000 });
    await page.getByTestId("agent-stop").click();

    // the lane finalizes: the partial stays as a said row, the run closes honestly
    await expect(page.getByTestId("agent-streaming")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId("agent-answer").last()).toContainText("partial wisdom about venues");
    await expect(page.getByTestId("agent-chat")).toContainText("[stream stopped mid-generation]");
    await expect(page.getByTestId("agent-chat")).toContainText("[ERROR] User aborted agent execution.");
    await expect(page.getByTestId("agent-processing")).toHaveCount(0, { timeout: 10_000 });

    // the next turn's request carries the partial (history saw what was said)
    await page.getByTestId("agent-input").fill("what did you say so far?");
    await page.getByTestId("agent-exec").click();
    await page.waitForFunction(() => window.__sse!.bodies.length >= 2, null, { timeout: 10_000 });
    const second = await page.evaluate(() => window.__sse!.bodies[1]!.messages);
    const partialMsg = (second as Array<{ role: string; content: string | null }>).filter((m) => m.role === "assistant");
    expect(partialMsg.length).toBeGreaterThanOrEqual(1);
    expect(partialMsg.some((m) => (m.content ?? "").includes("partial wisdom about venues"))).toBe(true);
    // tidy close of the hanging fake stream
    await pushSse(page, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
    await pushSseDone(page);
  });
});
