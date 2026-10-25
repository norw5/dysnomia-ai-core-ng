import type { ContractFacts } from "@/chain/facts";

/**
 * The policy half of the ONE tx gate (IA-PLAN §7.2): per-token/session/day
 * caps, destination tiers, method-risk classes. Pure functions + a ledger —
 * no sends happen here; txGate.ts is the only caller that matters.
 */

export type Wei = bigint;

export interface PolicyConfig {
  /** max sends per browser session (manual + agent combined) */
  maxTxPerSession: number;
  /** max sends per rolling UTC day */
  maxTxPerDay: number;
  /** max native value (PLS wei) per single send */
  maxValuePerTxWei: Wei;
  /** max native value per session */
  maxValuePerSessionWei: Wei;
  /** max native value per rolling UTC day */
  maxValuePerDayWei: Wei;
  /** unknown destinations (not in the perimeter) — manual sends need an extra ack, agent always denied */
  allowUnknownDestinations: boolean;
  /** per-token movement caps (wei) per session, keyed by token address (lowercase) */
  perTokenSessionCapWei: Record<string, Wei>;
}

/**
 * The default PLS-value caps (owner round): the original 10/25/100 PLS were
 * dust at PLS price levels (1,000,000 PLS is well under $10) and blocked
 * legitimate venue/Beat/desk value flows. Per-tx 1M / session 2.5M / day 5M
 * keeps the guardrails real without blocking normal play. The send COUNT
 * caps (40/120) stay as they were.
 */
export const DEFAULT_POLICY: PolicyConfig = {
  maxTxPerSession: 40,
  maxTxPerDay: 120,
  maxValuePerTxWei: 1_000_000n * 10n ** 18n,
  maxValuePerSessionWei: 2_500_000n * 10n ** 18n,
  maxValuePerDayWei: 5_000_000n * 10n ** 18n,
  allowUnknownDestinations: true,
  perTokenSessionCapWei: {},
};

export type DestinationTier = "perimeter" | "unknown";

export type RiskClass =
  | "read" // view/pure — never goes through the send path
  | "standard" // nonpayable, public gate, perimeter destination
  | "privileged" // owners/bouncers gate — likely to fail unless actor matches
  | "value" // payable — value caps bind
  | "unknown-contract" // destination not in the perimeter
  | "unknown-method" // no facts row for this selector on a perimeter contract
  | "deploy"; // contract CREATION (to: null + creation bytecode) — session-66

export interface MethodClass {
  risk: RiskClass;
  tier: DestinationTier;
  gate: string | null;
  metered: boolean;
  reverts: string[];
  contract: string | null;
  functionSig: string | null;
}

export interface PolicyCheckInput {
  /** null = contract DEPLOYMENT (creation bytecode in data, no destination) */
  to: string | null;
  data: `0x${string}`;
  value: Wei;
  facts: ContractFacts;
}

export function classify(input: PolicyCheckInput): MethodClass {
  if (input.to === null) {
    // session-66: the deployment gate surface — a creation tx (to: null).
    // There is no destination to tier and no selector to look up; the
    // honest class is its own risk, never "standard".
    return {
      risk: "deploy",
      tier: "unknown",
      gate: null,
      metered: false,
      reverts: [],
      contract: null,
      functionSig: null,
    };
  }
  const to = input.to.toLowerCase();
  const entry = input.facts.byAddress[to];
  if (!entry) {
    return {
      risk: "unknown-contract",
      tier: "unknown",
      gate: null,
      metered: false,
      reverts: [],
      contract: null,
      functionSig: null,
    };
  }
  const selector = input.data.slice(0, 10).toLowerCase();
  const sig = entry.bySelector[selector];
  if (!sig) {
    return {
      risk: "unknown-method",
      tier: "perimeter",
      gate: null,
      metered: false,
      reverts: [],
      contract: entry.name,
      functionSig: null,
    };
  }
  const fn = entry.contract.functions[sig]!;
  const mut = fn.mutability;
  let risk: RiskClass;
  if (mut === "view" || mut === "pure") risk = "read";
  else if (mut === "payable") risk = "value";
  else if (fn.gate === "owners" || fn.gate === "bouncers" || fn.gate === "internal" || fn.gate === "private")
    risk = "privileged";
  else risk = "standard";
  return {
    risk,
    tier: "perimeter",
    gate: fn.gate,
    metered: fn.metered,
    reverts: fn.reverts,
    contract: entry.name,
    functionSig: sig,
  };
}

