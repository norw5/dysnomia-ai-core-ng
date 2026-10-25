import { expect, test } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

const DEAD_RPC = "/?rpc=http://127.0.0.1:9999"; // dead port: fast RPC errors, SIM indication

/**
 * session-70: the GLOBAL sync engine — header control, honest chips, and
 * the SETTINGS surface. The dead port is a SIM-class RPC, so the engine
 * starts PAUSED (the sim default — no background walks behind a pin);
 * resuming against the dead RPC proves the error honesty (UNREADABLE ≠
 * ABSENT: per-feed errors, never fake-empty success), and the pause
 * preference persists in the `sync` IDB store across reloads.
 */

test.describe("sync engine — the header DATA control", () => {
  test("sim default is PAUSED; resume surfaces the dead-RPC ERROR honestly; pause again", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);

    const chip = page.getByTestId("sync-engine-chip");
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(chip).toContainText("PAUSED");

    await chip.click(); // resume — the dead RPC must surface as ERROR
    await expect(chip).toContainText(/ERROR|SYNCING…/, { timeout: 20_000 });
    await expect(chip).toContainText("ERROR", { timeout: 20_000 });

    await chip.click(); // pause again
    await expect(chip).toContainText("PAUSED");
  });

  test("the pause preference survives a reload (the sync IDB store)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    const chip = page.getByTestId("sync-engine-chip");
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(chip).toContainText("PAUSED");
    await chip.click(); // resumed — persists as the preference
    await expect(chip).toContainText(/ERROR|SYNCING…/, { timeout: 20_000 });
    await page.waitForTimeout(400); // the §7.10 reload-vs-IDB-commit race
    await page.reload();
    await expect(page.getByTestId("sync-engine-chip")).toContainText(/ERROR|SYNCING…/, { timeout: 20_000 });
    await page.getByTestId("sync-engine-chip").click();
    await expect(page.getByTestId("sync-engine-chip")).toContainText("PAUSED");
  });
});

test.describe("sync engine — the SETTINGS surface", () => {
  test("status + pause/resume + the two-click cache wipe", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();

    await expect(page.getByTestId("sync-panel")).toBeVisible({ timeout: 10_000 });
    // the dead port is a sim-class RPC — the engine starts PAUSED
    await expect(page.getByTestId("sync-panel-state")).toHaveText("PAUSED");

    const toggle = page.getByTestId("sync-panel-toggle");
    await toggle.click(); // resume — the dead RPC surfaces honestly
    await expect(page.getByTestId("sync-panel-state")).toHaveText("RUNNING");
    await expect(page.getByTestId("sync-engine-chip")).toContainText(/ERROR|SYNCING…/, { timeout: 20_000 });
    await toggle.click(); // pause again
    await expect(page.getByTestId("sync-panel-state")).toHaveText("PAUSED");

    const wipe = page.getByTestId("sync-panel-wipe");
    await wipe.click(); // arms
    await expect(wipe).toContainText("click again to confirm");
    await wipe.click(); // wipes
    await expect(page.getByTestId("sync-panel-state")).toHaveText(/RUNNING|PAUSED/);
  });
});

test.describe("sync engine — honest seed chips in DIRECTORY", () => {
  test("LAU tab carries the frozen-census as-of chip", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-directory").click();
    await expect(page.getByTestId("lau-seed-chip")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("lau-seed-chip")).toContainText(/SEED · as of 2[0-9,]{9}/);
  });

  test("QING tab carries the sync-state chip (dead RPC: paused by the sim default, list still renders)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-directory").click();
    await page.getByTestId("dir-tab-qing").click();

    await expect(page.getByTestId("qing-sync-chip")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("qing-sync-chip")).toContainText("SYNC PAUSED");
    // seed browse still works — the census is local; the chip names the engine
    await expect(page.getByTestId("venue-sidebar")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("venue-search").fill("ozymandias");
    await expect(page.getByTestId("venue-list").locator("li")).toHaveCount(1, { timeout: 5_000 });
  });

  test("the sidebar count testid names the merged census (seed, no live rows offline)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-map").click();
    await expect(page.getByTestId("venue-count")).toContainText("· 940", { timeout: 10_000 });
  });
});
