import react from "@vitejs/plugin-react";
import fs from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";

/**
 * The dev/test-only secret channel (session-45, the `.env` rule): parses
 * `app/.env` SERVER-SIDE and serves the bare (never VITE_-prefixed) vars
 * through `virtual:dys-dev-env`. Active ONLY when command === "serve" —
 * the dev server and vitest — a production build resolves the module to an
 * empty object, so the key structurally cannot reach dist/. The no-secrets
 * gate (test/noSecrets.test.ts) proves both halves end-to-end: .env is
 * gitignored, and a fresh build never contains the key string.
 */
function dysDevEnv(): Plugin {
  const VIRTUAL = "virtual:dys-dev-env";
  let serving = false;
  return {
    name: "dys-dev-env",
    configResolved(cfg) {
      serving = cfg.command === "serve";
    },
    resolveId(id) {
      if (id === VIRTUAL) return "\0" + VIRTUAL;
      return undefined;
    },
    load(id) {
      if (id !== "\0" + VIRTUAL) return undefined;
      if (!serving) return "export const DEV_ENV = {};";
      const out: Record<string, string> = {};
      try {
        const envPath = fileURLToPath(new URL("./.env", import.meta.url));
        if (fs.existsSync(envPath)) {
          for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
            if (line.trim().startsWith("#")) continue;
            const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
            // bare names only — VITE_* would be inlined into the bundle
            if (m && !m[1]!.startsWith("VITE_") && m[2]!.length > 0) out[m[1]!] = m[2]!;
          }
        }
      } catch {
        /* no .env — empty is the honest dev state */
      }
      return `export const DEV_ENV = ${JSON.stringify(out)};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), dysDevEnv()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@config": fileURLToPath(new URL("../config", import.meta.url)),
      "@abi": fileURLToPath(new URL("../abi", import.meta.url)),
      "@data": fileURLToPath(new URL("../data", import.meta.url)),
    },
  },
  // unit tests only — playwright owns e2e/*.spec.ts
  test: {
    include: ["test/**/*.test.ts"],
  },
  server: {
    fs: {
      allow: [fileURLToPath(new URL("..", import.meta.url))],
    },
  },
  build: {
    rollupOptions: {
      output: {
        // the 3.8MB-single-chunk lesson: vendor graph split, and the agent
        // deck's LangGraph dependency rides its own chunk away from core
        manualChunks(id) {
          if (id.includes("node_modules/@langchain/") || id.includes("node_modules/langgraph/") || id.includes("node_modules/langsmith")) {
            return "vendor-langgraph";
          }
          if (id.includes("node_modules/react-dom/") || id.includes("node_modules/react/") || id.includes("node_modules/scheduler/")) {
            return "vendor-react";
          }
          if (id.includes("node_modules/viem/") || id.includes("node_modules/abitype/") || id.includes("node_modules/ox/")) {
            return "vendor-viem";
          }
          return undefined;
        },
      },
    },
  },
});
