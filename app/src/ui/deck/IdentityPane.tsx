import { useEffect, useMemo, useRef, useState } from "react";
import { makeClient } from "@/chain/client";
import { readPlayerBirth, type PlayerBirth, type PlayerSnapshot } from "@/chain/identity";
import { usePendingLau } from "@/state/pendingLau";
import { useHomeVenueResolved } from "@/state/homeVenue";
import { useDssDeploy } from "@/ui/useDssDeploy";
import { ApprovalCard } from "@/ui/ApprovalCard";
import { sigilFromSeed, sigilCellAt } from "@/ui/deck/sigil";
import { copyText } from "@/ui/clipboard";
import type { WalletApi } from "@/wallet/WalletContext";

/**
 * The DECK's identity column (session-57; the session-63 SLOT REDESIGN
 * restyle): deck CHROME, never widget slots. Styling studies the OLD
 * SITE's identity column (dysnomia-ai-core/components/Dashboard.tsx —
 * IDEAS only, never code): the big centered bordered soul sigil, the
 * centered username/symbol, copy rows, the SAAT block, and a live
 * metrics footer with the pulsing ●. The yuan ledger MOVED OUT (too
 * narrow — it is the col2-top yuan_ledger widget now, which also carries
 * the POWER-TOKEN CONSTELLATION rows since session-64.1 — the owner's
 * call: the ledger is the money bay; the column keeps soul data).
 */

function Sigil({ seed, size }: { seed: string; size: number }) {
  const spec = useMemo(() => sigilFromSeed(seed), [seed]);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 5 5"
      shapeRendering="crispEdges"
      className="passport-sigil"
      data-testid="passport-sigil"
      role="img"
      aria-label="soul sigil"
    >
      <rect x="0" y="0" width="5" height="5" fill="#050505" />
      {Array.from({ length: 5 }).map((_, y) =>
        Array.from({ length: 5 }).map((_, x) => {
          const c = sigilCellAt(spec, x, y);
          return c.lit ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={c.color} /> : null;
        }),
      )}
    </svg>
  );
}

