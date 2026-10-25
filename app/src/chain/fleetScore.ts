import type { Address } from "viem";

/**
 * The four-pillar fleet score (session 61; the win laws the owner round at
 * the 59 close fixed — "all from onchain state, state deltas only, never
 * subjective judging"):
 *
 *   ECONOMIC    — the WPLS-anchored portfolio across wallet/LAU/YUE: PLS is
 *                 the anchor figure (never pseudo-USD); Ⓐ/CHOA positions
 *                 count as whole-unit points, unpriced (no rate is invented
 *                 here — venue Ⓐ rates are per-venue and do not compose).
 *   TERRITORIAL — WORLD.Code claims + GWAT spawns + venues owned.
 *   DIPLOMATIC  — ENCRYPT channels: a TWO-WAY channel (A sealed, B's
 *                 committed Decrypt consumed it — and the reply direction)
 *                 counts double; a proven one-way leg counts one.
 *   SOCIAL      — activity RECEIVED at venues you own: settles by others
 *                 (CHEON.Su receipts at your venue) weigh double, distinct
 *                 other-agent attendance pairs count one.
 *
 * PURE by law: the module takes already-read state (the runner + the
 * observer compose inputs through chain/fleetReads.ts) so the harness can
 * assert the math against known fork state, and the widget renders the same
 * rows a recording's score snapshots carry. Composition = transparent
 * additive points (the 62 flagship may re-weight when the owner tunes the
 * game — pillars always render separately).
 */

export interface FleetTriBalances {
  wallet: bigint;
  lau: bigint;
  yue: bigint;
}

export interface FleetCipherChannel {
  /** the peer roster agent's name */
  peer: string;
  /** this agent's Encrypt to the peer landed (committed) */
  sent: boolean;
  /** this agent's committed Decrypt consumed a note from the peer */
  received: boolean;
}

export interface FleetAgentState {
  agent: string;
  vessel: string;
  address: Address;
  lau: Address | null;
  yue: Address | null;
  pls: FleetTriBalances;
  affection: FleetTriBalances;
  choa: FleetTriBalances;
  /** successful WORLD.Code sends by this agent (SIM layer) */
  codeClaims: number;
  /** venues this agent spawned through GWAT (NewQing receipts, parent guard) */
  gwats: number;
  /** QINGs where the two-arg owner(address) answers true for the agent */
  venuesOwned: number;
  /** proven cipher channels (from committed Encrypt/Decrypt receipts) */
  channels: FleetCipherChannel[];
  /** successful CHEON.Su sends by OTHER agents at venues this agent owns */
  settlesReceived: number;
  /** distinct (other agent, venue this agent owns) pairs with nonzero attendance bars */
  attendanceReceived: number;
}

export interface FleetPillars {
  /** whole-unit portfolio points: PLS + Ⓐ + CHOA across wallet/LAU/YUE */
  economic: bigint;
  territorial: number;
  diplomatic: number;
  social: number;
}

export interface FleetScoreRow {
  agent: string;
  vessel: string;
  pillars: FleetPillars;
  /** additive transparent points — economic + territorial + diplomatic + social */
  total: bigint;
  /** the legible counts behind the pillars (render + assert material) */
  counts: {
    plsWhole: bigint;
    affectionWhole: bigint;
    choaWhole: bigint;
    twoWayChannels: number;
    oneWayChannels: number;
    codeClaims: number;
    gwats: number;
    venuesOwned: number;
    settlesReceived: number;
    attendanceReceived: number;
  };
}

export const FLEET_UNIT = 10n ** 18n;

/** whole-unit truncation (points are integers by design) */
function whole(wei: bigint): bigint {
  return wei / FLEET_UNIT;
}

function sumTri(t: FleetTriBalances): bigint {
  return t.wallet + t.lau + t.yue;
}

export function computeFleetRow(state: FleetAgentState): FleetScoreRow {
  const plsWhole = whole(sumTri(state.pls));
  const affectionWhole = whole(sumTri(state.affection));
  const choaWhole = whole(sumTri(state.choa));
  const economic = plsWhole + affectionWhole + choaWhole;

  let twoWay = 0;
  let oneWay = 0;
  for (const ch of state.channels) {
    if (ch.sent && ch.received) twoWay += 1;
    else if (ch.sent || ch.received) oneWay += 1;
  }
  const territorial = state.codeClaims + state.gwats + state.venuesOwned;
  const diplomatic = twoWay * 2 + oneWay;
  const social = state.settlesReceived * 2 + state.attendanceReceived;
  const pillars: FleetPillars = { economic, territorial, diplomatic, social };
  return {
    agent: state.agent,
    vessel: state.vessel,
    pillars,
    total: economic + BigInt(territorial) + BigInt(diplomatic) + BigInt(social),
    counts: {
      plsWhole,
      affectionWhole,
      choaWhole,
      twoWayChannels: twoWay,
      oneWayChannels: oneWay,
      codeClaims: state.codeClaims,
      gwats: state.gwats,
      venuesOwned: state.venuesOwned,
      settlesReceived: state.settlesReceived,
      attendanceReceived: state.attendanceReceived,
    },
  };
}

export function computeFleetRows(states: FleetAgentState[]): FleetScoreRow[] {
  return states.map(computeFleetRow);
}

/** the scoreboard order: total desc, name asc as the stable tiebreak */
export function rankFleetRows(rows: FleetScoreRow[]): FleetScoreRow[] {
  return [...rows].sort((a, b) => (a.total !== b.total ? (a.total > b.total ? -1 : 1) : a.agent.localeCompare(b.agent)));
}

/** decimal-string row (the recording's score snapshots are JSON documents) */
export function scoreRowToJson(row: FleetScoreRow): {
  agent: string;
  vessel: string;
  economic: string;
  territorial: string;
  diplomatic: string;
  social: string;
  total: string;
} {
  return {
    agent: row.agent,
    vessel: row.vessel,
    economic: row.pillars.economic.toString(),
    territorial: row.pillars.territorial.toString(),
    diplomatic: row.pillars.diplomatic.toString(),
    social: row.pillars.social.toString(),
    total: row.total.toString(),
  };
}
