import { beforeEach, describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  parseAbiParameters,
  toEventSelector,
  type PublicClient,
} from "viem";
import {
  _bindClientForTests,
  _resetSyncForTests,
  enrichQingRow,
  getSyncState,
  mergeByAddress,
  newQingEvent,
  runPass,
  walkNewQing,
  CHAT_LINES_CAP,
} from "@/chain/sync";
import { NEW_QING_TOPIC } from "@/chain/venueDeed";
import { SHIO_LOG_TOPIC0 } from "@/chain/chatTail";
import { heckeCoords, type RenderRow } from "@/state/atlas";
import { addr } from "@config/addresses";
import renderDoc from "../src/data/venue_render.json";

/**
 * The sync-engine pins (session-70): the NewQing walk's call path (the
 * s34 lesson — canonicalize before keccak; the event fragment must hash to
 * venueDeed's pinned topic), the pager's honesty (range-cap shrink, dead
 * RPC rethrow, truncation), the enrichment shape (waat from the EVENT feeds
 * Compliment — coords match the atlas math the generator pins), the store's
 * pass transitions, and the merge dedupe discipline.
 */

const MAP = addr("MAP");

function newQingLog(qing: string, asset: string, waat: bigint, block: number, tx: string) {
  return {
    blockNumber: BigInt(block),
    transactionHash: tx,
    logIndex: 0,
    topics: [NEW_QING_TOPIC] as `0x${string}`[],
    data: encodeAbiParameters(parseAbiParameters("address, address, uint256"), [
      qing as `0x${string}`,
      asset as `0x${string}`,
      waat,
    ]) as `0x${string}`,
  };
}

function worldChatLog(soul: bigint, aura: bigint, line: string, block: number, tx: string, logIndex = 0) {
  return {
    blockNumber: BigInt(block),
    transactionHash: tx,
    logIndex,
    topics: [SHIO_LOG_TOPIC0] as `0x${string}`[],
    data: encodeAbiParameters(parseAbiParameters("uint64, uint64, string"), [soul, aura, line]) as `0x${string}`,
  };
}

interface FakeOpts {
  head: bigint;
  chatLogs?: ReturnType<typeof worldChatLog>[];
  qingLogs?: ReturnType<typeof newQingLog>[];
  enrich?: { name: string; symbol: string; compliment: [bigint, bigint] };
  failChat?: boolean;
}

function fakeClient(opts: FakeOpts): PublicClient {
  const c = {
    getBlockNumber: async () => opts.head,
    getLogs: async (args: { address: string; fromBlock: bigint; toBlock: bigint }) => {
      if (String(args.address).toLowerCase() === String(MAP).toLowerCase()) {
        if (opts.failChat === true) throw new Error("boom");
        return opts.qingLogs!.filter(
          (l) => l.blockNumber >= args.fromBlock && l.blockNumber <= args.toBlock
        );
      }
      return opts.chatLogs!.filter(
        (l) => l.blockNumber >= args.fromBlock && l.blockNumber <= args.toBlock
      );
    },
    multicall: async () =>
      [
        { status: "success", result: opts.enrich?.name ?? "" },
        { status: "success", result: opts.enrich?.symbol ?? "" },
        { status: "success", result: opts.enrich?.compliment ?? [0n, 0n] },
      ] as unknown,
  };
  return c as unknown as PublicClient;
}

beforeEach(() => {
  _resetSyncForTests();
});

