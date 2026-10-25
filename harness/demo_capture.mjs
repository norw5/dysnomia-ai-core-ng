#!/usr/bin/env node
// harness/demo_capture.mjs — the session-69 DEMO VIDEO capture (capture
// tooling ONLY, no app code). Records the two owner-called demo videos LIVE
// from the headless browser (playwright recordVideo — NO replay machinery):
//
//   take "guided"   VIDEO 1 — "empty wallet → player" (~4–6 min): a BARE
//                   manual_fork (no --onboard), mode C + breadth, the
//                   onboarding widget's agent handoff with a SPECIFIED
//                   identity (the preference contract on camera), then one
//                   explicit prompt per narrative beat: home-QING claim →
//                   settle → focus_map (the live HECKE marker is the payoff
//                   frame) → dss_snipe world line → journal_note. The Ⓐ for
//                   the snipe is primed by the harness whale impersonation
//                   (the forksmoke s66/s68 pattern — a fork-only fixture).
//
//   take "fullauto" VIDEO 2 — "the aged account goes full-auto" (~3–5 min):
//                   manual_fork --aged-transfer (the wallet key IS an aged
//                   account: committed-Beat lineage), FULL-AUTO engaged with
//                   whisper-steered cycle 1 (the Beat at Phobos), ending ON
//                   CAMERA at the cycle backstop (fullAutoMaxCycles=4 via
//                   SETTINGS, the script never touches STOP) — token cap ~1M
//                   + a wall-clock safety net as backstops only.
//
// Both takes: 1920×1200, the default amber ATROPA-999 theme (no ?vessel=),
// the default model (deepseek-v4.1-flash, reasoning off — the tested combo),
// the CORE stream only (the script never switches the pane to SYS). An
// approval-card AUTO-CONFIRMER clicks visible cards after ~1.2s so the gate
// is SEEN working (unknown-METHOD legs still card under breadth) and the
// plan APPROVE button after ~1.6s (the L1 human moment).
//
// session-72 RE-TAKE additions (the 70/71 refinements on camera): the sync
// engine's PAUSED→resume header-DATA click (the 70 fork law), and in video 1
// a CHAT-module beat after the snipe — render-all archive → the RICH layout
// switch → the ⟳ refresh surfacing the landed world line (handle probe) →
// ONE manual composer line (follow-the-channel target + the composer toast).
//
// Live takes are nondeterministic — re-runnable, FRESH FORK per take (the
// script spawns manual_fork.py itself and stops it by process group). ffmpeg
// transcodes webm → mp4 (the session-62 grid precedent).
//
// Usage (repo root; needs app/.env OPENROUTER_API_KEY for the dev key channel):
//   node harness/demo_capture.mjs                      # both takes, fresh forks
//   node harness/demo_capture.mjs --take guided        # video 1 only
//   node harness/demo_capture.mjs --take fullauto      # video 2 only
//   node harness/demo_capture.mjs --key 0xac09… --minutes 16 --keep-fork
//
// Output: harness/runs/demo72_<take>_<ts>/ (video.mp4 + the raw .webm +
// transcript.txt + the manual_fork log).

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "..");
const APP = path.join(ROOT, "app");
const RUNS = path.join(HERE, "runs");

// anvil #0 (the manual-kit convention; worthless off-fork, funded per take)
const ANVIL0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ANVIL0 = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
// read-only fork fixtures (config/addresses.json knowledge; the forksmoke s66
// pattern): the Ⓐ whale primes the snipe's purchase balance
const AFFECTION = "0x24f0154c1dce548adf15da2098fdd8b8a3b8151d";
const DEPLOYER_A_WHALE = "0x0474606332105a1da6fc8ef7de2470551d389cb9";
const ERC20_TRANSFER = "0xa9059cbb";

