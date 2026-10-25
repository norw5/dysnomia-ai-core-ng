import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { MOCK_PROVIDER_INIT } from "./mock-provider";

// LIVE-FORK smoke (requires anvil pinned on 8545 — run manually, not in CI):
// proves the identity READ stack against real chain state.
test.describe("identity read path against a pinned fork", () => {
  test("snapshot batches through Multicall3: PLS balance, discovery zeros, predicted LAU", async ({ page }) => {
    const forkUp = await page.request
      .post("http://127.0.0.1:8545", { data: { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] } })
      .then((r) => r.ok())
      .catch(() => false);
    test.skip(!forkUp, "no fork on 8545");
    // the row needs OUR pinned PulseChain fork — a foreign anvil that
    // happens to squat 8545 (another agent's chain) must skip, not run
    const chainId = (await rpc(page.request, "eth_chainId", []).catch(() => null)) as string | null;
    test.skip(chainId !== "0x171", `not a PulseChain fork (chain ${chainId ?? "?"})`);
    // this row pins the FRESH-account reads — an onboarded anvil#0 (the
    // session-66 manual kit below) would break them; skip honestly
    // `?? null`: a foreign/degraded RPC may resolve a malformed result —
    // coerce it so the skip logic below stays total (the 71.1 foreign-anvil find)
    const lauProbe = ((await rpc(page.request, "eth_call", [
      { to: CHO, data: GET_USER_TOKEN_ADDR + ANVIL0.slice(2).toLowerCase().padStart(64, "0") },
      "latest",
    ]).catch(() => null)) as string | null | undefined) ?? null;
    test.skip(
      lauProbe !== null && lauProbe !== "0x" && !lauProbe.includes("0000000000000000000000000000000000000000"),
      "anvil#0 is onboarded on this fork (fresh-account row — use a bare fork)"
    );
    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/?rpc=http://127.0.0.1:8545");
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("mode-a").click();
    await page.getByTestId("connect-io.dysnomia.mox").click();
    await page.getByTestId("rail-identity").click();

    // anvil pre-funds the mnemonic accounts — PLS renders nonzero
    const plsCell = page.getByTestId("bal-table").locator("tbody tr").first().locator("td").first();
    await expect(plsCell).toHaveText(/^[1-9][0-9.]*$/, { timeout: 15_000 });
    // fresh account: no LAU / no YUE, Username unset
    await expect(page.getByTestId("player-snapshot")).toContainText("— none yet");
    await expect(page.getByTestId("player-snapshot")).toContainText("— unset");
    // CREATE1 precompute surfaced before any send
    await expect(page.getByTestId("lau-predicted")).toBeVisible({ timeout: 15_000 });
    const predicted = await page.getByTestId("lau-predicted").textContent();
    expect(predicted).toMatch(/0x[0-9a-fA-F]{40}/);
  });
});

// ---------------------------------------------------------------------------
// session-66: the DSS desk against a LIVE FORK — the full app-side flow the
// dead-RPC e2e cannot reach: DEPLOY through the gate (a real creation tx),
// the receipt-carried capture, the Ⓐ funding, the composer's WORLD+DSS leg
// (approve + chatAndSnipe — two cards), and the world line landing on the
// world SHIO tail.
//
// Requires the manual kit with the anvil#0 key onboarded:
//   python3 harness/manual_fork.py \
//     --key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
//     --onboard --leave
// (then this spec against the held fork; self-skips otherwise)
// ---------------------------------------------------------------------------
const ANVIL0 = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const ANVIL0_PRIV = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const CHO = "0xb6be11f0a788014c1f68c92f8d6ccc1abf78f2ab".toLowerCase(); // config/addresses.json
// config/addresses.json (read-only knowledge for the probe legs)
const AFFECTION = "0x24f0154c1dce548adf15da2098fdd8b8a3b8151d".toLowerCase();
const DEPLOYER_A_WHALE = "0x0474606332105a1da6fc8ef7de2470551d389cb9".toLowerCase();
const GET_USER_TOKEN_ADDR = "0xe80c28bf"; // GetUserTokenAddress(address)
const ERC20_TRANSFER = "0xa9059cbb";