describe("NewQing call-path pins", () => {
  it("the event fragment hashes to venueDeed's pinned topic (canonical signature → keccak)", () => {
    expect(toEventSelector(newQingEvent)).toEqual(NEW_QING_TOPIC);
  });

  it("walkNewQing decodes the data words (Qing/Integrative/Waat) + carries block/tx", async () => {
    const waat = 123456789012345678901234567890n;
    const c = fakeClient({
      head: 27_700_000n,
      qingLogs: [newQingLog("0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222", waat, 27_690_000, "0xtx1")],
    });
    const got = await walkNewQing(c, 27_680_000, 27_700_000n);
    expect(got.finds.length).toEqual(1);
    expect(got.finds[0]!.qing.toLowerCase()).toEqual("0x1111111111111111111111111111111111111111");
    expect(got.finds[0]!.asset.toLowerCase()).toEqual("0x2222222222222222222222222222222222222222");
    expect(got.finds[0]!.waat).toEqual(waat);
    expect(got.finds[0]!.block).toEqual(27_690_000);
    expect(got.toBlock).toEqual(27_700_000);
    expect(got.truncated).toEqual(false);
  });

  it("truncates honestly on the page budget (cursor = contiguous coverage)", async () => {
    const c = fakeClient({ head: 27_700_000n, qingLogs: [] });
    const got = await walkNewQing(c, 27_600_000, 27_700_000n, 2);
    expect(got.truncated).toEqual(true);
    expect(got.toBlock).toBeLessThan(27_700_000);
    expect(got.pages).toEqual(2);
  });

  it("a dead RPC RETHROWS (UNREADABLE ≠ empty census)", async () => {
    const c = {
      getBlockNumber: async () => 27_700_000n,
      getLogs: async () => {
        throw new Error("connection refused");
      },
      multicall: async () => [],
    } as unknown as PublicClient;
    await expect(walkNewQing(c, 27_600_000, 27_700_000n)).rejects.toThrow("connection refused");
  });
});

describe("enrichQingRow — the event waat feeds HECKE.Compliment", () => {
  it("produces the atlas row the seed math pins (coords == heckeCoords)", async () => {
    const doc = renderDoc as unknown as { _meta: { meridians: string[]; pole: string }; venues: RenderRow[] };
    const sample = doc.venues[10]!;
    const waat = BigInt(sample.w);
    const m = { meridians: doc._meta.meridians.map((s) => BigInt(s)), pole: BigInt(doc._meta.pole) };
    const expected = heckeCoords(waat, 111111n, -22222n, m);
    const c = fakeClient({
      head: 0n,
      enrich: { name: "Probe", symbol: "PRB", compliment: [111111n, -22222n] },
    });
    const row = await enrichQingRow(c, { a: sample.a, w: sample.w, blk: 123, tx: "0xt" });
    expect(row).not.toBeNull();
    expect(row!.a).toEqual(sample.a.toLowerCase());
    expect(row!.n).toEqual("Probe");
    expect(row!.s).toEqual("PRB");
    expect(row!.blk).toEqual(123);
    expect(row!.w).toEqual(sample.w);
    expect(row!.f).toBeCloseTo(expected.f, 10);
    expect(row!.band).toEqual(expected.band);
    expect(row!.south).toEqual(expected.south);
    expect(row!.lon).toBeCloseTo(expected.lon, 8);
    expect(row!.lat).toBeCloseTo(expected.lat, 8);
    expect(row!.ln).toBeCloseTo(expected.ln, 10);
  });

  it("a failed Compliment leaves the row PENDING (coords required — never a phantom)", async () => {
    const c = {
      getBlockNumber: async () => 0n,
      getLogs: async () => [],
      multicall: async () =>
        [
          { status: "success", result: "N" },
          { status: "success", result: "S" },
          { status: "failure", error: new Error("nope") },
        ] as unknown,
    } as unknown as PublicClient;
    const row = await enrichQingRow(c, { a: "0x1111111111111111111111111111111111111111", w: "42", blk: 1, tx: "0xt" });
    expect(row).toBeNull();
  });
});

