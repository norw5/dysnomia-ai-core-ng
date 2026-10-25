import { EXPLORER_BASE } from "@config/addresses";

/**
 * The MARKET Pairs tab seed (IA-PLAN §5 open-decision 1 — the owner round):
 * `data/pairs_seed.json` (188 curated LPs = the W3b/treasurysystem.win
 * reconciliation `in_webs` set + the core-reserves'/Atropa/Ⓐ/CHOA best
 * pairs). OUT-LINKS ONLY — no embedded trading surface, no swaps, no
 * approvals; figures are WPLS-anchored (the standing display rule — never
 * pseudo-USD). The file ships verbatim into the app bundle; re-ship on
 * regeneration (same rule as every seed).
 */

export interface PairRow {
  /** pair (LP) address, checksummed as shipped */
  p: string;
  /** factory version label (v0/v1/v2/…) */
  f: string;
  /** token0 / token1 addresses (lowercase as shipped) */
  t0: string;
  t1: string;
  /** token labels ("FED|FedContract" style) — null leg = unlabeled */
  l0: string | null;
  l1: string | null;
  /** the curated token's ticker (null on the core-reserve rows where no single curated token applies) */
  cur: string | null;
  /** WPLS-anchored liquidity total for the curated token (display anchor) */
  wpls: number | null;
  /** live pairs counted at curation time */
  live: number | null;
}

export interface PairsDoc {
  _meta: { source: string; note: string; count?: number };
  pairs: PairRow[];
}

const LOADERS = import.meta.glob("../data/pairs_seed.json") as Record<string, () => Promise<{ default: PairsDoc }>>;

let docPromise: Promise<PairRow[]> | null = null;

export function loadPairs(): Promise<PairRow[]> {
  if (!docPromise) {
    const key = Object.keys(LOADERS)[0];
    if (!key) return Promise.reject(new Error("pairs seed not found"));
    docPromise = LOADERS[key]!().then((m) => {
      if (!Array.isArray(m.default.pairs)) throw new Error("pairs seed malformed");
      return m.default.pairs;
    });
  }
  return docPromise;
}

/** short label for a token leg: the shipped label head ("FED|FedContract" → "FED") */
export function pairLegLabel(row: PairRow, leg: 0 | 1): string {
  const l = leg === 0 ? row.l0 : row.l1;
  if (l === null) return (leg === 0 ? row.t0 : row.t1).slice(0, 10) + "…";
  const head = l.split("|")[0] ?? l;
  return head.length > 0 ? head : "?";
}

export interface PairLinks {
  /** the block explorer's address page for the pair */
  explorer: string;
  /** dexscreener's PulseChain pair page */
  dexscreener: string;
}

/** out-links only — the pairs tab never renders a trading surface */
export function pairLinks(row: PairRow): PairLinks {
  return {
    explorer: `${EXPLORER_BASE}${row.p}`,
    dexscreener: `https://dexscreener.com/pulsechain/${row.p}`,
  };
}

export interface PairsQuery {
  rows: PairRow[];
  total: number;
}

/** local search: ticker, labels, or an address fragment (case-insensitive) */
export function searchPairs(pairs: PairRow[], query: string, limit = 120): PairsQuery {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return { rows: pairs.slice(0, limit), total: pairs.length };
  const hits = pairs.filter((r) =>
    (r.cur ?? "").toLowerCase().includes(q) ||
    (r.l0 ?? "").toLowerCase().includes(q) ||
    (r.l1 ?? "").toLowerCase().includes(q) ||
    r.p.toLowerCase().includes(q) ||
    r.t0.toLowerCase().includes(q) ||
    r.t1.toLowerCase().includes(q)
  );
  return { rows: hits.slice(0, limit), total: hits.length };
}

/** WPLS-anchored display (never pseudo-USD); null liquidity sorts last */
export function fmtWpls(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B WPLS`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M WPLS`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K WPLS`;
  return `${v.toFixed(0)} WPLS`;
}
