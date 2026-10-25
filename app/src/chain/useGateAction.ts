import { useCallback, useState } from "react";
import { useGate } from "@/chain/GateContext";
import { useWallet } from "@/wallet/WalletContext";
import type { GateEnvelope, GateOutcome, GateRequest } from "@/chain/txGate";

/**
 * The panel-side send flow against the ONE gate (IA-PLAN §7.2): DRYRUN →
 * approval card (skipped in yolo C, which stays policy-bounded) → send →
 * outcome. Views never touch a signer; this is the same discipline STUDIO
 * follows, extracted so every contextual panel renders the identical
 * envelope + card.
 */
export interface GateActionState {
  busy: boolean;
  error: string | null;
  /** set while the approval card must be shown; null = no card */
  envelope: GateEnvelope | null;
  outcome: GateOutcome | null;
  /** DRYRUN-only probe (no card, no send) */
  probe: (request: GateRequest) => Promise<GateEnvelope | null>;
  /** begin the send flow (yolo C goes straight through, policy-bounded) */
  begin: (request: GateRequest) => Promise<void>;
  /** card accepted → send (approvalAlreadyGranted; optional sim-failure override) */
  confirm: (allowSimFailure: boolean) => Promise<void>;
  /** card rejected / dismiss */
  reject: () => void;
  clearOutcome: () => void;
}

export function useGateAction(): GateActionState {
  const gate = useGate();
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [envelope, setEnvelope] = useState<GateEnvelope | null>(null);
  const [outcome, setOutcome] = useState<GateOutcome | null>(null);
  const [pending, setPending] = useState<GateRequest | null>(null);

  const probe = useCallback(
    async (request: GateRequest): Promise<GateEnvelope | null> => {
      setError(null);
      try {
        return await gate.dryRun(request);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      }
    },
    [gate]
  );

  const sendWith = useCallback(
    async (request: GateRequest, allowSimFailure: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const out = await gate.send(request, { approvalAlreadyGranted: true, allowSimFailure });
        if (out.status === "no-signer") {
          setError("no account active — SETTINGS → wallet to connect (A) or load a key (B)");
          return;
        }
        setOutcome(out);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [gate]
  );

  const begin = useCallback(
    async (request: GateRequest) => {
      setError(null);
      setOutcome(null);
      setPending(null);
      setBusy(true);
      try {
        const env = await gate.dryRun(request);
        if (wallet.yolo) {
          // mode C: no per-action card — policy bounds only; a failed DRYRUN still blocks
          setBusy(false);
          await sendWith(request, false);
          return;
        }
        setPending(request);
        setEnvelope(env);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [gate, wallet.yolo, sendWith]
  );

  const confirm = useCallback(
    async (allowSimFailure: boolean) => {
      const request = pending;
      setEnvelope(null);
      if (!request) return;
      await sendWith(request, allowSimFailure);
    },
    [pending, sendWith]
  );

  const reject = useCallback(() => {
    setEnvelope(null);
    setPending(null);
  }, []);

  const clearOutcome = useCallback(() => setOutcome(null), []);

  return { busy, error, envelope, outcome, probe, begin, confirm, reject, clearOutcome };
}
