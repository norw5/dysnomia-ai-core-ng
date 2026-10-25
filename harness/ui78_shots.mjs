#!/usr/bin/env node
// harness/ui78_shots.mjs — session-78 review evidence (UI-ONLY tooling).
// Opens the real app at the owner's three widths and screenshots the
// retouched surfaces (STUDIO, MAP, the centered pages, LEARN dev docs).
//
// Usage: node harness/ui78_shots.mjs --tag before|after [--url http://127.0.0.1:5173]

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, "..", "app");
const pw = await import(pathToFileURL(path.join(APP, "node_modules", "playwright", "index.mjs")).href);

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const URL = arg("--url", "http://127.0.0.1:5173");
const TAG = arg("--tag", "before");
const OUT = path.join(HERE, "runs", `ui78_evidence_20261025_${TAG}`);
fs.mkdirSync(OUT, { recursive: true });

const TARGET = `${URL}/?rpc=http://127.0.0.1:9999`;
const RAIL = {
  deck: "rail-deck",
  identity: "rail-identity",
  market: "rail-market",
  directory: "rail-directory",
  learn: "rail-learn",
  studio: "rail-studio",
  settings: "rail-settings",
  map: "rail-map",
  chat: "rail-chat",
};
const VIEWS = ["identity", "market", "directory", "studio", "learn", "settings", "map", "chat", "deck"];
const WIDTHS = [
  { name: "1920x1200", width: 1920, height: 1200 },
  { name: "1600x1000", width: 1600, height: 1000 },
  { name: "430x900", width: 430, height: 900 },
];

const browser = await pw.chromium.launch();
const errors = [];
for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${w.name}: ${e.message}`));
  await page.goto(TARGET, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  for (const v of VIEWS) {
    await page.getByTestId(RAIL[v]).click();
    await page.waitForTimeout(v === "chat" ? 4500 : v === "map" ? 1800 : 700);
    await page.screenshot({ path: path.join(OUT, `${w.name}_${v}.png`), fullPage: false });
    if (v === "studio") {
      const el = await page.getByTestId("view-studio");
      await el.screenshot({ path: path.join(OUT, `${w.name}_studio_full.png`) }).catch(() => {});
    }
    if (v === "map") {
      const el = await page.getByTestId("map-stage");
      await el.screenshot({ path: path.join(OUT, `${w.name}_map_stage.png`) }).catch(() => {});
    }
  }
  // LEARN dev reference, if present
  await page.getByTestId("rail-learn").click();
  await page.waitForTimeout(500);
  const devTab = page.getByTestId("learn-source-dev");
  if ((await devTab.count()) > 0) {
    await devTab.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `${w.name}_learn_dev.png`) });
  }
  await ctx.close();
}
await browser.close();
console.log(`saved ${OUT}`);
if (errors.length > 0) {
  console.error("PAGE ERRORS:", errors.join("\n"));
  process.exitCode = 1;
}
