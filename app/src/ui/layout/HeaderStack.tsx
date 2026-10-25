import type { ChainState } from "@/chain/useChainState";
import type { WalletApi } from "@/wallet/WalletContext";
import type { PlayerSnapshot } from "@/chain/identity";
import { fmtAmt } from "@/chain/identity";
import { useVessel } from "@/state/vessel";
import { setSyncRunning, useSyncState } from "@/chain/sync";
import { ReplayStrip } from "@/ui/layout/ReplayStrip";

/**
 * The predecessor's 3-tier header (chrome parity, session-42):
 *  1. hardware strip — kernel/mem-style telemetry with real values; the
 *     SLIM REPLAY strip rides its spare space while a replay is armed
 *     (session-63 — wide viewports have room)
 *  2. ATROPA-999 / RESEARCH_VESSEL main header — SYNC · FUEL · SOUL ·
 *     CREDITS + the AI_CORE / LOGS pane toggles
 *  3. the MODULE tab bar (NavRail) lives directly under this in the shell
 *
 * Session-60 (DESIGN.md amendment): the brand is the FLEET VESSEL — the
 * default callsign stays ATROPA-999 / RESEARCH_VESSEL; a sim/demo-scoped
 * override (state/vessel.ts) swaps callsign + role + accent, never on a
 * live RPC.
 */

const BOOT = new Date().toLocaleTimeString();

export function HardwareStrip({ chain }: { chain: ChainState; isCompact?: boolean }) {
  const online = chain.error === null;
  return (
    <div className="hwstrip" data-testid="hwstrip">
      <div className="group">
        <span>KERNEL: ng-0.2.0</span>
        <span>MEM: OK</span>
        <span data-testid="chainid">CHAIN: {chain.chainId ?? "?"}</span>
      </div>
      <div className="group">
        <span
          data-testid="rpc"
          title="active RPC endpoint"
        >
          RPC: {chain.host}
          {chain.source === "query" ? " (?rpc= dev override)" : chain.source === "settings" ? " (settings)" : ""}
        </span>
        <span>UPTIME: {BOOT}</span>
        <span className={online ? "net-online" : "net-offline"} data-testid="hw-net">
          NET: {online ? "ONLINE" : "OFFLINE"}
        </span>
        <span
          className={chain.sim ? "" : "net-online"}
          style={chain.sim ? { color: "var(--cyan)" } : undefined}
          data-testid="livesim"
          title={chain.sim ? "active RPC is a loopback local fork — simulation mode" : "live PulseChain (chain id 369)"}
        >
          {chain.sim ? "SIM" : "LIVE"}
        </span>
      </div>
      <ReplayStrip />
    </div>
  );
}