const pw = await import(pathToFileURL(path.join(APP, "node_modules", "playwright", "index.mjs")).href);
const { chromium } = pw;

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : d;
};
const takeArg = arg("take", "both");
if (!["guided", "fullauto", "both"].includes(takeArg)) {
  console.error("--take must be guided | fullauto | both");
  process.exit(1);
}
const key = arg("key", ANVIL0_KEY);
const rpc = arg("rpc", "http://127.0.0.1:8545");
const devUrl = arg("dev-url", "http://127.0.0.1:5173");
const width = Math.max(1024, Number(arg("width", 1920)));
const height = Math.max(700, Number(arg("height", 1200)));
const faMinutes = Math.max(4, Number(arg("minutes", 16))); // video-2 wall-clock net
const beatMinutes = Math.max(2, Number(arg("beat-minutes", 7))); // per guided-beat net
const whisper = arg("whisper", "Steer this cycle: commit ONE Beat at Phobos — the aged account's signature move. DRYRUN first, then send it.");
const whisper2 = arg("whisper2", "Steer this cycle: commit ONE settle (CHEON.Su) at a venue you can reach — DRYRUN first, then send, and read the account-token drip from the receipt.");
const whisper3 = arg("whisper3", "Drop the home-QING create line for the REST of this engagement — the aged LAU already owns a QING (MAP.hasOwner is true), so a create reverts QingAlreadyExists; stop probing it. This cycle: focus_map on Phobos (the venue you Beat'd), read its refreshed venue state, and journal what the aged account sees. No sends needed this cycle.");
const whisperAt = Math.max(5, Number(arg("whisper-at", 25))) * 1000;
const keepFork = process.argv.includes("--keep-fork");

// ---- the dev server (spawn when not answering — the fullauto_run pattern) ----
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
    detached: true,
  });
  if (!(await waitHttp(devUrl, 60_000))) {
    console.error("the dev server did not come up");
    if (devProc !== null) process.kill(-devProc.pid, "SIGKILL");
    process.exit(1);
  }
}

// ---- the fork lifecycle (fresh per take; the python parent owns anvil —
// SIGINT its group and it stops anvil itself; never pkill -f anvil) ----
async function forkUp(url) {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    const j = await r.json();
    return Number.parseInt(j.result, 16) === 369;
  } catch {
    return false;
  }
}
async function rpcCall(method, params) {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return r.json();
}
async function startFork(flags, logFile) {
  if (await forkUp(rpc)) throw new Error(`something already answers on ${rpc} — stop it first (kill by PID, HARNESS.md)`);
  // -u: python block-buffers piped stdout — the READY line must flush live
  const child = spawn("python3", ["-u", path.join(HERE, "manual_fork.py"), "--key", key, ...flags], {
    cwd: HERE,
    detached: true, // own group — SIGINT reaches python + anvil together
  });
  let out = "";
  child.stdout.on("data", (d) => {
    out += d.toString();
    process.stdout.write(`[fork] ${d}`);
  });
  child.stderr.on("data", (d) => process.stdout.write(`[fork:err] ${d}`));
  const deadline = Date.now() + 420_000; // pin download + aged-transfer chain
  while (Date.now() < deadline) {
    if (out.includes("[FAIL]") || out.includes("[ABORT]") || child.exitCode !== null) {
      writeFileSync(logFile, out);
      throw new Error(`manual_fork failed (exit ${child.exitCode}) — see ${logFile}`);
    }
    if (out.includes("MANUAL FORK READY") && (await forkUp(rpc))) return { child, out };
    await new Promise((r) => setTimeout(r, 1_000));
  }
  writeFileSync(logFile, out);
  throw new Error("manual_fork did not become ready in 420s");
}
async function stopFork(child) {
  if (child === null || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGINT"); // python's KeyboardInterrupt handler stops anvil
  } catch {}
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (!(await forkUp(rpc))) return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  try {
    process.kill(-child.pid, "SIGKILL"); // the stubborn tail
  } catch {}
  await new Promise((r) => setTimeout(r, 2_000));
}

