import { useMemo } from "react";
import { sigilFromSeed, sigilCellAt } from "@/ui/deck/sigil";
import { sigilSeedForSoul } from "@/ui/chat/handleColor";

/**
 * The chat pfp (session-71): the deck passport's soul sigil at chat sizes,
 * seeded `soul:<id>` (the owner round — soul id is the only stable identity
 * fact both LogEvent shapes carry, and the seed matches the identity pane
 * so a player's own lines carry their passport sigil). System/kernel lines
 * (soul 0, no handle) render a NEUTRAL marker — they carry no identity.
 * Deterministic pure SVG, no untrusted input anywhere in the derivation.
 *
 * Session-71.1: the grid draws as ONE `<path>` (render-all means thousands
 * of sigils mount at once — one path per sigil, not twenty-five rects; the
 * pixels are identical).
 */

function coloredPaths(spec: ReturnType<typeof sigilFromSeed>): Array<{ d: string; fill: string }> {
  // group lit cells by color — one path per palette color (≤3 nodes total)
  const byColor = new Map<string, string>();
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const c = sigilCellAt(spec, x, y);
      if (!c.lit) continue;
      const hit = byColor.get(c.color);
      byColor.set(c.color, `${hit ?? ""}M${x} ${y}h1v1h-1z`);
    }
  }
  return Array.from(byColor.entries()).map(([fill, d]) => ({ d, fill }));
}

export function ChatSigil({ soul, size, system = false }: { soul: bigint; size: number; system?: boolean }) {
  const paths = useMemo(() => (system ? null : coloredPaths(sigilFromSeed(sigilSeedForSoul(soul)))), [soul, system]);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 5 5"
      shapeRendering="crispEdges"
      className="chat-sigil"
      data-testid="chat-sigil"
      role="img"
      aria-label={system ? "system line" : `soul ${soul.toString()} sigil`}
    >
      <rect x="0" y="0" width="5" height="5" fill="#050505" />
      {paths === null ? (
        <rect x="2" y="2" width="1" height="1" fill="#565656" />
      ) : (
        paths.map((p, i) => <path key={i} d={p.d} fill={p.fill} />)
      )}
    </svg>
  );
}
