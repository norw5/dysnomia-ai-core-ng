import { expect, test } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

/**
 * SIM-layer visibility (session 58, IA-PLAN §8 — the runtime-composite seam):
 * the never-deployed layer's surfaces render ONLY when the active RPC is not
 * a known mainnet endpoint (and the build allows SIM entry — the dev server
 * does). The e2e rides a dead non-mainnet RPC: the sections render with
 * honest unreadable states; on the default mainnet RPC they are absent
 * outright. The dev server is the SIM-enabled build — a production build
 * without VITE_ENABLE_SIM_MODE compiles the same paths unreachable
 * (test/simMode.test.ts pins the resolution law).
 */

const SIM_RPC = "/?rpc=http://127.0.0.1:9999"; // dead port: non-mainnet → SIM indication

async function openVenuePanel(page: import("@playwright/test").Page) {
  await page.getByTestId("rail-map").click();
  await page.getByTestId("venue-search").fill("ozymandias");
  await page.getByTestId("venue-list").locator("button").first().click();
  // session-67: the full panel opens from the click-HUD card's affordance
  await page.getByTestId("venue-hud-open-full").click();
  const panel = page.getByTestId("venue-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  return panel;
}

test.describe("SIM layer — visibility law", () => {
  test("non-mainnet RPC: the WORLD tile block renders on the venue panel (honest unreadable)", async ({
    page,
  }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(SIM_RPC);
    await openVenuePanel(page);

    const world = page.getByTestId("venue-world");
    await expect(world).toBeVisible();
    await expect(world).toContainText("WORLD tiles");
    await expect(world).toContainText("SIM · fixture");
    // the composed-verb honesty copy
    await expect(world).toContainText("OutOfRange");
    await expect(world).toContainText("silent no-op");
    // the fixture reads fail against the dead port → honest, never zeros
    await expect(world).toContainText("unreadable");
    // the claim affordance exists and is honestly disabled without an account
    await expect(page.getByTestId("venue-world-dryrun")).toBeDisabled();
    await expect(page.getByTestId("venue-world-send")).toBeDisabled();
  });

  test("non-mainnet RPC: the IDENTITY sim ledger renders its fixture panel", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(SIM_RPC);
    await page.getByTestId("rail-identity").click();
    const ledger = page.getByTestId("sim-ledger");
    await expect(ledger).toBeVisible();
    await expect(ledger).toContainText("world-layer resources");
    await expect(ledger).toContainText("start your YUE");
    // the exit-unavailability honesty (the hasMint defect)
    await expect(ledger).toContainText("unavailable");
  });

  test("non-mainnet RPC: SETTINGS shows the SIM overlay table beside the live perimeter", async ({
    page,
  }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(SIM_RPC);
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("sim-overlay")).toBeVisible();
    await expect(page.getByTestId("sim-overlay")).toContainText("WORLD");
    await expect(page.getByTestId("sim-overlay")).toContainText("ENCRYPT");
    // the LIVE perimeter stays present and labeled
    await expect(page.getByTestId("perimeter")).toBeVisible();
  });

  test("local loopback without anvil: the bootstrap panel refuses honestly with the exact command", async ({
    page,
  }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(SIM_RPC);
    await page.getByTestId("rail-settings").click();
    const panel = page.getByTestId("sim-bootstrap");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("LOCAL FORK ONLY");
    await expect(panel).toContainText("not your wallet");
    await expect(page.getByTestId("sim-bootstrap-command")).toContainText("--hardfork shanghai");
    await expect(page.getByTestId("sim-bootstrap-command")).toContainText("--fork-block-number 27674000");
    // the auto-check ran against the dead port: refused, deploy disabled
    await expect(page.getByTestId("sim-bootstrap-checks")).toContainText("local loopback fork");
    await expect(page.getByTestId("sim-bootstrap-refusal")).toContainText("did not answer eth_chainId");
    await expect(page.getByTestId("sim-bootstrap-deploy")).toBeDisabled();
    // the amount is the owner's 2,000,000 default (not a hardcoded 10k)
    await expect(page.getByTestId("sim-bootstrap-player-amount")).toHaveValue("2000000");
  });

  test("custom REAL RPC (not loopback): LIVE, with every SIM surface absent", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/?rpc=https://my-own-pulsechain-node.example");
    // the session-81 predicate tightening: a custom real node is LIVE, not SIM
    await expect(page.getByTestId("livesim")).toHaveText("LIVE");
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("sim-overlay")).toHaveCount(0);
    await expect(page.getByTestId("sim-bootstrap")).toHaveCount(0);
    await expect(page.getByTestId("vessel-panel")).toHaveCount(0);
    await expect(page.getByTestId("perimeter")).toBeVisible();
  });

  test("non-mainnet RPC: the GWAT spawn block renders on the venue panel", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(SIM_RPC);
    await openVenuePanel(page);

    const gwat = page.getByTestId("venue-gwat");
    await expect(gwat).toBeVisible();
    await expect(gwat).toContainText("GWAT");
    await expect(gwat).toContainText("SIM · fixture");
    // the fork-verified honesty copy: fresh draws, the duplicate probe, the 777 floor
    await expect(gwat).toContainText("FRESH draw");
    await expect(gwat).toContainText("YourGwatAlreadyExists");
    await expect(gwat).toContainText("777");
    // the affordances exist and are honestly disabled without an account
    await expect(page.getByTestId("venue-gwat-dryrun")).toBeDisabled();
    await expect(page.getByTestId("venue-gwat-send")).toBeDisabled();
  });

  test("non-mainnet RPC: the ENCRYPT cipher desk renders on IDENTITY", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(SIM_RPC);
    await page.getByTestId("rail-identity").click();
    const desk = page.getByTestId("sim-cipher");
    await expect(desk).toBeVisible();
    await expect(desk).toContainText("cipher desk");
    await expect(desk).toContainText("SIM · fixture");
    // the fork-pinned semantics in copy: deterministic index, 10-day expiry, the party gates, the Prune defect
    await expect(desk).toContainText("deterministic");
    await expect(desk).toContainText("10 days");
    await expect(desk).toContainText("To side");
    await expect(desk).toContainText("removes nothing real");
    // the affordances are honestly disabled without a LAU
    await expect(page.getByTestId("sim-cipher-enc-dryrun")).toBeDisabled();
    await expect(page.getByTestId("sim-cipher-prune")).toBeDisabled();
  });

  test("non-mainnet RPC: the fleet vessel panel themes the instance (session-60 substrate)", async ({
    page,
  }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(SIM_RPC);
    await page.getByTestId("rail-settings").click();
    const panel = page.getByTestId("vessel-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("amber + ATROPA-999");

    // default chrome first: amber law, no data-vessel attribute
    await expect(page.getByTestId("vessel-callsign")).toHaveText("ATROPA-999");
    await expect(page.locator("html")).not.toHaveAttribute("data-vessel", /.+/);

    // pick a fleet craft: callsign + accent channel swap
    await page.getByTestId("vessel-opt-vitruv").check();
    await expect(page.getByTestId("vessel-callsign")).toHaveText("VITRUV-3");
    await expect(page.getByTestId("vessel-role")).toHaveText("FLEET_ARCHITECT");
    await expect(page.locator("html")).toHaveAttribute("data-vessel", "vitruv");

    // the accent family actually re-pointed (--amber rides --accent)
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
    expect(accent).toBe("#00f0ff");

    // purple stays AI-core-only under the vessel
    const purple = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--purple").trim());
    expect(purple).toBe("#c084fc");

    // back to default: attribute cleared, amber returns
    await page.getByTestId("vessel-opt-atropa").check();
    await expect(page.getByTestId("vessel-callsign")).toHaveText("ATROPA-999");
    await expect(page.locator("html")).not.toHaveAttribute("data-vessel", /.+/);
  });

  test("mainnet RPC (default): every SIM surface is absent", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/");
    await openVenuePanel(page);
    await expect(page.getByTestId("venue-world")).toHaveCount(0);
    await expect(page.getByTestId("venue-gwat")).toHaveCount(0);

    await page.getByTestId("rail-identity").click();
    await expect(page.getByTestId("sim-ledger")).toHaveCount(0);
    await expect(page.getByTestId("sim-cipher")).toHaveCount(0);

    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("sim-overlay")).toHaveCount(0);
    await expect(page.getByTestId("sim-bootstrap")).toHaveCount(0);
    // the vessel override never lands on live chrome: panel absent, default
    // callsign, no data-vessel attribute (even with a stored choice)
    await page.evaluate(() => window.localStorage.setItem("dys.vessel.v1", "kestrel"));
    await page.reload();
    await expect(page.getByTestId("vessel-callsign")).toHaveText("ATROPA-999");
    await expect(page.locator("html")).not.toHaveAttribute("data-vessel", /.+/);
    // reload lands back on the DECK — SETTINGS still renders the live
    // perimeter and NO vessel panel despite the stored choice
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("vessel-panel")).toHaveCount(0);
    await expect(page.getByTestId("perimeter")).toBeVisible();
  });
});
