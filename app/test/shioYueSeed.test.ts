import { describe, expect, it } from "vitest";
import { cleanShioCensus, loadShios, searchShios, type ShioRow } from "@/state/shioSeed";
import { cleanYueCensus, loadYues, searchYues, type YueRow } from "@/state/yueSeed";

/**
 * The SHIO + YUE census seeds (session-48 — the DIRECTORY completion): the
 * shipped artifacts' shape + the cleaning/search rules. SHIO = the
 * SHIOFactory census (12,460 children − 3 unresolvable − 94 duplicates =
 * 12,363 unique, every one named "CHATLOG Shio" — the full-census probe);
 * YUE = the 93-vault receipt-scan erratum census with probed names + owner
 * wallets.
 */

describe("the SHIO seed (join + census invariants)", () => {
  it("loads the cleaned census — unique, valid, uniform names, census delta recorded", async () => {
    const rows = await loadShios();
    expect(rows).toHaveLength(12_363);
    const addrs = new Set(rows.map((r) => r.a));
    expect(addrs.size).toBe(rows.length); // unique
    for (const r of rows) {
      expect(r.a).toMatch(/^0x[0-9a-f]{40}$/);
      expect(r.blk).toBeGreaterThan(0);
    }
    // the full-census probe result: 0 renames, uniform template name
    expect(rows.every((r) => r.n === "CHATLOG Shio" && r.s === "SHIO")).toBe(true);
    // the three constellation SHIOs (Fornax, world-chat/Fomalhaute, Eris) are in it
    const have = (a: string) => addrs.has(a);
    expect(have("0xf6c50ffe7efbdee63a92e52a4d5e9aff7fb4a4d7")).toBe(true);
    expect(have("0x7ae73c498a308247be73688c09c96b3fd06ddb84")).toBe(true);
    expect(have("0xe843765114992e18061498aed708537ce9d924fa")).toBe(true);
  });

  it("cleanShioCensus collapses duplicates to the earliest block and drops invalid rows", () => {
    const rows: ShioRow[] = [
      { a: "0x" + "ab".repeat(20), n: "CHATLOG Shio", s: "SHIO", blk: 200 },
      { a: "0x" + "ab".repeat(20), n: "CHATLOG Shio", s: "SHIO", blk: 100 },
      { a: "not-an-address", n: "", s: "", blk: 1 },
    ];
    const out = cleanShioCensus(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.blk).toBe(100);
  });

  it("searchShios matches address fragments; empty query browses newest first", async () => {
    const seed = await loadShios();
    const q = seed[0]!.a.slice(2, 10);
    const hit = searchShios(seed, q);
    expect(hit.total).toBeGreaterThanOrEqual(1);
    expect(hit.rows[0]!.a).toContain(q);
    const none = searchShios(seed, "zzzznope");
    expect(none.total).toBe(0);
    const browse = searchShios(seed, "", 10);
    expect(browse.rows).toHaveLength(10);
    expect(browse.rows[0]!.blk).toBeGreaterThan(browse.rows[9]!.blk);
  });
});

describe("the YUE seed (the receipt-scan census)", () => {
  it("loads the 93 vaults with probed names, owner wallets, and creation blocks", async () => {
    const rows = await loadYues();
    expect(rows).toHaveLength(93);
    const named = rows.filter((r) => r.n.length > 0);
    expect(named.length).toBe(92); // the one unnamed is the honest probe result
    for (const r of rows) {
      expect(r.a).toMatch(/^0x[0-9a-f]{40}$/);
      expect(r.o).toMatch(/^0x[0-9a-f]{40}$/); // Origin probed for every row
    }
    // sorted by creation block ascending (the census grew forward)
    expect(rows[0]!.blk! <= rows[rows.length - 1]!.blk!).toBe(true);
  });

  it("searchYues matches name, symbol, owner wallet, and address", async () => {
    const seed = await loadYues();
    const byName = searchYues(seed, "mariarahel");
    expect(byName.total).toBe(1);
    const byOwner = searchYues(seed, seed[0]!.o.slice(2, 12));
    expect(byOwner.total).toBeGreaterThanOrEqual(1);
    const none = searchYues(seed, "zzzznope");
    expect(none.total).toBe(0);
  });

  it("cleanYueCensus dedupes and tolerates missing blocks", () => {
    const rows: YueRow[] = [
      { a: "0x" + "cd".repeat(20), n: "A", s: "A", o: "0x" + "11".repeat(20), blk: 10 },
      { a: "0x" + "cd".repeat(20), n: "A", s: "A", o: "0x" + "11".repeat(20), blk: 5 },
      { a: "0x" + "ef".repeat(20), n: "B", s: "B", o: "0x" + "22".repeat(20), blk: null },
    ];
    const out = cleanYueCensus(rows);
    expect(out).toHaveLength(2);
    expect(out[0]!.blk).toBe(5); // earliest wins + ascending order, null-block last
    expect(out[1]!.blk).toBeNull();
  });
});
