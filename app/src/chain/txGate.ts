import { decodeErrorResult, type Abi } from "viem";
import type { ContractFacts } from "@/chain/facts";
import type { Journal } from "@/chain/journal";
import {
  classify,
  policyCheck,
  recordSpend,
  type MethodClass,
  type PolicyConfig,
  type PolicyVerdict,
  type SessionDayCounters,
} from "@/chain/policy";

/**
 * THE transaction gate (IA-PLAN §7.2). Every send — manual button or future
 * agent tool — passes: policy check → simulation (eth_call + gas estimate) →
 * approval resolution (mode + autonomy + risk) → send → receipt decode →
 * journal entry. No send path may bypass `sendTransaction` below.
 *
 * Mode A (injected wallet): every send prompts the wallet; the app-side card
 * shows the same envelope first. Mode B: per-action UI approval. Mode C
 * (yolo): no per-action prompt for standard perimeter sends — bounded by
 * policy; extra ack still required for unknown dest/method + privileged gates.
 */

export type WalletMode = "A" | "B" | "C";

export interface GateRequest {
  /** null = contract DEPLOYMENT (creation bytecode in data) — session-66 */
  to: `0x${string}` | null;
  data: `0x${string}`;
  value?: bigint | undefined;
  account: `0x${string}`;
  /** for custom-error decode (STUDIO/views pass the target ABI) */
  abi?: Abi | undefined;
  meta?: { source: "manual" | "agent"; label?: string | undefined } | undefined;
}

export interface SimResult {
  ok: boolean;
  /** eth_call return data on success, null otherwise */
  result: `0x${string}` | null;
  gas: bigint | null;
  error: { message: string; decoded: string | null; data: `0x${string}` | null } | null;
}

export interface GateEnvelope {
  request: GateRequest;
  cls: MethodClass;
  policy: PolicyVerdict;
  sim: SimResult | null;
}

export interface ReceiptLike {
  status: "success" | "reverted";
  gasUsed: bigint;
  logs: ReadonlyArray<{ address: string; topics: string[]; data: `0x${string}` }>;
  blockNumber: bigint | null;
  /** set on creation receipts — the deployed contract's address */
  contractAddress: string | null;
}

export interface TokenMovement {
  token: string;
  from: string;
  to: string;
  amount: bigint;
}

export type GateOutcome =
  | { status: "denied"; envelope: GateEnvelope; reasons: string[] }
  | { status: "sim-failed"; envelope: GateEnvelope }
  | { status: "aborted"; envelope: GateEnvelope; reason: string }
  | {
      status: "sent";
      envelope: GateEnvelope;
      txHash: `0x${string}`;
      receipt: ReceiptLike | null;
      receiptError: string | null;
      movements: TokenMovement[];
      capBreaches: string[];
    };

export interface GateClient {
  call(args: { to: `0x${string}` | null; data: `0x${string}`; value?: bigint; account: `0x${string}` }): Promise<`0x${string}`>;
  estimateGas(args: { to: `0x${string}` | null; data: `0x${string}`; value?: bigint; account: `0x${string}` }): Promise<bigint>;
  waitForReceipt(txHash: `0x${string}`, timeoutMs: number): Promise<ReceiptLike>;
}

export interface GateSigner {
  mode: WalletMode;
  account: `0x${string}`;
  sendTransaction(args: {
    to: `0x${string}` | null;
    data: `0x${string}`;
    value?: bigint;
    /** from the DRYRUN estimate (padded) so signers never re-estimate blind */
    gas?: bigint;
  }): Promise<`0x${string}`>;
}

export interface DryRunDeps {
  client: GateClient;
  facts: ContractFacts;
  policy: PolicyConfig;
  journal: Journal;
  counters: SessionDayCounters;
}

export interface GateDeps extends DryRunDeps {
  signer: GateSigner;
  signerMode: WalletMode;
  /**
   * Mode-C BREADTH (session-65, the yolo relaxation): auto-ack
   * unknown-CONTRACT sends (destination-based) in mode C — the app's own
   * LAU/YUE instances and venue tokens live at non-perimeter addresses.
   * Policy caps still bind (policyCheck ran first); unknown-METHOD and
   * privileged gates STILL ask. Ignored in modes A/B.
   */
  modeCBreadth?: boolean;
  /** set counters after each send (ledger write-back) */
  onCounters?: (c: SessionDayCounters) => void;
  /** the UI approval card; resolve true = send, false = abort */
  approval?: (envelope: GateEnvelope) => Promise<boolean>;
  receiptTimeoutMs?: number;
}

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** deploys carry no selector — the journal keeps an honest null */
function selectorOf(request: GateRequest): `0x${string}` | null {
  return request.to === null ? null : (request.data.slice(0, 10) as `0x${string}`);
}