export function MainHeader({
  chain,
  wallet,
  snapshot,
  agentOpen,
  logsOpen,
  onToggleAgent,
  onToggleLogs,
  onConnect,
}: {
  chain: ChainState;
  wallet: WalletApi;
  snapshot: PlayerSnapshot | null;
  agentOpen: boolean;
  logsOpen: boolean;
  onToggleAgent: () => void;
  onToggleLogs: () => void;
  onConnect: () => void;
}) {
  const soul = snapshot?.username ?? (snapshot?.lauSymbol ? `${snapshot.lauSymbol}` : null);
  const account = wallet.account;
  const pls = snapshot !== null ? fmtAmt(snapshot.balances.pls.wallet) : account !== null ? "?" : "0";
  const vessel = useVessel();
  const themed = vessel.id !== "atropa";
  const sync = useSyncState();
  // the global sync engine (session-70): one control, the whole corpus's
  // staleness story — click pauses/resumes the catch-up walks
  const feedErr = sync.chat.error !== null || sync.qing.error !== null;
  const through = Math.min(
    sync.chat.cursor > 0 ? sync.chat.cursor : Number.POSITIVE_INFINITY,
    sync.qing.cursor > 0 ? sync.qing.cursor : Number.POSITIVE_INFINITY
  );
  const syncLabel = !sync.running
    ? "PAUSED"
    : sync.chat.busy || sync.qing.busy
      ? "SYNCING…"
      : through === Number.POSITIVE_INFINITY
        ? feedErr
          ? "ERROR"
          : "…"
        : `→ ${through.toLocaleString()}`;
  const syncTitle = [
    `global sync engine — world chat through ${sync.chat.cursor.toLocaleString()}${sync.chat.error ? ` (error: ${sync.chat.error})` : ""}`,
    `QING census through ${sync.qing.cursor.toLocaleString()} · +${sync.qingRows.length} live venues${sync.qingPending > 0 ? ` · ${sync.qingPending} resolving` : ""}${sync.qing.error ? ` (error: ${sync.qing.error})` : ""}`,
    sync.running ? "click to PAUSE (per-module refreshes keep working)" : "click to RESUME catch-up",
  ].join("\n");
  return (
    <header className="mhead" data-testid="mhead">
      <div
        className="brand"
        title={themed ? "fleet vessel override (sim/demo-scoped) — amber + ATROPA-999 return on a live RPC" : "the research vessel, unchanged"}
      >
        <h1 data-testid="vessel-callsign">{vessel.callsign}</h1>
        <span className="sub" data-testid="vessel-role">
          {vessel.role}
        </span>
      </div>

      <div className="stats">
        <div className="stat optional" title="chain head">
          <span className="lbl">sync</span>
          <span className="val" data-testid="head">
            #{chain.blockNumber?.toString(10) ?? "?"}
          </span>
        </div>
        <div className="stat optional" title="gas price">
          <span className="lbl">fuel</span>
          <span className="val">{chain.gasPriceGwei ?? "?"} GW</span>
        </div>
        <div className="stat" title={account ?? "no account"}>
          <span className="lbl">soul</span>
          {account !== null ? (
            <span className={soul ? "val" : "val dim"} data-testid="wallet-account" title={account}>
              {soul ?? `${account.slice(0, 10)}…`}
            </span>
          ) : (
            <button className="val connect" onClick={onConnect} data-testid="mhead-connect">
              [ CONNECT ]
            </button>
          )}
          {wallet.connected && wallet.chainIdA !== null && wallet.chainIdA !== 369 && (
            <span className="val" style={{ color: "var(--red)", fontSize: "0.6rem" }} data-testid="wallet-chain">
              wallet on {wallet.chainIdA}
            </span>
          )}
        </div>
        <div className="stat optional" title="wallet PLS">
          <span className="lbl">credits</span>
          <span className="val">{pls} PLS</span>
        </div>
        <div className="stat optional" title="key mode (A browser wallet · B key · C yolo)">
          <span className="lbl">mode</span>
          <span
            className="val"
            style={wallet.yolo ? { color: "var(--red)" } : undefined}
            data-testid="wallet-mode"
          >
            {wallet.yolo ? "YOLO" : `MODE ${wallet.mode}`}
          </span>
        </div>
        <div className="stat optional" title={syncTitle}>
          <span className="lbl">data</span>
          <button
            className={`val syncbtn${!sync.running ? " dim" : ""}`}
            style={feedErr && sync.running ? { color: "var(--red)" } : undefined}
            onClick={() => void setSyncRunning(!sync.running)}
            data-testid="sync-engine-chip"
          >
            {syncLabel}
          </button>
        </div>
        <div className="toggles">
          <button
            className={agentOpen ? "htoggle on-agent" : "htoggle"}
            onClick={onToggleAgent}
            data-testid="toggle-agent"
          >
            AI_CORE
          </button>
          <button
            className={logsOpen ? "htoggle on-logs" : "htoggle"}
            onClick={onToggleLogs}
            data-testid="toggle-logs"
          >
            LOGS
          </button>
        </div>
      </div>
    </header>
  );
}