describe("the store pass (seed floors + catch-up + merge honesty)", () => {
  /** the interval's behavior: repeated passes until the walks reach head */
  async function syncToHead(maxPasses = 24): Promise<void> {
    for (let i = 0; i < maxPasses; i++) {
      const before = Math.max(getSyncState().chat.cursor, getSyncState().qing.cursor);
      await runPass();
      const s = getSyncState();
      if (s.chat.cursor >= 27_700_000 && s.qing.cursor >= 27_700_000) return;
      const after = Math.max(s.chat.cursor, s.qing.cursor);
      if (after === before) return; // stalled (error) — let assertions see it
    }
  }

  it("one pass: chat lines land, the NewQing find enriches, cursors clamp to seed floors", async () => {
    const doc = renderDoc as unknown as { venues: RenderRow[] };
    const qingSeedEnd = Math.max(...doc.venues.map((r) => r.blk));
    const seedEnd = 27_597_840; // the chat seed's last block (chunk boundary)
    // the scenario's premise: the refreshed venue seed sits AHEAD of the
    // fake head (the pinned-fork shape)
    expect(qingSeedEnd).toBeGreaterThan(27_700_000);
    const venue = "0x3333333333333333333333333333333333333333";
    const waat = 9876543210987654321n;
    const c = fakeClient({
      head: 27_700_000n,
      chatLogs: [worldChatLog(7n, 8n, "<tester> hello from the walk", 27_680_000, "0xchat1")],
      qingLogs: [newQingLog(venue, "0x4444444444444444444444444444444444444444", waat, 27_690_000, "0xq1")],
      enrich: { name: "New Place", symbol: "NEW", compliment: [100000n, 50000n] },
    });
    _bindClientForTests(c);
    await syncToHead();
    const s = getSyncState();
    // chat: the cursor never sits BELOW the seed floor (a regen absorbs the
    // overlay); qing: the refreshed seed's floor sits ABOVE this fake head,
    // so the behind-head lookback floors the walk at head − 150k instead —
    // a pinned fork under a fresh seed still catches fork-local events
    expect(s.chat.cursor).toBeGreaterThanOrEqual(seedEnd);
    expect(s.chat.cursor).toEqual(27_700_000);
    expect(s.qing.cursor).toEqual(27_700_000);
    expect(s.chatLines.map((l) => l.id)).toEqual([`0xchat1-0`]);
    expect(s.chatLines[0]!.line).toEqual("<tester> hello from the walk");
    expect(s.qingRows.length).toEqual(1);
    expect(s.qingRows[0]!.a).toEqual(venue);
    expect(s.qingRows[0]!.n).toEqual("New Place");
    expect(s.qingRows[0]!.blk).toEqual(27_690_000);
    expect(s.qingPending).toEqual(0);

    // a seed hit is NEVER duplicated: re-run with the same logs → no growth
    await runPass();
    const s2 = getSyncState();
    expect(s2.qingRows.length).toEqual(1);
    expect(s2.chatLines.length).toEqual(1);
  });

  it("a dead RPC surfaces as per-feed ERROR, never as an empty-success", async () => {
    const c = {
      getBlockNumber: async () => 27_700_000n,
      getLogs: async () => {
        throw new Error("rpc down");
      },
      multicall: async () => [],
    } as unknown as PublicClient;
    _bindClientForTests(c);
    await runPass();
    const s = getSyncState();
    expect(s.chat.error).toContain("rpc down");
    expect(s.qing.error).toContain("rpc down");
    expect(s.chatLines).toEqual([]);
    expect(s.qingRows).toEqual([]);
  });

  it("the chat-lines cap keeps the NEWEST rows and moves the completeness floor", async () => {
    const logs: ReturnType<typeof worldChatLog>[] = [];
    for (let i = 0; i < CHAT_LINES_CAP + 5; i++) {
      logs.push(worldChatLog(BigInt(i), 1n, `line ${i}`, 27_600_000 + i, `0xtx${i}`));
    }
    const c = fakeClient({ head: 27_700_000n, chatLogs: logs });
    _bindClientForTests(c);
    await syncToHead();
    const s = getSyncState();
    expect(s.chatLines.length).toEqual(CHAT_LINES_CAP);
    expect(s.chatLines[0]!.line).toEqual("line 5"); // the oldest 5 dropped
    expect(s.chatFloor).toEqual(27_600_005);
    expect(s.chat.cursor).toEqual(27_700_000);
  });
});

describe("mergeByAddress — the UI dedupe discipline", () => {
  it("appends caught-up rows, dedupes by address (case-insensitive), seed wins on order", () => {
    const seed = [{ a: "0xAAAA" }, { a: "0xBBBB" }];
    const live = [
      { a: "0xbbbb" }, // dup, different case
      { a: "0xCCCC" },
    ];
    const merged = mergeByAddress(seed, live);
    expect(merged.map((r) => r.a)).toEqual(["0xAAAA", "0xBBBB", "0xCCCC"]);
  });
});