/** the revert DATA of a thrown viem error — walk the whole cause chain.
 * Session-73 fix: viem's CallExecutionError carries the revert data at
 * `err.cause.cause.data` (RequestRpcError), NOT at `err.data` — the old
 * `err.data ?? err.cause.data` read returned null for EVERY client.call
 * revert, so DRYRUNs reported "reverted" with no decoded reason (the
 * full-auto video's entire confused home-QING arc; the chain had
 * `QingAlreadyExists(<lau>, <the existing qing>)` in hand all along). */
export function revertDataOf(e: unknown): `0x${string}` | null {
  let cur: unknown = e;
  for (let i = 0; i < 8; i++) {
    if (cur === null || cur === undefined) break;
    const data = (cur as { data?: unknown }).data;
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) return data as `0x${string}`;
    cur = (cur as { cause?: unknown }).cause;
  }
  // last resort: viem's `details` text — "execution reverted: custom error
  // 0x<selector>: <args-hex>" carries the same payload as text
  const details = (e as { details?: unknown }).details;
  if (typeof details === "string") {
    const m = /custom error (0x[0-9a-fA-F]{8}):?\s*([0-9a-fA-F]*)/.exec(details);
    if (m !== null && m[1] !== undefined) return (m[1] + (m[2] ?? "")) as `0x${string}`;
    const contiguous = details.match(/0x[0-9a-fA-F]{10,}/);
    if (contiguous !== null) return contiguous[0] as `0x${string}`;
  }
  return null;
}

export function decodeCustomError(abi: Abi | undefined, data: `0x${string}` | null): string | null {
  if (!abi || !data || data.length < 10 || !data.startsWith("0x")) return null;
  try {
    const decoded = decodeErrorResult({ abi, data });
    if (decoded && typeof decoded.errorName === "string") {
      const raw = decoded.args;
      const args = Array.isArray(raw)
        ? raw.join(", ")
        : raw !== undefined && typeof raw === "object"
          ? Object.values(raw as unknown as Record<string, unknown>).join(", ")
          : String(raw ?? "");
      return args.length > 0 ? `${decoded.errorName}(${args})` : decoded.errorName;
    }
  } catch {
    /* not decodable from this ABI — fall through */
  }
  return null;
}

export function extractMovements(receipt: ReceiptLike): TokenMovement[] {
  const out: TokenMovement[] = [];
  for (const log of receipt.logs) {
    if (log.topics.length !== 3 || log.topics[0]!.toLowerCase() !== TRANSFER_TOPIC) continue;
    const from = "0x" + log.topics[1]!.slice(26);
    const to = "0x" + log.topics[2]!.slice(26);
    const amount = BigInt(log.data === "0x" ? 0 : log.data);
    out.push({ token: log.address, from, to, amount });
  }
  return out;
}

/** policy + simulation only — the DRYRUN path. Never sends. */
export async function dryRun(deps: DryRunDeps, request: GateRequest): Promise<GateEnvelope> {
  const value = request.value ?? 0n;
  const cls = classify({ to: request.to, data: request.data, value, facts: deps.facts });
  const verdict = policyCheck({ to: request.to, data: request.data, value, facts: deps.facts }, deps.policy, deps.counters);
  deps.journal.emit("gate.policy", `policy ${verdict.allowed ? "PASS" : "DENY"} · ${cls.risk}${cls.contract ? ` · ${cls.contract}` : ""}`, {
    to: request.to,
    selector: selectorOf(request),
    risk: cls.risk,
    allowed: verdict.allowed,
    reasons: verdict.reasons,
    source: request.meta?.source ?? "manual",
  });

  const sim = await simulate(deps, request);
  return { request, cls, policy: verdict, sim };
}

async function simulate(deps: DryRunDeps, request: GateRequest): Promise<SimResult> {
  const value = request.value ?? 0n;
  const args = { to: request.to, data: request.data, value, account: request.account };
  let gas: bigint | null = null;
  let callError: SimResult["error"] = null;
  let result: `0x${string}` | null = null;
  try {
    result = await deps.client.call(args);
  } catch (e) {
    const data = revertDataOf(e);
    callError = {
      message: e instanceof Error ? e.message : String(e),
      decoded: decodeCustomError(request.abi, data),
      data,
    };
  }
  try {
    gas = await deps.client.estimateGas(args);
  } catch (e) {
    if (!callError) {
      const data = revertDataOf(e);
      callError = { message: e instanceof Error ? e.message : String(e), decoded: decodeCustomError(request.abi, data), data };
    }
  }
  const sim: SimResult = { ok: callError === null, result, gas, error: callError };
  deps.journal.emit(
    "gate.sim",
    sim.ok ? `DRYRUN ok${gas !== null ? ` · gas ~${gas.toString()}` : ""}` : `DRYRUN revert${sim.error?.decoded ? `: ${sim.error.decoded}` : ""}`,
    { to: request.to, selector: selectorOf(request), ok: sim.ok, gas: gas?.toString(), error: sim.error }
  );
  return sim;
}

