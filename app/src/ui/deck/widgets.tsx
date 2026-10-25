import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { fmtAmt, onboardingSteps, usernameError, type PlayerSnapshot } from "@/chain/identity";
import { usePowerTokens } from "@/chain/powerTokens";
import { useEntityProfile } from "@/chain/entityProfile";
import { useVenueState } from "@/chain/venueState";
import { makeClient } from "@/chain/client";
import { readChatLatest, worldChannel, venueChannel, type ChatChannel, type LatestTail } from "@/chain/chatTail";
import { parseLine } from "@/state/chatSeed";
import { loadRenderRows, renderRowAsVenueRow, type RenderRow } from "@/state/atlas";
import { mergeByAddress, useSyncState } from "@/chain/sync";
import { useLiveRenderRow } from "@/chain/liveAtlas";
import { handleColor } from "@/ui/chat/handleColor";
import { renderChatBody } from "@/ui/safeContent";
import { useCurrentVenue } from "@/state/venueStore";
import { usePendingLau } from "@/state/pendingLau";
import { useHomeVenueResolved } from "@/state/homeVenue";
import { surfaceWidget } from "@/state/deckStore";
import { useAgent } from "@/agent/store";
import { searchKb } from "@/agent/knowledge";
import { BEAT_GAS_LIMIT, BEAT_GAS_MEDIAN } from "@/agent/tools";
import { rejectPlan, usePlan, type Plan, type PlanStep } from "@/state/planStore";
import { AtlasCanvas } from "@/ui/map/AtlasCanvas";
import { VenueHudCard } from "@/ui/map/VenueHudCard";
import type { ChainState } from "@/chain/useChainState";
import type { WalletApi } from "@/wallet/WalletContext";

/**
 * The DECK widget registry (IA-PLAN §7.11; session-63 slot redesign): typed
 * renderers keyed by kind, one per BAY. Widgets are READ-ONLY surfaces —
 * actions stay in the contextual panels (MAP/IDENTITY) and the gate's
 * approval surfaces INLINE in the AI_CORE pane. Chat lines render as inert
 * text (the §7.4 untrusted-content fence). The fleet scoreboard is OFF-DECK
 * (the SYS tab owns it — real users never see fleet machinery).
 */

export interface WidgetRenderProps {
  widget: { kind: string; props: Record<string, unknown> };
  chain: ChainState;
  snapshot: PlayerSnapshot | null;
  wallet: WalletApi;
  /** navigation for the onboarding CTAs */
  onGoView: (v: "identity" | "settings") => void;
}

