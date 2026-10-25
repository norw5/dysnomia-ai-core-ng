import { describe, expect, it } from "vitest";
import { encodeFunctionResult, toFunctionSelector, type Abi, type Address, type PublicClient } from "viem";
import index from "@abi/index.json";
import { _liveAtlasAbis, liveRenderRow } from "@/chain/liveAtlas";
import { heckeCoords, loadAtlasMath } from "@/state/atlas";

/**
 * The session-67 live-venue atlas reader: hand fragments pinned to the
 * generated index, the two-round trip (venue meta batch → perimeter HECKE
 * eth_call), and the dead-RPC / not-a-venue honesty (throws — callers
 * render "coords unavailable", never a phantom position).
 */

const VENUE = "0x5555555555555555555555555555555555555555" as Address;
const HECKE_ADDR = "0x29a924d9b0233026b9844f2afeb202f1791d7593" as Address;

function ok(v: unknown) {
  return { status: "success", result: v };
}

function fail(msg: string) {
  return { status: "failure", error: new Error(msg) };
}

function fakeClient(
  batch: unknown[],
  compliment: { longitude: bigint; latitude: bigint } | { error: Error }
) {
  return {
    multicall: async () => batch,
    call: async (req: { to: string }) => {
      if (req.to.toLowerCase() !== HECKE_ADDR) throw new Error("unexpected call target");
      if ("error" in compliment) throw compliment.error;
      return encodeFunctionResult({
        abi: _liveAtlasAbis.heckeComplimentAbi as unknown as Abi[],
        functionName: "Compliment",
        result: [compliment.longitude, compliment.latitude],
      });
    },
  } as unknown as PublicClient;
}

describe("liveAtlas (session-67 live-coordinate synthesis)", () => {
  it("the hand fragments match keccak selectors + the generated index", () => {
    expect(toFunctionSelector(_liveAtlasAbis.heckeComplimentAbi[0])).toBe("0x3353268d");
    expect(toFunctionSelector(_liveAtlasAbis.venueMetaAbi[2])).toBe("0xa138da0b");
    const hecke = (index as unknown as { Hecke: { selectors: Record<string, { name: string; mutability: string }> } }).Hecke.selectors;
    expect(hecke["0x3353268d"]?.name).toBe("Compliment");
    expect(hecke["0x3353268d"]?.mutability).toBe("view");
    const qing = (index as unknown as { QING: { selectors: Record<string, { name: string; mutability: string }> } }).QING.selectors;
    expect(qing["0xa138da0b"]?.name).toBe("Waat");
    expect(qing["0xa138da0b"]?.mutability).toBe("view");
  });

  it("synthesizes a full RenderRow from the live reads (coords == heckeCoords of the same ints)", async () => {
    const waat = 378814830703436350975436945425663138519237484768630413256454076449062763743n;
    const longitude = -2997199354317605840785995082216040074375754563771530840832866547481581850n;
    const latitude = 400000000000000000000000000000000000000000000000000000000000000000000000n;
    const client = fakeClient([ok("Live Venue"), ok("LVEN"), ok(waat)], { longitude, latitude });
    const { row, raw } = await liveRenderRow(client, VENUE, 12345);
    expect(raw).toEqual({ longitude, latitude });
    expect(row.a).toBe(VENUE.toLowerCase());
    expect(row.n).toBe("Live Venue");
    expect(row.s).toBe("LVEN");
    expect(row.w).toBe(waat.toString());
    expect(row.blk).toBe(12345);
    expect(row.sys).toBe(false);
    // the coords ARE the pure transform of the same inputs — no drift
    const math = await loadAtlasMath();
    expect(heckeCoords(waat, longitude, latitude, math)).toEqual({
      f: row.f,
      band: row.band,
      south: row.south,
      lon: row.lon,
      lat: row.lat,
      ln: row.ln,
    });
    expect(row.band).toBeGreaterThan(33);
    expect(row.band).toBeLessThan(90);
  });

  it("a venue whose Waat read fails throws the honest not-a-venue error", async () => {
    const client = fakeClient([ok("X"), fail("nope"), fail("nope")], { longitude: 1n, latitude: 1n });
    await expect(liveRenderRow(client, VENUE)).rejects.toThrow(/not readable as a venue/);
  });

  it("a dead HECKE read rejects (dead RPC throws — the caller renders unavailable)", async () => {
    const client = fakeClient([ok("X"), ok("Y"), ok(476733977057179n * 10n ** 57n)], {
      error: new Error("HTTP endpoint terminated"),
    });
    await expect(liveRenderRow(client, VENUE)).rejects.toThrow(/HTTP endpoint terminated/);
  });
});
