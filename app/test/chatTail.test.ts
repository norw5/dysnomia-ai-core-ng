import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  parseAbi,
  parseAbiParameters,
  toEventSelector,
  type PublicClient,
} from "viem";
import {
  _qingLogEvent,
  _shioLogEvent,
  decodeChatLog,
  encodeTopic0Probe,
  mergeLines,
  QING_LOG_TOPIC0,
  readChatLatest,
  readChatTail,
  SHIO_LOG_TOPIC0,
  venueChannel,
  worldChannel,
  type RawLog,
} from "@/chain/chatTail";
import { sanitizeLinkHref } from "@/ui/safeContent";
import raw1 from "@data/chat/chunk_0001.json";

/**
 * The chat-tail call-path pins (the s34 lesson, event-flavored): the two
 * deployed LogEvent shapes are canonicalized BEFORE any keccak work, the
 * pinned topic0 constants are asserted against viem's own event hashing,
 * the decode path is proven against the same wire format the seed archive
 * was harvested from, and the tail pager is walked against a fake client.
 */

const shioSig = parseAbi(["event LogEvent(uint64 Soul, uint64 Aura, string LogLine)"]);
const qingSig = parseAbi([
  "event LogEvent(string Username, uint64 Soul, uint64 Aura, string LogLine)",
]);

function worldLog(soul: bigint, aura: bigint, line: string): RawLog {
  return {
    blockNumber: 27_600_000n,
    logIndex: 7,
    transactionHash: "0xabc0000000000000000000000000000000000000000000000000000000000123",
    topics: [SHIO_LOG_TOPIC0],
    data: encodeAbiParameters(parseAbiParameters("uint64, uint64, string"), [soul, aura, line]),
  };
}

describe("LogEvent topic0 pins (canonical signature → keccak, never hand-derived)", () => {
  it("world: keccak(LogEvent(uint64,uint64,string)) is the pinned SHIO topic", () => {
    expect(toEventSelector(shioSig[0]!)).toEqual(SHIO_LOG_TOPIC0);
  });

  it("venue: keccak(LogEvent(string,uint64,uint64,string)) is the pinned QING topic", () => {
    expect(toEventSelector(qingSig[0]!)).toEqual(QING_LOG_TOPIC0);
  });

  it("the shipped event fragments encode to the same topics (self-consistency)", () => {
    expect(encodeTopic0Probe(worldChannel())).toEqual(SHIO_LOG_TOPIC0);
    expect(encodeTopic0Probe(venueChannel("0xb0ba7d36b7f0505879179ece7401f24eb653c6e1"))).toEqual(
      QING_LOG_TOPIC0
    );
  });

  it("the fragments match the canonical solc-generated ABIs' shapes", () => {
    expect(_shioLogEvent.name).toEqual("LogEvent");
    expect(_shioLogEvent.inputs.map((i) => `${i.type}${i.indexed ? " indexed" : ""}`)).toEqual([
      "uint64",
      "uint64",
      "string",
    ]);
    expect(_qingLogEvent.inputs.map((i) => i.type)).toEqual(["string", "uint64", "uint64", "string"]);
  });
});

describe("decodeChatLog — defensive decode of the two families", () => {
  it("decodes a world LogEvent to the same values the seed archive carries (seed/tail wire agreement)", () => {
    const row = (raw1 as { msgs: { block: number; soul: number; aura: number; msg: string }[] }).msgs[0]!;
    const log = worldLog(BigInt(row.soul), BigInt(row.aura), row.msg);
    log.blockNumber = BigInt(row.block);
    const line = decodeChatLog(worldChannel(), log);
    expect(line).not.toBeNull();
    expect(line!.soul).toEqual(BigInt(row.soul));
    expect(line!.aura).toEqual(BigInt(row.aura));
    expect(line!.line).toEqual(row.msg);
    expect(line!.block).toEqual(row.block);
    expect(line!.id).toEqual("0xabc0000000000000000000000000000000000000000000000000000000000123-7");
  });

  it("decodes a QING LogEvent with its Username field", () => {
    const data = encodeAbiParameters(parseAbiParameters("string, uint64, uint64, string"), [
      "mariarahel",
      5n,
      6n,
      "venue hello",
    ]);
    const log: RawLog = {
      blockNumber: 27_600_001n,
      logIndex: 0,
      transactionHash: "0xdef0000000000000000000000000000000000000000000000000000000000456",
      topics: [QING_LOG_TOPIC0],
      data,
    };
    const line = decodeChatLog(venueChannel("0xb0ba7d36b7f0505879179ece7401f24eb653c6e1"), log);
    expect(line).not.toBeNull();
    expect(line!.username).toEqual("mariarahel");
    expect(line!.soul).toEqual(5n);
    expect(line!.line).toEqual("venue hello");
  });

  it("refuses logs without block/tx or with the wrong topic", () => {
    const ch = worldChannel();
    const noBlock: RawLog = { ...worldLog(1n, 2n, "x"), blockNumber: null };
    expect(decodeChatLog(ch, noBlock)).toBeNull();
    const wrongTopic: RawLog = { ...worldLog(1n, 2n, "x"), topics: [QING_LOG_TOPIC0] };
    expect(decodeChatLog(ch, wrongTopic)).toBeNull();
  });
});