function approvalRequired(deps: GateDeps, envelope: GateEnvelope): boolean {
  if (deps.signerMode === "A" || deps.signerMode === "B") return true;
  // mode C: auto within policy, but the policy-marked cases still ask —
  // EXCEPT the breadth toggle's auto-ack (session-65 for unknown-CONTRACT
  // sends; session-66 extends it to DEPLOYMENT per the owner round — the
  // DSS desk's creation tx rides the same relaxation): unknown-METHOD and
  // privileged gates keep asking
  if (
    deps.modeCBreadth === true &&
    (envelope.cls.risk === "unknown-contract" || envelope.cls.risk === "deploy")
  )
    return false;
  return envelope.policy.requiresExtraAck;
}

export interface SendOptions {
  /** override-with-warning pattern (DESIGN.md): explicit user ack to send past a failed DRYRUN */
  allowSimFailure?: boolean;
  /** skip the app-side card (used when the caller just showed the same envelope) */
  approvalAlreadyGranted?: boolean;
}

export async function sendTransaction(deps: GateDeps, request: GateRequest, opts: SendOptions = {}): Promise<GateOutcome> {
  const envelope = await dryRun(deps, request);
  const sim = envelope.sim; // dryRun always attaches a sim
  if (sim === null) throw new Error("dryRun returned no simulation");
  if (!envelope.policy.allowed) {
    deps.journal.emit("gate.error", `send DENIED by policy: ${envelope.policy.reasons.join("; ")}`, {
      to: request.to,
      selector: selectorOf(request),
    });
    return { status: "denied", envelope, reasons: envelope.policy.reasons };
  }
  if (!sim.ok && !opts.allowSimFailure) {
    deps.journal.emit("gate.error", "send blocked: DRYRUN reverted (override requires explicit ack)", {
      to: request.to,
      error: sim.error,
    });
    return { status: "sim-failed", envelope };
  }

  const needApproval = approvalRequired(deps, envelope) && !opts.approvalAlreadyGranted;
  // the honest ledger line for the breadth auto-ack: a card WOULD have shown
  // (unknown-contract/deploy + mode C + the toggle) and the toggle skipped it
  if (
    !needApproval &&
    deps.signerMode === "C" &&
    (envelope.cls.risk === "unknown-contract" || envelope.cls.risk === "deploy") &&
    deps.modeCBreadth === true &&
    !opts.approvalAlreadyGranted &&
    deps.approval !== undefined
  ) {
    deps.journal.emit("gate.approval", `mode-C breadth: ${envelope.cls.risk} auto-acked (caps already bound)`, {
      to: request.to,
      selector: selectorOf(request),
    });
  }
  if (needApproval) {
    if (deps.approval) {
      deps.journal.emit("gate.approval", `approval required (mode ${deps.signerMode}, risk ${envelope.cls.risk})`, {
        to: request.to,
        selector: selectorOf(request),
      });
      const ok = await deps.approval(envelope);
      if (!ok) {
        deps.journal.emit("gate.approval", "approval REJECTED by user", { to: request.to });
        return { status: "aborted", envelope, reason: "rejected in approval card" };
      }
      deps.journal.emit("gate.approval", "approval GRANTED", { to: request.to });
    }
  }

  const value = request.value ?? 0n;
  const gas = sim.gas !== null ? sim.gas + sim.gas / 5n : undefined;
  const txHash = await deps.signer.sendTransaction(
    gas === undefined ? { to: request.to, data: request.data, value } : { to: request.to, data: request.data, value, gas }
  );
  deps.journal.emit(
    "gate.send",
    `sent ${txHash.slice(0, 12)}… → ${request.to ?? "NEW CONTRACT (creation)"} · ${selectorOf(request) ?? "(no selector — creation bytecode)"}`,
    {
      txHash,
      to: request.to,
      selector: selectorOf(request),
      value: value.toString(),
      mode: deps.signerMode,
    }
  );

  let receipt: ReceiptLike | null = null;
  let receiptError: string | null = null;
  try {
    receipt = await deps.client.waitForReceipt(txHash, deps.receiptTimeoutMs ?? 60_000);
    deps.journal.emit(
      "gate.receipt",
      `receipt ${receipt.status} · gas ${receipt.gasUsed.toString()}${receipt.blockNumber !== null ? ` · block ${receipt.blockNumber.toString()}` : ""}`,
      { txHash, status: receipt.status, gasUsed: receipt.gasUsed.toString() }
    );
  } catch (e) {
    receiptError = e instanceof Error ? e.message : String(e);
    deps.journal.emit("gate.receipt", `receipt wait failed: ${receiptError}`, { txHash });
  }

  const movements = receipt ? extractMovements(receipt) : [];
  const { counters, breaches } = recordSpend(deps.counters, value, movements, request.account, deps.policy);
  deps.onCounters?.(counters);
  if (breaches.length > 0) {
    for (const b of breaches) deps.journal.emit("gate.token-cap", `TOKEN CAP: ${b}`, { txHash });
  }
  return { status: "sent", envelope, txHash, receipt, receiptError, movements, capBreaches: breaches };
}
