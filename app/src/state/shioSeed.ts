/**
 * The SHIO census seed (DIRECTORY, session-48 — IA-PLAN §5):
 * `data/shio_seed.json` — 12,363 unique chat channels = the SHIOFactory
 * children (12,460 blockscout internal creates − 3 unresolvable rows − 94
 * double-attributed duplicates, earliest block kept — the LAU-seed cleaning
 * rules). The full-census name probe proved every SHIO still names itself
 * "CHATLOG Shio"/"SHIO" (0 renames): a channel's identity is its Rod/Cone
 * SHA pair, not a string label — the profile reads those live. Browse +
 * address search locally; the live probe lands in the entity profile.
 */

export interface ShioRow {
  /** SHIO contract address (lowercase) */
  a: string;
  /** onchain name at probe time — uniform "CHATLOG Shio" unless renamed */
  n: string;
  /** onchain symbol at probe time */
  s: string;
  /** creation block */
  blk: number;
}

export interface ShioSeedDoc {
  _meta: {
    count: number;
    renamed: number;
    factory_children: number;
    dropped_unresolvable: number;
    duplicates_collapsed: number;
  };
  shios: ShioRow[];
}

const LOADERS = import.meta.glob("../../../data/shio_seed.json") as Record<string, () => Promise<{ default: ShioSeedDoc }>>;

let docPromise: Promise<ShioRow[]> | null = null;

export function loadShios(): Promise<ShioRow[]> {
  if (!docPromise) {
    const key = Object.keys(LOADERS)[0];
    if (!key) return Promise.reject(new Error("SHIO seed not found"));
    docPromise = LOADERS[key]!().then((m) => cleanShioCensus(m.default.shios));
  }
  return docPromise;
}

const ADDR = /^0x[0-9a-f]{40}$/;

/** the builder already deduped; the loader re-asserts the invariant (address-valid + unique, earliest block wins) */
export function cleanShioCensus(rows: ShioRow[]): ShioRow[] {
  const byAddr = new Map<string, ShioRow>();
  for (const r of rows) {
    if (!ADDR.test(r.a)) continue;
    const hit = byAddr.get(r.a);
    if (hit === undefined || r.blk < hit.blk) byAddr.set(r.a, r);
  }
  return [...byAddr.values()];
}

export interface ShioSearchResult {
  rows: ShioRow[];
  total: number;
}

/** search: address substring; empty query browses newest channels first */
export function searchShios(seed: ShioRow[], query: string, limit = 60): ShioSearchResult {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return { rows: seed.slice().reverse().slice(0, limit), total: seed.length };
  const hits = seed.filter((r) => r.a.includes(q) || r.n.toLowerCase().includes(q) || r.s.toLowerCase().includes(q));
  return { rows: hits.slice(0, limit), total: hits.length };
}
