#!/usr/bin/env node
// harness/fullauto_run.mjs — the session-68 FULL-AUTO live run (capture
// tooling ONLY, no app code): boots the app against a manual_fork fork,
// imports the funded wallet (mode B), arms the full-auto harness config
// (mode C yolo + gate breadth + the §7.4 chat opt-in), ENGAGES FULL-AUTO,
// and lets the REAL model run cycles for N minutes — screenshots + the
// pane transcript + the SYS cycle ledger land in harness/runs/fullauto_<ts>/.
//
// The operator levers ride as flags: --whisper <text> queues a mid-run
// whisper (the 65 steering lever), --stop-after <sec> disengages cleanly
// instead of riding the backstop, --objective <text> sets the standing
// operator objective, and --strategist <model> arms the two-tier
// strategist (the 75 live-fire proof: objective → menu → pick → execute).
//
// Usage:
//   python3 harness/manual_fork.py --key 0xac09… --onboard --venue --leave
//   node harness/fullauto_run.mjs --key 0xac09… [--minutes 6] \
//        [--rpc http://127.0.0.1:8545] [--dev-url http://127.0.0.1:5173] \
//        [--whisper "settle the venue, then assess Beat readiness"] \
//        [--whisper-at 90] [--stop-after 240] [--width 1600] [--height 1000] \
//        [--objective "…"] [--strategist "deepseek/deepseek-v4-pro-0813"] \
//        [--fa-tokens 900000] [--run-tokens 500000]

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "..");
const APP = path.join(ROOT, "app");
const RUNS = path.join(HERE, "runs");

const pw = await import(pathToFileURL(path.join(APP, "node_modules", "playwright", "index.mjs")).href);
const { chromium } = pw;

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : d;
};
const key = arg("key", null);
if (key === null) {
  console.error("--key <0x…> is required (the manual_fork funded wallet key)");
  process.exit(1);
}
const rpc = arg("rpc", "http://127.0.0.1:8545");
const devUrl = arg("dev-url", "http://127.0.0.1:5173");
const minutes = Math.max(1, Number(arg("minutes", 6)));
const whisper = arg("whisper", null);
const whisperAt = Math.max(5, Number(arg("whisper-at", 90))) * 1000;
const stopAfter = arg("stop-after", null) === null ? null : Math.max(30, Number(arg("stop-after"))) * 1000;
const objective = arg("objective", null);
const strategist = arg("strategist", null);
const faTokens = arg("fa-tokens", null);
const runTokens = arg("run-tokens", null);
const width = Math.max(1024, Number(arg("width", 1600)));
const height = Math.max(700, Number(arg("height", 1000)));

// ---- the dev server (spawn when not answering — the grid_capture pattern) ----
let devProc = null;
async function waitHttp(url, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
if (!(await waitHttp(devUrl, 2_000))) {
  console.log(`spawning the dev server at ${devUrl} …`);
  devProc = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
    cwd: APP,
    stdio: "ignore",
    detached: true, // own process GROUP — SIGKILL on the group takes the vite child too
  });
  if (!(await waitHttp(devUrl, 60_000))) {
    console.error("the dev server did not come up");
    if (devProc !== null) process.kill(-devProc.pid, "SIGKILL");
    process.exit(1);
  }
}

const ts = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const outDir = path.join(RUNS, `fullauto_${ts}`);
const shots = path.join(outDir, "shots");
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width, height } });
const page = await ctx.newPage();
const log = (...a) => console.log(`[fullauto ${new Date().toISOString().slice(11, 19)}]`, ...a);

