import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes } from "viem";
import { addr } from "@config/addresses";
import { JournalBus } from "@/chain/journal";
import { CHAT_MESSAGE_MAX, denialRemedy, messageFenceError } from "@/ui/WorldComposer";
import { setCurrentVenue } from "@/state/venueStore";
import { toolByName, toolSpecs, type AgentToolContext } from "@/agent/tools";
import { validatePlanSteps } from "@/agent/planTools";

/**
 * The world composer's §7.4 fences (session-48): the 280-char fence shared
 * by the manual panel and the `send_world_chat` agent tool, the opt-in
 * advertising rule, the YUE prerequisite (SEI.Chi reverts NotStarted
 * without one), and calldata correctness (selector self-checked against
 * keccak — the s34 discipline).
 */

const ACCT = "0xf39fd6e51aad88f6d4ce6ab8827279cfffb92266" as `0x${string}`;
const LAU = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const YUE = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const VENUE = "0xb0ba7d36b7f0505879179ece7401f24eb653c6e1" as `0x${string}`; // Phobos (config-pinned)

function selector(sig: string): string {
  return keccak256(stringToBytes(sig)).slice(0, 10);
}

function fakeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext & { __requests: Array<{ to: string | null; data: string }> } {
  const requests: Array<{ to: string | null; data: string }> = [];
  const ctx: AgentToolContext = {
    rpcUrl: "http://127.0.0.1:9999",
    account: ACCT,
    snapshot: {
      account: ACCT,
      lau: LAU,
      yue: YUE,
      lauName: "T",
      lauSymbol: "T",
      username: "captain",
      yueName: "V",
      yueSymbol: "V",
      balances: {
        pls: { wallet: 0n, lau: 0n, yue: 0n },
        affection: { wallet: 0n, lau: 0n, yue: 0n },
        choa: { wallet: 0n, lau: 0n, yue: 0n },
      },
      yuanChoa: 0n,
      blockNumber: 27_674_000n,
      fetchedAt: 0,
    },
    journal: new JournalBus(),
    walletMode: "B",
    chatToolsEnabled: true,
    gateDryRun: async (req) => {
      requests.push({ to: req.to, data: req.data });
      return {
        request: req,
        cls: { risk: "standard", tier: "perimeter", gate: null, metered: false, reverts: [], contract: "TEST", functionSig: null },
        policy: { allowed: true, reasons: [], risk: "standard", tier: "perimeter", requiresExtraAck: false },
        sim: { ok: true, result: "0x", gas: 708_000n, error: null },
      };
    },
    gateSend: async () => ({ status: "no-signer" }),
    refreshSnapshot: () => {},
    takeNote: () => {},
    simToolsEnabled: false,
    ...overrides,
  };
  return Object.assign(ctx, { __requests: requests }) as AgentToolContext & { __requests: Array<{ to: string | null; data: string }> };
}

describe("the manual composer fence", () => {
  it("caps messages at 280 chars and refuses empty ones", () => {
    expect(CHAT_MESSAGE_MAX).toBe(280);
    expect(messageFenceError("")).toContain("empty");
    expect(messageFenceError("   ")).toContain("empty");
    expect(messageFenceError("x".repeat(280))).toBeNull();
    expect(messageFenceError("x".repeat(281))).toContain("281 chars > 280");
  });
});

describe("send_world_chat (§7.4 — same opt-in as send_chat)", () => {
  it("is hidden from the advertised catalog until the opt-in is on", () => {
    expect(toolSpecs(false).map((t) => t.function.name)).not.toContain("send_world_chat");
    expect(toolSpecs(true).map((t) => t.function.name)).toContain("send_world_chat");
  });

  it("refuses when the opt-in is off, even with everything else ready", async () => {
    const out = await toolByName("send_world_chat")!.execute({ message: "hi" }, fakeCtx({ chatToolsEnabled: false }));
    expect(out.error).toContain("§7.4 opt-in");
  });

  it("enforces the 280-char schema fence", async () => {
    const out = await toolByName("send_world_chat")!.execute({ message: "x".repeat(281) }, fakeCtx());
    expect(out.error).toContain("280");
  });

  it("requires the YUE (CHOA.Chat resolves Sei.Chi first — NotStarted without one)", async () => {
    const ctx = fakeCtx();
    const noYue = fakeCtx({ snapshot: { ...ctx.snapshot!, yue: null } });
    const out = await toolByName("send_world_chat")!.execute({ message: "hi" }, noYue);
    expect(out.error).toContain("YUE");
  });

  it("DRYRUN encodes CHOA.Chat(address,string) to the CHOA perimeter address (selector self-checked)", async () => {
    setCurrentVenue({ a: VENUE, n: "phobos", s: "PHOBOS", lat: 0.1, band: 30, blk: 27_000_000 });
    const ctx = fakeCtx();
    const out = await toolByName("send_world_chat")!.execute({ message: "hello world" }, ctx);
    expect(out.mode).toBe("DRYRUN");
    expect((out as { venue?: string }).venue).toBe(VENUE);
    expect(ctx.__requests).toHaveLength(1);
    const req = ctx.__requests[0]!;
    expect(req.to!.toLowerCase()).toBe(addr("CHOA").toLowerCase());
    const sel = selector("Chat(address,string)");
    expect(sel).toBe("0xb340a780"); // the harness-pinned deployed selector
    expect(req.data.startsWith(sel)).toBe(true);
    setCurrentVenue(null);
  });

  it("plans cannot script it while chat tools are OFF", () => {
    const bad = validatePlanSteps([{ tool: "send_world_chat", args: { message: "hi" } }], false);
    expect(bad.ok).toBe(false); // not advertised → not scriptable (unknown-tool refusal)
    const good = validatePlanSteps([{ tool: "send_world_chat", args: { message: "hi" } }], true);
    expect(good.ok).toBe(true);
  });
});

describe("denialRemedy (71.4 — the teachable denial copy)", () => {
  it("names the toggles for perimeter denials; caps get the cap hint; others null", () => {
    expect(denialRemedy(["destination is not in the perimeter and unknown destinations are disabled"])).toMatch(/SETTINGS/);
    expect(denialRemedy(["contract deployment disabled — unknown destinations are disabled"])).toMatch(/SETTINGS/);
    expect(denialRemedy(["session tx cap reached (40)"])).toMatch(/cap/i);
    expect(denialRemedy(["something else entirely"])).toBeNull();
  });
});
