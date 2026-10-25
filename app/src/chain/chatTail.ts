import {
  decodeEventLog,
  toEventSelector,
  type AbiEvent,
  type Address,
  type PublicClient,
} from "viem";
import { addr } from "@config/addresses";

/**
 * The live chat tail (IA-PLAN §10 item 5, session-44): `eth_getLogs` reads
 * of the two deployed LogEvent shapes — ANONYMOUS (no `from` anywhere; the
 * IA-PLAN §9 rule), paged to stay under public-RPC range caps, honest about
 * truncation. The exact per-family call paths are pinned against the
 * canonical ABIs BEFORE building (the s34 lesson):
 *
 *  - world chat: the world-chat SHIO (kb §1 — ZHOU's SHIO) emits
 *    `LogEvent(uint64 Soul, uint64 Aura, string LogLine)` (03_shio.sol:20,
 *    all params NON-indexed → one topic, values in data);
 *  - venue chat: every QING emits
 *    `LogEvent(string Username, uint64 Soul, uint64 Aura, string LogLine)`
 *    (domain/dan/03_qing.sol:145, also all non-indexed).
 *
 * The topic0 constants below are keccak of the canonical signatures and are
 * asserted against viem's own canonicalization in test/chatTail.test.ts —
 * never hand-edit them.
 */

export const SHIO_LOG_TOPIC0 = "0x6b81130c485ac9b98332fa40c2e57900867815b0fe1497e1a168caf930fc9c9d";
export const QING_LOG_TOPIC0 = "0xb916a3aaef1d0f80cd78f5fca0067f557f3db4a63748929d2e5e8d0014549374";

const shioLogEvent = {
  type: "event",
  name: "LogEvent",
  inputs: [
    { name: "Soul", type: "uint64", indexed: false },
    { name: "Aura", type: "uint64", indexed: false },
    { name: "LogLine", type: "string", indexed: false },
  ],
} as const satisfies AbiEvent;

const qingLogEvent = {
  type: "event",
  name: "LogEvent",
  inputs: [
    { name: "Username", type: "string", indexed: false },
    { name: "Soul", type: "uint64", indexed: false },
    { name: "Aura", type: "uint64", indexed: false },
    { name: "LogLine", type: "string", indexed: false },
  ],
} as const satisfies AbiEvent;

/** exposed for the selector/topic regression test (never for direct calls) */
export const _shioLogEvent: AbiEvent = shioLogEvent;
export const _qingLogEvent: AbiEvent = qingLogEvent;

export type ChatChannel =
  | { kind: "world"; address: Address; event: AbiEvent; topic0: `0x${string}` }
  | { kind: "venue"; address: Address; event: AbiEvent; topic0: `0x${string}` };

/** the world channel reads the world-chat SHIO (config-driven, never inline) */
export function worldChannel(): ChatChannel {
  return { kind: "world", address: addr("WorldChatSHIO"), event: shioLogEvent, topic0: SHIO_LOG_TOPIC0 };
}

/** a venue channel reads that QING's own LogEvent stream */
export function venueChannel(venue: Address): ChatChannel {
  return { kind: "venue", address: venue, event: qingLogEvent, topic0: QING_LOG_TOPIC0 };
}

export interface TailLine {
  /** `${txHash}-${logIndex}` — the same id space the seed archive uses */
  id: string;
  block: number;
  tx: string;
  logIndex: number;
  soul: bigint;
  aura: bigint;
  /** the QING channel carries the username as event data; world does not */
  username: string | null;
  line: string;
}

export interface ChatTail {
  lines: TailLine[];
  /** the block the pages actually started at (>= requested `fromBlock`) */
  coveredFrom: number;
  toBlock: number;
  /** true when the window budget or an RPC cap stopped us above `fromBlock` */
  truncated: boolean;
  pages: number;
}

/** plausible public-RPC range-cap complaints (message text varies by host) */
function looksLikeRangeCap(message: string): boolean {
  return /limit|range|too many|result window|exceed|blocked response|10000|query returned/i.test(message);
}

