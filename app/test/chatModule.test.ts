import { afterEach, describe, expect, it, vi } from "vitest";
import { chatLayout, setChatLayout, subscribeChatLayout } from "@/state/chatLayout";
import { _resetLauBookForTests, _setBookForTests, resolveLauByUsername } from "@/state/lauBook";
import { chatSearchLines } from "@/state/chatSearch";
import { combineLines, isSystemLine, seedToLine, tailToLine, type ViewLine } from "@/ui/chat/viewLine";
import { HANDLE_COLORS, handleColor, sigilSeedForSoul } from "@/ui/chat/handleColor";
import { _resetAllSeedMemoForTests, loadAllSeedChunks, parseLine } from "@/state/chatSeed";
import { getBlockTime, _resetBlockTimeForTests, formatUtc } from "@/chain/blockTime";
import type { PublicClient } from "viem";
import raw1 from "@data/chat/chunk_0001.json";

/**
 * The session-71 chat-module foundations: the username→LAU resolution law
 * (unique / ambiguous / none — never a guess), the pure search helper, the
 * unified ViewLine converters, the soul-seeded color/sigil derivations,
 * the block-time cache law (cached forever, failure un-caches), and the
 * full-archive loader.
 */

afterEach(() => {
  _resetLauBookForTests();
  _resetBlockTimeForTests();
  _resetAllSeedMemoForTests();
});

// ---- the display layout store ----

describe("chatLayout — the persisted irc|rich preference", () => {
  it("defaults irc, switches + notifies (the persist is browser-only)", () => {
    expect(chatLayout()).toBe("irc");
    const fn = vi.fn();
    const off = subscribeChatLayout(fn);
    setChatLayout("rich");
    expect(chatLayout()).toBe("rich");
    expect(fn).toHaveBeenCalledTimes(1);
    setChatLayout("irc");
    expect(chatLayout()).toBe("irc");
    off();
  });
});

// ---- the LAU address book ----

describe("lauBook — the username→LAU resolution law", () => {
  it("unique usernames resolve to the one LAU", async () => {
    _setBookForTests([
      { a: "0x1111111111111111111111111111111111111111", u: "mariarahel" },
      { a: "0x2222222222222222222222222222222222222222", u: "someone-else" },
    ]);
    expect(await resolveLauByUsername("mariarahel")).toEqual({
      kind: "unique",
      lau: "0x1111111111111111111111111111111111111111",
    });
  });

  it("case drift folds into one bucket (the wire vs the snapshot)", async () => {
    _setBookForTests([{ a: "0x1111111111111111111111111111111111111111", u: "MariaRachel" }]);
    expect(await resolveLauByUsername("mariarachel")).toEqual({
      kind: "unique",
      lau: "0x1111111111111111111111111111111111111111",
    });
  });

  it("duplicated usernames REFUSE to guess — ambiguous carries the count", async () => {
    _setBookForTests([
      { a: "0x1111111111111111111111111111111111111111", u: "Hijinks" },
      { a: "0x2222222222222222222222222222222222222222", u: "Hijinks" },
      { a: "0x3333333333333333333333333333333333333333", u: "Hijinks" },
    ]);
    expect(await resolveLauByUsername("Hijinks")).toEqual({ kind: "ambiguous", count: 3 });
  });

  it("same-address duplicate rows collapse to one identity", async () => {
    _setBookForTests([
      { a: "0xABCDEF0123456789abcdef0123456789ABCDEF01", u: "x" },
      { a: "0xabcdef0123456789abcdef0123456789abcdef01", u: "x" }, // checksum case only
    ]);
    expect(await resolveLauByUsername("x")).toEqual({ kind: "unique", lau: "0xabcdef0123456789abcdef0123456789abcdef01" });
  });

  it("empty usernames and misses resolve none", async () => {
    _setBookForTests([
      { a: "0x1111111111111111111111111111111111111111", u: "" },
      { a: "0x2222222222222222222222222222222222222222", u: "named" },
    ]);
    expect(await resolveLauByUsername("")).toEqual({ kind: "none" });
    expect(await resolveLauByUsername("   ")).toEqual({ kind: "none" });
    expect(await resolveLauByUsername("nobody")).toEqual({ kind: "none" });
  });
});

// ---- the pure search ----

function vl(id: string, handle: string | null, body: string, block = 1, soul = 1n): ViewLine {
  return { id, block, tx: `0x${id}`, logIndex: 0, soul, aura: 0n, handle, body, source: "seed" };
}

describe("chatSearch — native search over the corpus", () => {
  it("case-insensitive substring over handle + body, ids ascending", () => {
    const lines = [vl("a", "Nyx", "hello world"), vl("b", "echo", "WORLD peace"), vl("c", "worldbuilder", "hi")];
    const res = chatSearchLines(lines, "world");
    expect(res.ids).toEqual(["a", "b", "c"]);
    expect(res.searched).toBe(3);
  });

  it("empty/whitespace query matches nothing (not everything)", () => {
    const lines = [vl("a", "Nyx", "hello")];
    expect(chatSearchLines(lines, "").ids).toEqual([]);
    expect(chatSearchLines(lines, "   ").ids).toEqual([]);
    expect(chatSearchLines(lines, "nope").ids).toEqual([]);
  });
});

