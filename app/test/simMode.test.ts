import { describe, expect, it } from "vitest";
import { PERIMETER, addr, type ContractName } from "@config/addresses";
import { isLocalForkRpc } from "@/chain/rpc";
import {
  SIM_LAYER_NAMES,
  simAddr,
  simEntryEnabled,
  simLayerActive,
  simLayerConfig,
} from "@/chain/simMode";

/**
 * The SIM overlay seam (session 58, IA-PLAN §8): the never-deployed layer's
 * fork-fixture addresses resolve ONLY in sim mode; the LIVE perimeter is
 * structurally unable to serve them. Pairs with addresses.test.ts (the
 * live-side no-address pins) and the harness set-3 suite (which generates
 * config/sim_addresses.json in the first place).
 */

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const FORK_RPC = "http://127.0.0.1:8545";
const MAINNET_RPC = "https://rpc.pulsechain.com";

describe("SIM overlay (config/sim_addresses.json)", () => {
  it("carries the full layer with valid addresses + a recorded pin", () => {
    expect(typeof simLayerConfig.pin).toBe("number");
    for (const name of SIM_LAYER_NAMES) {
      const a = simLayerConfig.layer[name];
      if (!a || !ADDRESS_RE.test(a)) throw new Error(`${name}: ${a}`);
    }
    expect(simLayerConfig.deployedBy.toLowerCase()).toMatch(ADDRESS_RE);
    expect(simLayerConfig.variants.length).toBeGreaterThan(0);
  });

  it("layer addresses are disjoint from the LIVE perimeter", () => {
    const live = new Set(Object.values(PERIMETER).map((a) => a.toLowerCase()));
    for (const name of SIM_LAYER_NAMES) {
      if (live.has(simLayerConfig.layer[name]!.toLowerCase())) {
        throw new Error(`${name}: SIM fixture address collides with the live perimeter`);
      }
    }
  });

  it("the live table structurally cannot serve layer names", () => {
    for (const name of SIM_LAYER_NAMES) {
      expect(() => addr(name as ContractName)).toThrow();
    }
  });
});

describe("simMode resolution law (runtime composite)", () => {
  // vitest runs with DEV=true → simEntryEnabled is true here; the
  // build-flag-off behavior is covered by the resolution rules below.
  it("simEntryEnabled is true in dev/test builds", () => {
    expect(simEntryEnabled).toBe(true);
  });

  it("active only for non-mainnet endpoints", () => {
    expect(simLayerActive(FORK_RPC)).toBe(true);
    expect(simLayerActive(MAINNET_RPC)).toBe(false);
  });

  it("resolves every layer name on a fork rpc", () => {
    for (const name of SIM_LAYER_NAMES) {
      expect(simAddr(name, FORK_RPC)).toMatch(ADDRESS_RE);
    }
  });

  it("refuses resolution on known mainnet (structural, never a fallback)", () => {
    for (const name of SIM_LAYER_NAMES) {
      expect(() => simAddr(name, MAINNET_RPC)).toThrow(/outside sim mode/);
    }
  });

  it("isLocalForkRpc classification matches (the seam rides the loopback allowlist)", () => {
    expect(isLocalForkRpc(FORK_RPC)).toBe(true);
    expect(isLocalForkRpc("http://localhost:8545")).toBe(true);
    expect(isLocalForkRpc("http://[::1]:8545")).toBe(true);
    expect(isLocalForkRpc("http://127.0.0.2:8545")).toBe(true);
    expect(isLocalForkRpc(MAINNET_RPC)).toBe(false);
    // session-81: a custom REAL RPC is LIVE, never SIM (the denylist bug)
    expect(isLocalForkRpc("https://my-own-pulsechain-node.example")).toBe(false);
    expect(simLayerActive("https://my-own-pulsechain-node.example")).toBe(false);
  });
});
