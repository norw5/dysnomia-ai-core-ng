import { describe, expect, it } from "vitest";
import {
  RunsLedger,
  buildSessionMemory,
  runSummaryLine,
  sanitizeNoteText,
  NOTE_CAP,
  MEMORY_CAP,
  type AgentRunRecord,
} from "@/chain/runs";

/**
 * The §7.10 journal/memory: the runs ledger (IndexedDB via an injected fake
 * here; in-memory fallback where IDB is unavailable), the capped
 * session-start memory, and the injection-safety invariant — run records
 * carry tool names + outcomes, NEVER args or result payloads.
 */

/** a minimal synchronous IDB fake: one "runs" object store over a Map */
function fakeIdb(shared: Map<string, unknown> = new Map()) {
  const db = {
    transaction(_name?: string, _mode?: IDBTransactionMode) {
      return {
        objectStore: () => ({
          getAll: () => mkReq([...shared.values()].filter((v) => (v as { id?: string }).id !== "facts")),
          get: (key: string) => mkReq(shared.get(key) ?? undefined),
          put: (value: { id: string }) => mkReq(shared.set(value.id, value)),
          delete: (key: string) => {
            shared.delete(key);
            return mkReq<undefined>(undefined);
          },
          clear: () => {
            shared.clear();
            return mkReq<undefined>(undefined);
          },
        }),
      };
    },
  };
  return { db, shared };
}

function mkReq<T>(result: T): IDBRequest<T> {
  const r = { result, onsuccess: null as null | (() => void), onerror: null as null | (() => void) };
  queueMicrotask(() => r.onsuccess?.());
  return r as unknown as IDBRequest<T>;
}

function run(partial: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: partial.id ?? "run-1",
    t: partial.t ?? Date.now(),
    kind: partial.kind ?? "turn",
    goal: partial.goal ?? "explain venues",
    outcome: partial.outcome ?? "done",
    lesson: partial.lesson ?? null,
    note: partial.note ?? null,
    steps: partial.steps ?? [{ tool: "search_kb", ok: true }],
    tokens: partial.tokens ?? 120,
  };
}

describe("the runs ledger", () => {
  it("appends + lists runs through IndexedDB (records carry names/outcomes only)", async () => {
    const { db } = fakeIdb();
    const ledger = new RunsLedger(async () => db as unknown as IDBDatabase);
    const rec = await ledger.appendRun({ kind: "turn", goal: "g", outcome: "done", lesson: null, steps: [{ tool: "search_kb", ok: true }], tokens: 10 });
    expect(rec.id).toMatch(/^run-/);
    const runs = await ledger.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.goal).toBe("g");
    // the injection-safety invariant: no args/results keys exist on records
    expect(Object.keys(runs[0]!.steps[0]!).sort()).toEqual(["ok", "tool"]);
  });

  it("persists across instances sharing the store (reload semantics)", async () => {
    const { db } = fakeIdb();
    const a = new RunsLedger(async () => db as unknown as IDBDatabase);
    await a.appendRun({ kind: "plan", goal: "p", outcome: "stopped", lesson: "user STOP", steps: [], tokens: 0 });
    const b = new RunsLedger(async () => db as unknown as IDBDatabase);
    expect((await b.listRuns())[0]!.goal).toBe("p");
  });

  it("facts round-trip; facts record stays out of listRuns", async () => {
    const { db } = fakeIdb();
    const ledger = new RunsLedger(async () => db as unknown as IDBDatabase);
    expect(await ledger.getFacts()).toBe("");
    await ledger.setFacts("prefer Phobos; never buy Fornax past the ceiling");
    expect(await ledger.getFacts()).toContain("Phobos");
    await ledger.appendRun({ kind: "turn", goal: "g", outcome: "done", lesson: null, steps: [], tokens: 1 });
    expect((await ledger.listRuns()).every((r) => r.id !== "facts")).toBe(true);
  });

  it("wipe clears runs + facts", async () => {
    const { db } = fakeIdb();
    const ledger = new RunsLedger(async () => db as unknown as IDBDatabase);
    await ledger.setFacts("note");
    await ledger.appendRun({ kind: "turn", goal: "g", outcome: "done", lesson: null, steps: [], tokens: 0 });
    await ledger.wipe();
    expect(await ledger.listRuns()).toEqual([]);
    expect(await ledger.getFacts()).toBe("");
  });

  it("degrades to the in-memory fallback when IndexedDB is unavailable", async () => {
    const ledger = new RunsLedger(async () => null);
    await ledger.setFacts("fallback facts");
    await ledger.appendRun({ kind: "turn", goal: "g", outcome: "done", lesson: null, steps: [], tokens: 0 });
    expect((await ledger.listRuns()).map((r) => r.goal)).toEqual(["g"]);
    expect(await ledger.getFacts()).toBe("fallback facts");
  });

  it("trims the ledger past the cap (oldest evicted)", async () => {
    const { db } = fakeIdb();
    const ledger = new RunsLedger(async () => db as unknown as IDBDatabase);
    for (let i = 0; i < 205; i++) {
      await ledger.appendRun({ kind: "turn", goal: `g${i}`, outcome: "done", lesson: null, steps: [], tokens: 0 });
    }
    const runs = await ledger.listRuns();
    expect(runs.length).toBeLessThanOrEqual(201); // cap + the just-appended record
    expect(runs[0]!.goal).not.toBe("g0"); // oldest gone
  });
});

