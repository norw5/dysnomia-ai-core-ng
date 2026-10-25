import { describe, expect, it } from "vitest";
import {
  computeFleetRow,
  computeFleetRows,
  FLEET_UNIT,
  rankFleetRows,
  scoreRowToJson,
  type FleetAgentState,
} from "@/chain/fleetScore";

/**
 * The four-pillar fleet score math (session 61 — the owner-fixed win laws:
 * onchain state deltas only, never subjective judging). These rows mirror
 * what the first-contact fork state produces: funded fresh agents, one
 * two-way cipher channel each, honest zeros elsewhere.
 */

const U = FLEET_UNIT;

function agent(partial: Partial<FleetAgentState> & { agent: string }): FleetAgentState {
  return {
    vessel: "vitruv",
    address: ("0x" + partial.agent.slice(-1)!.repeat(40)) as `0x${string}`,
    lau: null,
    yue: null,
    pls: { wallet: 1_000_000n * U, lau: 0n, yue: 0n },
    affection: { wallet: 0n, lau: 0n, yue: 0n },
    choa: { wallet: 0n, lau: 0n, yue: 0n },
    codeClaims: 0,
    gwats: 0,
    venuesOwned: 0,
    channels: [],
    settlesReceived: 0,
    attendanceReceived: 0,
    ...partial,
  };
}

describe("the ECONOMIC pillar (WPLS-anchored whole-unit points)", () => {
  it("sums PLS + Ⓐ + CHOA across wallet/LAU/YUE in whole units", () => {
    const row = computeFleetRow(agent({
      agent: "A",
      pls: { wallet: 1_000_000n * U + 5n, lau: 2n * U, yue: 0n }, // 5 wei truncates away
      affection: { wallet: 3n * U, lau: 0n, yue: 0n },
      choa: { wallet: 0n, lau: 0n, yue: 4n * U },
    }));
    expect(row.pillars.economic).toBe(1_000_000n + 2n + 3n + 4n);
    expect(row.counts.plsWhole).toBe(1_000_002n);
  });

  it("equal funding cancels — gas spend is the only differentiator", () => {
    const a = computeFleetRow(agent({ agent: "A" }));
    const b = computeFleetRow(agent({ agent: "B", pls: { wallet: 999_999n * U, lau: 0n, yue: 0n } }));
    expect(a.pillars.economic - b.pillars.economic).toBe(1n);
  });
});

describe("the DIPLOMATIC pillar (two-way ENCRYPT channels)", () => {
  it("a two-way channel (sent ∧ received) counts double; a one-way leg counts one", () => {
    const twoWay = computeFleetRow(agent({ agent: "A", channels: [{ peer: "B", sent: true, received: true }] }));
    const oneWay = computeFleetRow(agent({ agent: "C", channels: [{ peer: "B", sent: true, received: false }] }));
    expect(twoWay.pillars.diplomatic).toBe(2);
    expect(twoWay.counts.twoWayChannels).toBe(1);
    expect(oneWay.pillars.diplomatic).toBe(1);
    expect(oneWay.counts.oneWayChannels).toBe(1);
  });

  it("the first-contact shape: BOTH agents hold the same two-way channel — 2 points each", () => {
    const rows = computeFleetRows([
      agent({ agent: "A", channels: [{ peer: "B", sent: true, received: true }] }),
      agent({ agent: "B", channels: [{ peer: "A", sent: true, received: true }] }),
    ]);
    expect(rows.map((r) => r.pillars.diplomatic)).toEqual([2, 2]);
  });

  it("an unproven peer row (neither leg) counts nothing", () => {
    const row = computeFleetRow(agent({ agent: "A", channels: [{ peer: "B", sent: false, received: false }] }));
    expect(row.pillars.diplomatic).toBe(0);
  });
});

describe("TERRITORIAL + SOCIAL (counts from committed state deltas)", () => {
  it("claims + GWATs + owned venues add; settles received weigh double, attendance pairs single", () => {
    const row = computeFleetRow(agent({
      agent: "A",
      codeClaims: 2,
      gwats: 1,
      venuesOwned: 3,
      settlesReceived: 2,
      attendanceReceived: 3,
    }));
    expect(row.pillars.territorial).toBe(6);
    expect(row.pillars.social).toBe(2 * 2 + 3);
  });

  it("the fresh-agent honest zeros (first contact owns nothing yet)", () => {
    const row = computeFleetRow(agent({ agent: "A" }));
    expect(row.pillars.territorial).toBe(0);
    expect(row.pillars.social).toBe(0);
  });
});

describe("composition + ranking", () => {
  it("total is the transparent additive sum; ranking sorts total desc with the name tiebreak", () => {
    const a = computeFleetRow(agent({ agent: "A", channels: [{ peer: "B", sent: true, received: true }] }));
    const b = computeFleetRow(agent({ agent: "B" }));
    expect(a.total).toBe(a.pillars.economic + 2n);
    expect(rankFleetRows([b, a]).map((r) => r.agent)).toEqual(["A", "B"]);
    const c = computeFleetRow(agent({ agent: "C", channels: [{ peer: "B", sent: true, received: true }] }));
    expect(rankFleetRows([c, a]).map((r) => r.agent)).toEqual(["A", "C"]); // stable name order on ties
  });

  it("the JSON row carries decimal strings (recording snapshots are plain JSON)", () => {
    const j = scoreRowToJson(computeFleetRow(agent({ agent: "A" })));
    expect(j.economic).toBe("1000000");
    expect(j.total).toBe("1000000");
    expect(JSON.parse(JSON.stringify(j))).toEqual(j);
  });
});
