import { expect, test } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

const DEAD_RPC = "/?rpc=http://127.0.0.1:9999"; // dead port: fast RPC errors, SIM indication

/**
 * STUDIO rework (session-78): the contract index replaces the dropdown; the
 * workspace carries the contract header + stats + function index; the call
 * form keeps every gate capability. The docs link opens the SAME kb/dev
 * corpus the agent searches (the docs one-source law).
 */
test.describe("STUDIO — the contract index + workspace (session-78)", () => {
  test("contract search filters the perimeter, selects, and the workspace names source + stats", async ({
    page,
  }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-studio").click();
    await expect(page.getByTestId("view-studio")).toBeVisible();

    // the fresh-storage default is the CHOA hub, and the index counts the
    // whole perimeter (31 contracts at this pin)
    await expect(page.getByTestId("studio-contract-count")).toContainText("31");
    await expect(page.getByTestId("studio-contract-title")).toHaveText("CHOA");

    // filter by SOURCE family (three SHIO instances + the SHIOFactory share
    // one source token; the search is honest about what matched)
    await page.getByTestId("studio-contract-search").fill("shio");
    await expect(page.getByTestId("studio-contract-count")).toContainText("4 / 31");
    await expect(page.getByTestId("studio-contract-CHOA")).toHaveCount(0);
    await expect(page.getByTestId("studio-contract-ErisSHIO")).toBeVisible();
    await expect(page.getByTestId("studio-contract-SHIOFactory")).toBeVisible();

    // a clear empty state (never a silent blank list)
    await page.getByTestId("studio-contract-search").fill("no-such-contract");
    await expect(page.getByTestId("studio-contract-empty")).toBeVisible();
    await page.getByTestId("studio-contract-search").fill("");

    await page.getByTestId("studio-contract-ErisSHIO").click();
    await expect(page.getByTestId("studio-contract-title")).toHaveText("ErisSHIO");
    await expect(page.getByTestId("studio-workspace")).toContainText("source · SHIO");
    await expect(page.getByTestId("studio-stat-functions")).toContainText("33");
    await expect(page.getByTestId("studio-stat-reads")).toContainText("18");
    await expect(page.getByTestId("studio-stat-writes")).toContainText("15");
    // the SHIO source doc is reachable from the header
    await expect(page.getByTestId("studio-docs-link")).toBeVisible();
  });

  test("function search + the reads/writes filters narrow the index; a selection opens the call form", async ({
    page,
  }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-studio").click();
    await page.getByTestId("studio-contract-CHOA").click();

    await page.getByTestId("studio-fn-search").fill("chat");
    await expect(page.getByTestId("studio-fn-Chat")).toBeVisible();
    await expect(page.getByTestId("studio-fn-Play")).toHaveCount(0);

    await page.getByTestId("studio-fn-search").fill("");
    await page.getByTestId("studio-filter-reads").click();
    await expect(page.getByTestId("studio-fn-Chat")).toHaveCount(0); // nonpayable
    await expect(page.getByTestId("studio-fn-totalSupply")).toBeVisible();
    await expect(page.getByTestId("studio-fn-count")).toContainText("15 / 26");

    await page.getByTestId("studio-filter-writes").click();
    await expect(page.getByTestId("studio-fn-Chat")).toBeVisible();
    await expect(page.getByTestId("studio-fn-totalSupply")).toHaveCount(0);
    await page.getByTestId("studio-filter-all").click();

    // selecting a function fills the call workspace (no send happens)
    await page.getByTestId("studio-fn-Chat").click();
    await expect(page.getByTestId("studio-call")).toContainText("Chat(address");
    await expect(page.getByTestId("studio-arg-0")).toBeVisible();
    await expect(page.getByTestId("studio-arg-1")).toBeVisible();
    await expect(page.getByTestId("studio-empty")).toHaveCount(0);
  });

  test("the engineering-docs link opens the kb/dev corpus in LEARN; a no-doc contract says so", async ({
    page,
  }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-studio").click();

    // CHOA → kb/dev/choa.md, rendered by the SAME corpus search_kb chunks
    await expect(page.getByTestId("studio-docs-link")).toBeVisible();
    await page.getByTestId("studio-docs-link").click();
    await expect(page.getByTestId("view-learn")).toBeVisible();
    await expect(page.getByTestId("learn-doc-file")).toContainText("kb/dev/choa.md", { timeout: 10_000 });
    await expect(page.getByTestId("learn-source-dev")).toHaveClass(/active/);
    const body = await page.getByTestId("learn-dev-doc-choa").innerText();
    expect(body.length).toBeGreaterThan(500);

    // AFFECTION (IAlchemicalGold) has no engineering doc — never a wrong file
    await page.getByTestId("rail-studio").click();
    await page.getByTestId("studio-contract-AFFECTION").click();
    await expect(page.getByTestId("studio-contract-title")).toHaveText("AFFECTION");
    await expect(page.getByTestId("studio-docs-none")).toContainText("no engineering doc");
    await expect(page.getByTestId("studio-docs-link")).toHaveCount(0);
  });

  test("session-79 compact tap path: a selected function jumps to the call form; desktop never moves", async ({
    page,
  }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.setViewportSize({ width: 430, height: 900 });
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-studio").click();
    await expect(page.getByTestId("view-studio")).toBeVisible();

    const fn = page.getByTestId("studio-fn-Chat");
    await fn.scrollIntoViewIfNeeded();
    await fn.click();
    await expect(page.getByTestId("studio-jump-call")).toBeVisible();
    await page.getByTestId("studio-jump-call").click();
    await expect(page.getByTestId("studio-call")).toBeInViewport({ ratio: 0.2 });

    // desktop: the affordance is absent and selecting never scrolls the page
    await page.setViewportSize({ width: 1920, height: 1200 });
    await page.reload();
    await page.getByTestId("rail-studio").click();
    await expect(page.getByTestId("studio-fn-Chat")).toBeVisible();
    await page.getByTestId("studio-fn-Chat").click();
    await expect(page.getByTestId("studio-jump-call")).toBeHidden();
    expect(await page.evaluate(() => document.querySelector("main")?.scrollTop ?? 0)).toBe(0);
  });

  test("session-79 copy: the plain-http fallback selects the address and names the failure", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-studio").click();
    await expect(page.getByTestId("studio-contract-address")).toBeVisible();

    // simulate an insecure context: no async clipboard + a refused legacy copy
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      document.execCommand = () => false;
    });
    await page.getByTestId("studio-copy-address").click();
    await expect(page.getByTestId("studio-copy-address")).toHaveText("select");
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
    const address = await page.getByTestId("studio-contract-address").innerText();
    expect(selected).toBe(address);
  });
});