/** the Ⓐ prime (the forksmoke s66 whale impersonation — fork-only fixture) */
async function primeAffection(log) {
  await rpcCall("anvil_impersonateAccount", [DEPLOYER_A_WHALE]);
  const r = await rpcCall("eth_sendTransaction", [
    {
      from: DEPLOYER_A_WHALE,
      to: AFFECTION,
      data: ERC20_TRANSFER + ANVIL0.slice(2).toLowerCase().padStart(64, "0") + (10n * 10n ** 18n).toString(16).padStart(64, "0"),
    },
  ]);
  if (r.error) throw new Error(`the Ⓐ prime failed: ${JSON.stringify(r.error)}`);
  log(`Ⓐ primed for the snipe (10 Ⓐ from the fork whale)`);
}

const stamp = () => new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

// ---- shared UI helpers ----
async function expectText(page, testid, text, timeout) {
  const loc = page.getByTestId(testid);
  await loc.waitFor({ timeout });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const t = (await loc.textContent().catch(() => "")) ?? "";
    if (typeof text === "string" ? t.includes(text) : text.test(t)) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`expectText ${testid} did not match ${text}`);
}

/** the approval auto-confirmer + plan approver — runs for the whole take so
 * every card is SEEN (~1.2s) then confirmed (never reject; unknown-METHOD
 * legs still card under breadth — the gate working on camera) */
function startConfirmers(page, log) {
  let stop = false;
  let lastCardAt = 0;
  let lastPlanAt = 0;
  (async () => {
    while (!stop) {
      try {
        const card = page.getByTestId("approval-card");
        if ((await card.count().catch(() => 0)) > 0 && (await card.first().isVisible().catch(() => false))) {
          if (Date.now() - lastCardAt > 4_000) {
            await page.waitForTimeout(1_200); // SEEN on camera
            if (await card.first().isVisible().catch(() => false)) {
              await page.getByTestId("approval-confirm").first().click().catch(() => {});
              lastCardAt = Date.now();
              log("approval card CONFIRMED (auto-confirmer)");
            }
          }
        }
        const decide = page.getByTestId("widget-plan-decide");
        if ((await decide.count().catch(() => 0)) > 0 && (await decide.first().isVisible().catch(() => false))) {
          if (Date.now() - lastPlanAt > 6_000) {
            await page.waitForTimeout(1_600); // the L1 human moment, on camera
            if (await decide.first().isVisible().catch(() => false)) {
              await page.getByTestId("widget-plan-approve").first().click().catch(() => {});
              lastPlanAt = Date.now();
              log("plan APPROVED (auto-approver)");
            }
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 350));
    }
  })();
  return () => {
    stop = true;
  };
}

/** a run is settled when it has STARTED (processing seen), the pane went
 * idle, no plan awaits, no card is up, and the spend line held for a beat
 * (guided beats pass a shorter window — the owner's pacing note, 69.2) */
async function waitRunSettled(page, log, timeoutMs, stableMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let started = false;
  while (Date.now() < deadline && !started) {
    const processing = (await page.getByTestId("agent-processing").count().catch(() => 0)) ?? 0;
    const planRuns = (await page.getByTestId("widget-plan").count().catch(() => 0)) ?? 0;
    if (processing > 0 || planRuns > 0) started = true;
    else await page.waitForTimeout(700);
  }
  if (!started) log("WARN: never saw the run start — assuming settled");
  let stableSince = null;
  let lastSpend = null;
  while (Date.now() < deadline) {
    const processing = (await page.getByTestId("agent-processing").count().catch(() => 0)) ?? 0;
    const card = (await page.getByTestId("approval-card").count().catch(() => 0)) ?? 0;
    const decide = (await page.getByTestId("widget-plan-decide").count().catch(() => 0)) ?? 0;
    const spend = ((await page.getByTestId("agent-spend").textContent().catch(() => "")) ?? "").trim();
    const idle = processing === 0 && card === 0 && decide === 0;
    if (idle && spend === lastSpend) {
      if (stableSince === null) stableSince = Date.now();
      if (Date.now() - stableSince > stableMs) {
        log(`run settled · ${spend || "(no spend line)"}`);
        return true;
      }
    } else {
      stableSince = null;
      lastSpend = spend;
    }
    await page.waitForTimeout(1_500);
  }
  log("WARN: waitRunSettled timed out — continuing");
  return false;
}

async function sendPrompt(page, log, text) {
  const input = page.getByTestId("agent-input");
  await input.click();
  await input.pressSequentially(text, { delay: 18 }); // typed on camera
  await page.waitForTimeout(600);
  await page.getByTestId("agent-exec").click();
  log(`prompt sent: "${text.slice(0, 72)}${text.length > 72 ? "…" : ""}"`);
}

/** SETTINGS: mode B import + mode C yolo + breadth + the §7.4 chat opt-in
 * (+ the optional full-auto caps / per-run budget for video 2) */
async function armHarness(page, log, { faCycles = null, faTokens = null, maxTokens = null } = {}) {
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("mode-b").click();
  await page.getByTestId("import-priv").fill(key);
  await page.getByTestId("import-pass").fill("");
  await page.getByTestId("import-btn").click();
  await page.getByTestId("wallet-account").waitFor({ timeout: 15_000 });
  const title = (await page.getByTestId("wallet-account").getAttribute("title").catch(() => "")) ?? "";
  if (!/^0x/i.test(title)) throw new Error(`wallet import did not land (title: ${title})`);
  await page.getByTestId("gate-breadth").check();
  await page.getByTestId("agent-chat-tools").check();
  if (faCycles !== null || faTokens !== null || maxTokens !== null) {
    if (faCycles !== null) await page.getByTestId("agent-fa-cycles").fill(String(faCycles));
    if (faTokens !== null) await page.getByTestId("agent-fa-tokens").fill(String(faTokens));
    if (maxTokens !== null) await page.getByTestId("agent-tokens").fill(String(maxTokens));
    await page.getByTestId("agent-save").click();
    log(`agent caps armed: cycles=${faCycles} faTokens=${faTokens} per-run=${maxTokens}`);
  }
  await page.getByTestId("yolo-input").fill("DANGERS");
  await page.getByTestId("yolo-enter").click();
  await expectText(page, "wallet-mode", "YOLO", 10_000);
  log("wallet imported · mode C armed (breadth + chat opt-in)");
}

/** wait for the app-global SNAPSHOT to resolve the identity before any
 * agent run — engaging into the loading window once made cycle 1 read the
 * wallet as absent (the session-69 re-take law; UNREADABLE ≠ ABSENT) */
async function waitForSnapshot(page, log, timeoutMs = 45_000) {
  await page.getByTestId("rail-identity").click();
  const snap = page.getByTestId("player-snapshot");
  await snap.waitFor({ timeout: 15_000 });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const t = ((await snap.textContent().catch(() => "")) ?? "");
    if (/0x[0-9a-fA-F]{10}/.test(t) && !t.includes("— none yet")) {
      log(`snapshot live (identity resolved on camera)`);
      return;
    }
    await page.waitForTimeout(800);
  }
  throw new Error("the player snapshot never resolved the identity");
}

