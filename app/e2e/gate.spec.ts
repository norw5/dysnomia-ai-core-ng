import { expect, test } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

const CHOA = "0x0f5a352fd4ca4850c2099c15b3600ff085b66197";
const LAU = "0x0000000000000000000000000000000000000001";
const DEAD_RPC = "/?rpc=http://127.0.0.1:9999"; // dead port: fast RPC errors, SIM indication

async function connectA(page: import("@playwright/test").Page) {
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("mode-a").click();
  await page.getByTestId("connect-io.dysnomia.mox").click();
  await expect(page.getByTestId("wallet-account")).toContainText("0xf39Fd6");
}

test.describe("STUDIO + the ONE tx gate (mock wallet, dead RPC → sim fails honestly)", () => {
  test("CHOA.Chat: DRYRUN runs through the gate and lands in the event feed", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await expect(page.getByTestId("livesim")).toHaveText("SIM", { timeout: 10_000 });
    await page.getByTestId("rail-studio").click();
    await expect(page.getByTestId("view-studio")).toBeVisible();

    await page.getByTestId("studio-contract-CHOA").click();
    await page.getByTestId("studio-fn-Chat").click();
    await page.getByTestId("studio-arg-0").fill(LAU);
    await page.getByTestId("studio-arg-1").fill("gate e2e");
    await page.getByTestId("studio-dryrun").click();

    await expect(page.getByTestId("studio-sim")).toContainText("reverted", { timeout: 10_000 });
    await expect(page.getByTestId("studio-policy")).toContainText("policy: PASS");
    // STUDIO leaves its ready-approval card open after a DRYRUN — dismiss it
    await page.getByTestId("approval-reject").click();
    await page.getByTestId("toggle-logs").click();
    await expect(page.getByTestId("event-feed").locator("text=gate.sim")).toBeVisible();
  });

  test("send: approval card → override ack → eth_sendTransaction captured with the deployed selector", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await connectA(page);
    await page.getByTestId("rail-studio").click();

    await page.getByTestId("studio-contract-CHOA").click();
    await page.getByTestId("studio-fn-Chat").click();
    await page.getByTestId("studio-arg-0").fill(LAU);
    await page.getByTestId("studio-arg-1").fill("through the gate");
    await page.getByTestId("studio-send").click();

    const card = page.getByTestId("approval-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("standard");
    // dead RPC ⇒ DRYRUN REVERTED ⇒ confirm gated behind the override ack
    await expect(page.getByTestId("approval-confirm")).toBeDisabled();
    await page.getByTestId("override-sim-failure").check();
    await page.getByTestId("approval-confirm").click();

    await expect(page.getByTestId("studio-outcome")).toContainText("sent", { timeout: 20_000 });
    const sent = await page.evaluate(() => window.__dysMock!.sentTransactions);
    expect(sent).toHaveLength(1);
    const tx = sent[0] as { to: string; data: string; from: string };
    expect(tx.to?.toLowerCase()).toEqual(CHOA);
    expect(tx.data?.slice(0, 10).toLowerCase()).toEqual("0xb340a780");
    expect(tx.from?.toLowerCase()).toEqual("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
    // the feed records the whole pipeline
    await page.getByTestId("toggle-logs").click();
    await expect(page.getByTestId("event-feed").locator("text=gate.send")).toBeVisible();
  });

  test("rejection in the card aborts — nothing reaches eth_sendTransaction", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await connectA(page);
    await page.getByTestId("rail-studio").click();

    await page.getByTestId("studio-contract-CHOA").click();
    await page.getByTestId("studio-fn-Chat").click();
    await page.getByTestId("studio-arg-0").fill(LAU);
    await page.getByTestId("studio-arg-1").fill("nope");
    await page.getByTestId("studio-send").click();
    await page.getByTestId("approval-reject").click();
    await expect(page.getByTestId("approval-card")).toHaveCount(0);
    const sent = await page.evaluate(() => window.__dysMock!.sentTransactions);
    expect(sent).toHaveLength(0);
  });

  // session-63 note: the INLINE AI_CORE approval card (the old site's
  // [ ACTION REQUIRED ] idiom, same pendingApproval resolver as the modal)
  // is NOT e2e-able on the dead-RPC harness — agent tools hard-refuse
  // sim-failed sends BEFORE gateSend (toolShared's conservative law), and
  // STUDIO/venue panels carry their own local envelopes. A DRYRUN-succeeds
  // approval needs a live fork (harness territory, not mock-provider e2e).

  test("policy denial blocks before any wallet prompt (session cap 0)", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await connectA(page);
    // set the session cap to 0
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("pol-txs").fill("0");
    await page.getByTestId("policy-save").click();
    await page.getByTestId("rail-studio").click();

    await page.getByTestId("studio-contract-CHOA").click();
    await page.getByTestId("studio-fn-Chat").click();
    await page.getByTestId("studio-arg-0").fill(LAU);
    await page.getByTestId("studio-arg-1").fill("denied");
    await page.getByTestId("studio-send").click();

    await expect(page.getByTestId("studio-policy")).toContainText("DENIED", { timeout: 10_000 });
    await expect(page.getByTestId("approval-card")).toHaveCount(0);
    const sent = await page.evaluate(() => window.__dysMock!.sentTransactions);
    expect(sent).toHaveLength(0);
  });

  test("yolo (C) sends without the card but still respects the sim-failure block", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto(DEAD_RPC);
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("mode-b").click();
    await page.getByTestId("import-priv").fill("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    await page.getByTestId("import-btn").click();
    await page.getByTestId("yolo-input").fill("DANGERS");
    await page.getByTestId("yolo-enter").click();
    await expect(page.getByTestId("wallet-mode")).toHaveText("YOLO");

    await page.getByTestId("rail-studio").click();
    await page.getByTestId("studio-contract-CHOA").click();
    await page.getByTestId("studio-fn-Chat").click();
    await page.getByTestId("studio-arg-0").fill(LAU);
    await page.getByTestId("studio-arg-1").fill("yolo");
    await page.getByTestId("studio-send").click();

    // no approval card ever appears; the failed DRYRUN still blocks (policy bound)
    await expect(page.getByTestId("approval-card")).toHaveCount(0);
    await expect(page.getByTestId("studio-outcome")).toContainText("blocked", { timeout: 10_000 });
    const sent = await page.evaluate(() => window.__dysMock!.sentTransactions);
    expect(sent).toHaveLength(0);
  });
});
