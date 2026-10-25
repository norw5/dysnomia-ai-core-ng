import { describe, expect, it } from "vitest";
import { heckeCoords, meridianOf, type AtlasMath } from "@/state/atlas";
import renderDoc from "../src/data/venue_render.json";
import atlasDoc from "../../data/venue_atlas_s32.json";

/**
 * The session-67 live-coordinate self-check: the app's `heckeCoords` (the
 * transform a LIVE venue's marker draws from) must reproduce EVERY seed
 * row from the atlas's RAW HECKE ints — the exact math
 * tools/dys_venue_render.py runs, pinned together. A drift here means the
 * live markers would land somewhere other than the seed's venues.
 */

interface AtlasRow {
  qing: string;
  waat_str: string;
  longitude: number | string;
  latitude: number | string;
  band: number;
  south_flip: boolean;
  lon_norm: number;
}

const atlas = atlasDoc as unknown as { _meta: { meridians: string[] }; venues: AtlasRow[] };
// NB: the ATLAS json stores its ints as JSON numbers (> 2^53 — JS-parsed
// lossy); the RENDER SEED ships meridians + pole as STRINGS (exact). The
// transform's constants come from the seed (what the app bundles); the
// atlas feeds waat (string, exact) + lon/lat (lossy — absorbed by the
// tolerances, the algorithm is what's pinned here).
const doc = renderDoc as unknown as { _meta: { meridians: string[]; pole: string } };
const math: AtlasMath = {
  meridians: doc._meta.meridians.map((s) => BigInt(s)),
  pole: BigInt(doc._meta.pole),
};

describe("heckeCoords — the app transform vs the shipped seed (the tool cross-check)", () => {
  it("the seed meta carries the 90-entry meridian table + the exact pole (Meridians[88]//333)", () => {
    expect(renderDoc._meta.meridians).toHaveLength(90);
    expect(math.pole).toBe(math.meridians[88]! / 333n);
  });

  it("meridianOf + the flip reproduce every atlas row's band (the table's pre/post-flip convention)", () => {
    for (const row of atlas.venues) {
      const mer = meridianOf(BigInt(row.waat_str), math.meridians);
      if (row.south_flip) {
        // flipped: the raw waat sits in band 89, the effective band is the mirror's
        expect(mer).toBe(89);
        const eff = meridianOf(math.meridians[89]! - BigInt(row.waat_str), math.meridians);
        expect(eff).toBe(row.band);
      } else {
        expect(mer).toBe(row.band);
      }
    }
  });

  it("recomputes EVERY seed row's coords from the raw ints (all rows — the count moves with regens)", () => {
    expect(renderDoc.venues.length).toBeGreaterThanOrEqual(917);
    let checked = 0;
    const byAddr = new Map(renderDoc.venues.map((r) => [r.a, r]));
    for (const row of atlas.venues) {
      const seed = byAddr.get(row.qing.toLowerCase());
      if (seed === undefined) throw new Error(`atlas venue missing from seed: ${row.qing}`);
      const c = heckeCoords(BigInt(row.waat_str), BigInt(row.longitude), BigInt(row.latitude), math);
      expect(c.band).toBe(seed.band);
      expect(c.south).toBe(seed.south);
      expect(Math.abs(c.f - seed.f)).toBeLessThan(1e-9);
      expect(Math.abs(c.ln - seed.ln)).toBeLessThan(1e-9);
      expect(Math.abs(c.lon - seed.lon)).toBeLessThan(1e-4);
      expect(Math.abs(c.lat - seed.lat)).toBeLessThan(1e-4);
      checked++;
    }
    expect(checked).toBe(renderDoc.venues.length);
  });

  it("clamps pathological inputs instead of NaN-ing the canvas", () => {
    const c = heckeCoords(0n, 0n, 0n, math);
    expect(Number.isFinite(c.f)).toBe(true);
    expect(Number.isFinite(c.lon)).toBe(true);
    expect(Number.isFinite(c.lat)).toBe(true);
    expect(Number.isFinite(c.ln)).toBe(true);
  });
});
