import type { Address, PublicClient } from "viem";
import { loadPlayerSnapshot } from "@/chain/identity";
import { readSoulId } from "@/chain/encryptDesk";
import { computeFleetRows, rankFleetRows, scoreRowToJson, type FleetAgentState, type FleetCipherChannel, type FleetScoreRow } from "@/chain/fleetScore";
import type { Recording } from "@/agent/recording";

/**
 * The fleet-state composer (session 61): roster + recording → the pure
 * score module's input. STATE DELTAS ONLY (the win law):
 *
 * - ECONOMIC reads live through the SAME anonymous snapshot reader the app
 *   uses (loadPlayerSnapshot — wallet/LAU/YUE discovery + balances, one
 *   batch per agent); a per-agent read failure surfaces honestly, an
 *   ALL-agents failure is a dead RPC and throws (the session-41 viem
 *   lesson — never render "owns nothing" for a dead endpoint).
 * - TERRITORIAL / DIPLOMATIC / SOCIAL counts derive from the recording's
 *   COMMITTED receipts (tool results carrying status "sent" + the receipt
 *   decodes the tools already did — world_code claims, spawn_gwat's
 *   NewQing, create_venue/take_venue venue lists, encrypt/decrypt
 *   round-trips, settles/joins at owned venues). Souls resolve live per
 *   roster LAU (Saat[1]) so cipher peers map to roster names without
 *   trusting the recording's own labels.
 */

export interface FleetComposeResult {
  states: FleetAgentState[];
  rows: FleetScoreRow[];
  ranked: FleetScoreRow[];
  errors: string[];
}

function res(r: unknown): Record<string, unknown> | null {
  return typeof r === "object" && r !== null ? (r as Record<string, unknown>) : null;
}

/**
 * Read a send-leg field from a recorded tool result. The tool layer caps
 * outputs at 2560 chars (`capOutput` — the mint chains' movements are
 * bulky); the lean SEND results keep the leg fields FIRST so a truncated
 * head still carries them — this reader accepts either shape, never
 * invents a value the result does not actually contain.
 */
function legField(r: Record<string, unknown>, key: string): string | boolean | null {
  const v = r[key];
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (r["truncated"] === true && typeof r["head"] === "string") {
    const m = new RegExp(`"${key}":("([^"]*)"|true|false)`).exec(r["head"] as string);
    if (m !== null) return m[2] ?? (m[1] === "true");
  }
  return null;
}

interface SendLeg {
  agent: string;
  tool: string;
  venue: string | null;
  toSoul: string | null;
  fromSoul: string | null;
  spawned: string | null;
}

/** walk the recording's tool results → the committed send legs (state deltas) */
export function sendLegsFromRecording(rec: Recording): SendLeg[] {
  const legs: SendLeg[] = [];
  for (const ev of rec.events) {
    if (ev.e.type !== "tool-result" || !ev.e.ok) continue;
    const r = res(ev.e.result);
    if (r === null || legField(r, "mode") !== "SEND" || legField(r, "status") !== "sent") continue;
    const strField = (key: string): string | null => {
      const v = legField(r, key);
      return typeof v === "string" ? v : null;
    };
    legs.push({
      agent: ev.agent,
      tool: ev.e.name,
      venue: strField("venue"),
      toSoul: strField("toSoul"),
      fromSoul: strField("from"),
      spawned: strField("spawned"),
    });
  }
  return legs;
}

