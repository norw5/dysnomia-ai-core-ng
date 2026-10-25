import { describe, expect, it } from "vitest";
import { buildOnboardingHandoff, deriveOnboardingIdentity } from "@/ui/deck/widgets";

/**
 * The onboarding PREFERENCE CONTRACT (session-65.2, the owner's round):
 * when the operator specified a name/symbol BEFORE the handoff, the agent
 * uses them EXACTLY with no further confirmation; when nothing was
 * specified the agent MUST stop, propose, explain, and wait — never
 * proceed with unconfirmed defaults.
 */

describe("deriveOnboardingIdentity", () => {
  it("derives the full identity from a specified name+symbol", () => {
    const id = deriveOnboardingIdentity({ username: "Nyx", symbol: "NYX" });
    expect(id).toMatchObject({
      specified: true,
      username: "Nyx",
      symbol: "NYX",
      lauName: "Dysnomia Nyx",
      yueName: "Nyx Vault",
      yueSymbol: "NYXV",
    });
  });
  it("derives the symbol from the name when the symbol is empty", () => {
    const id = deriveOnboardingIdentity({ username: "Atropa", symbol: "" });
    expect(id.specified).toBe(true);
    expect(id.symbol).toBe("ATRO");
    expect(id.yueSymbol).toBe("ATROV");
  });
  it("a symbol alone still specifies (the name rides the default handle shape)", () => {
    const id = deriveOnboardingIdentity({ username: "", symbol: "DYS" });
    expect(id.specified).toBe(true);
    expect(id.symbol).toBe("DYS");
  });
  it("empty everything = unspecified (the agent proposes + asks)", () => {
    expect(deriveOnboardingIdentity({ username: "", symbol: "" }).specified).toBe(false);
    expect(deriveOnboardingIdentity({ username: "  ", symbol: "  " }).specified).toBe(false);
  });
});

describe("buildOnboardingHandoff — the two contracts", () => {
  it("SPECIFIED: the exact values ride the prompt + NO further confirmation", () => {
    const p = buildOnboardingHandoff({ username: "Nyx", symbol: "NYX" });
    expect(p).toContain("SPECIFIED");
    expect(p).toContain('Username "Nyx"');
    expect(p).toContain('LAU name "Dysnomia Nyx"');
    expect(p).toContain('LAU symbol "NYX"');
    expect(p).toContain('YUE name "Nyx Vault"');
    expect(p).toContain('YUE symbol "NYXV"');
    expect(p).toContain("do NOT ask for further confirmation");
  });
  it("UNSPECIFIED: the agent MUST stop, propose, explain, and wait", () => {
    const p = buildOnboardingHandoff({ username: "", symbol: "" });
    expect(p).toContain("NO identity preference was specified");
    expect(p).toContain("STOP AND ASK");
    expect(p).toContain("EXPLAIN");
    expect(p).toContain("WAIT for my explicit confirmation");
    expect(p).toContain("NEVER proceed with unconfirmed defaults");
    // the byte law rides both variants
    expect(p).toContain("12 BYTES");
  });
  it("both variants keep the DRYRUN/commit honesty clauses", () => {
    for (const pref of [{ username: "Nyx", symbol: "NYX" }, { username: "", symbol: "" }] as const) {
      const p = buildOnboardingHandoff(pref);
      expect(p).toContain("DRYRUN first");
      expect(p).toContain("nothing has been sent yet");
      expect(p).toContain("confirm what changed onchain");
    }
  });
});
