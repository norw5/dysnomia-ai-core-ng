/**
 * The YUE census seed (DIRECTORY, session-48 — IA-PLAN §5):
 * `data/yue_seed.json` — the 93 verified account-vaults (the receipt-scan
 * erratum census: blockscout internal-creates saw only 6; the receipt pass
 * over all SEI txs + Type()=="YUE" verification found 93) with probed
 * name/symbol + Origin() (the owner wallet at probe time — ChangeOrigin can
 * move it) + creation blocks from the SEI tx scan. Names are user-chosen
 * and rename freely (SEI.Start again / Bar) — treat seed strings as
 * snapshot facts, the profile as live truth.
 */

export interface YueRow {
  /** YUE contract address (lowercase) */
  a: string;
  /** onchain name at probe time */
  n: string;
  /** onchain symbol at probe time */
  s: string;
  /** Origin() at probe time — the owner wallet (lowercase) */
  o: string;
  /** creation block */
  blk: number | null;
}

export interface YueSeedDoc {
  _meta: { count: number; source: string; note: string };
  yues: YueRow[];
}

const LOADERS = import.meta.glob("../../../data/yue_seed.json") as Record<string, () => Promise<{ default: YueSeedDoc }>>;

let docPromise: Promise<YueRow[]> | null = null;

export function loadYues(): Promise<YueRow[]> {
  if (!docPromise) {
    const key = Object.keys(LOADERS)[0];
    if (!key) return Promise.reject(new Error("YUE seed not found"));
    docPromise = LOADERS[key]!().then((m) => cleanYueCensus(m.default.yues));
  }
  return docPromise;
}

const ADDR = /^0x[0-9a-f]{40}$/;

export function cleanYueCensus(rows: YueRow[]): YueRow[] {
  const byAddr = new Map<string, YueRow>();
  for (const r of rows) {
    if (!ADDR.test(r.a)) continue;
    const hit = byAddr.get(r.a);
    if (hit === undefined || (r.blk ?? Infinity) < (hit.blk ?? Infinity)) byAddr.set(r.a, r);
  }
  return [...byAddr.values()].sort((a, b) => (a.blk ?? Infinity) - (b.blk ?? Infinity));
}

export interface YueSearchResult {
  rows: YueRow[];
  total: number;
}

/** search: name/symbol/origin-wallet/address substrings, case-insensitive */
export function searchYues(seed: YueRow[], query: string, limit = 60): YueSearchResult {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return { rows: seed.slice(0, limit), total: seed.length };
  const hits = seed.filter((r) => r.n.toLowerCase().includes(q) || r.s.toLowerCase().includes(q) || r.o.includes(q) || r.a.includes(q));
  return { rows: hits.slice(0, limit), total: hits.length };
}
