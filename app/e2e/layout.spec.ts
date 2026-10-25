import { expect, test } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

const DEAD_RPC = "/?rpc=http://127.0.0.1:9999"; // dead port: fast RPC errors, SIM indication

/**
 * THE CENTERED CONTENT LAW (session-78): IDENTITY / MARKET / DIRECTORY /
 * STUDIO / LEARN / SETTINGS center ONE view-level column with equal side
 * margins; DECK / MAP / CHAT stay edge-to-edge by design. Geometry is the
 * assertion — a future CSS regression fails here, not in a screenshot.
 */
test.describe("LAYOUT — the centered content column (session-78)", () => {
  test("non-exempt views center; DECK/MAP/CHAT stay edge-to-edge", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.setViewportSize({ width: 1920, height: 1200 });
    await page.goto(DEAD_RPC);
    // give the main column the wide-screen room the owner reviewed
    await page.getByTestId("toggle-agent").click();
    await expect(page.getByTestId("agent-dock")).toHaveCount(0);

    const gaps = async (testid: string) =>
      page.evaluate((id) => {
        const content = document.querySelector("main.content")!.getBoundingClientRect();
        const view = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        return {
          left: Math.round(view.left - content.left),
          right: Math.round(content.right - view.right),
          width: Math.round(view.width),
          contentWidth: Math.round(content.width),
        };
      }, testid);

    const CENTERED = [
      ["rail-identity", "view-identity"],
      ["rail-market", "view-market"],
      ["rail-directory", "view-directory"],
      ["rail-studio", "view-studio"],
      ["rail-learn", "view-learn"],
      ["rail-settings", "view-settings"],
    ] as const;

    for (const [rail, view] of CENTERED) {
      await page.getByTestId(rail).click();
      await expect(page.getByTestId(view)).toBeVisible();
      const g = await gaps(view);
      expect(Math.abs(g.left - g.right), `${view} equal margins`).toBeLessThanOrEqual(2);
      expect(g.left, `${view} is centered, not left-hugging`).toBeGreaterThan(100);
      expect(g.width, `${view} keeps a real column`).toBeLessThan(g.contentWidth);
    }

    // the exempt surfaces still fill the main content width
    for (const [rail, view] of [
      ["rail-deck", "view-deck"],
      ["rail-map", "view-map"],
      ["rail-chat", "view-chat"],
    ] as const) {
      await page.getByTestId(rail).click();
      await expect(page.getByTestId(view)).toBeVisible({ timeout: 15_000 });
      const g = await gaps(view);
      expect(g.width, `${view} stays edge-to-edge`).toBeGreaterThan(g.contentWidth - 60);
    }
  });
});
