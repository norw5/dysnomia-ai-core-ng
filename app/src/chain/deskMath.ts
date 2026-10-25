/**
 * The desk math shared by the manual MARKET views (session-48/52) and the
 * agent desk tools (session-55): decimal parsing and the deployed
 * Purchase/Hong/Hung rate math `amount × rate / 1e18` (01_dysnomia_v2.sol,
 * yue.sol — fork-pinned at 1:1 in harness set-2 s12). One source, never
 * re-implemented at call sites.
 */

export const UNIT = 10n ** 18n;

/** parse a user/model decimal amount into wei (null = invalid; >18 frac digits rejected) */
export function parseAmount(input: string): bigint | null {
  return parseAmountToDecimals(input, 18);
}

/**
 * The decimals-generalized parse (session-56: move_tokens meets non-family
 * ERC-20s). Same grammar as parseAmount — whole-token decimals scaled to
 * `decimals` places; >`decimals` frac digits rejected (never silently
 * truncated). parseAmount stays the 18-place family view of this function.
 */
export function parseAmountToDecimals(input: string, decimals: number): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) return null;
  const t = input.trim();
  if (!/^\d*(\.\d*)?$/.test(t) || t.length === 0) return null;
  const [intRaw, frac = ""] = t.split(".");
  const int = (intRaw ?? "").length > 0 ? (intRaw as string) : "0";
  if (frac.length > decimals) return null;
  const fracWei = frac.length > 0 ? BigInt((frac + "0".repeat(decimals)).slice(0, decimals)) : 0n;
  return BigInt(int) * 10n ** BigInt(decimals) + fracWei;
}

/** the cost of buying `amount` at `rate` (both 1e18-scaled) — the deployed Purchase/Hong math; also Hung's payout */
export function purchaseCost(amount: bigint, rate: bigint): bigint {
  return (amount * rate) / UNIT;
}