/** the sync engine starts PAUSED on a fork (the session-70 law) — the
 * header DATA resume click is a visible beat: PAUSED → click → walks */
async function resumeSyncEngine(page, log) {
  const chip = page.getByTestId("sync-engine-chip");
  await chip.waitFor({ timeout: 15_000 });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const t = ((await chip.textContent().catch(() => "")) ?? "").trim();
    if (t.toUpperCase().includes("PAUSED")) break;
    if (/SYNCING|→|cursor|ERROR/i.test(t)) {
      log(`sync engine already live (${t}) — no resume beat needed`);
      return;
    }
    await page.waitForTimeout(500);
  }
  await chip.click();
  const t2 = ((await chip.textContent().catch(() => "")) ?? "").trim();
  log(`sync engine RESUMED on camera (${t2 || "…"})`);
  await page.waitForTimeout(2_500); // let the walks start on camera
}

async function transcode(webm, mp4) {
  return new Promise((resolve) => {
    const ff = spawn("ffmpeg", ["-y", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "24", mp4], { stdio: "ignore" });
    ff.on("close", (code) => resolve(code === 0));
  });
}

// ---- VIDEO 1 — "empty wallet → player" (guided prompts) ----
async function guidedTake() {
  const ts = stamp();
  const outDir = path.join(RUNS, `demo72_guided_${ts}`);
  mkdirSync(outDir, { recursive: true });
  const lines = [];
  const log = (...a) => {
    const line = `[guided ${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`;
    console.log(line);
    lines.push(line);
  };
  let fork = null;
  const browser = await chromium.launch({ headless: true });
  try {
    log("fresh fork (bare — no onboarding; the AGENT does the entry chain)");
    fork = await startFork([], path.join(outDir, "manual_fork.log"));
    await primeAffection(log);
    const ctx = await browser.newContext({
      viewport: { width, height },
      recordVideo: { dir: outDir, size: { width, height } },
    });
    const page = await ctx.newPage();
    const stopConfirmers = startConfirmers(page, log);
    await page.goto(`${devUrl}/?rpc=${encodeURIComponent(rpc)}`, { waitUntil: "domcontentloaded" });
    await armHarness(page, log);
    await page.getByTestId("rail-deck").click();

    // the 70 law on camera: the engine starts PAUSED on a fork — resume it
    await resumeSyncEngine(page, log);

    // the preference contract, on camera: SPECIFIED identity → no further
    // confirmation; the agent runs the whole entry chain
    await page.getByTestId("onb-pref-name").pressSequentially("Atropa", { delay: 30 });
    await page.getByTestId("onb-pref-symbol").pressSequentially("ATRO", { delay: 30 });
    await page.waitForTimeout(1_200);
    await page.getByTestId("onboarding-agent-handoff").click();
    log("handoff: AGENT, ONBOARD ME (SPECIFIED — Atropa/ATRO)");
    await waitRunSettled(page, log, beatMinutes * 60_000, 4_000);
    const steps = ((await page.getByTestId("onboarding-steps").innerText().catch(() => "")) ?? "");
    log(`onboarding checklist after the chain:\n${steps}`);

    // beat 1 — the home QING claim (capture-at-create rides the agent path).
    // The prompt DEMANDS a real propose_plan call: take-2 variance had the
    // model narrate the plan in prose, end its turn, and believe it proposed
    // — the whole middle of the video degenerated. The recovery nudge below
    // is the belt-and-braces for the same variance class.
    await sendPrompt(page, log, "Claim our home QING now: create a venue wrapping your own LAU (MAP.New) and join it at the decoded address once it exists — our home base. DRYRUN first, then PROPOSE THE PLAN with propose_plan (an actual plan on the deck, NOT a prose description); I will approve it.");
    await waitRunSettled(page, log, beatMinutes * 60_000, 4_000);
    let homeQing = ((await page.getByTestId("passport-home-qing").textContent().catch(() => "")) ?? "").trim();
    if (!/0x[0-9a-fA-F]{4}/.test(homeQing)) {
      log(`home QING not claimed yet ("${homeQing}") — one recovery nudge`);
      await sendPrompt(page, log, "The home-QING plan never landed as an actual plan. Propose it NOW with propose_plan — steps: create_venue send=true on our LAU, then join_venue send=true (it resolves the venue the create just set, no address needed), then a get_state read — and wait; I will approve it on the deck.");
      await waitRunSettled(page, log, beatMinutes * 60_000, 4_000);
      homeQing = ((await page.getByTestId("passport-home-qing").textContent().catch(() => "")) ?? "").trim();
    }
    log(`passport home QING: ${homeQing}`);

    // beat 2 — settle the home venue (UNCONDITIONAL send: the 72-spec beat
    // wants the committed settle on camera — a conditional phrasing made the
    // 69-style agent honestly hold at zero bars and ask)
    await sendPrompt(page, log, "Settle our home venue (CHEON.Su) now: DRYRUN first to read the bars, then commit the settle (send=true) and report what changed from the receipt — first attendance tick, bounty, and the account-token drip.");
    await waitRunSettled(page, log, beatMinutes * 60_000, 4_000);

    // beat 3 — focus_map: the LIVE HECKE marker is the payoff frame
    await sendPrompt(page, log, "Focus the map on our home QING — it is brand new, show me its live HECKE coordinates on the atlas.");
    await waitRunSettled(page, log, beatMinutes * 60_000, 4_000);
    await page.waitForTimeout(5_000); // hold the payoff frame

    // beat 4 — the DSS: compact deploy (identity column, breadth auto-ack),
    // then the snipe (the Ⓐ approve leg CARDS — the confirmer shows the gate)
    const deployBtn = page.getByTestId("passport-dss-deploy");
    if ((await deployBtn.count()) > 0 && (await deployBtn.isVisible().catch(() => false))) {
      await deployBtn.click();
      log("DSS deploy clicked (identity column)");
      await expectText(page, "passport-dss", /0x[0-9a-fA-F]{4}/, 45_000).catch(() => log("WARN: bundler capture not confirmed visually"));
      await page.waitForTimeout(1_500);
    } else {
      log("passport deploy absent (already deployed?) — continuing to the snipe");
    }
    await sendPrompt(page, log, "Speak to the world: dss_snipe one short line about a new soul arriving (send=true — the exact-1 Ⓐ approve leg rides first automatically, then the snipe).");
    await waitRunSettled(page, log, beatMinutes * 60_000, 4_000);

    // NEW beat — the CHAT module is the surface (session 71): render-all
    // archive → RICH layout → the ⟳ refresh surfacing the landed snipe line
    // → ONE manual composer line (the follow-the-channel target + the toast)
    await page.getByTestId("rail-chat").click();
    await page.getByTestId("chat-panel").waitFor({ timeout: 15_000 });
    await expectText(page, "chat-head", "THE VOID", 15_000);
    const archCount = (await page.getByTestId("chat-line").count().catch(() => 0)) ?? 0;
    log(`CHAT module open — render-all archive painted (${archCount} lines)`);
    await page.waitForTimeout(3_000); // the IRC archive on camera
    await page.getByTestId("chat-layout-rich").click();
    await page.waitForTimeout(4_000); // the RICH switch is one heavy commit
    log("RICH layout on (sigils + soul ids + UTC stamps)");
    await page.getByTestId("chat-refresh").click();
    const handleLoc = page.getByTestId("chat-line-handle").filter({ hasText: "Atropa" });
    await handleLoc.first().waitFor({ timeout: 60_000 });
    log("the landed snipe line surfaced via the ⟳ refresh (handle Atropa)");
    await page.waitForTimeout(5_000); // hold the payoff frame
    const manualLine = "the flight deck is live — a new soul speaks";
    const cInput = page.getByTestId("composer-input");
    await cInput.click();
    await cInput.pressSequentially(manualLine, { delay: 16 });
    await page.waitForTimeout(800);
    await page.getByTestId("composer-send").click();
    await expectText(page, "composer-outcome", "sent", 30_000);
    log(`manual composer line sent on camera — the ✓ toast (target: ${(((await page.getByTestId("composer-route").textContent().catch(() => "")) ?? "").trim())})`);
    await page.waitForTimeout(4_000); // the toast on camera
    await page.getByTestId("rail-deck").click();
    await page.waitForTimeout(1_500);

    // beat 5 — the durable lesson
    await sendPrompt(page, log, "Journal the durable lesson from today's arrival (journal_note) — one line the next session should remember.");
    await waitRunSettled(page, log, beatMinutes * 60_000, 4_000);

    // the tail: final frame + transcript
    await page.waitForTimeout(4_000);
    await page.screenshot({ path: path.join(outDir, "final.png") });
    const chat = ((await page.getByTestId("agent-chat").innerText().catch(() => "")) ?? "");
    writeFileSync(path.join(outDir, "transcript.txt"), chat);
    stopConfirmers();
    const video = page.video();
    await ctx.close();
    log(`take done — ${chat.length} chars transcript`);
    // saveAs waits for the finalized file — video.path() + an immediate
    // ffmpeg spawn raced the flush (the session-69 first take's lesson)
    if (video !== null) {
      const webm = path.join(outDir, "source.webm");
      await video.saveAs(webm);
      const ok = await transcode(webm, path.join(outDir, "video.mp4"));
      log(ok ? `VIDEO 1: ${path.join(outDir, "video.mp4")}` : "WARN: ffmpeg transcode failed (the .webm remains)");
    }
  } finally {
    writeFileSync(path.join(outDir, "log.txt"), lines.join("\n") + "\n");
    await browser.close();
    if (!keepFork || takeArg !== "guided") await stopFork(fork?.child ?? null);
    else if (fork !== null) log(`fork left running (--keep-fork) — kill by PID when done`);
  }
}

