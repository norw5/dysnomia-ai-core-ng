import { expect, test } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

const DEAD_RPC = "/?rpc=http://127.0.0.1:9999"; // dead port: fast RPC errors, SIM indication

/**
 * CHAT (session-44): the read path — seed archive (world channel), the live
 * tail's honest dead-RPC state, the untrusted-content fence under LIVE-FIRE
 * seed content (the archive really carries data:-URI payloads and tag-like
 * text), channel switching through the unified QING sidebar.
 */

test.describe("CHAT — world channel (seed archive, offline)", () => {
  test("renders the archive terminal-style with the seed/live labeling", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-chat").click();

    const panel = page.getByTestId("chat-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel).toContainText("THE VOID — world channel");

    // the fence banner is always on (§7.4)
    await expect(page.getByTestId("chat-fence")).toContainText("COMMUNITY CONTENT");

    // seed chip pins the archive boundary; dead RPC is an honest tail ERROR
    await expect(page.getByTestId("chat-seed-chip")).toContainText("through 27,597,840", { timeout: 10_000 });
    await expect(page.getByTestId("chat-live-chip")).toContainText("unavailable", { timeout: 10_000 });
    await expect(page.getByTestId("chat-tail-error")).toContainText("live tail unavailable");

    // the newest chunk actually renders lines (seed, labeled)
    const lines = page.getByTestId("chat-line");
    await expect(lines.first()).toBeVisible({ timeout: 10_000 });
    const count = await lines.count();
    expect(count).toBeGreaterThan(50);
    expect(await lines.first().getAttribute("data-source")).toEqual("seed");
  });

  test("untrusted content stays inert: text is text, out-links are http(s) only", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-chat").click();
    await expect(page.getByTestId("chat-line").first()).toBeVisible({ timeout: 10_000 });

    // a real https URL in the archive becomes an out-link with the exact href
    const link = page.locator('a.chat-link[href="https://entropy-dysnomia.vercel.app/langlands.html"]');
    await expect(link).toBeVisible({ timeout: 10_000 });
    await expect(link).toHaveAttribute("rel", "noreferrer noopener");
    await expect(link).toHaveAttribute("target", "_blank");

    // tag-like seed text renders as TEXT, never as elements
    await expect(page.getByTestId("chat-scroll")).toContainText("<Noumenon>");

    // live-fire: the archive carries a data:image/webp;base64 payload — it
    // must exist as text and NO href anywhere may leave the http(s) fence
    await expect(page.getByTestId("chat-scroll").locator("text=/data:image\\/webp/").first()).toBeVisible();
    const schemes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="chat-line"] a')).map((a) =>
        (a as HTMLAnchorElement).getAttribute("href") ?? ""
      )
    );
    expect(schemes.length).toBeGreaterThan(0);
    for (const href of schemes) {
      expect(href.startsWith("http://") || href.startsWith("https://")).toBe(true);
    }

    // structural inertness: OUR chrome may live in the row (the sigil SVG,
    // the handle BUTTON — session-71), but the UNTRUSTED BODY surface
    // (.chat-body / .chat-bubble) still contains only text + spans + guarded anchors
    const tags = await page.evaluate(() =>
      Array.from(new Set(Array.from(document.querySelectorAll('[data-testid="chat-line"] *')).map((n) => n.tagName)))
    );
    for (const t of tags) expect(["SPAN", "A", "BUTTON", "SVG", "RECT"]).toContain(t);
    const bodyShape = await page.evaluate(() =>
      Array.from(
        new Set(
          Array.from(document.querySelectorAll(".chat-body, .chat-bubble")).flatMap((n) =>
            Array.from(n.childNodes).map((c) => c.nodeName)
          )
        )
      )
    );
    for (const n of bodyShape) expect(["#text", "SPAN", "A"]).toContain(n);
  });

  // render-all (session-71.1): the full archive mounts without any
  // interaction — the newest chunk paints, the older chunk merges in
  test("render-all: the full archive (8,083 lines) mounts with no pagination interaction", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-chat").click();
    await expect(page.getByTestId("chat-line").first()).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(() => page.getByTestId("chat-line").count(), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(8_000);
    // the archive's oldest region renders (the 2024-era blocks, localized)
    await expect(page.getByTestId("chat-scroll")).toContainText("[21,220,");
    // and the top divider names the archive floor honestly
    await expect(page.getByTestId("chat-scroll").locator(".chat-divider").first()).toContainText(/top of the archive/);
  });
});

