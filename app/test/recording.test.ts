import { describe, expect, it } from "vitest";
import {
  RecordingWriter,
  parseRecording,
  scoreAt,
  seekRecording,
  serializeRecording,
  type RecordingScoreRow,
} from "@/agent/recording";

/**
 * The fleet recording format (session 61): the write → parse → seek
 * round-trip law — versioned envelope, append-only monotone indices,
 * actor-attributed events, score snapshots keyed by event index. This is
 * 62's replay input; the format must refuse honest rather than guess.
 */

function row(agent: string, total: string): RecordingScoreRow {
  return { agent, vessel: "vitruv", economic: "10", territorial: "0", diplomatic: "2", social: "0", total };
}

describe("the writer → serialize → parse round-trip", () => {
  it("captures attributed events with monotone indices and re-parses identically", () => {
    const w = new RecordingWriter({ rpc: "http://127.0.0.1:8547", forkBlock: 27_674_000, roster: [
      { name: "AGENT-1", address: "0x1", lau: null, yue: null, vessel: "vitruv" },
      { name: "AGENT-2", address: "0x2", lau: null, yue: null, vessel: "kestrel" },
    ] });
    w.append("AGENT-1", 1, { type: "turn-start" });
    w.append("AGENT-1", 1, { type: "tool-call", id: "c1", name: "encrypt_note", args: { to: "9" } });
    w.append("AGENT-1", 1, { type: "tool-result", id: "c1", name: "encrypt_note", result: { status: "sent", index: "4242" }, ok: true });
    w.append("AGENT-2", 1, { type: "tool-result", id: "c2", name: "decrypt_note", result: { status: "sent", consumed: true }, ok: true });
    w.snapshotScore([row("AGENT-1", "12"), row("AGENT-2", "12")]);
    const rec = w.finish();

    const text = serializeRecording(rec);
    const back = parseRecording(text);
    expect(back.v).toBe(1);
    expect(back.kind).toBe("fleet-run");
    expect(back.forkBlock).toBe(27_674_000);
    expect(back.events.map((e) => e.i)).toEqual([0, 1, 2, 3]);
    expect(back.events.map((e) => e.agent)).toEqual(["AGENT-1", "AGENT-1", "AGENT-1", "AGENT-2"]);
    expect(back.events[2]!.e).toMatchObject({ type: "tool-result", name: "encrypt_note" });
    expect(back.scores).toHaveLength(1);
    expect(back.scores[0]!.atEvent).toBe(3); // keyed to the LAST appended event
    expect(back.finished).not.toBeNull();
  });

  it("seek slices the prefix (the replay scrub primitive) and scoreAt finds the latest snapshot at-or-before", () => {
    const w = new RecordingWriter({ rpc: "http://x", forkBlock: null, roster: [] });
    for (let i = 0; i < 5; i++) w.append("A", 1, { type: "turn-start" });
    w.snapshotScore([row("A", "1")]);
    for (let i = 0; i < 5; i++) w.append("A", 2, { type: "turn-start" });
    w.snapshotScore([row("A", "2")]);
    const rec = parseRecording(serializeRecording(w.finish()));

    expect(seekRecording(rec, -1)).toHaveLength(0);
    expect(seekRecording(rec, 2).map((e) => e.i)).toEqual([0, 1, 2]);
    expect(seekRecording(rec, 999)).toHaveLength(10); // clamps
    expect(scoreAt(rec, 4)?.rows[0]?.total).toBe("1");
    expect(scoreAt(rec, 10)?.rows[0]?.total).toBe("2");
    expect(scoreAt(rec, 0)).toBeNull(); // nothing composed before the first snapshot's key
  });
});

describe("the parser refuses honestly", () => {
  const valid = () => {
    const w = new RecordingWriter({ rpc: "http://x", forkBlock: null, roster: [] });
    w.append("A", 1, { type: "turn-start" });
    return serializeRecording(w.finish());
  };

  it("rejects invalid JSON, wrong version, wrong kind, shape damage", () => {
    for (const [label, doc] of [
      ["not json", "{"],
      ["version", JSON.stringify({ ...JSON.parse(valid()), v: 2 })],
      ["kind", JSON.stringify({ ...JSON.parse(valid()), kind: "other" })],
      ["missing roster", JSON.stringify({ ...JSON.parse(valid()), roster: undefined })],
    ] as const) {
      try {
        parseRecording(doc);
        expect.unreachable(`${label} should have refused`);
      } catch (e) {
        expect(e instanceof Error && e.message.startsWith("not a fleet recording"), label).toBe(true);
      }
    }
  });

  it("rejects a non-append-only event stream (index tampering) and out-of-range score keys", () => {
    const tampered = JSON.parse(valid()) as Record<string, unknown>;
    (tampered["events"] as Array<Record<string, unknown>>)[0]!["i"] = 7;
    expect(() => parseRecording(JSON.stringify(tampered))).toThrow(/append-only/);

    const badScore = JSON.parse(valid()) as Record<string, unknown>;
    (badScore["scores"] as unknown[]) = [{ atEvent: 99, t: 1, rows: [] }];
    expect(() => parseRecording(JSON.stringify(badScore))).toThrow(/points past the stream/);
  });

  it("an empty roster parses (in-app operator captures) — composing a fleet from it is the store's honest error", () => {
    const rec = parseRecording(valid());
    expect(rec.roster).toEqual([]);
  });
});

describe("the JSON-safety law (no bigint reaches the wire)", () => {
  it("serializes without loss for usage/tool args carrying numbers + strings", () => {
    const w = new RecordingWriter({ rpc: "http://x", forkBlock: null, roster: [] });
    w.append("A", 1, { type: "usage", usage: { prompt_tokens: 32, completion_tokens: 24, total_tokens: 56 } });
    w.append("A", 1, { type: "assistant-text", text: "▸ plan: first contact.\nsealed." });
    const text = serializeRecording(w.finish());
    expect(() => JSON.parse(text)).not.toThrow();
    expect(parseRecording(text).events).toHaveLength(2);
  });
});
