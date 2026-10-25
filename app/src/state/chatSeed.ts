/**
 * The VOID world-chat archive seed (IA-PLAN §10 item 5, session-44):
 * `data/chat/chunk_*.json` — the full LogEvent archive harvested from the
 * world-chat SHIO (kb §1: ZHOU's SHIO carries `LogEvent(uint64 Soul, uint64
 * Aura, string LogLine)` world chat), chunked and sorted ascending. Chunks
 * load LAZILY newest-first (the newest chunk is the first thing the CHAT
 * view shows; older history arrives on demand).
 *
 * Honesty rule (the MAP seed-vs-live idiom): every line from here is
 * `source: "seed"` — a snapshot through the seed's last block, clearly
 * labeled as such; everything newer is the RPC tail (chain/chatTail.ts).
 */

export interface SeedMsg {
  block: number;
  tx: string;
  log_index: number;
  soul: number;
  aura: number;
  msg: string;
}

export interface SeedChunkDoc {
  count: number;
  msgs: SeedMsg[];
}

const CHUNK_LOADERS = import.meta.glob("../../../data/chat/chunk_*.json") as Record<
  string,
  () => Promise<{ default: SeedChunkDoc }>
>;

/** chunk indices sorted ascending by filename (= ascending block ranges) */
export const CHUNK_KEYS: string[] = Object.keys(CHUNK_LOADERS).sort();

const cache = new Map<number, Promise<SeedMsg[]>>();

/** number of chunks in the shipped archive (tests pin the exact shape) */
export function chunkCount(): number {
  return CHUNK_KEYS.length;
}

/** load one chunk by ascending index (0 = oldest); memoized */
export function loadSeedChunk(i: number): Promise<SeedMsg[]> {
  const hit = cache.get(i);
  if (hit) return hit;
  const key = CHUNK_KEYS[i];
  if (key === undefined) return Promise.reject(new Error(`chat seed chunk ${i} not found`));
  const p = CHUNK_LOADERS[key]!()
    .then((m) => m.default.msgs)
    .catch((e: unknown) => {
      cache.delete(i);
      throw e instanceof Error ? e : new Error(String(e));
    });
  cache.set(i, p);
  return p;
}

export interface SeedSummary {
  chunks: number;
  firstBlock: number;
  lastBlock: number;
}

let summaryPromise: Promise<SeedSummary> | null = null;

/**
 * Archive metadata from the FIRST and LAST chunk only (cheap — never loads
 * the middle). The last block is where the live RPC tail picks up.
 */
export function seedSummary(): Promise<SeedSummary> {
  if (!summaryPromise) {
    summaryPromise = (async () => {
      const n = chunkCount();
      if (n === 0) throw new Error("chat seed: no chunks found");
      const oldest = await loadSeedChunk(0);
      const newest = await loadSeedChunk(n - 1);
      if (oldest.length === 0 || newest.length === 0) throw new Error("chat seed: empty boundary chunk");
      return {
        chunks: n,
        firstBlock: oldest[0]!.block,
        lastBlock: newest[newest.length - 1]!.block,
      };
    })().catch((e: unknown) => {
      summaryPromise = null;
      throw e;
    });
  }
  return summaryPromise;
}

/**
 * Load the WHOLE archive ascending (session-71): the native search runs
 * over the full seed (8,083 lines / 2 chunks — trivially small next to the
 * live feeds). Memoized after the first load; per-chunk memoization means
 * already-loaded chunks cost nothing.
 */
let allMemo: SeedMsg[] | null = null;

export function loadAllSeedChunks(): Promise<SeedMsg[]> {
  if (allMemo !== null) return Promise.resolve(allMemo);
  const n = chunkCount();
  return Promise.all(Array.from({ length: n }, (_, i) => loadSeedChunk(i)))
    .then((parts) => {
      allMemo = parts.flat();
      return allMemo;
    })
    .catch((e: unknown) => {
      throw e instanceof Error ? e : new Error(String(e));
    });
}

/** test seam: drop the full-archive memo */
export function _resetAllSeedMemoForTests(): void {
  allMemo = null;
}

/**
 * The VOID.Chat wire format is `<Username> line` (10_void.sol:81,
 * string.concat("<", Username, "> ", chatline)) — the username travels
 * INSIDE the LogLine. Split it for display; the raw line is always kept.
 * Kernel/system lines (soul 0, e.g. "Added to Yi.Nu") carry no brackets.
 */
export interface ParsedLine {
  handle: string | null;
  body: string;
}

export function parseLine(line: string): ParsedLine {
  if (line.startsWith("<")) {
    const close = line.indexOf(">");
    if (close > 0 && close <= 64) {
      const handle = line.slice(1, close);
      const rest = line.slice(close + 1);
      return { handle, body: rest.startsWith(" ") ? rest.slice(1) : rest };
    }
  }
  return { handle: null, body: line };
}