export interface PolicyVerdict {
  allowed: boolean;
  reasons: string[];
  risk: RiskClass;
  tier: DestinationTier;
  /** manual sends to unknown destinations / unknown methods must ack this */
  requiresExtraAck: boolean;
}

export interface SessionDayCounters {
  sessionTx: number;
  sessionValueWei: Wei;
  dayKey: string; // UTC yyyy-mm-dd
  dayTx: number;
  dayValueWei: Wei;
  /** net token movements per session keyed by token address (lowercase) */
  tokenOutWei: Record<string, Wei>;
}

export function dayKeyOf(t: Date): string {
  return t.toISOString().slice(0, 10);
}

/** Rolling-day aware: pass now=Date for tests. */
export function freshCounters(now: Date, previous?: SessionDayCounters | null): SessionDayCounters {
  const key = dayKeyOf(now);
  if (previous && previous.dayKey === key) return previous;
  return { sessionTx: 0, sessionValueWei: 0n, dayKey: key, dayTx: 0, dayValueWei: 0n, tokenOutWei: {} };
}

export function policyCheck(
  input: PolicyCheckInput,
  policy: PolicyConfig,
  counters: SessionDayCounters
): PolicyVerdict {
  const mc = classify(input);
  const reasons: string[] = [];
  let requiresExtraAck = false;

  if (mc.risk === "read") reasons.push("read-only call routed through the send path — use DRYRUN/CALL instead");
  if (mc.risk === "unknown-contract") {
    requiresExtraAck = true;
    if (!policy.allowUnknownDestinations) reasons.push("destination is not in the perimeter and unknown destinations are disabled");
  }
  if (mc.risk === "deploy") {
    // a creation tx IS the ultimate unknown destination — the same toggle
    // governs it (session-66; fork-pinned by harness set-2 s14)
    requiresExtraAck = true;
    if (!policy.allowUnknownDestinations)
      reasons.push("contract deployment disabled — unknown destinations are disabled");
  }
  if (mc.risk === "unknown-method") requiresExtraAck = true;
  if (mc.risk === "privileged") requiresExtraAck = true; // needs the right actor — ack, not denial
  if (input.value > policy.maxValuePerTxWei)
    reasons.push(`value ${input.value.toString()} exceeds per-tx cap ${policy.maxValuePerTxWei.toString()}`);
  if (counters.sessionTx >= policy.maxTxPerSession) reasons.push(`session tx cap reached (${policy.maxTxPerSession})`);
  if (counters.dayTx >= policy.maxTxPerDay) reasons.push(`daily tx cap reached (${policy.maxTxPerDay})`);
  if (counters.sessionValueWei + input.value > policy.maxValuePerSessionWei)
    reasons.push("session PLS-value cap would be exceeded");
  if (counters.dayValueWei + input.value > policy.maxValuePerDayWei)
    reasons.push("daily PLS-value cap would be exceeded");

  return { allowed: reasons.length === 0, reasons, risk: mc.risk, tier: mc.tier, requiresExtraAck };
}

/** Post-receipt accounting: value spend + net token-out movements against caps. */
export function recordSpend(
  counters: SessionDayCounters,
  value: Wei,
  tokenMovements: Array<{ token: string; from: string; to: string; amount: Wei }>,
  account: string,
  policy: PolicyConfig
): { counters: SessionDayCounters; breaches: string[] } {
  const next: SessionDayCounters = {
    ...counters,
    sessionTx: counters.sessionTx + 1,
    dayTx: counters.dayTx + 1,
    sessionValueWei: counters.sessionValueWei + value,
    dayValueWei: counters.dayValueWei + value,
    tokenOutWei: { ...counters.tokenOutWei },
  };
  const breaches: string[] = [];
  const acct = account.toLowerCase();
  for (const m of tokenMovements) {
    if (m.from.toLowerCase() !== acct) continue;
    const key = m.token.toLowerCase();
    const out = (next.tokenOutWei[key] ?? 0n) + m.amount;
    next.tokenOutWei[key] = out;
    const cap = policy.perTokenSessionCapWei[key];
    if (cap !== undefined && out > cap) {
      breaches.push(`session cap exceeded for token ${key}: ${out.toString()} > ${cap.toString()}`);
    }
  }
  return { counters: next, breaches };
}
