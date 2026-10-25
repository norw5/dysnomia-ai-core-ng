import type { PublicClient } from "viem";

/**
 * Block timestamps for the rich chat layout (session-71): LogEvent lines
 * carry BLOCK numbers, not times — the honest UTC timestamp is one
 * anonymous `eth_getBlock` read per DISTINCT block, cached forever (a
 * block's timestamp never changes). Readers keep their fetch queues
 * bounded (the view fetches only for the rendered slice); a failed read
 * resolves null and un-caches so a later pass may retry — a dead RPC
 * renders the block number, never a fabricated time.
 */

const cache = new Map<number, Promise<number | null>>();

export function getBlockTime(client: PublicClient, block: number): Promise<number | null> {
  const hit = cache.get(block);
  if (hit) return hit;
  const p = client
    .getBlock({ blockNumber: BigInt(block) })
    .then((b) => Number(b.timestamp))
    .catch(() => {
      cache.delete(block);
      return null;
    });
  cache.set(block, p);
  return p;
}

/** whether a block already has a resolved-or-pending time (queue-bounding check) */
export function hasBlockTime(block: number): boolean {
  return cache.has(block);
}

/** test seam */
export function _resetBlockTimeForTests(): void {
  cache.clear();
}

/** UTC display: `YYYY-MM-DD HH:MM` (compact mono) — full ISO lives in the title */
export function formatUtc(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ");
}
