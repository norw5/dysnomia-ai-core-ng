import { expect, test } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

test.use({ javaScriptEnabled: true });

const ANVIL0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ANVIL0_PRIV = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

test.describe("wallet modes A/B/C", () => {
  test("mode A: EIP-6963 discovery → connect → account in topbar; accountsChanged clears", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/");
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("wallet-panel")).toBeVisible();
    await page.getByTestId("mode-a").click();
    await expect(page.getByTestId("provider-list")).toBeVisible();
    await page.getByTestId("connect-io.dysnomia.mox").click();
    await expect(page.getByTestId("wallet-account")).toContainText(ANVIL0.slice(0, 8));
    await expect(page.getByTestId("wallet-mode")).toHaveText("MODE A");
    // accountsChanged([]) disconnects
    await page.evaluate(() => window.__dysMock!.emitAccountsChanged([]));
    // the header falls back to the [ CONNECT ] affordance (old-app behavior)
    await expect(page.getByTestId("mhead-connect")).toBeVisible();
  });

  test("mode A: chainChanged updates the topbar chain id", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/");
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("mode-a").click();
    await page.getByTestId("connect-io.dysnomia.mox").click();
    await expect(page.getByTestId("wallet-account")).toContainText(ANVIL0.slice(0, 8));
    await page.evaluate(() => window.__dysMock!.emitChainChanged("0x89")); // 137
    await expect(page.getByTestId("wallet-chain")).toContainText("wallet on 137");
  });

  test("mode B: import key in memory → account, lock clears it", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/");
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("mode-b").click();
    await page.getByTestId("import-priv").fill(ANVIL0_PRIV);
    await page.getByTestId("import-pass").fill(""); // memory only
    await page.getByTestId("import-btn").click();
    await expect(page.getByTestId("wallet-account")).toContainText(ANVIL0.slice(0, 8));
    await expect(page.getByTestId("wallet-mode")).toHaveText("MODE B");
    await page.getByTestId("lock-key").click();
    await expect(page.getByTestId("mhead-connect")).toBeVisible();
  });

  test("mode B: passphrase vault round-trip unlock, wrong passphrase refused", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/");
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("mode-b").click();
    await page.getByTestId("import-priv").fill(ANVIL0_PRIV);
    await page.getByTestId("import-pass").fill("correct horse battery");
    await page.getByTestId("import-btn").click();
    await expect(page.getByTestId("wallet-account")).toContainText(ANVIL0.slice(0, 8));
    await page.getByTestId("lock-key").click();
    // wrong passphrase
    await page.getByTestId("unlock-pass").fill("wrong pass");
    await page.getByTestId("unlock-btn").click();
    await expect(page.getByTestId("wallet-error-line")).toContainText(/wrong passphrase/i);
    // correct one
    await page.getByTestId("unlock-pass").fill("correct horse battery");
    await page.getByTestId("unlock-btn").click();
    await expect(page.getByTestId("wallet-account")).toContainText(ANVIL0.slice(0, 8));
  });

  test("mode C: yolo requires typing DANGERS, shows the distinct visual state, exits", async ({ page }) => {
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/");
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("mode-b").click();
    await page.getByTestId("import-priv").fill(ANVIL0_PRIV);
    await page.getByTestId("import-btn").click();
    await expect(page.getByTestId("wallet-account")).toContainText(ANVIL0.slice(0, 8));
    // typing the wrong word does nothing
    await page.getByTestId("yolo-input").fill("DANGER");
    await expect(page.getByTestId("yolo-enter")).toBeDisabled();
    await page.getByTestId("yolo-input").fill("DANGERS");
    await page.getByTestId("yolo-enter").click();
    await expect(page.getByTestId("yolo-chip")).toBeVisible();
    await expect(page.getByTestId("wallet-mode")).toHaveText("YOLO");
    await expect(() => {
      const cls = page.evaluate(() => document.body.className);
      return cls;
    }).toPass();
    const bodyClass = await page.evaluate(() => document.body.className);
    expect(bodyClass).toContain("yolo");
    await page.getByTestId("yolo-exit").click();
    await expect(page.getByTestId("wallet-mode")).toHaveText("MODE B");
  });
});
