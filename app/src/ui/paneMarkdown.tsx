import { type ReactNode } from "react";
import { parseBlocks } from "@/ui/guideRender";

/**
 * Pane-scoped compact markdown (session-64, the pane legibility round):
 * the guide's NO-DEP block parser reused verbatim (one source of truth —
 * headings/paras/lists/tables/rules/code fences), rendered with the old
 * site's AI-answer semantics: headings cyan, strong/code purple, links
 * INERT (§7.4 fence discipline — model text is data; no raw HTML anywhere,
 * React escaping is the fence). Terminal styling only, no new tokens.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g);
  const out: ReactNode[] = [];
  parts.forEach((part, pi) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out.push(
        <code className="apane-md-code" key={`${keyBase}-c${pi}`}>
          {part.slice(1, -1)}
        </code>
      );
      return;
    }
    const bolds = part.split(/(\*\*[^*]+\*\*)/g);
    bolds.forEach((seg, si) => {
      if (seg.startsWith("**") && seg.endsWith("**") && seg.length > 4) {
        out.push(
          <strong key={`${keyBase}-b${pi}-${si}`}>{seg.slice(2, -2)}</strong>
        );
        return;
      }
      // inert: model-authored links render as text with the href on hover.
      // session-79: split around links so surrounding text survives.
      const pieces = seg.split(/(\[[^\]]+\]\([^)]+\))/g);
      pieces.forEach((piece, li) => {
        const link = piece.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          out.push(
            <span className="apane-md-link" title={link[2]!} key={`${keyBase}-l${pi}-${si}-${li}`}>
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

export function PaneMarkdown({ text }: { text: string }): ReactNode {
  const blocks = parseBlocks(text);
  return (
    <div className="apane-md">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.kind) {
          case "heading": {
            const Tag = (`h${Math.min((b.level ?? 1) + 2, 6)}` as unknown) as "h4";
            return (
              <Tag className="apane-md-h" key={key}>
                {inline(b.text ?? "", key)}
              </Tag>
            );
          }
          case "para":
            return (
              <p className="apane-md-p" key={key}>
                {inline(b.text ?? "", key)}
              </p>
            );
          case "list": {
            const Tag = b.ordered === true ? "ol" : "ul";
            return (
              <Tag className="apane-md-ul" key={key}>
                {b.items?.map((it, j) => (
                  <li key={`${key}-${j}`}>
                    {inline(it.text, `${key}-${j}`)}
                    {it.children.length > 0 && (
                      <ul className="apane-md-ul">
                        {it.children.map((child, c) => (
                          <li key={`${key}-${j}-${c}`}>{inline(child.text, `${key}-${j}-${c}`)}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </Tag>
            );
          }
          case "table":
            return (
              <div className="apane-md-table-wrap" key={key}>
                <table className="apane-md-table">
                  <tbody>
                    {b.rows?.map((row, r) => (
                      <tr key={`${key}-r${r}`} className={r === 0 ? "apane-md-thead" : ""}>
                        {row.map((cell, c) =>
                          r === 0 ? (
                            <th key={`${key}-r${r}c${c}`}>{inline(cell, `${key}-r${r}c${c}`)}</th>
                          ) : (
                            <td key={`${key}-r${r}c${c}`}>{inline(cell, `${key}-r${r}c${c}`)}</td>
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
              <pre className="apane-md-pre mono" key={key}>
                {b.text}
              </pre>
            );
          case "rule":
            return <hr className="apane-md-rule" key={key} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