describe("readChatTail — paging, caps, honesty", () => {
  function fakeClient(logsFor: (from: number, to: number) => RawLog[]) {
    const calls: { from: number; to: number }[] = [];
    let throwOnce = false;
    return {
      calls,
      setThrowOnce: (v: boolean) => {
        throwOnce = v;
      },
      client: {
        getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
          const from = Number(fromBlock);
          const to = Number(toBlock);
          calls.push({ from, to });
          if (throwOnce && calls.length === 1 && to - from + 1 > 1000) {
            throw new Error("query returned more than 10000 results");
          }
          return logsFor(from, to);
        },
      } as unknown as PublicClient,
    };
  }

  it("walks pages from fromBlock to head without gaps", async () => {
    const fake = fakeClient(() => []);
    const tail = await readChatTail(fake.client, worldChannel(), 10_500n, 0, 32);
    expect(tail.lines).toEqual([]);
    expect(tail.coveredFrom).toEqual(0);
    expect(tail.toBlock).toEqual(10_500);
    expect(tail.truncated).toEqual(false);
    // 5000-block pages: 0-4999, 5000-9999, 10000-10500
    expect(fake.calls.map((c) => c.from)).toEqual([0, 5000, 10000]);
  });

  it("shrinks the page on RPC range-cap errors and advances by the ACTUAL span", async () => {
    const fake = fakeClient(() => []);
    fake.setThrowOnce(true);
    const tail = await readChatTail(fake.client, worldChannel(), 1_100n, 0);
    expect(tail.coveredFrom).toEqual(0);
    expect(tail.truncated).toEqual(false);
    // first head-clamped 1101-wide attempt threw → retried at 1000 → remainder
    expect(fake.calls.map((c) => c.to - c.from + 1)).toEqual([1_101, 1_000, 101]);
  });

  it("surfaces a hard RPC failure instead of an empty channel", async () => {
    const dead = {
      getLogs: async () => {
        throw new Error("fetch failed");
      },
    } as unknown as PublicClient;
    await expect(readChatTail(dead, worldChannel(), 100n, 0)).rejects.toThrow("fetch failed");
  });

  it("reports truncation when the page budget runs out", async () => {
    const fake = fakeClient(() => []);
    const tail = await readChatTail(fake.client, worldChannel(), 100_000n, 0, 2);
    expect(tail.truncated).toEqual(true);
    expect(tail.pages).toEqual(2);
  });
});