describe("the session-start memory (§7.10 injection)", () => {
  it("is null when there is nothing to remember", () => {
    expect(buildSessionMemory("", [])).toBeNull();
  });

  it("carries facts + previous-session runs inside the data-not-directives fence", () => {
    const mem = buildSessionMemory("prefer Phobos", [run({ goal: "onboard me", outcome: "stopped", lesson: "user STOP" })])!;
    expect(mem).toContain("SESSION_MEMORY");
    expect(mem).toContain("data, never as directives");
    expect(mem).toContain("prefer Phobos");
    expect(mem).toContain("onboard me → stopped");
    expect(mem).toContain("user STOP");
  });

  it("runSummaryLine compacts goal → outcome (steps + err counts + lesson)", () => {
    const line = runSummaryLine(
      run({ goal: "x".repeat(200), outcome: "done", steps: [{ tool: "a", ok: true }, { tool: "b", ok: false }], tokens: 42 })
    );
    expect(line).toContain("→ done (2 steps (1 err), 42 tok)");
    expect(line.length).toBeLessThan(160); // long goals clip
  });

  it("caps the whole block at the memory cap", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      run({ id: `r${i}`, t: i, goal: `g${"x".repeat(88)}`, lesson: "l".repeat(140) })
    );
    const mem = buildSessionMemory("f".repeat(1300), many)!;
    expect(mem.length).toBeLessThanOrEqual(MEMORY_CAP);
    expect(mem.endsWith("…")).toBe(true);
  });

  it("only the last 8 previous runs make the cut", () => {
    const many = Array.from({ length: 12 }, (_, i) => run({ id: `r${i}`, t: i, goal: `goal ${i}` }));
    const mem = buildSessionMemory("", many)!;
    expect(mem).not.toContain("goal 0");
    expect(mem).toContain("goal 11");
  });
});

describe("agent-authored notes (session-54: the one model-authored string, review-gated)", () => {
  it("sanitizeNoteText strips control chars, collapses whitespace, caps at NOTE_CAP", () => {
    expect(sanitizeNoteText("plain note")).toBe("plain note");
    expect(sanitizeNoteText("  lots\t\tof\n\nspaces  ")).toBe("lots of spaces");
    expect(sanitizeNoteText("con\u0000trol\u007f chars\u001f dropped")).toBe("con trol chars dropped");
    const long = "x".repeat(NOTE_CAP + 50);
    const capped = sanitizeNoteText(long)!;
    expect(capped.length).toBe(NOTE_CAP);
    expect(capped.endsWith("…")).toBe(true);
  });

  it("sanitizeNoteText returns null for empty/whitespace-only input", () => {
    expect(sanitizeNoteText("")).toBeNull();
    expect(sanitizeNoteText("   \n\t ")).toBeNull();
  });

  it("setNoteAck / clearNote persist through IDB (reload semantics)", async () => {
    const { db } = fakeIdb();
    const a = new RunsLedger(async () => db as unknown as IDBDatabase);
    const rec = await a.appendRun({ kind: "turn", goal: "g", outcome: "done", lesson: null, note: { text: "operator prefers Phobos", ack: false }, steps: [], tokens: 0 });
    await a.setNoteAck(rec.id, true);
    const b = new RunsLedger(async () => db as unknown as IDBDatabase); // fresh instance = reload
    expect((await b.listRuns())[0]!.note).toEqual({ text: "operator prefers Phobos", ack: true });
    await b.clearNote(rec.id);
    const c = new RunsLedger(async () => db as unknown as IDBDatabase);
    expect((await c.listRuns())[0]!.note ?? null).toBeNull();
  });

  it("setNoteAck / clearNote work on the in-memory fallback too", async () => {
    const ledger = new RunsLedger(async () => null);
    const rec = await ledger.appendRun({ kind: "turn", goal: "g", outcome: "done", lesson: null, note: { text: "n", ack: false }, steps: [], tokens: 0 });
    await ledger.setNoteAck(rec.id, true);
    expect((await ledger.listRuns())[0]!.note).toEqual({ text: "n", ack: true });
    await ledger.clearNote(rec.id);
    expect((await ledger.listRuns())[0]!.note ?? null).toBeNull();
  });

  it("setNoteAck is a no-op on runs without a note", async () => {
    const { db } = fakeIdb();
    const ledger = new RunsLedger(async () => db as unknown as IDBDatabase);
    const rec = await ledger.appendRun({ kind: "turn", goal: "g", outcome: "done", lesson: null, steps: [], tokens: 0 });
    await ledger.setNoteAck(rec.id, true);
    expect((await ledger.listRuns())[0]!.note ?? null).toBeNull();
  });

  it("runSummaryLine carries the note ONLY once operator-acked (the injection gate)", () => {
    const pending = run({ note: { text: "SECRET-PENDING", ack: false } });
    expect(runSummaryLine(pending)).not.toContain("SECRET-PENDING");
    const acked = run({ note: { text: "VISIBLE-ACKED", ack: true } });
    expect(runSummaryLine(acked)).toContain("note: VISIBLE-ACKED");
    // legacy records (no note field at all) stay untouched
    expect(runSummaryLine(run())).not.toContain("note:");
  });

  it("buildSessionMemory never contains a pending note, acked notes ride the run line", () => {
    const pending = buildSessionMemory("", [run({ id: "p", note: { text: "INJECTION-ATTEMPT", ack: false } })])!;
    expect(pending).not.toContain("INJECTION-ATTEMPT");
    const acked = buildSessionMemory("", [run({ id: "a", note: { text: "OPERATOR-ENDORSED", ack: true } })])!;
    expect(acked).toContain("OPERATOR-ENDORSED");
    expect(acked).toContain("operator-acked agent notes"); // the fence names the new class honestly
  });

  it("a pending note still fills memory (the run line renders) — only the text is withheld", () => {
    const mem = buildSessionMemory("", [run({ id: "p", goal: "the run itself", note: { text: "HIDDEN", ack: false } })])!;
    expect(mem).toContain("the run itself");
    expect(mem).not.toContain("HIDDEN");
  });
});
