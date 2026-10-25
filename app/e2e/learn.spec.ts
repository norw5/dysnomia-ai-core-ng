import { expect, test } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

const DEAD_RPC = "/?rpc=http://127.0.0.1:9999"; // dead port: fast RPC errors, SIM indication

const FILES = ["README", "overview", "accounts-and-chat", "venues", "economy", "the-ladder", "bridge", "glossary"];

/**
 * LEARN (session-48): the 8-file definitive guide, terminal-style, from the
 * SAME verbatim files the agent searches. Every file renders; the glossary
 * dictionary pass underlines terms; nothing in the view posts anywhere.
 */

test.describe("LEARN — the guide corpus", () => {
  test("renders all 8 guide files through the index", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-learn").click();

    await expect(page.getByTestId("view-learn")).toBeVisible();
    const index = page.getByTestId("learn-index");
    await expect(index).toBeVisible({ timeout: 10_000 });

    for (const f of FILES) {
      await page.getByTestId(`learn-file-${f}`).click();
      const doc = page.getByTestId(`learn-doc-${f}`);
      await expect(doc).toBeVisible({ timeout: 5_000 });
      // real content, not an empty shell
      expect((await doc.innerText()).length).toBeGreaterThan(200);
    }
    // the doc header pins the verbatim source path
    await expect(page.getByTestId("learn-doc-file")).toContainText("guide/");
  });

  test("the glossary dictionary pass underlines terms with hover meanings", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-learn").click();
    await page.getByTestId("learn-file-overview").click();
    await expect(page.getByTestId("learn-doc-overview")).toBeVisible({ timeout: 10_000 });

    // dotted-underline terms exist and carry glossary tooltips
    const terms = page.locator(".gl-term");
    await expect(terms.first()).toBeVisible({ timeout: 5_000 });
    const count = await terms.count();
    expect(count).toBeGreaterThan(4);
    const title = await terms.first().getAttribute("title");
    expect(title && title.length > 5).toBe(true);

    // the glossary page itself renders its table
    await page.getByTestId("learn-file-glossary").click();
    await expect(page.getByTestId("learn-doc-glossary")).toContainText("MotzkinPrime");
  });
});

test.describe("LEARN — the DEV REFERENCE source (session-78, one corpus)", () => {
  test("the kb/dev corpus renders in the same index; the guide source is untouched", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-learn").click();
    await expect(page.getByTestId("view-learn")).toBeVisible();

    // the default source is still the 8-file guide
    await expect(page.getByTestId("learn-doc-file")).toContainText("guide/README.md", { timeout: 10_000 });

    await page.getByTestId("learn-source-dev").click();
    await expect(page.getByTestId("learn-doc-file")).toContainText("kb/dev/README.md");
    await expect(page.getByTestId("learn-source-dev")).toHaveClass(/active/);
    // all 50 engineering files are indexed
    await expect(page.getByTestId("learn-dev-list").locator("li")).toHaveCount(50);

    // session-79: the dev index has a name/title filter (guide index untouched)
    await page.getByTestId("learn-dev-filter").fill("map");
    await expect(page.getByTestId("learn-dev-file-map")).toBeVisible();
    expect(await page.getByTestId("learn-dev-list").locator("li").count()).toBeLessThan(50);
    await page.getByTestId("learn-dev-filter").fill("zzzznope");
    await expect(page.getByTestId("learn-dev-empty")).toBeVisible();
    await page.getByTestId("learn-dev-filter").fill("");
    await expect(page.getByTestId("learn-dev-list").locator("li")).toHaveCount(50);
    await expect(page.getByTestId("learn-dev-filter")).toHaveCount(1);
    await page.getByTestId("learn-source-guide").click();
    await expect(page.getByTestId("learn-dev-filter")).toHaveCount(0);
    await page.getByTestId("learn-source-dev").click();
    await expect(page.getByTestId("learn-dev-filter")).toHaveCount(1);

    // the dev source still opens a file after filtering
    await page.getByTestId("learn-dev-file-shio").click();
    await expect(page.getByTestId("learn-dev-doc-shio")).toBeVisible();
    await expect(page.getByTestId("learn-doc-file")).toContainText("kb/dev/shio.md");
    const body = await page.getByTestId("learn-dev-doc-shio").innerText();
    expect(body.length).toBeGreaterThan(500);
    expect(body).toContain("SHIO");

    // switching back restores the guide (and its `guide/…` header contract)
    await page.getByTestId("learn-source-guide").click();
    await expect(page.getByTestId("learn-doc-file")).toContainText("guide/README.md");
    await expect(page.getByTestId("learn-doc-README")).toBeVisible();
  });
});

test.describe("LEARN — contextual `?` deep-links (session-53, §6 form 2)", () => {
  test("a `?` chip on IDENTITY jumps to LEARN with the file + section anchor", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-identity").click();

    await expect(page.getByTestId("view-identity")).toBeVisible();
    // the FIRST accounts-and-chat chip on IDENTITY is the birth-record panel's
    await page.getByTestId("learn-hint-accounts-and-chat").first().click();

    // the app switched to LEARN and the target file opened
    await expect(page.getByTestId("view-learn")).toBeVisible();
    await expect(page.getByTestId("learn-doc-file")).toContainText("guide/accounts-and-chat.md", { timeout: 10_000 });
    // the anchor is a real rendered heading id (slugified), scrolled into view
    const heading = page.locator("#souls-shas-and-shios");
    await expect(heading).toBeVisible({ timeout: 5_000 });
    const box = await heading.boundingBox();
    const vp = page.viewportSize();
    expect(box).not.toBeNull();
    expect(vp).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThan(vp!.height);
  });

  test("the venue panel chip deep-links to venues.md (selection-independent header)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/");
    await page.getByTestId("rail-map").click();
    await page.getByTestId("venue-search").fill("ozymandias");
    await page.getByTestId("venue-list").locator("button").first().click();
    await page.getByTestId("venue-hud-open-full").click();
    await expect(page.getByTestId("venue-panel")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("learn-hint-venues").click();
    await expect(page.getByTestId("view-learn")).toBeVisible();
    await expect(page.getByTestId("learn-doc-file")).toContainText("guide/venues.md", { timeout: 10_000 });
  });
});
