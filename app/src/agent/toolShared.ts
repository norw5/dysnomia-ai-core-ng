import type { Abi, AbiFunction, Address } from "viem";
import { currentVenue } from "@/state/venueStore";
import type { GateEnvelope, GateOutcome } from "@/chain/txGate";

/**
 * Plumbing shared by the agent act-tool modules (tools.ts, deskTools.ts):
 * the venue resolver, the arg launderers, and the ONE-gate outcome
 * summaries. Extracted session-55 so the desk tools ride the exact same
 * render of gate results as the §7.3 catalog — no drift, no duplication.
 */

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** every tool result is capped before it enters model context (§7.7) */
export const TOOL_OUTPUT_CAP = 2560;

export function capOutput(value: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(value);
  if (json.length <= TOOL_OUTPUT_CAP) return value;
  return { truncated: true, note: `output ${json.length} chars > cap ${TOOL_OUTPUT_CAP}; narrow the query`, head: json.slice(0, TOOL_OUTPUT_CAP) };
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : String(v);
}

export function pickFn(abi: Abi, name: string, inputCount: number): AbiFunction {
  const hits = abi.filter((e): e is AbiFunction => e.type === "function" && e.name === name && e.inputs.length === inputCount);
  if (hits.length === 0) throw new Error(`ABI fragment not found: ${name}/${inputCount}`);
  return hits[0]!;
}

/** resolve the current venue: explicit arg -> app-global selection -> null */
export async function resolveVenue(addressArg: unknown): Promise<{ address: Address; label: string } | null> {
  if (typeof addressArg === "string" && ADDRESS_RE.test(addressArg)) {
    return { address: addressArg as Address, label: "arg" };
  }
  const row = currentVenue();
  if (row && ADDRESS_RE.test(row.a)) return { address: row.a as Address, label: "current-venue-store" };
  return null;
}

export function launderAddress(v: unknown): Address | null {
  return typeof v === "string" && ADDRESS_RE.test(v) ? (v as Address) : null;
}

export function requireSendFlag(args: Record<string, unknown>): boolean {
  return args["send"] === true;
}

export function outcomeSummary(out: GateOutcome | { status: "no-signer" }): Record<string, unknown> {
  if (out.status === "no-signer") return { status: "no-signer", error: "no account active — SETTINGS → wallet (mode A or B)" };
  const base: Record<string, unknown> = { status: out.status };
  if (out.status === "denied") base.reasons = out.reasons;
  if (out.status === "sim-failed") {
    base.error = "DRYRUN reverted — sending past it needs an explicit override ack";
    const err = out.envelope.sim?.error;
    if (err?.decoded) base.decoded = err.decoded;
  }
  if (out.status === "aborted") base.reason = out.reason;
  if (out.status === "sent") {
    base.txHash = out.txHash;
    base.receiptStatus = out.receipt?.status ?? null;
    base.gasUsed = out.receipt?.gasUsed.toString() ?? null;
    base.movements = out.movements.map((m) => ({ token: m.token, from: m.from, to: m.to, amount: m.amount.toString() }));
    if (out.receiptError) base.receiptError = out.receiptError;
  }
  return base;
}

export function envelopeSummary(env: GateEnvelope): Record<string, unknown> {
  return {
    to: env.request.to,
    selector: env.request.data.slice(0, 10),
    risk: env.cls.risk,
    policyAllowed: env.policy.allowed,
    policyReasons: env.policy.reasons,
    simOk: env.sim?.ok ?? null,
    simGas: env.sim?.gas?.toString() ?? null,
    simErrorDecoded: env.sim?.error?.decoded ?? null,
    note: env.sim?.ok === true ? "DRYRUN only — previews are pure (shared Entropy head); the committed result can differ" : null,
  };
}

export function dryrunGateSummary(env: GateEnvelope): Record<string, unknown> {
  const s = envelopeSummary(env);
  if (env.cls.risk === "unknown-contract") {
    s.note = `${s.note ?? ""} [venue/LAU instance — gate classifies unknown-contract; the approval card carries an extra ack]`.trim();
  }
  return s;
}
