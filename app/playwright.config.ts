import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  retries: 0,
  // the dead-RPC specs lean on viem's retry backoff — under many parallel
  // workers the 30s timeout flakes on contention (found session-47; 2 is green)
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