describe("readChatLatest — the backward latest-lines read (69.3: the monitor's forward walk never reached head)", () => {
  function fakeClient(logsFor: (from: number, to: number) => RawLog[]) {
    const calls: { from: number; to: number }[] = [];
    return {
      calls,
      client: {
        getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
          const from = Number(fromBlock);
          const to = Number(toBlock);
          calls.push({ from, to });
          return logsFor(from, to);
        },
      } as unknown as PublicClient,
    };
  }

  function worldLineAt(block: number, logIndex: number, text: string): RawLog {
    return {
      ...worldLog(BigInt(block), BigInt(logIndex), text),
      blockNumber: BigInt(block),
      logIndex,
      transactionHash: ("0xabc" + block.toString(16).padStart(8, "0")) as `0x${string}`,
    };
  }

  it("finds the NEWEST lines near head on the FIRST page back (the sparse-channel regression)", async () => {
    // 2 lines 2k blocks before head — the forward 4-page walk never reached them
    const fake = fakeClient((from, to) =>
      [27_671_902, 27_671_905].filter((b) => b >= from && b <= to).map((b, i) => worldLineAt(b, i, `live ${b}`))
    );
    const tail = await readChatLatest(fake.client, worldChannel(), 27_674_000n, { windowBlocks: 50_000, maxPages: 8, want: 8 });
    expect(tail.lines.map((l) => l.block)).toEqual([27_671_902, 27_671_905]); // ascending
    // the walk stopped on the page budget before the 50k floor with only 2
    // of 8 wanted lines — honest truncation (deeper history may exist)
    expect(tail.truncated).toBe(true);
    expect(tail.pages).toBeGreaterThan(0);
    expect(fake.calls[0]!.to).toBe(27_674_000); // walked DOWN from head, not up from the floor
  });

  it("stops filling at `want` (newest kept) and reports truncation only on the page budget", async () => {
    const fake = fakeClient((from, to) =>
      Array.from({ length: Math.min(to, 27_674_000) - from + 1 }, (_, i) => worldLineAt(from + i, 0, `line ${from + i}`))
    );
    const tail = await readChatLatest(fake.client, worldChannel(), 27_674_000n, { windowBlocks: 50_000, maxPages: 8, want: 5 });
    expect(tail.lines).toHaveLength(5);
    expect(tail.lines[0]!.block).toBe(27_673_996); // the five newest, ascending
    expect(tail.lines[4]!.block).toBe(27_674_000);
    expect(tail.truncated).toBe(false);
    // a 1-page budget over a sparse window: honest truncation flag
    const sparse = fakeClient(() => []);
    const cut = await readChatLatest(sparse.client, worldChannel(), 27_674_000n, { windowBlocks: 500_000, maxPages: 1, want: 8 });
    expect(cut.lines).toHaveLength(0);
    expect(cut.truncated).toBe(true);
  });

  it("a dead RPC surfaces as an error, never an empty channel", async () => {
    const dead = {
      getLogs: async () => {
        throw new Error("fetch failed");
      },
    } as unknown as PublicClient;
    await expect(readChatLatest(dead, worldChannel(), 100n, {})).rejects.toThrow("fetch failed");
  });
});

describe("mergeLines", () => {
  const mk = (id: string, block: number, logIndex: number) => ({
    id,
    block,
    tx: `0x${id}`,
    logIndex,
    soul: 1n,
    aura: 1n,
    username: null,
    line: id,
  });

  it("orders by block then logIndex and dedupes by id", () => {
    const merged = mergeLines(
      [mk("b", 100, 0), mk("a", 100, 0)],
      [mk("a", 100, 0), mk("c", 99, 5)]
    );
    expect(merged.map((l) => l.id)).toEqual(["c", "a", "b"]);
  });
});

describe("sanitizeLinkHref — the out-link fence (regex floor; DOMPurify in browsers)", () => {
  it("accepts plain http(s) URLs", () => {
    expect(sanitizeLinkHref("https://entropy-dysnomia.vercel.app/gameplay.html")).toEqual(
      "https://entropy-dysnomia.vercel.app/gameplay.html"
    );
    expect(sanitizeLinkHref("http://example.com")).toEqual("http://example.com");
  });

  it("refuses every other scheme — javascript, data, vbscript, mailto, relative", () => {
    expect(sanitizeLinkHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeLinkHref("data:image/webp;base64,UklGR")).toBeNull();
    expect(sanitizeLinkHref("vbscript:x")).toBeNull();
    expect(sanitizeLinkHref("mailto:a@b.c")).toBeNull();
    expect(sanitizeLinkHref("//evil.example/x")).toBeNull();
    expect(sanitizeLinkHref("/local/path")).toBeNull();
  });

  it("refuses whitespace/meta smuggling and absurd lengths", () => {
    expect(sanitizeLinkHref("https://x.example/a b")).toBeNull();
    expect(sanitizeLinkHref("https://x.example/\"><script>")).toBeNull();
    expect(sanitizeLinkHref(`https://x.example/${"a".repeat(600)}`)).toBeNull();
  });
});
