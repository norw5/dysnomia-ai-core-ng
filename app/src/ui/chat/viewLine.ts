import { parseLine, type SeedMsg } from "@/state/chatSeed";
import type { TailLine } from "@/chain/chatTail";

/**
 * The CHAT module's unified line shape (session-71): seed archive lines and
 * live-tail lines share ONE id space (`${tx}-${logIndex}`) and ONE display
 * type. Extracted from ChatView so the user pane, the search helper, and the
 * row renderer all share the exact same converters (zero drift).
 */

export interface ViewLine {
  id: string;
  block: number;
  tx: string;
  logIndex: number;
  soul: bigint;
  aura: bigint;
  handle: string | null;
  body: string;
  source: "seed" | "live";
}

export function seedToLine(m: SeedMsg): ViewLine {
  const { handle, body } = parseLine(m.msg);
  return {
    id: `${m.tx}-${m.log_index}`,
    block: m.block,
    tx: m.tx,
    logIndex: m.log_index,
    soul: BigInt(m.soul),
    aura: BigInt(m.aura),
    handle,
    body,
    source: "seed",
  };
}

export function tailToLine(l: TailLine): ViewLine {
  const parsed = parseLine(l.line);
  return {
    id: l.id,
    block: l.block,
    tx: l.tx,
    logIndex: l.logIndex,
    soul: l.soul,
    aura: l.aura,
    handle: l.username ?? parsed.handle,
    body: l.username !== null ? l.line : parsed.body,
    source: "live",
  };
}

/** dedupe by id + order by (block, logIndex) — seed and live share the id space */
export function combineLines(seed: ViewLine[], live: ViewLine[]): ViewLine[] {
  const seen = new Set<string>();
  const out: ViewLine[] = [];
  for (const l of [...seed, ...live].sort(
    (a, b) => a.block - b.block || a.logIndex - b.logIndex || (a.id < b.id ? -1 : 1)
  )) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    out.push(l);
  }
  return out;
}

/** system/kernel lines: soul 0 with no parsed handle (e.g. "Added to Yi.Nu") */
export function isSystemLine(l: ViewLine): boolean {
  return l.soul === 0n && l.handle === null;
}
