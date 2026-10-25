import { describe, expect, it } from "vitest";
import { devFiles, kbCorpus } from "@/agent/knowledge";
import { FACTS } from "@/chain/facts";
import {
  devDocForName,
  docTitle,
  GUIDE_ORDER,
  glossary,
  glossaryTerms,
  loadDevDocs,
  loadGuideDocs,
  parseGlossary,
  splitTerm,
} from "@/state/guide";
import { parseBlocks } from "@/ui/guideRender";

/**
 * The LEARN corpus (session-48): the 8-file guide rendered terminal-style
 * from the SAME glob the agent chunks (agent/knowledge.ts) — the
 * no-divergence guarantee is asserted here, plus the glossary dictionary
 * parse the dotted-underline pass consumes.
 */

describe("the guide corpus (one source, zero divergence)", () => {
  it("ships exactly the 8 definitive files in the canonical reading order", () => {
    const docs = loadGuideDocs();
    expect(docs.map((d) => d.file)).toEqual([...GUIDE_ORDER]);
  });

  it("is the SAME file set the agent's search_kb chunks — manual and NL education cannot diverge", () => {
    const learnFiles = new Set(loadGuideDocs().map((d) => d.file));
    const agentGuideFiles = new Set(kbCorpus().filter((c) => c.source === "guide").map((c) => c.file));
    expect(learnFiles).toEqual(agentGuideFiles);
    expect(learnFiles.size).toBe(8);
  });

  it("titles come from the # heading line with a filename fallback", () => {
    expect(docTitle("# Glossary — the Dysnomia vocabulary\n", "glossary.md")).toBe("Glossary — the Dysnomia vocabulary");
    expect(docTitle("no heading", "x.md")).toBe("x.md");
  });
});

describe("the dev reference corpus (session-78 — one source with search_kb)", () => {
  it("ships the full kb/dev set, README first, and every doc renders non-empty", () => {
    const docs = loadDevDocs();
    expect(docs.length).toBe(50);
    expect(docs[0]!.file).toBe("README.md");
    for (const doc of docs) {
      expect(parseBlocks(doc.raw).length, doc.file).toBeGreaterThan(0);
    }
  });

  it("is the SAME glob the agent's kb corpus chunks (no second corpus)", () => {
    const names = new Set(devFiles().map((d) => d.file));
    expect(names.size).toBe(50);
    const corpusFiles = new Set(kbCorpus().filter((c) => c.source === "kb").map((c) => c.file));
    for (const name of names) expect(corpusFiles, name).toContain(name);
  });

  it("maps a contract to its dev doc honestly (source first, instance second, exact only)", () => {
    expect(devDocForName("SHIO")).toBe("shio.md");
    expect(devDocForName("QING")).toBe("qing.md");
    expect(devDocForName("CHOA")).toBe("choa.md");
    expect(devDocForName("Hecke")).toBe("hecke.md"); // case-insensitive
    expect(devDocForName("CHO")).toBe("cho.md");
    // no silently-wrong fallback: these source contracts have no kb/dev file
    expect(devDocForName("IAlchemicalGold")).toBeNull();
    expect(devDocForName("atropaMath")).toBeNull();
    expect(devDocForName("")).toBeNull();
  });

  it("every perimeter contract has a doc except the two honest gaps", () => {
    const missing = FACTS.contracts
      .filter((c) => devDocForName(c.sourceContract) === null && devDocForName(c.name) === null)
      .map((c) => c.name)
      .sort();
    // AFFECTION's IAlchemicalGold and MATH's atropaMath have no kb/dev page;
    // the Studio names that gap instead of opening a wrong file. Any future
    // perimeter addition without a doc fails HERE (add the doc or record the
    // gap deliberately).
    expect(missing).toEqual(["AFFECTION", "MATH"]);
  });
});

describe("markdown block parsing (what the guide files actually use)", () => {  it("parses headings, paragraphs, lists, tables, rules and quotes", () => {
    const md = [
      "# Title",
      "",
      "intro paragraph with **bold** and `code`.",
      "",
      "## Section",
      "",
      "- one",
      "- two",
      "",
      "| term | meaning |",
      "|---|---|",
      "| **Soul** | the identity id |",
      "",
      "---",
      "",
      "> quoted line",
    ].join("\n");
    const blocks = parseBlocks(md);
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "para", "heading", "list", "table", "rule", "quote"]);
    expect(blocks[3]!.items).toEqual([
      { text: "one", children: [] },
      { text: "two", children: [] },
    ]);
    expect(blocks[4]!.rows).toEqual([
      ["term", "meaning"],
      ["**Soul**", "the identity id"],
    ]);
  });

  it("parses nested list items and wrapped continuation lines", () => {
    const md = [
      "- one",
      "  wrapped line",
      "  - child",
      "    child wrap",
      "- two",
      "",
      "after",
    ].join("\n");
    const blocks = parseBlocks(md);
    expect(blocks[0]!.items).toEqual([
      { text: "one wrapped line", children: [{ text: "child child wrap", children: [] }] },
      { text: "two", children: [] },
    ]);
    expect(blocks[1]).toEqual({ kind: "para", text: "after" });
  });

  it("renders ordered lists as <ol> and keeps text around links", () => {
    const blocks = parseBlocks(["1. [overview](overview) — the one page", "2. [next](next) — more"].join("\n"));
    expect(blocks[0]!.ordered).toBe(true);
    expect(blocks[0]!.items?.map((i) => i.text)).toEqual([
      "[overview](overview) — the one page",
      "[next](next) — more",
    ]);
  });

  it("the README's wrapped list body stays inside its item (not an orphan paragraph)", () => {
    const readme = loadGuideDocs().find((d) => d.file === "README.md");
    expect(readme).toBeDefined();
    const blocks = parseBlocks(readme!.raw);
    const hit = blocks.find((b) => b.kind === "list" && b.items?.some((i) => i.text.includes("deployment waves")));
    expect(hit).toBeDefined();
    const orphans = blocks.filter((b) => b.kind === "para" && (b.text ?? "").startsWith("deployment waves"));
    expect(orphans).toHaveLength(0);
  });

  it("renders the real guide files without an empty block set", () => {
    for (const doc of loadGuideDocs()) {
      const blocks = parseBlocks(doc.raw);
      expect(blocks.length, doc.file).toBeGreaterThan(0);
    }
  });
});

describe("the glossary dictionary", () => {
  it("parses guide/glossary.md's table — bold terms, aliases kept, separators skipped", () => {
    const entries = glossary();
    expect(entries.length).toBeGreaterThan(30);
    const soul = entries.find((e) => e.term === "Soul");
    expect(soul?.meaning).toContain("uint64");
    const lau = entries.find((e) => e.term === "LAU");
    expect(lau?.alt).toMatch(/雷/);
    // separator + header rows never become entries
    expect(entries.some((e) => e.term === "term")).toBe(false);
  });

  it("splitTerm keeps the parenthetical alias separate from the term", () => {
    expect(splitTerm("**CHOA** (抄)")).toEqual({ term: "CHOA", alt: "(抄)" });
    expect(splitTerm("**VOID**")).toEqual({ term: "VOID", alt: null });
  });

  it("the word-match pass excludes slash-groups and phrase rows", () => {
    const terms = glossaryTerms(parseGlossary("| Fornax / Fomalhaute / Eris | x |\n| **Soul** | y |\n| **MAP / HECKE** | z |"));
    expect(terms.map((t) => t.term)).toEqual(["Soul"]);
  });
});
