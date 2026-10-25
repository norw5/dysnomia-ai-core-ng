import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EXPLORER_BASE } from "@config/addresses";
import { makeClient } from "@/chain/client";
import { useGate } from "@/chain/GateContext";
import {
  DEFAULT_FORK_PLAYER_PLS,
  SIM_DEPLOY_STEPS,
  anvilCommand,
  createForkPlayer,
  fundForkPlayer,
  makeImpersonatedSigner,
  preflightSimBootstrap,
  readForkBalance,
  runSimBootstrap,
  validatePlayerAmount,
  type PreflightResult,
  type SimBootstrapResult,
  type StepOutcome,
} from "@/chain/simBootstrap";
import { isLocalForkRpc } from "@/chain/rpc";
import { simEntryEnabled } from "@/chain/simMode";
import { clearSimOverlay, simLayerAddresses, useSimOverlay, type SimLayerName } from "@/state/simOverlay";
import { useWallet } from "@/wallet/WalletContext";
import { copyText } from "@/ui/clipboard";
import type { ChainState } from "@/chain/useChainState";
import type { Address } from "viem";

/**
 * SETTINGS → SIM BOOTSTRAP (session-81, Option A).
 *
 * LOCAL FORK ONLY. The deployer is the anvil-impersonated LIVE system
 * deployer EOA (the constructors' owner gates need it), never the player
 * wallet. Four creations ride THE gate. The runtime overlay records the
 * actual receipt addresses; the player funding is a separate, explicit
 * choice (2,000,000 PLS default, editable).
 */

const LAYER_ORDER: SimLayerName[] = ["WORLD", "VITUS", "WAR", "H2O", "GWAT", "ENCRYPT"];

export function SimBootstrapPanel({ chain }: { chain: ChainState }) {
  if (!simEntryEnabled || !isLocalForkRpc(chain.url)) return null;
  return <SimBootstrapPanelInner chain={chain} />;
}

