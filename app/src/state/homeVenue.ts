import { useEffect, useState, useSyncExternalStore } from "react";
import type { Address } from "viem";
import { qingForAsset } from "@/state/atlas";

/**
 * The home-QING store (session-65, the owner's feature round): the venue a
 * player created by wrapping their OWN LAU (MAP.New(your LAU)). One QING per
 * asset EVER planet-wide and the LAU is uniquely yours → the venue is
 * uniquely yours, forever — a one-way claim with no chain-side getter
 * (MAP exposes no asset→QING index), so the app carries it the way it
 * carries the pending LAU: captured at the creating SEND (agent
 * create_venue + the manual CreateVenueCard) and persisted per account.
 *
 * Sibling of the "current venue" selection (state/venueStore) — the two are
 * independent: focusing another venue never loses your home.
 */

const KEY = "dys.homeVenue.v1";

export interface HomeVenueRecord {
  /** the created QING (MAP.New receipt decode) */
  venue: Address;
  /** the wrapped asset — the account's LAU at creation time */
  asset: Address;
  /** the drawn coordinate (NewQing data word) */
  waat: string;
  txHash: string | null;
  t: number;
}

type HomeMap = Record<string, HomeVenueRecord>;

function load(): HomeMap {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as HomeMap;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

let homes: HomeMap = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(homes));
  } catch {
    /* storage unavailable */
  }
}

function notify(): void {
  for (const fn of listeners) fn();
}

function keyOf(account: Address): string {
  return account.toLowerCase();
}

export function homeVenue(account: Address | null): HomeVenueRecord | null {
  if (account === null) return null;
  return homes[keyOf(account)] ?? null;
}

/**
 * Record the home QING. Only called when the wrapped asset IS the account's
 * LAU (registered or pending) — the caller verifies before capturing.
 */
export function setHomeVenue(account: Address, record: Omit<HomeVenueRecord, "t">): void {
  const k = keyOf(account);
  const prev = homes[k];
  if (prev !== undefined && prev.venue.toLowerCase() === record.venue.toLowerCase()) return;
  homes = { ...homes, [k]: { ...record, t: Date.now() } };
  persist();
  notify();
}

export function homeVenueSnapshot(): HomeMap {
  return homes;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const subscribeHomeVenue = subscribe;

export function useHomeVenue(account: Address | null): HomeVenueRecord | null {
  const value = useSyncExternalStore(subscribeHomeVenue, homeVenueSnapshot, homeVenueSnapshot);
  return account !== null ? (value[account.toLowerCase()] ?? null) : null;
}

// ---- session-73: the census-resolved home QING ----
// The captured record is the fast path, but a pre-app account (an aged
// transfer — SIRIN's ΣΕΙΡΗΝ QING was the find) never "created" through this
// app, so nothing was captured. The venue census (the NewQing asset index)
// resolves it: captured ?? census. One resolution per LAU per session.

const censusMemo = new Map<string, string | null>();

export interface ResolvedHomeVenue {
  venue: Address | null;
  source: "captured" | "census" | null;
}

export function useHomeVenueResolved(account: Address | null, lau: Address | null): ResolvedHomeVenue {
  const captured = useHomeVenue(account);
  const [census, setCensus] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (captured !== null || lau === null) {
      setCensus(null);
      return;
    }
    const key = lau.toLowerCase();
    const hit = censusMemo.get(key);
    if (hit !== undefined) {
      setCensus(hit);
      return;
    }
    qingForAsset(lau)
      .then((r) => {
        const found = r?.a ?? null;
        censusMemo.set(key, found);
        if (alive) setCensus(found);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [captured, lau]);
  if (captured !== null) return { venue: captured.venue, source: "captured" };
  return { venue: (census as Address | null) ?? null, source: census !== null ? "census" : null };
}

/** test seam — restore a clean slate between rows */
export function resetHomeVenueForTests(): void {
  homes = {};
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
  notify();
}
