import { expect, test } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

const DEAD_RPC = "/?rpc=http://127.0.0.1:9999"; // dead port: fast RPC errors, SIM indication

async function connectA(page: import("@playwright/test").Page) {
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("mode-a").click();
  await page.getByTestId("connect-io.dysnomia.mox").click();
  await expect(page.getByTestId("wallet-account")).toContainText("0xf39Fd6");
}

test.describe("MAP — atlas canvas (offline seed render)", () => {
  test("canvas paints the 917-node atlas with HUD + controls", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/");
    await page.getByTestId("rail-map").click();

    const canvas = page.getByTestId("atlas-canvas");
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("atlas-hud")).toContainText("940");

    // the CANONICAL framing is the default (kb §9, the session-48 map fix):
    // fold-fraction ±180° × |lat|/pole — uniform fill, not the legacy
    // band-as-longitude diagonal
    await expect(page.getByTestId("atlas-canon")).toHaveClass(/active/);

    // session-60 defaults: gravity 0.35 + orbit lock ON (stored prefs win —
    // only the DEFAULT changed; the stored-pref case is asserted below)
    await expect(page.getByTestId("atlas-orbit")).toContainText("ORBIT ON");
    const gravityDefault = await page.getByTestId("atlas-gravity").inputValue();
    expect(gravityDefault).toBe("35");

    // the render loop actually painted: non-background pixels exist
    await expect
      .poll(
        async () => {
          return page.evaluate(() => {
            const c = document.querySelector<HTMLCanvasElement>('[data-testid="atlas-canvas"]');
            if (!c || c.width === 0) return 0;
            const ctx = c.getContext("2d")!;
            const data = ctx.getImageData(0, 0, c.width, c.height).data;
            let lit = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (data[i]! > 20 || data[i + 1]! > 20 || data[i + 2]! > 20) lit++;
            }
            return lit;
          });
        },
        { timeout: 10_000 }
      )
      .toBeGreaterThan(500);

    // projection + coordinate toggles re-render without breaking the loop
    await page.getByTestId("atlas-2d").click();
    await page.getByTestId("atlas-linear").click();
    await page.getByTestId("atlas-hecke").click();
    await page.getByTestId("atlas-canon").click();
    await page.getByTestId("atlas-3d").click();
    await expect(page.getByTestId("atlas-gravity")).toBeVisible();
    await expect(page.getByTestId("atlas-reset")).toBeVisible();
    await expect(page.getByTestId("atlas-orbit")).toBeVisible();
  });

  test("stored map prefs win over the session-60 defaults (dys.gravity.v1)", async ({ page }) => {
    await page.addInitScript((g: string) => {
      window.localStorage.setItem("dys.gravity.v1", g);
    }, "0.5");
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/");
    await page.getByTestId("rail-map").click();
    await expect(page.getByTestId("atlas-canvas")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("atlas-hud")).toContainText("50%");
  });

  test("session-78 HUD: the gesture legend is a bottom overlay; the gravity control is one row", async ({
    page,
  }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.setViewportSize({ width: 1920, height: 1200 });
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-map").click();
    await expect(page.getByTestId("atlas-canvas")).toBeVisible({ timeout: 10_000 });

    // the legend is OUT of the top HUD and parked at the atlas container bottom
    await expect(page.getByTestId("atlas-hud")).not.toContainText("DRAG");
    const help = page.getByTestId("atlas-help");
    await expect(help).toBeVisible();
    const wrap = await page.getByTestId("map-canvas").boundingBox();
    const helpBox = await help.boundingBox();
    expect(wrap).not.toBeNull();
    expect(helpBox).not.toBeNull();
    expect(helpBox!.y).toBeGreaterThan(wrap!.y + wrap!.height * 0.75);
    expect(helpBox!.y + helpBox!.height).toBeLessThanOrEqual(wrap!.y + wrap!.height + 1);

    // the gravity box matches the other controls' height and keeps its
    // title + percentage on the SAME row as the range
    const gravityBox = await page.getByTestId("atlas-gravity-box").boundingBox();
    const resetBox = await page.getByTestId("atlas-reset").boundingBox();
    const slider = await page.getByTestId("atlas-gravity").boundingBox();
    expect(gravityBox).not.toBeNull();
    expect(resetBox).not.toBeNull();
    expect(slider).not.toBeNull();
    expect(Math.abs(gravityBox!.height - resetBox!.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(gravityBox!.y - resetBox!.y)).toBeLessThanOrEqual(2);
    expect(slider!.x).toBeGreaterThan(gravityBox!.x + 30);
    await expect(page.getByTestId("atlas-hud")).toContainText("35%");

    // session-79: the empty-venue HUD card never covers the legend — the
    // 1600 two-line shape was the reported collision (the caption below the
    // wrap eats 3.6rem of naive clearance)
    for (const width of [1920, 1600]) {
      await page.setViewportSize({ width, height: width === 1920 ? 1200 : 1000 });
      await page.waitForTimeout(500);
      const helpBox2 = await page.getByTestId("atlas-help").boundingBox();
      const hudBox = await page.getByTestId("map-empty-space").boundingBox();
      expect(helpBox2).not.toBeNull();
      expect(hudBox).not.toBeNull();
      const overlap =
        helpBox2!.x < hudBox!.x + hudBox!.width &&
        helpBox2!.x + helpBox2!.width > hudBox!.x &&
        helpBox2!.y < hudBox!.y + hudBox!.height &&
        helpBox2!.y + helpBox2!.height > hudBox!.y;
      expect(overlap, `legend/HUD overlap at ${width}`).toBe(false);
    }

    // compact keeps the same inline gravity row; the deck bay renders no
    // legend clutter (its compact HUD is untouched)
    await page.setViewportSize({ width: 430, height: 900 });
    await page.reload();
    await page.waitForTimeout(800);
    await expect(page.getByTestId("atlas-help")).toHaveCount(0);
    await page.getByTestId("rail-map").click();
    await expect(page.getByTestId("atlas-canvas")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("atlas-help")).toBeVisible();
    const compactGravity = await page.getByTestId("atlas-gravity-box").boundingBox();
    const compactSlider = await page.getByTestId("atlas-gravity").boundingBox();
    expect(compactGravity).not.toBeNull();
    expect(compactSlider).not.toBeNull();
    expect(compactSlider!.x).toBeGreaterThan(compactGravity!.x + 20);
  });
});

