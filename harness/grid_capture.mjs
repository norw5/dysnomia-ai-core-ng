#!/usr/bin/env node
// harness/grid_capture.mjs — the session-62 grid capture (62.1 rework; the
// session-63 SYS-arming re-pin).
//
// Capture tooling ONLY (no app code): launches ONE observer instance per
// RECORDING ROSTER VESSEL (`?vessel=<id>` + the fork's `?rpc=`), imports
// that roster agent's LOCAL-FORK key (wallet mode B — the identity column
// + ledger go LIVE with the agent's own LAU/YUE/balances), then ARMS the
// REPLAY through the SYS tab (the off-deck operator surface since 63),
// switches the pane to CORE (the recorded conversation), sets the
// PER-AGENT transcript filter, and plays at the narrative clock (1×
// default); playwright records each instance and ffmpeg tiles.
//
// A single-agent recording (the --solo-demo) produces ONE full-frame video
// (no tile). Usage:
//   python3 harness/agent_runner.py --flagship --keep     # or --solo-demo --keep
//   node harness/grid_capture.mjs --recording harness/runs/<run>/recording.json \
//        --manifest  harness/runs/<run>/fleet_manifest.json \
//        [--rpc http://127.0.0.1:8547] [--dev-url http://127.0.0.1:5173] \
//        [--seconds 150] [--speed 1] [--width 1600] [--height 1000]
//
// The dev server is spawned when --dev-url is not answering, and stopped
// when this script owned it. Output: harness/runs/grid_<ts>/ (grid.mp4 or
// solo.mp4 + the per-vessel .webm sources).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "..");
const APP = path.join(ROOT, "app");
const RUNS = path.join(HERE, "runs");

// resolve playwright from the app's node_modules (the repo root has none)
const pw = await import(pathToFileURL(path.join(APP, "node_modules", "playwright", "index.mjs")).href);
const { chromium } = pw;

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : d;
};
const recording = arg("recording", null);
const manifest = arg("manifest", null);
if (recording === null || !existsSync(recording)) {
  console.error("--recording <path> is required (the run's recording.json)");
  process.exit(1);
}
if (manifest === null || !existsSync(manifest)) {
  console.error("--manifest <path> is required (the run's fleet_manifest.json — the roster keys are local-fork burners)");
  process.exit(1);
}
const rpc = arg("rpc", "http://127.0.0.1:8547");
const devUrl = arg("dev-url", "http://127.0.0.1:5173");
const seconds = Math.max(10, Number(arg("seconds", 150)));
const speed = Number(arg("speed", 1));
const width = Math.max(1024, Number(arg("width", 1600)));
const height = Math.max(700, Number(arg("height", 1000)));

const recText = readFileSync(recording, "utf8");
const rec = JSON.parse(recText);
const manifestDoc = JSON.parse(readFileSync(manifest, "utf8"));
const keyByAgent = new Map((manifestDoc.roster ?? []).map((r) => [r.name, r.key]));
const roster = rec.roster;
if (roster.length === 0) {
  console.error("the recording carries no roster — nothing to capture");
  process.exit(1);
}

// ---- the dev server (spawn when not answering) ----
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
    detached: false,
  });
  if (!(await waitHttp(devUrl, 60_000))) {
    console.error("the dev server did not come up");
    if (devProc !== null) devProc.kill("SIGKILL");
    process.exit(1);
  }
}

const ts = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const outDir = path.join(RUNS, `grid_${ts}`);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const jobs = roster.map(async (row, idx) => {
  const dir = path.join(outDir, `src_${row.vessel}`);
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width, height },
    recordVideo: { dir, size: { width, height } },
  });
  const page = await ctx.newPage();
  // fresh storage seeds the 63 default slot map (onboarding/map/spine/chat)
  // — the replay re-feeds onto it through the deck's routing
  await page.goto(`${devUrl}/?rpc=${encodeURIComponent(rpc)}&vessel=${row.vessel}`, { waitUntil: "domcontentloaded" });

  // live identity: import the roster agent's LOCAL-FORK key (mode B) so the
  // identity column + ledger render THIS agent's onchain state
  const key = keyByAgent.get(row.name) ?? null;
  if (key !== null) {
    try {
      await page.getByTestId("rail-settings").click();
      await page.getByTestId("mode-b").click();
      await page.getByTestId("import-priv").fill(key);
      await page.getByTestId("import-btn").click();
      await page.getByTestId("wallet-account").waitFor({ timeout: 10_000 });
      await page.getByTestId("rail-deck").click();
      console.log(`[${row.vessel}] wallet imported (${row.name})`);
    } catch (e) {
      console.warn(`[${row.vessel}] key import skipped: ${String(e).slice(0, 120)}`);
    }
  }

  // arm the replay through the SYS tab (the off-deck operator surface —
  // real users never see fleet machinery; the dock is open by default)
  await page.getByTestId("agent-tab-sys").click();
  await page.getByTestId("sys-fleet-load").setInputFiles({
    name: "recording.json",
    mimeType: "application/json",
    buffer: Buffer.from(recText, "utf8"),
  });
  await page.getByTestId("sys-fleet-table").waitFor({ timeout: 20_000 });
  await page.getByTestId("sys-fleet-replay").click();
  // the recorded conversation lives on CORE; the slim header strip carries
  // the transport
  await page.getByTestId("agent-tab-core").click();
  await page.getByTestId("replay-strip").waitFor({ timeout: 10_000 });
  if (roster.length > 1) {
    await page.getByTestId("replay-filter").selectOption(row.name); // this cell tells ONE vessel's story
  }
  await page.getByTestId(`replay-speed-${String(speed).replace(".", "-")}`).click();
  await page.getByTestId("replay-play").click();
  console.log(`[${row.vessel}] replaying ${row.name} at ${speed}× …`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const v = page.video();
  await ctx.close();
  return v !== null ? v.path() : null;
});

const videos = (await Promise.all(jobs)).filter((p) => p !== null && existsSync(p));
await browser.close();
if (devProc !== null) devProc.kill("SIGKILL");
console.log(`captured ${videos.length}/${roster.length} instance videos in ${outDir}`);
if (videos.length === 0) {
  console.error("no instance videos — aborting");
  process.exit(1);
}

// ---- the tile (2×2 for the fleet, plain transcode for a solo run) ----
const out = path.join(outDir, videos.length === 1 ? "solo.mp4" : "grid.mp4");
const common = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "24"];
if (videos.length === 1) {
  const ff = spawn("ffmpeg", ["-y", "-i", videos[0], ...common, out], { stdio: "inherit" });
  ff.on("close", (code) => {
    if (code === 0) console.log(`SOLO: ${out}`);
    else process.exit(code ?? 1);
  });
} else {
  const filter = [
    ...videos.map((_, i) => `[${i}:v]scale=${width}:${height},setsar=1[v${i}]`),
    "[v0][v1]hstack=inputs=2[top]",
    "[v2][v3]hstack=inputs=2[bottom]",
    "[top][bottom]vstack=inputs=2:shortest=1[out]",
  ].join(";");
  const args = [...videos.flatMap((v) => ["-i", v]), "-filter_complex", filter, "-map", "[out]", ...common, out];
  const ff = spawn("ffmpeg", ["-y", ...args], { stdio: "inherit" });
  ff.on("close", (code) => {
    if (code === 0) console.log(`GRID: ${out}`);
    else process.exit(code ?? 1);
  });
}
