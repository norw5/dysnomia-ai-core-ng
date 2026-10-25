import { expect, test } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

const LAU_FACTORY = "0xba6ccd38992839aee20d5bf9125b1d94190b091c";
const DEAD_RPC = "/?rpc=http://127.0.0.1:9999"; // dead port: fast RPC errors, SIM indication

async function connectA(page: import("@playwright/test").Page) {
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("mode-a").click();
  await page.getByTestId("connect-io.dysnomia.mox").click();
  await expect(page.getByTestId("wallet-account")).toContainText("0xf39Fd6");
  await page.getByTestId("rail-identity").click();
}

test.describe("IDENTITY — first contextual panels (mock wallet, dead RPC → honest states)", () => {
  test("guided chain renders; wallet step done once connected; snapshot error is honest", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await connectA(page);

    await expect(page.getByTestId("view-identity")).toBeVisible();
    await expect(page.getByTestId("step-wallet")).toHaveClass(/done/);
    await expect(page.getByTestId("step-lau")).toHaveClass(/todo/);
    await expect(page.getByTestId("step-username")).toHaveClass(/todo/);
    await expect(page.getByTestId("step-yue")).toHaveClass(/todo/);
    await expect(page.getByTestId("snapshot-error")).toBeVisible({ timeout: 10_000 });
  });

  test("LAU create goes through the gate: card → override ack → captured New(string,string)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await connectA(page);

    await page.getByTestId("lau-name").fill("E2E Player");
    await page.getByTestId("lau-symbol").fill("E2E");
    await page.getByTestId("lau-create").click();

    const card = page.getByTestId("approval-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("LAUFactory");
    // dead RPC ⇒ DRYRUN reverted ⇒ confirm gated behind the override ack
    await expect(page.getByTestId("approval-confirm")).toBeDisabled();
    await page.getByTestId("override-sim-failure").check();
    await page.getByTestId("approval-confirm").click();

    await expect(page.getByTestId("lau-outcome")).toContainText("sent", { timeout: 20_000 });
    const sent = await page.evaluate(() => window.__dysMock!.sentTransactions);
    expect(sent).toHaveLength(1);
    const tx = sent[0] as { to: string; data: string };
    expect(tx.to?.toLowerCase()).toEqual(LAU_FACTORY);
    expect(tx.data?.slice(0, 10).toLowerCase()).toEqual("0x8c6dc5ec"); // New(string,string)
    // the whole pipeline lands in the event feed
    await page.getByTestId("toggle-logs").click();
    await expect(page.getByTestId("event-feed").locator("text=gate.send")).toBeVisible();
  });

  test("rejecting the card aborts the LAU create — nothing reaches the wallet", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await connectA(page);

    await page.getByTestId("lau-name").fill("Nope");
    await page.getByTestId("lau-symbol").fill("NOPE");
    await page.getByTestId("lau-create").click();
    await page.getByTestId("approval-reject").click();
    await expect(page.getByTestId("approval-card")).toHaveCount(0);
    const sent = await page.evaluate(() => window.__dysMock!.sentTransactions);
    expect(sent).toHaveLength(0);
  });

  test("session-66: the DSS desk — seeded pending LAU raises the deploy; card names CONTRACT DEPLOYMENT; the creation tx has no `to`", async ({ page }) => {
    const LAU = "0x7777777777777777777777777777777777777777";
    await page.addInitScript(MOCK_PROVIDER_INIT);
    // seed the pending-LAU carriage (the store loads at init — the capture-
    // at-create law's other half): the desk binds this LAU for the deploy
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "dys.lau.pending.v1",
        JSON.stringify({
          "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266": {
            lau: "0x7777777777777777777777777777777777777777",
            txHash: null,
            t: Date.now(),
          },
        })
      );
    });
    await page.goto(DEAD_RPC);
    await connectA(page);

    // the desk raised on the pending LAU: the emission block + the deploy
    await expect(page.getByTestId("dss-desk")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("dss-emission")).toBeVisible();
    await expect(page.getByTestId("dss-bundler")).toBeVisible();

    await page.getByTestId("dss-deploy").click();
    const card = page.getByTestId("approval-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    // the deploy envelope: no destination, the creation copy, risk deploy
    await expect(card).toContainText("NEW CONTRACT");
    await expect(card).toContainText("creation tx");
    await expect(card.locator(".risk")).toHaveText("deploy");
    // dead RPC ⇒ DRYRUN reverted ⇒ override ack then confirm
    await expect(page.getByTestId("approval-confirm")).toBeDisabled();
    await page.getByTestId("override-sim-failure").check();
    await page.getByTestId("approval-confirm").click();

    await expect(page.getByTestId("dss-deploy-outcome")).toContainText("sent", { timeout: 20_000 });
    const sent = await page.evaluate(() => window.__dysMock!.sentTransactions);
    expect(sent).toHaveLength(1);
    const tx = sent[0] as { to?: string | null; data?: string };
    // the wire shape of a CREATION: no destination + the fixed bytecode
    expect(tx.to ?? null).toBeNull();
    expect(tx.data?.slice(0, 6).toLowerCase()).toEqual("0x6080");
    // the ctor arg rides: the padded seeded LAU is the tail
    expect(tx.data?.slice(-64).toLowerCase()).toEqual(LAU.slice(2).toLowerCase().padStart(64, "0"));
  });

  test("YUE panel waits for a LAU (guided order enforced in UI)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await connectA(page);
    // dead RPC → snapshot unknown → no LAU → the vault panel holds
    await expect(page.getByTestId("yue-panel")).toContainText("create your LAU first", { timeout: 10_000 });
    await expect(page.getByTestId("yue-start")).toHaveCount(0);
  });

  test("the recorded-moment panel (session-50): honest dead-RPC / no-account states", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);

    // anonymous: the per-soul hint, nothing invented
    await page.getByTestId("rail-identity").click();
    await expect(page.getByTestId("player-moment")).toContainText("connect an account — the moment is per-soul");

    // connected + dead RPC: the simulated GetUserSoul fails as an ERROR, never as zero
    await connectA(page);
    await expect(page.getByTestId("player-moment")).toContainText("moment read failed", { timeout: 10_000 });
    await expect(page.getByTestId("player-moment")).toContainText("RING.Moments(soul)");
  });
});

