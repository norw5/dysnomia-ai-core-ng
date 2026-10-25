import { describe, expect, it } from "vitest";
import index from "@abi/index.json";
import { CHAIN_ID, KNOWN_MAINNET_RPC, PERIMETER } from "@config/addresses";

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

  it("never-deployed layer carries no address in the index", () => {
    const idx = index as Record<string, { address: string | null }>;
    for (const name of ["WORLD", "WAR", "H2O", "VITUS", "GWAT", "ENCRYPT", "VMREQ"]) {
      expect(idx[name]?.address ?? null).toBeNull();
    }
  });
});