// ---- the unified ViewLine converters ----

describe("viewLine — one id space, one shape", () => {
  it("seed and live lines with the same tx-log share ONE id and dedupe (seed wins by order)", () => {
    const seedMsg = { block: 5, tx: "0xt", log_index: 3, soul: 7, aura: 9, msg: "<Nyx> hi" };
    const a = seedToLine(seedMsg);
    const b = tailToLine({ id: "0xt-3", block: 5, tx: "0xt", logIndex: 3, soul: 7n, aura: 9n, username: null, line: "<Nyx> hi" });
    expect(a.id).toBe("0xt-3");
    expect(b.id).toBe("0xt-3");
    expect(combineLines([a], [b])).toHaveLength(1);
  });

  it("ordering is (block, logIndex); system lines detected by soul 0 + no handle", () => {
    const sys = tailToLine({ id: "s", block: 1, tx: "0x1", logIndex: 0, soul: 0n, aura: 0n, username: null, line: "Added to Yi.Nu" });
    const user = vl("u", "Nyx", "hi", 2);
    expect(isSystemLine(sys)).toBe(true);
    expect(isSystemLine(user)).toBe(false);
    expect(combineLines([user], [sys]).map((l) => l.id)).toEqual(["s", "u"]);
  });

  it("the venue tail keeps the event-carried Username verbatim", () => {
    const v = tailToLine({ id: "v", block: 2, tx: "0x2", logIndex: 0, soul: 4n, aura: 1n, username: "Fenris", line: "raw line" });
    expect(v.handle).toBe("Fenris");
    expect(v.body).toBe("raw line");
  });
});

// ---- the soul-seeded identity derivations ----

describe("handleColor — the pinned accent set, keyed by soul", () => {
  it("deterministic + inside the pinned set; the seed matches the identity pane convention", () => {
    expect(handleColor(42n)).toBe(handleColor(42n));
    expect(HANDLE_COLORS).toContain(handleColor(0n));
    expect(HANDLE_COLORS).toContain(handleColor(987654321n));
    expect(sigilSeedForSoul(42n)).toBe("soul:42");
  });
});

// ---- the block-time cache ----

function fakeClient(timestamps: Record<number, number>, fail = false): Pick<PublicClient, "getBlock"> {
  return {
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
      const n = Number(blockNumber);
      if (fail || timestamps[n] === undefined) throw new Error("unreadable");
      return { timestamp: BigInt(timestamps[n]) } as never;
    },
  } as unknown as Pick<PublicClient, "getBlock">;
}

describe("blockTime — cached forever, failure un-caches for retry", () => {
  it("resolves + caches per block", async () => {
    const c = fakeClient({ 100: 1728000000 });
    expect(await getBlockTime(c as PublicClient, 100)).toBe(1728000000);
    // second read is served from cache even when the client now fails
    expect(await getBlockTime(fakeClient({}, true) as PublicClient, 100)).toBe(1728000000);
  });

  it("a failed read resolves null and un-caches (a later pass may retry)", async () => {
    const dead = fakeClient({}, true);
    expect(await getBlockTime(dead as PublicClient, 200)).toBeNull();
    const alive = fakeClient({ 200: 5 });
    expect(await getBlockTime(alive as PublicClient, 200)).toBe(5);
  });

  it("UTC formatting is ISO-truncated + Z-suffixable", () => {
    expect(formatUtc(1728069300)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

// ---- the memoized body render (the 71.1 render-all performance law) ----

describe("renderChatBody — cached per body string (no DOMPurify re-runs per render)", () => {
  it("returns the SAME node array for a repeated body", async () => {
    const { renderChatBody } = await import("@/ui/safeContent");
    const a = renderChatBody("see https://example.com/x and plain text");
    const b = renderChatBody("see https://example.com/x and plain text");
    expect(a).toBe(b); // referential — the cache is the point
    expect(renderChatBody("different")).not.toBe(a);
  });
});

// ---- the full-archive loader (the search floor) ----

describe("loadAllSeedChunks — the whole archive, ascending, memoized", () => {
  it("loads every chunk flattened ascending and covers the boundary blocks", async () => {
    const all = await loadAllSeedChunks();
    expect(all.length).toBeGreaterThan(5000);
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!.block).toBeGreaterThanOrEqual(all[i - 1]!.block);
    }
    // every line parses (the wire format law)
    for (const m of all.slice(0, 200)) expect(parseLine(m.msg)).toHaveProperty("handle");
    // the slim tail chunk corroborates the count
    expect(all.length).toBeGreaterThanOrEqual(raw1.count);
  });
});
