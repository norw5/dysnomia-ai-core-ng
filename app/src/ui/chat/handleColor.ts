/**
 * Per-soul visual identity for the CHAT module (session-71, the owner's
 * round: SOUL-ID seeded): the deterministic handle color from the pinned
 * accent set (the session-44 HANDLE_COLORS precedent) + the sigil seed
 * string. Soul id is the ONLY stable identity fact both LogEvent shapes
 * carry — and `soul:<id>` is the identity pane's own convention, so a
 * player's chat sigil equals their passport sigil (the impersonation hint:
 * usernames can look visually indistinguishable, soul-seeded art cannot).
 */

/** deterministic handle color from the pinned accent set (DESIGN.md tokens) */
export const HANDLE_COLORS = ["#ffb000", "#00f0ff", "#00ff41", "#ffd24d", "#8fd8ff"] as const;

export function handleColor(soul: bigint): string {
  return HANDLE_COLORS[Number(soul % BigInt(HANDLE_COLORS.length))]!;
}

/** the sigil seed for a chatter — same convention as the identity pane */
export function sigilSeedForSoul(soul: bigint): string {
  return `soul:${soul.toString()}`;
}