test.describe("CHAT — venue channels through the unified sidebar", () => {
  test("picking a venue tunes CHAT to that QING's channel; dead RPC stays honest", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-chat").click();

    // the channel-mode sidebar: world row pinned + the venue list
    await expect(page.getByTestId("channel-world")).toBeVisible();
    await page.getByTestId("venue-search").fill("ozymandias");
    await page.getByTestId("venue-list").locator("button").first().click();

    await expect(page.getByTestId("chat-head")).toContainText("Ozymandias", { timeout: 10_000 });
    await expect(page.getByTestId("chat-head")).toContainText("venue channel");
    // exactly one channel is highlighted: the selected venue, not THE VOID
    await expect(page.getByTestId("venue-list").locator(".venue-row.active")).toHaveCount(1);
    await expect(page.getByTestId("channel-world")).not.toHaveClass(/active/);
    // venue channels are tail-only: no seed chip, honest dead-RPC tail
    await expect(page.getByTestId("chat-seed-chip")).toHaveCount(0);
    await expect(page.getByTestId("chat-tail-error")).toContainText("live tail unavailable", { timeout: 10_000 });
    // the post path routes through the venue panel
    await expect(page.getByTestId("chat-foot")).toContainText("venue panel");

    // and back to the world channel (only THE VOID stays highlighted; the
    // venue selection remains app-global for MAP/MARKET, not as a channel)
    await page.getByTestId("channel-world").click();
    await expect(page.getByTestId("chat-head")).toContainText("THE VOID — world channel");
    await expect(page.getByTestId("chat-seed-chip")).toBeVisible();
    await expect(page.getByTestId("channel-world")).toHaveClass(/active/);
    await expect(page.getByTestId("venue-list").locator(".venue-row.active")).toHaveCount(0);
  });
});

test.describe("CHAT — the CHOA.Chat composer (§7.4 opt-in, session-71.1 follow-the-channel)", () => {
  test("stays hidden until the chat-tools opt-in is on; the target follows the VIEWED channel", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-chat").click();
    await expect(page.getByTestId("chat-panel")).toBeVisible({ timeout: 10_000 });

    // OFF by default: the honest disabled hint, NO composer surface
    await expect(page.getByTestId("composer-disabled")).toBeVisible();
    await expect(page.getByTestId("world-composer")).toHaveCount(0);
    await expect(page.getByTestId("composer-input")).toHaveCount(0);

    // flip the §7.4 opt-in (SETTINGS → Agent) and return — world view targets WORLD
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-chat-tools").click();
    await page.getByTestId("rail-chat").click();

    await expect(page.getByTestId("world-composer")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("composer-route")).toContainText("THE VOID — world");
    await expect(page.getByTestId("composer-route")).toContainText("LAU.Chat");
    // one composer line: the input + buttons on the same row
    await expect(page.getByTestId("composer-row")).toBeVisible();
    const rowCount = await page.getByTestId("composer-row").evaluate((el) => el.querySelectorAll("input, textarea, button").length);
    expect(rowCount).toBeGreaterThanOrEqual(3); // message input + DRY + SEND (+ the arm)
    // the 280-char fence counter
    await page.getByTestId("composer-input").fill("x".repeat(40));
    await expect(page.getByTestId("composer-count")).toHaveText("40/280");
    await page.getByTestId("composer-input").fill("x".repeat(281));
    await expect(page.getByTestId("composer-count")).toHaveText("281/280");
    await expect(page.getByTestId("composer-count")).toHaveClass(/err-text/);

    // pick a venue channel → the composer retargets to that QING (CHOA.Chat)
    await page.getByTestId("venue-search").fill("ozymandias");
    await page.getByTestId("venue-list").locator("button").first().click();
    await expect(page.getByTestId("chat-head")).toContainText("Ozymandias", { timeout: 10_000 });
    await expect(page.getByTestId("composer-route")).toContainText("Ozymandias");
    await expect(page.getByTestId("composer-route")).toContainText("CHOA.Chat");

    // and back to the world channel — the target follows the view, never a stale QING
    await page.getByTestId("channel-world").click();
    await expect(page.getByTestId("composer-route")).toContainText("LAU.Chat");
    await expect(page.getByTestId("composer-route")).not.toContainText("CHOA.Chat");
  });

  test("session-71.1: the DSS arm checkbox (world only; disabled + honest without a captured bundler)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    // connect the mock wallet (mode A) — the LAU-gate hint needs an account
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("mode-a").click();
    await page.getByTestId("connect-io.dysnomia.mox").click();
    await expect(page.getByTestId("wallet-account")).toContainText("0xf39Fd6");
    await page.getByTestId("agent-chat-tools").click();
    await page.getByTestId("rail-chat").click();
    await expect(page.getByTestId("world-composer")).toBeVisible({ timeout: 5_000 });

    // world view: the arm renders, DISABLED without a captured DSS, tooltip honest
    const arm = page.getByTestId("composer-arm");
    await expect(arm).toBeVisible();
    await expect(arm).toBeDisabled();
    await expect(page.getByTestId("composer-arm-label")).toHaveAttribute("title", /no DSS captured/i);

    // dead RPC: no snapshot → no LAU → the honest gate
    await expect(page.getByTestId("world-composer")).toContainText("you need a LAU first");
    await expect(page.getByTestId("composer-send")).toBeDisabled();

    // venue view: the arm does not render at all (it is a world-route tool)
    await page.getByTestId("venue-search").fill("ozymandias");
    await page.getByTestId("venue-list").locator("button").first().click();
    await expect(page.getByTestId("chat-head")).toContainText("Ozymandias", { timeout: 10_000 });
    await expect(page.getByTestId("composer-arm")).toHaveCount(0);
  });
});