// ---- VIDEO 2 — "the aged account goes full-auto" ----
async function fullautoTake() {
  const ts = stamp();
  const outDir = path.join(RUNS, `demo72_fullauto_${ts}`);
  mkdirSync(outDir, { recursive: true });
  const lines = [];
  const log = (...a) => {
    const line = `[fullauto ${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`;
    console.log(line);
    lines.push(line);
  };
  let fork = null;
  const browser = await chromium.launch({ headless: true });
  try {
    log("fresh fork (--aged-transfer: the app key IS an aged account — Beat lineage)");
    fork = await startFork(["--aged-transfer"], path.join(outDir, "manual_fork.log"));
    const ctx = await browser.newContext({
      viewport: { width, height },
      recordVideo: { dir: outDir, size: { width, height } },
    });
    const page = await ctx.newPage();
    const stopConfirmers = startConfirmers(page, log);
    await page.goto(`${devUrl}/?rpc=${encodeURIComponent(rpc)}`, { waitUntil: "domcontentloaded" });
    // per-run budget raised for the take (observed ~160k-420k/cycle +
    // KB-heavy venue cycles trip the default; the LOOP caps below are the
    // real fence) — faTokens at 1.5M so the CYCLE BACKSTOP (4) is the
    // on-camera ending, not the session token fence (the 72-spec ending)
    await armHarness(page, log, { faCycles: 4, faTokens: 1_500_000, maxTokens: 1_500_000 });
    await waitForSnapshot(page, log); // the aged identity resolves on camera
    await resumeSyncEngine(page, log); // the 70 law on camera here too
    await page.getByTestId("rail-deck").click();

    // ENGAGE — the kickoff cycle picks its own goal; we whisper-steer it
    await page.getByTestId("agent-fullauto").click();
    await expectText(page, "agent-chat", "FULL-AUTO engaged", 20_000);
    log("FULL-AUTO engaged (backstop 4 · token cap 1.5M)");
    const startedAt = Date.now();
    let whispered = false;
    let whispered2 = false;
    let whispered3 = false;
    let netClicked = false;
    let shot = 0;
    const shots = path.join(outDir, "shots");
    mkdirSync(shots, { recursive: true });

    for (;;) {
      await page.waitForTimeout(10_000);
      shot += 1;
      await page.screenshot({ path: path.join(shots, `t${String(shot).padStart(3, "0")}.png`) }).catch(() => {});
      const spend = ((await page.getByTestId("agent-spend").textContent().catch(() => "")) ?? "").trim();
      const processing = (await page.getByTestId("agent-processing").count().catch(() => 0)) ?? 0;
      log(`t+${Math.round((Date.now() - startedAt) / 1000)}s · ${spend} · ${processing > 0 ? "RUNNING" : "idle"}`);
      if (!whispered && Date.now() - startedAt >= whisperAt) {
        // WHISPER renders only while a run is BUSY — wait for it, never fall
        // back to EXEC (a manual send would interleave with the loop)
        const processing = (await page.getByTestId("agent-processing").count().catch(() => 0)) ?? 0;
        const whisperBtn = page.getByTestId("agent-whisper-send");
        if (processing > 0 && (await whisperBtn.count().catch(() => 0)) > 0) {
          const input = page.getByTestId("agent-input");
          await input.click();
          await input.pressSequentially(whisper, { delay: 14 });
          await whisperBtn.click();
          log(`whisper queued: "${whisper.slice(0, 60)}…"`);
          whispered = true;
        }
      }
      // whisper #2 — steer the cycle AFTER the Beat cycle to the committed
      // settle (the 72-spec beat; without it cycle 2 re-investigated the
      // parked create into the L2 not-view fence and the loop died early)
      if (whispered && !whispered2) {
        const cyclesDone = /(\d+) cycles? done/.exec(spend)?.[1];
        const processing = (await page.getByTestId("agent-processing").count().catch(() => 0)) ?? 0;
        const whisperBtn = page.getByTestId("agent-whisper-send");
        if (cyclesDone !== undefined && Number(cyclesDone) >= 1 && processing > 0 && (await whisperBtn.count().catch(() => 0)) > 0) {
          const input = page.getByTestId("agent-input");
          await input.click();
          await input.pressSequentially(whisper2, { delay: 14 });
          await whisperBtn.click();
          log(`whisper #2 queued (cycle ${Number(cyclesDone) + 1}): "${whisper2.slice(0, 60)}…"`);
          whispered2 = true;
        }
      }
      // whisper #3 — park the dead home-QING line for good (cycle 3 kept
      // re-probing the aged LAU's not-views and the L2 streak fence ended
      // the loop early twice); steer to a zero-send map/journal cycle so
      // the CYCLE BACKSTOP is the on-camera ending
      if (whispered2 && !whispered3) {
        const cyclesDone = /(\d+) cycles? done/.exec(spend)?.[1];
        const processing = (await page.getByTestId("agent-processing").count().catch(() => 0)) ?? 0;
        const whisperBtn = page.getByTestId("agent-whisper-send");
        if (cyclesDone !== undefined && Number(cyclesDone) >= 2 && processing > 0 && (await whisperBtn.count().catch(() => 0)) > 0) {
          const input = page.getByTestId("agent-input");
          await input.click();
          await input.pressSequentially(whisper3, { delay: 14 });
          await whisperBtn.click();
          log(`whisper #3 queued (cycle ${Number(cyclesDone) + 1}): "${whisper3.slice(0, 60)}…"`);
          whispered3 = true;
        }
      }
      // the wall-clock SAFETY NET (backstop only — the clean disengage button,
      // never STOP): arms once, the current run still finishes on camera
      if (!netClicked && Date.now() - startedAt >= faMinutes * 60_000) {
        await page.getByTestId("agent-fullauto").click().catch(() => {});
        netClicked = true;
        log(`wall-clock net at ${faMinutes}min — clean disengage requested (run finishes)`);
      }
      const chatText = ((await page.getByTestId("agent-chat").innerText().catch(() => "")) ?? "");
      if (chatText.includes("FULL-AUTO disengaged")) {
        log("the loop disengaged ON CAMERA — holding the final frame");
        await page.waitForTimeout(6_000);
        break;
      }
      if (Date.now() - startedAt > (faMinutes + 6) * 60_000) {
        log("WARN: overrun past the net + grace — stopping the take");
        break;
      }
    }

    await page.screenshot({ path: path.join(outDir, "final.png") });
    const chat = ((await page.getByTestId("agent-chat").innerText().catch(() => "")) ?? "");
    writeFileSync(path.join(outDir, "transcript.txt"), chat);
    stopConfirmers();
    const video = page.video();
    await ctx.close();
    log(`take done — ${chat.length} chars transcript`);
    if (video !== null) {
      const webm = path.join(outDir, "source.webm");
      await video.saveAs(webm); // waits for the finalized file
      const ok = await transcode(webm, path.join(outDir, "video.mp4"));
      log(ok ? `VIDEO 2: ${path.join(outDir, "video.mp4")}` : "WARN: ffmpeg transcode failed (the .webm remains)");
    }
  } finally {
    writeFileSync(path.join(outDir, "log.txt"), lines.join("\n") + "\n");
    await browser.close();
    await stopFork(fork?.child ?? null);
  }
}

try {
  if (takeArg === "guided" || takeArg === "both") await guidedTake();
  if (takeArg === "fullauto" || takeArg === "both") await fullautoTake();
} finally {
  if (devProc !== null) process.kill(-devProc.pid, "SIGKILL"); // the whole group
}
console.log("demo capture complete");
