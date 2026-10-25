import { useSyncExternalStore } from "react";
import type { Abi, AbiEvent, Address, PublicClient } from "viem";
import { addr } from "@config/addresses";
import { makeClient } from "@/chain/client";
import { openDb } from "@/chain/idb";
import { readChatTail, worldChannel, mergeLines, type TailLine } from "@/chain/chatTail";
import { decodeNewQing } from "@/chain/venueDeed";
import { loadAtlasMath, loadRenderRows, heckeCoords, type RenderRow } from "@/state/atlas";
import { seedSummary } from "@/state/chatSeed";

/**
 * THE GLOBAL SYNC ENGINE (session-70, the corpus-refresh round — owner round
 * landed: GLOBAL engine + header control, chat + QING feeds, IDB-persisted
 * cursors, honest chips for the non-enumerable censuses). Seed-floor +
 * live-overlay catch-up for the feeds the chain can enumerate:
 *
 *  - `chat:world` — the VOID world channel backfill: paged LogEvent reads
 *    from the chat seed's last block + 1 to head. This is the BRIDGE the
 *    CHAT view used to leave as a manual affordance, warmed and persisted.
 *  - `qing` — the QING census catch-up: MAP.NewQing(Qing, Integrative, Waat)
 *    log walk from the render seed's newest block to head (the ONE census
 *    with an onchain enumerator — LAUFactory/SHIOFactory/SEI emit nothing,
 *    so those browses stay seed snapshots with honest as-of chips).
 *
 * Everything here is ANONYMOUS (getLogs + views; IA-PLAN §9) and PERSISTED
 * to the `sync` IDB store so catch-up is incremental across sessions: one
 * cursor per feed, the caught-up rows ride along, and a seed regen simply
 * clamps the cursor forward (the new seed absorbs the old overlay).
 */

/** persisted chat lines are capped; the floor records where they're complete */
export const CHAT_LINES_CAP = 2000;
/** per-pass page budgets (the interval continues a partial walk) */
const PASS_PAGES_CHAT = 12;
const PASS_PAGES_QING = 16;
/** quiet re-check cadence while the engine runs */
const TICK_MS = 45_000;
/** enrichment batch cap (multicall3 calls per pass — the tool's ~300 law) */
const ENRICH_BATCH = 150;
/**
 * When the RPC's head sits BEHIND a seed's coverage claim (a pinned anvil
 * fork under a freshly regenerated seed), the seed's claim is about the
 * LIVE chain — fork-local events below the seed floor still deserve
 * catch-up, so the walk floors at head − LOOKBACK (fork sessions are short;
 * seed-covered finds dedupe away). On live this never triggers (head is
 * always past the regen point).
 */
const BEHIND_HEAD_LOOKBACK = 150_000;

export interface SyncFeedState {
  /** synced THROUGH this block (inclusive); 0 = never synced */
  cursor: number;
  /** last chain head observed */
  head: number;
  busy: boolean;
  error: string | null;
  updatedAt: number | null;
}

export interface SyncState {
  /** the engine's global switch (persisted; default on) */
  running: boolean;
  chat: SyncFeedState;
  qing: SyncFeedState;
  /** caught-up world lines, ascending; complete from `chatFloor` up */
  chatLines: TailLine[];
  chatFloor: number;
  /** fully-enriched caught-up venues (atlas rows — coords via HECKE) */
  qingRows: RenderRow[];
  /** venues found but not yet enriched (names/coords pending) */
  qingPending: number;
}

function feed(busy = false): SyncFeedState {
  return { cursor: 0, head: 0, busy, error: null, updatedAt: null };
}

function initial(): SyncState {
  return {
    running: true,
    chat: feed(),
    qing: feed(),
    chatLines: [],
    chatFloor: 0,
    qingRows: [],
    qingPending: 0,
  };
}

let state: SyncState = initial();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function setFeed(patch: Partial<SyncFeedState> & { which: "chat" | "qing" }): void {
  state = { ...state, [patch.which]: { ...state[patch.which], ...patch } };
  emit();
}

// ---- persisted shapes (JSON-safe: bigint soul/aura travel as strings) ----

interface StoredLine {
  id: string;
  block: number;
  tx: string;
  logIndex: number;
  soul: string;
  aura: string;
  username: string | null;
  line: string;
}

interface StoredChat {
  id: "chat:world";
  cursor: number;
  floor: number;
  head: number;
  updatedAt: number;
  lines: StoredLine[];
}