/** the raw getLogs shape decodeChatLog consumes (exported for tests) */
export interface RawLog {
  blockNumber: bigint | null;
  logIndex: number | null;
  transactionHash: string | null;
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
}

/** decode one raw log against the channel's event — defensive on shapes */
export function decodeChatLog(channel: ChatChannel, log: RawLog): TailLine | null {
  if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null) return null;
  if (log.topics.length < 1 || log.topics[0] !== channel.topic0) return null;
  let args: Record<string, unknown>;
  try {
    const decoded = decodeEventLog({
      abi: [channel.event],
      data: log.data,
      topics: log.topics as [`0x${string}`],
    });
    args = decoded.args as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
  const soul = toBigInt(args["Soul"]);
  const aura = toBigInt(args["Aura"]);
  const line = typeof args["LogLine"] === "string" ? args["LogLine"] : null;
  if (soul === null || aura === null || line === null) return null;
  return {
    id: `${log.transactionHash}-${log.logIndex}`,
    block: Number(log.blockNumber),
    tx: log.transactionHash,
    logIndex: log.logIndex,
    soul,
    aura,
    username: channel.kind === "venue" && typeof args["Username"] === "string" ? args["Username"] : null,
    line,
  };
}

/** defensive uint64 coercion (viem decodes to bigint; never trust the shape) */
function toBigInt(v: unknown): bigint | null {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  return null;
}

/** self-check: the shipped fragments canonicalize to the pinned topics (tests assert this too) */
export function encodeTopic0Probe(channel: ChatChannel): `0x${string}` {
  return toEventSelector(channel.event);
}

const PAGE_ATTEMPTS = [5_000, 1_000, 200];

/**
 * Page `eth_getLogs` from `fromBlock` up to `head` (inclusive). Anonymous
 * reads; anonymous only — getLogs never carries a `from`. On range-cap
 * errors the page shrinks; a page that fails at every size rethrows (a dead
 * RPC must surface as UNREADABLE, never as an empty channel).
 */
export async function readChatTail(
  client: PublicClient,
  channel: ChatChannel,
  head: bigint,
  fromBlock: number,
  budget = 32 // page cap: bounds the walk against the public RPCs
): Promise<ChatTail> {
  const lines: TailLine[] = [];
  let pages = 0;
  let cursor = Math.max(fromBlock, 0);
  const end = Number(head);
  let lastEnd = cursor - 1;
  let truncated = false;

  while (cursor <= end) {
    if (pages >= budget) {
      truncated = true;
      break;
    }
    let pageLogs: RawLog[] | null = null;
    let span = 0;
    for (const size of PAGE_ATTEMPTS) {
      const to = Math.min(cursor + size - 1, end);
      try {
        const got = (await client.getLogs({
          address: channel.address,
          event: channel.event,
          fromBlock: BigInt(cursor),
          toBlock: BigInt(to),
        })) as unknown as RawLog[];
        pageLogs = got;
        span = to - cursor + 1; // the span the SUCCESSFUL attempt actually covered
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (size !== PAGE_ATTEMPTS[PAGE_ATTEMPTS.length - 1] && looksLikeRangeCap(msg)) continue;
        throw e;
      }
    }
    if (pageLogs === null || span === 0) throw new Error("chat tail: page failed at every size");
    pages += 1;
    for (const log of pageLogs) {
      const line = decodeChatLog(channel, log);
      if (line) lines.push(line);
    }
    lastEnd = cursor + span - 1;
    cursor += span;
  }
  // forward paging is contiguous: coverage starts AT fromBlock; truncation
  // means the walk stopped short of head (reported via toBlock + flag)
  return { lines, coveredFrom: Math.max(fromBlock, 0), toBlock: lastEnd, truncated, pages };
}

/** sort + dedupe by id (block, logIndex order) — the merge used by the view */
export function mergeLines(a: TailLine[], b: TailLine[]): TailLine[] {
  const seen = new Set<string>();
  const out: TailLine[] = [];
  for (const line of [...a, ...b]
    .slice()
    .sort((x, y) => x.block - y.block || x.logIndex - y.logIndex || (x.id < y.id ? -1 : 1))) {
    if (seen.has(line.id)) continue;
    seen.add(line.id);
    out.push(line);
  }
  return out;
}

