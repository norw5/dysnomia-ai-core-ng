/**
 * The LAU address book (session-71, the owner round): username→LAU
 * resolution over the shipped census seed (`data/lau_seed.slim.json` —
 * 18,660 LAUs; the origin blockscout export, owner-run: the factory emits
 * NOTHING enumerable, so this snapshot is the only client-side map).
 *
 * HONESTY LAW: usernames are NOT unique (50 duplicated + 652 empty in the
 * census) and soul→LAU is NOT resolvable onchain (CHO.GetUserBySoul is a
 * not-view landmine — entropy-advancing). So resolution answers one of
 * THREE shapes — unique / ambiguous(count) / none — and the UI refuses to
 * guess on ambiguity (the impersonation hazard the soul-seeded sigils
 * exist to fight). Buckets key on the lowercased username (case drift
 * between wire and snapshot folds into one identity family).
 */

export type LauResolution =
  | { kind: "unique"; lau: string }
  | { kind: "ambiguous"; count: number }
  | { kind: "none" };

export interface LauSeedDoc {
  laus: Array<{ a: string; u: string }>;
}

const SEED_LOADERS = import.meta.glob("../../../data/lau_seed.slim.json") as Record<
  string,
  () => Promise<{ default: LauSeedDoc }>
>;

let bookPromise: Promise<Map<string, string[]>> | null = null;

function loadBook(): Promise<Map<string, string[]>> {
  if (!bookPromise) {
    const key = Object.keys(SEED_LOADERS)[0];
    if (!key) return Promise.reject(new Error("lau seed not found"));
    bookPromise = SEED_LOADERS[key]!().then((m) => {
      const buckets = new Map<string, string[]>();
      for (const row of m.default.laus) {
        const u = row.u.trim();
        if (u.length === 0) continue; // the 652 empty usernames resolve nothing
        const k = u.toLowerCase();
        const hit = buckets.get(k);
        if (hit) hit.push(row.a);
        else buckets.set(k, [row.a]);
      }
      return buckets;
    });
  }
  return bookPromise;
}

let book: Map<string, string[]> | null = null;

/** resolve a chat handle against the census snapshot (async: seed loads lazily) */
export async function resolveLauByUsername(username: string): Promise<LauResolution> {
  const u = username.trim();
  if (u.length === 0) return { kind: "none" };
  if (book === null) book = await loadBook().catch(() => null);
  if (book === null) return { kind: "none" };
  const hit = book.get(u.toLowerCase());
  if (hit === undefined) return { kind: "none" };
  // same-address duplicates in the seed collapse to one identity
  const uniq = Array.from(new Set(hit.map((a) => a.toLowerCase())));
  if (uniq.length === 1) return { kind: "unique", lau: uniq[0]! };
  return { kind: "ambiguous", count: uniq.length };
}

/** test seam: install a preloaded book (module reset via `_resetLauBookForTests`) */
export function _setBookForTests(rows: Array<{ a: string; u: string }>): void {
  const buckets = new Map<string, string[]>();
  for (const row of rows) {
    const u = row.u.trim();
    if (u.length === 0) continue;
    const k = u.toLowerCase();
    const hit = buckets.get(k);
    if (hit) hit.push(row.a);
    else buckets.set(k, [row.a]);
  }
  book = buckets;
}

/** test seam: drop the cached book + loader */
export function _resetLauBookForTests(): void {
  book = null;
  bookPromise = null;
}
