import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The fleet vessel channel (session-60, DESIGN.md amendment): the sim/demo
 * accent + callsign override. Amber + ATROPA-999 are the LAW — the override
 * applies only under the runtime-composite gate, never on a live RPC, and
 * purple stays out of the accent family entirely. The last block pins the
 * registry against the CSS preset blocks (both sides must move together).
 */

const backing = new Map<string, string>();
const location = { search: "" };
vi.stubGlobal("window", {
  localStorage: {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  },
  location,
});
const rootDataset: Record<string, string> = {};
vi.stubGlobal("document", {
  documentElement: {
    get dataset() {
      return rootDataset;
    },
  },
});

const v = await import("@/state/vessel");

const SIM_RPC = "http://127.0.0.1:8545";
const LIVE_RPC = "https://rpc.pulsechain.com";

beforeEach(() => {
  backing.clear();
  location.search = "";
  v.setVesselChoice(null, SIM_RPC);
});

describe("the default chrome is amber + ATROPA-999 (the law)", () => {
  it("nothing set → the default vessel, no data-vessel attribute", () => {
    expect(v.resolveVessel(SIM_RPC)).toBe(v.DEFAULT_VESSEL);
    expect(v.DEFAULT_VESSEL.callsign).toBe("ATROPA-999");
    expect(v.DEFAULT_VESSEL.role).toBe("RESEARCH_VESSEL");
    expect(v.DEFAULT_VESSEL.accent).toBe("#ffb000");
    v.applyVessel(SIM_RPC);
    expect(v.activeVessel().id).toBe(v.DEFAULT_VESSEL_ID);
    expect(rootDataset["vessel"]).toBeUndefined();
    expect(v.vesselThemed()).toBe(false);
  });

  it("an unknown stored id never themes — the default wins", () => {
    backing.set("dys.vessel.v1", "nonexistent");
    expect(v.resolveVessel(SIM_RPC).id).toBe(v.DEFAULT_VESSEL_ID);
  });
});

describe("the override applies when set — under the gate", () => {
  it("a fleet vessel themes a sim RPC end to end", () => {
    const applied = v.setVesselChoice("vitruv", SIM_RPC);
    expect(applied.callsign).toBe("VITRUV-3");
    expect(v.activeVessel().id).toBe("vitruv");
    expect(rootDataset["vessel"]).toBe("vitruv");
    expect(v.vesselThemed()).toBe(true);
  });

  it("the choice persists across a module reload (storage-backed)", async () => {
    v.setVesselChoice("kestrel", SIM_RPC);
    vi.resetModules();
    const fresh = await import("@/state/vessel");
    expect(fresh.resolveVessel(SIM_RPC).id).toBe("kestrel");
    // cleanup the fresh singleton for the next test
    backing.clear();
    fresh.setVesselChoice(null, SIM_RPC);
  });

  it("the ?vessel= query override wins over storage (dev builds)", () => {
    v.setVesselChoice("vitruv", SIM_RPC);
    location.search = "?vessel=meridian";
    expect(v.resolveVessel(SIM_RPC).id).toBe("meridian");
    location.search = "?vessel=bogus";
    expect(v.resolveVessel(SIM_RPC).id).toBe(v.DEFAULT_VESSEL_ID);
    location.search = "";
  });
});

describe("the gate — live chrome is structurally amber", () => {
  it("a known mainnet RPC never themes, even with a stored choice", () => {
    expect(v.vesselOverrideAllowed(LIVE_RPC)).toBe(false);
    v.setVesselChoice("kestrel", SIM_RPC);
    expect(v.resolveVessel(LIVE_RPC).id).toBe(v.DEFAULT_VESSEL_ID);
    v.applyVessel(LIVE_RPC);
    expect(rootDataset["vessel"]).toBeUndefined();
    expect(v.vesselThemed()).toBe(false);
  });

  it("vesselOverrideAllowed mirrors the SIM runtime-composite rule", () => {
    expect(v.vesselOverrideAllowed(SIM_RPC)).toBe(true);
    expect(v.vesselOverrideAllowed(LIVE_RPC)).toBe(false);
  });
});

describe("the CSS contract (registry ⇄ preset blocks)", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  it("every fleet vessel carries an accent preset block", () => {
    for (const preset of v.FLEET_VESSELS) {
      if (preset.id === v.DEFAULT_VESSEL_ID) continue;
      if (!css.includes(`:root[data-vessel="${preset.id}"]`)) {
        throw new Error(`${preset.id}: missing its :root[data-vessel] preset block`);
      }
    }
  });

  it("purple stays AI-core-only under every vessel — no preset touches it", () => {
    for (const preset of v.FLEET_VESSELS) {
      const start = css.indexOf(`:root[data-vessel="${preset.id}"]`);
      if (start === -1) continue;
      const end = css.indexOf("}", start);
      const block = css.slice(start, end);
      if (block.includes("--purple")) {
        throw new Error(`${preset.id}: the vessel preset must not re-point purple`);
      }
    }
  });

  it("the token law holds: --accent defaults to amber; --purple defined once, unchanged", () => {
    expect(css).toContain("--accent: #ffb000;");
    expect(css.match(/--purple: #c084fc;/g)).toHaveLength(1);
    // the amber aliases ride the accent family (so every legacy --amber rule
    // re-themes with a vessel)
    expect(css).toContain("--amber: var(--accent);");
  });
});
