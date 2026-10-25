import { KNOWN_MAINNET_RPC } from "@config/addresses";

export type RpcSource = "query" | "settings" | "default";

export interface ResolvedRpc {
  url: string;
  source: RpcSource;
}

const SETTINGS_KEY = "dys.rpc.custom";

function normalize(u: string): string {
  return u.trim().replace(/\/+$/, "");
}

export function readSettingsRpc(): string | null {
  try {
    const v = window.localStorage.getItem(SETTINGS_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function writeSettingsRpc(url: string | null): void {
  try {
    if (url === null || url.trim().length === 0) window.localStorage.removeItem(SETTINGS_KEY);
    else window.localStorage.setItem(SETTINGS_KEY, url.trim());
  } catch {
    /* storage unavailable */
  }
}

export function readQueryRpc(): string | null {
  if (!import.meta.env.DEV) return null;
  const v = new URLSearchParams(window.location.search).get("rpc");
  return v && v.length > 0 ? v : null;
}

export function resolveRpc(): ResolvedRpc {
  const q = readQueryRpc();
  if (q) return { url: q, source: "query" };
  const s = readSettingsRpc();
  if (s) return { url: s, source: "settings" };
  return { url: KNOWN_MAINNET_RPC[0] ?? "https://rpc.pulsechain.com", source: "default" };
}

/**
 * SIM PREDICATE LAW (session-81): SIM is a LOOPBACK anvil fork, never "any
 * URL that is not one of the known mainnet endpoints". The old denylist
 * classified a user's own real node (or any provider) as SIM — wrong for the
 * public build (header SIM, paused sync, vessel override, layer panels).
 *
 * The allowlist is deliberately narrow: localhost/loopback hosts only. A
 * custom real RPC is LIVE; the deploy panel adds the stronger fork checks
 * (chain id, anvil, perimeter code) before any `anvil_*` call.
 */
export function isLocalForkRpc(url: string): boolean {
  let host: string;
  try {
    host = new URL(normalize(url)).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
  // IPv4 loopback is 127.0.0.0/8 (127.0.0.2 etc. are valid local binds)
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** normalized RPC key for overlay persistence (trailing slashes folded) */
export function normalizeRpcUrl(url: string): string {
  return normalize(url);
}

export function rpcHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
