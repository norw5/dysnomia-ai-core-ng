#!/usr/bin/env node
// harness/ui_probe.mjs — the session-77 UI typing probe (UI-ONLY tooling;
// no app code, no chain calls). Reproduces the owner's "typing lag" report
// by driving the REAL app with CDP key events and watching the main thread
// (Long Task observer + requestAnimationFrame gaps) over the render-all
// chat corpus. The session-77 baseline is in docs/SESSION-LOG.md.
//
// Usage:
//   cd app && npm run dev -- --host 127.0.0.1 --port 5173   # in another shell
//   node harness/ui_probe.mjs [--url http://127.0.0.1:5173] [--rpc <url>]
//
// It enables the §7.4 chat opt-in via localStorage ONLY inside the probe
// browser context (never persisted for the operator). The numbers are dev-
// React relative — compare same-machine before/after, not absolutes.

import path from "node:path";
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
const RPC = arg("--rpc", null);
const TARGET = `${URL}${RPC !== null ? `?rpc=${encodeURIComponent(RPC)}` : ""}`;

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  localStorage.setItem("dys.agent.v1", JSON.stringify({ chatToolsEnabled: true }));
});
page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
await page.goto(TARGET, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.locator('[data-testid="rail-chat"]').click();
await page.waitForTimeout(6500);

const lines = await page.locator('[data-testid="chat-line"]').count();
console.log(`corpus: ${lines} mounted chat lines`);
const cdp = await ctx.newCDPSession(page);

const SAMPLE = "hello world this is a typing latency probe line".repeat(2);

async function measure(label, selector, text, settle = 500) {
  await page.evaluate(() => {
    window.__perf = { longtasks: [], frames: [], t0: 0 };
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__perf.longtasks.push(Math.round(e.duration));
      });
      po.observe({ entryTypes: ["longtask"] });
      window.__po = po;
    } catch {
      /* no long-task observer — frame gaps still count */
    }
  });
  const el = page.locator(selector).first();
  await el.click();
  await el.fill("").catch(() => {});
  await page.evaluate(() => {
    window.__perf.t0 = performance.now();
    const tick = () => {
      window.__perf.frames.push(performance.now());
      if (performance.now() - window.__perf.t0 < 3500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      text: chars[i],
      unmodifiedText: chars[i],
      key: chars[i],
      autoRepeat: i > 0,
    });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: chars[i], autoRepeat: i > 0 });
  }
  await page.waitForTimeout(settle);
  const res = await page.evaluate(() => {
    const p = window.__perf;
    let maxGap = 0;
    for (let i = 1; i < p.frames.length; i++) maxGap = Math.max(maxGap, p.frames[i] - p.frames[i - 1]);
    const sorted = p.longtasks.slice().sort((a, b) => a - b);
    return {
      longTasks: p.longtasks.length,
      longTotalMs: p.longtasks.reduce((a, b) => a + b, 0),
      longMaxMs: p.longtasks.length ? sorted[sorted.length - 1] : 0,
      longP50Ms: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
      maxFrameGapMs: Math.round(maxGap),
      frames: p.frames.length,
    };
  });
  console.log(`${label.padEnd(26)} ${JSON.stringify(res)}`);
}

await measure("agent input", '[data-testid="agent-input"]', SAMPLE);
await measure("composer IRC", '[data-testid="composer-input"]', SAMPLE);
await page.locator('[data-testid="chat-layout-rich"]').click();
await page.waitForTimeout(2600);
await measure("composer RICH", '[data-testid="composer-input"]', SAMPLE);
await page.locator('[data-testid="chat-search-input"]').fill("the");
await page.waitForTimeout(1200);
console.log(`search settled: ${await page.locator('[data-testid="chat-search-count"]').innerText()}`);
await measure("composer + search active", '[data-testid="composer-input"]', SAMPLE);
await measure("search typing", '[data-testid="chat-search-input"]', "souls", 700);

await browser.close();
