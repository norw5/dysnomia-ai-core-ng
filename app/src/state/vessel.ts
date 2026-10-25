import { useCallback, useSyncExternalStore } from "react";
import { isLocalForkRpc } from "@/chain/rpc";
import { simEntryEnabled } from "@/chain/simMode";

/**
 * The fleet vessel channel (session-60, the multi-agent demo substrate): a
 * per-context accent + craft CALLSIGN for the app instance — "each agent is
 * the research vessel you explore Dysnomia with; four vessels = a fleet".
 *
 * THE LAW (owner round at the 59 close, recorded as the DESIGN.md amendment):
 * amber stays the shipped default + system chrome, and the per-agent accent
 * override is a SIM/DEMO-SCOPED affordance — it applies only under the
 * session-58 runtime-composite rule (DEV ∨ VITE_ENABLE_SIM_MODE=1) ∧ the
 * active RPC is a loopback local fork. On a live RPC (or in a
 * production build without the flag) the override NEVER lands — the chrome
 * stays amber and the callsign stays ATROPA-999 / RESEARCH_VESSEL. Purple is
 * not part of the accent family at all: it stays AI-core-only under every
 * vessel.
 *
 * The accent family lives in styles.css (`--accent*` + per-vessel
 * `:root[data-vessel]` blocks); this store only resolves WHICH vessel is
 * active and mirrors it onto `document.documentElement.dataset.vessel`.
 */

export interface VesselPreset {
  id: string;
  /** header brand line 1 (the craft's callsign) */
  callsign: string;
  /** header brand line 2 (the craft's role) */
  role: string;
  /** informational hex mirror of the CSS accent block (canvas draws need it) */
  accent: string;
}

export const DEFAULT_VESSEL_ID = "atropa";

/** the shipped default — the unchanged chrome (amber by law) */
export const DEFAULT_VESSEL: VesselPreset = {
  id: DEFAULT_VESSEL_ID,
  callsign: "ATROPA-999",
  role: "RESEARCH_VESSEL",
  accent: "#ffb000",
};

/**
 * The fleet registry (extends with the multi-agent arc — the flagship 2v2 +
 * 2 solo roster lands its final names then). Mirrors the CSS blocks in
 * styles.css; the corpus test pins the two sides together.
 */
export const FLEET_VESSELS: VesselPreset[] = [
  DEFAULT_VESSEL,
  { id: "vitruv", callsign: "VITRUV-3", role: "FLEET_ARCHITECT", accent: "#00f0ff" },
  { id: "kestrel", callsign: "KESTREL-7", role: "SALVAGE_TRADER", accent: "#00ff41" },
  { id: "meridian", callsign: "MERIDIAN-5", role: "ENVOY_CRAFT", accent: "#ffd24d" },
  { id: "parallax", callsign: "PARALLAX-2", role: "SURVEY_PROBE", accent: "#d7d7d7" },
];

const KEY = "dys.vessel.v1";

let storedId: string | null = load();
let applied: VesselPreset = DEFAULT_VESSEL;
const listeners = new Set<() => void>();

function load(): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw !== null && FLEET_VESSELS.some((v) => v.id === raw) ? raw : null;
  } catch {
    return null;
  }
}

function persist(): void {
  try {
    if (storedId === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, storedId);
  } catch {
    /* storage unavailable */
  }
}

function notify(): void {
  for (const fn of listeners) fn();
}

/** the composite gate — the SAME law the SIM layer rides (session-58) */
export function vesselOverrideAllowed(rpcUrl: string): boolean {
  return simEntryEnabled && isLocalForkRpc(rpcUrl);
}

/** the stored operator choice (persisted; applies only under the gate) */
export function vesselChoice(): string | null {
  return storedId;
}

/** the `?vessel=<id>` dev override (dev builds only; never persisted) */
export function readQueryVessel(): string | null {
  if (!import.meta.env.DEV) return null;
  try {
    const v = new URLSearchParams(window.location.search).get("vessel");
    return v !== null && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the ACTIVE vessel for an RPC: the query override (dev) wins over
 * the stored choice; both only apply under the sim/demo gate — anything
 * else, any unknown id, resolves to the default chrome.
 */
export function resolveVessel(rpcUrl: string): VesselPreset {
  if (!vesselOverrideAllowed(rpcUrl)) return DEFAULT_VESSEL;
  const wanted = readQueryVessel() ?? storedId;
  if (wanted === null) return DEFAULT_VESSEL;
  return FLEET_VESSELS.find((v) => v.id === wanted) ?? DEFAULT_VESSEL;
}

/** is an override actually theming this instance right now? */
export function vesselThemed(): boolean {
  return applied.id !== DEFAULT_VESSEL_ID;
}

/** the currently APPLIED vessel (what the chrome + canvases draw) */
export function activeVessel(): VesselPreset {
  return applied;
}

/**
 * Apply the resolved vessel to the document root (`data-vessel`) — App calls
 * this at boot and whenever the RPC changes. Outside the gate this REMOVES
 * the attribute: live chrome is structurally amber.
 */
export function applyVessel(rpcUrl: string): VesselPreset {
  applied = resolveVessel(rpcUrl);
  try {
    const el = document.documentElement;
    if (applied.id === DEFAULT_VESSEL_ID) delete el.dataset.vessel;
    else el.dataset.vessel = applied.id;
  } catch {
    /* no document (tests) */
  }
  notify();
  return applied;
}

/** set (or clear) the stored operator choice; re-applies for the given rpc */
export function setVesselChoice(id: string | null, rpcUrl: string): VesselPreset {
  storedId = id !== null && FLEET_VESSELS.some((v) => v.id === id) ? id : null;
  persist();
  return applyVessel(rpcUrl);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const subscribeVessel = subscribe;

export function useVessel(): VesselPreset {
  return useSyncExternalStore(subscribe, activeVessel, activeVessel);
}

export function useVesselDispatch(): { set: (id: string | null, rpcUrl: string) => void } {
  const set = useCallback((id: string | null, rpcUrl: string) => {
    setVesselChoice(id, rpcUrl);
  }, []);
  return { set };
}
