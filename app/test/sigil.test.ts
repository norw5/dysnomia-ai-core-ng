import { describe, expect, it } from "vitest";
import { SIGIL_PALETTE, sigilCellAt, sigilFromSeed } from "@/ui/deck/sigil";

/**
 * The passport sigil (session-57): pure deterministic derivation — the
 * predecessor's SoulSigil IDEA (mirrored 5×5 grid keyed by a string hash)
 * rebuilt in the ng CRT palette. Determinism + mirror symmetry + palette
 * bounds are the load-bearing properties (the pane seeds it from the SOUL
 * id, falling back to the wallet address pre-LAU).
 */

describe("sigil derivation", () => {
  it("is deterministic for the same seed and differs across seeds", () => {
    const a1 = sigilFromSeed("soul:42");
    const a2 = sigilFromSeed("soul:42");
    expect(a1.cells).toEqual(a2.cells);
    expect(a1.colors).toEqual(a2.colors);
    // at least one of a spread of seeds differs (15 bits of entropy)
    const seen = new Set(["soul:1", "soul:2", "soul:3", "soul:4", "soul:5"].map((s) => sigilFromSeed(s).cells.join("")));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("mirrors: column x and 4-x always agree (5-wide from 3 unique)", () => {
    const spec = sigilFromSeed("addr:0xabc");
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 2; x++) {
        expect(sigilCellAt(spec, x, y)).toEqual(sigilCellAt(spec, 4 - x, y));
      }
    }
  });

  it("every lit cell carries a palette color; unlit never does", () => {
    for (const seed of ["a", "b", "soul:99", ""]) {
      const spec = sigilFromSeed(seed);
      for (let i = 0; i < 15; i++) {
        if (spec.cells[i]) expect(SIGIL_PALETTE).toContain(spec.colors[i]);
        else expect(spec.colors[i]).toBe("#000");
      }
    }
  });

  it("different seeds spread across shapes (not all-lit / not all-dark)", () => {
    const litCounts = ["x", "y", "z", "w", "v", "u"].map((s) => sigilFromSeed(s).cells.filter(Boolean).length);
    expect(litCounts.some((n) => n > 0 && n < 15)).toBe(true);
  });
});
