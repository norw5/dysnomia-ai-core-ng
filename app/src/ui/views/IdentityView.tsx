import { useEffect, useMemo, useState } from "react";
import { encodeFunctionData, formatUnits, getContractAddress, type Abi, type Address } from "viem";
import { EXPLORER_BASE, addr } from "@config/addresses";
import { loadAbi } from "@/chain/abiLoad";
import { simLayerActive } from "@/chain/simMode";
import { loadSimLedger } from "@/chain/worldLayer";
import {
  decodeDecryptPlain,
  decodeEncryptIndex,
  encodeDecryptString,
  encodeEncryptString,
  encodePrune,
  readSoulId,
} from "@/chain/encryptDesk";
import {
  agentPayloadSize,
  fmtAmt,
  isUserNotEnteredError,
  onboardingSteps,
  readPlayerBirth,
  readPlayerMoment,
  toAgentPayload,
  usernameError,
  type PlayerBirth,
  type PlayerSnapshot,
} from "@/chain/identity";
import { usePendingLau } from "@/state/pendingLau";
import { useHomeVenueResolved } from "@/state/homeVenue";
import { useGateAction } from "@/chain/useGateAction";
import { DssDeskPanel } from "@/ui/DssDeskPanel";
import { parseAmount } from "@/ui/views/MarketView";
import type { ChainState } from "@/chain/useChainState";
import { useWallet } from "@/wallet/WalletContext";
import { ApprovalCard } from "@/ui/ApprovalCard";
import { LearnHint } from "@/ui/LearnHint";
import { makeClient } from "@/chain/client";

/**
 * IDENTITY (IA-PLAN §10 item 3 — first contextual panels): LAU create /
 * Username editor / rename, YUE create / rename via SEI.Start, the guided
 * onboarding chain, and the per-turn player-state snapshot (§7.6 identity
 * subset). Every send is a plain caller of the ONE gate — same envelope,
 * same approval card as STUDIO.
 */

function pickFn(abi: Abi, name: string, inputCount: number) {
  const hits = abi.filter(
    (e) => e.type === "function" && e.name === name && e.inputs.length === inputCount
  );
  if (hits.length === 0) throw new Error(`ABI fragment not found: ${name}/${inputCount}`);
  return hits[0]!;
}

