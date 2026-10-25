import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadFleetStates, sendLegsFromRecording } from "@/chain/fleetReads";
import { RecordingWriter, parseRecording } from "@/agent/recording";

/**
 * The fleet-state composer (session 61): roster + recording → the pure
 * score module's input. Souls resolve LIVE (the recording's labels are
 * replay data, never truth), channels map peers by soul, venue ownership
 * rides the committed take/create receipts, and social counts only OTHER
 * agents' activity at venues YOU own. Reads are mocked at the module seams.
 */

const ACCT_A = "0x" + "a1".repeat(20);
const ACCT_B = "0x" + "b2".repeat(20);
const LAU_A = "0x" + "aa".repeat(20);
const LAU_B = "0x" + "bb".repeat(20);
const VENUE_OWNED = "0x" + "cc".repeat(20);
const VENUE_OTHER = "0x" + "dd".repeat(20);
const SOUL_A = 4242n;
const SOUL_B = 7777n;

vi.mock("@/chain/identity", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadPlayerSnapshot: vi.fn(async (_client: unknown, account: string) => ({
    account,
    lau: account === ACCT_A ? LAU_A : LAU_B,
    yue: null,
    balances: {
      pls: { wallet: 1_000_000n * 10n ** 18n, lau: 0n, yue: 0n },
      affection: { wallet: 0n, lau: 0n, yue: 0n },
      choa: { wallet: 0n, lau: 0n, yue: 0n },
    },
  })),
}));

vi.mock("@/chain/encryptDesk", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readSoulId: vi.fn(async (_client: unknown, lau: string) => (lau === LAU_A ? SOUL_A : SOUL_B)),
}));

function okSend(agent: string, tool: string, extra: Record<string, unknown>) {
  return { type: "tool-result" as const, id: `c-${agent}-${tool}`, name: tool, result: { mode: "SEND", status: "sent", ...extra }, ok: true };
}

function recordingWith(events: Parameters<RecordingWriter["append"]>[2][], agents: string[]) {
  const w = new RecordingWriter({
    rpc: "http://127.0.0.1:8547",
    forkBlock: 27_674_000,
    roster: [
      { name: "AGENT-1", address: ACCT_A, lau: LAU_A, yue: null, vessel: "vitruv" },
      { name: "AGENT-2", address: ACCT_B, lau: LAU_B, yue: null, vessel: "kestrel" },
    ],
  });
  events.forEach((e, i) => w.append(agents[i] ?? "AGENT-1", 1, e));
  return parseRecording(JSON.stringify(w.current()));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendLegsFromRecording", () => {
  it("keeps only ok SEND results (DRYRUNs and failures are not state deltas)", () => {
    const rec = recordingWith(
      [
        okSend("x", "encrypt_note", { to: String(SOUL_B) }),
        { type: "tool-result", id: "d", name: "encrypt_note", result: { mode: "DRYRUN" }, ok: true },
        { type: "tool-result", id: "e", name: "settle_venue", result: { mode: "SEND", status: "aborted" }, ok: true },
        { type: "tool-result", id: "f", name: "world_code", result: { mode: "SEND", status: "sent" }, ok: false },
      ],
      ["AGENT-1", "AGENT-1", "AGENT-1", "AGENT-1"],
    );
    const legs = sendLegsFromRecording(rec);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.tool).toBe("encrypt_note");
  });
});

describe("loadFleetStates", () => {
  it("maps cipher peers BY LIVE SOUL (the recording's own labels are not truth)", async () => {
    const rec = recordingWith(
      [
        okSend("a", "encrypt_note", { toSoul: String(SOUL_B), index: "1" }),
        okSend("b", "decrypt_note", { from: String(SOUL_A), consumed: true }),
        okSend("b", "encrypt_note", { toSoul: String(SOUL_A), index: "2" }),
        okSend("a", "decrypt_note", { from: String(SOUL_B), consumed: true }),
      ],
      ["AGENT-1", "AGENT-2", "AGENT-2", "AGENT-1"],
    );
    const out = await loadFleetStates({} as never, rec.roster, rec);
    const a = out.states.find((s) => s.agent === "AGENT-1")!;
    const b = out.states.find((s) => s.agent === "AGENT-2")!;
    expect(a.channels).toEqual([{ peer: "AGENT-2", sent: true, received: true }]);
    expect(b.channels).toEqual([{ peer: "AGENT-1", sent: true, received: true }]);
    expect(out.ranked[0]!.pillars.diplomatic).toBe(2);
  });

  it("an unknown soul maps to a soul: peer row (never a wrong agent)", async () => {
    const rec = recordingWith([okSend("a", "encrypt_note", { toSoul: "999" })], ["AGENT-1"]);
    const out = await loadFleetStates({} as never, rec.roster, rec);
    expect(out.states[0]!.channels[0]!.peer).toBe("soul:999");
    expect(out.states[0]!.channels[0]!.sent).toBe(true);
  });

  it("venue ownership rides take/create receipts; social counts only OTHERS at MY venues", async () => {
    const rec = recordingWith(
      [
        okSend("a", "take_venue", { venue: VENUE_OWNED }),
        okSend("b", "settle_venue", { venue: VENUE_OWNED }),   // at A's venue → social
        okSend("b", "join_venue", { venue: VENUE_OWNED }),     // attendance pair
        okSend("b", "settle_venue", { venue: VENUE_OTHER }),   // not A's → no social
        okSend("a", "settle_venue", { venue: VENUE_OWNED }),   // self → never social
      ],
      ["AGENT-1", "AGENT-2", "AGENT-2", "AGENT-2", "AGENT-1"],
    );
    const out = await loadFleetStates({} as never, rec.roster, rec);
    const a = out.states.find((s) => s.agent === "AGENT-1")!;
    expect(a.venuesOwned).toBe(1);
    expect(a.settlesReceived).toBe(1);
    expect(a.attendanceReceived).toBe(1);
    const b = out.states.find((s) => s.agent === "AGENT-2")!;
    expect(b.settlesReceived).toBe(0);
  });

  it("a dead RPC (every agent's read failing) throws — never an empty fleet", async () => {
    const { loadPlayerSnapshot } = await import("@/chain/identity");
    vi.mocked(loadPlayerSnapshot).mockRejectedValue(new Error("transport dead"));
    const rec = recordingWith([], []);
    await expect(loadFleetStates({} as never, rec.roster, rec)).rejects.toThrow(/transport dead/);
  });
});
