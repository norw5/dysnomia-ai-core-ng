import { Fragment, type ReactNode } from "react";
import { glossary, glossaryTerms, type GlossaryEntry } from "@/state/guide";
import { anchorSlug } from "@/state/learnLink";

/**
 * Terminal-style markdown rendering for the LEARN corpus (IA-PLAN §6):
 * a small no-dependency renderer covering exactly what the 8 guide files
 * use — headings, paragraphs, bullet lists, tables, rules, code fences and
 * runs, bold/italics, and links (rendered INERT: the guide's `/dysnomia`
 * paths point at the research hub, not app routes). The glossary pass
 * wraps known terms in dotted-underlined <span>s whose title tooltip
 * carries the glossary meaning — the education layer's dictionary.
 */

export interface GuideListItem {
  text: string;
  children: GuideListItem[];
}

export interface GuideBlock {
  kind: "heading" | "para" | "list" | "table" | "rule" | "quote";
  level?: number;
  items?: GuideListItem[];
  /** session-79: numbered lists render as <ol> (the guide uses them) */
  ordered?: boolean;
  rows?: string[][];
  text?: string;
}

/** leading spaces (tabs count as 2 — the corpus uses spaces) */
function indentOf(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n++;
    else if (ch === "\t") n += 2;
    else break;
  }
  return n;
}

export function parseBlocks(md: string): GuideBlock[] {
  const lines = md.split("\n");
  const blocks: GuideBlock[] = [];
  let i = 0;
  const flushPara = (buf: string[]): void => {
    if (buf.some((l) => l.trim().length > 0)) blocks.push({ kind: "para", text: buf.join(" ").trim() });
  };
  let para: string[] = [];
  while (i < lines.length) {
    const line = lines[i]!;
    const t = line.trim();
    if (t.length === 0) {
      flushPara(para);
      para = [];
      i++;
      continue;
    }
    if (t.startsWith("```")) {
      flushPara(para);
      para = [];
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) {
        code.push(lines[i]!);
        i++;
      }
      i++; // closing fence
      blocks.push({ kind: "quote", text: code.join("\n") });
      continue;
    }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara(para);
      para = [];
      blocks.push({ kind: "heading", level: h[1]!.length, text: h[2]! });
      i++;
      continue;
    }
    if (/^-{3,}$/.test(t) || /^\*{3,}$/.test(t)) {
      flushPara(para);
      para = [];
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }
    if (t.startsWith("|")) {
      flushPara(para);
      para = [];
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const cells = lines[i]!.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push({ kind: "table", rows });
      continue;
    }
    if (t.startsWith("- ") || t.startsWith("* ") || /^\d+\.\s/.test(t)) {
      flushPara(para);
      para = [];
      // session-79: nested lists + indented continuation lines. A wrapped
      // item body (the README's "deployment waves…" case) joins its item;
      // deeper markers become real child lists instead of flat siblings.
      // Ordered markers render as <ol> (the guide's reading order).
      const items: GuideListItem[] = [];
      const ordered = /^\d+\.\s/.test(t);
      const stack: { indent: number; item: GuideListItem }[] = [];
      while (i < lines.length) {
        const raw = lines[i]!;
        if (raw.trim().length === 0) break; // a blank line ends the list
        const m = raw.match(/^(\s*)(?:[-*]|\d+\.)\s+(.*)$/);
        if (m) {
          const indent = m[1]!.length;
          const item: GuideListItem = { text: m[2]!.trim(), children: [] };
          while (stack.length > 0 && indent <= stack[stack.length - 1]!.indent) stack.pop();
          if (stack.length === 0) items.push(item);
          else stack[stack.length - 1]!.item.children.push(item);
          stack.push({ indent, item });
          i++;
          continue;
        }
        const cur = stack[stack.length - 1];
        if (cur !== undefined && indentOf(raw) > cur.indent) {
          cur.item.text = `${cur.item.text} ${raw.trim()}`.trim();
          i++;
          continue;
        }
        break; // a non-indented line ends the list
      }
      blocks.push({ kind: "list", items, ordered });
      continue;
    }
    if (t.startsWith(">")) {
      flushPara(para);
      para = [];
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(">")) {
        quote.push(lines[i]!.trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: quote.join(" ") });
      continue;
    }
    para.push(t);
    i++;
  }
  flushPara(para);
  return blocks;
}

// ---- inline rendering: code → bold/italic → glossary terms ----

