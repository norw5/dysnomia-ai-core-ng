import { describe, expect, it } from "vitest";
import raw0 from "@data/chat/chunk_0000.json";
import raw1 from "@data/chat/chunk_0001.json";
import {
  chunkCount,
  loadSeedChunk,
  parseLine,
  seedSummary,
  type SeedChunkDoc,
} from "@/state/chatSeed";

/**
 * Chat-archive seed integrity (session-44): `data/chat/chunk_*.json` is the
 * shipped LogEvent harvest of the world-chat SHIO. These pins catch hand
 * edits + glob breakage; like every generated artifact here — if it drifts,
 * REGENERATE the seed, never hand-fix the test.
 */

const c0 = raw0 as unknown as SeedChunkDoc;
const c1 = raw1 as unknown as SeedChunkDoc;

describe("chat seed chunks", () => {
  it("ships exactly the two known chunks (glob resolves)", () => {
    expect(chunkCount()).toEqual(2);
  });

  it("loads each chunk through the lazy loader, memoized shape intact", async () => {
    const a = await loadSeedChunk(0);
    const b = await loadSeedChunk(1);
    expect(a).toEqual(c0.msgs);
    expect(b).toEqual(c1.msgs);
    await expect(loadSeedChunk(2)).rejects.toThrow("not found");
  });

  it("chunks are block-ascending, id-unique, counts honest", () => {
    for (const doc of [c0, c1]) {
      expect(doc.msgs).toHaveLength(doc.count);
      const ids = new Set(doc.msgs.map((m) => `${m.tx}-${m.log_index}`));
      expect(ids.size).toEqual(doc.msgs.length);
      for (let i = 1; i < doc.msgs.length; i++) {
        expect(doc.msgs[i]!.block).toBeGreaterThanOrEqual(doc.msgs[i - 1]!.block);
      }
    }
    expect(c0.msgs[c0.msgs.length - 1]!.block).toBeLessThan(c1.msgs[0]!.block);
  });

  it("seed summary pins the archive boundaries (the live tail picks up at lastBlock+1)", async () => {
    const s = await seedSummary();
    expect(s.chunks).toEqual(2);
    expect(s.firstBlock).toEqual(21220693);
    expect(s.lastBlock).toEqual(27597840);
  });
});

describe("parseLine — the VOID wire format `<Username> line` (10_void.sol:81)", () => {
  it("splits handle + body, dropping the single joining space", () => {
    expect(parseLine("<ogwebchef888> https://www.youtube.com/watch?v=IlILTn-sj_g")).toEqual({
      handle: "ogwebchef888",
      body: "https://www.youtube.com/watch?v=IlILTn-sj_g",
    });
    expect(parseLine("<minefullness> Salutations")).toEqual({
      handle: "minefullness",
      body: "Salutations",
    });
  });

  it("keeps unicode handles intact (usernames are world-text, not ASCII)", () => {
    expect(parseLine("<♏ SAG ♏> heyu")).toEqual({ handle: "♏ SAG ♏", body: "heyu" });
  });

  it("kernel/system lines carry no bracket prefix — handle null, body whole", () => {
    expect(parseLine("Added to Yi.Nu")).toEqual({ handle: null, body: "Added to Yi.Nu" });
  });

  it("does not eat mid-line brackets or absurd prefixes", () => {
    expect(parseLine("<Noumenon> <Noumenon> Bell here are your stats")).toEqual({
      handle: "Noumenon",
      body: "<Noumenon> Bell here are your stats",
    });
    const long = `<${"x".repeat(80)}> body`;
    expect(parseLine(long)).toEqual({ handle: null, body: long });
  });
});
