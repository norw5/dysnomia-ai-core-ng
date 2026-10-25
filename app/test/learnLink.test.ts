import { describe, expect, it } from "vitest";
import { loadGuideDocs } from "@/state/guide";
import { parseBlocks } from "@/ui/guideRender";
import { anchorSlug, clearLearnTarget, learnLinkSeq, learnLinkTarget, openLearn, subscribeLearn } from "@/state/learnLink";

/**
 * The LEARN deep-link channel (session-53, §6 form 2): anchorSlug must
 * match the ids guideRender puts on headings (both share the one function),
 * the store notifies its subscribers, and — the corpus-cross pin — EVERY
 * file/anchor the app's `?` chips use must resolve against the real guide
 * files, so a renamed heading fails HERE instead of as a dead scroll in the
 * UI.
 */

describe("anchorSlug", () => {
  it("lowercases, strips punctuation, collapses runs", () => {
    expect(anchorSlug("DO — venue-claim deeds")).toBe("do-venue-claim-deeds");
    expect(anchorSlug("MAP + HECKE — venues on a coordinate map")).toBe("map-hecke-venues-on-a-coordinate-map");
    expect(anchorSlug("Souls, SHAs and SHIOs")).toBe("souls-shas-and-shios");
    expect(anchorSlug("  The account/oracle loop  ")).toBe("the-account-oracle-loop");
  });
  it("never emits leading/trailing dashes", () => {
    expect(anchorSlug("—")).toBe("");
    expect(anchorSlug("What is *not* claimed")).toBe("what-is-not-claimed");
  });
});

describe("the learn-link store", () => {
  it("publishes targets and notifies subscribers (repeats included)", () => {
    const seen: (string | null)[] = [];
    const unsub = subscribeLearn(() => seen.push(learnLinkTarget()?.file ?? null));
    const seq0 = learnLinkSeq();
    openLearn({ file: "venues.md", anchor: "cho-the-hub" });
    expect(seen).toEqual(["venues.md"]);
    expect(learnLinkSeq()).toBe(seq0 + 1);
    expect(learnLinkTarget()).toEqual({ file: "venues.md", anchor: "cho-the-hub" });
    openLearn({ file: "venues.md", anchor: "cho-the-hub" });
    expect(learnLinkSeq()).toBe(seq0 + 2); // same-file links still notify (re-open)
    clearLearnTarget();
    expect(learnLinkTarget()).toBeNull();
    expect(seen).toEqual(["venues.md", "venues.md", null]);
    unsub();
    openLearn({ file: "glossary.md" });
    expect(seen).toEqual(["venues.md", "venues.md", null]); // unsubscribed: no more pushes
  });

  it("carries the DEV source without disturbing the default guide target", () => {
    clearLearnTarget();
    openLearn({ source: "dev", file: "shio.md" });
    expect(learnLinkTarget()).toEqual({ source: "dev", file: "shio.md" });
    openLearn({ file: "venues.md" });
    expect(learnLinkTarget()).toEqual({ file: "venues.md" });
    clearLearnTarget();
  });
});

describe("every `?` deep-link target resolves in the corpus", () => {
  // the exact chips sprinkled across the app (LearnHint usages)
  const TARGETS: { file: string; anchor?: string }[] = [
    { file: "venues.md" },
    { file: "venues.md", anchor: "cho-the-hub" },
    { file: "the-ladder.md", anchor: "the-soeng-chain" },
    { file: "the-ladder.md", anchor: "the-account-oracle-loop" },
    { file: "accounts-and-chat.md", anchor: "souls-shas-and-shios" },
    { file: "accounts-and-chat.md", anchor: "lau-the-account-token" },
    { file: "accounts-and-chat.md", anchor: "how-a-chat-line-travels" },
    { file: "economy.md", anchor: "sei-and-the-yue-account-tokens" },
    { file: "economy.md", anchor: "the-internal-exchange" },
  ];

  it("each file exists and each anchor is a real heading slug in that file", () => {
    const docs = loadGuideDocs();
    for (const t of TARGETS) {
      const doc = docs.find((d) => d.file === t.file);
      expect(doc, `guide file ${t.file}`).toBeDefined();
      if (t.anchor === undefined) continue;
      const slugs = parseBlocks(doc!.raw)
        .filter((b) => b.kind === "heading")
        .map((b) => anchorSlug(b.text ?? ""));
      expect(slugs, `${t.file} headings`).toContain(t.anchor);
    }
  });
});
