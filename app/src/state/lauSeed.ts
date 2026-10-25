/**
 * The LAU census seed (DIRECTORY skeleton, session-44 — IA-PLAN §5):
 * `data/lau_seed.json` — the 18,660-row harvest, cleaned to **18,434
 * unique LAUs**: 38 rows carry empty address+username (unresolvable
 * harvest probes — dropped) and 73 addresses were double-probed at
 * different blocks (same username, no renames — earliest block kept =
 * the true creation). Named at final probe: 17,873/18,434 = 96.96%;
 * kb §6's census figure is 97.8% (18,660 count matches; the fraction
 * does not reproduce from this artifact — flagged in the session log,
 * not silently reconciled). Local index for browse + search; the live
 * name-probe fallback (the portal-v2 resolver pattern) needs its
 * deployed call path pinned against kb/abi before it ships —
 * deliberately NOT guessed here.
 */

export interface LauRow {
  /** LAU contract address (lowercase) */
  a: string;
  /** onchain Username (empty string = the ~2.2% unreadable/absent) */
  u: string;
  /** creation block */
  blk: number;
}

export interface LauSeedDoc {
  _meta: { count: number; named: number };
  laus: LauRow[];
}

const LOADERS = import.meta.glob("../../../data/lau_seed.json") as Record<
  string,
  () => Promise<{ default: LauSeedDoc }>
>;

let docPromise: Promise<LauRow[]> | null = null;

export function loadLaus(): Promise<LauRow[]> {
  if (!docPromise) {
    const key = Object.keys(LOADERS)[0];
    if (!key) return Promise.reject(new Error("LAU seed not found"));
    docPromise = LOADERS[key]!().then((m) => cleanCensus(m.default.laus));
  }
  return docPromise;
}

const ADDR = /^0x[0-9a-f]{40}$/;

/** drop unresolvable probes, collapse double-probes to the earliest block */
export function cleanCensus(rows: LauRow[]): LauRow[] {
  const byAddr = new Map<string, LauRow>();
  for (const r of rows) {
    if (!ADDR.test(r.a)) continue;
    const hit = byAddr.get(r.a);
    if (hit === undefined || r.blk < hit.blk) byAddr.set(r.a, r);
  }
  return [...byAddr.values()];
}

export interface LauSearchResult {
  rows: LauRow[];
  total: number;
}

/** Pure search: case-insensitive substring on username/address (an 0x-prefix query targets addresses) */
export function searchLaus(seed: LauRow[], query: string, limit = 60): LauSearchResult {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    // default browse order: newest LAUs first (the census grew forward)
    return { rows: seed.slice().reverse().slice(0, limit), total: seed.length };
  }
  const hits: LauRow[] = [];
  for (const r of seed) {
    if (r.u.toLowerCase().includes(q) || r.a.includes(q)) hits.push(r);
  }
  return { rows: hits.slice(0, limit), total: hits.length };
}
