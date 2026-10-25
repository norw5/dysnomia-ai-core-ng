import DOMPurify from "dompurify";
import type { ReactNode } from "react";

/**
 * The untrusted-content fence (IA-PLAN §7.4, session-44): chat lines are
 * COMMUNITY CONTENT — onchain strings anyone can write. Rules encoded here:
 *
 *  1. chat text renders as React TEXT nodes only — escaped by React, never
 *     innerHTML; there is no dangerouslySetInnerHTML anywhere in this app;
 *  2. URLs inside chat become OUT-LINKS only: scheme http/https, no
 *     whitespace/control/meta-character smuggling, and the href passes a
 *     DOMPurify sanitize round (the one new dependency the plan names —
 *     added consciously); anything that fails renders as plain text;
 *  3. sender/text are DATA — never authoritative, visually framed as
 *     community content by the view's fence banner.
 */

const URI_STRICT = /^https?:\/\/[^\s<>"'`\\]+$/i;

let purifyReady: boolean | null = null;

function purifyAvailable(): boolean {
  if (purifyReady === null) {
    purifyReady =
      typeof window !== "undefined" && typeof DOMPurify.isSupported === "boolean" && DOMPurify.isSupported;
  }
  return purifyReady;
}

/**
 * Validate + clean a link target. Returns the safe href, or null when the
 * candidate must NOT become a link. DOMPurify runs the anchor through a
 * minimal profile (a[href] only, http(s) URI regexp) — javascript:, data:,
 * vbscript: and every other scheme is refused by construction, and markup
 * smuggled inside the href cannot survive the round-trip.
 */
export function sanitizeLinkHref(href: string): string | null {
  const t = href.trim();
  if (!URI_STRICT.test(t)) return null;
  if (t.length > 512) return null;
  if (!purifyAvailable()) return t; // no DOM (SSR/tests): the strict regex is the floor
  const probe = DOMPurify.sanitize(`<a href="${t}">x</a>`, {
    ALLOWED_TAGS: ["a"],
    ALLOWED_ATTR: ["href"],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
    ALLOW_ARIA_ATTR: false,
  });
  // read the attribute back through the DOM (serialization would entity-
  // escape & in query strings; getAttribute gives the parsed value)
  const doc = new DOMParser().parseFromString(probe, "text/html");
  const got = doc.querySelector("a")?.getAttribute("href") ?? null;
  return got === t ? t : null;
}

const URL_TOKEN = /(https?:\/\/[^\s<>]+)/g;

/**
 * Split an untrusted chat body into safe React nodes: text runs + out-links.
 * Everything that is not a passing http(s) URL stays inert text.
 *
 * Session-71.1: results are MEMOIZED per body string — render-all mounts
 * thousands of rows and every state change used to re-run the regex +
 * DOMPurify round for every mounted line (the user-pane delay the owner
 * reported). Elements are immutable descriptors; reuse is safe. The cache
 * is bounded by the corpus (the bodies themselves are already in memory).
 */
const bodyCache = new Map<string, ReactNode[]>();

export function renderChatBody(body: string): ReactNode[] {
  const hit = bodyCache.get(body);
  if (hit !== undefined) return hit;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(URL_TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(body.slice(last, idx));
    const href = sanitizeLinkHref(m[0]);
    if (href === null) {
      out.push(m[0]);
    } else {
      out.push(
        <a key={`${idx}-${href}`} className="chat-link" href={href} target="_blank" rel="noreferrer noopener">
          {m[0]}
        </a>
      );
    }
    last = idx + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  if (bodyCache.size > 40_000) bodyCache.clear(); // corpus-scale bound; regenerate is cheap
  bodyCache.set(body, out);
  return out;
}