try {
  await page.goto(`${devUrl}/?rpc=${encodeURIComponent(rpc)}`, { waitUntil: "domcontentloaded" });

  // the wallet (mode B) + the harness config (yolo + breadth + chat opt-in)
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("mode-b").click();
  await page.getByTestId("import-priv").fill(key);
  await page.getByTestId("import-pass").fill("");
  await page.getByTestId("import-btn").click();
  // the account chip shows the USERNAME once known (session-66) — match the
  // title attribute, which always carries the address
  await page.getByTestId("wallet-account").waitFor({ timeout: 10_000 });
  const chipTitle = (await page.getByTestId("wallet-account").getAttribute("title").catch(() => "")) ?? "";
  if (!/^0x/i.test(chipTitle)) {
    throw new Error(`wallet import did not land (title: ${chipTitle})`);
  }
  await page.getByTestId("gate-breadth").check();
  await page.getByTestId("agent-chat-tools").check();
  // the session-75 live-fire levers: the standing OBJECTIVE + the STRATEGIST
  // (both persisted app settings — one save covers the text fields, the
  // checkbox writes directly like every toggle in the panel)
  if (objective !== null || strategist !== null || faTokens !== null || runTokens !== null) {
    if (objective !== null) await page.getByTestId("agent-fa-objective").fill(objective);
    if (strategist !== null) await page.getByTestId("agent-strategist-model").fill(strategist);
    if (faTokens !== null) await page.getByTestId("agent-fa-tokens").fill(faTokens);
    // the per-RUN budget: the fat cycle-1 tail (160k–484k observed — the
    // 484k is the 75 datum) can still blow past even the raised 300k
    // default — a budget-stop cycle disengages the loop before the
    // strategist window can ever run
    if (runTokens !== null) await page.getByTestId("agent-tokens").fill(runTokens);
    await page.getByTestId("agent-save").click();
    if (strategist !== null) {
      await page.getByTestId("agent-strategist").check();
      log(`strategist armed: ${strategist}`);
    }
    if (objective !== null) log(`objective set: ${objective}`);
  }
  await page.getByTestId("yolo-input").fill("DANGERS");
  await page.getByTestId("yolo-enter").click();
  await expectText(page, "wallet-mode", "YOLO", 10_000);
  log("wallet imported, mode C armed (breadth + chat opt-in)");

  // ENGAGE on the deck
  await page.getByTestId("rail-deck").click();
  await page.getByTestId("agent-fullauto").click();
  await expectText(page, "agent-chat", "FULL-AUTO engaged. You are running autonomously", 20_000);
  log("FULL-AUTO engaged — the live model runs");

  const startedAt = Date.now();
  const deadline = startedAt + minutes * 60_000;
  let shot = 0;
  let whispered = whisper === null;
  let stopped = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(10_000);
    shot += 1;
    await page.screenshot({ path: path.join(shots, `t${String(shot).padStart(3, "0")}.png`) });
    const spend = (await page.getByTestId("agent-spend").textContent().catch(() => "")) ?? "";
    const busy = await page.getByTestId("agent-processing").count();
    log(`t+${Math.round((Date.now() - startedAt) / 1000)}s · ${spend.trim()} · ${busy > 0 ? "RUNNING" : "idle"}`);
    if (!whispered && whisper !== null && Date.now() >= startedAt + whisperAt) {
      await page.getByTestId("agent-input").fill(whisper);
      await page.click("[data-testid=agent-whisper-send],[data-testid=agent-exec]").catch(() => {});
      log(`whisper queued: "${whisper}"`);
      whispered = true;
    }
    if (stopAfter !== null && !stopped && Date.now() >= startedAt + stopAfter) {
      await page.getByTestId("agent-fullauto").click().catch(() => {});
      log("operator disengage clicked — the current run finishes");
      stopped = true;
    }
    // the loop may have disengaged on its own fence — stop sampling when the
    // spend line loses the FULL-AUTO prefix (the button always says FULL-AUTO)
    const spendNow = (await page.getByTestId("agent-spend").textContent().catch(() => "")) ?? "";
    if (!spendNow.includes("FULL-AUTO")) {
      log("the loop disengaged (fence or backstop) — capturing the tail");
      break;
    }
  }

  // let the tail settle, then capture the transcript (CORE tab) + SYS ledger
  await page.waitForTimeout(5_000);
  const chatText = (await page.getByTestId("agent-chat").innerText().catch(() => "")) ?? "";
  await page.getByTestId("agent-tab-sys").click().catch(() => {});
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: path.join(outDir, "sys.png"), fullPage: false });
  const ledgerText = (await page.getByTestId("sys-fullauto-ledger").textContent().catch(() => "no ledger")) ?? "";
  const stateText = (await page.getByTestId("sys-fullauto-state").textContent().catch(() => "")) ?? "";

  writeFileSync(path.join(outDir, "ledger.txt"), `${stateText}\n\n${ledgerText}\n`);
  writeFileSync(path.join(outDir, "transcript.txt"), chatText);
  log(`captured: ${chatText.length} chars transcript · ledger state: ${stateText.trim()}`);
  // the strategist live-fire proof: the window rows (a pick OR an honest
  // fallback) only exist if the between-cycles call actually RAN live
  if (strategist !== null) {
    const picks = [...chatText.matchAll(/\[STRATEGIST cycle \d+[^\]]*\]/g)].map((m) => m[0]);
    const goals = [...chatText.matchAll(/\[FULL-AUTO cycle \d+ — the strategist picked the goal\.\]/g)].length;
    const proof = [`objective: ${objective ?? "(none)"}`, `strategist: ${strategist}`, ...picks, `kickoffs carrying the pick: ${goals}`].join("\n");
    writeFileSync(path.join(outDir, "strategist.txt"), `${proof}\n`);
    log(`STRATEGIST PROOF — window rows: ${picks.length}, kickoffs on the pick: ${goals}`);
    if (picks.length === 0) log("WARN: no strategist window row in the transcript (the loop may have disengaged before cycle 2)");
  }
  log(`output: ${outDir}`);
} finally {
  await browser.close();
  if (devProc !== null) process.kill(-devProc.pid, "SIGKILL"); // the whole group
}

async function expectText(page, testid, text, timeout) {
  const loc = page.getByTestId(testid);
  await loc.waitFor({ timeout });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const t = (await loc.textContent().catch(() => "")) ?? "";
    if (typeof text === "string" ? t.includes(text) : text.test(t)) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`expectText ${testid} did not match ${text}`);
}
