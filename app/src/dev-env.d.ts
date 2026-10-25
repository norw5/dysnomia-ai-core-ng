/**
 * The dev/test-only secret channel (session-45). `virtual:dys-dev-env` is
 * served by the dys-dev-env plugin in vite.config.ts: it parses `app/.env`
 * SERVER-SIDE and only when command === "serve" (dev server + vitest) — a
 * production build gets a structurally empty object, so nothing from .env
 * can ever reach dist/. Bare names only: the parser refuses VITE_* (Vite
 * inlines those into the bundle — the exact trap this indirection avoids).
 */
declare module "virtual:dys-dev-env" {
  export const DEV_ENV: Record<string, string>;
}
