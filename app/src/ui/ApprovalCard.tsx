import { useState } from "react";
import { createPortal } from "react-dom";
import { EXPLORER_BASE } from "@config/addresses";
import type { GateEnvelope } from "@/chain/txGate";

/**
 * The transaction envelope card (IA-PLAN §7.2 step 3): the same envelope for
 * manual and agent sends — policy verdict, DRYRUN result with the honest
 * preview wording (kb §5), risk class, and the override-with-warning checkbox
 * when the DRYRUN reverted.
 *
 * Session-71.2: the modal PORTALS to document.body — cards mounted inside
 * nested deck/panel chrome must never be trapped by an ancestor stacking
 * context (the owner's "popup behind the widgets" find on the deck's DSS
 * deploy); a body-level portal is top-level by construction.
 */
export function ApprovalCard({
  envelope,
  mode,
  busy,
  onResolve,
}: {
  envelope: GateEnvelope;
  mode: string;
  busy?: boolean;
  /** accept(override) / reject */
  onResolve: (accept: boolean, allowSimFailure: boolean) => void;
}) {
  const [override, setOverride] = useState(false);
  const { request, cls, policy, sim } = envelope;
  const isDeploy = request.to === null;
  const toName = cls.contract ?? (isDeploy ? "contract DEPLOYMENT" : "unknown contract");
  const simFailed = sim !== null && !sim.ok;

  const card = (
    <div className="modal-backdrop" data-testid="approval-card">
      <div className="modal panel" role="dialog" aria-label="transaction approval">
        <h2>SEND APPROVAL · mode {mode}</h2>
        <dl className="kv">
          <dt>to</dt>
          <dd>
            {isDeploy ? (
              <>
                NEW CONTRACT — creation tx (<span className="mono">{Math.ceil((request.data.length - 2) / 2)} bytes of bytecode</span>,
                no destination)
              </>
            ) : (
              <>
                {toName}{" "}
                <a className="outlink" href={`${EXPLORER_BASE}${request.to}`} target="_blank" rel="noreferrer noopener">
                  ↗
                </a>
                <div className="addr-full">{request.to}</div>
              </>
            )}
          </dd>
          <dt>selector</dt>
          <dd>
            {isDeploy ? (
              <>— (creation bytecode; the address is derived from your nonce at inclusion)</>
            ) : (
              <>
                {request.data.slice(0, 10)} {cls.functionSig ? `· ${cls.functionSig}` : "· (not in our facts)"}
              </>
            )}
          </dd>
          <dt>value</dt>
          <dd>{(request.value ?? 0n).toString()} wei</dd>
          <dt>risk</dt>
          <dd>
            <span className={`risk risk-${cls.risk}`}>{cls.risk}</span>
            {cls.gate !== null && <> · gate: {cls.gate}</>}
            {cls.metered && " · metered (lifetime-cap budget)"}
          </dd>
          <dt>policy</dt>
          <dd className={policy.allowed ? "ok-text" : "err-text"}>
            {policy.allowed ? "PASS" : "DENIED"}
            {policy.reasons.length > 0 && (
              <ul className="policy-reasons">
                {policy.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </dd>
          <dt>dryrun</dt>
          <dd>
            {sim === null ? (
              "not run"
            ) : sim.ok ? (
              <>
                ok{sim.gas !== null && <> · gas ~{sim.gas.toString()}</>}
                <div className="hint">
                  previews are pure (eth_call advances nothing); committed results can differ —
                  the shared Entropy head moves with every included call.
                </div>
              </>
            ) : (
              <>
                <span className="err-text">REVERTED</span>
                {sim.error?.decoded && <div className="err-text">decoded: {sim.error.decoded}</div>}
                {!sim.error?.decoded && sim.error?.message && <div className="hint">{sim.error.message}</div>}
              </>
            )}
          </dd>
        </dl>

        {simFailed && (
          <label className="override">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
              data-testid="override-sim-failure"
            />
            <span>
              send despite the failed DRYRUN — this transaction is expected to revert unless the
              chain state that caused the failure changes before inclusion
            </span>
          </label>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={() => onResolve(false, false)} disabled={busy} data-testid="approval-reject">
            REJECT
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onResolve(true, override)}
            disabled={busy || (simFailed && !override) || !policy.allowed}
            data-testid="approval-confirm"
          >
            CONFIRM SEND
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return card;
  return createPortal(card, document.body);
}