async function rpc(req: APIRequestContext, method: string, params: unknown[]): Promise<unknown> {
  const j = (await req
    .post("http://127.0.0.1:8545", { data: { jsonrpc: "2.0", id: 1, method, params } })
    .then((r) => r.json())) as { result?: unknown };
  return j.result;
}

test.describe("session-66 DSS desk on a live fork (manual_fork --onboard)", () => {
  test("deploy → capture → the composer's WORLD+DSS leg lands a self-sniped world line", async ({ page }) => {
    test.setTimeout(180_000); // real receipts on a local fork — the default 30s is too tight
    const forkUp = await page.request
      .post("http://127.0.0.1:8545", { data: { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] } })
      .then((r) => r.ok())
      .catch(() => false);
    test.skip(!forkUp, "no fork on 8545");
    // the onboarded-account probe: CHO.GetUserTokenAddress(anvil#0) nonzero
    const lauHex = (await rpc(page.request, "eth_call", [
      { to: CHO, data: GET_USER_TOKEN_ADDR + ANVIL0.slice(2).toLowerCase().padStart(64, "0") },
      "latest",
    ]).catch(() => null)) as string | null;
    test.skip(!lauHex || lauHex === "0x" || lauHex.includes("0000000000000000000000000000000000000000"), "anvil#0 not onboarded on this fork (manual_fork --key <anvil0> --onboard --leave)");

    // fund Ⓐ for the snipe: impersonate the deployer whale (harness s3 pattern)
    await rpc(page.request, "anvil_impersonateAccount", [DEPLOYER_A_WHALE]);
    await rpc(page.request, "eth_sendTransaction", [
      {
        from: DEPLOYER_A_WHALE,
        to: AFFECTION,
        data: ERC20_TRANSFER + ANVIL0.slice(2).toLowerCase().padStart(64, "0") + (10n * 10n ** 18n).toString(16).padStart(64, "0"),
      },
    ]);

    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/?rpc=http://127.0.0.1:8545");
    // mode B with the fork's onboarded key — REAL signing, real receipts
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("mode-b").click();
    await page.getByTestId("import-priv").fill(ANVIL0_PRIV);
    await page.getByTestId("import-pass").fill("");
    await page.getByTestId("import-btn").click();
    await expect(page.getByTestId("wallet-account")).toHaveAttribute("title", /^0xf39Fd6/i, { timeout: 10_000 });

    // the desk raised on the DISCOVERED LAU; the CREATE1 prediction is live
    await page.getByTestId("rail-identity").click();
    await expect(page.getByTestId("dss-desk")).toBeVisible({ timeout: 15_000 });
    const bundler = page.getByTestId("dss-bundler");
    await expect(bundler).toContainText(/0x[0-9a-fA-F]{40}/, { timeout: 15_000 }); // predicted address
    const predicted = ((await bundler.textContent()) ?? "").match(/0x[0-9a-fA-F]{40}/)![0]!;

    // DEPLOY — mode B cards; the live fork's DRYRUN passes (no override needed)
    await page.getByTestId("dss-deploy").click();
    const card = page.getByTestId("approval-card");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText("NEW CONTRACT");
    await expect(card.locator(".risk")).toHaveText("deploy");
    await page.getByTestId("approval-confirm").click();

    // the receipt-carried capture flips the desk to the DEPLOYED branch
    // (the pre-deploy branch — predicted + outcome — swaps out by design)
    await expect(bundler).toContainText("your bundler", { timeout: 30_000 });
    const dssMatch = ((await bundler.textContent()) ?? "").match(/0x[0-9a-fA-F]{40}/g) ?? [];
    expect(dssMatch.length).toBeGreaterThan(0);
    const code = (await rpc(page.request, "eth_getCode", [predicted, "latest"])) as string;
    expect(code.length).toBeGreaterThan(4); // the runtime landed (CREATE1 prediction honored)

    // the composer's DSS arm (session-71.1: the target follows the viewed
    // channel — world view + the arm checked = the chatAndSnipe route)
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-chat-tools").click();
    await page.getByTestId("rail-chat").click();
    await expect(page.getByTestId("world-composer")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("composer-arm")).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId("composer-arm").check();
    const line = "the fork sees this self-sniped line";
    await page.getByTestId("composer-input").fill(line);
    await page.getByTestId("composer-send").click();
    // leg 1: the exact-1 Ⓐ approve card
    await expect(card).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("approval-confirm").click();
    // leg 2: the chatAndSnipe card — the leg-1 receipt + the chained
    // dryRun ride real fork round-trips; give them air (the 71.1 render-all
    // mount adds main-thread contention right here), then wait generously
    await page.waitForTimeout(1_500);
    await expect(card).toBeVisible({ timeout: 45_000 });
    await page.getByTestId("approval-confirm").click();
    await expect(page.getByTestId("composer-outcome")).toContainText("sent", { timeout: 60_000 });

    // the world tail carries the line (the LAU.Chat ZHOU route — set-2 s14).
    // The quiet poll is 20s — but under render-all load a poll can straggle,
    // so the row KICKS the refresh like a user would instead of waiting it out
    for (let i = 0; i < 4; i++) {
      const has = await page
        .getByTestId("chat-panel")
        .getByText(line, { exact: false })
        .isVisible()
        .catch(() => false);
      if (has) break;
      await page.getByTestId("chat-refresh").click();
      await page.waitForTimeout(6_000);
    }
    await expect(page.getByTestId("chat-panel")).toContainText(line, { timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// session-68: FULL-AUTO on a LIVE FORK — the dss_snipe cycle. The loop's
// real send path end-to-end: mode C + breadth + the §7.4 opt-in, the agent
// (scripted model) self-snipes a world line through the captured DSS, the
// unknown-METHOD Ⓐ approve still cards (breadth widens unknown-CONTRACT
// only), the unknown-CONTRACT snipe auto-acks, and the SYS cycle ledger
// records the send. Same manual-kit prerequisite as the row above.
// ---------------------------------------------------------------------------
test.describe("session-68 FULL-AUTO dss_snipe on a live fork (manual_fork --onboard)", () => {
  test("engage → the snipe cycle lands a self-purchased world line → the ledger row + backstop disengage", async ({ page }) => {
    test.setTimeout(180_000);
    const forkUp = await page.request
      .post("http://127.0.0.1:8545", { data: { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] } })
      .then((r) => r.ok())
      .catch(() => false);
    test.skip(!forkUp, "no fork on 8545");
    const lauHex = (await rpc(page.request, "eth_call", [
      { to: CHO, data: GET_USER_TOKEN_ADDR + ANVIL0.slice(2).toLowerCase().padStart(64, "0") },
      "latest",
    ]).catch(() => null)) as string | null;
    test.skip(!lauHex || lauHex === "0x" || lauHex.includes("0000000000000000000000000000000000000000"), "anvil#0 not onboarded on this fork (manual_fork --key <anvil0> --onboard --leave)");

    // fund Ⓐ for the snipe (the harness s3 whale pattern)
    await rpc(page.request, "anvil_impersonateAccount", [DEPLOYER_A_WHALE]);
    await rpc(page.request, "eth_sendTransaction", [
      {
        from: DEPLOYER_A_WHALE,
        to: AFFECTION,
        data: ERC20_TRANSFER + ANVIL0.slice(2).toLowerCase().padStart(64, "0") + (10n * 10n ** 18n).toString(16).padStart(64, "0"),
      },
    ]);

    // the scripted model: cycle 1 = the snipe SEND; then a closing summary
    const snipeLine = "full-auto cycle one: the bundler speaks";
    let completion = 0;
    await page.route("**openrouter.ai/api/v1/chat/completions", async (route) => {
      const first = completion === 0;
      completion += 1;
      const message = first
        ? { content: null, tool_calls: [{ id: "fa1", type: "function", function: { name: "dss_snipe", arguments: JSON.stringify({ message: snipeLine, send: true }) } }] }
        : { content: "▸ plan: snipe one world line.\nCycle 1 done — the line is onchain; emission self-collected." };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          choices: [{ message, finish_reason: first ? "tool_calls" : "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
        }),
      });
    });

    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/?rpc=http://127.0.0.1:8545");
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("mode-b").click();
    await page.getByTestId("import-priv").fill(ANVIL0_PRIV);
    await page.getByTestId("import-pass").fill("");
    await page.getByTestId("import-btn").click();
    await expect(page.getByTestId("wallet-account")).toHaveAttribute("title", /^0xf39Fd6/i, { timeout: 10_000 });

    // deploy the DSS through the desk (mode B card — one creation tx)
    await page.getByTestId("rail-identity").click();
    await expect(page.getByTestId("dss-desk")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("dss-deploy").click();
    const card = page.getByTestId("approval-card");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("approval-confirm").click();
    await expect(page.getByTestId("dss-bundler")).toContainText("your bundler", { timeout: 30_000 });

    // the full-auto harness config: §7.4 chat opt-in, mode-C breadth, the
    // cycle backstop at 1 (one snipe cycle, then the honest disengage)
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("agent-chat-tools").check();
    await page.getByTestId("gate-breadth").check();
    await page.getByTestId("agent-fa-cycles").fill("1");
    await page.getByTestId("agent-save").click();
    await page.getByTestId("yolo-input").fill("DANGERS");
    await page.getByTestId("yolo-enter").click();
    await expect(page.getByTestId("wallet-mode")).toHaveText("YOLO");

    // engage on the DECK — the kickoff cycle drives the snipe
    await page.getByTestId("rail-deck").click();
    await page.getByTestId("agent-fullauto").click();
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO engaged. You are running autonomously", { timeout: 10_000 });
    // the Ⓐ approve leg STILL CARDS (unknown-method — breadth never widens
    // it); confirm it. The snipe leg (unknown-contract) rides the breadth
    // auto-ack — no second card.
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("0x095ea7b3"); // the exact-1 Ⓐ approve
    await expect(card).toContainText("unknown-method");
    await page.getByTestId("approval-confirm").click();
    // the tool result lands SENT (the fold carries the legs)
    await expect(page.getByTestId("agent-chat")).toContainText("chatAndSnipe", { timeout: 30_000 });
    await expect(page.getByTestId("agent-chat")).toContainText('"status": "sent"', { timeout: 30_000 });
    // cycle 1 done → the backstop(1) disengage
    await expect(page.getByTestId("agent-chat")).toContainText("FULL-AUTO disengaged — cycle backstop (1) reached", { timeout: 20_000 });

    // the SYS cycle ledger records the send
    await page.getByTestId("agent-tab-sys").click();
    const runRow = page.getByTestId("sys-fullauto-ledger").locator('[data-kind="run"]');
    await expect(runRow).toContainText("done");
    await expect(runRow.getByTestId("sys-fullauto-sends")).toHaveText("1"); // sends landed this cycle

    // the world tail carries the self-sniped line (20s quiet poll)
    await page.getByTestId("rail-chat").click();
    await expect(page.getByTestId("chat-panel")).toContainText(snipeLine, { timeout: 45_000 });
  });
});

// ---------------------------------------------------------------------------
// session-70: the GLOBAL SYNC ENGINE on a LIVE FORK — the corpus catch-up
// end-to-end. The venue seed was regenerated to LIVE head (above the pin),
// so on the fork the engine starts PAUSED (the sim default), and resuming
// walks the BEHIND-HEAD LOOKBACK window (head − 150k).
//
// The fork-create wrinkle: a venue's address derives from MAP's CREATE
// nonce, so the fork's Nth MAP.New REPLAYS the live chain's Nth venue
// address — the refreshed seed already contains the first post-pin slots
// (Solo QING, dGENESIS). The row therefore sends TWO extra MAP.New creates
// via anvil impersonation: the first lands on a seed-covered slot (the
// dedupe must drop it silently), the second reaches a nonce the live chain
// never created → the TRUE catch-up row (+1 live, HECKE coords, selectable)
// — plus the world-chat backfill (the chat seed ends below the pin).
//
// Requires the manual kit with a venue created on the fork:
//   python3 harness/manual_fork.py --venue --leave
// (self-skips on a bare fork — the probe looks for a fork-local NewQing)
// ---------------------------------------------------------------------------
const MAP_CFG = "0xd3a7a95012edd46ea115c693b74c5e524b3dda75"; // config/addresses.json
const NEW_QING_TOPIC0 = "0x692bc76be0a4b0d71d90e36ee97b1f3c4141095ea3c22b01b9f620da2e4b5e2e";
const MAP_NEW_SELECTOR = "0xddb59200"; // MAP.New(address) — abi/index.json

test.describe("session-70 sync engine on a live fork (manual_fork --venue)", () => {
  test("resume → the NewQing walk catches a beyond-live-nonce venue → browse shows +1 LIVE + the chat backfill warms", async ({ page }) => {
    test.setTimeout(420_000); // proxied getLogs pages against the fork's upstream; kicks during a busy pass drop (passBusy) — the 45s interval carries the load
    const forkUp = await page.request
      .post("http://127.0.0.1:8545", { data: { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] } })
      .then((r) => r.ok())
      .catch(() => false);
    test.skip(!forkUp, "no fork on 8545");
    const head0 = Number(await rpc(page.request, "eth_blockNumber", []) as bigint);
    // a fork-local NewQing within the last 5k blocks = the manual kit ran
    // --venue on this fork (the real chain has none in any pin-window)
    const recent = (await rpc(page.request, "eth_getLogs", [
      { address: MAP_CFG, topics: [NEW_QING_TOPIC0], fromBlock: "0x" + Math.max(0, head0 - 5_000).toString(16), toBlock: "latest" },
    ]).catch(() => [])) as unknown[];
    test.skip(!Array.isArray(recent) || recent.length === 0, "no fork-local venue (start the kit with --venue)");

    // Out-advance MAP's nonce past the live chain's post-pin slots: a
    // venue's address derives from MAP's CREATE nonce, so the fork's Nth
    // MAP.New REPLAYS the live chain's Nth venue address — the refreshed
    // seed already contains the first post-pin slots (Solo QING, dGENESIS).
    // Deploy TWO byte-pinned MockAssets from a funded+impersonated anvil#0,
    // then MAP.New each with EXPLICIT gas (an impersonated eth_sendTransaction
    // may default to a gas-starved tx that reverts EMPTY at ~24k — the
    // session-70 find; the Waat-probe staticcalls fit, Cho.Luo() does not):
    // the first create lands on a seed-covered slot (the dedupe must drop it
    // silently), the second reaches a nonce the live chain never created →
    // the TRUE catch-up row. (Pin gas ~1.2e15 wei — a create costs thousands
    // of PLS; fund generously.)
    const mockCreation = "0x" + readFileSync("../harness/fixtures/mock_asset.creation.hex", "utf8").trim().replace(/^0x/, "");
    await rpc(page.request, "anvil_setBalance", [ANVIL0, "0xD3C21BCECCEDA1000000"]); // 100k PLS
    await rpc(page.request, "anvil_impersonateAccount", [ANVIL0]);
    const awaitReceipt = async (hash: unknown): Promise<Record<string, unknown> | null> => {
      for (let i = 0; i < 20; i++) {
        const rec = (await rpc(page.request, "eth_getTransactionReceipt", [hash]).catch(() => null)) as Record<string, unknown> | null;
        if (rec && rec.blockNumber) return rec;
        await page.waitForTimeout(500);
      }
      return null;
    };
    let caughtAddr: string | null = null;
    for (let i = 0; i < 2; i++) {
      const sent = await rpc(page.request, "eth_sendTransaction", [{ from: ANVIL0, data: mockCreation, gas: "0x300000" }]);
      const assetRec = await awaitReceipt(sent);
      const asset = assetRec?.contractAddress as string | undefined;
      if (!asset || assetRec?.status !== "0x1") throw new Error(`mock asset deploy failed on the fork (${JSON.stringify(assetRec?.status)})`);
      const newHash = await rpc(page.request, "eth_sendTransaction", [
        { from: ANVIL0, to: MAP_CFG, data: MAP_NEW_SELECTOR + asset.slice(2).toLowerCase().padStart(64, "0"), gas: "0x300000" },
      ]);
      const newRec = await awaitReceipt(newHash);
      if (newRec?.status !== "0x1") throw new Error(`MAP.New failed for ${asset} (draw retry? re-run the row)`);
      // NewQing rides the receipt (args not indexed — data words); the
      // SECOND create is the beyond-live-nonce one the engine must catch
      if (i === 1) {
        const logs = (newRec.logs as Array<{ topics: string[]; data: string }>) ?? [];
        const nq = logs.find((l) => l.topics[0]?.toLowerCase() === NEW_QING_TOPIC0);
        caughtAddr = nq ? "0x" + nq.data.slice(26, 66) : null;
      }
    }
    if (!caughtAddr) throw new Error("second MAP.New carried no NewQing log");

    await page.addInitScript(MOCK_PROVIDER_INIT);
    await page.goto("/?rpc=http://127.0.0.1:8545");

    // the sim default: PAUSED, honestly labeled
    const chip = page.getByTestId("sync-engine-chip");
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(chip).toContainText("PAUSED");

    // resume via the header control; drive passes via SETTINGS "sync now"
    await chip.click();
    await page.getByTestId("rail-settings").click();
    await expect(page.getByTestId("sync-panel")).toBeVisible({ timeout: 10_000 });
    for (let i = 0; i < 20; i++) {
      const panelText = (await page.getByTestId("sync-panel").textContent()) ?? "";
      if (/\+[1-9]\d* live venues/.test(panelText)) break; // "+0" is NOT caught up
      await page.getByTestId("sync-panel-kick").click();
      await page.waitForTimeout(8_000);
    }
    await expect(page.getByTestId("sync-panel")).toContainText(/\+[1-9]\d* live venues/, { timeout: 120_000 });

    // the caught-up venue joins the browse with a LIVE flag + is selectable
    // (search by address — the appended row sits past the 60-row slice)
    await page.getByTestId("rail-map").click();
    await expect(page.getByTestId("venue-count")).toContainText(/\(\+\d+ live\)/, { timeout: 30_000 });
    await page.getByTestId("venue-search").fill(caughtAddr!);
    const liveRow = page.getByTestId("venue-list").locator("[data-testid^='venue-row-']").filter({
      has: page.getByTestId("venue-live-flag"),
    });
    await expect(liveRow).toHaveCount(1, { timeout: 10_000 });
    await liveRow.first().click();
    await expect(page.getByTestId("current-venue")).toContainText(/band [0-9]+/, { timeout: 10_000 });

    // both feeds synced through the fork head (the header DATA chip) — the
    // chat backfill bridged the seed→live gap (chat seed ends 27,597,840)
    await expect(chip).toContainText(/→ 27[0-9,]{7,}/, { timeout: 60_000 });
  });
});
