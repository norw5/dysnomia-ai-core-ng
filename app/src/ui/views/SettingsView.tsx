import { useMemo, useState } from "react";
import { parseEther } from "viem";
import { EXPLORER_BASE, PERIMETER } from "@config/addresses";
import { isLocalForkRpc, readSettingsRpc, rpcHost, writeSettingsRpc } from "@/chain/rpc";
import { simLayerActive, simLayerConfig } from "@/chain/simMode";
import { anvilCommand, SUGGESTED_PIN } from "@/chain/simBootstrap";
import { useSimOverlay } from "@/state/simOverlay";
import { SimBootstrapPanel } from "@/ui/sim/SimBootstrapPanel";
import type { ChainState } from "@/chain/useChainState";
import { useGate } from "@/chain/GateContext";
import { useWallet } from "@/wallet/WalletContext";
import { DEFAULT_AGENT_SETTINGS, useAgent } from "@/agent/store";
import { kickSync, setSyncRunning, wipeSyncCache, useSyncState } from "@/chain/sync";
import { DEFAULT_VESSEL_ID, FLEET_VESSELS, setVesselChoice, useVessel, vesselChoice, vesselOverrideAllowed } from "@/state/vessel";
import { copyText } from "@/ui/clipboard";

const PIN_LABEL = SUGGESTED_PIN.toLocaleString();

