import { describe, expect, it } from "vitest";
import {
  currentVenue,
  searchVenues,
  setCurrentVenue,
  subscribeCurrentVenue,
  type VenueRow,
} from "@/state/venueStore";

const SEED: VenueRow[] = [
  { a: "0xd127839b83cbf537c29b7d268c135f745a0da2e8", n: "Illinois Coin QING", s: "qILLINOIS", lat: -0.82, band: 86, blk: 22813947 },
  { a: "0x1299bbac80f7038c19c20843f80608bd80c14a74", n: "MrStu QING", s: "q🕊️", lat: 0.15, band: 83, blk: 22817129 },
  { a: "0xe41165bfd2c38a682289b2783d1e6e2e39e3766a", n: "Ozymandias QING", s: "q🐒", lat: 0.19, band: 68, blk: 22817747 },
  { a: "0xbfaa31c5eab4fcb21fe7cafcbbacb35593594589", n: "Heavenly Dragon QING", s: "q天龍 🐉", lat: 0.32, band: 55, blk: 22817767 },
];

describe("venue seed search (pure)", () => {
  it("empty query lists the head of the seed with an honest total", () => {
    const r = searchVenues(SEED, "", 2);
    expect(r.rows).toHaveLength(2);
    expect(r.total).toEqual(4);
  });

  it("matches names case-insensitively", () => {
    const r = searchVenues(SEED, "ozymandias");
    expect(r.total).toEqual(1);
    expect(r.rows[0]!.n).toEqual("Ozymandias QING");
  });

  it("matches symbols and address substrings", () => {
    expect(searchVenues(SEED, "qillinois").total).toEqual(1);
    expect(searchVenues(SEED, "0xd127839b").total).toEqual(1);
  });

  it("matches band exactly", () => {
    expect(searchVenues(SEED, "86").total).toEqual(1);
  });

  it("no match is empty, not an error", () => {
    const r = searchVenues(SEED, "no such venue anywhere");
    expect(r.total).toEqual(0);
    expect(r.rows).toHaveLength(0);
  });

  it("respects the render limit without lying about totals", () => {
    const big = Array.from({ length: 100 }, (_, i) => ({
      a: `0x${String(i).padStart(40, "0")}`,
      n: `Venue ${i}`,
      s: `q${i}`,
      lat: 0,
      band: i,
      blk: 22_000_000 + i,
    }));
    const r = searchVenues(big, "venue", 60);
    expect(r.rows).toHaveLength(60);
    expect(r.total).toEqual(100);
  });
});

describe("app-global current-venue store", () => {
  it("set + notify + clear", () => {
    const seen: (string | null | undefined)[] = [];
    const unsub = subscribeCurrentVenue(() => seen.push(currentVenue()?.a ?? null));
    setCurrentVenue(SEED[0]!);
    expect(currentVenue()?.a).toEqual(SEED[0]!.a);
    setCurrentVenue(null);
    expect(currentVenue()).toBeNull();
    unsub();
    setCurrentVenue(SEED[1]!);
    expect(seen).toEqual([SEED[0]!.a, null]); // no events after unsubscribe
    setCurrentVenue(null);
  });
});