export async function loadFleetStates(
  client: PublicClient,
  roster: Recording["roster"],
  rec: Recording | null
): Promise<FleetComposeResult> {
  const errors: string[] = [];
  const legs = rec !== null ? sendLegsFromRecording(rec) : [];

  // souls resolve LIVE (the recording's own labels are replay data, not truth)
  const soulByAgent = new Map<string, string>();
  for (const row of roster) {
    if (row.lau === null) continue;
    const soul = await readSoulId(client, row.lau as Address);
    if (soul !== null) soulByAgent.set(row.name, soul.toString());
  }
  const agentBySoul = new Map<string, string>();
  for (const [name, soul] of soulByAgent) agentBySoul.set(soul, name);

  // the receipt-derived venue ownership map (venues THIS run's agents took/created)
  const venuesOwnedBy = new Map<string, string>(); // venue(lower) → agent name
  for (const leg of legs) {
    if (leg.tool === "take_venue" || leg.tool === "create_venue") {
      const v = leg.venue ?? leg.spawned;
      if (v !== null) venuesOwnedBy.set(v.toLowerCase(), leg.agent);
    }
  }

  const states: FleetAgentState[] = [];
  let readFailures = 0;
  for (const row of roster) {
    const snap = await loadPlayerSnapshot(client, row.address as Address).catch((e: unknown) => {
      readFailures += 1;
      errors.push(`${row.name}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    if (snap === null) continue;
    const myLegs = legs.filter((l) => l.agent === row.name);
    const codeClaims = myLegs.filter((l) => l.tool === "world_code").length;
    const gwats = myLegs.filter((l) => l.tool === "spawn_gwat" && l.spawned !== null).length;

    // cipher channels: my Encrypt sends (to soul) + my consumed Decrypts (from soul)
    const peers = new Map<string, FleetCipherChannel>();
    for (const leg of myLegs) {
      if (leg.tool === "encrypt_note" && leg.toSoul !== null) {
        const peer = agentBySoul.get(leg.toSoul) ?? `soul:${leg.toSoul}`;
        const ch = peers.get(peer) ?? { peer, sent: false, received: false };
        ch.sent = true;
        peers.set(peer, ch);
      }
      if (leg.tool === "decrypt_note" && leg.fromSoul !== null) {
        const peer = agentBySoul.get(leg.fromSoul) ?? `soul:${leg.fromSoul}`;
        const ch = peers.get(peer) ?? { peer, sent: false, received: false };
        ch.received = true;
        peers.set(peer, ch);
      }
    }

    // social: OTHER agents' settles/joins at venues this agent owns
    const myVenues = new Set([...venuesOwnedBy.entries()].filter(([, owner]) => owner === row.name).map(([v]) => v));
    let settlesReceived = 0;
    const attendancePairs = new Set<string>();
    for (const leg of legs) {
      if (leg.agent === row.name || leg.venue === null) continue;
      const v = leg.venue.toLowerCase();
      if (!myVenues.has(v)) continue;
      if (leg.tool === "settle_venue") settlesReceived += 1;
      if (leg.tool === "settle_venue" || leg.tool === "join_venue") attendancePairs.add(`${leg.agent}:${v}`);
    }

    states.push({
      agent: row.name,
      vessel: row.vessel,
      address: row.address as Address,
      lau: row.lau as Address | null,
      yue: row.yue as Address | null,
      pls: snap.balances.pls,
      affection: snap.balances.affection,
      choa: snap.balances.choa,
      codeClaims,
      gwats,
      venuesOwned: myVenues.size,
      channels: [...peers.values()],
      settlesReceived,
      attendanceReceived: attendancePairs.size,
    });
  }
  // the viem lesson: ALL agents failing is a dead RPC — never "an empty fleet"
  if (states.length === 0 && roster.length > 0 && readFailures === roster.length) {
    throw new Error(errors[0] ?? "fleet reads failed");
  }
  const rows = computeFleetRows(states);
  return { states, rows, ranked: rankFleetRows(rows), errors };
}

/** rows for a recording's own score snapshots (no RPC — the honest offline view) */
export function rowsFromScoreSnapshots(rec: Recording): FleetScoreRow[] {
  const snap = rec.scores.length > 0 ? rec.scores[rec.scores.length - 1] : undefined;
  if (snap === undefined) return [];
  return snap.rows.map((r) => ({
    agent: r.agent,
    vessel: r.vessel,
    pillars: {
      economic: BigInt(r.economic),
      territorial: Number(r.territorial),
      diplomatic: Number(r.diplomatic),
      social: Number(r.social),
    },
    total: BigInt(r.total),
    counts: {
      plsWhole: 0n,
      affectionWhole: 0n,
      choaWhole: 0n,
      twoWayChannels: 0,
      oneWayChannels: 0,
      codeClaims: 0,
      gwats: 0,
      venuesOwned: 0,
      settlesReceived: 0,
      attendanceReceived: 0,
    },
  }));
}

export { scoreRowToJson };
