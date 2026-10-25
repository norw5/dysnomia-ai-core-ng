import { expect, test } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

test.describe("mobile viewport smoke (responsive collapse, IA-PLAN §11.5)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("single column: bottom tab rail, no dock/gutter, agent opens as a sheet", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/");
    // module tabs dock to the bottom of the viewport
    const rail = page.getByTestId("rail");
    await expect(rail).toBeVisible();
    const railPos = await rail.evaluate((el) => getComputedStyle(el).position);
    const railBottom = await rail.evaluate((el) => getComputedStyle(el).bottom);
    expect(railPos).toEqual("fixed");
    expect(railBottom).toEqual("0px");
    // desktop dock controls hidden
    await expect(page.getByTestId("toggle-agent")).toBeVisible();
    // the sheet toggle is there and opens the agent sheet
    await page.getByTestId("toggle-agent").click();
    await expect(page.getByTestId("agent-sheet")).toHaveClass(/open/);
    await page.getByTestId("sheet-tab-logs").click();
    await expect(page.getByTestId("event-feed")).toBeVisible();
    await page.getByTestId("sheet-close").click();
    await expect(page.getByTestId("agent-sheet")).not.toHaveClass(/open/);
  });

  test("the deck composition collapses gracefully: passport above the single-column bays (session-57/63)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/?rpc=http://127.0.0.1:9999");
    await expect(page.getByTestId("view-deck")).toBeVisible({ timeout: 10_000 });
    // the passport pane rides ABOVE the bays in one column (not a squished
    // side rail), the onboarding bay shows, and the defaults stack
    await expect(page.getByTestId("deck-passport")).toBeVisible({ timeout: 10_000 });
    const grid = page.getByTestId("deck-grid");
    await expect(grid.locator('[data-slot="col2-top"]')).toHaveAttribute("data-kind", "onboarding", { timeout: 15_000 });
    await expect(grid.locator('[data-slot="col3-bottom"]')).toHaveAttribute("data-kind", "chat_monitor", { timeout: 15_000 });
    const layoutCols = await page.getByTestId("view-deck").locator(".deck-layout").evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(layoutCols.split(" ").length).toBe(1);
  });

  test("studio stays usable: contract + fn + DRYRUN in one column", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/?rpc=http://127.0.0.1:9999");
    await page.getByTestId("rail-studio").click();
    await expect(page.getByTestId("view-studio")).toBeVisible();
    await page.getByTestId("studio-contract-CHOA").click();
    await page.getByTestId("studio-fn-Chat").click();
    await page.getByTestId("studio-arg-0").fill("0x0000000000000000000000000000000000000001");
    await page.getByTestId("studio-arg-1").fill("mobile");
    await page.getByTestId("studio-dryrun").click();
    await expect(page.getByTestId("studio-sim")).toContainText("reverted", { timeout: 10_000 });
  });
});

test.describe("desktop layout mechanics (pointer:fine)", () => {
  test("draggable dock gutter resizes and persists per-user", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const gutter = page.getByTestId("gutter-dock");
    await expect(gutter).toBeVisible();
    const before = await page.getByTestId("main-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    // keyboard-resize (accessibility path, deterministic in CI)
    await gutter.focus();
    await page.keyboard.press("ArrowLeft"); // -24px on the inverted dock gutter
    await page.keyboard.press("ArrowLeft");
    const after = await page.getByTestId("main-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(after).not.toEqual(before);
    // persisted
    const stored = await page.evaluate(() => window.localStorage.getItem("dys.layout.v1"));
    expect(stored).toContain("\"dock\"");
    // collapse via topbar
    await page.getByTestId("toggle-agent").click();
    await expect(page.getByTestId("agent-dock")).toHaveCount(0);
    await page.getByTestId("toggle-agent").click();
    await expect(page.getByTestId("agent-dock")).toBeVisible();
  });
});