export function IdentityView({
  chain,
  snapshot,
  loading,
  snapshotError,
  refresh,
}: {
  chain: ChainState;
  snapshot: PlayerSnapshot | null;
  loading: boolean;
  snapshotError: string | null;
  refresh: () => void;
}) {
  const wallet = useWallet();
  const account = wallet.account;
  const pending = usePendingLau(account);
  const home = useHomeVenueResolved(account, (snapshot?.lau ?? pending?.lau ?? null) as Address | null);

  return (
    <section className="view identity view-center" data-testid="view-identity">
      <h1>//identity — LAU · YUE · your account in the world</h1>

      <SnapshotPanel
        account={account}
        snapshot={snapshot}
        loading={loading}
        error={snapshotError}
        onRefresh={refresh}
      />

      <SimLedgerPanel chainUrl={chain.url} yue={(snapshot?.yue as `0x${string}` | null) ?? null} />

      <CipherPanel chainUrl={chain.url} account={account} snapshot={snapshot} />

      <div className="panel" data-testid="onboarding">
        <h2>the guided chain — where you are</h2>
        <ol className="step-chain">
          {onboardingSteps(account, snapshot, pending?.lau ?? null, home.venue !== null).map((s) => (
            <li key={s.id} className={`${s.done ? "step done" : "step todo"}${s.optional ? " step-optional" : ""}`} data-testid={`step-${s.id}`}>
              <span className="step-dot" aria-hidden>
                {s.done ? "●" : "○"}
              </span>
              <span className="step-body">
                <span className="step-label">{s.label}</span>
                <span className="hint">{s.hint}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <MomentPanel chainUrl={chain.url} account={account} snapshot={snapshot} />

      <BirthPanel chainUrl={chain.url} account={account} snapshot={snapshot} snapshotError={snapshotError} />

      <RegisterPanel account={account} snapshot={snapshot} pendingLau={pending?.lau ?? null} onSent={refresh} />
      <LauPanel chainUrl={chain.url} account={account} snapshot={snapshot} pendingLau={pending?.lau ?? null} onSent={refresh} />
      <DssDeskPanel chainUrl={chain.url} account={account} snapshot={snapshot} pendingLau={pending?.lau ?? null} onSent={refresh} />
      <YuePanel account={account} snapshot={snapshot} pendingLau={pending?.lau ?? null} onSent={refresh} />
    </section>
  );
}

/**
 * The registrar (session-64 — the closed-cycle exit): CHOA.Play(LAU) writes
 * the wallet→LAU mapping the app's discovery reads (Cho().Enter via CHOA.Play)
 * + the first-time YueMintToOrigin. Play requires Username AND a YUE onchain
 * (AttributeNotFound 0x94c60c4a / 0x12efd467); the YUE leg is snapshot-
 * readable, the Username leg on a PENDING LAU is not — the DRYRUN reveals
 * it honestly. Already-registered wallets render the completed state.
 */
function RegisterPanel({
  account,
  snapshot,
  pendingLau,
  onSent,
}: {
  account: Address | null;
  snapshot: PlayerSnapshot | null;
  pendingLau: Address | null;
  onSent: () => void;
}) {
  const wallet = useWallet();
  const action = useGateAction();
  const [env, setEnv] = useState<import("@/chain/txGate").GateEnvelope | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (action.outcome?.status === "sent") onSent();
  }, [action.outcome, onSent]);

  const lau = snapshot?.lau ?? pendingLau;
  const yue = snapshot?.yue ?? null;

  const request = async () => {
    if (!account || !lau) return null;
    const choa = await loadAbi("CHOA.json");
    return {
      to: addr("CHOA") as `0x${string}`,
      data: encodeFunctionData({ abi: [pickFn(choa, "Play", 1)], functionName: "Play", args: [lau] }),
      account,
      abi: choa,
      meta: { source: "manual" as const, label: "IDENTITY register (CHOA.Play)" },
    };
  };

  const dryRun = async () => {
    if (!account || !lau) return;
    setBusy(true);
    setEnv(null);
    try {
      const req = await request();
      if (req === null) return;
      setEnv(await action.probe(req));
    } finally {
      setBusy(false);
    }
  };

  const begin = async () => {
    const req = await request();
    if (req === null) return;
    await action.begin(req);
  };

  return (
    <div className="panel" data-testid="register-panel">
      <h2>
        register — the world registrar <LearnHint file="accounts-and-chat.md" anchor="lau-the-account-token" />
      </h2>
      {!account && <p className="hint">connect an account to register.</p>}
      {account && snapshot?.lau != null && (
        <p className="ok-text" data-testid="register-done">
          registered — the wallet→LAU discovery resolves (CHO.GetUserTokenAddress → {snapshot.lau}).
        </p>
      )}
      {account && snapshot?.lau == null && (
        <>
          <p className="hint">
            CHOA.Play(LAU) — the LAST onboarding step: writes the wallet→LAU mapping the whole app discovers you by
            (Cho().Enter) and pays the first-Play YUE mint to origin. Play needs your Username set AND your YUE open —
            real onchain gates (the DRYRUN decodes the revert otherwise).
          </p>
          {lau === null ? (
            <p className="hint">create your LAU first — the registrar enters it into the world.</p>
          ) : (
            <>
              <dl className="kv">
                <dt>LAU to register</dt>
                <dd className="mono">
                  {lau}
                  {pendingLau !== null && pendingLau.toLowerCase() === lau.toLowerCase() && (
                    <span className="hint"> — pending registration (receipt-carried)</span>
                  )}
                </dd>
                <dt>YUE prerequisite</dt>
                <dd>{yue != null ? <span className="ok-text">open</span> : <span className="err-text">missing — open your YUE first</span>}</dd>
              </dl>
              <div className="studio-actions">
                <button className="btn" disabled={busy || action.busy || yue === null} onClick={() => void dryRun()} data-testid="register-dryrun">
                  DRYRUN
                </button>
                <button className="btn btn-primary" disabled={action.busy || yue === null} onClick={() => void begin()} data-testid="register-send">
                  SEND — register {wallet.mode === "A" ? "(wallet prompts)" : "(approval card)"}
                </button>
              </div>
            </>
          )}
          {env?.sim && (
            <div className="studio-result" data-testid="register-sim">
              <pre className="mono">
                {env.sim.ok
                  ? `DRYRUN ok${env.sim.gas !== null ? ` · gas ~${env.sim.gas.toString()}` : ""}`
                  : `DRYRUN revert${env.sim.error?.decoded ? `: ${env.sim.error.decoded}` : ""}
${env.sim.error?.message ?? ""}`}
              </pre>
            </div>
          )}
          {action.error && <p className="err-text">{action.error}</p>}
          {action.outcome && (
            <div className="studio-result" data-testid="register-outcome">
              <OutcomeLine outcome={action.outcome} />
            </div>
          )}
          {action.envelope && (
            <ApprovalCard
              envelope={action.envelope}
              mode={wallet.mode}
              busy={action.busy}
              onResolve={(accept, allowSimFailure) => {
                if (!accept) {
                  action.reject();
                  return;
                }
                void action.confirm(allowSimFailure);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Your recorded moment (session-50 venue depth, B1.2): RING.Moments(soul) —
 * the world writes one number per soul at each Eta() call (a tiny per-player
 * monument, refreshed on every rhythm read). The soul comes from a SIMULATED
 * CHO.GetUserSoul() (tx.origin-keyed view — from= set, an explicit preview);
 * Moments itself is an anonymous public view.
 */
function MomentPanel({
  chainUrl,
  account,
  snapshot,
}: {
  chainUrl: string;
  account: Address | null;
  snapshot: PlayerSnapshot | null;
}) {
  const [moment, setMoment] = useState<{ soul: bigint; iota: bigint } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // UNREADABLE ≠ ABSENT (65.1): a null snapshot means the reads failed, not
  // that the wallet has no LAU — only a READ snapshot may say "create first"
  const knownNoLau = snapshot !== null && snapshot.lau === null;

  useEffect(() => {
    setMoment(null);
    setError(null);
    // a known-no-LAU wallet has no soul to look up: a direct read would revert
    // with an opaque empty-data error (the demo-fresh-wallet case) — skip it.
    // An UNREADABLE snapshot still attempts the read and reports its error.
    if (account === null || knownNoLau) return;
    let alive = true;
    const client = makeClient(chainUrl);
    readPlayerMoment(client, account)
      .then((m) => {
        if (alive) setMoment(m);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [chainUrl, account, knownNoLau]);

  return (
    <div className="panel" data-testid="player-moment">
      <h2>
        your recorded moment <LearnHint file="the-ladder.md" anchor="the-account-oracle-loop" />
      </h2>
      {!account && <p className="hint">connect an account — the moment is per-soul.</p>}
      {account && knownNoLau && <p className="hint">create your LAU first — the moment is per-soul.</p>}
      {account && !knownNoLau && error !== null && !isUserNotEnteredError(error) && <p className="err-text">moment read failed: {error}</p>}
      {account && !knownNoLau && error !== null && isUserNotEnteredError(error) && (
        <p className="hint">you have no soul yet — create your LAU and enter the world through any venue door first.</p>
      )}
      {account && !knownNoLau && moment !== null && (
        <dl className="kv">
          <dt>Soul</dt>
          <dd className="mono">{moment.soul.toString()}</dd>
          <dt>Moments(soul) — Iota</dt>
          <dd className="mono">
            {moment.iota.toString()}
            {moment.iota === 0n && <span className="hint"> — zero: no moment recorded yet (a real state; RING.Eta writes it)</span>}
          </dd>
        </dl>
      )}
      {account && !knownNoLau && moment === null && error === null && <p className="hint">reading (simulated GetUserSoul + RING.Moments)…</p>}
      <p className="hint">
        RING.Moments(soul) — the last moment the rhythm oracle recorded for you; each RING.Eta()
        call refreshes it. a monument, not a live reading.
      </p>
    </div>
  );
}

/**
 * Your birth record (session-53 identity enrichment, B1.7): the Saat triple
 * (`LAU.Saat(i)` — [0] Pole state at generation, [1] Soul, [2] Aura at
 * birth) + the Bao (`LAU.On()` — the universal entity record: your channel,
 * your Rod key, the carried state) + the live `SIU.Aura()` cross-read
 * (tx.origin-keyed — SIMULATED from the account, the GetUserSoul
 * discipline) + your channel's Rod/Cone SHA pair (the DIRECTORY SHIO
 * wiring, reused on On.Shio).
 */
function BirthPanel({
  chainUrl,
  account,
  snapshot,
  snapshotError,
}: {
  chainUrl: string;
  account: Address | null;
  snapshot: PlayerSnapshot | null;
  snapshotError: string | null;
}) {
  const [birth, setBirth] = useState<PlayerBirth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lau = snapshot?.lau ?? null;

  useEffect(() => {
    setBirth(null);
    setError(null);
    if (account === null || lau === null) return;
    let alive = true;
    const client = makeClient(chainUrl);
    readPlayerBirth(client, account, lau)
      .then((b) => {
        if (alive) setBirth(b);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [chainUrl, account, lau]);

  return (
    <div className="panel" data-testid="player-birth">
      <h2>
        your birth record — Saat + Bao <LearnHint file="accounts-and-chat.md" anchor="souls-shas-and-shios" />
      </h2>
      {!account && <p className="hint">connect an account — the record is per-identity.</p>}
      {account && lau === null && snapshot !== null && <p className="hint">create your LAU first — the record is written at birth (SIU.Miu).</p>}
      {account && snapshot === null && snapshotError !== null && <p className="err-text">identity reads unavailable: {snapshotError}</p>}
      {account && snapshot === null && snapshotError === null && <p className="hint">reading your identity…</p>}
      {account && lau !== null && error !== null && <p className="err-text">birth read failed: {error}</p>}
      {account && lau !== null && birth === null && error === null && <p className="hint">reading (Saat + On + Aura)…</p>}
      {birth !== null && (
        <>
          <dl className="kv">
            <dt>Saat[0] — Pole state at generation</dt>
            <dd className="mono">{birth.saat.pole.toString()}</dd>
            <dt>Saat[1] — Soul</dt>
            <dd className="mono">{birth.saat.soul.toString()}</dd>
            <dt>Saat[2] — Aura at birth</dt>
            <dd className="mono">
              {birth.saat.aura.toString()}
              {birth.auraNow !== null && birth.auraNow !== birth.saat.aura && (
                <span className="hint"> — differs from this wallet&apos;s Aura now ({birth.auraNow.toString()})</span>
              )}
            </dd>
            <dt>SIU.Aura() — now</dt>
            <dd className="mono">
              {birth.auraNow !== null ? birth.auraNow.toString() : "— (read failed)"}
              <span className="hint"> = uint64(wallet) mod MotzkinPrime — your address, as the world reads it</span>
            </dd>
          </dl>
          <h3>the Bao — On()</h3>
          <dl className="kv">
            <dt>Phi — the entity key</dt>
            <dd className="mono">
              {birth.bao.phi !== null ? (
                <>
                  {birth.bao.phi}{" "}
                  <a className="outlink" href={`${EXPLORER_BASE}${birth.bao.phi}`} target="_blank" rel="noreferrer noopener">
                    ↗
                  </a>
                </>
              ) : (
                "—"
              )}
            </dd>
            <dt>Mu — your Rod SHA</dt>
            <dd className="mono">
              {birth.bao.mu !== null ? (
                <>
                  {birth.bao.mu}{" "}
                  <a className="outlink" href={`${EXPLORER_BASE}${birth.bao.mu}`} target="_blank" rel="noreferrer noopener">
                    ↗
                  </a>
                </>
              ) : (
                "—"
              )}
            </dd>
            <dt>Shio — your channel</dt>
            <dd className="mono">
              {birth.bao.shio !== null ? (
                <>
                  {birth.bao.shio}{" "}
                  <a className="outlink" href={`${EXPLORER_BASE}${birth.bao.shio}`} target="_blank" rel="noreferrer noopener">
                    ↗
                  </a>
                </>
              ) : (
                "—"
              )}
            </dd>
            <dt>Rod / Cone ends</dt>
            <dd className="mono">
              {birth.rod !== null ? `${birth.rod.slice(0, 10)}…` : "—"} / {birth.cone !== null ? `${birth.cone.slice(0, 10)}…` : "—"}
            </dd>
            <dt>Xi / Pi</dt>
            <dd className="mono">
              {birth.bao.xi?.toString() ?? "—"} / {birth.bao.pi?.toString() ?? "—"}
              <span className="hint"> — the entropy pair carried in the Bao</span>
            </dd>
            <dt>Ring / Omicron / Omega</dt>
            <dd className="mono">
              {birth.bao.ring?.toString() ?? "—"} / {birth.bao.omicron?.toString() ?? "—"} / {birth.bao.omega?.toString() ?? "—"}
            </dd>
            {birth.blockNumber !== null && (
              <>
                <dt>block</dt>
                <dd className="mono">{birth.blockNumber.toString()}</dd>
              </>
            )}
          </dl>
        </>
      )}
      <p className="hint">
        set once at birth by SIU.Miu: the Pole draw, a fresh Soul, and your wallet&apos;s Aura
        fingerprint — then the Bao it returns (your channel + Rod key + carried state). the world
        reads admission off these; you cannot rewrite them.
      </p>
    </div>
  );
}

function SnapshotPanel({
  account,
  snapshot,
  loading,
  error,
  onRefresh,
}: {
  account: Address | null;
  snapshot: PlayerSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [showPayload, setShowPayload] = useState(false);
  return (
    <div className="panel" data-testid="player-snapshot">
      <h2>
        player-state snapshot (§7.6 identity subset){" "}
        <button
          className="btn"
          onClick={onRefresh}
          disabled={loading || !account}
          title={!account ? "connect an account first — the snapshot is per-account" : "re-read the §7.6 snapshot"}
          data-testid="snapshot-refresh"
        >
          {loading ? "reading…" : "refresh"}
        </button>
      </h2>
      {!account && <p className="hint">no account active — the snapshot is code-computed per turn once one is.</p>}
      {error && <p className="err-text" data-testid="snapshot-error">{error}</p>}
      {snapshot && (
        <>
          <dl className="kv">
            <dt>wallet</dt>
            <dd className="mono">{snapshot.account}</dd>
            <dt>LAU</dt>
            <dd className="mono">{snapshot.lau ?? "— none yet"}</dd>
            <dt>Username</dt>
            <dd>{snapshot.username ?? "— unset (chat paths need it)"}</dd>
            <dt>YUE</dt>
            <dd className="mono">{snapshot.yue ?? "— none yet"}</dd>
            <dt>Yuan (CHOA)</dt>
            <dd>
              <span className="mono">{fmtAmt(snapshot.yuanChoa)}</span>
              <span className="hint"> = wallet + 10×LAU + 40×YUE holdings (deployed weights)</span>
            </dd>
            {snapshot.blockNumber !== null && (
              <>
                <dt>block</dt>
                <dd className="mono">{snapshot.blockNumber.toString()}</dd>
              </>
            )}
          </dl>
          <table className="bal-table" data-testid="bal-table">
            <thead>
              <tr>
                <th />
                <th>wallet</th>
                <th>LAU</th>
                <th>YUE</th>
              </tr>
            </thead>
            <tbody>
              <BalRow label="PLS" tri={snapshot.balances.pls} />
              <BalRow label="Ⓐ AFFECTION" tri={snapshot.balances.affection} />
              <BalRow label="CHOA" tri={snapshot.balances.choa} />
            </tbody>
          </table>
          <p className="hint">
            anonymous Multicall3 aggregate3 reads — <code>from=</code> is never set on panel loads.{" "}
            <button className="linkish" onClick={() => setShowPayload((v) => !v)} data-testid="payload-toggle">
              {showPayload ? "hide" : "show"} the per-turn agent payload
            </button>{" "}
            <span className="chip" data-testid="payload-size">
              {agentPayloadSize(snapshot)} B / 1536 B cap
            </span>
          </p>
          {showPayload && (
            <pre className="mono payload-pre" data-testid="payload-json">
              {JSON.stringify(toAgentPayload(snapshot), null, 1)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

function BalRow({ label, tri }: { label: string; tri: { wallet: bigint; lau: bigint; yue: bigint } }) {
  return (
    <tr>
      <th>{label}</th>
      <td className="mono">{fmtAmt(tri.wallet)}</td>
      <td className="mono">{fmtAmt(tri.lau)}</td>
      <td className="mono">{fmtAmt(tri.yue)}</td>
    </tr>
  );
}

/**
 * The SIM resource ledger (session 58, §8): VITUS royalties + H2O water held
 * by your YUE, on the harness fixture layer — rendered ONLY in sim mode, one
 * anonymous balanceOf(yue) batch. The royalty exit is honestly UNAVAILABLE:
 * the live YUE's hasMint probe staticcalls a spaced selector ("Mint(address,
 * uint256)") that no contract answers — YUE.Withdraw is dead code chain-wide
 * (fork-proven, harness set-3 step 10).
 */
function SimLedgerPanel({ chainUrl, yue }: { chainUrl: string; yue: `0x${string}` | null }) {
  const active = useMemo(() => simLayerActive(chainUrl), [chainUrl]);
  const [ledger, setLedger] = useState<{ vitus: bigint | null; h2o: bigint | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLedger(null);
    setErr(null);
    if (!active || yue === null) return;
    let alive = true;
    const client = makeClient(chainUrl);
    loadSimLedger(client, chainUrl, yue)
      .then((l) => {
        if (alive) setLedger(l);
      })
      .catch((e: unknown) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [active, chainUrl, yue]);

  if (!active) return null;
  return (
    <div className="panel" data-testid="sim-ledger">
      <h2>
        world-layer resources <span className="chip chip-sim">SIM · fixture</span>
      </h2>
      {yue === null ? (
        <p className="hint">start your YUE to read the vault's fixture resources.</p>
      ) : (
        <dl className="kv">
          <dt>VITUS royalties (YUE)</dt>
          <dd className="mono">{ledger !== null && ledger.vitus !== null ? fmtAmt(ledger.vitus) : "…"}</dd>
          <dt>H₂O water (YUE)</dt>
          <dd className="mono">{ledger !== null && ledger.h2o !== null ? fmtAmt(ledger.h2o) : "…"}</dd>
        </dl>
      )}
      <p className="hint">
        the never-deployed layer's tokens on this fork (harness set-3 fixtures). the royalty exit
        (VITUS.Withdraw) is honestly unavailable everywhere: the YUE's hasMint asset probe
        staticcalls a wrong-shaped selector and reverts for every asset — vault custody is final
        as deployed.
      </p>
      {err !== null && <p className="err-text">sim ledger: {err}</p>}
    </div>
  );
}

/**
 * The ENCRYPT cipher desk (session 59, §8 — the owner round: a COMPACT
 * CIPHER CARD; the contract has no enumeration getter, so a chat-like list
 * would be fabricated). Two-party stream cipher between SHIO-owning souls:
 * the returned uint64 index is the ONLY handle — it travels to the
 * counterparty offchain. Fork-pinned semantics (harness set-3 steps 11–12):
 * the keystream is a deterministic orbit (preview index == committed; the
 * Decrypt preview == the exact plaintext); Encrypt gates on YOUR side of the
 * pair, Decrypt on the TO side (NotParty otherwise); entries expire in 10
 * days — an expired entry decrypts once more, then answers empty; Prune is
 * defective (wrong key domain — it cannot remove entries); every call
 * meters (a string-Encrypt mints +4 units via the overload chain).
 */
function CipherPanel({ chainUrl, account, snapshot }: { chainUrl: string; account: Address | null; snapshot: PlayerSnapshot | null }) {
  const active = useMemo(() => simLayerActive(chainUrl), [chainUrl]);
  const wallet = useWallet();
  const encAction = useGateAction();
  const decAction = useGateAction();
  const pruneAction = useGateAction();
  const [mySoul, setMySoul] = useState<bigint | null>(null);
  const [resolveText, setResolveText] = useState("");
  const [resolvedSoul, setResolvedSoul] = useState<bigint | null>(null);
  const [toSoul, setToSoul] = useState("");
  const [encKey, setEncKey] = useState("");
  const [encMsg, setEncMsg] = useState("");
  const [encEnv, setEncEnv] = useState<import("@/chain/txGate").GateEnvelope | null>(null);
  const [encBusy, setEncBusy] = useState(false);
  const [decFrom, setDecFrom] = useState("");
  const [decTo, setDecTo] = useState("");
  const [decIndex, setDecIndex] = useState("");
  const [decKey, setDecKey] = useState("");
  const [decEnv, setDecEnv] = useState<import("@/chain/txGate").GateEnvelope | null>(null);
  const [decBusy, setDecBusy] = useState(false);

  const lau = (snapshot?.lau as Address | null) ?? null;

  useEffect(() => {
    setMySoul(null);
    if (!active || lau === null) return;
    let alive = true;
    const client = makeClient(chainUrl);
    void readSoulId(client, lau).then((s) => {
      if (alive) setMySoul(s);
    });
    return () => {
      alive = false;
    };
  }, [active, chainUrl, lau]);

  const resolveCounterparty = async () => {
    const t = resolveText.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(t)) return;
    setResolvedSoul(await readSoulId(makeClient(chainUrl), t as Address));
  };

  const soulNum = (text: string): bigint | null => {
    try {
      const v = BigInt(text.trim());
      return v >= 0n ? v : null;
    } catch {
      return null;
    }
  };

  const encRequest = async () => {
    if (account === null || mySoul === null) return null;
    const to = soulNum(toSoul);
    if (to === null || encKey.length === 0 || encMsg.trim().length === 0) return null;
    const e = await encodeEncryptString(mySoul, to, encKey, encMsg, chainUrl);
    return {
      to: e.to as `0x${string}`,
      data: e.data,
      account,
      abi: e.abi,
      meta: { source: "manual" as const, label: `SIM encrypt a note → soul ${to.toString()}` },
    };
  };

  const encDryRun = async () => {
    setEncBusy(true);
    setEncEnv(null);
    try {
      const req = await encRequest();
      if (req === null) return;
      setEncEnv(await encAction.probe(req));
    } finally {
      setEncBusy(false);
    }
  };

  const beginEncrypt = async () => {
    const req = await encRequest();
    if (req === null) return;
    await encAction.begin(req);
  };

  const decRequest = async () => {
    if (account === null) return null;
    const from = soulNum(decFrom);
    const to = soulNum(decTo);
    const index = soulNum(decIndex);
    if (from === null || to === null || index === null || decKey.length === 0) return null;
    const e = await encodeDecryptString(from, to, index, decKey, chainUrl);
    return {
      to: e.to as `0x${string}`,
      data: e.data,
      account,
      abi: e.abi,
      meta: { source: "manual" as const, label: `SIM decrypt note ${index.toString()}` },
    };
  };

  const decDryRun = async () => {
    setDecBusy(true);
    setDecEnv(null);
    try {
      const req = await decRequest();
      if (req === null) return;
      setDecEnv(await decAction.probe(req));
    } finally {
      setDecBusy(false);
    }
  };

  const beginDecrypt = async () => {
    const req = await decRequest();
    if (req === null) return;
    await decAction.begin(req);
  };

  const beginPrune = async () => {
    if (account === null) return;
    const e = await encodePrune(chainUrl);
    await pruneAction.begin({
      to: e.to as `0x${string}`,
      data: e.data,
      account,
      abi: e.abi,
      meta: { source: "manual" as const, label: "SIM encrypt prune" },
    });
  };

  if (!active) return null;

  const encIndex = encEnv?.sim?.ok && encEnv.sim.result !== null ? decodeEncryptIndex(encEnv.sim.result) : null;
  const decPlain = decEnv?.sim?.ok && decEnv.sim.result !== null ? decodeDecryptPlain(decEnv.sim.result) : null;

  return (
    <div className="panel" data-testid="sim-cipher">
      <h2>
        the cipher desk — ENCRYPT <span className="chip chip-sim">SIM · fixture</span>
      </h2>
      <p className="hint">
        a two-party stream cipher between souls: ENCRYPT gates on YOUR side of the pair (you must own the
        From soul's SHIO — the wallet that created the LAU does), DECRYPT gates on the TO side. the
        returned index (a keystream state, not a sequence number) is the ONLY handle — there is no
        enumeration getter; hand it to your counterparty offchain together with the key. entries expire
        in 10 days: an expired entry decrypts ONCE more, then answers empty. the keystream is a
        deterministic orbit over the pair's SHA channels — previews are EXACT here (unlike Beat/settle
        previews). every call MINTS to the fixture (a string-Encrypt costs +4 units through the overload
        chain — the call-counter law). not confidentiality: a public orbit over world-readable state.
      </p>
      <dl className="kv" data-testid="sim-cipher-soul">
        <dt>your soul (Saat[1])</dt>
        <dd className="mono">{lau === null ? "create your LAU first" : mySoul === null ? "…" : mySoul.toString()}</dd>
      </dl>

      <h3>resolve a counterparty</h3>
      <div className="arg-row">
        <label htmlFor="cipher-resolve">their LAU address</label>
        <input
          id="cipher-resolve"
          className="mono"
          spellCheck={false}
          placeholder="0x… their LAU — reads its Saat[1]"
          value={resolveText}
          onChange={(e) => {
            setResolveText(e.target.value);
            setResolvedSoul(null);
          }}
          data-testid="sim-cipher-resolve"
        />
      </div>
      <div className="studio-actions">
        <button className="btn" disabled={!/^0x[0-9a-fA-F]{40}$/.test(resolveText.trim())} onClick={() => void resolveCounterparty()} data-testid="sim-cipher-resolve-btn">
          read their soul
        </button>
        {resolvedSoul !== null && (
          <span className="mono" data-testid="sim-cipher-resolved">
            soul {resolvedSoul.toString()}
            <button
              className="btn"
              onClick={() => {
                setToSoul(resolvedSoul.toString());
                setDecFrom(resolvedSoul.toString());
                setDecTo(mySoul !== null ? mySoul.toString() : "");
              }}
              data-testid="sim-cipher-use-soul"
            >
              use as counterparty
            </button>
          </span>
        )}
      </div>

      <h3>encrypt a note (you are the From side)</h3>
      <div className="arg-row">
        <label htmlFor="cipher-to">their soul (To, uint64)</label>
        <input id="cipher-to" className="mono" spellCheck={false} value={toSoul} onChange={(e) => setToSoul(e.target.value)} data-testid="sim-cipher-to" />
      </div>
      <div className="arg-row">
        <label htmlFor="cipher-key">the key (travels offchain with the index)</label>
        <input id="cipher-key" className="mono" spellCheck={false} value={encKey} onChange={(e) => setEncKey(e.target.value)} data-testid="sim-cipher-key" />
      </div>
      <div className="arg-row">
        <label htmlFor="cipher-msg">the note</label>
        <input id="cipher-msg" className="mono" spellCheck={false} value={encMsg} onChange={(e) => setEncMsg(e.target.value)} data-testid="sim-cipher-msg" />
      </div>
      <div className="studio-actions">
        <button
          className="btn"
          disabled={encBusy || account === null || mySoul === null || soulNum(toSoul) === null || encKey.length === 0 || encMsg.trim().length === 0}
          onClick={() => void encDryRun()}
          data-testid="sim-cipher-enc-dryrun"
        >
          DRYRUN
        </button>
        <button
          className="btn btn-primary"
          disabled={encAction.busy || account === null || mySoul === null || soulNum(toSoul) === null || encKey.length === 0 || encMsg.trim().length === 0}
          onClick={() => void beginEncrypt()}
          data-testid="sim-cipher-enc-send"
        >
          SEND — Encrypt {wallet.mode === "C" ? "(yolo — policy only)" : ""}
        </button>
      </div>
      {encEnv && encEnv.sim && (
        <div className="studio-result" data-testid="sim-cipher-enc-sim">
          <pre className="mono">
            {encEnv.sim.ok
              ? `DRYRUN ok — index ${encIndex !== null ? encIndex.toString() : "?"} (deterministic: this IS the committed index — hand it to your counterparty with the key)`
              : `DRYRUN revert${encEnv.sim.error?.decoded ? `: ${encEnv.sim.error.decoded}` : ""}\n${encEnv.sim.error?.message ?? ""}`}
          </pre>
        </div>
      )}
      {encAction.outcome && encAction.outcome.status === "sent" && encIndex !== null && (
        <p className="ok-text" data-testid="sim-cipher-enc-note">
          sent — your counterparty decrypts with (from {mySoul?.toString()}, to {toSoul}, index{" "}
          {encIndex.toString()}, the key).
        </p>
      )}
      {encAction.error && <p className="err-text">{encAction.error}</p>}

      <h3>decrypt a note (you are the To side)</h3>
      <div className="arg-row">
        <label htmlFor="dec-from">From soul (the sender)</label>
        <input id="dec-from" className="mono" spellCheck={false} value={decFrom} onChange={(e) => setDecFrom(e.target.value)} data-testid="sim-cipher-dec-from" />
      </div>
      <div className="arg-row">
        <label htmlFor="dec-to">To soul (yours)</label>
        <input id="dec-to" className="mono" spellCheck={false} value={decTo} onChange={(e) => setDecTo(e.target.value)} data-testid="sim-cipher-dec-to" />
      </div>
      <div className="arg-row">
        <label htmlFor="dec-index">the index they sent you</label>
        <input id="dec-index" className="mono" spellCheck={false} value={decIndex} onChange={(e) => setDecIndex(e.target.value)} data-testid="sim-cipher-dec-index" />
      </div>
      <div className="arg-row">
        <label htmlFor="dec-key">the key</label>
        <input id="dec-key" className="mono" spellCheck={false} value={decKey} onChange={(e) => setDecKey(e.target.value)} data-testid="sim-cipher-dec-key" />
      </div>
      <div className="studio-actions">
        <button
          className="btn"
          disabled={decBusy || account === null || soulNum(decFrom) === null || soulNum(decTo) === null || soulNum(decIndex) === null || decKey.length === 0}
          onClick={() => void decDryRun()}
          data-testid="sim-cipher-dec-dryrun"
        >
          DRYRUN
        </button>
        <button
          className="btn btn-primary"
          disabled={decAction.busy || account === null || soulNum(decFrom) === null || soulNum(decTo) === null || soulNum(decIndex) === null || decKey.length === 0}
          onClick={() => void beginDecrypt()}
          data-testid="sim-cipher-dec-send"
        >
          SEND — Decrypt {wallet.mode === "C" ? "(yolo — policy only)" : ""}
        </button>
      </div>
      {decEnv && decEnv.sim && (
        <div className="studio-result" data-testid="sim-cipher-dec-sim">
          <pre className="mono">
            {decEnv.sim.ok
              ? decPlain !== null && decPlain.text !== null
                ? `DRYRUN ok — plaintext (${decPlain.byteLength} bytes): ${JSON.stringify(decPlain.text)}`
                : `DRYRUN ok — ${decPlain !== null ? decPlain.byteLength : 0} bytes, not valid utf-8 (empty = the entry is gone or the pair/key mismatches)`
              : `DRYRUN revert${decEnv.sim.error?.decoded ? `: ${decEnv.sim.error.decoded}` : ""} (NotParty = you are not the To side of THIS pair)\n${decEnv.sim.error?.message ?? ""}`}
          </pre>
        </div>
      )}
      {decAction.error && <p className="err-text">{decAction.error}</p>}

      <h3>prune (the defective sweep)</h3>
      <p className="hint">
        Prune() is public and metered, but it indexes the store by ARRAY POSITION while entries live at
        KEYSTREAM indexes — fork-pinned it removes nothing real (live and even EXPIRED entries stay
        decryptable). it exists here for honesty, not hygiene.
      </p>
      <div className="studio-actions">
        <button className="btn" disabled={pruneAction.busy || account === null} onClick={() => void beginPrune()} data-testid="sim-cipher-prune">
          SEND — Prune {wallet.mode === "C" ? "(yolo — policy only)" : ""}
        </button>
      </div>
      {pruneAction.outcome && (
        <div className="studio-result" data-testid="sim-cipher-prune-outcome">
          <pre className="mono">{pruneAction.outcome.status === "sent" ? `sent (${pruneAction.outcome.txHash}) — nothing real was removed` : pruneAction.outcome.status}</pre>
        </div>
      )}
      {pruneAction.error && <p className="err-text">{pruneAction.error}</p>}

      {encAction.envelope && (
        <ApprovalCard
          envelope={encAction.envelope}
          mode={wallet.mode}
          busy={encAction.busy}
          onResolve={(accept, allowSimFailure) => {
            if (!accept) {
              encAction.reject();
              return;
            }
            void encAction.confirm(allowSimFailure);
          }}
        />
      )}
      {decAction.envelope && (
        <ApprovalCard
          envelope={decAction.envelope}
          mode={wallet.mode}
          busy={decAction.busy}
          onResolve={(accept, allowSimFailure) => {
            if (!accept) {
              decAction.reject();
              return;
            }
            void decAction.confirm(allowSimFailure);
          }}
        />
      )}
      {pruneAction.envelope && (
        <ApprovalCard
          envelope={pruneAction.envelope}
          mode={wallet.mode}
          busy={pruneAction.busy}
          onResolve={(accept, allowSimFailure) => {
            if (!accept) {
              pruneAction.reject();
              return;
            }
            void pruneAction.confirm(allowSimFailure);
          }}
        />
      )}
    </div>
  );
}

function LauPanel({
  chainUrl,
  account,
  snapshot,
  pendingLau,
  onSent,
}: {
  chainUrl: string;
  account: Address | null;
  snapshot: PlayerSnapshot | null;
  pendingLau: Address | null;
  onSent: () => void;
}) {
  const wallet = useWallet();
  const action = useGateAction();
  const sweep = useGateAction();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [username, setUsername] = useState("");
  const [renameName, setRenameName] = useState("");
  const [renameSymbol, setRenameSymbol] = useState("");
  const [predicted, setPredicted] = useState<Address | null>(null);
  const [abi, setAbi] = useState<Abi | null>(null);
  const [abiErr, setAbiErr] = useState<string | null>(null);
  const [sweepToken, setSweepToken] = useState<"AFFECTION" | "CHOA" | "custom">("AFFECTION");
  const [sweepCustom, setSweepCustom] = useState("");
  const [sweepAmount, setSweepAmount] = useState("");

  useEffect(() => {
    loadAbi("LAU.json").then(setAbi).catch((e: unknown) => setAbiErr(e instanceof Error ? e.message : String(e)));
  }, []);

  // predicted LAU address (CREATE1 from the factory's next nonce — harness-proven pattern)
  useEffect(() => {
    let alive = true;
    setPredicted(null);
    if (!account || snapshot?.lau || pendingLau) return;
    const client = makeClient(chainUrl);
    void client
      .getTransactionCount({ address: addr("LAUFactory") })
      .then((nonce) => {
        if (!alive) return;
        setPredicted(getContractAddress({ opcode: "CREATE", from: addr("LAUFactory"), nonce: BigInt(nonce) }));
      })
      .catch(() => {
        if (alive) setPredicted(null);
      });
    return () => {
      alive = false;
    };
  }, [chainUrl, account, snapshot?.lau, pendingLau]);

  useEffect(() => {
    if (action.outcome?.status === "sent") onSent();
  }, [action.outcome, onSent]);

  useEffect(() => {
    if (sweep.outcome?.status === "sent") onSent();
  }, [sweep.outcome, onSent]);

  const uErr = usernameError(username);
  // session-64: the pending (pre-registration) LAU carries the same manage
  // surface — Username/rename/sweep all act on the token itself
  const lau = snapshot?.lau ?? pendingLau;

  const beginCreate = async () => {
    if (!account || !abi) return;
    await action.begin({
      to: addr("LAUFactory"),
      data: encodeFunctionData({
        abi: [pickFn(await loadAbi("LAUFactory.json"), "New", 2)],
        functionName: "New",
        args: [name, symbol],
      }),
      account,
      meta: { source: "manual", label: "IDENTITY create LAU" },
    });
  };

  const beginUsername = async () => {
    if (!account || !abi || !lau || uErr !== null) return;
    await action.begin({
      to: lau,
      data: encodeFunctionData({
        abi: [pickFn(abi, "Username", 1)],
        functionName: "Username",
        args: [username],
      }),
      account,
      abi,
      meta: { source: "manual", label: "IDENTITY set Username" },
    });
  };

  const beginRename = async () => {
    if (!account || !abi || !lau) return;
    await action.begin({
      to: lau,
      data: encodeFunctionData({
        abi: [pickFn(abi, "Rename", 2)],
        functionName: "Rename",
        args: [renameName, renameSymbol],
      }),
      account,
      abi,
      meta: { source: "manual", label: "IDENTITY rename LAU" },
    });
  };

  // the pocket sweep: LAU.Withdraw(what, amount) — owners-gated transfer-out
  const sweepWhat: string | null =
    sweepToken === "custom"
      ? /^0x[0-9a-fA-F]{40}$/.test(sweepCustom.trim())
        ? sweepCustom.trim()
        : null
      : addr(sweepToken);
  const sweepAmt = parseAmount(sweepAmount);
  const sweepMax: bigint | null =
    sweepToken === "AFFECTION"
      ? (snapshot?.balances.affection.lau ?? null)
      : sweepToken === "CHOA"
        ? (snapshot?.balances.choa.lau ?? null)
        : null;

  const beginSweep = async () => {
    if (!account || !abi || !lau || sweepWhat === null || sweepAmt === null || sweepAmt <= 0n) return;
    await sweep.begin({
      to: lau,
      data: encodeFunctionData({
        abi: [pickFn(abi, "Withdraw", 2)],
        functionName: "Withdraw",
        args: [sweepWhat, sweepAmt],
      }),
      account,
      abi,
      meta: { source: "manual", label: "IDENTITY sweep LAU pocket" },
    });
  };

  return (
    <div className="panel" data-testid="lau-panel">
      <h2>
        LAU — the account token <LearnHint file="accounts-and-chat.md" anchor="lau-the-account-token" />{" "}
        {lau && (
          <a className="outlink" href={`${EXPLORER_BASE}${lau}`} target="_blank" rel="noreferrer noopener">
            ↗
          </a>
        )}
      </h2>
      {abiErr && <p className="err-text">{abiErr}</p>}
      {!account && <p className="hint">connect an account (SETTINGS → wallet) to create or manage a LAU.</p>}

      {account && !lau && (
        <div className="lau-create">
          <p className="hint">
            LAUFactory.New(name, symbol) — your personal token: it carries your name, holds anything you
            send it, and pays back out. Username is set AFTER this, before any chat path.
          </p>
          <div className="arg-row">
            <label htmlFor="lau-name">name (the world sees this)</label>
            <input id="lau-name" className="mono" spellCheck={false} placeholder="e.g. Alice" value={name} onChange={(e) => setName(e.target.value)} data-testid="lau-name" />
          </div>
          <div className="arg-row">
            <label htmlFor="lau-symbol">symbol (short handle)</label>
            <input id="lau-symbol" className="mono" spellCheck={false} placeholder="e.g. ALICE" value={symbol} onChange={(e) => setSymbol(e.target.value)} data-testid="lau-symbol" />
          </div>
          {predicted && (
            <p className="hint" data-testid="lau-predicted">
              predicted address (CREATE1, harness-proven precompute): <span className="mono">{predicted}</span>
            </p>
          )}
          <button
            className="btn btn-primary"
            disabled={action.busy || name.trim().length === 0 || symbol.trim().length === 0}
            onClick={() => void beginCreate()}
            data-testid="lau-create"
          >
            SEND — create LAU {wallet.mode === "A" ? "(wallet prompts)" : "(approval card)"}
          </button>
        </div>
      )}

      {account && lau && (
        <>
          <dl className="kv">
            <dt>address</dt>
            <dd className="mono">{lau}</dd>
            <dt>name · symbol</dt>
            <dd>
              {snapshot?.lauName ?? "?"} · <span className="mono">{snapshot?.lauSymbol ?? "?"}</span>
            </dd>
            <dt>Username</dt>
            <dd>{snapshot?.username ?? "— unset"}</dd>
          </dl>

          <h3>Username editor</h3>
          <div className="arg-row">
            <label htmlFor="username-input">
              Username — ≤ 12 bytes (onchain cap; the check is live)
            </label>
            <input
              id="username-input"
              className="mono"
              spellCheck={false}
              maxLength={24}
              placeholder={snapshot?.username ?? "e.g. alice"}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              data-testid="username-input"
            />
          </div>
          {uErr !== null && username.length > 0 && (
            <p className="err-text" data-testid="username-error">
              {uErr}
            </p>
          )}
          <button
            className="btn btn-primary"
            disabled={action.busy || uErr !== null || username.length === 0}
            onClick={() => void beginUsername()}
            data-testid="username-set"
          >
            SEND — set Username
          </button>

          <h3>rename the token</h3>
          <div className="arg-row">
            <label htmlFor="lau-rename-name">new name</label>
            <input id="lau-rename-name" className="mono" spellCheck={false} placeholder={snapshot?.lauName ?? ""} value={renameName} onChange={(e) => setRenameName(e.target.value)} data-testid="lau-rename-name" />
          </div>
          <div className="arg-row">
            <label htmlFor="lau-rename-symbol">new symbol</label>
            <input id="lau-rename-symbol" className="mono" spellCheck={false} placeholder={snapshot?.lauSymbol ?? ""} value={renameSymbol} onChange={(e) => setRenameSymbol(e.target.value)} data-testid="lau-rename-symbol" />
          </div>
          <button
            className="btn"
            disabled={action.busy || renameName.trim().length === 0 || renameSymbol.trim().length === 0}
            onClick={() => void beginRename()}
            data-testid="lau-rename"
          >
            SEND — rename
          </button>

          <h3>the pocket — sweep out what the LAU holds</h3>
          <p className="hint">
            anything the LAU happens to hold (bounties, gifts, mistakes) can be swept out with{" "}
            <code>Withdraw(what, amount)</code> — your own custody, one hop deep, owners-gated.
            balances the snapshot tracks:
            <span className="mono"> Ⓐ {fmtAmt(snapshot?.balances.affection.lau ?? 0n)} · CHOA {fmtAmt(snapshot?.balances.choa.lau ?? 0n)}</span>
          </p>
          <div className="arg-row">
            <label htmlFor="sweep-token">token to sweep</label>
            <select
              id="sweep-token"
              className="mono"
              value={sweepToken}
              onChange={(e) => setSweepToken(e.target.value as "AFFECTION" | "CHOA" | "custom")}
              data-testid="sweep-token"
            >
              <option value="AFFECTION">Ⓐ AFFECTION</option>
              <option value="CHOA">CHOA</option>
              <option value="custom">other ERC-20 (address)</option>
            </select>
          </div>
          {sweepToken === "custom" && (
            <div className="arg-row">
              <label htmlFor="sweep-custom">token contract address</label>
              <input
                id="sweep-custom"
                className="mono"
                spellCheck={false}
                placeholder="0x…"
                value={sweepCustom}
                onChange={(e) => setSweepCustom(e.target.value)}
                data-testid="sweep-custom"
              />
            </div>
          )}
          <div className="arg-row">
            <label htmlFor="sweep-amount">amount</label>
            <input
              id="sweep-amount"
              className="mono"
              spellCheck={false}
              placeholder="0.0"
              value={sweepAmount}
              onChange={(e) => setSweepAmount(e.target.value)}
              data-testid="sweep-amount"
            />
            {sweepMax !== null && sweepMax > 0n && (
              <button
                className="btn"
                onClick={() => setSweepAmount(formatUnits(sweepMax, 18))}
                data-testid="sweep-max"
                title="fill with the LAU's tracked balance"
              >
                max
              </button>
            )}
          </div>
          <button
            className="btn"
            disabled={sweep.busy || sweepWhat === null || sweepAmt === null || sweepAmt <= 0n}
            onClick={() => void beginSweep()}
            data-testid="sweep-send"
          >
            SEND — sweep {wallet.mode === "A" ? "(wallet prompts)" : "(approval card)"}
          </button>
          {sweep.error && <p className="err-text">{sweep.error}</p>}
          {sweep.outcome && (
            <div className="studio-result" data-testid="sweep-outcome">
              <OutcomeLine outcome={sweep.outcome} />
            </div>
          )}
          {sweep.envelope && (
            <ApprovalCard
              envelope={sweep.envelope}
              mode={wallet.mode}
              busy={sweep.busy}
              onResolve={(accept, allowSimFailure) => {
                if (!accept) {
                  sweep.reject();
                  return;
                }
                void sweep.confirm(allowSimFailure);
              }}
            />
          )}
        </>
      )}

      {action.error && <p className="err-text">{action.error}</p>}
      {action.outcome && (
        <div className="studio-result" data-testid="lau-outcome">
          <OutcomeLine outcome={action.outcome} />
        </div>
      )}
      {action.envelope && (
        <ApprovalCard
          envelope={action.envelope}
          mode={wallet.mode}
          busy={action.busy}
          onResolve={(accept, allowSimFailure) => {
            if (!accept) {
              action.reject();
              return;
            }
            void action.confirm(allowSimFailure);
          }}
        />
      )}
    </div>
  );
}

function YuePanel({
  account,
  snapshot,
  pendingLau,
  onSent,
}: {
  account: Address | null;
  snapshot: PlayerSnapshot | null;
  pendingLau: Address | null;
  onSent: () => void;
}) {
  const wallet = useWallet();
  const action = useGateAction();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [abi, setAbi] = useState<Abi | null>(null);
  const [abiErr, setAbiErr] = useState<string | null>(null);

  useEffect(() => {
    loadAbi("SEI.json").then(setAbi).catch((e: unknown) => setAbiErr(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (action.outcome?.status === "sent") onSent();
  }, [action.outcome, onSent]);

  const yue = snapshot?.yue ?? null;
  const lau = snapshot?.lau ?? pendingLau;

  const beginStart = async () => {
    if (!account || !abi || !lau) return;
    await action.begin({
      to: addr("SEI"),
      data: encodeFunctionData({
        abi: [pickFn(abi, "Start", 3)],
        functionName: "Start",
        args: [lau, name, symbol],
      }),
      account,
      abi,
      meta: { source: "manual", label: yue ? "IDENTITY rename YUE" : "IDENTITY open YUE" },
    });
  };

  return (
    <div className="panel" data-testid="yue-panel">
      <h2>
        YUE — the account-vault <LearnHint file="economy.md" anchor="sei-and-the-yue-account-tokens" />{" "}
        {yue && (
          <a className="outlink" href={`${EXPLORER_BASE}${yue}`} target="_blank" rel="noreferrer noopener">
            ↗
          </a>
        )}
      </h2>
      {abiErr && <p className="err-text">{abiErr}</p>}
      {!account && <p className="hint">connect an account to open a vault.</p>}
      {account && !lau && <p className="hint">create your LAU first — the vault opens onto it.</p>}

      {account && lau && (
        <>
          {yue ? (
            <dl className="kv">
              <dt>address</dt>
              <dd className="mono">{yue}</dd>
              <dt>name · symbol</dt>
              <dd>
                {snapshot?.yueName ?? "?"} · <span className="mono">{snapshot?.yueSymbol ?? "?"}</span>
              </dd>
            </dl>
          ) : (
            <p className="hint">
              SEI.Start(LAU, name, symbol) — one vault per wallet; it receives what the world pays you
              (e.g. CHOA chat rewards route here).
            </p>
          )}
          <div className="arg-row">
            <label htmlFor="yue-name">{yue ? "rename — new name" : "vault name"}</label>
            <input id="yue-name" className="mono" spellCheck={false} placeholder="e.g. Alice Vault" value={name} onChange={(e) => setName(e.target.value)} data-testid="yue-name" />
          </div>
          <div className="arg-row">
            <label htmlFor="yue-symbol">{yue ? "rename — new symbol" : "vault symbol"}</label>
            <input id="yue-symbol" className="mono" spellCheck={false} placeholder="e.g. vALICE" value={symbol} onChange={(e) => setSymbol(e.target.value)} data-testid="yue-symbol" />
          </div>
          {yue && (
            <p className="hint">
              deployed semantics: calling Start again with an existing vault only renames it — no new
              vault is created. Start binds to the sending account (tx.origin), so send it from your
              wallet, not through any contract.
            </p>
          )}
          <button
            className="btn btn-primary"
            disabled={action.busy || name.trim().length === 0 || symbol.trim().length === 0}
            onClick={() => void beginStart()}
            data-testid="yue-start"
          >
            SEND — {yue ? "rename YUE" : "open YUE"} {wallet.mode === "A" ? "(wallet prompts)" : "(approval card)"}
          </button>
        </>
      )}

      {action.error && <p className="err-text">{action.error}</p>}
      {action.outcome && (
        <div className="studio-result" data-testid="yue-outcome">
          <OutcomeLine outcome={action.outcome} />
        </div>
      )}
      {action.envelope && (
        <ApprovalCard
          envelope={action.envelope}
          mode={wallet.mode}
          busy={action.busy}
          onResolve={(accept, allowSimFailure) => {
            if (!accept) {
              action.reject();
              return;
            }
            void action.confirm(allowSimFailure);
          }}
        />
      )}
    </div>
  );
}

export function OutcomeLine({
  outcome,
}: {
  outcome: import("@/chain/txGate").GateOutcome;
}) {
  if (outcome.status === "denied")
    return <span className="err-text">DENIED by policy: {outcome.reasons.join("; ")}</span>;
  if (outcome.status === "sim-failed")
    return <span className="err-text">blocked: DRYRUN reverted (override in the card)</span>;
  if (outcome.status === "aborted") return <span className="err-text">aborted: {outcome.reason}</span>;
  return (
    <>
      <span className="ok-text">sent</span> <span className="mono">{outcome.txHash}</span>
      {outcome.receipt && (
        <span className="hint">
          {" "}
          receipt {outcome.receipt.status} · gas {outcome.receipt.gasUsed.toString()}
        </span>
      )}
      {outcome.receiptError && <span className="err-text"> receipt: {outcome.receiptError}</span>}
    </>
  );
}
