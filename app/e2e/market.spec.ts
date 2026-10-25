import { expect, test } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

const DEAD_RPC = "/?rpc=http://127.0.0.1:9999"; // dead port: fast RPC errors, SIM indication

/**
 * MARKET (session-48): the three tabs. Power + Assets read live state and
 * degrade honestly offline (dead RPC); PAIRS is pure seed — the curated LP
 * list renders with OUT-LINKS ONLY (explorer + dexscreener) and no trading
 * surface exists anywhere in the tab.
 */

test.describe("MARKET — pairs (seed, offline)", () => {
  test("renders the curated LP list with out-links only, no trading surface", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-market").click();

    await expect(page.getByTestId("view-market")).toBeVisible();
    await page.getByTestId("market-tab-pairs").click();
    const table = page.getByTestId("pairs-table");
    await expect(table).toBeVisible({ timeout: 10_000 });
    // the seed chunk loads async — poll rows in before measuring (table-visible ≠ rows-rendered)
    await expect.poll(() => table.locator("tbody tr").count()).toBeGreaterThan(100);

    // out-links: explorer address page + dexscreener pair page, both guarded
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="pairs-table"] a')).map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "")
    );
    expect(hrefs.length).toBeGreaterThan(100);
    for (const href of hrefs) {
      expect(/\/address\/0x[0-9a-fA-F]{40}$/.test(href) || /^https:\/\/dexscreener\.com\/pulsechain\/0x[0-9a-fA-F]{40}$/.test(href)).toBe(true);
    }

    // NO trading surface: the only input in the tab is the search box
    const inputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="market-pairs"] input')).map((i) => (i as HTMLInputElement).type)
    );
    expect(inputs).toEqual(["search"]);
  });

  test("search filters the seed locally", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-market").click();
    await page.getByTestId("market-tab-pairs").click();
    await expect(page.getByTestId("pairs-table")).toBeVisible({ timeout: 10_000 });
    // the seed chunk loads async — wait for rows before measuring
    await expect.poll(() => page.getByTestId("pairs-row").count()).toBeGreaterThan(100);

    const before = await page.getByTestId("pairs-row").count();
    await page.getByTestId("pairs-search").fill("atropa");
    await expect.poll(() => page.getByTestId("pairs-row").count()).toBeLessThan(before);
    await expect(page.getByTestId("pairs-row")).toHaveCount(1);
  });
});

test.describe("MARKET — power + assets (offline honesty)", () => {
  test("power tab renders the four constellation panels + identity subset offline", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-market").click();

    await expect(page.getByTestId("market-power")).toBeVisible();
    // the four constellation tokens are pinned from config — seed-safe offline
    for (const key of ["fornax", "eris", "fomalhaute", "tethys"]) {
      await expect(page.getByTestId(`market-power-${key}`)).toBeVisible({ timeout: 10_000 });
    }
    // no account connected: honest hint, no phantom balances
    await expect(page.getByTestId("market-power")).toContainText("connect an account");
    // the notes carry the deployed facts (ceiling real, Tethys = CHO)
    await expect(page.getByTestId("market-power-notes")).toContainText("Goldilocks ceiling");
    await expect(page.getByTestId("market-power-notes")).toContainText("Tethys — CHO itself");
  });

  test("assets tab renders the Ⓐ desk scaffold with the venue picker hint", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-market").click();
    await page.getByTestId("market-tab-assets").click();

    await expect(page.getByTestId("market-assets")).toBeVisible();
    await expect(page.getByTestId("market-assets")).toContainText("no venue selected");
    await expect(page.getByTestId("market-assets")).toContainText("AFFECTION");
    // the redeem leg is venue-contextual — absent without a selection
    await expect(page.getByTestId("market-redeem")).toHaveCount(0);
  });

  test("exchange tab renders the YUE desk scaffold + the attenuation explainer honestly", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-market").click();
    await page.getByTestId("market-tab-exchange").click();

    await expect(page.getByTestId("market-exchange")).toBeVisible();
    await expect(page.getByTestId("market-exchange")).toContainText("no venue selected");
    // the education layer names the walk + the fork-pinned counterparty story
    await expect(page.getByTestId("market-exchange-explain")).toContainText("777-mod attenuation");
    await expect(page.getByTestId("market-exchange-explain")).toContainText("ExchangeRateNotFound");
    // no dead-RPC state may masquerade as a live rate: the desk actions stay
    // inert without venue + account context (the buttons don't even render)
    await expect(page.getByTestId("market-exchange-dryrun")).toHaveCount(0);
    await expect(page.getByTestId("market-exchange-send")).toHaveCount(0);
  });
});
