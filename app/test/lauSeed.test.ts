import { describe, expect, it } from "vitest";
import raw from "@data/lau_seed.json";
import { cleanCensus, loadLaus, searchLaus, type LauSeedDoc } from "@/state/lauSeed";

/**
 * LAU census seed integrity + the local search index (DIRECTORY skeleton,
 * session-44). Pins: the 18,660-row harvest cleans to 18,434 unique LAUs
 * (38 empty-address probes dropped, 73 double-probes collapsed), named at
 * final probe 17,873 (96.96% — kb §6's 97.8% census fraction does not
 * reproduce from this artifact; flagged, not reconciled), and search
 * semantics (username/address substring; empty query = newest-first browse).
 */

const doc = raw as unknown as LauSeedDoc;

describe("LAU census seed", () => {
  it("carries the 18,660-row harvest; the loader cleans it to 18,434 uniques", async () => {
    expect(doc.laus).toHaveLength(18_660);
    expect(doc._meta.count).toEqual(18_660);
    const rows = await loadLaus();
    expect(rows).toHaveLength(18_434);
    expect(new Set(rows.map((r) => r.a)).size).toEqual(rows.length);
  });

  it("cleaning drops unresolvable probes and keeps the EARLIEST block per address", () => {
    const A = `0x${"aa".repeat(20)}`;
    const B = `0x${"bb".repeat(20)}`;
    const rows = cleanCensus([
      { a: "", u: "", blk: 1 },
      { a: A, u: "x", blk: 200 },
      { a: A, u: "x", blk: 100 },
      { a: B, u: "y", blk: 300 },
      { a: "0xshort", u: "z", blk: 400 },
    ]);
    expect(rows).toEqual([
      { a: A, u: "x", blk: 100 },
      { a: B, u: "y", blk: 300 },
    ]);
  });

  it("named fraction at final probe is the artifact's own 96.96%", async () => {
    const rows = await loadLaus();
    const named = rows.filter((r) => r.u.length > 0).length;
    expect(named).toEqual(17_873);
    expect(named / rows.length).toBeGreaterThan(0.969);
    expect(named / rows.length).toBeLessThan(0.97);
  });

  it("addresses are unique + lowercase + well-formed; blocks sane", async () => {
    const rows = await loadLaus();
    expect(new Set(rows.map((r) => r.a)).size).toEqual(rows.length);
    for (const r of rows.slice(0, 500)) {
      expect(r.a).toEqual(r.a.toLowerCase());
      expect(r.a).toMatch(/^0x[0-9a-f]{40}$/);
      expect(r.blk).toBeGreaterThan(0);
    }
  });
});

describe("searchLaus", () => {
  it("finds by username substring, case-insensitive", () => {
    const r = searchLaus(doc.laus, "MARIAra");
    expect(r.total).toBeGreaterThanOrEqual(1);
    expect(r.rows[0]!.u.toLowerCase()).toContain("mariara");
  });

  it("finds by address substring", () => {
    const r = searchLaus(doc.laus, "0xd32c39fee49391c7");
    expect(r.total).toEqual(1);
    expect(r.rows[0]!.a).toEqual("0xd32c39fee49391c7952d1b30b15921b0d3b42e69");
  });

  it("empty query = newest-first browse, capped", async () => {
    const rows = await loadLaus();
    const r = searchLaus(rows, "");
    expect(r.total).toEqual(18_434);
    expect(r.rows).toHaveLength(60);
    const blocks = r.rows.map((x) => x.blk);
    expect(blocks).toEqual([...blocks].sort((a, b) => b - a));
  });

  it("caps results + reports the full hit count", () => {
    const r = searchLaus(doc.laus, "a");
    expect(r.rows.length).toEqual(60);
    expect(r.total).toBeGreaterThan(60);
  });
});
