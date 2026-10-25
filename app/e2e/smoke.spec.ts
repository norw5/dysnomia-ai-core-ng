import { expect, test } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

test.describe("shell smoke (mock-provider harness attached)", () => {
  test("nav rail renders all nine views (deck first — the §7.11 landing)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/");
    await expect(page.getByTestId("rail")).toBeVisible();
    for (const id of ["deck", "map", "chat", "identity", "market", "directory", "studio", "learn", "settings"]) {
      await expect(page.getByTestId(`rail-${id}`)).toBeVisible();
    }
  });

  test("DECK is the default landing view with the seeded default slot map (session-57/63)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/?rpc=http://127.0.0.1:9999");
    await expect(page.getByTestId("view-deck")).toBeVisible({ timeout: 10_000 });
    // fresh storage seeds the default slot map — the deck's front door is a
    // composition, not an empty grid (the identity pane rides as deck chrome)
    await expect(page.getByTestId("deck-passport")).toBeVisible();
    for (const [slot, kind] of [
      ["col2-top", "onboarding"],
      ["col2-bottom", "map_focus"],
      ["col3-top", "task_graph"],
      ["col3-bottom", "chat_monitor"],
    ] as const) {
      await expect(page.getByTestId("deck-grid").locator(`[data-slot="${slot}"]`)).toHaveAttribute("data-kind", kind, { timeout: 15_000 });
    }
  });

  test("mock EIP-1193 provider is injected and reports chain 369", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/");
    const chainId = await page.evaluate(() => window.ethereum!.request({ method: "eth_chainId" }));
    expect(chainId).toEqual("0x171");
  });

  test("settings shows the perimeter table with explorer links", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/");
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("view-settings")).toBeVisible();
    await expect(page.getByTestId("perimeter")).toBeVisible();
    const rows = await page.getByTestId("perimeter").locator("tbody tr").count();
    expect(rows).toBeGreaterThan(30);
  });

  test("?rpc= dev override flips the indicator to SIM (no network needed)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/?rpc=http://127.0.0.1:9999");
    await expect(page.getByTestId("livesim")).toHaveText("SIM", { timeout: 10_000 });
    await expect(page.getByTestId("rpc")).toContainText("?rpc= dev override");
  });

  test("layout always stretches to the full viewport height (owner round, session-42)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?rpc=http://127.0.0.1:9999");
    await page.waitForTimeout(1500);
    // short-content pages must still fill the viewport: main grid + agent dock
    // reach the bottom edge (the old two-row grid let .app size to content)
    const bottoms = await page.evaluate(() => ({
      app: Math.round(document.querySelector(".app")!.getBoundingClientRect().bottom),
      main: Math.round(document.querySelector(".main")!.getBoundingClientRect().bottom),
      dock: Math.round(document.querySelector(".dock")!.getBoundingClientRect().bottom),
      vh: window.innerHeight,
    }));
    expect(bottoms.app).toEqual(bottoms.vh);
    expect(bottoms.main).toEqual(bottoms.vh);
    expect(bottoms.dock).toEqual(bottoms.vh);

    // same on the compact breakpoint (bottom tab bar excluded — it overlays)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    const compact = await page.evaluate(() => ({
      app: Math.round(document.querySelector(".app")!.getBoundingClientRect().bottom),
      vh: window.innerHeight,
    }));
    expect(compact.app).toEqual(compact.vh);
  });
});