test.describe("MAP — venue panel on selection (dead RPC → honest states)", () => {
  async function openFullPanel(page: import("@playwright/test").Page) {
    // session-67: selection surfaces the click-HUD card; the FULL panel
    // opens from its affordance as the right-side overlay drawer
    await page.getByTestId("venue-hud-open-full").click();
    await expect(page.getByTestId("map-drawer")).toBeVisible();
  }

  test("the click-HUD card (session-67): selection surfaces the compact card; the drawer opens from its affordance", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-map").click();

    await page.getByTestId("venue-search").fill("ozymandias");
    await page.getByTestId("venue-list").locator("button").first().click();

    const card = page.getByTestId("venue-hud-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("Ozymandias QING");
    await expect(card).toContainText("VENUE (QING)");
    await expect(page.getByTestId("venue-hud-coords")).toContainText("band ");
    await expect(page.getByTestId("venue-hud-coords")).toContainText("|lat|/pole");
    await expect(card).toContainText("SEED · s32");
    // the current-venue surface still names the selection app-globally
    await expect(page.getByTestId("current-venue")).toContainText("Ozymandias");

    // the drawer: opened by the affordance, closable, holds the full panel
    await openFullPanel(page);
    await expect(page.getByTestId("venue-panel")).toBeVisible();
    await page.getByTestId("map-drawer-close").click();
    await expect(page.getByTestId("map-drawer")).toHaveCount(0);
    // the card survives the drawer close (it is the selection surface)
    await expect(card).toBeVisible();

    // closing the card keeps the selection; the empty-space card is gone;
    // a restore chip re-opens the card (the surface always names the venue)
    await page.getByTestId("venue-hud-close").click();
    await expect(page.getByTestId("venue-hud-card")).toHaveCount(0);
    await expect(page.getByTestId("map-empty-space")).toHaveCount(0);
    await expect(page.getByTestId("current-venue")).toContainText("Ozymandias");
    await page.getByTestId("venue-hud-restore").click();
    await expect(page.getByTestId("venue-hud-card")).toBeVisible();
  });

  test("the restructured page fits: edge-to-edge atlas, no page overflow at desktop", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-map").click();
    await expect(page.getByTestId("map-canvas")).toBeVisible({ timeout: 10_000 });
    const fits = await page.getByTestId("view-map").evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
    expect(fits).toBe(true);
    // the stage owns the remaining height and the atlas fills it (no 56vh clamp)
    const stageH = await page.getByTestId("map-stage").evaluate((el) => el.clientHeight);
    expect(stageH).toBeGreaterThan(320);
  });

  test("a non-seed venue: the card computes live coordinates — dead RPC renders COORDS UNAVAILABLE, never a phantom", async ({ page }) => {
    await page.addInitScript((v: string) => {
      window.localStorage.setItem("dys.venue.v1", v);
    }, JSON.stringify({ a: "0x0000000000000000000000000000000000000099", n: "Off-Seed", s: "OFF", lat: 0, band: 0, blk: 0 }));
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-map").click();

    const card = page.getByTestId("venue-hud-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("Off-Seed");
    await expect(page.getByTestId("venue-hud-coords")).toContainText("unavailable", { timeout: 10_000 });
    await expect(card).toContainText("COORDS UNAVAILABLE");
  });

  test("seed facts render; live reads report unavailable, never empty", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-map").click();

    await page.getByTestId("venue-search").fill("ozymandias");
    await page.getByTestId("venue-list").locator("button").first().click();
    await openFullPanel(page);

    const panel = page.getByTestId("venue-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel).toContainText("Ozymandias QING");
    // seed facts (s32-exact) always render
    await expect(panel).toContainText("meridian band");
    await expect(panel).toContainText("south-flip");
    await expect(panel).toContainText("block 22817747");
    // both framings render honestly: canonical (kb §9) + legacy degrees
    await expect(panel).toContainText("position (canonical");
    await expect(panel).toContainText("|lat|/pole");
    await expect(panel).toContainText("legacy framing");
    // dead RPC is an ERROR, not an empty venue (the fail-fast rule)
    await expect(page.getByTestId("venue-live")).toContainText("live reads unavailable", { timeout: 10_000 });
    // market waits for a live read before claiming no-rate
    await expect(page.getByTestId("venue-market")).toContainText("pending or unavailable");
    // actions exist but are honestly disabled without an account
    await expect(page.getByTestId("venue-join-send")).toBeDisabled();
    await expect(page.getByTestId("venue-chat-send")).toBeDisabled();
    await expect(page.getByTestId("venue-eta")).toContainText("connect an account to read your Eta readiness");
  });

  test("with an account + dead RPC: no LAU gates the actions; Eta reports the failed simulation", async ({
    page,
  }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await connectA(page);
    await page.getByTestId("rail-map").click();

    await page.getByTestId("venue-search").fill("ozymandias");
    await page.getByTestId("venue-list").locator("button").first().click();
    await openFullPanel(page);

    const panel = page.getByTestId("venue-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel).toContainText("you need a LAU first");
    await expect(page.getByTestId("venue-join-send")).toBeDisabled();
    await expect(page.getByTestId("venue-beat-dryrun")).toBeEnabled();
    await expect(page.getByTestId("venue-eta")).toContainText("Eta simulation failed", { timeout: 10_000 });
  });

  test("venue depth (session-50): history + settle honest without a YUE; the management drawer renders its gate states", async ({
    page,
  }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await connectA(page);
    await page.getByTestId("rail-map").click();

    await page.getByTestId("venue-search").fill("ozymandias");
    await page.getByTestId("venue-list").locator("button").first().click();
    await openFullPanel(page);

    const panel = page.getByTestId("venue-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // the settle verb is present, DRYRUN-first, and honestly gated on the YUE
    await expect(page.getByTestId("venue-settle")).toContainText("CHEON.Su(venue)");
    await expect(page.getByTestId("venue-settle")).toContainText("most-called function");
    await expect(page.getByTestId("venue-settle-dryrun")).toBeDisabled();
    await expect(page.getByTestId("venue-settle-send")).toBeDisabled();
    await expect(page.getByTestId("venue-settle")).toContainText("settle needs your YUE first");

    // your history here: the YUE.Bar story renders without inventing numbers
    await expect(page.getByTestId("venue-history")).toContainText("attendance record");

    // the management drawer: opens, renders the live-gate frame honestly
    // (dead RPC → "cannot be evaluated", never a false "no")
    await page.getByTestId("venue-manage").locator("summary").click();
    await expect(page.getByTestId("venue-manage")).toContainText("auto-staffed from block one");
    await expect(page.getByTestId("venue-manage-gates")).toContainText("GWAT escrow lock");
    await expect(page.getByTestId("manage-withdraw-locked")).toContainText("cannot be evaluated");
    await expect(page.getByTestId("manage-cover-locked")).toContainText("cannot be evaluated");
    await expect(page.getByTestId("manage-rate-locked")).toContainText("cannot be evaluated");
  });

  test("the deed (session-51): DO.Take renders the asset-centric gate honestly", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await connectA(page);
    await page.getByTestId("rail-map").click();

    await page.getByTestId("venue-search").fill("ozymandias");
    await page.getByTestId("venue-list").locator("button").first().click();
    await openFullPanel(page);

    const deed = page.getByTestId("venue-deed");
    await expect(deed).toBeVisible({ timeout: 10_000 });
    await expect(deed).toContainText("DO.Take(venue)");
    await expect(deed).toContainText("once-per-venue-EVER");
    // the asset-centric gate + the silent no-op honesty (fork-verified semantics)
    await expect(deed).toContainText("WRAPPED ASSET, not the venue");
    await expect(deed).toContainText("SILENT NO-OP");
    await expect(deed).toContainText("a green DRYRUN alone cannot prove eligibility");
    // unknown-contract honesty (no recovered source for DO)
    await expect(deed).toContainText("unknown-contract");
    // the stake line renders its unreadable state on a dead RPC, never a verdict
    await expect(page.getByTestId("venue-deed-gate")).toContainText("live read pending");
  });

  test("the deed without an account stays inert", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-map").click();

    await page.getByTestId("venue-search").fill("ozymandias");
    await page.getByTestId("venue-list").locator("button").first().click();
    await openFullPanel(page);

    const deed = page.getByTestId("venue-deed");
    await expect(deed).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("venue-deed-dryrun")).toBeDisabled();
    await expect(page.getByTestId("venue-deed-send")).toBeDisabled();
  });

  test("venue creation (session-51): the empty-space affordance carries the honest preview story", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await connectA(page);
    await page.getByTestId("rail-map").click();

    // no venue selected → the create affordance in the empty space
    await expect(page.getByTestId("map-empty-space")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("map-create-toggle").locator("summary").click();
    const card = page.getByTestId("create-venue");
    await expect(card).toBeVisible();
    await expect(card).toContainText("MAP.New(asset)");
    await expect(card).toContainText("one venue per asset, EVER");
    // the honest pre-checks: Forbidden + the DRYRUN (which DECODES
    // QingAlreadyExists + names the existing venue — session-73)
    await expect(card).toContainText("the DRYRUN below DECODES it");
    await expect(card).toContainText("never spray-create");
    // the world assigns the coordinates + creator-staff-not-owner teaching
    await expect(card).toContainText("the world assigns the coordinates");
    await expect(card).toContainText("auto-STAFFED");
    await expect(card).toContainText("NOT an owner");
    // an invalid asset keeps every send path inert
    await expect(page.getByTestId("create-venue-precheck")).toBeDisabled();
    await expect(page.getByTestId("create-venue-dryrun")).toBeDisabled();
    await expect(page.getByTestId("create-venue-send")).toBeDisabled();
  });

  test("venue creation (session-51): the DIRECTORY QING tab carries the same affordance; the pre-check reads honestly on a dead RPC", async ({
    page,
  }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await connectA(page);
    await page.getByTestId("rail-directory").click();

    await page.getByTestId("dir-tab-qing").click();
    await page.getByTestId("dir-create-toggle").locator("summary").click();
    const card = page.getByTestId("create-venue");
    await expect(card).toBeVisible();

    // a well-formed asset unlocks the pre-check; a dead RPC renders UNKNOWN, never "not forbidden"
    await page.getByTestId("create-venue-asset").fill("0x81a6923ca480fada78cb15254c8d8cc382d2fbc0");
    await page.getByTestId("create-venue-precheck").click();
    await expect(page.getByTestId("create-venue-precheck-result")).toContainText("unreadable", { timeout: 10_000 });
  });
});
