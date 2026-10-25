import { describe, expect, it } from "vitest";
import { briefArgs } from "@/ui/AgentPane";

/**
 * The pane's tool-call fold arg summary (session-72 fix): structured values
 * summarize structurally — the plan `steps` array rendered as
 * "[object Object],[object Object]" on camera in the 69 + 72 guided takes.
 */
describe("briefArgs — the tool-call fold summary", () => {
  it("empty args stay the empty object", () => {
    expect(briefArgs({})).toBe("{}");
  });

  it("primitives render as themselves", () => {
    expect(briefArgs({ venue: "0xabc", amount: "5", send: true })).toBe(
      "venue: 0xabc · amount: 5 · send: true",
    );
  });

  it("the plan steps array summarizes structurally (never [object Object])", () => {
    const out = briefArgs({
      goal: "Claim the home QING",
      steps: [
        { tool: "create_venue", args: { asset: "0x1" }, send: false },
        { tool: "join_venue", args: {}, send: true },
      ],
    });
    expect(out).toContain("steps: [2× {tool/args/send}]");
    expect(out).not.toContain("object Object");
  });

  it("nested objects summarize as a key list", () => {
    expect(briefArgs({ args: { name: "x", symbol: "Y" } })).toBe("args: {name/symbol}");
  });

  it("empty arrays render as [] and long values truncate at 40", () => {
    expect(briefArgs({ list: [] })).toBe("list: []");
    expect(briefArgs({ text: "a".repeat(80) })).toBe(`text: ${"a".repeat(40)}`);
  });

  it("more than four keys fold with an ellipsis", () => {
    const out = briefArgs({ a: 1, b: 2, c: 3, d: 4, e: 5 });
    expect(out).toBe("a: 1 · b: 2 · c: 3 · d: 4 …");
  });
});
