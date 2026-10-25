import fs from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";

/**
 * The headless fleet runner build (session 61): bundles src/runner/entry.ts
 * — the SAME app agent stack (graph + tool catalog + tx gate) — into ONE
 * self-contained node ESM file at harness/runner/entry.mjs for the python
 * harbormaster to spawn. This is a HARNESS artifact, never the shipped app:
 *  - output lives under harness/ (outside app/dist — the no-secrets gate
 *    greps dist/), and the dev-env virtual module resolves EMPTY here (the
 *    OpenRouter key rides the spawning process env, never the bundle);
 *  - the SIM composite gate is compiled ON (import.meta.env.DEV true — this
 *    is a dev-context harness driving a local fork, exactly the §8 rule).
 */

function dysDevEnv(): Plugin {
  const VIRTUAL = "virtual:dys-dev-env";
  return {
    name: "dys-dev-env",
    resolveId(id) {
      if (id === VIRTUAL) return "\0" + VIRTUAL;
      return undefined;
    },
    load(id) {
      if (id !== "\0" + VIRTUAL) return undefined;
      return "export const DEV_ENV = {};";
    },
  };
}

const root = fileURLToPath(new URL(".", import.meta.url));
const outDir = fileURLToPath(new URL("../harness/runner", import.meta.url));

// keep the harness dir tidy: vite wants to write relative to root
fs.mkdirSync(outDir, { recursive: true });

export default defineConfig({
  plugins: [dysDevEnv()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@config": fileURLToPath(new URL("../config", import.meta.url)),
      "@abi": fileURLToPath(new URL("../abi", import.meta.url)),
      "@data": fileURLToPath(new URL("../data", import.meta.url)),
    },
  },
  define: {
    "import.meta.env.DEV": "true",
    "import.meta.env.VITE_ENABLE_SIM_MODE": '"1"',
  },
  ssr: {
    // bundle EVERYTHING (viem, langgraph, react hooks pulled by the stores)
    // — the artifact must run with plain `node` from harness/runner/, no
    // node_modules resolution walking up from the harness tree
    noExternal: true,
  },
  build: {
    outDir,
    emptyOutDir: true,
    minify: false,
    ssr: "src/runner/entry.ts",
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "entry.mjs",
        chunkFileNames: "chunk-[name].mjs",
      },
    },
  },
});