function strProp(w: { props: Record<string, unknown> }, key: string): string | null {
  const v = w.props[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

// ---------- onboarding (the deck-native checklist — session-57, a bay widget since 63) ----------

/**
 * The AGENT, ONBOARD ME handoff (session-64: the FOUR-step chain + the
 * DRYRUN/commit honesty clauses; session-65.2: the PREFERENCE CONTRACT —
 * when the operator specified a name/symbol the agent uses them EXACTLY
 * with no further confirmation; when nothing was specified the agent MUST
 * stop, propose, explain, and wait — never proceed with unconfirmed
 * defaults). Pure — exported for the corpus/behavior test.
 */
export interface OnboardingPreference {
  username: string;
  symbol: string;
}

export function deriveOnboardingIdentity(pref: OnboardingPreference): { username: string; symbol: string; lauName: string; yueName: string; yueSymbol: string; specified: boolean } {
  const username = pref.username.trim();
  const symbol = pref.symbol.trim();
  const specified = username.length > 0 || symbol.length > 0;
  const user = username.length > 0 ? username : "DYSNOMIA";
  const sym = symbol.length > 0 ? symbol : user.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase() || "DYS";
  return {
    username: user,
    symbol: sym,
    lauName: `Dysnomia ${user}`,
    yueName: `${user} Vault`,
    yueSymbol: `${sym.slice(0, 8)}V`,
    specified,
  };
}

export function buildOnboardingHandoff(pref: OnboardingPreference): string {
  const id = deriveOnboardingIdentity(pref);
  const honesty =
    "DRYRUN first — I'll approve each send through the gate. State plainly whenever nothing has been sent yet (DRYRUNs are previews only), and after each committed send confirm what changed onchain.";
  if (id.specified) {
    return [
      `onboard me end to end: check my state first, then run the full chain — create my LAU, set my Username, open my YUE, and register me (CHOA.Play) so the world resolves my wallet to my LAU.`,
      `MY IDENTITY IS SPECIFIED — use these EXACTLY and do NOT ask for further confirmation (this is the confirmation): Username "${id.username}" (the handle the world sees on chat lines), LAU name "${id.lauName}", LAU symbol "${id.symbol}", YUE name "${id.yueName}", YUE symbol "${id.yueSymbol}". Proceed straight through: DRYRUN, propose the plan, execute.`,
      honesty,
    ].join(" ");
  }
  return [
    `onboard me end to end: check my state first, then create my LAU. NO identity preference was specified — you MUST STOP AND ASK: propose a name/symbol/username derived from my address, EXPLAIN what each is for (the LAU token name vs the Username the world sees on chat lines — ≤ 12 BYTES — vs the YUE account-vault), and WAIT for my explicit confirmation. NEVER proceed with unconfirmed defaults. Once I confirm, set my Username, open my YUE, and register me (CHOA.Play) so the world resolves my wallet to my LAU.`,
    honesty,
  ].join(" ");
}

function OnboardingWidget({ snapshot, wallet, onGoView }: WidgetRenderProps) {
  const agent = useAgent();
  const pending = usePendingLau(wallet.account);
  // session-73: census-resolved home counts too (pre-app/aged accounts)
  const home = useHomeVenueResolved(wallet.account as Address | null, (snapshot?.lau ?? pending?.lau ?? null) as Address | null);
  // session-65.2: the operator's preferred identity, specified BEFORE the
  // handoff — the derived LAU name/symbol ride the same fields
  const [prefName, setPrefName] = useState("");
  const [prefSymbol, setPrefSymbol] = useState("");
  const steps = onboardingSteps(wallet.account, snapshot, pending?.lau ?? null, home.venue !== null);
  // optional steps never block: the next CTA is the next REQUIRED step; the
  // optional home-QING step renders its own affordance once the chain is done
  const next = steps.find((s) => !s.done && !s.optional);
  const nextCta: { label: string; go: () => void } | null =
    next === undefined
      ? null
      : next.id === "wallet"
        ? { label: "CONNECT WALLET", go: () => onGoView("settings") }
        : next.id === "lau"
          ? { label: "CREATE LAU", go: () => onGoView("identity") }
          : next.id === "username"
            ? { label: "SET USERNAME", go: () => onGoView("identity") }
            : next.id === "yue"
              ? { label: "OPEN YUE", go: () => onGoView("identity") }
              : { label: "REGISTER", go: () => onGoView("identity") };
  const usernameProblem = prefName.trim().length > 0 ? usernameError(prefName) : null;
  const symbolProblem = prefSymbol.trim().length > 16 ? "symbol > 16 chars" : null;
  const prefProblem = usernameProblem ?? symbolProblem;
  const handoffReady = agent.keySource !== null && wallet.account !== null && !agent.busy && prefProblem === null;
  const lauOpen = steps.find((s) => s.id === "lau")!.done !== true; // preferences matter until the LAU exists
  if (next === undefined) {
    return (
      <div data-testid="widget-onboarding" className="onb-done">
        <p className="ok-text">chain complete — the ledger takes this bay.</p>
        {home === null ? (
          <p className="hint" data-testid="widget-onboarding-home">
            optional: wrap your LAU into your <strong>home QING</strong> (MAP.New — gas only, one venue per asset EVER,
            yours uniquely) — it unlocks the deed and a natural Beat target. one-way claim; ask the agent or use the MAP
            create card.
          </p>
        ) : (
          <p className="hint" data-testid="widget-onboarding-home">
            home QING <span className="mono">{home.venue}</span> — yours uniquely (the venue wraps your own LAU).
          </p>
        )}
      </div>
    );
  }
  return (
    <div data-testid="widget-onboarding">
      <p className="hint" data-testid="widget-onboarding-count">
        {steps.filter((s) => s.done && !s.optional).length}/{steps.filter((s) => !s.optional).length} complete
      </p>
      {pending !== null && snapshot?.lau == null && (
        <p className="hint" data-testid="widget-onboarding-pending">
          LAU <span className="mono">{pending.lau}</span> created — pending registration (CHOA.Play writes the wallet→LAU mapping the app discovers you by).
        </p>
      )}
      {/* session-65.2 (the owner's layout call): the controls live ABOVE the
          checklist — the tall checklist scrolls inside the bay and used to
          push the CTAs out of view */}
      {lauOpen && (
        <div className="onb-controls" data-testid="onboarding-controls">
          <div className="arg-row">
            <label htmlFor="onb-pref-name">preferred name (Username — {new Blob([prefName]).size}/12 bytes)</label>
            <input
              id="onb-pref-name"
              className="mono"
              spellCheck={false}
              placeholder="e.g. Nyx — leave empty to have the agent propose + ask"
              value={prefName}
              onChange={(e) => setPrefName(e.target.value)}
              data-testid="onb-pref-name"
            />
          </div>
          <div className="arg-row">
            <label htmlFor="onb-pref-symbol">LAU symbol (optional — derived from the name when empty)</label>
            <input
              id="onb-pref-symbol"
              className="mono"
              spellCheck={false}
              placeholder="e.g. NYX"
              value={prefSymbol}
              onChange={(e) => setPrefSymbol(e.target.value)}
              data-testid="onb-pref-symbol"
            />
          </div>
          {prefProblem !== null && (
            <p className="err-text" data-testid="onb-pref-problem">
              {prefProblem}
            </p>
          )}
          <p className="hint">
            {prefName.trim().length > 0 || prefSymbol.trim().length > 0
              ? "specified — the agent uses these exactly, no further confirmation."
              : "unspecified — the agent will always stop, propose, explain, and wait for your confirmation."}
          </p>
          <div className="studio-actions" data-testid="onboarding-ctas">
            {nextCta !== null && (
              <button className="btn" onClick={nextCta.go} data-testid={`onboarding-cta-${next.id}`}>
                {nextCta.label}
              </button>
            )}
            {agent.keySource === null ? (
              <button className="btn" onClick={() => onGoView("settings")} data-testid="onboarding-agent-settings">
                CONFIGURE THE AGENT CORE
              </button>
            ) : (
              <button
                className="btn btn-primary"
                disabled={!handoffReady}
                title={
                  wallet.account === null
                    ? "connect a wallet first"
                    : prefProblem !== null
                      ? prefProblem
                      : "hands the onboarding chain to the agent"
                }
                onClick={() => void agent.send(buildOnboardingHandoff({ username: prefName, symbol: prefSymbol }))}
                data-testid="onboarding-agent-handoff"
              >
                AGENT, ONBOARD ME
              </button>
            )}
          </div>
        </div>
      )}
      <ul className="gm-checklist" data-testid="onboarding-steps">
        {steps.map((s) => (
          <li key={s.id} className={s.done ? "gm-step done" : !s.optional && s.id === next.id ? "gm-step active" : "gm-step"} data-testid={`onboarding-step-${s.id}`}>
            <span className="mono">{s.done ? "[v]" : "[ ]"}</span> {s.label}
            <div className="hint onboarding-hint">{s.hint}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- yuan_ledger (the DISSOLVED snapshot's ledger, session-63) ----------

/**
 * session-64.1 (the owner's call): the POWER-TOKEN CONSTELLATION lives in
 * the LEDGER (the money bay), not the identity column — the MARKET
 * Power-tab reader reused, one anonymous batch; withheld rows render an
 * honest dash, never a silent zero.
 */
function ConstellationTable({ rpcUrl, wallet, snapshot }: { rpcUrl: string; wallet: WalletApi; snapshot: PlayerSnapshot | null }) {
  const power = usePowerTokens(rpcUrl, wallet.account, snapshot?.lau ?? null, snapshot?.yue ?? null);
  if (wallet.account === null) return null;
  return (
    <div className="passport-power" data-testid="widget-yuan-power">
      <p className="passport-row-label">
        CONSTELLATION <span className="hint">· Yuan per power token (w + 10·LAU + 40·YUE)</span>
      </p>
      {power.error !== null && <p className="err-text">power reads unavailable: {power.error.slice(0, 90)}</p>}
      {power.state !== null && (
        <table className="passport-ledger" data-testid="widget-yuan-power-table">
          <tbody>
            {power.state.rows.map((r) => (
              <tr key={r.key} title={`${r.key} — ${r.yuan !== null ? `wallet ${fmtAmt(r.balances.wallet)} · LAU ${fmtAmt(r.balances.lau)} · YUE ${fmtAmt(r.balances.yue)}` : "a leg failed — never silently zero"}`}>
                <th>{r.key}</th>
                <td className={`mono${r.yuan === null ? " dim" : ""}`}>{r.yuan !== null ? fmtAmt(r.yuan) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {power.state === null && power.error === null && <p className="hint">reading the constellation (one anonymous batch)…</p>}
    </div>
  );
}

function YuanLedgerWidget({ snapshot, chain, wallet }: WidgetRenderProps) {
  if (snapshot === null) {
    // connected-but-unreadable (dead RPC): the tri-table needs the
    // snapshot, but the constellation reads on its own — keep what answers
    return (
      <div data-testid="widget-yuan">
        <p className="hint">no player state — connect an account (SETTINGS → wallet) or ask the agent to run get_state.</p>
        <ConstellationTable rpcUrl={chain.url} wallet={wallet} snapshot={null} />
      </div>
    );
  }
  const b = snapshot.balances;
  return (
    <div data-testid="widget-yuan">
      <table className="passport-ledger" data-testid="widget-yuan-table">
        <thead>
          <tr>
            <th />
            <th>wallet</th>
            <th>LAU</th>
            <th>YUE</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>PLS</th>
            <td className="mono">{fmtAmt(b.pls.wallet)}</td>
            <td className="mono">{fmtAmt(b.pls.lau)}</td>
            <td className="mono">{fmtAmt(b.pls.yue)}</td>
          </tr>
          <tr>
            <th>Ⓐ</th>
            <td className="mono">{fmtAmt(b.affection.wallet)}</td>
            <td className="mono">{fmtAmt(b.affection.lau)}</td>
            <td className="mono">{fmtAmt(b.affection.yue)}</td>
          </tr>
          <tr>
            <th>CHOA</th>
            <td className="mono">{fmtAmt(b.choa.wallet)}</td>
            <td className="mono">{fmtAmt(b.choa.lau)}</td>
            <td className="mono">{fmtAmt(b.choa.yue)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th>Yuan</th>
            <td className="mono passport-yuan" colSpan={3}>
              {fmtAmt(snapshot.yuanChoa)} CHOA — wallet + 10×LAU + 40×YUE
            </td>
          </tr>
        </tfoot>
      </table>
      <ConstellationTable rpcUrl={chain.url} wallet={wallet} snapshot={snapshot} />
      <p className="hint">the full custody tri-table + the constellation — the identity column keeps soul data, this bay keeps the money.</p>
    </div>
  );
}

// ---------- venue ----------

function VenueWidget({ widget, chain, wallet, snapshot }: WidgetRenderProps) {
  const address = strProp(widget, "address") as Address | null;
  const live = useVenueState(chain.url, address, wallet.account, {
    lau: snapshot?.lau ?? null,
    yue: snapshot?.yue ?? null,
  });
  const [row, setRow] = useState<RenderRow | null>(null);
  useEffect(() => {
    if (address === null) return;
    let alive = true;
    loadRenderRows()
      .then((rows) => {
        if (!alive) return;
        setRow(rows.find((r) => r.a.toLowerCase() === address.toLowerCase()) ?? null);
      })
      .catch(() => {
        if (alive) setRow(null);
      });
    return () => {
      alive = false;
    };
  }, [address]);

  if (address === null) return <p className="hint">no venue address on this widget.</p>;
  return (
    <div data-testid="widget-venue">
      <dl className="kv">
        <dt>venue</dt>
        <dd className="mono">{row?.n?.length ? row.n : address}</dd>
        <dt>HECKE</dt>
        <dd className="mono">{row !== null ? `band ${row.band} · lon ${row.lon.toFixed(1)}° lat ${row.lat.toFixed(1)}°` : "—"}</dd>
        <dt>waat</dt>
        <dd className="mono waat">{live.state?.waat?.toString() ?? row?.w ?? "—"}</dd>
        <dt>Entropy</dt>
        <dd className="mono">{live.state?.entropy?.toString() ?? "—"}</dd>
        <dt>supply</dt>
        <dd className="mono">{live.state?.totalSupply !== null && live.state !== null && live.state.totalSupply !== undefined ? fmtAmt(live.state.totalSupply) : "—"}</dd>
        {wallet.account !== null && (
          <>
            <dt>admitted</dt>
            <dd className={live.state?.admitted === true ? "ok-text" : ""}>{live.state === null ? "—" : live.state.admitted === null ? "—" : live.state.admitted ? "yes" : "no"}</dd>
          </>
        )}
        {snapshot?.yue != null && (
          <>
            <dt>your bars (YUE.Bar)</dt>
            <dd className="mono">
              {live.state !== null && live.state.myHypobar !== null
                ? `hyp ${live.state.myHypobar.toString()} · epi ${live.state.myEpibar?.toString() ?? "—"}`
                : "—"}
            </dd>
          </>
        )}
        {live.state !== null && live.state.gwat !== null && (
          <>
            <dt>GWAT escrow</dt>
            <dd className={live.state.gwat ? "err-text" : "ok-text"}>{live.state.gwat ? "locked (permanent exhibit)" : "withdrawable"}</dd>
            {wallet.account !== null && live.state.myOwner === true && (
              <>
                <dt>your role</dt>
                <dd className="ok-text">owner{live.state.myBouncer === true ? " + bouncer" : ""}</dd>
              </>
            )}
            {wallet.account !== null && live.state.assetIsUserToken && (
              <>
                <dt>deed (DO.Take)</dt>
                <dd className="ok-text">wraps your account token — takeable</dd>
              </>
            )}
          </>
        )}
      </dl>
      {live.error && <p className="err-text">live reads unavailable: {live.error}</p>}
      <p className="hint">read-only — Join/Chat/Beat/Settle/Take + the management drawer and venue creation live on the MAP venue panel through the gate.</p>
    </div>
  );
}

// ---------- profile ----------

function ProfileWidget({ widget, chain }: WidgetRenderProps) {
  const address = strProp(widget, "address") as Address | null;
  const p = useEntityProfile(chain.url, address);
  if (address === null) return <p className="hint">no entity address on this widget.</p>;
  return (
    <div data-testid="widget-profile">
      {p.error && <p className="err-text">profile read failed: {p.error}</p>}
      {!p.error && p.state === null && <p className="hint">reading (one anonymous batch)…</p>}
      {p.state !== null && (
        <dl className="kv">
          <dt>entity</dt>
          <dd className="mono">{p.state.entity}</dd>
          <dt>name</dt>
          <dd className="mono">{p.state.name ?? "—"}</dd>
          <dt>Username</dt>
          <dd className="mono">{p.state.username ?? "unset"}</dd>
          <dt>PLS</dt>
          <dd className="mono">{fmtAmt(p.state.pls)}</dd>
          <dt>Ⓐ</dt>
          <dd className="mono">{fmtAmt(p.state.affection)}</dd>
          <dt>CHOA</dt>
          <dd className="mono">{fmtAmt(p.state.choa)}</dd>
        </dl>
      )}
    </div>
  );
}

// ---------- beat_sim ----------

function BeatSimWidget({ widget }: WidgetRenderProps) {
  const env = widget.props["envelope"];
  const e = typeof env === "object" && env !== null ? (env as Record<string, unknown>) : {};
  const simOk = e["simOk"];
  const gas = typeof e["simGas"] === "string" ? BigInt(e["simGas"]) : null;
  const waat = strProp(widget, "waat");
  const pct = gas !== null ? Math.min(100, Number((gas * 100n) / BEAT_GAS_LIMIT)) : null;
  return (
    <div data-testid="widget-beat-sim">
      <dl className="kv">
        <dt>call</dt>
        <dd className="mono">META.Beat{waat !== null ? `(${waat})` : ""}</dd>
        <dt>mode</dt>
        <dd className="mono">{String(e["mode"] ?? "DRYRUN")}</dd>
        <dt>DRYRUN</dt>
        <dd>{simOk === true ? <span className="ok-text">ok</span> : simOk === false ? <span className="err-text">reverted</span> : "—"}</dd>
        {typeof e["simErrorDecoded"] === "string" && e["simErrorDecoded"].length > 0 && (
          <>
            <dt>revert</dt>
            <dd className="err-text mono">{e["simErrorDecoded"]}</dd>
          </>
        )}
        <dt>gas</dt>
        <dd className="mono">{gas !== null ? `${gas.toString()} (median ${BEAT_GAS_MEDIAN.toString()} · limit ${BEAT_GAS_LIMIT.toString()})` : "—"}</dd>
        <dt>risk</dt>
        <dd className="mono">{String(e["risk"] ?? "—")}</dd>
      </dl>
      {pct !== null && (
        <div className="gm-bar">
          <div className="gm-bar-track">
            <div className={pct > 80 ? "gm-bar-fill warn" : "gm-bar-fill"} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      <p className="hint">previews are pure — the shared Entropy head means committed results differ.</p>
    </div>
  );
}

// ---------- chat_monitor ----------

interface MonitorLine {
  id: string;
  block: number;
  soul: bigint;
  aura: bigint;
  handle: string | null;
  body: string;
}

/**
 * The deck chat monitor (session-44; the 71.2 polish round): compact but
 * wearing the CHAT module's IRC idiom — dim block, soul-colored handle,
 * inert body — with the refresh control integrated into the head row
 * (spins while a read is in flight). Stays COMPACT by the owner's 71 call;
 * the rich layout is the CHAT module's.
 */
function ChatMonitorWidget({ widget, chain }: WidgetRenderProps) {
  const address = strProp(widget, "address");
  const channelKind = widget.props["channel"] === "venue" && address !== null ? "venue" : "world";
  const [lines, setLines] = useState<MonitorLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    const channel: ChatChannel = channelKind === "venue" && address !== null ? venueChannel(address as Address) : worldChannel();
    const client = makeClient(chain.url);
    const refresh = () => {
      setBusy(true);
      client
        .getBlockNumber()
        // the LATEST-lines read (69.3): backward from head — the forward
        // tail walk burned its page budget on empty history and never
        // reached the lines near head (the owner's video find)
        .then((head) => readChatLatest(client, channel, head, { windowBlocks: 50_000, maxPages: 8, want: 8 }))
        .then((tail: LatestTail) => {
          if (!alive) return;
          setLines(
            tail.lines.map((l) => {
              const parsed = parseLine(l.line);
              return { id: l.id, block: l.block, soul: l.soul, aura: l.aura, handle: l.username ?? parsed.handle, body: l.username !== null ? l.line : parsed.body };
            })
          );
          setError(null);
        })
        .catch((e: unknown) => {
          if (alive) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    };
    refreshRef.current = refresh;
    setLines(null);
    setError(null);
    refresh();
    // session-69.2 (the owner's video ask): the "live tail" actually polls —
    // a landed line (chat send, snipe) shows up on the deck within seconds
    const timer = window.setInterval(refresh, 12_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [chain.url, channelKind, address]);

  return (
    <div data-testid="widget-chat-monitor">
      <div className="deck-chat-head">
        <span className="mono deck-chat-channel" data-testid="chat-monitor-channel">
          {channelKind === "world" ? "# THE VOID · world" : `# ${address}`}
        </span>
        <span className="hint mono">12s</span>
        <button
          className="deck-refresh"
          disabled={busy}
          onClick={() => refreshRef.current()}
          title="refresh — the tail also polls every 12s"
          aria-label="refresh chat tail"
          data-testid="chat-monitor-refresh"
        >
          <span className={busy ? "spin" : ""}>⟳</span>
        </button>
      </div>
      {error && <p className="err-text">tail unavailable: {error.slice(0, 100)}</p>}
      {!error && lines === null && <p className="hint">reading tail…</p>}
      {lines !== null && lines.length === 0 && <p className="hint">no lines in the window — the channel is quiet</p>}
      {lines !== null && lines.length > 0 && (
        <ul className="deck-chat-lines">
          {lines.map((l) => (
            <li key={l.id} title={`Soul ${l.soul.toString()} · Aura ${l.aura.toString()}`}>
              <span className="mono hint">[{l.block.toLocaleString()}]</span>{" "}
              <span className="mono" style={{ color: l.handle === null ? undefined : handleColor(l.soul) }}>
                {(l.handle ?? "anon").slice(0, 18)}
              </span>{" "}
              <span className="deck-chat-body" data-testid="deck-chat-body">
                {renderChatBody(l.body)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="hint deck-chat-fence">untrusted onchain content — rendered inert (§7.4)</p>
    </div>
  );
}

// ---------- kb_excerpt ----------

function KbExcerptWidget({ widget }: WidgetRenderProps) {
  const query = strProp(widget, "query") ?? "";
  const carried = widget.props["result"];
  const [hits, setHits] = useState<Array<{ source: string; file: string; section: string; excerpt: string }> | null>(() => {
    if (typeof carried === "object" && carried !== null && Array.isArray((carried as Record<string, unknown>)["hits"])) {
      return ((carried as Record<string, unknown>)["hits"] as Array<Record<string, unknown>>).map((h) => ({
        source: String(h["source"] ?? "?"),
        file: String(h["file"] ?? "?"),
        section: String(h["section"] ?? h["file"] ?? "?"),
        excerpt: String(h["excerpt"] ?? ""),
      }));
    }
    return null;
  });
  useEffect(() => {
    if (hits !== null || query.length === 0) return;
    setHits(
      searchKb(query, 3).map((h) => ({ source: h.source, file: h.file, section: h.title, excerpt: h.excerpt.slice(0, 360) }))
    );
  }, [query, hits]);
  return (
    <div data-testid="widget-kb">
      <p className="hint">
        query: <span className="mono">{query.length > 0 ? query : "(from tool result)"}</span>
      </p>
      {hits === null && <p className="hint">searching…</p>}
      {hits !== null && (
        <ul className="deck-kb-hits">
          {hits.map((h, i) => (
            <li key={i}>
              <span className="mono">{h.source}/{h.file}</span> — {h.section}
              <pre className="mono deck-kb-excerpt">{h.excerpt}</pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- task_graph ----------

/** soft refusals (ok=true + an error payload) are failures in truth — the
 *  session-64 pairing law: one row per call, marked honestly by its result */
function taskFailed(m: { ok?: boolean; toolResult?: Record<string, unknown> }): boolean {
  if (m.ok === false) return true;
  const err = m.toolResult?.["error"];
  return typeof err === "string" && err.length > 0;
}

function TaskGraphWidget(_props: WidgetRenderProps) {
  const agent = useAgent();
  // session-64: fold calls+results by toolCallId — ONE row per call (the
  // old widget rendered the call AND its result as separate rows)
  const steps = useMemo(() => {
    const rows: Array<{ id: number; name: string; done: boolean; failed: boolean }> = [];
    const byCall = new Map<string, number>();
    for (const m of agent.messages) {
      if (m.kind === "tool-call") {
        byCall.set(m.toolCallId ?? `x${m.id}`, rows.length);
        rows.push({ id: m.id, name: m.toolName ?? "?", done: false, failed: false });
      } else if (m.kind === "tool-result") {
        const idx = byCall.get(m.toolCallId ?? `y${m.id}`);
        if (idx !== undefined) {
          rows[idx]!.done = true;
          rows[idx]!.failed = taskFailed(m);
        } else {
          rows.push({ id: m.id, name: m.toolName ?? "?", done: true, failed: taskFailed(m) });
        }
      }
    }
    return rows;
  }, [agent.messages]);
  const intent = useMemo(() => {
    const texts = agent.messages.filter((m) => m.kind === "assistant" && m.text !== null);
    const last = texts[texts.length - 1];
    if (last === undefined) return null;
    const m = /^▸ plan:\s*(.+)$/im.exec((last.text ?? "").trim());
    return m !== null ? m[1]! : null;
  }, [agent.messages]);
  return (
    <div data-testid="widget-taskgraph">
      {intent !== null && (
        <p className="deck-intent" data-testid="widget-taskgraph-intent">
          <span className="apane-intent-label">INTENT</span> {intent}
        </p>
      )}
      {steps.length === 0 && <p className="hint">no steps yet — the current run's tool calls land here as a checklist.</p>}
      <ul className="gm-checklist" data-testid="taskgraph-steps">
        {steps.map((step) => (
          <li key={step.id} className={step.done ? (step.failed ? "gm-step err" : "gm-step done") : "gm-step active"}>
            <span className="mono">{step.done ? (step.failed ? "[x]" : "[v]") : "[ ]"}</span> {step.name}
          </li>
        ))}
      </ul>
      {agent.lastRun !== null && (
        <p className="hint">
          last run: {agent.lastRun.status} · {agent.lastRun.steps} model turns · {agent.lastRun.tokens} tokens
        </p>
      )}
    </div>
  );
}

// ---------- map_focus ----------

function MapFocusWidget({ chain }: WidgetRenderProps) {
  const { current, setCurrent } = useCurrentVenue();
  const [rows, setRows] = useState<RenderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cardHiddenFor, setCardHiddenFor] = useState<string | null>(null);
  const live = useLiveRenderRow(chain.url, current, rows);
  const sync = useSyncState();
  useEffect(() => {
    let alive = true;
    loadRenderRows()
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  // the live-computed row merges in — a venue created after the last seed
  // regen (the home QING case) draws its TRUE marker on the deck map too;
  // session-70: the sync engine's caught-up rows join the same canvas
  const canvasRows = useMemo(() => {
    if (rows === null) return null;
    let out = mergeByAddress(rows, sync.qingRows);
    const row = live.row;
    if (row !== null && live.source === "live" && !out.some((r) => r.a === row.a)) {
      out = [...out, row];
    }
    return out;
  }, [rows, live.row, live.source, sync.qingRows]);
  return (
    <div data-testid="widget-map" className="deck-map">
      {error && <p className="err-text">{error}</p>}
      {rows === null && !error && <p className="hint">loading the render seed…</p>}
      {canvasRows !== null && (
        <div className="deck-map-canvas">
          <AtlasCanvas
            rows={canvasRows}
            selectedAddr={current !== null ? current.a.toLowerCase() : null}
            onSelect={(row) => {
              setCurrent(renderRowAsVenueRow(row));
              setCardHiddenFor(null);
            }}
            compact
          />
          {/* session-67: the agent-driven venue card — focus_map drives the
              same app-global selection, so the agent's map focus opens this
              quick overview on the deck; the affordance surfaces the venue
              bay (the one-venue law) */}
          {current !== null && cardHiddenFor !== current.a.toLowerCase() && (
            <VenueHudCard
              venue={current}
              render={live.row}
              source={live.source}
              error={live.error}
              variant="deck"
              onSurfaceVenue={() => {
                surfaceWidget({ kind: "venue", props: { address: current.a }, origin: "user" });
              }}
              onClose={() => setCardHiddenFor(current.a.toLowerCase())}
            />
          )}
        </div>
      )}
      <p className="hint">
        bound to the app-global venue store{current !== null ? ` — selected ${current.s}` : ""}; MAP follows the same selection.
      </p>
    </div>
  );
}

// ---------- plan (the L1 plan envelope — approve once, watch it run) ----------

const PLAN_STATUSES: Record<Plan["status"], string> = {
  proposed: "AWAITING APPROVAL",
  approved: "APPROVED",
  running: "RUNNING",
  done: "DONE",
  stopped: "STOPPED — L0",
  rejected: "REJECTED",
};

function stepMark(s: PlanStep): string {
  if (s.status === "ok") return "[v]";
  if (s.status === "err") return "[x]";
  if (s.status === "running") return "[~]";
  if (s.status === "skipped") return "[-]";
  return "[ ]";
}

function PlanWidget(_props: WidgetRenderProps): ReactNode {
  const agent = useAgent();
  // subscribe live: the store mutates through the runner, not through props
  const plan = usePlan();
  if (plan === null) {
    return (
      <p className="hint" data-testid="widget-plan-idle">
        no plan — the agent proposes one via propose_plan; approving it executes the checklist here.
      </p>
    );
  }
  const sends = plan.steps.filter((s) => s.sends).length;
  const terminal = plan.status === "done" || plan.status === "stopped" || plan.status === "rejected";
  return (
    <div data-testid="widget-plan" data-plan-status={plan.status}>
      <dl className="kv">
        <dt>goal</dt>
        <dd className="mono">{plan.goal}</dd>
        <dt>state</dt>
        <dd className={`mono ${plan.status === "stopped" || plan.status === "rejected" ? "err-text" : plan.status === "done" ? "ok-text" : ""}`} data-testid="widget-plan-status">
          {PLAN_STATUSES[plan.status]}
        </dd>
        <dt>steps</dt>
        <dd className="mono">
          {plan.steps.length} · {sends} SEND{plan.status === "running" ? ` · ${plan.steps.filter((s) => s.status === "ok").length} ok` : ""}
        </dd>
      </dl>
      <ul className="gm-checklist" data-testid="widget-plan-steps">
        {plan.steps.map((s, i) => (
          <li key={s.id} className={s.status === "ok" ? "gm-step done" : s.status === "err" ? "gm-step err" : s.status === "running" ? "gm-step active" : "gm-step"}>
            <span className="mono">{stepMark(s)}</span>{" "}
            <span className="mono">
              {i + 1}. {s.tool}
              {s.sends ? <span className="plan-send-badge">SEND</span> : null}
            </span>
            {s.note.length > 0 && <span className="hint"> — {s.note}</span>}
            {s.error !== null && <div className="err-text mono plan-step-err">{s.error.slice(0, 200)}</div>}
          </li>
        ))}
      </ul>
      {plan.status === "proposed" && (
        <div className="studio-actions" data-testid="widget-plan-decide">
          <button className="btn btn-primary" onClick={() => void agent.runPlan(plan.id)} data-testid="widget-plan-approve">
            APPROVE PLAN
          </button>
          <button className="btn" onClick={() => rejectPlan(plan.id)} data-testid="widget-plan-reject">
            REJECT
          </button>
        </div>
      )}
      {plan.status === "running" && (
        <div className="studio-actions">
          <button className="apane-stop" onClick={agent.stopActivePlan} data-testid="widget-plan-stop">
            STOP
          </button>
        </div>
      )}
      {plan.status === "stopped" && (
        <p className="err-text" data-testid="widget-plan-stopped">
          stopped — {plan.stopReason ?? "stop-condition"} · rolled back to L0 (one action per approval)
        </p>
      )}
      {plan.status === "done" && <p className="ok-text">all steps ok — plan complete</p>}
      {plan.status === "rejected" && <p className="hint">rejected — nothing executed; the agent stays at L0</p>}
      {terminal && (
        <div className="studio-actions">
          <button
            className="btn"
            data-testid="widget-plan-export"
            onClick={() => {
              const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), plan }, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `dys-plan-${plan.id}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            export plan
          </button>
        </div>
      )}
      {sends > 0 && plan.status === "proposed" && (
        <p className="hint">SEND steps still show the per-tx approval card (wallet mode A/B) — approving this plan approves the checklist, not the transactions.</p>
      )}
    </div>
  );
}

// ---------- the registry ----------

const BODIES: Record<string, (p: WidgetRenderProps) => ReactNode> = {
  onboarding: OnboardingWidget,
  yuan_ledger: YuanLedgerWidget,
  venue: VenueWidget,
  profile: ProfileWidget,
  beat_sim: BeatSimWidget,
  chat_monitor: ChatMonitorWidget,
  kb_excerpt: KbExcerptWidget,
  task_graph: TaskGraphWidget,
  map_focus: MapFocusWidget,
  plan: PlanWidget,
};

export function WidgetBody(props: WidgetRenderProps): ReactNode {
  const body = BODIES[props.widget.kind];
  // a REAL element (never a direct function call): bay content churns by
  // kind, and directly-invoked components would share one fiber — their
  // hooks collide and React dies reading a null effect inst (the 63 find)
  if (body === undefined) return <p className="hint">unknown widget kind.</p>;
  return createElement(body, { ...props, key: props.widget.kind });
}
