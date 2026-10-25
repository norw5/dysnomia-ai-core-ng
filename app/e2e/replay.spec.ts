import { expect, test } from "@playwright/test";

test.use({ javaScriptEnabled: true });

/**
 * THE REPLAY flagship e2e (session 62; the session-63 re-pin): a fleet
 * recording loaded + armed on the SYS tab (off-deck), re-fed through the
 * deck's ROUTING machinery — the SLIM HEADER strip (hardware-strip row)
 * carries seek/speed/play, the AI_CORE pane carries the recorded
 * conversation, backward seeks reset UNLOCKED bays to the default
 * composition, and the AS-OF scoreboard follows the playhead on SYS. The
 * dead RPC keeps chain reads honest; no network, no key.
 */

const DEAD_RPC = "/?rpc=http://127.0.0.1:9999";
const VENUE = "0x" + "ab".repeat(20);

function fixtureRecording(): string {
  const events = [
    { i: 0, agent: "VITRUV-3", turn: 1, t: 1, e: { type: "turn-start" } },
    { i: 1, agent: "VITRUV-3", turn: 1, t: 2, e: { type: "tool-call", id: "c1", name: "get_venue", args: { address: VENUE } } },
    { i: 2, agent: "VITRUV-3", turn: 1, t: 3, e: { type: "tool-result", id: "c1", name: "get_venue", result: { venue: VENUE }, ok: true } },
    { i: 3, agent: "KESTREL-7", turn: 1, t: 4, e: { type: "turn-start" } },
    { i: 4, agent: "KESTREL-7", turn: 1, t: 5, e: { type: "tool-result", id: "c2", name: "search_kb", result: { query: "gwat spawn", hits: [] }, ok: true } },
    { i: 5, agent: "MERIDIAN-5", turn: 1, t: 6, e: { type: "turn-start" } },
    { i: 6, agent: "MERIDIAN-5", turn: 1, t: 7, e: { type: "tool-result", id: "c3", name: "show_widget", result: { surfaced: true, slot: "col3-bottom", kind: "kb_excerpt", props: { query: "open channels" } }, ok: true } },
    { i: 7, agent: "MERIDIAN-5", turn: 1, t: 8, e: { type: "assistant-text", text: "▸ plan: speak in the open.\nthe channel carries the offer." } },
    { i: 8, agent: "PARALLAX-2", turn: 1, t: 9, e: { type: "done", steps: 1, tokens: 42 } },
  ];
  const rows = (total: string) => [
    { agent: "VITRUV-3", vessel: "vitruv", economic: "12", territorial: "1", diplomatic: "1", social: "0", total },
    { agent: "KESTREL-7", vessel: "kestrel", economic: "12", territorial: "0", diplomatic: "1", social: "0", total },
    { agent: "MERIDIAN-5", vessel: "meridian", economic: "2", territorial: "0", diplomatic: "0", social: "0", total },
    { agent: "PARALLAX-2", vessel: "parallax", economic: "2", territorial: "0", diplomatic: "0", social: "0", total },
  ];
  return JSON.stringify({
    v: 1,
    kind: "fleet-run",
    started: "2026-10-04T00:00:00.000Z",
    rpc: "http://127.0.0.1:8547",
    forkBlock: 27674000,
    roster: [
      { name: "VITRUV-3", address: "0x1", lau: null, yue: null, vessel: "vitruv" },
      { name: "KESTREL-7", address: "0x2", lau: null, yue: null, vessel: "kestrel" },
      { name: "MERIDIAN-5", address: "0x3", lau: null, yue: null, vessel: "meridian" },
      { name: "PARALLAX-2", address: "0x4", lau: null, yue: null, vessel: "parallax" },
    ],
    events,
    scores: [
      { atEvent: 2, t: 3, rows: rows("14") },
      { atEvent: 8, t: 9, rows: rows("15") },
    ],
    finished: "2026-10-04T00:01:00.000Z",
  });
}

async function armFromSys(page: import("@playwright/test").Page): Promise<void> {
  // the dock is open by default on desktop — straight to SYS
  await page.getByTestId("agent-tab-sys").click();
  await page.getByTestId("sys-fleet-load").setInputFiles({
    name: "flagship.json",
    mimeType: "application/json",
    buffer: Buffer.from(fixtureRecording(), "utf8"),
  });
  await expect(page.getByTestId("sys-fleet-table")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("sys-fleet-row")).toHaveCount(4);
  await page.getByTestId("sys-fleet-replay").click();
  // the conversation renders on CORE — back from the SYS tab
  await page.getByTestId("agent-tab-core").click();
}