function CopyRow({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    if (value === null) return;
    void copyText(value).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <div className="passport-row">
      <span className="passport-row-label">{label}</span>
      <button
        className="passport-copy"
        onClick={onCopy}
        disabled={value === null}
        title={value ?? "—"}
        data-testid={`passport-copy-${label.toLowerCase().replace(/[^a-z]+/g, "")}`}
      >
        <span className="mono">{value !== null ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—"}</span>
        <span className="passport-copy-mark">{copied ? "✓" : "❐"}</span>
      </button>
    </div>
  );
}

export function IdentityPane({
  rpcUrl,
  snapshot,
  snapshotError,
  wallet,
  onGoSettings,
}: {
  rpcUrl: string;
  snapshot: PlayerSnapshot | null;
  /** the §7.6 loader's error — a dead RPC must read as UNREADABLE, not pending */
  snapshotError: string | null;
  wallet: WalletApi;
  onGoSettings: () => void;
}) {
  const [birth, setBirth] = useState<PlayerBirth | null>(null);
  const [birthError, setBirthError] = useState<string | null>(null);
  const lastIdentityRef = useRef<string>("");
  const pending = usePendingLau(wallet.account);

  const lau = snapshot?.lau ?? null;
  // session-73: the census resolves pre-app accounts' home QING too
  const home = useHomeVenueResolved(wallet.account, lau ?? pending?.lau ?? null);
  // session-64: the birth read rides the PENDING LAU too when discovery has
  // not landed — the record is written at LAU birth, registration or not
  const lauForReads = lau ?? pending?.lau ?? null;
  // session-66: the DSS deploy affordance (the fixed bundler binds this LAU)
  const deployFlow = useDssDeploy(rpcUrl, lauForReads);
  // the SAAT read rides the snapshot's fetch cadence (fetchedAt) — one
  // anonymous batch + the simulated Aura read, refreshed with the pane
  useEffect(() => {
    if (wallet.account === null || lauForReads === null) {
      setBirth(null);
      setBirthError(null);
      return;
    }
    let alive = true;
    // session-64.1 (the flicker find): the SAAT block only clears when the
    // IDENTITY changes — the 12s tick + the per-receipt refreshes re-read
    // silently (stale-while-revalidate), so the block no longer blinks
    const identity = `${wallet.account.toLowerCase()}:${lauForReads.toLowerCase()}`;
    const identityChanged = lastIdentityRef.current !== identity;
    lastIdentityRef.current = identity;
    if (identityChanged) {
      setBirth(null);
      setBirthError(null);
    }
    const client = makeClient(rpcUrl);
    readPlayerBirth(client, wallet.account, lauForReads)
      .then((b) => {
        if (alive) {
          setBirth(b);
          setBirthError(null);
        }
      })
      .catch((e: unknown) => {
        // a failed refresh keeps the last good record + the error line
        if (alive && identityChanged) setBirth(null);
        if (alive) setBirthError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [rpcUrl, wallet.account, lauForReads, snapshot?.fetchedAt]);

  if (wallet.account === null) {
    return (
      <aside className="deck-passport" data-testid="deck-passport">
        <p className="passport-head">SOVEREIGN_PASSPORT</p>
        <div className="passport-nooperator" data-testid="passport-nooperator">
          <p>
            <span className="err-text">NO OPERATOR</span> — the deck drives an account: connect a wallet to
            raise the identity pane.
          </p>
          <div className="studio-actions">
            <button className="btn" onClick={onGoSettings} data-testid="passport-connect">
              SETTINGS → wallet
            </button>
          </div>
        </div>
      </aside>
    );
  }

  const sigilSeed = birth !== null ? `soul:${birth.saat.soul.toString()}` : `addr:${wallet.account.toLowerCase()}`;
  return (
    <aside className="deck-passport" data-testid="deck-passport">
      <p className="passport-head">SOVEREIGN_PASSPORT</p>

      {/* the old site's centered identity block: big bordered sigil, the
          name + symbol beneath — ideas only, never code */}
      <div className="passport-id" data-testid="passport-id-block">
        <Sigil seed={sigilSeed} size={96} />
        <div className="passport-id-text">
          <p className="passport-username" data-testid="passport-username">
            {snapshot?.username ?? snapshot?.lauName ?? "[ UNNAMED ]"}
          </p>
          <p className="hint mono">{snapshot?.lauSymbol ?? "no LAU"}</p>
          <p className="hint mono passport-soul-id" data-testid="passport-soul-id">
            {birth !== null ? `SOUL ${birth.saat.soul.toString()}` : lauForReads === null ? "soul written at birth" : "…"}
          </p>
        </div>
      </div>

      <div className="passport-rows">
        <CopyRow label="WALLET" value={wallet.account} />
        <CopyRow label="LAU" value={snapshot?.lau ?? pending?.lau ?? null} />
        <CopyRow label="YUE" value={snapshot?.yue ?? null} />
      </div>

      {/* session-66: the status block — home QING + the DSS bundler
          (deployment/status widget in the identity column, the owner's
          layout call). capture-at-create/deploy law: deployed-elsewhere
          reads as not deployed. */}
      <div className="passport-status" data-testid="passport-status">
        <p className="passport-row-label">STATUS</p>
        <dl className="kv">
          <dt>home QING</dt>
          <dd
            className="mono"
            data-testid="passport-home-qing"
            title={home.source === "census" ? "resolved from the venue census — your LAU already owns its one QING (created before this app carried it)" : undefined}
          >
            {home.venue !== null
              ? `${home.venue.slice(0, 6)}…${home.venue.slice(-4)}${home.source === "census" ? " · census" : ""}`
              : "not claimed"}
          </dd>
          <dt>self-snipe DSS</dt>
          <dd className="mono" data-testid="passport-dss">
            {deployFlow.dss !== null
              ? `${deployFlow.dss.dss.slice(0, 6)}…${deployFlow.dss.dss.slice(-4)}`
              : lauForReads !== null
                ? "deployable"
                : "needs a LAU"}
          </dd>
        </dl>
        {lauForReads !== null && deployFlow.dss === null && (
          <>
            <p className="hint">
              the fixed self-snipe bundler — chat + collect-your-own-emission atomically
              (IDENTITY → the emission desk; predicted {deployFlow.predicted ?? "…"}).
            </p>
            <button
              className="btn passport-deploy-btn"
              disabled={deployFlow.action.busy}
              onClick={() => void deployFlow.deploy()}
              data-testid="passport-dss-deploy"
            >
              DEPLOY DSS
            </button>
          </>
        )}
        {deployFlow.action.error && <p className="err-text">{deployFlow.action.error}</p>}
        {deployFlow.action.outcome && deployFlow.action.outcome.status === "sent" && (
          <p className="ok-text" data-testid="passport-dss-sent">
            deploy sent — the address is captured from the receipt.
          </p>
        )}
        {deployFlow.action.envelope !== null && (
          <ApprovalCard
            envelope={deployFlow.action.envelope}
            mode={wallet.mode}
            busy={deployFlow.action.busy}
            onResolve={(accept, allowSimFailure) => {
              if (!accept) {
                deployFlow.action.reject();
                return;
              }
              void deployFlow.action.confirm(allowSimFailure);
            }}
          />
        )}
      </div>
      {pending !== null && lau === null && (
        <p className="hint" data-testid="passport-lau-pending">
          LAU pending registration — created, but the wallet→LAU mapping the app discovers you by is written only by
          register (CHOA.Play). finish the chain on IDENTITY (or ask the agent).
        </p>
      )}

      {snapshot === null && snapshotError !== null && (
        <p className="err-text" data-testid="passport-error">
          identity reads unavailable: {snapshotError.slice(0, 120)}
        </p>
      )}
      {snapshot === null && snapshotError === null && (
        <p className="hint" data-testid="passport-pending">
          reading identity (one anonymous batch)…
        </p>
      )}

      <div className="passport-saat" data-testid="passport-saat">
        <p className="passport-row-label">SAAT</p>
        {birth !== null ? (
          <dl className="kv">
            <dt>pole</dt>
            <dd className="mono">{birth.saat.pole.toString()}</dd>
            <dt>soul</dt>
            <dd className="mono">{birth.saat.soul.toString()}</dd>
            <dt>aura (birth)</dt>
            <dd className="mono">{birth.saat.aura.toString()}</dd>
            {birth.auraNow !== null && (
              <>
                <dt>aura (now)</dt>
                <dd className="mono">{birth.auraNow.toString()}</dd>
              </>
            )}
          </dl>
        ) : lauForReads === null ? (
          <p className="hint">no LAU yet — the SAAT triple is written at birth (SIU.Miu).</p>
        ) : birthError !== null ? (
          <p className="err-text">birth read unavailable: {birthError.slice(0, 120)}</p>
        ) : (
          <p className="hint">reading birth record…</p>
        )}
      </div>

      <p className="hint passport-foot">
        <span className="passport-live-dot" aria-hidden="true">
          ●
        </span>{" "}
        session-scoped chrome — follows the connected account, never persists.
      </p>
    </aside>
  );
}
