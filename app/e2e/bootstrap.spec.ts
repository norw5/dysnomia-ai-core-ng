import { expect, test, type APIRequestContext } from "@playwright/test";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

/**
 * SESSION-81 — the SIM in-frontend bootstrap against OUR OWN pinned fork.
 *
 * Requires anvil on 8545 (pin 27,674,000, chain 369) with the live perimeter
 * present. Run SOLO (--workers 1) against a held fork from
 * `python3 harness/manual_fork.py --leave`; self-skips otherwise (the battery
 * has no fork).
 *
 * Proves the whole owner path: SETTINGS → SIM BOOTSTRAP → four creations
 * through THE gate as the impersonated LIVE deployer (never the wallet) →
 * the runtime overlay carries the actual receipt addresses → a SIM surface
 * reads the deployed layer → the fork-only player funds at 2,000,000 PLS →
 * reset clears the overlay only.
 */

const ANVIL0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ANVIL0_PRIV = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const VOID = "0x965B0d74591bF30327075A247C47dBf487dCff08";

async function rpc(req: APIRequestContext, method: string, params: unknown[]): Promise<unknown> {
  const j = (await req
    .post("http://127.0.0.1:8545", { data: { jsonrpc: "2.0", id: 1, method, params } })
    .then((r) => r.json())) as { result?: unknown };
  return j.result;
}

test.describe("session-81 SIM bootstrap on our own fork", () => {
  test("deploy four creations through the gate → runtime overlay → SIM reads → fund · reset", async ({ page }) => {
    test.setTimeout(240_000);

    const forkUp = await page.request
      .post("http://127.0.0.1:8545", { data: { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] } })
      .then((r) => r.ok())
      .catch(() => false);
    test.skip(!forkUp, "no fork on 8545");
    const chainId = (await rpc(page.request, "eth_chainId", []).catch(() => null)) as string | null;
    test.skip(chainId !== "0x171", `not a PulseChain fork (chain ${chainId ?? "?"})`);
    const voidCode = (await rpc(page.request, "eth_getCode", [VOID, "latest"]).catch(() => "0x")) as string;
    test.skip(typeof voidCode !== "string" || voidCode === "0x", "no live perimeter at the pin");

    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/?rpc=http://127.0.0.1:8545");

    // mode B with anvil#0, then yolo (C) + mode-C breadth: creations auto-ack
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("mode-b").click();
    await page.getByTestId("import-priv").fill(ANVIL0_PRIV);
    await page.getByTestId("import-btn").click();
    await expect(page.getByTestId("wallet-b")).toContainText(ANVIL0);
    await page.getByTestId("yolo-input").fill("DANGERS");
    await page.getByTestId("yolo-enter").click();
    await expect(page.getByTestId("yolo-chip")).toBeVisible();
    await page.getByTestId("gate-breadth").check();

    const panel = page.getByTestId("sim-bootstrap");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("sim-bootstrap-status")).toContainText("READY", { timeout: 30_000 });
    await expect(page.getByTestId("sim-bootstrap-checks")).toContainText("anvil_nodeInfo answered");
    await expect(page.getByTestId("sim-bootstrap-checks")).toContainText("27,674,000");
    await expect(page.getByTestId("sim-bootstrap-deploy")).toBeEnabled();

    await page.getByTestId("sim-bootstrap-deploy").click();

    for (const name of ["encrypt", "world", "war", "gwat"]) {
      await expect(page.getByTestId(`sim-bootstrap-step-${name}`)).toContainText("sent", { timeout: 120_000 });
    }
    const overlay = page.getByTestId("sim-bootstrap-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("runtime overlay");
    await expect(overlay).toContainText("deployed by the impersonated live deployer");

    // the actual receipt addresses are recorded and all six names resolve
    const recorded = (await page.evaluate(() => {
      const key = Object.keys(window.localStorage).find((k) => k.startsWith("dys.sim.overlay.v1:"));
      return key ? JSON.parse(window.localStorage.getItem(key) ?? "null") : null;
    })) as { layer: Record<string, string>; deployedBy: string; chainId: number } | null;
    expect(recorded).not.toBeNull();
    expect(recorded!.chainId).toBe(369);
    expect(recorded!.deployedBy.toLowerCase()).toBe("0x0474606332105a1da6fc8ef7de2470551d389cb9");
    for (const name of ["WORLD", "VITUS", "WAR", "H2O", "GWAT", "ENCRYPT"]) {
      expect(recorded!.layer[name]).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
    const worldAddr = recorded!.layer["WORLD"]!;
    await expect(page.getByTestId("sim-bootstrap-address-world")).toHaveText(worldAddr);

    // the wiring verification ran (VOID/CHAN + 1:1 supply + rates + caps)
    await page.getByText(/wiring verification/).click();
    await expect(page.getByTestId("sim-bootstrap-wiring")).toContainText("VOID library 'encrypt'");
    await expect(page.getByTestId("sim-bootstrap-wiring")).toContainText("CHAN.owner(VITUS)");
    await expect(page.getByTestId("sim-bootstrap-wiring")).toContainText("CHAN.owner(WAR)");
    await expect(page.getByTestId("sim-bootstrap-wiring")).toContainText("CHAN.owner(H2O)");
    const failed = await page.locator('[data-testid="sim-bootstrap-wiring"] li.err-text').count();
    expect(failed).toBe(0);

    // a SIM surface reads the deployed layer: the venue WORLD tiles use the
    // runtime overlay (not the static fixture) and answer real values
    await page.getByTestId("rail-map").click();
    await page.getByTestId("venue-search").fill("ozymandias");
    await page.getByTestId("venue-list").locator("button").first().click();
    await page.getByTestId("venue-hud-open-full").click();
    await expect(page.getByTestId("venue-world")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("venue-world-state")).not.toContainText("unreadable", { timeout: 30_000 });
    await expect(page.getByTestId("venue-world-state")).toContainText("anchor (Code convention)");

    // the player: default 2,000,000 PLS on the connected wallet (anvil state)
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("sim-bootstrap-player-amount")).toHaveValue("2000000");
    await page.getByTestId("sim-bootstrap-fund").click();
    await expect(page.getByTestId("sim-bootstrap-fund-result")).toContainText("2,000,000", { timeout: 20_000 });
    const balance = (await rpc(page.request, "eth_getBalance", [ANVIL0, "latest"])) as string;
    expect(BigInt(balance)).toBe(2_000_000n * 10n ** 18n);

    // reset clears the runtime overlay only (the key/wallet stays)
    await page.getByTestId("sim-bootstrap-reset").click();
    await page.getByTestId("sim-bootstrap-reset").click();
    await expect(page.getByTestId("sim-bootstrap-overlay")).toHaveCount(0);
    const leftover = await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith("dys.sim.overlay.v1:")).length);
    expect(leftover).toBe(0);
    await expect(page.getByTestId("wallet-b")).toContainText(ANVIL0);
  });
});
