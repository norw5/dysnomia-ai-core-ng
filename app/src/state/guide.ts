import { devFiles, guideFiles } from "@/agent/knowledge";

/**
 * The LEARN corpus (IA-PLAN §6, session-48): the 8-file definitive guide,
 * rendered terminal-style. The raw files come from `agent/knowledge.ts`'s
 * own glob — ONE source, so the view and the agent's `search_kb` can never
 * diverge. `parseGlossary` turns guide/glossary.md's table into the
 * dotted-underline dictionary.
 *
 * Session-78: the DEV REFERENCE source (kb/dev/**) rides the same
 * `devFiles()` export, and `devDocForName` is the honest Studio mapping
 * (source contract first, instance name second — no fuzzy guessing).
 */

/** the canonical reading order (AGENTS.md "documents, in read order") */
export const GUIDE_ORDER = [
  "README.md",
  "overview.md",
  "accounts-and-chat.md",
  "venues.md",
  "economy.md",
  "the-ladder.md",
  "bridge.md",
  "glossary.md",
] as const;

export interface GuideDoc {
  file: string;
  /** the `# ` heading line (fallback: the filename) */
  title: string;
  raw: string;
}

export function docTitle(raw: string, fallback: string): string {
  const line = raw.split("\n").find((l) => l.startsWith("# "));
  return line ? line.slice(2).trim() : fallback;
}

export function loadGuideDocs(): GuideDoc[] {
  const docs = guideFiles().map(({ file, raw }) => ({ file, title: docTitle(raw, file), raw }));
  const rank = (f: string): number => {
    const i = (GUIDE_ORDER as readonly string[]).indexOf(f);
    return i === -1 ? GUIDE_ORDER.length : i;
  };
  return docs.sort((a, b) => rank(a.file) - rank(b.file) || a.file.localeCompare(b.file));
}

/**
 * The kb/dev corpus in index order: README.md is the section intro, the rest
 * alphabetical. Verbatim engineering reference (50 files at the session-70
 * corpus); the Studio's docs link resolves through `devDocForName`.
 */
export function loadDevDocs(): GuideDoc[] {
  const docs = devFiles().map(({ file, raw }) => ({ file, title: docTitle(raw, file), raw }));
  return docs.sort((a, b) => {
    if (a.file === "README.md") return -1;
    if (b.file === "README.md") return 1;
    return a.file.localeCompare(b.file);
  });
}

/**
 * The honest Studio → kb/dev mapping: try the facts' `sourceContract` first
 * (SHIO/QING/CHOA/…), then the instance name. Only an EXACT basename match
 * counts — contracts without an engineering doc (AFFECTION's
 * IAlchemicalGold, MATH's atropaMath) return null and the Studio says so
 * instead of silently opening a wrong file.
 */
export function devDocForName(name: string): string | null {
  const target = name.trim().toLowerCase();
  if (target.length === 0) return null;
  const hit = devFiles().find((d) => d.file.replace(/\.md$/, "").toLowerCase() === target);
  return hit?.file ?? null;
}

// ---- the glossary (guide/glossary.md's table → the term dictionary) ----

export interface GlossaryEntry {
  /** the bare term, e.g. "LAU" */
  term: string;
  /** the parenthetical alias kept for display, e.g. "(雷/倫)" — null when absent */
  alt: string | null;
  meaning: string;
  /** lowercase match key for the dotted-underline pass */
  key: string;
}

/** `**LAU** (雷/倫)` → { term: "LAU", alt: "(雷/倫)" } */
export function splitTerm(cell: string): { term: string; alt: string | null } {
  const bare = cell.replace(/\*\*/g, "").trim();
  const m = bare.match(/^(.+?)(\s*[（(].*?[)）])$/u);
  if (m) return { term: m[1]!.trim(), alt: m[2]!.trim() };
  return { term: bare, alt: null };
}

export function parseGlossary(raw: string): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const cells = t.slice(1, t.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
    if (cells.length < 2) continue;
    const head = cells[0]!;
    if (head === "" || head === "term" || /^-+$/.test(head)) continue;
    const { term, alt } = splitTerm(head);
    if (term.length === 0) continue;
    out.push({ term, alt, meaning: cells[1]!, key: term.toLowerCase() });
  }
  return out;
}

let glossaryCache: GlossaryEntry[] | null = null;

export function glossary(): GlossaryEntry[] {
  if (glossaryCache === null) {
    const doc = guideFiles().find((d) => d.file === "glossary.md");
    glossaryCache = doc ? parseGlossary(doc.raw) : [];
  }
  return glossaryCache;
}

/** entries usable for word-matching in prose: skip slash-groups + phrase rows */
export function glossaryTerms(entries: GlossaryEntry[]): GlossaryEntry[] {
  return entries.filter((e) => /^[a-zA-Z][a-zA-Z0-9 -]{1,18}[a-zA-Z0-9]$/.test(e.term));
}