test.describe("unified QING sidebar + app-global venue selection (offline seed)", () => {
  test("917-venue seed renders, search filters, selection + clear work", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/");
    await page.getByTestId("rail-map").click();

    await expect(page.getByTestId("venue-sidebar")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("venue-list").locator("li")).not.toHaveCount(0, { timeout: 10_000 });
    // the sidebar lives in the AppShell slot next to the rail
    await expect(page.getByTestId("main-grid")).toContainText("VENUES");

    await page.getByTestId("venue-search").fill("ozymandias");
    await expect(page.getByTestId("venue-list").locator("li")).toHaveCount(1, { timeout: 5_000 });
    await page.getByTestId("venue-list").locator("button").first().click();
    await expect(page.getByTestId("current-venue")).toContainText("Ozymandias QING");
    await expect(page.getByTestId("current-venue")).toContainText("0xe41165bf");

    // session-67: the full panel opens from the click-HUD card's affordance
    await page.getByTestId("venue-hud-open-full").click();
    await expect(page.getByTestId("venue-panel")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("map-clear-venue").click();
    await expect(page.getByTestId("current-venue")).toContainText("none selected");
  });

  test("selection is app-global and persists across view switches", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/");
    await page.getByTestId("rail-map").click();
    await page.getByTestId("venue-search").fill("Heavenly Dragon");
    await page.getByTestId("venue-list").locator("button").first().click();
    await expect(page.getByTestId("current-venue")).toContainText("Heavenly Dragon QING");

    await page.getByTestId("rail-studio").click();
    await page.getByTestId("rail-map").click();
    await expect(page.getByTestId("current-venue")).toContainText("Heavenly Dragon QING");
  });
});

test.describe("IDENTITY — the birth-record panel (session-53, B1.7)", () => {
  test("honest no-account / dead-RPC states; nothing invented", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);

    await page.getByTestId("rail-identity").click();
    await expect(page.getByTestId("player-birth")).toContainText("connect an account — the record is per-identity");

    // connected + dead RPC: the snapshot itself errors — never a fabricated record
    await connectA(page);
    await expect(page.getByTestId("player-birth")).toContainText("identity reads unavailable", { timeout: 10_000 });
    await expect(page.getByTestId("player-birth")).toContainText("SIU.Miu");
  });
});