/**
 * THE LATEST-LINES READ (session-69.3, the owner's video find): the chat
 * monitor wants the NEWEST lines, but `readChatTail` pages FORWARD from
 * `fromBlock` — with a small page budget the walk burns itself on empty
 * history and NEVER REACHES the lines near head (the fork's world channel:
 * 2 live lines 2k blocks before head, lost to a 4×5k forward walk). This
 * reader pages BACKWARD from head until `want` lines are found, the
 * window floor is hit, or the budget runs out — sparse channels surface
 * their latest lines in the FIRST page back.
 */
export interface LatestTail {
  /** ascending block order, at most `want` — ready to render */
  lines: TailLine[];
  /** head at read time */
  coveredTo: number;
  /** the lowest block actually walked (>= head - windowBlocks) */
  coveredFrom: number;
  /** stopped on the page budget before filling `want` (the window floor is honest coverage, not truncation) */
  truncated: boolean;
  pages: number;
}

export async function readChatLatest(
  client: PublicClient,
  channel: ChatChannel,
  head: bigint,
  opts: { windowBlocks?: number; maxPages?: number; want?: number } = {}
): Promise<LatestTail> {
  const windowBlocks = opts.windowBlocks ?? 50_000;
  const maxPages = opts.maxPages ?? 8;
  const want = opts.want ?? 8;
  const end = Number(head);
  const floor = Math.max(0, end - windowBlocks);
  const collected: TailLine[] = []; // newest-first as we walk backward
  let cursor = end;
  let pages = 0;
  let truncated = false;

  while (cursor >= floor && pages < maxPages && collected.length < want) {
    let pageLogs: RawLog[] | null = null;
    let start = cursor;
    for (const size of PAGE_ATTEMPTS) {
      start = Math.max(cursor - size + 1, floor);
      try {
        const got = (await client.getLogs({
          address: channel.address,
          event: channel.event,
          fromBlock: BigInt(start),
          toBlock: BigInt(cursor),
        })) as unknown as RawLog[];
        pageLogs = got;
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (size !== PAGE_ATTEMPTS[PAGE_ATTEMPTS.length - 1] && looksLikeRangeCap(msg)) continue;
        throw e; // a dead RPC surfaces as UNREADABLE, never an empty channel
      }
    }
    if (pageLogs === null) throw new Error("chat latest: page failed at every size");
    pages += 1;
    for (const log of pageLogs) {
      const line = decodeChatLog(channel, log);
      if (line) collected.push(line);
    }
    cursor = start - 1;
  }
  if (collected.length < want && cursor >= floor && pages >= maxPages) truncated = true;
  // ascending, newest `want` kept (within-page logs arrive ascending; pages
  // arrive newest-page-first — sort, then slice from the top)
  const lines = collected
    .slice()
    .sort((a, b) => a.block - b.block || a.logIndex - b.logIndex || (a.id < b.id ? -1 : 1))
    .slice(-want);
  return { lines, coveredTo: end, coveredFrom: Math.min(cursor + 1, end), truncated, pages };
}

const lauSaatAbi = [
  {
    type: "function",
    name: "Saat",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "uint64" }],
  },
] as const;

/**
 * The viewer's own Soul id — LAU.Saat(1) (the same read QING.Chat uses to
 * stamp chatters, domain/dan/03_qing.sol). One anonymous read per LAU,
 * module-cached; fail-soft (no soul → no self-highlight, never an error).
 */
const mySoulCache = new Map<Address, Promise<bigint | null>>();

export function readMySoul(client: PublicClient, lau: Address): Promise<bigint | null> {
  const hit = mySoulCache.get(lau);
  if (hit) return hit;
  const p = client
    .readContract({ address: lau, abi: lauSaatAbi, functionName: "Saat", args: [1n] })
    .then((s) => BigInt(s))
    .catch(() => null);
  mySoulCache.set(lau, p);
  return p;
}
