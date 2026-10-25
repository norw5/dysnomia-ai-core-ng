import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The no-secrets gate (session-45, the .env lesson + owner rule):
 *  (1) `app/.env` (and friends) are gitignored — the patterns must exist;
 *  (2) the OPENROUTER_API_KEY string NEVER appears in a production build.
 * The build half runs a REAL `vite build` into a throwaway outDir whenever
 * a key is present, then greps every emitted byte — the dev-env plugin can
 * only serve secrets when command === "serve", and this proves it.
 */

const APP_ROOT = join(__dirname, "..");
const REPO_ROOT = join(APP_ROOT, "..");

function readEnvKey(): string | null {
  const envPath = join(APP_ROOT, ".env");
  if (!existsSync(envPath)) return null;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^\s*OPENROUTER_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
    if (m && m[1]!.length > 0) return m[1]!;
  }
  return null;
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...collectFiles(p));
    else out.push(p);
  }
  return out;
}

describe("no-secrets gate", () => {
  it(".gitignore carries .env and .env.* (the repo-level rule)", () => {
    const gitignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
    const lines = gitignore.split("\n").map((l) => l.trim());
    expect(lines).toContain(".env");
    expect(lines).toContain(".env.*");
  });

  it("app/.env.example documents the OPENROUTER_API_KEY convention and the never-VITE rule", () => {
    const example = readFileSync(join(APP_ROOT, ".env.example"), "utf8");
    expect(example).toContain("OPENROUTER_API_KEY=");
    expect(example).toContain("VITE_");
    expect(example.toLowerCase()).toContain("never commit");
  });

  it(
    "a VITE_-prefixed var could never ride the dev-env channel (parser refuses it)",
    async () => {
      // the plugin's parser skips VITE_* — assert via the module shape: DEV_ENV
      // never contains VITE_-prefixed entries even when .env has one
      const envPath = join(APP_ROOT, ".env");
      const before = existsSync(envPath) ? readFileSync(envPath, "utf8") : null;
      try {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(envPath, `${before ?? ""}\nVITE_POISON_TEST=secret-poison-value\n`);
        // re-import a FRESH copy of the virtual module via the plugin transform
        const { createServer } = await import("vite");
        const server = await createServer({ configFile: join(APP_ROOT, "vite.config.ts"), mode: "development", logLevel: "silent" });
        const mod = (await server.ssrLoadModule("virtual:dys-dev-env")) as { DEV_ENV: Record<string, string> };
        await server.close();
        expect(mod.DEV_ENV["VITE_POISON_TEST"]).toBeUndefined();
      } finally {
        const { writeFileSync } = await import("node:fs");
        if (before === null) execFileSync("rm", [envPath]);
        else writeFileSync(envPath, before);
      }
    },
    120_000
  );

  it(
    "the OPENROUTER_API_KEY never appears in a production build when .env exists",
    () => {
      const key = readEnvKey();
      if (key === null) {
        // no key on this box — still prove a build contains no stale dist secrets
        const dist = join(APP_ROOT, "dist");
        if (!existsSync(dist)) return;
        for (const f of collectFiles(dist)) {
          expect(readFileSync(f, "utf8").includes("OPENROUTER_API_KEY="), `${f} mentions the env var name`).toBe(false);
        }
        return;
      }
      const outDir = "dist-nosecrets-check";
      const outPath = join(APP_ROOT, outDir);
      execFileSync("npx", ["-y", "vite@6", "build", `--outDir=${outDir}`, "--emptyOutDir"], {
        cwd: APP_ROOT,
        timeout: 240_000,
        stdio: "pipe",
      });
      try {
        const files = collectFiles(outPath);
        expect(files.length).toBeGreaterThan(0);
        for (const f of files) {
          expect(readFileSync(f, "utf8").includes(key), `SECRET LEAK: ${f} contains the OpenRouter key`).toBe(false);
        }
      } finally {
        execFileSync("rm", ["-rf", outPath]);
      }
    },
    300_000
  );
});
