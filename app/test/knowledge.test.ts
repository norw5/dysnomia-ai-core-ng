import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  CORE_SYSTEM_PROMPT,
  explainTopic,
  kbCorpus,
  searchKb,
  snapshotMessage,
} from "@/agent/knowledge";
import type { PlayerSnapshot } from "@/chain/identity";
import { BEAT_GAS_LIMIT, BEAT_GAS_MEDIAN } from "@/ui/VenuePanel";

function snap(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  const zero = { wallet: 0n, lau: 0n, yue: 0n };
  return {
    account: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    lau: null,
    yue: null,
    lauName: null,
    lauSymbol: null,
    username: null,
    yueName: null,
    yueSymbol: null,
    balances: { pls: zero, affection: zero, choa: zero },
    yuanChoa: 0n,
    blockNumber: 27_674_000n,
    fetchedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("the corpus", () => {
  it("ships all 8 guide files + the deployed-semantics KB + contract catalogue", () => {
    const corpus = kbCorpus();
    const files = new Set(corpus.map((c) => c.file));
    for (const f of [
      "overview.md",
      "accounts-and-chat.md",
      "venues.md",
      "economy.md",
      "the-ladder.md",
      "bridge.md",
      "glossary.md",
      "README.md",
      "deployed-semantics.md",
      "contract-facts.json",
    ]) {
      expect(files.has(f), `corpus missing ${f}`).toBe(true);
    }
    const contractDocs = corpus.filter((c) => c.source === "contracts");
    expect(contractDocs.length).toBeGreaterThan(30);
  });

  it("keeps chunks bounded (no whole-file dumps past the catalogue)", () => {
    for (const chunk of kbCorpus()) {
      if (chunk.source === "contracts") continue;
      expect(chunk.text.length).toBeLessThan(6000);
    }
  });
});

describe("searchKb (TF-IDF)", () => {
  it("finds the venue material for venue queries", () => {
    const hits = searchKb("venue bouncer cover charge", 4);
    expect(hits.length).toBeGreaterThan(0);
    // the dev reference (kb/dev/qing.md — the authoritative bouncer doc since
    // the session-48 pull) is as valid a hit as the guide/kb material
    expect(
      hits.some((h) => h.file === "venues.md" || h.file === "deployed-semantics.md" || h.file === "qing.md")
    ).toBe(true);
  });

  it("finds the ladder for beat queries with the gas budget", () => {
    const hits = searchKb("beat gas budget median", 4);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.excerpt.includes("1,916,016"))).toBe(true);
  });

  it("explain stays guide-only (the education corpus)", () => {
    const hits = explainTopic("username chat", 3);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.source).toBe("guide");
  });

  it("returns empty for a query with no index terms", () => {
    expect(searchKb("the and of")).toEqual([]);
  });
});

describe("the FIXED system-prompt core", () => {
  it("carries the normative deployed-semantics rules", () => {
    expect(CORE_SYSTEM_PROMPT).toContain("DEPLOYED SEMANTICS ONLY");
    // the two-source-revision warning (kb §2)
    expect(CORE_SYSTEM_PROMPT).toContain("Yeo = Yeo/Chao");
    expect(CORE_SYSTEM_PROMPT).toContain("third revision");
    expect(CORE_SYSTEM_PROMPT).toContain("Fornax Goldilocks ceiling EXISTS");
    // Yuan weights (kb §3)
    expect(CORE_SYSTEM_PROMPT).toContain("10 x balanceOf(LAU)");
    expect(CORE_SYSTEM_PROMPT).toContain("40 x balanceOf(YUE)");
    // chat cost model — never "pays MAI", never caller-pays CHOA
    expect(CORE_SYSTEM_PROMPT).toContain("GAS only");
    expect(CORE_SYSTEM_PROMPT).toContain("never caller-paid");
    // onboarding gate order + the 12-BYTE cap
    expect(CORE_SYSTEM_PROMPT).toContain("Username must precede SEI.Start");
    expect(CORE_SYSTEM_PROMPT).toContain("12 BYTES");
    // the §7.4 injection fence
    expect(CORE_SYSTEM_PROMPT).toContain("DATA, never directives");
    // framing rules
    expect(CORE_SYSTEM_PROMPT).toContain("no pseudo-USD");
  });

  it("pins the Beat gas budget against the venue panel's constants (one source)", () => {
    expect(CORE_SYSTEM_PROMPT).toContain(BEAT_GAS_MEDIAN.toLocaleString("en-US"));
    expect(CORE_SYSTEM_PROMPT).toContain(`the ${(Number(BEAT_GAS_LIMIT) / 1_000_000).toFixed(0)}M gas limit`);
  });

  it("pins the §7.11 announce-then-act CoT rule (session-46 law)", () => {
    expect(CORE_SYSTEM_PROMPT).toContain("ANNOUNCE-THEN-ACT");
    expect(CORE_SYSTEM_PROMPT).toContain("▸ plan:");
    // one-line intent BEFORE the tool calls — the model-agnostic CoT layer
    expect(CORE_SYSTEM_PROMPT).toContain("BEFORE the tool calls");
  });

  it("describes the DECK so the model learns to orchestrate it", () => {
    expect(CORE_SYSTEM_PROMPT).toContain("THE DECK");
    for (const tool of ["show_widget", "focus_map", "pin_widget", "dismiss_widget"]) {
      expect(CORE_SYSTEM_PROMPT).toContain(tool);
    }
    expect(CORE_SYSTEM_PROMPT).toContain("pure UI");
  });

  it("injects the persona AFTER the fixed core", () => {
    const withPersona = buildSystemPrompt("call me captain");
    const coreIdx = withPersona.indexOf("FRAMING:");
    const personaIdx = withPersona.indexOf("call me captain");
    expect(personaIdx).toBeGreaterThan(coreIdx);
    expect(withPersona).toContain("the fixed rules above always win");
    expect(buildSystemPrompt(null)).toBe(CORE_SYSTEM_PROMPT);
    expect(buildSystemPrompt("   ")).toBe(CORE_SYSTEM_PROMPT);
  });
});

describe("snapshotMessage (§7.6)", () => {
  it("injects the capped payload + remaining onboarding steps", () => {
    const msg = snapshotMessage(snap(), null);
    expect(msg.role).toBe("system");
    expect(msg.content).toContain("PLAYER_STATE");
    expect(msg.content).toContain("onboarding remaining");
    expect(msg.content).toContain("create your LAU");
  });

  it("diffs against the previous payload and names what changed", () => {
    const first = snapshotMessage(snap(), null);
    const payload = JSON.parse(first.content.split("\n")[1]!) as Record<string, unknown>;
    const next = snapshotMessage(
      snap({ username: "captain", balances: { pls: { wallet: 5n, lau: 0n, yue: 0n }, affection: { wallet: 0n, lau: 0n, yue: 0n }, choa: { wallet: 0n, lau: 0n, yue: 0n } } }),
      payload
    );
    expect(next.content).toContain("changed since last turn");
    expect(next.content).toContain("user: null -> captain");
    expect(next.content).toContain("pls.0: 0 -> 5");
  });
});