export function SettingsView({ chain }: { chain: ChainState }) {
  const simEntryEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_SIM_MODE === "1";
  const [custom, setCustom] = useState<string>(() => readSettingsRpc() ?? "");
  const [copied, setCopied] = useState<string | null>(null);
  const vessel = useVessel();
  const storedVessel = vesselChoice();
  const rows = useMemo(
    () => Object.entries(PERIMETER).map(([name, address]) => ({ name, address })),
    []
  );
  const wallet = useWallet();
  const gate = useGate();
  const runtimeOverlay = useSimOverlay(chain.url);
  const simLayer = runtimeOverlay?.layer ?? simLayerConfig.layer;

  const copy = async (value: string) => {
    const ok = await copyText(value);
    if (!ok) {
      setCopied(null);
      return;
    }
    setCopied(value);
    window.setTimeout(() => setCopied(null), 1200);
  };

  return (
    <section className="view settings view-center" data-testid="view-settings">
      <h1>//system SETTINGS</h1>

      <WalletPanel />
      <PolicyPanel />

      <div className="panel">
        <h2>RPC</h2>
        <dl className="kv">
          <dt>active</dt>
          <dd data-testid="settings-rpc">
            {chain.url} ({chain.source})
            {isLocalForkRpc(chain.url) && <span className="chip chip-sim">SIM</span>}
          </dd>
          <dt>host</dt>
          <dd>{rpcHost(chain.url)}</dd>
          <dt>chain id</dt>
          <dd data-testid="settings-chainid">{chain.chainId ?? "?"}</dd>
          <dt>gate</dt>
          <dd data-testid="settings-gate">
            session sends {gate.counters.sessionTx} · day {gate.counters.dayTx} ·
            PLS-value {gate.counters.sessionValueWei.toString()} wei
          </dd>
        </dl>
        {simEntryEnabled ? (
          <form
            className="rpc-form"
            onSubmit={(e) => {
              e.preventDefault();
              writeSettingsRpc(custom.trim().length > 0 ? custom : null);
              window.location.reload();
            }}
          >
            <label htmlFor="custom-rpc">custom RPC (your own node or a local fork)</label>
            <input
              id="custom-rpc"
              type="url"
              spellCheck={false}
              placeholder="http://127.0.0.1:8545"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            <button type="submit">apply</button>
            <button
              type="button"
              onClick={() => {
                writeSettingsRpc(null);
                window.location.reload();
              }}
            >
              clear
            </button>
            <p className="hint">
              SIM is a <strong>loopback local fork</strong> (127.0.0.1 / localhost); every other
              endpoint — default, known, or your own real node — is LIVE and shows no SIM surfaces.
              The dev-only <code>?rpc=&lt;url&gt;</code> query override takes precedence.
            </p>
          </form>
        ) : (
          <p className="hint">custom RPC entry is disabled in this build</p>
        )}
      </div>

      <div className="panel">
        <h2>local fork recipe (SIM)</h2>
        <ol className="recipe">
          <li>
            check nothing squats the port, then start the pinned fork:
            <pre>
              <code>{anvilCommand(SUGGESTED_PIN)}</code>
            </pre>
          </li>
          <li>the fork reports chain id 369, so app checks pass unchanged</li>
          <li>
            point the app at it: dev override <code>?rpc=http://127.0.0.1:8545</code> or the custom
            RPC field above
          </li>
          <li>fund a fork-only player (or the connected wallet) in the SIM bootstrap panel below</li>
          <li>keep the pin a few thousand blocks below the laggard RPC head; record it in run logs</li>
        </ol>
        <p className="hint">
          recommended pin {PIN_LABEL}. the SIM bootstrap panel below deploys the never-deployed
          layer through THE gate and writes the runtime overlay (actual receipt addresses). LOCAL
          FORK ONLY — the deployer is an anvil impersonation of the LIVE deployer, not your wallet.
        </p>
      </div>

      <SimBootstrapPanel chain={chain} />

      {vesselOverrideAllowed(chain.url) && (
        <div className="panel" data-testid="vessel-panel">
          <h2>fleet vessel (SIM) — accent + callsign</h2>
          <p className="hint">
            the multi-agent demo substrate (session-60, DESIGN.md amendment): each agent explores
            Dysnomia as its own research vessel. the override is SIM/DEMO-SCOPED — amber +
            ATROPA-999 / RESEARCH_VESSEL are the shipped law and return the moment the app points
            at a live RPC (this panel itself disappears there). purple stays AI-core-only under
            every vessel. dev runs may also force one per-tab: <code>?vessel=&lt;id&gt;</code>.
          </p>
          <div className="vessel-list" role="radiogroup" aria-label="fleet vessel">
            {FLEET_VESSELS.map((v) => (
              <label key={v.id} className={`vessel-opt${vessel.id === v.id ? " active" : ""}`}>
                <input
                  type="radio"
                  name="dys-vessel"
                  checked={storedVessel === v.id || (v.id === DEFAULT_VESSEL_ID && storedVessel === null)}
                  onChange={() => setVesselChoice(v.id === DEFAULT_VESSEL_ID ? null : v.id, chain.url)}
                  data-testid={`vessel-opt-${v.id}`}
                />
                <span className="vessel-swatch" style={{ background: v.accent }} aria-hidden="true" />
                <span className="mono">{v.callsign}</span>
                <span className="hint">· {v.role}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <h2>perimeter (config/addresses.json — kb/deployed-semantics.md §1)</h2>
        <p className="hint">
          the LIVE deployed system. the never-deployed layer (WORLD/WAR/H₂O/VITUS/GWAT/ENCRYPT) is
          intentionally address-less here — its surfaces render only in SIM mode, from the overlay
          below.
        </p>
        {simLayerActive(chain.url) && (
          <div data-testid="sim-overlay" className="sim-overlay-block">
            <h3>
              SIM overlay{" "}
              <span className="chip chip-sim">
                {runtimeOverlay !== null
                  ? `runtime · ${runtimeOverlay.forkBlock !== null ? `block ${runtimeOverlay.forkBlock.toLocaleString()}` : "fork"}`
                  : `fixture · pin ${simLayerConfig.pin}`}
              </span>
            </h3>
            <p className="hint">
              {runtimeOverlay !== null
                ? "runtime overlay from the in-frontend bootstrap — the ACTUAL creation receipt addresses for this fork (localStorage, keyed by the active RPC)."
                : "harness set-3 fork fixtures (deterministic CREATE1 from the deployer EOA) — the fallback until a runtime deploy lands. A future LIVE deployment would carry NEW addresses; these never touch the perimeter above."}
            </p>
            <table className="perimeter" data-testid="sim-perimeter">
              <thead>
                <tr>
                  <th>contract</th>
                  <th>address</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {Object.entries(simLayer).map(([name, address]) => (
                  <tr key={name}>
                    <td className="name">{name}</td>
                    <td className="addr">
                      <button className="linkish" onClick={() => copy(address)} title="copy">
                        {copied === address ? "copied" : address}
                      </button>
                    </td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <table className="perimeter" data-testid="perimeter">
          <thead>
            <tr>
              <th>contract</th>
              <th>address</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="name">{r.name}</td>
                <td className="addr">
                  <button className="linkish" onClick={() => copy(r.address)} title="copy">
                    {copied === r.address ? "copied" : r.address}
                  </button>
                </td>
                <td>
                  <a
                    href={`${EXPLORER_BASE}${r.address}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="outlink"
                  >
                    ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AgentPanel />

      <SyncPanel />

      <div className="panel">
        <h2>data i/o</h2>
        <p className="hint">
          planned: import/export with untrusted tagging (IA-PLAN §9). current wallet mode:{" "}
          {wallet.mode}; stored key: {wallet.hasVault ? "yes" : "no"}.
        </p>
      </div>
    </section>
  );
}

/**
 * session-70: the global sync engine's operator surface — status, the
 * pause/resume (same control as the header DATA chip), and the cache wipe
 * (drops the persisted catch-up; the engine re-walks from the seed floors).
 */
function SyncPanel() {
  const sync = useSyncState();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const wipe = async () => {
    if (!armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 4000);
      return;
    }
    setArmed(false);
    setBusy(true);
    await wipeSyncCache();
    setBusy(false);
  };

  return (
    <div className="panel" data-testid="sync-panel">
      <h2>sync engine — corpus catch-up (session-70)</h2>
      <dl className="kv">
        <dt>engine</dt>
        <dd className="mono" data-testid="sync-panel-state">
          {sync.running ? "RUNNING" : "PAUSED"}
        </dd>
        <dt>world chat</dt>
        <dd className="mono">
          through {sync.chat.cursor.toLocaleString()} · {sync.chatLines.length.toLocaleString()} lines held
          {sync.chat.error !== null && <span className="err-text"> · {sync.chat.error}</span>}
        </dd>
        <dt>QING census</dt>
        <dd className="mono">
          through {sync.qing.cursor.toLocaleString()} · +{sync.qingRows.length} live venues
          {sync.qingPending > 0 && ` · ${sync.qingPending} resolving`}
          {sync.qing.error !== null && <span className="err-text"> · {sync.qing.error}</span>}
        </dd>
      </dl>
      <p className="hint">
        feeds walk ANONYMOUSLY from each seed's floor to head (chat LogEvent pages + MAP.NewQing
        logs); cursors + caught-up rows persist in IndexedDB, so catch-up is incremental across
        sessions. Live RPCs auto-sync; SIM/fork RPCs start PAUSED (resume is the click above or
        the header DATA chip). The LAU/SHIO/YUE censuses emit no onchain enumerator — they stay
        seed snapshots (honest as-of chips in DIRECTORY) until a seed regen.
      </p>
      <div className="studio-actions">
        <button className="btn" onClick={() => void setSyncRunning(!sync.running)} data-testid="sync-panel-toggle">
          {sync.running ? "pause engine" : "resume engine"}
        </button>
        <button className="btn" onClick={() => void kickSync()} data-testid="sync-panel-kick">
          sync now
        </button>
        <button className={`btn${armed ? " btn-primary" : ""}`} disabled={busy} onClick={() => void wipe()} data-testid="sync-panel-wipe">
          {armed ? "click again to confirm" : busy ? "clearing…" : "clear sync cache"}
        </button>
      </div>
    </div>
  );
}

function AgentPanel() {
  const agent = useAgent();
  const [key, setKey] = useState(agent.settings.apiKey ?? "");
  const [remember, setRemember] = useState(agent.settings.apiKey !== null);
  const [model, setModel] = useState(agent.settings.model);
  const [maxSteps, setMaxSteps] = useState(String(agent.settings.maxSteps));
  const [maxTokens, setMaxTokens] = useState(String(agent.settings.maxTokens));
  const [l2Failures, setL2Failures] = useState(String(agent.settings.maxConsecutiveToolFailures));
  const [l2Checkpoint, setL2Checkpoint] = useState(String(agent.settings.checkpointEverySteps));
  const [l2Tx, setL2Tx] = useState(String(agent.settings.maxAgentTxPerRun));
  const [faCycles, setFaCycles] = useState(String(agent.settings.fullAutoMaxCycles));
  const [faTokens, setFaTokens] = useState(String(agent.settings.fullAutoMaxTokens));
  const [faObjective, setFaObjective] = useState(agent.settings.fullAutoObjective);
  const [strategistModel, setStrategistModel] = useState(agent.settings.strategistModel);
  const [persona, setPersona] = useState(agent.persona);
  const [saved, setSaved] = useState(false);

  const save = () => {
    try {
      const knob = (v: string, d: number): number => {
        const n = Number.parseInt(v, 10);
        return Number.isFinite(n) && n >= 0 ? n : d;
      };
      agent.setSettings({
        ...agent.settings,
        apiKey: remember ? key.trim() : null,
        model: model.trim().length > 0 ? model.trim() : DEFAULT_AGENT_SETTINGS.model,
        maxSteps: knob(maxSteps, DEFAULT_AGENT_SETTINGS.maxSteps),
        maxTokens: Math.max(1000, Number.parseInt(maxTokens, 10) || DEFAULT_AGENT_SETTINGS.maxTokens),
        maxConsecutiveToolFailures: knob(l2Failures, DEFAULT_AGENT_SETTINGS.maxConsecutiveToolFailures),
        checkpointEverySteps: knob(l2Checkpoint, DEFAULT_AGENT_SETTINGS.checkpointEverySteps),
        maxAgentTxPerRun: knob(l2Tx, DEFAULT_AGENT_SETTINGS.maxAgentTxPerRun),
        fullAutoMaxCycles: Math.max(1, knob(faCycles, DEFAULT_AGENT_SETTINGS.fullAutoMaxCycles)),
        fullAutoMaxTokens: knob(faTokens, DEFAULT_AGENT_SETTINGS.fullAutoMaxTokens),
        fullAutoObjective: faObjective.trim(),
        strategistModel: strategistModel.trim(),
        chatToolsEnabled: agent.settings.chatToolsEnabled,
      });
      agent.setPersona(persona);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1200);
    } catch {
      /* invalid numbers — keep old settings */
    }
  };

  const modelIds = agent.modelList.map((m) => m.id);
  const modelKnown = modelIds.includes(agent.settings.model);

  return (
    <div className="panel" data-testid="agent-panel">
      <h2>agent — BYOK model core (IA-PLAN §7)</h2>

      <div className="arg-row">
        <label htmlFor="agent-key">OpenRouter API key (BYOK — runtime; dev runs may use app/.env)</label>
        <input
          id="agent-key"
          type="password"
          className="mono"
          spellCheck={false}
          placeholder="sk-or-…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          data-testid="agent-key-input"
        />
        <label className="check-row" htmlFor="agent-remember">
          <input id="agent-remember" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="agent-remember" />
          remember on this device (localStorage — never the journal, never exports, never git)
        </label>
        <p className="hint" data-testid="agent-key-source">
          active key source:{" "}
          {agent.keySource === null ? (
            <span className="err-text">none — the AI_CORE pane stays in its honest no-key state</span>
          ) : (
            <span className={agent.keySource === "dev-env" ? "warn-text" : "ok-text"}>
              {agent.keySource === "dev-env" ? "app/.env (dev/test channel — not shipped)" : "BYOK (this device)"}
            </span>
          )}
        </p>
      </div>

      <div className="arg-row">
        <label htmlFor="agent-model">model</label>
        <input
          id="agent-model"
          className="mono"
          spellCheck={false}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          list="agent-model-list"
          data-testid="agent-model-input"
        />
        <datalist id="agent-model-list">
          {modelIds.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        <div className="studio-actions">
          <button className="btn" onClick={() => void agent.refreshModelList()} data-testid="agent-models-refresh">
            fetch model list
          </button>
          <button className="btn" onClick={() => void agent.probeKey()} data-testid="agent-credits">
            check credits
          </button>
        </div>
        {agent.modelListError && <p className="err-text">model list: {agent.modelListError}</p>}
        {agent.modelList.length > 0 && (
          <p className="hint">
            {agent.modelList.length} models fetched{modelKnown ? "" : " — current model not in list (free-text is allowed)"}
          </p>
        )}
        {agent.keyInfo !== null && (
          <p className="hint" data-testid="agent-credits-line">
            key credits: usage {agent.keyInfo.usage ?? "?"}
            {agent.keyInfo.limit !== null ? ` / limit ${agent.keyInfo.limit}` : " (no hard limit reported)"} — the pane
            surfaces credit errors when OpenRouter reports 402.
          </p>
        )}
        {agent.keyInfoError !== null && <p className="hint">credit probe: {agent.keyInfoError}</p>}
      </div>

      <div className="policy-grid">
        <label htmlFor="agent-steps">max model turns / run (0 = no limit — a turn is one model call; tool calls don't count)</label>
        <input id="agent-steps" className="mono" value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)} data-testid="agent-steps" />
        <label htmlFor="agent-tokens">max model tokens / run</label>
        <input id="agent-tokens" className="mono" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} data-testid="agent-tokens" />
        <label htmlFor="agent-l2-failures">L2 · stop after N consecutive failed tool rounds (0 = off)</label>
        <input
          id="agent-l2-failures"
          className="mono"
          value={l2Failures}
          onChange={(e) => setL2Failures(e.target.value)}
          data-testid="agent-l2-failures"
        />
        <label htmlFor="agent-l2-checkpoint">L2 · checkpoint every N model turns (0 = off)</label>
        <input
          id="agent-l2-checkpoint"
          className="mono"
          value={l2Checkpoint}
          onChange={(e) => setL2Checkpoint(e.target.value)}
          data-testid="agent-l2-checkpoint"
        />
        <label htmlFor="agent-l2-tx">L2 · max gate sends per agent run (0 = off)</label>
        <input
          id="agent-l2-tx"
          className="mono"
          value={l2Tx}
          onChange={(e) => setL2Tx(e.target.value)}
          data-testid="agent-l2-tx"
        />
        <label htmlFor="agent-fa-cycles">FULL-AUTO · cycle backstop (completed cycles before disengage; ≥ 1)</label>
        <input
          id="agent-fa-cycles"
          className="mono"
          value={faCycles}
          onChange={(e) => setFaCycles(e.target.value)}
          data-testid="agent-fa-cycles"
        />
        <label htmlFor="agent-fa-tokens">FULL-AUTO · session token cap, cumulative while engaged (0 = off)</label>
        <input
          id="agent-fa-tokens"
          className="mono"
          value={faTokens}
          onChange={(e) => setFaTokens(e.target.value)}
          data-testid="agent-fa-tokens"
        />
        <label htmlFor="agent-strategist-model">
          STRATEGIST · model (blank = off even with the toggle; one bounded read-only call between full-auto cycles picks the next goal — its tokens count toward the session cap)
        </label>
        <input
          id="agent-strategist-model"
          className="mono"
          spellCheck={false}
          placeholder="a stronger model from your fetched list, e.g. deepseek/deepseek-v4-pro-0813"
          value={strategistModel}
          onChange={(e) => setStrategistModel(e.target.value)}
          data-testid="agent-strategist-model"
        />
        <label htmlFor="agent-fa-objective">FULL-AUTO · operator objective (the standing goal carried by every kickoff; blank = self-goaling)</label>
        <input
          id="agent-fa-objective"
          className="mono"
          spellCheck={false}
          value={faObjective}
          onChange={(e) => setFaObjective(e.target.value)}
          data-testid="agent-fa-objective"
        />
        <label htmlFor="agent-strategist">strategist layer (default OFF — the bounded between-cycles call above; kickoff self-goaling stays the fallback)</label>
        <input
          id="agent-strategist"
          type="checkbox"
          checked={agent.settings.strategistEnabled}
          onChange={(e) =>
            agent.setSettings({
              ...agent.settings,
              apiKey: remember ? key.trim() : null,
              strategistEnabled: e.target.checked,
            })
          }
          data-testid="agent-strategist"
        />
        <label htmlFor="agent-chat-tools">chat posting (send_chat · send_world_chat · the CHAT composer) — §7.4 opt-in, OFF by default</label>
        <input
          id="agent-chat-tools"
          type="checkbox"
          checked={agent.settings.chatToolsEnabled}
          onChange={(e) =>
            agent.setSettings({
              ...agent.settings,
              apiKey: remember ? key.trim() : null,
              chatToolsEnabled: e.target.checked,
            })
          }
          data-testid="agent-chat-tools"
        />
        <label htmlFor="agent-auto-plans">auto-approve PLANS in wallet mode C (default OFF — the human's one-gate on multi-step autonomy; sends inside a plan still pass THE gate)</label>
        <input
          id="agent-auto-plans"
          type="checkbox"
          checked={agent.settings.autoApprovePlans}
          onChange={(e) =>
            agent.setSettings({
              ...agent.settings,
              apiKey: remember ? key.trim() : null,
              autoApprovePlans: e.target.checked,
            })
          }
          data-testid="agent-auto-plans"
        />
        <label htmlFor="agent-reasoning">native reasoning for the current model (per-model opt-in, OFF by default)</label>
        <input
          id="agent-reasoning"
          type="checkbox"
          checked={agent.settings.reasoningModels.includes(agent.settings.model)}
          onChange={(e) => {
            const on = e.target.checked;
            const rest = agent.settings.reasoningModels.filter((m) => m !== agent.settings.model);
            agent.setSettings({
              ...agent.settings,
              apiKey: remember ? key.trim() : null,
              reasoningModels: on ? [...rest, agent.settings.model] : rest,
            });
          }}
          data-testid="agent-reasoning"
        />
        <label htmlFor="agent-streaming">stream responses for the current model (per-model opt-in, OFF by default — text renders live as it arrives; STOP mid-generation keeps the partial and the tokens produced are still burned)</label>
        <input
          id="agent-streaming"
          type="checkbox"
          checked={agent.settings.streamingModels.includes(agent.settings.model)}
          onChange={(e) => {
            const on = e.target.checked;
            const rest = agent.settings.streamingModels.filter((m) => m !== agent.settings.model);
            agent.setSettings({
              ...agent.settings,
              apiKey: remember ? key.trim() : null,
              streamingModels: on ? [...rest, agent.settings.model] : rest,
            });
          }}
          data-testid="agent-streaming"
        />
      </div>
      <p className="hint" data-testid="agent-streaming-note">
        streaming (§7.11) applies only to <span className="mono">{agent.settings.model}</span>: the request switches to
        the SSE path and the pane renders the answer as it arrives (one live row, frame-batched). billing is IDENTICAL
        to the non-streaming call — the toggle changes latency-to-text, never spend — and STOP mid-generation keeps
        the partial in the pane + history while the tokens already produced are still billed. Some models stream
        poorly; the non-streaming path stays the default until proven per model. The transcript, the runs ledger, and
        recordings capture the FINALIZED message only.
      </p>
      <p className="hint">
        native reasoning (§7.11 layer 2) applies only to{" "}
        <span className="mono">{agent.settings.model}</span>: the adapter sends reasoning:enabled and the pane renders
        the model's structured reasoning field in a dimed collapsible. reasoning tokens are BILLED and hidden from the
        answer — flash-class models may spend the whole budget on CoT and return EMPTY content (the live-verified
        failure; that is why it defaults off). announce-then-act (`▸ plan:` lines) works for every model and stays the
        default chain-of-thought surface.
      </p>
      <p className="hint">
        budget stops are honest: the run halts with a SYSTEM line and the SYS tab shows the meter.
        when send_chat is enabled, the agent can post PUBLIC PERMANENT chat through the gate —
        everything else stays read/DRYRUN by default.
      </p>
      <p className="hint" data-testid="agent-l2-note">
        L2 autonomy knobs (§7.8) are TIGHTEN-ONLY guards: repeated-failure stop, checkpoint cadence
        (a resumable pause — say "continue"), and the per-run send budget (every gate send attempt
        counts; the gate's own session/day policy caps still apply on top). No knob can bypass an
        approval card — plan approval never bypasses THE gate, and neither do these. The FULL-AUTO
        caps bound the LOOP (cycle backstop + cumulative session tokens while engaged) — they stop
        it earlier, never widen anything. The strategy layer (session-74) adds the operator
        objective — the standing goal carried by every kickoff (pane field, this panel, or an
        `objective:` whisper) — and the optional strategist: one bounded READ-ONLY call between
        cycles that picks the next goal; any strategist failure falls back to kickoff self-goaling.
      </p>
      <p className="hint" data-testid="agent-strategist-note">
        strategist model choice (the 75 live-fire lesson): the call's window is TIGHT — ≤ 6 model
        turns / 24k tokens total — and a chatty strong model can spend the WHOLE window on analysis
        and close without a `GOAL:` line (window 1 of the 75 live fire did exactly that; the honest
        fallback fired and the executor self-goaled). The prompt now demands the GOAL: line early,
        but prefer a model that decides fast over one that deliberates at length — the pick, not
        the reasoning, is the product.
      </p>

      <div className="arg-row">
        <label htmlFor="agent-persona">persona (injected AFTER the fixed core — core rules always win)</label>
        <textarea
          id="agent-persona"
          rows={3}
          spellCheck={false}
          placeholder="e.g. terse radio-operator tone; call me captain"
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          data-testid="agent-persona"
        />
      </div>

      <div className="studio-actions">
        <button className="btn btn-primary" onClick={save} data-testid="agent-save">
          save agent settings
        </button>
        {saved && <span className="ok-text">saved</span>}
      </div>
    </div>
  );
}

function WalletPanel() {
  const wallet = useWallet();
  const [priv, setPriv] = useState("");
  const [pass, setPass] = useState("");
  const [unlockPass, setUnlockPass] = useState("");
  const [yoloText, setYoloText] = useState("");
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="panel" data-testid="wallet-panel">
      <h2>wallet — key modes A/B/C (every send still passes the gate)</h2>
      <div className="mode-row">
        <button
          className={wallet.mode === "A" ? "btn mode active" : "btn mode"}
          onClick={() => wallet.setMode("A")}
          data-testid="mode-a"
        >
          A · browser wallet
        </button>
        <button
          className={wallet.mode !== "A" ? "btn mode active" : "btn mode"}
          onClick={() => wallet.setMode("B")}
          data-testid="mode-b"
        >
          B · key (memory / encrypted)
        </button>
        {wallet.yolo && (
          <span className="chip chip-yolo" data-testid="yolo-chip">
            C · YOLO ACTIVE
          </span>
        )}
      </div>
      <p className="hint">
        A: EIP-6963 injected wallet, every send prompts there — no key material in the app. B: key
        lives in memory (or passphrase-encrypted in IndexedDB, AES-GCM + PBKDF2) — per-action
        approval card. C: yolo — B without per-action approval, bounded only by the policy gate.
      </p>

      {wallet.mode === "A" && (
        <div className="wallet-a" data-testid="wallet-a">
          {wallet.connected ? (
            <dl className="kv">
              <dt>connected</dt>
              <dd>
                {wallet.connected.name} · chain {wallet.chainIdA ?? "?"}
              </dd>
              <dt>account</dt>
              <dd className="mono">{wallet.accountA}</dd>
              <dt />
              <dd>
                <button className="btn" onClick={wallet.disconnectA}>
                  disconnect
                </button>
              </dd>
            </dl>
          ) : (
            <>
              <p className="hint">discovered wallets (EIP-6963):</p>
              {wallet.providers.length === 0 && (
                <p className="hint">
                  none announcing — install one, or re-probe after it loads:{" "}
                  <button
                    className="btn"
                    onClick={() => {
                      window.dispatchEvent(new Event("eip6963:requestProvider"));
                    }}
                  >
                    re-probe
                  </button>
                </p>
              )}
              <ul className="provider-list" data-testid="provider-list">
                {wallet.providers.map((p) => (
                  <li key={p.info.rdns}>
                    <button className="btn" onClick={() => void wallet.connectProvider(p)} data-testid={`connect-${p.info.rdns}`}>
                      connect {p.info.name}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {wallet.walletError && <p className="err-text">{wallet.walletError}</p>}
        </div>
      )}

      {wallet.mode !== "A" && (
        <div className="wallet-b" data-testid="wallet-b">
          {wallet.yolo && (
            <div className="yolo-banner">
              YOLO: per-action approval is OFF — the policy gate still bounds sends.{" "}
              <button className="btn" onClick={wallet.exitYolo} data-testid="yolo-exit">
                exit yolo
              </button>
            </div>
          )}
          {wallet.unlocked && wallet.accountB ? (
            <dl className="kv">
              <dt>account</dt>
              <dd className="mono">{wallet.accountB}</dd>
              <dt>key</dt>
              <dd>{wallet.memoryOnly ? "memory only (dropped on lock/reload)" : "encrypted in IndexedDB"}</dd>
              <dt />
              <dd>
                <button className="btn" onClick={wallet.lock} data-testid="lock-key">
                  lock now
                </button>
                {wallet.hasVault && !wallet.memoryOnly && (
                  <button className="btn danger" onClick={() => void wallet.deleteVault()} data-testid="delete-vault">
                    delete stored key
                  </button>
                )}
              </dd>
              {!wallet.yolo && (
                <>
                  <dt>yolo (C)</dt>
                  <dd className="yolo-enter">
                    type DANGERS to disable per-action approval:{" "}
                    <input
                      className="mono"
                      value={yoloText}
                      onChange={(e) => setYoloText(e.target.value)}
                      data-testid="yolo-input"
                      aria-label="type DANGERS to enter yolo mode"
                    />
                    <button
                      className="btn danger"
                      disabled={yoloText !== "DANGERS"}
                      onClick={() => {
                        wallet.enterYolo(yoloText);
                        setYoloText("");
                      }}
                      data-testid="yolo-enter"
                    >
                      enter yolo
                    </button>
                  </dd>
                </>
              )}
            </dl>
          ) : (
            <>
              {wallet.hasVault && (
                <form
                  className="wallet-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setErr(null);
                    try {
                      await wallet.unlockVault(unlockPass);
                      setUnlockPass("");
                    } catch (e2) {
                      setErr(e2 instanceof Error ? e2.message : String(e2));
                    }
                  }}
                >
                  <label htmlFor="unlock-pass">
                    unlock stored key{wallet.vaultAddress ? ` · ${wallet.vaultAddress}` : ""}
                  </label>
                  <input
                    id="unlock-pass"
                    type="password"
                    className="mono"
                    value={unlockPass}
                    onChange={(e) => setUnlockPass(e.target.value)}
                    data-testid="unlock-pass"
                  />
                  <button className="btn" type="submit" data-testid="unlock-btn">
                    unlock
                  </button>
                </form>
              )}
              <form
                className="wallet-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setErr(null);
                  try {
                    await wallet.importKey(priv, pass.length > 0 ? pass : null);
                    setPriv("");
                    setPass("");
                  } catch (e2) {
                    setErr(e2 instanceof Error ? e2.message : String(e2));
                  }
                }}
              >
                <label htmlFor="import-priv">import key (0x… 64 hex — never leaves this browser)</label>
                <input
                  id="import-priv"
                  className="mono"
                  spellCheck={false}
                  autoComplete="off"
                  value={priv}
                  onChange={(e) => setPriv(e.target.value)}
                  data-testid="import-priv"
                />
                <label htmlFor="import-pass">
                  passphrase to encrypt at rest (min 8 chars; blank = keep in memory only)
                </label>
                <input
                  id="import-pass"
                  type="password"
                  className="mono"
                  autoComplete="new-password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  data-testid="import-pass"
                />
                <button className="btn" type="submit" disabled={priv.trim().length === 0} data-testid="import-btn">
                  load key
                </button>
              </form>
              {err && <p className="err-text" data-testid="wallet-error-line">{err}</p>}
              <p className="hint">
                fork users: anvil's first mnemonic key works here; fund it with PLS on the fork first.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PolicyPanel() {
  const gate = useGate();
  const p = gate.policy;
  const [txSession, setTxSession] = useState(String(p.maxTxPerSession));
  const [txDay, setTxDay] = useState(String(p.maxTxPerDay));
  const [plsTx, setPlsTx] = useState(() => fmt(p.maxValuePerTxWei));
  const [plsSession, setPlsSession] = useState(() => fmt(p.maxValuePerSessionWei));
  const [plsDay, setPlsDay] = useState(() => fmt(p.maxValuePerDayWei));
  const [unknownOk, setUnknownOk] = useState(p.allowUnknownDestinations);

  const save = () => {
    try {
      gate.setPolicy({
        maxTxPerSession: int(txSession, 0),
        maxTxPerDay: int(txDay, 0),
        maxValuePerTxWei: parseEther(plsTx || "0"),
        maxValuePerSessionWei: parseEther(plsSession || "0"),
        maxValuePerDayWei: parseEther(plsDay || "0"),
        allowUnknownDestinations: unknownOk,
        perTokenSessionCapWei: p.perTokenSessionCapWei,
      });
    } catch {
      /* invalid number — keep old policy */
    }
  };

  return (
    <div className="panel" data-testid="policy-panel">
      <h2>policy — what the gate enforces (per session/day)</h2>
      <div className="policy-grid">
        <label htmlFor="pol-txs">max sends / session</label>
        <input id="pol-txs" className="mono" value={txSession} onChange={(e) => setTxSession(e.target.value)} data-testid="pol-txs" />
        <label htmlFor="pol-txd">max sends / day</label>
        <input id="pol-txd" className="mono" value={txDay} onChange={(e) => setTxDay(e.target.value)} data-testid="pol-txd" />
        <label htmlFor="pls-tx">max PLS / tx</label>
        <input id="pls-tx" className="mono" value={plsTx} onChange={(e) => setPlsTx(e.target.value)} data-testid="pls-tx" />
        <label htmlFor="pls-session">max PLS / session</label>
        <input id="pls-session" className="mono" value={plsSession} onChange={(e) => setPlsSession(e.target.value)} data-testid="pls-session" />
        <label htmlFor="pls-day">max PLS / day</label>
        <input id="pls-day" className="mono" value={plsDay} onChange={(e) => setPlsDay(e.target.value)} data-testid="pls-day" />
        <label htmlFor="pol-unknown">allow sends to contracts outside the perimeter</label>
        <input
          id="pol-unknown"
          type="checkbox"
          checked={unknownOk}
          onChange={(e) => setUnknownOk(e.target.checked)}
          data-testid="pol-unknown"
        />
        <label htmlFor="gate-breadth">
          mode-C breadth — auto-ack unknown-CONTRACT sends in yolo mode (your LAU/YUE instances + venue tokens; caps still bind; unknown-METHOD + privileged gates still ask)
        </label>
        <input
          id="gate-breadth"
          type="checkbox"
          checked={gate.gateSettings.modeCBreadth}
          onChange={(e) => gate.setGateSettings({ modeCBreadth: e.target.checked })}
          data-testid="gate-breadth"
        />
      </div>
      <button className="btn" onClick={save} data-testid="policy-save">
        save policy
      </button>
      <p className="hint">
        unknown destinations always require an extra ack in the approval card; agent tools (later)
        are denied there outright. Setting a cap to 0 blocks every send — the denial path e2e uses
        this. The breadth toggle (session-65) only widens mode C's destination class — value/tx
        caps, unknown-METHOD asks, and privileged-gate asks are untouched, and modes A/B always
        show the card.
      </p>
    </div>
  );
}

function fmt(wei: bigint): string {
  const s = wei.toString();
  if (s === "0") return "0";
  return (Number(wei) / 1e18).toString();
}

function int(v: string, min: number): number {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < min) throw new Error(`bad number: ${v}`);
  return n;
}