/** render a markdown table cell / paragraph fragment with code + bold spans */
function inlineNodes(text: string, keyBase: string): ReactNode[] {
  // split on `code` first
  const parts = text.split(/(`[^`]+`)/g);
  const out: ReactNode[] = [];
  parts.forEach((part, pi) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out.push(
        <code className="guide-code" key={`${keyBase}-c${pi}`}>
          {part.slice(1, -1)}
        </code>
      );
      return;
    }
    // bold segments
    const bolds = part.split(/(\*\*[^*]+\*\*)/g);
    bolds.forEach((seg, si) => {
      if (seg.startsWith("**") && seg.endsWith("**") && seg.length > 4) {
        out.push(
          <strong key={`${keyBase}-b${pi}-${si}`}>{seg.slice(2, -2)}</strong>
        );
        return;
      }
      // inert links: [text](href) — the guide's hub paths are not app routes.
      // session-79: split the segment so the text AROUND a link survives
      // (the old first-match path dropped everything but the label).
      const pieces = seg.split(/(\[[^\]]+\]\([^)]+\))/g);
      pieces.forEach((piece, li) => {
        const link = piece.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          out.push(
            <span className="guide-link" title={link[2]!} key={`${keyBase}-l${pi}-${si}-${li}`}>
              {link[1]}
            </span>
          );
          return;
        }
        if (piece.length > 0) out.push(piece);
      });
    });
  });
  return out;
}

let termsRegexCache: { re: RegExp; terms: GlossaryEntry[] } | null = null;

function termsIndex(): { re: RegExp; terms: GlossaryEntry[] } {
  if (termsRegexCache === null) {
    const terms = glossaryTerms(glossary());
    const alt = terms
      .map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .sort((a, b) => b.length - a.length)
      .join("|");
    termsRegexCache = { re: new RegExp(`\\b(${alt})\\b`, "g"), terms };
  }
  return termsRegexCache;
}

/** the dotted-underline dictionary pass over one text run */
export function withGlossary(text: string, keyBase: string, nodes?: ReactNode[]): ReactNode[] {
  const base = nodes ?? inlineNodes(text, keyBase);
  const { re, terms } = termsIndex();
  if (terms.length === 0) return base;
  const lookup = new Map(terms.map((t) => [t.term.toLowerCase(), t]));
  const out: ReactNode[] = [];
  base.forEach((node, ni) => {
    if (typeof node !== "string") {
      out.push(node);
      return;
    }
    let last = 0;
    const src = node;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = re.exec(src)) !== null) {
      const hit = lookup.get(m[1]!.toLowerCase());
      if (!hit) continue;
      if (m.index > last) out.push(<Fragment key={`${keyBase}-g${ni}-${k}a`}>{src.slice(last, m.index)}</Fragment>);
      out.push(
        <span className="gl-term" title={`${hit.term}${hit.alt ?? ""} — ${hit.meaning.replace(/\*\*/g, "")}`} key={`${keyBase}-g${ni}-${k}b`}>
          {m[1]}
        </span>
      );
      k++;
      last = m.index + m[1]!.length;
    }
    if (last === 0) out.push(node);
    else if (last < src.length) out.push(<Fragment key={`${keyBase}-g${ni}-z`}>{src.slice(last)}</Fragment>);
  });
  return out;
}

function GuideList({ items, keyBase, ordered = false }: { items: GuideListItem[]; keyBase: string; ordered?: boolean }): ReactNode {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className="guide-ul">
      {items.map((it, j) => (
        <li key={`${keyBase}-${j}`}>
          {withGlossary(it.text, `${keyBase}-${j}`)}
          {it.children.length > 0 && <GuideList items={it.children} keyBase={`${keyBase}-${j}`} />}
        </li>
      ))}
    </Tag>
  );
}

export function GuideBlocks({ md, }: { md: string }): ReactNode {
  const blocks = parseBlocks(md);
  return (
    <>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.kind) {
          case "heading": {
            const Tag = (`h${Math.min((b.level ?? 1) + 1, 6)}` as unknown) as "h2";
            return (
              <Tag className="guide-h" key={key} id={anchorSlug(b.text ?? "")} data-testid={`guide-h-${i}`}>
                {withGlossary(b.text ?? "", key)}
              </Tag>
            );
          }
          case "para":
            return (
              <p className="guide-p" key={key}>
                {withGlossary(b.text ?? "", key)}
              </p>
            );
          case "list":
            return <GuideList items={b.items ?? []} keyBase={key} ordered={b.ordered === true} key={key} />;
          case "table":
            return (
              <div className="guide-table-wrap" key={key}>
                <table className="guide-table">
                  <tbody>
                    {b.rows?.map((row, r) => (
                      <tr key={`${key}-r${r}`} className={r === 0 ? "guide-thead" : ""}>
                        {row.map((cell, c) =>
                          r === 0 ? (
                            <th key={`${key}-r${r}c${c}`}>{inlineNodes(cell, `${key}-r${r}c${c}`)}</th>
                          ) : (
                            <td key={`${key}-r${r}c${c}`}>{withGlossary(cell, `${key}-r${r}c${c}`)}</td>
                          )
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "quote":
            return (
              <pre className="guide-pre mono" key={key}>
                {b.text}
              </pre>
            );
          case "rule":
            return <hr className="guide-rule" key={key} />;
          default:
            return null;
        }
      })}
    </>
  );
}
