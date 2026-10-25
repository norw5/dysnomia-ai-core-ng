import { describe, expect, it } from "vitest";
import { EXPLORER_BASE } from "@config/addresses";
import { fmtWpls, loadPairs, pairLegLabel, pairLinks, searchPairs } from "@/state/pairsSeed";

/**
 * The MARKET Pairs tab (session-48): the curated-LP seed join + the
 * OUT-LINK-ONLY contract — link shape (explorer + dexscreener), search,
 * WPLS-anchored formatting. There is no trading surface to test because
 * the module exposes none: no swap/approve/amount builders exist.
 */

describe("the pairs seed (join + shape)", () => {
  it("loads the 188 curated rows with the shipped fields", async () => {
    const pairs = await loadPairs();
    expect(pairs).toHaveLength(188);
    const nullCur = pairs.filter((r) => r.cur === null);
    expect(nullCur.length).toBe(50); // the core-reserve rows carry no curated ticker
    for (const r of pairs) {
      expect(r.p).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(r.t0).toMatch(/^0x[0-9a-f]{40}$/);
      expect(r.t1).toMatch(/^0x[0-9a-f]{40}$/);
      if (r.cur !== null) expect(r.cur.length).toBeGreaterThan(0);
      expect(typeof r.f).toBe("string");
    }
  });

  it("labels a leg from the shipped label head, address-fallback when unlabeled", async () => {
    const pairs = await loadPairs();
    const labeled = pairs.find((r) => r.l0 !== null)!;
    expect(pairLegLabel(labeled, 0)).toBe((labeled.l0!.split("|")[0] ?? labeled.l0));
    const unlabeled = pairs.find((r) => r.l1 === null)!;
    expect(pairLegLabel(unlabeled, 1)).toContain("…");
  });
});

describe("out-links ONLY (no embedded trading)", () => {
  it("builds exactly the two out-links: explorer address page + dexscreener pair page", async () => {
    const pairs = await loadPairs();
    const links = pairLinks(pairs[0]!);
    expect(Object.keys(links).sort()).toEqual(["dexscreener", "explorer"]);
    expect(links.explorer).toEqual(`${EXPLORER_BASE}${pairs[0]!.p}`);
    expect(links.dexscreener).toMatch(/^https:\/\/dexscreener\.com\/pulsechain\/0x[0-9a-fA-F]{40}$/);
  });

  it("WPLS-anchored figures format, never pseudo-USD", () => {
    expect(fmtWpls(null)).toBe("—");
    expect(fmtWpls(2815946583.1)).toBe("2.82B WPLS");
    expect(fmtWpls(1302367395.41)).toBe("1.30B WPLS");
    expect(fmtWpls(12_345)).toBe("12.3K WPLS");
    expect(fmtWpls(999)).toBe("999 WPLS");
    expect(fmtWpls(1_000_000)).toBe("1.00M WPLS");
  });
});

describe("local pair search", () => {
  it("matches ticker, label, and address fragments case-insensitively", async () => {
    const pairs = await loadPairs();
    const withCur = pairs.find((r) => r.cur !== null)!;
    const byCur = searchPairs(pairs, withCur.cur!.toLowerCase());
    expect(byCur.total).toBeGreaterThan(0);
    expect(byCur.rows[0]!.cur?.toLowerCase()).toBe(withCur.cur!.toLowerCase());

    const byAddress = searchPairs(pairs, pairs[0]!.p.slice(2, 12));
    expect(byAddress.total).toBeGreaterThanOrEqual(1);

    const none = searchPairs(pairs, "zzzznope");
    expect(none.total).toBe(0);
  });

  it("caps the returned rows (limit) while reporting the true total", async () => {
    const pairs = await loadPairs();
    const all = searchPairs(pairs, "", 10);
    expect(all.rows).toHaveLength(10);
    expect(all.total).toBe(188);
  });
});