function SimBootstrapPanelInner({ chain }: { chain: ChainState }) {
  const gate = useGate();
  const wallet = useWallet();
  const overlay = useSimOverlay(chain.url);
  const client = useMemo(() => makeClient(chain.url), [chain.url]);

  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [steps, setSteps] = useState<StepOutcome[]>([]);
  const [result, setResult] = useState<SimBootstrapResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [armedReset, setArmedReset] = useState(false);

  const [amount, setAmount] = useState(DEFAULT_FORK_PLAYER_PLS);
  const [playerMode, setPlayerMode] = useState<"connected" | "fork">("connected");
  const [funding, setFunding] = useState(false);
  const [fundNote, setFundNote] = useState<string | null>(null);
  const [playerAddress, setPlayerAddress] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const p = await preflightSimBootstrap({ rpcUrl: chain.url, client });
      if (!mounted.current) return;
      setPreflight(p);
    } catch (e) {
      if (!mounted.current) return;
      setPreflight(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, [chain.url, client, overlay]);

  useEffect(() => {
    void check();
    // deliberately once per RPC — the check button is the refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain.url]);

  const deploy = async () => {
    if (!preflight || !preflight.ok || deploying) return;
    setDeploying(true);
    setError(null);
    setResult(null);
    setSteps(SIM_DEPLOY_STEPS.map((s) => ({ name: s.name, state: "pending", address: null, txHash: null, detail: "waiting" })));
    try {
      const signer = makeImpersonatedSigner(chain.url, wallet.mode);
      const res = await runSimBootstrap({
        rpcUrl: chain.url,
        chainId: preflight.chainId ?? 369,
        preflight,
        client,
        signer,
        send: (request, sign) => gate.sendWithSigner(request, sign),
        onStep: (index, state, detail) => {
          if (index < 0 || !mounted.current) return;
          setSteps((prev) =>
            prev.map((s, i) =>
              i === index
                ? {
                    ...s,
                    state,
                    detail,
                    address: state === "sent" ? (s.address ?? null) : s.address,
                  }
                : s
            )
          );
        },
      });
      if (!mounted.current) return;
      setResult(res);
      setSteps(res.steps);
      if (!res.ok) setError(res.error ?? "bootstrap failed");
      else setError(null);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setDeploying(false);
    }
  };

  const copy = async (value: string) => {
    const ok = await copyText(value);
    if (!ok) return;
    setCopied(value);
    window.setTimeout(() => setCopied(null), 1200);
  };

  const amountCheck = validatePlayerAmount(amount);
  const canFund =
    preflight?.ok === true &&
    amountCheck.ok &&
    !funding &&
    (playerMode === "fork" || wallet.account !== null);
  const fund = async () => {
    if (!amountCheck.ok || funding) return;
    setFunding(true);
    setFundNote(null);
    setError(null);
    try {
      if (playerMode === "connected") {
        if (wallet.account === null) throw new Error("no connected account — connect or unlock a wallet first");
        const r = await fundForkPlayer(chain.url, wallet.account, amount);
        setPlayerAddress(wallet.account);
        setFundNote(`funded ${wallet.account} with ${amount.trim()} PLS (anvil state — no transfer, worthless off the fork). balance now ${formatPln(r.balance)} PLS.`);
      } else {
        const p = createForkPlayer();
        const r = await fundForkPlayer(chain.url, p.address, amount);
        await wallet.importKey(p.privateKey, null);
        setPlayerAddress(p.address);
        setFundNote(
          `created fork-only player ${p.address} with ${amount.trim()} PLS and imported it into wallet mode B (memory only). It is worthless off the fork; lock/reload drops the key. balance now ${formatPln(r.balance)} PLS.`
        );
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setFunding(false);
    }
  };

  const refreshPlayerBalance = async () => {
    if (playerAddress === null) return;
    try {
      const b = await readForkBalance(chain.url, playerAddress as Address);
      setFundNote(`balance ${formatPln(b)} PLS (anvil state) on ${playerAddress}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const reset = () => {
    if (!armedReset) {
      setArmedReset(true);
      window.setTimeout(() => setArmedReset(false), 4000);
      return;
    }
    setArmedReset(false);
    clearSimOverlay(chain.url);
    setResult(null);
    setSteps([]);
    setPlayerAddress(null);
    setFundNote(null);
    setError(null);
    void check();
  };

  const addresses = overlay?.layer ?? simLayerAddresses(chain.url);

  return (
    <div className="panel" data-testid="sim-bootstrap">
      <h2>SIM layer bootstrap — LOCAL FORK ONLY</h2>
      <p className="hint">
        The never-deployed layer (WORLD, VITUS, WAR, H2O, GWAT, ENCRYPT) ships with this app as
        pinned creation bytecode. This panel deploys it on <strong>your local anvil fork</strong>{" "}
        as the anvil-impersonated LIVE system deployer — <strong>not your wallet</strong> (the
        constructors pass owner gates on the forked VOID/CHAN; a fresh wallet cannot). The deployer
        gets gas-only fork balance (100,000 PLS; the pin's gas price is high) and is never imported
        as your player. No <code>anvil_*</code> call ever leaves loopback. The live perimeter is
        forked from PulseChain; only the six layer names are deployed here. The fork-only player
        wallet is separate.
      </p>

      <label className="hint" htmlFor="sim-command">
        start the fork (the browser cannot spawn anvil):
      </label>
      <pre className="recipe-code" data-testid="sim-bootstrap-command">
        <code id="sim-command">{anvilCommand()}</code>
      </pre>

      <div className="studio-actions">
        <button className="btn" onClick={() => void check()} disabled={checking} data-testid="sim-bootstrap-check">
          {checking ? "checking…" : "check fork"}
        </button>
        {preflight !== null && (
          <span className="hint" data-testid="sim-bootstrap-status">
            {preflight.ok ? "READY" : "REFUSED"} · {preflight.host} · chain {preflight.chainId ?? "?"}
            {preflight.forkBlock !== null ? ` · fork ${preflight.forkBlock.toLocaleString()}` : ""}
          </span>
        )}
      </div>

      {preflight !== null && (
        <ul className="sim-checks" data-testid="sim-bootstrap-checks">
          {preflight.checks.map((c) => (
            <li key={c.id} className={c.ok ? "ok" : "err-text"}>
              <span className="mono">{c.ok ? "✓" : "✗"}</span> {c.label} — <span className="hint">{c.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {preflight !== null && !preflight.ok && (
        <p className="err-text" data-testid="sim-bootstrap-refusal">
          {preflight.reasons.join(" · ") || "preflight failed"} — fix the fork or use the exact command above, then check again.
        </p>
      )}

      {preflight?.staleOverlay && (
        <p className="err-text" data-testid="sim-bootstrap-stale">
          STALE runtime overlay — the recorded addresses have no code on this fork (reset or re-pinned?). Deploy again.
        </p>
      )}

      <div className="studio-actions">
        <button
          className="btn btn-primary"
          onClick={() => void deploy()}
          disabled={deploying || preflight === null || !preflight.ok}
          data-testid="sim-bootstrap-deploy"
        >
          {deploying
            ? "deploying…"
            : overlay !== null
              ? "redeploy 4 creations"
              : preflight?.staleOverlay
                ? "deploy 4 creations (redeploy)"
                : "deploy 4 creations"}
        </button>
        <span className="hint">
          modes A/B show a gate card per creation; mode C + breadth auto-acks. Every creation is
          DRYRUN-first through THE gate.
        </span>
      </div>

      {steps.length > 0 && (
        <ol className="sim-steps">
          {steps.map((s) => (
            <li key={s.name} data-testid={`sim-bootstrap-step-${s.name.toLowerCase()}`} className={s.state === "failed" ? "err-text" : ""}>
              <span className="mono">{s.name}</span> · {s.state}
              {s.address !== null && <span className="mono"> · {s.address}</span>}
              <span className="hint"> — {s.detail}</span>
            </li>
          ))}
        </ol>
      )}

      {error !== null && (
        <p className="err-text" data-testid="sim-bootstrap-error">
          {error}
        </p>
      )}

      {overlay !== null && (
        <div className="sim-overlay-block" data-testid="sim-bootstrap-overlay">
          <h3>
            runtime overlay <span className="chip chip-sim">fork · {overlay.forkBlock !== null ? `block ${overlay.forkBlock.toLocaleString()}` : "block ?"}</span>
          </h3>
          <p className="hint">
            deployed by the impersonated live deployer <span className="mono">{overlay.deployedBy}</span> at{" "}
            {new Date(overlay.deployedAt).toISOString()}. These are the ACTUAL receipt addresses — the
            runtime overlay is the truth; the app's SIM surfaces read them. Fork-only: they do not
            exist on the live chain (the explorer will not find them).
          </p>
          <table className="perimeter">
            <tbody>
              {LAYER_ORDER.map((name) => {
                const a = addresses[name];
                return (
                  <tr key={name}>
                    <td className="name">{name}</td>
                    <td className="addr">
                      <button className="linkish" onClick={() => void copy(a)} title="copy" data-testid={`sim-bootstrap-address-${name.toLowerCase()}`}>
                        {copied === a ? "copied" : a}
                      </button>
                    </td>
                    <td>
                      <a href={`${EXPLORER_BASE}${a}`} target="_blank" rel="noreferrer noopener" className="outlink" title="fork-only address — the live explorer will not find it">
                        ↗
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {result?.verification && (
            <details>
              <summary className="hint">wiring verification ({result.verification.checks.filter((c) => c.ok).length}/{result.verification.checks.length} checks)</summary>
              <ul className="sim-checks" data-testid="sim-bootstrap-wiring">
                {result.verification.checks.map((c) => (
                  <li key={c.id} className={c.ok ? "ok" : "err-text"}>
                    <span className="mono">{c.ok ? "✓" : "✗"}</span> {c.label} — <span className="hint">expected {c.expected}, got {c.actual}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {result?.verification && overlay === null && (
        <details open data-testid="sim-bootstrap-wiring-failed">
          <summary className="hint">wiring verification ({result.verification.checks.filter((c) => c.ok).length}/{result.verification.checks.length} checks)</summary>
          <ul className="sim-checks" data-testid="sim-bootstrap-wiring">
            {result.verification.checks.map((c) => (
              <li key={c.id} className={c.ok ? "ok" : "err-text"}>
                <span className="mono">{c.ok ? "✓" : "✗"}</span> {c.label} — <span className="hint">expected {c.expected}, got {c.actual}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <h3>fork-only player — separate from the deployer</h3>
      <p className="hint">
        Default {Number(DEFAULT_FORK_PLAYER_PLS).toLocaleString()} PLS, editable. This is anvil
        state, not a transfer: nothing leaves the fork. Funding the connected wallet does not
        change its off-fork balance. Onboarding (LAU → Username → YUE → Play) stays your explicit
        flow — the bootstrap never runs it silently.
      </p>
      <div className="studio-actions">
        <label className="hint">
          <input
            type="radio"
            name="sim-player-mode"
            checked={playerMode === "connected"}
            onChange={() => setPlayerMode("connected")}
            data-testid="sim-bootstrap-fund-mode-connected"
          />{" "}
          fund the connected wallet
        </label>
        <label className="hint">
          <input
            type="radio"
            name="sim-player-mode"
            checked={playerMode === "fork"}
            onChange={() => setPlayerMode("fork")}
            data-testid="sim-bootstrap-fund-mode-fork"
          />{" "}
          create a fork-only player (new key → mode B)
        </label>
      </div>
      <div className="rpc-form">
        <label htmlFor="sim-player-amount">player funding (whole PLS)</label>
        <input
          id="sim-player-amount"
          className="mono"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          data-testid="sim-bootstrap-player-amount"
          inputMode="numeric"
        />
        <button className="btn" onClick={() => void fund()} disabled={!canFund} data-testid="sim-bootstrap-fund">
          {funding ? "funding…" : "fund"}
        </button>
        <button className="btn" onClick={() => void refreshPlayerBalance()} disabled={playerAddress === null}>
          refresh balance
        </button>
      </div>
      {!amountCheck.ok && <p className="err-text">{amountCheck.error}</p>}
      {playerAddress !== null && (
        <p className="hint" data-testid="sim-bootstrap-player-address">
          player: <span className="mono">{playerAddress}</span>
        </p>
      )}
      {fundNote !== null && (
        <p className="hint" data-testid="sim-bootstrap-fund-result">
          {fundNote}
        </p>
      )}

      <div className="studio-actions">
        <button className={`btn${armedReset ? " btn-primary" : ""}`} onClick={reset} data-testid="sim-bootstrap-reset">
          {armedReset ? "click again to reset the overlay" : "reset runtime overlay"}
        </button>
        <span className="hint">reset clears the runtime overlay only — the fork-only player key is a separate choice.</span>
      </div>
    </div>
  );
}

function formatPln(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac.length > 0 ? `${whole.toLocaleString()}.${frac}` : whole.toLocaleString();
}
