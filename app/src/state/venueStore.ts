import { useCallback, useSyncExternalStore } from "react";

/**
 * The unified QING sidebar's data + app-global selection store (IA-PLAN §3):
 * ONE "current venue" that every view (MAP/CHAT/DIRECTORY/MARKET) and the
 * agent read/write through the same handle. Seed = data/venue_seed.slim.json
 * (s32-exact, generated — never hand-edited; the session-70 regen walks
 * MAP.NewQing, so the count moves with the chain).
 */

export interface VenueRow {
  /** venue (QING) address */
  a: string;
  /** onchain-probed name (empty string = nameless onchain) */
  n: string;
  /** symbol */
  s: string;
  /** folded normalized latitude (-1..1; lat2 raw ints live only in the full atlas) */
  lat: number;
  /** HECKE meridian band */
  band: number;
  /** creation block */
  blk: number;
}

export interface VenueSeedDoc {
  _meta: { count: number; source: string; note: string };
  venues: VenueRow[];
}

const KEY = "dys.venue.v1";

let current: VenueRow | null = load();
const listeners = new Set<() => void>();

function load(): VenueRow | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as VenueRow) : null;
  } catch {
    return null;
  }
}

function persist(): void {
  try {
    if (current) window.localStorage.setItem(KEY, JSON.stringify(current));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export function currentVenue(): VenueRow | null {
  return current;
}

export function setCurrentVenue(v: VenueRow | null): void {
  current = v;
  persist();
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** public for tests + the React binding below */
export const subscribeCurrentVenue = subscribe;

export function useCurrentVenue(): { current: VenueRow | null; setCurrent: (v: VenueRow | null) => void } {
  const value = useSyncExternalStore(subscribe, currentVenue, currentVenue);
  const setCurrent = useCallback((v: VenueRow | null) => setCurrentVenue(v), []);
  return { current: value, setCurrent };
}

export interface VenueSearchResult {
  rows: VenueRow[];
  total: number;
}

/** Pure search over the seed: case-insensitive substring on name/symbol/address (band = exact). */
export function searchVenues<T extends VenueRow>(seed: T[], query: string, limit = 60): { rows: T[]; total: number } {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return { rows: seed.slice(0, limit), total: seed.length };
  const hits: T[] = [];
  for (const v of seed) {
    if (
      v.n.toLowerCase().includes(q) ||
      v.s.toLowerCase().includes(q) ||
      v.a.toLowerCase().includes(q) ||
      String(v.band) === q
    ) {
      hits.push(v);
    }
  }
  return { rows: hits.slice(0, limit), total: hits.length };
}