/** a venue the NewQing walk found — the event's own facts, pre-enrichment */
export interface StoredQingRaw {
  a: string;
  /** waat (decimal string, s32-exact) */
  w: string;
  blk: number;
  tx: string;
  /** the wrapped asset (NewQing's Integrative) — session-73; optional for pre-73 caches */
  asset?: string | undefined;
}

interface StoredQing {
  id: "qing";
  cursor: number;
  head: number;
  updatedAt: number;
  raw: StoredQingRaw[];
  rows: RenderRow[];
}

interface StoredEngine {
  id: "engine";
  running: boolean;
}

function lineToStored(l: TailLine): StoredLine {
  return { id: l.id, block: l.block, tx: l.tx, logIndex: l.logIndex, soul: l.soul.toString(), aura: l.aura.toString(), username: l.username, line: l.line };
}

function storedToLine(l: StoredLine): TailLine {
  return { id: l.id, block: l.block, tx: l.tx, logIndex: l.logIndex, soul: BigInt(l.soul), aura: BigInt(l.aura), username: l.username, line: l.line };
}

async function idbGet<T>(id: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction("sync", "readonly").objectStore("sync").get(id);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPut<T extends { id: string }>(record: T): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const req = db.transaction("sync", "readwrite").objectStore("sync").put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbClear(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const req = db.transaction("sync", "readwrite").objectStore("sync").clear();
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ---- the NewQing walk (paged like the chat tail; anonymous getLogs) ----

export interface QingFind {
  qing: Address;
  asset: Address;
  waat: bigint;
  block: number;
  tx: string;
}

export interface QingWalk {
  finds: QingFind[];
  /** contiguous coverage through this block (inclusive) */
  toBlock: number;
  truncated: boolean;
  pages: number;
}

const PAGE_ATTEMPTS = [5_000, 1_000, 200];

/**
 * The NewQing fragment (canonical shape — args NOT indexed, kb/dev/map.md
 * §5; topic0 asserted against venueDeed's pinned constant in tests). viem
 * encodes the topic filter from the event; the decode still reads the data
 * words via the pinned `decodeNewQing`.
 */
export const newQingEvent = {
  type: "event",
  name: "NewQing",
  inputs: [
    { name: "Qing", type: "address", indexed: false },
    { name: "Integrative", type: "address", indexed: false },
    { name: "Waat", type: "uint256", indexed: false },
  ],
} as const satisfies AbiEvent;

interface RawLogPage {
  blockNumber: bigint | null;
  transactionHash: string | null;
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
}

function looksLikeRangeCap(message: string): boolean {
  return /limit|range|too many|result window|exceed|blocked response|10000|query returned/i.test(message);
}

/**
 * Walk MAP.NewQing logs `fromBlock..head` (inclusive). The topic is the
 * pinned selector-checked constant from venueDeed (args NOT indexed —
 * decodeNewQing reads the data words). Range caps shrink the page; a page
 * failing at every size RETHROWS (a dead RPC is UNREADABLE, never empty).
 */
export async function walkNewQing(
  client: PublicClient,
  fromBlock: number,
  head: bigint,
  budget = PASS_PAGES_QING
): Promise<QingWalk> {
  const finds: QingFind[] = [];
  const end = Number(head);
  let cursor = Math.max(fromBlock, 0);
  let toBlock = cursor - 1;
  let pages = 0;
  let truncated = false;

  while (cursor <= end) {
    if (pages >= budget) {
      truncated = true;
      break;
    }
    let logs: RawLogPage[] | null = null;
    let span = 0;
    for (const size of PAGE_ATTEMPTS) {
      const to = Math.min(cursor + size - 1, end);
      try {
        const got = (await client.getLogs({
          address: addr("MAP"),
          event: newQingEvent,
          fromBlock: BigInt(cursor),
          toBlock: BigInt(to),
        })) as unknown as RawLogPage[];
        logs = got;
        span = to - cursor + 1;
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (size !== PAGE_ATTEMPTS[PAGE_ATTEMPTS.length - 1] && looksLikeRangeCap(msg)) continue;
        throw e;
      }
    }
    if (logs === null || span === 0) throw new Error("qing walk: page failed at every size");
    pages += 1;
    for (const log of logs) {
      if (log.blockNumber === null || log.transactionHash === null) continue;
      const facts = decodeNewQing([{ address: "", topics: [...log.topics] as string[], data: log.data }]);
      if (facts === null) continue;
      finds.push({ ...facts, block: Number(log.blockNumber), tx: log.transactionHash });
    }
    toBlock = cursor + span - 1;
    cursor += span;
  }
  return { finds, toBlock, truncated, pages };
}

// ---- enrichment: the event facts + one anonymous multicall → a full row ----

const venueMetaAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "Asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const heckeComplimentAbi = [
  {
    type: "function",
    name: "Compliment",
    stateMutability: "view",
    inputs: [{ name: "Waat", type: "uint256" }],
    outputs: [{ name: "Longitude", type: "int256" }, { name: "Latitude", type: "int256" }],
  },
] as const;

/**
 * Resolve a found venue into a full atlas row: name/symbol from the QING +
 * the TRUE coordinates from HECKE.Compliment(waat) (the waat came IN the
 * event — no extra read). A row whose Compliment fails is left for the next
 * pass (coords are required — never a phantom position); name/symbol
 * failures degrade to "" like the seed's nameless rows.
 */
export async function enrichQingRow(
  client: PublicClient,
  found: StoredQingRaw
): Promise<RenderRow | null> {
  const waat = BigInt(found.w);
  const rs = (await client.multicall({
    allowFailure: true,
    contracts: [
      { address: found.a as Address, abi: venueMetaAbi as unknown as Abi[], functionName: "name" },
      { address: found.a as Address, abi: venueMetaAbi as unknown as Abi[], functionName: "symbol" },
      { address: addr("HECKE"), abi: heckeComplimentAbi as unknown as Abi[], functionName: "Compliment", args: [waat] },
      { address: found.a as Address, abi: venueMetaAbi as unknown as Abi[], functionName: "Asset" },
    ],
  })) as Array<{ status: "success"; result: unknown } | { status: "failure"; error: Error }>;
  const name = rs[0]?.status === "success" && typeof rs[0].result === "string" ? rs[0].result : "";
  const symbol = rs[1]?.status === "success" && typeof rs[1].result === "string" ? rs[1].result : "";
  const comp = rs[2];
  if (comp?.status !== "success" || !Array.isArray(comp.result) || comp.result.length !== 2) return null;
  const [longitude, latitude] = comp.result as [bigint, bigint];
  const math = await loadAtlasMath();
  const coords = heckeCoords(waat, longitude, latitude, math);
  // session-73: the wrapped asset rides the row (the stored raw's
  // NewQing-decoded value wins; the live Asset() probe backfills old caches)
  const assetProbe = rs[3]?.status === "success" && typeof rs[3].result === "string" ? rs[3].result : undefined;
  return {
    a: found.a.toLowerCase(),
    n: name,
    s: symbol,
    f: coords.f,
    band: coords.band,
    blk: found.blk,
    south: coords.south,
    sys: false,
    w: found.w,
    lon: coords.lon,
    lat: coords.lat,
    ln: coords.ln,
    asset: found.asset ?? assetProbe?.toLowerCase(),
  };
}

// ---- the engine ----

let client: PublicClient | null = null;
let rpcUrl: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let passBusy = false;
let hydrated = false;
let hydrating: Promise<void> | null = null;
/** seed floors, loaded lazily on the first pass (clamps cursors after a regen) */
let floors: { chatSeedEnd: number; qingSeedEnd: number; seedAddrs: Set<string> } | null = null;

async function loadFloors(): Promise<{ chatSeedEnd: number; qingSeedEnd: number; seedAddrs: Set<string> }> {
  if (floors !== null) return floors;
  const [chat, rows] = await Promise.all([seedSummary(), loadRenderRows()]);
  let qingSeedEnd = 0;
  const seedAddrs = new Set<string>();
  for (const r of rows) {
    seedAddrs.add(r.a);
    if (r.blk > qingSeedEnd) qingSeedEnd = r.blk;
  }
  floors = { chatSeedEnd: chat.lastBlock, qingSeedEnd, seedAddrs };
  return floors;
}

async function hydrate(): Promise<void> {
  if (hydrating !== null) return hydrating;
  hydrating = (async () => {
    const [engine, chatRec, qingRec] = await Promise.all([
      idbGet<StoredEngine>("engine"),
      idbGet<StoredChat>("chat:world"),
      idbGet<StoredQing>("qing"),
    ]);
    state = {
      ...state,
      running: engine?.running ?? !simDefaultPaused,
      chat: chatRec ? { ...state.chat, cursor: chatRec.cursor, head: chatRec.head, updatedAt: chatRec.updatedAt } : state.chat,
      chatLines: chatRec ? chatRec.lines.map(storedToLine) : [],
      chatFloor: chatRec?.floor ?? 0,
      qing: qingRec ? { ...state.qing, cursor: qingRec.cursor, head: qingRec.head, updatedAt: qingRec.updatedAt } : state.qing,
      qingRows: qingRec?.rows ?? [],
      qingPending: qingRec ? Math.max(0, qingRec.raw.length - qingRec.rows.length) : 0,
    };
    hydrated = true;
    emit();
  })();
  return hydrating;
}

/** persisted qing raw rows (module state mirrors the record between passes) */
let qingRaw: StoredQingRaw[] | null = null;

async function qingRawList(): Promise<StoredQingRaw[]> {
  if (qingRaw !== null) return qingRaw;
  const rec = await idbGet<StoredQing>("qing");
  qingRaw = rec?.raw ?? [];
  return qingRaw;
}

async function persistChat(): Promise<void> {
  const rec: StoredChat = {
    id: "chat:world",
    cursor: state.chat.cursor,
    floor: state.chatFloor,
    head: state.chat.head,
    updatedAt: Date.now(),
    lines: state.chatLines.map(lineToStored),
  };
  await idbPut(rec);
}

async function persistQing(): Promise<void> {
  const raw = await qingRawList();
  const rec: StoredQing = {
    id: "qing",
    cursor: state.qing.cursor,
    head: state.qing.head,
    updatedAt: Date.now(),
    raw,
    rows: state.qingRows,
  };
  await idbPut(rec);
}

/** the engine's pass — exported for tests (the app reaches it via timers/kick) */
export async function runPass(): Promise<void> {
  if (!hydrated) await hydrate();
  if (!client || !state.running || passBusy) return;  passBusy = true;
  try {
    const f = await loadFloors().catch((e: unknown) => {
      throw new Error(`seed floors: ${e instanceof Error ? e.message : String(e)}`);
    });
    const head = await client.getBlockNumber();
    const headN = Number(head);

    // ---- chat:world ----
    if (!state.chat.busy) {
      setFeed({ which: "chat", busy: true, head: headN, error: null });
      try {
        const floor = headN < f.chatSeedEnd ? Math.max(0, headN - BEHIND_HEAD_LOOKBACK) : f.chatSeedEnd;
        const from = Math.max(Math.min(state.chat.cursor, headN), floor);
        if (headN > from) {
          const got = await readChatTail(client, worldChannel(), head, from + 1, PASS_PAGES_CHAT);
          let lines = mergeLines(state.chatLines, got.lines);
          let floorBlock = lines.length > 0 ? lines[0]!.block : state.chatFloor;
          if (lines.length > CHAT_LINES_CAP) {
            lines = lines.slice(lines.length - CHAT_LINES_CAP);
            floorBlock = lines[0]!.block;
          }
          // a seed regen absorbs old overlay lines — drop the redundant prefix
          const keep = lines.filter((l) => l.block > f.chatSeedEnd);
          if (keep.length !== lines.length) {
            lines = keep;
            floorBlock = Math.max(floorBlock, f.chatSeedEnd + 1);
          }
          state = { ...state, chatLines: lines, chatFloor: floorBlock };
          setFeed({ which: "chat", cursor: got.toBlock, updatedAt: Date.now() });
          emit();
          await persistChat();
        } else {
          setFeed({ which: "chat", head: headN, error: null, updatedAt: state.chat.updatedAt });
        }
      } catch (e: unknown) {
        setFeed({ which: "chat", error: e instanceof Error ? e.message : String(e), updatedAt: Date.now() });
      } finally {
        setFeed({ which: "chat", busy: false });
      }
    }

    // ---- qing census ----
    if (!state.qing.busy) {
      setFeed({ which: "qing", busy: true, head: headN, error: null });
      try {
        const floor = headN < f.qingSeedEnd ? Math.max(0, headN - BEHIND_HEAD_LOOKBACK) : f.qingSeedEnd;
        const from = Math.max(Math.min(state.qing.cursor, headN), floor);
        if (headN > from) {
          const got = await walkNewQing(client, from + 1, head, PASS_PAGES_QING);
          const raw = await qingRawList();
          const known = new Set(raw.map((r) => r.a));
          for (const find of got.finds) {
            const a = find.qing.toLowerCase();
            if (known.has(a) || f.seedAddrs.has(a)) continue;
            raw.push({ a, w: find.waat.toString(), blk: find.block, tx: find.tx, asset: find.asset });
            known.add(a);
          }
          qingRaw = raw;
          setFeed({ which: "qing", cursor: got.toBlock, updatedAt: Date.now() });
        }
        // enrichment pass (also retries pending rows from earlier sessions)
        const raw = await qingRawList();
        const have = new Set(state.qingRows.map((r) => r.a));
        const todo = raw.filter((r) => !have.has(r.a)).slice(0, Math.ceil(ENRICH_BATCH / 4)); // 4 calls/venue since session-73 (+Asset)
        let enriched = 0;
        for (const r of todo) {
          const row = await enrichQingRow(client, r).catch(() => null);
          if (row !== null) {
            state = { ...state, qingRows: [...state.qingRows, row] };
            enriched += 1;
          }
        }
        if (enriched > 0 || raw.length !== state.qingRows.length) {
          state = { ...state, qingPending: Math.max(0, raw.length - state.qingRows.length) };
          emit();
        }
        await persistQing();
      } catch (e: unknown) {
        setFeed({ which: "qing", error: e instanceof Error ? e.message : String(e), updatedAt: Date.now() });
      } finally {
        setFeed({ which: "qing", busy: false });
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    setFeed({ which: "chat", error: msg });
    setFeed({ which: "qing", error: msg });
  } finally {
    passBusy = false;
  }
}

/**
 * Mount the engine against the active RPC (the App calls this on url
 * change). Persists nothing about the RPC itself — the caught-up rows are
 * chain data, valid across sessions and RPCs of the same chain. On a SIM
 * RPC (fork/local) the engine defaults to PAUSED: catch-up is a live-chain
 * freshness feature, and auto-walking hundreds of thousands of proxied
 * blocks behind a pin is spend nobody asked for — resume is one click (the
 * header chip / SETTINGS), and a persisted preference always wins.
 */
let simDefaultPaused = false;

export function ensureSyncEngine(url: string, opts?: { simDefaultPaused?: boolean }): void {
  if (typeof window === "undefined") return;
  simDefaultPaused = opts?.simDefaultPaused ?? false;
  if (rpcUrl !== url) {
    rpcUrl = url;
    client = makeClient(url);
  }
  void hydrate().then(() => {
    if (timer !== null) clearInterval(timer);
    if (state.running) {
      void runPass();
      timer = setInterval(() => void runPass(), TICK_MS);
    }
  });
}

/** the global pause/resume (persisted — the header control and SETTINGS ride it) */
export async function setSyncRunning(running: boolean): Promise<void> {
  if (!hydrated) await hydrate();
  state = { ...state, running };
  emit();
  await idbPut({ id: "engine", running } satisfies StoredEngine);
  if (typeof window === "undefined") return;
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (running && rpcUrl !== null) {
    void runPass();
    timer = setInterval(() => void runPass(), TICK_MS);
  }
}

/** manual kick (per-module ⟳ affordances may call it) */
export function kickSync(): void {
  void runPass();
}

// ---- test seams (never used by the app) ----

/** reset the module singleton (tests); the IDB records stay untouched */
export function _resetSyncForTests(): void {
  state = initial();
  qingRaw = null;
  hydrated = false;
  hydrating = null;
  floors = null;
  client = null;
  rpcUrl = null;
  passBusy = false;
}

/** bind a fake client (tests — the app always goes through ensureSyncEngine) */
export function _bindClientForTests(c: PublicClient): void {
  client = c;
  rpcUrl = "test://fake";
}

/** SETTINGS wipe: drop the persisted overlay; the engine re-walks from the seed floors */
export async function wipeSyncCache(): Promise<void> {
  await idbClear();
  qingRaw = null;
  state = { ...initial(), running: state.running };
  emit();
  if (state.running) kickSync();
}

export function getSyncState(): SyncState {
  return state;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribe, getSyncState, getSyncState);
}

// ---- merge helpers (the UI's single dedupe discipline) ----

/** merge caught-up rows into a seed list (address dedupe, seed wins) */
export function mergeByAddress<T extends { a: string }>(seed: readonly T[], caughtUp: readonly T[]): T[] {
  const have = new Set(seed.map((r) => r.a.toLowerCase()));
  const out = [...seed];
  for (const r of caughtUp) {
    const a = r.a.toLowerCase();
    if (!have.has(a)) {
      have.add(a);
      out.push(r);
    }
  }
  return out;
}