test.describe("CHAT — the session-71 design overhaul", () => {
  test("the module fills the main container: docked composer, no pagination controls (render-all)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-chat").click();
    await expect(page.getByTestId("chat-line").first()).toBeVisible({ timeout: 10_000 });

    // the composer is docked INSIDE the height-bounded surface (not page-scrolled away)
    const footIn = await page.getByTestId("chat-foot").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.bottom <= window.innerHeight + 1;
    });
    expect(footIn).toBe(true);

    // render-all (71.1): the pagination controls are GONE — everything mounts
    await expect(page.getByTestId("chat-more-lines")).toHaveCount(0);
    await expect(page.getByTestId("chat-older-chunk")).toHaveCount(0);
  });

  test("two display layouts: rich rows (sigils, bubbles, block-fallback time) + the persisted toggle", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-chat").click();
    await expect(page.getByTestId("chat-line").first()).toBeVisible({ timeout: 10_000 });

    // IRC is the default
    await expect(page.getByTestId("chat-layout-irc")).toHaveClass(/on/);
    await expect(page.locator(".chat-line.rich")).toHaveCount(0);

    // RICH: sigil pfps + bubbles render; the dead RPC renders the honest
    // block-number time fallback (timestamps are real reads, never fabricated)
    await page.getByTestId("chat-layout-rich").click();
    const rich = page.locator(".chat-line.rich");
    // the full-corpus relayout is one heavy commit (~2s solo; more under load)
    await expect(rich.first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("chat-sigil").first()).toBeVisible();
    await expect(page.getByTestId("chat-line-bubble").first()).toBeVisible();
    await expect(page.getByTestId("chat-line-time").first()).toContainText("blk");

    // the preference persists across reloads
    await page.reload();
    await page.getByTestId("rail-chat").click();
    await expect(page.locator(".chat-line.rich").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("chat-layout-rich")).toHaveClass(/on/);

    // back to IRC for the rest of the battery
    await page.getByTestId("chat-layout-irc").click();
    await expect(page.locator(".chat-line.rich")).toHaveCount(0);
  });

  test("native search: full-archive matches, jump + highlight, the honesty note", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-chat").click();
    await expect(page.getByTestId("chat-line").first()).toBeVisible({ timeout: 10_000 });

    // a query that exists in the archive: matches counted, the corpus note honest
    await page.getByTestId("chat-search-input").fill("entropy");
    await expect
      .poll(() => page.getByTestId("chat-search-count").innerText(), { timeout: 10_000 })
      .toMatch(/^\d+\/\d+$/);
    await expect(page.getByTestId("chat-search-note")).toContainText(/searched [\d,]+ lines/);

    // Enter jumps: the active highlight renders (the window expanded to it)
    await page.getByTestId("chat-search-input").press("Enter");
    const active = page.locator(".chat-line[data-search-active]");
    await expect(active).toHaveCount(1, { timeout: 10_000 });
    // the active match is scrolled into view
    const inView = await active.first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
    expect(inView).toBe(true);

    // Shift+Enter walks backward — the counter moves, still exactly one active
    await page.getByTestId("chat-search-input").press("Shift+Enter");
    await expect(page.locator(".chat-line[data-search-active]")).toHaveCount(1);

    // clear: highlights gone
    await page.getByTestId("chat-search-clear").click();
    await expect(page.locator(".chat-line[data-search-hit]")).toHaveCount(0);
    await expect(page.getByTestId("chat-search-count")).toHaveText("");
  });

  test("session-80: the scroll-to-newest affordance appears only when scrolled up", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-chat").click();
    await expect(page.getByTestId("chat-line").first()).toBeVisible({ timeout: 10_000 });

    const scroll = page.getByTestId("chat-scroll");
    const jump = page.getByTestId("chat-scroll-bottom");
    await expect(jump).toHaveCount(0);

    // scroll up: the pinned-bottom process stops (nearBottom false) and the
    // affordance appears; the click returns to the newest line and hides it
    await scroll.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(jump).toBeVisible({ timeout: 10_000 });
    await jump.click();
    await expect
      .poll(() => scroll.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight), { timeout: 10_000 })
      .toBeLessThan(8);
    await expect(jump).toHaveCount(0);
  });

  test("search loads the deep archive: a chunk_0000-only term is found and jumped to", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-chat").click();
    await expect(page.getByTestId("chat-line").first()).toBeVisible({ timeout: 10_000 });

    // "Noumenon" lives in the 2024-era chunk the default view never loads —
    // the search's load-all floor reaches it
    await page.getByTestId("chat-search-input").fill("Noumenon");
    await expect
      .poll(() => page.getByTestId("chat-search-count").innerText(), { timeout: 15_000 })
      .toMatch(/^\d+\/\d+$/);
    await page.getByTestId("chat-search-input").press("Enter");
    await expect(page.locator(".chat-line[data-search-active]").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("chat-scroll")).toContainText("<Noumenon>");
  });

  test("the user pane: line facts always; census resolution states + the honest dead-RPC entity read", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-chat").click();
    await expect(page.getByTestId("chat-line-handle").first()).toBeVisible({ timeout: 10_000 });

    // clicking a handle opens the right-side overview with the line's own facts
    await page.getByTestId("chat-line-handle").first().click();
    const pane = page.getByTestId("chat-user-pane");
    await expect(pane).toBeVisible();
    await expect(page.getByTestId("chat-user-soul")).toContainText("SOUL");
    await expect(page.getByTestId("chat-user-facts")).toBeVisible();

    // the census resolution answers exactly one of the three states (the
    // seed glob loads async — wait for the answer, don't race it); on a
    // unique hit the dead RPC surfaces the honest entity-read ERROR
    await expect
      .poll(() => pane.evaluate((el) => el.querySelector('[data-testid="chat-user-entity"], [data-testid="chat-user-ambiguous"], [data-testid="chat-user-unresolved"]') !== null), { timeout: 15_000 })
      .toBe(true);
    const state = await pane
      .evaluate((el) => ({
        unique: el.querySelector('[data-testid="chat-user-entity"]') !== null,
        ambiguous: el.querySelector('[data-testid="chat-user-ambiguous"]') !== null,
        unresolved: el.querySelector('[data-testid="chat-user-unresolved"]') !== null,
      }))
      .then((s) => (s.unique ? "unique" : s.ambiguous ? "ambiguous" : s.unresolved ? "unresolved" : "none"));
    expect(["unique", "ambiguous", "unresolved"]).toContain(state);
    if (state === "unique") {
      await expect(pane.locator(".err-text").first()).toContainText(/entity read unavailable/i);
    }

    // close returns the full-width list
    await page.getByTestId("chat-user-pane-close").click();
    await expect(pane).toHaveCount(0);
  });

  test("the sync-engine catch-up chip rides the head (PAUSED on a sim-class RPC; resume is one click)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-chat").click();
    await expect(page.getByTestId("chat-sync-chip")).toBeVisible({ timeout: 10_000 });

    // the session-70 law: a sim-class RPC starts PAUSED
    await expect(page.getByTestId("chat-sync-chip")).toContainText("PAUSED");
    // resume surfaces the honest dead-RPC error state through the header chip law
    await page.getByTestId("chat-sync-chip").click();
    await expect(page.getByTestId("chat-sync-chip")).toContainText(/SYNC/, { timeout: 10_000 });
  });
});
