import { expect, test } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

const DEAD_RPC = "/?rpc=http://127.0.0.1:9999"; // dead port: fast RPC errors, SIM indication

/**
 * DIRECTORY skeleton (session-44): census browse + search over the seeded
 * LAU list, read-only entity profiles (dead RPC = honest unavailable), and
 * the QING tab reusing the unified sidebar.
 */

test.describe("DIRECTORY — LAU census", () => {
  test("browse + search + read-only profile with honest dead-RPC state", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-directory").click();

    await expect(page.getByTestId("view-directory")).toBeVisible();
    // the census loads (18,660) and the browse order is newest-first
    await expect(page.getByTestId("lau-list")).toBeVisible({ timeout: 10_000 });
    const rows = page.getByTestId("lau-list").locator("button");
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });

    // search pins the dev's known LAU (guide: mariarahel, 0xd32c…2e69)
    await page.getByTestId("lau-search").fill("mariarahel");
    await expect(rows).toHaveCount(1, { timeout: 5_000 });
    await rows.first().click();

    const profile = page.getByTestId("lau-profile");
    await expect(profile).toBeVisible();
    await expect(profile).toContainText("0xd32c39fee49391c7952d1b30b15921b0d3b42e69");
    await expect(profile).toContainText("block 21,220,723");
    // dead RPC is an ERROR, not an empty profile (the fail-fast rule)
    await expect(page.getByTestId("lau-live")).toContainText("live reads unavailable", { timeout: 10_000 });
  });

  test("address search works too; clearing the profile returns to the empty state", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-directory").click();
    await expect(page.getByTestId("lau-list").locator("button").first()).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("lau-search").fill("0xd1ec0519cd26824e");
    await expect(page.getByTestId("lau-list").locator("button")).toHaveCount(1, { timeout: 5_000 });
    await page.getByTestId("lau-list").locator("button").first().click();
    await expect(page.getByTestId("lau-profile")).toContainText("surfacing");

    await page.getByTestId("lau-clear").click();
    await expect(page.getByTestId("lau-profile-host")).toContainText("pick a LAU");
  });
});

test.describe("DIRECTORY — QING tab (unified sidebar reuse)", () => {
  test("the QING tab lists the 917-venue seed and selects app-globally", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-directory").click();
    await page.getByTestId("dir-tab-qing").click();

    const sidebar = page.getByTestId("venue-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("venue-search").fill("ozymandias");
    await page.getByTestId("venue-list").locator("button").first().click();
    await expect(page.getByTestId("venue-clear")).toBeVisible({ timeout: 5_000 });
    // the selection is app-global: MAP shows the same venue
    await page.getByTestId("rail-map").click();
    await expect(page.getByTestId("current-venue")).toContainText("Ozymandias", { timeout: 10_000 });
  });
});

test.describe("DIRECTORY — SHIO tab (session-48 census seed)", () => {
  test("browse + address search + profile with the honest dead-RPC state", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-directory").click();
    await page.getByTestId("dir-tab-shios").click();

    const list = page.getByTestId("shio-list");
    await expect(list).toBeVisible({ timeout: 15_000 });
    await expect(list.locator("button").first()).toBeVisible({ timeout: 15_000 });

    // the world channel (ZHOU's SHIO) is findable by address fragment
    await page.getByTestId("shio-search").fill("0x7ae73c498a3082");
    await expect(list.locator("button")).toHaveCount(1, { timeout: 5_000 });
    await list.locator("button").first().click();

    const profile = page.getByTestId("shio-profile");
    await expect(profile).toBeVisible();
    await expect(profile).toContainText("block 21,220,693");
    // dead RPC = ERROR, never an empty profile
    await expect(page.getByTestId("shio-live")).toContainText("live reads unavailable", { timeout: 10_000 });
  });
});

test.describe("DIRECTORY — YUE tab (session-48 census seed + live resolver)", () => {
  test("browse + search + profile; the wallet→YUE resolver degrades honestly offline", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-directory").click();
    await page.getByTestId("dir-tab-yues").click();

    const list = page.getByTestId("yue-list");
    await expect(list).toBeVisible({ timeout: 15_000 });
    await expect(list.locator("button").first()).toBeVisible({ timeout: 15_000 });
    // the 93-vault census renders locally (browse-capped, the LAU-tab idiom) + the honest more-hint
    await expect(list.locator("button")).toHaveCount(60, { timeout: 10_000 });
    await expect(page.getByTestId("yue-more")).toContainText("60 of 93");

    // search by the dev's known vault name
    await page.getByTestId("yue-search").fill("mariarahel");
    await expect(list.locator("button")).toHaveCount(1, { timeout: 5_000 });
    await list.locator("button").first().click();

    const profile = page.getByTestId("yue-profile");
    await expect(profile).toBeVisible();
    await expect(profile).toContainText("block 23,713,503");
    await expect(page.getByTestId("yue-live")).toContainText("live reads unavailable", { timeout: 10_000 });

    // the live resolver (CHAN.Yan): dead RPC surfaces the honest read-failed state
    await page.getByTestId("yue-probe-input").fill("0x047460633210e2dd1f0cd6f5e26d92b30f9bd70f");
    await page.getByTestId("yue-probe-run").click();
    await expect(page.getByTestId("yue-probe-error")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("DIRECTORY — CHO tab (session-53, B1.6: the system address book)", () => {
  test("renders the book surface; dead RPC is the honest unavailable state, never an empty book", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-directory").click();

    await page.getByTestId("dir-tab-cho").click();
    const book = page.getByTestId("cho-book");
    await expect(book).toBeVisible();
    // the education layer: the CROWS/WITHOUT grounding is stated in the panel
    await expect(book).toContainText("phone book");
    await expect(book).toContainText("CROWS");
    await expect(book).toContainText("WITHOUT");
    await expect(book).toContainText("Aliases(i)");
    // the walk is live-only (no seed): a dead RPC errors honestly
    await expect(page.getByTestId("cho-book-error")).toContainText("live reads unavailable", { timeout: 15_000 });
    // search + refresh exist and stay inert offline
    await page.getByTestId("cho-search").fill("crows");
    await page.getByTestId("cho-refresh").click();
    await expect(page.getByTestId("cho-book-error")).toBeVisible({ timeout: 15_000 });
  });
});
