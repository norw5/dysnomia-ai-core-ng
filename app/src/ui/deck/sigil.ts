/**
 * The deck passport's soul sigil (session-57): deterministic hash-art from
 * the SOUL id (Saat[1]) — or the wallet address before a LAU exists. The
 * predecessor's SoulSigil IDEA (mirrored 5×5 grid keyed by a string hash)
 * rebuilt in the ng palette: amber / terminal-green / cyan on black, no
 * arbitrary hues — DESIGN.md law. Pure derivation, testable, no deps.
 */

export const SIGIL_PALETTE = ["#ffb000", "#00ff41", "#00f0ff"] as const;

export interface SigilSpec {
  /** 15 lit/unlit cells (3 unique columns × 5 rows, mirrored to 5 wide) */
  cells: boolean[];
  /** palette pick per lit cell (same index space as cells) */
  colors: string[];
}

/** FNV-1a 32-bit — stable across runs, no crypto weight needed for art */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function sigilFromSeed(seed: string): SigilSpec {
  const shape = fnv1a(seed);
  const color = fnv1a(`${seed}::c`);
  const cells: boolean[] = [];
  const colors: string[] = [];
  for (let i = 0; i < 15; i++) {
    const lit = ((shape >> i) & 1) === 1;
    cells.push(lit);
    colors.push(lit ? SIGIL_PALETTE[(color >>> (i % 30)) % SIGIL_PALETTE.length]! : "#000");
  }
  return { cells, colors };
}

/** mirror the 3 unique columns onto the 5-wide row (x ↔ 4−x) */
export function sigilCellAt(spec: SigilSpec, x: number, y: number): { lit: boolean; color: string } {
  const ux = x <= 2 ? x : 4 - x;
  const idx = y * 3 + ux;
  return { lit: spec.cells[idx] ?? false, color: spec.colors[idx] ?? "#000" };
}
