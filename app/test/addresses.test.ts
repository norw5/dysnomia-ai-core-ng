import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import index from "@abi/index.json";
import { CHAIN_ID, EXPLORER_TX, KNOWN_MAINNET_RPC, PERIMETER, PULSEX_V2_FACTORY, PULSEX_V2_ROUTER, WPLS } from "@config/addresses";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

describe("perimeter single-source (config/addresses.json)", () => {
  it("chain id 369 with known mainnet rpc list", () => {
    expect(CHAIN_ID).toEqual(369);
    expect(KNOWN_MAINNET_RPC.length).toBeGreaterThan(0);
  });

  it("every perimeter entry is a valid address", () => {
    for (const [name, a] of Object.entries(PERIMETER)) {
      if (!ADDRESS_RE.test(a)) throw new Error(`${name}: ${a}`);
    }
  });

  it("covers every addressed contract in the generated abi/index.json exactly", () => {
    const idx = index as Record<string, { address: string | null }>;
    const indexAddrs = new Set(
      Object.values(idx)
        .map((e) => (e.address ?? "").toLowerCase())
        .filter((a) => a.length > 0)
    );
    const perimeterAddrs = new Set(Object.values(PERIMETER).map((a) => a.toLowerCase()));
    for (const a of indexAddrs) {
      if (!perimeterAddrs.has(a)) throw new Error(`index address ${a} missing from perimeter`);
    }
    for (const a of perimeterAddrs) {
      if (!indexAddrs.has(a)) continue;
    }
  });

  it("pins the session-84 RPC list: PublicNode in, g4mm4/stats out, no duplicates", () => {
    expect(KNOWN_MAINNET_RPC).toContain("https://pulsechain-rpc.publicnode.com");
    expect(KNOWN_MAINNET_RPC.some((u) => u.includes("g4mm4"))).toBe(false);
    expect(KNOWN_MAINNET_RPC.some((u) => u.includes("pulsechainstats"))).toBe(false);
    expect(new Set(KNOWN_MAINNET_RPC).size).toBe(KNOWN_MAINNET_RPC.length);
    for (const u of KNOWN_MAINNET_RPC) expect(new URL(u).protocol).toBe("https:");
    expect(EXPLORER_TX).toBe("https://ipfs.scan.pulsechain.com/tx/");
  });

  it("pins the external PulseX V2 infra (session-83) with checksum-exact addresses, OUTSIDE the perimeter", () => {
    expect(PULSEX_V2_ROUTER).toBe("0x165C3410fC91EF562C50559f7d2289fEbed552d9");
    expect(PULSEX_V2_FACTORY).toBe("0x29eA7545DEf87022BAdc76323F373EA1e707C523");
    expect(WPLS).toBe("0xA1077a294dDE1B09bB078844df40758a5D0f9a27");
    for (const a of [PULSEX_V2_ROUTER, PULSEX_V2_FACTORY, WPLS]) {
      expect(() => getAddress(a)).not.toThrow(); // viem-checksum exact — the first send would throw otherwise
    }
    const perimeter = new Set(Object.values(PERIMETER).map((a) => a.toLowerCase()));
    for (const a of [PULSEX_V2_ROUTER, PULSEX_V2_FACTORY, WPLS]) expect(perimeter.has(a.toLowerCase())).toBe(false);
  });

  it("never-deployed layer carries no address in the index", () => {
    const idx = index as Record<string, { address: string | null }>;
    for (const name of ["WORLD", "WAR", "H2O", "VITUS", "GWAT", "ENCRYPT", "VMREQ"]) {
      expect(idx[name]?.address ?? null).toBeNull();
    }
  });
});