test.describe("THE REPLAY flagship (SYS-armed, header strip)", () => {
  test("load → arm → scrub: surfaces re-route, the fold resets backward, the board follows the playhead", async ({ page }) => {
    await page.goto(DEAD_RPC);
    await expect(page.getByTestId("view-deck")).toBeVisible({ timeout: 10_000 });
    await armFromSys(page);

    // the SLIM HEADER strip docks in the hardware-strip row; the deck's
    // unlocked bays re-based on the default composition (locked defaults stay)
    const strip = page.getByTestId("replay-strip");
    await expect(strip).toBeVisible();
    await expect(page.getByTestId("replay-seek")).toBeVisible();
    const grid = page.getByTestId("deck-grid");
    await expect(grid.locator('[data-slot="col2-bottom"]')).toHaveAttribute("data-kind", "map_focus");
    await expect(grid.locator('[data-slot="col3-bottom"]')).toHaveAttribute("data-kind", "chat_monitor");

    // 62.1: the AI_CORE pane carries the REPLAYED conversation — banner +
    // vessel-colored turn markers + the recorded tool cards; the input fences
    await expect(page.getByTestId("replay-banner")).toBeVisible();
    await expect(page.getByTestId("agent-input")).toBeDisabled();
    await page.getByTestId("replay-seek").fill("2");
    await expect(page.getByTestId("replay-marker").first()).toContainText("VITRUV-3");
    await expect(page.getByTestId("agent-toolcall").first()).toContainText("CALLING TOOL: get_venue");
    await expect(page.getByTestId("agent-toolresult").first()).toContainText("TOOL RESULT: get_venue ok");

    // the per-agent filter (a compact select on the slim strip) narrows the
    // conversation to one vessel (the grid's per-vessel cells)
    await page.getByTestId("replay-seek").fill("7");
    await page.getByTestId("replay-filter").selectOption("MERIDIAN-5");
    await expect(page.getByTestId("replay-banner")).toContainText("MERIDIAN-5");
    await expect(page.getByTestId("replay-marker")).toHaveCount(1);
    await expect(page.getByTestId("replay-marker").first()).toContainText("MERIDIAN-5");
    await expect(page.getByTestId("agent-answer").last()).toContainText("the channel carries the offer");
    await page.getByTestId("replay-filter").selectOption({ label: "all vessels" });

    // forward: seek onto the venue read → the venue bay takes it through the REAL router
    await page.getByTestId("replay-seek").fill("2");
    await expect(grid.locator('[data-slot="col3-bottom"]')).toHaveAttribute("data-kind", "venue", { timeout: 10_000 });
    await expect(grid.locator('[data-slot="col3-top"]')).toHaveAttribute("data-kind", "task_graph");
    await expect(page.getByTestId("replay-readout")).toContainText("VITRUV-3");
    await expect(page.getByTestId("replay-actor")).toContainText("VITRUV-3");

    // the agent-directed surface re-surfaces in its recorded bay (index 6)
    await page.getByTestId("replay-seek").fill("6");
    await expect(grid.locator('[data-slot="col3-bottom"]')).toHaveAttribute("data-kind", "kb_excerpt", { timeout: 10_000 });
    await expect(grid.locator('[data-kind="kb_excerpt"]')).toHaveCount(1); // one bay per kind — the 63 law
    await expect(page.getByTestId("replay-readout")).toContainText("MERIDIAN-5");

    // the AS-OF board: on SYS, at event 6 the latest snapshot is the event-2 one
    await page.getByTestId("agent-tab-sys").click();
    await expect(page.getByTestId("sys-fleet-table")).toBeVisible();
    await expect(page.getByTestId("sys-fleet-source")).toContainText("as-of");
    await page.getByTestId("agent-tab-core").click();

    // backward: scrub to the start — UNLOCKED bays reset to the default
    // composition (the venue/kb fold re-derived to nothing)
    await page.getByTestId("replay-seek").fill("-1");
    await expect(grid.locator('[data-slot="col3-bottom"]')).toHaveAttribute("data-kind", "chat_monitor", { timeout: 10_000 });
    await expect(grid.locator('[data-kind="kb_excerpt"]')).toHaveCount(0);
    await expect(grid.locator('[data-kind="venue"]')).toHaveCount(0);
    // the locked defaults persisted throughout
    await expect(grid.locator('[data-slot="col2-bottom"]')).toHaveAttribute("data-kind", "map_focus");

    // play: the clock advances the spine readout; the speed buttons toggle
    await page.getByTestId("replay-speed-2").click();
    await page.getByTestId("replay-play").click();
    await expect(page.getByTestId("replay-readout")).toContainText(/VITRUV|KESTREL|MERIDIAN|PARALLAX|—/, { timeout: 10_000 });
    await expect(grid.locator('[data-slot="col3-bottom"]')).toHaveAttribute("data-kind", "venue", { timeout: 15_000 });

    // exit: the strip leaves, the deck keeps its rendered history
    await page.getByTestId("replay-disarm").click();
    await expect(strip).toHaveCount(0);
    await expect(grid.locator('[data-slot="col3-bottom"]')).toHaveAttribute("data-kind", "venue");
  });

  test("refuses a non-recording honestly; the strip never appears", async ({ page }) => {
    await page.goto(DEAD_RPC);
    await expect(page.getByTestId("view-deck")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("agent-tab-sys").click();
    await page.getByTestId("sys-fleet-load").setInputFiles({
      name: "not-a-recording.json",
      mimeType: "application/json",
      buffer: Buffer.from("{\"v\": 2}", "utf8"),
    });
    await expect(page.getByTestId("sys-fleet-error")).toContainText(/not a fleet recording|version/, { timeout: 10_000 });
    await expect(page.getByTestId("replay-strip")).toHaveCount(0);
  });
});
