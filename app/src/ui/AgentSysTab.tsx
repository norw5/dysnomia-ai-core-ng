import { useEffect, useMemo, useRef, useState } from "react";
import { useAgent } from "@/agent/store";
import { useGate } from "@/chain/GateContext";
import type { Journal, JournalEvent } from "@/chain/journal";
import { runSummaryLine } from "@/chain/runs";
import { clearFleet, loadFleetRecording, refreshFleet, setFleetError, useFleet } from "@/state/fleet";
import { armReplay, disarmReplay, replayScoreAsOf, useReplay } from "@/state/replay";

/**
 * SYS tab (session-46 rename of the old GOD tab — IA-PLAN §7.11 note): the
 * agent's metrics page — spend meters, per-tool stats, the journal feed,
 * and run-transcript export (a local file download, never a POST; the
 * standing no-telemetry rule — exports are the only exfil path and they
 * are user-initiated). The task-graph checklist lives on the DECK; gate
 * approvals render INLINE in the CORE pane (session-63).
 *
 * Session-63: the FLEET / REPLAY operator surface lives HERE — the
 * recording loader, the live compose, the replay ARM, and the four-pillar
 * scoreboard (AS-OF the playhead while a replay runs). Real users never
 * see fleet machinery on the deck; the demo flow survives end-to-end.
 */

function downloadFile(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function kindClass(kind: string): string {
  if (kind.startsWith("gate.error") || kind.startsWith("agent.error")) return "gm-kind-err";
  if (kind.startsWith("gate.policy")) return "gm-kind-policy";
  if (kind.startsWith("gate.send") || kind.startsWith("gate.receipt")) return "gm-kind-send";
  if (kind.startsWith("agent.spend")) return "gm-kind-spend";
  return "gm-kind";
}

function EventFeed({ journal }: { journal: Journal }) {
  const [events, setEvents] = useState<JournalEvent[]>(() => feed(journal));
  useEffect(() => {
    const unsub = journal.subscribe((e) => {
      if (e.kind.startsWith("agent.") || e.kind.startsWith("gate.")) {
        setEvents((prev) => [...prev.slice(-59), e]);
      }
    });
    return unsub;
  }, [journal]);
  return (
    <div className="gm-feed" data-testid="sys-feed">
      {events.length === 0 && <p className="hint">no agent/gate events yet this session</p>}
      {events.map((e) => (
        <div key={e.id} className="gm-feed-row">
          <span className={`mono ${kindClass(e.kind)}`}>{e.kind}</span>
          <span className="gm-feed-line">{e.line}</span>
        </div>
      ))}
    </div>
  );
}

function feed(journal: Journal): JournalEvent[] {
  return journal
    .snapshot()
    .filter((e) => e.kind.startsWith("agent.") || e.kind.startsWith("gate."))
    .slice(-60);
}

/** the FLEET / REPLAY operator section (off-deck since session-63) */
function FleetSection({ rpcUrl }: { rpcUrl?: string | undefined }) {
  const fleet = useFleet();
  const replay = useReplay();
  const url = rpcUrl ?? "http://127.0.0.1:8545";
  const fileRef = useRef<HTMLInputElement | null>(null);
  const onFile = (file: File | undefined): void => {
    if (!file) return;
    void file
      .text()
      .then((text) => loadFleetRecording(text, url))
      .catch((e: unknown) => {
        setFleetError(e instanceof Error ? e.message : String(e));
      });
  };
  // during replay the board renders the recording's own snapshots AS OF the
  // playhead (scoreAt) — the evolving board, never a future snapshot
  const asOf = replay.armed && replay.recording !== null && fleet.recording !== null ? replayScoreAsOf(replay.recording, replay.index) : null;
  const asOfRanked =
    asOf !== null
      ? asOf.rows.map((r) => ({ agent: r.agent, vessel: r.vessel, pillars: { economic: BigInt(r.economic), territorial: Number(r.territorial), diplomatic: Number(r.diplomatic), social: Number(r.social) }, total: BigInt(r.total) }))
      : null;
  const rows = asOfRanked ?? (fleet.rows.length > 0 ? fleet.ranked : []);
  return (
    <section className="panel gm-panel">
      <h3>fleet / replay (operator — research machinery, off-deck)</h3>
      <p className="hint" data-testid="sys-fleet-source">
        source:{" "}
        <span className="mono">
          {asOf !== null
            ? `replay as-of event ${replay.index}`
            : fleet.recording === null
              ? "none"
              : fleet.source === "live"
                ? "live onchain compose"
                : "recording snapshots"}
        </span>
        {fleet.recording !== null && (
          <>
            {" · "}
            <span className="mono">
              {fleet.recording.roster.length} agents · {fleet.recording.events.length} events
            </span>
          </>
        )}
      </p>
      <div className="studio-actions" style={{ flexWrap: "wrap" }}>
        <button
          className="btn"
          data-testid="sys-fleet-load-label"
          onClick={() => fileRef.current?.click()}
          title="open a fleet recording file"
        >
          load recording
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          data-testid="sys-fleet-load"
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          className="btn"
          data-testid="sys-fleet-refresh"
          disabled={fleet.recording === null || fleet.composing}
          onClick={() => void refreshFleet(url)}
        >
          refresh
        </button>
        {fleet.recording !== null && !replay.armed && (
          <button
            className="btn btn-primary"
            data-testid="sys-fleet-replay"
            title="re-feed this recording through the deck's routing machinery (the 62 replay flagship — the slim header strip carries the transport)"
            onClick={() => {
              armReplay(JSON.stringify(fleet.recording));
            }}
          >
            arm replay
          </button>
        )}
        {fleet.recording !== null && replay.armed && (
          <button className="btn" data-testid="sys-fleet-disarm" onClick={() => disarmReplay()}>
            exit replay
          </button>
        )}
        {fleet.recording !== null && <button className="btn" data-testid="sys-fleet-clear" onClick={() => clearFleet()}>clear</button>}
      </div>
      {fleet.composing && <p className="hint">composing (live reads + the recording's receipts)…</p>}
      {fleet.error && <p className="err-text" data-testid="sys-fleet-error">{fleet.error}</p>}
      {!fleet.composing && fleet.error === null && fleet.rows.length === 0 && asOf === null && (
        <p className="hint" data-testid="sys-fleet-empty">
          no fleet state — run the first-contact runner (harness/agent_runner.py --first-contact) or load a fleet
          recording (.json). the four-pillar score composes from onchain state only.
        </p>
      )}
      {asOfRanked !== null && asOfRanked.length === 0 && (
        <p className="hint" data-testid="sys-fleet-asof-empty">no score snapshot yet at event {replay.index} — keep playing.</p>
      )}
      {rows.length > 0 && (
        <table className="perimeter" data-testid="sys-fleet-table">
          <thead>
            <tr>
              <th>#</th>
              <th>agent</th>
              <th>vessel</th>
              <th>ECO</th>
              <th>TERR</th>
              <th>DIPLO</th>
              <th>SOC</th>
              <th>total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.agent} data-testid="sys-fleet-row" data-agent={row.agent}>
                <td className="mono">{i + 1}</td>
                <td className="mono">{row.agent}</td>
                <td className="mono">{row.vessel}</td>
                <td className="mono">{row.pillars.economic.toString()}</td>
                <td className="mono">{row.pillars.territorial}</td>
                <td className="mono">{row.pillars.diplomatic}</td>
                <td className="mono">{row.pillars.social}</td>
                <td className="mono">{row.total.toString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {fleet.errors.length > 0 && (
        <p className="hint">
          per-agent read errors: {fleet.errors.length} (rows compose from what answered)
        </p>
      )}
      <p className="hint">
        ECO = whole-unit PLS+Ⓐ+CHOA across wallet/LAU/YUE (WPLS-anchored) · TERR = claims+GWATs+owned · DIPLO = two-way
        cipher channels (×2) · SOC = settles/attendance received at venues you own.
      </p>
    </section>
  );
}

export function AgentSysTab({ rpcUrl }: { rpcUrl?: string | undefined }) {
  const agent = useAgent();
  const gate = useGate();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const [factsDraft, setFactsDraft] = useState(agent.memoryFacts);
  const [wipeArmed, setWipeArmed] = useState(false);
  const [factsSaved, setFactsSaved] = useState(false);
  const [noteAcked, setNoteAcked] = useState(false);

  useEffect(() => {
    setFactsDraft(agent.memoryFacts);
  }, [agent.memoryFacts]);

  const onWipe = (): void => {
    if (!wipeArmed) {
      setWipeArmed(true);
      return;
    }
    setWipeArmed(false);
    void agent.wipeMemory();
  };

  const onSaveFacts = (): void => {
    setFactsSaved(false);
    void agent.saveMemoryFacts(factsDraft).then(() => {
      setFactsSaved(true);
      window.setTimeout(() => setFactsSaved(false), 2000);
    });
  };

  const onAckNote = (runId: string): void => {
    setNoteAcked(false);
    void agent.ackNote(runId, true).then(() => {
      setNoteAcked(true);
      window.setTimeout(() => setNoteAcked(false), 2000);
    });
  };

  const toolStats = useMemo(() => {
    const byTool = new Map<string, { calls: number; errors: number; lastStatus: string }>();
    for (const m of agent.messages) {
      if (m.kind !== "tool-result") continue;
      const name = m.toolName ?? "?";
      const cur = byTool.get(name) ?? { calls: 0, errors: 0, lastStatus: "ok" };
      cur.calls += 1;
      if (m.ok === false) {
        cur.errors += 1;
        cur.lastStatus = "error";
      } else cur.lastStatus = "ok";
      byTool.set(name, cur);
    }
    return Array.from(byTool.entries()).sort((a, b) => b[1].calls - a[1].calls);
  }, [agent.messages]);

  const tokenPct = agent.settings.maxTokens > 0 ? Math.min(100, (agent.sessionTokens / agent.settings.maxTokens) * 100) : 0;
  const txPct = Math.min(100, (gate.counters.sessionTx / Math.max(1, gate.policy.maxTxPerSession)) * 100);

  return (
    <div className="gm-tab" data-testid="sys-tab">
      <section className="panel gm-panel">
        <h3>spend meter</h3>
        <dl className="kv">
          <dt>model tokens (session)</dt>
          <dd className="mono" data-testid="sys-tokens">
            {agent.sessionTokens} / {agent.settings.maxTokens} cap
          </dd>
          <dt>gate sends (session)</dt>
          <dd className="mono" data-testid="sys-tx">
            {gate.counters.sessionTx} / {gate.policy.maxTxPerSession} cap · day {gate.counters.dayTx}/{gate.policy.maxTxPerDay}
          </dd>
          <dt>PLS value (session)</dt>
          <dd className="mono">{gate.counters.sessionValueWei.toString()} wei</dd>
        </dl>
        <div className="gm-bars">
          <div className="gm-bar">
            <span>tokens</span>
            <div className="gm-bar-track">
              <div className={tokenPct > 80 ? "gm-bar-fill warn" : "gm-bar-fill"} style={{ width: `${tokenPct}%` }} />
            </div>
          </div>
          <div className="gm-bar">
            <span>sends</span>
            <div className="gm-bar-track">
              <div className={txPct > 80 ? "gm-bar-fill warn" : "gm-bar-fill"} style={{ width: `${txPct}%` }} />
            </div>
          </div>
        </div>
        {agent.lastRun !== null && (
          <p className="hint" data-testid="sys-lastrun">
            last run: {agent.lastRun.status} · {agent.lastRun.steps} model turns · {agent.lastRun.tokens} tokens · {agent.lastRun.toolCalls.length} tool calls
          </p>
        )}
        {agent.keyInfo !== null && (
          <p className="hint" data-testid="sys-credits">
            key credits: usage {agent.keyInfo.usage ?? "?"}
            {agent.keyInfo.limit !== null ? ` / limit ${agent.keyInfo.limit}` : " (no hard limit reported)"}
            {agent.keyInfo.isFreeTier === true ? " · free tier" : ""}
            {agent.keyInfo.label !== null ? ` · "${agent.keyInfo.label}"` : ""}
          </p>
        )}
        {agent.keyInfoError !== null && (
          <p className="hint">
            credit probe: {agent.keyInfoError}
          </p>
        )}
      </section>

      <section className="panel gm-panel">
        <h3>full-auto cycle ledger (this engagement)</h3>
        <p className="hint" data-testid="sys-fullauto-state">
          {agent.fullAuto !== null ? (
            <>
              ENGAGED{agent.busy ? " · run in progress" : ""} · {agent.fullAuto.cycles} cycle{agent.fullAuto.cycles === 1 ? "" : "s"} done
              {" · "}
              {agent.fullAuto.tokens} tok
              {agent.settings.fullAutoMaxTokens > 0
                ? ` / ${agent.settings.fullAutoMaxTokens} session cap`
                : " (no session cap)"}
              {" · backstop "}
              {agent.settings.fullAutoMaxCycles}
              {agent.settings.fullAutoObjective.trim().length > 0 && (
                <>
                  {" · objective: "}
                  <span data-testid="sys-fa-objective">{agent.settings.fullAutoObjective.slice(0, 80)}</span>
                </>
              )}
              {agent.settings.strategistEnabled && agent.settings.strategistModel.length > 0 && (
                <>
                  {" · strategist "}
                  <span data-testid="sys-fa-strategist">{agent.settings.strategistModel}</span>
                </>
              )}
              {agent.fullAuto.nextGoals !== null && agent.fullAuto.nextGoals.length > 0 && (
                <>
                  {" · menu "}
                  {agent.fullAuto.nextGoals.length} goal{agent.fullAuto.nextGoals.length === 1 ? "" : "s"}
                </>
              )}
            </>
          ) : agent.fullAutoCycles.length > 0 ? (
            "disengaged — the ledger holds the last engagement"
          ) : (
            "not engaged — mode C + the AI_CORE header trigger"
          )}
        </p>
        {agent.fullAutoCycles.length > 0 && (
          <ul className="gm-feed" data-testid="sys-fullauto-ledger">
            {[...agent.fullAutoCycles].reverse().map((c) => (
              <li key={`${c.n}-${c.t}`} data-testid="sys-fullauto-row" data-kind={c.kind} className="fa-cycle">
                <div className="fa-cycle-line mono">
                  <span className={c.kind === "disengage" ? "warn-text" : c.status === "done" || c.status === "plan done" ? "ok-text" : "err-text"}>
                    {c.kind === "disengage" ? "—" : `#${c.n}`} {c.kind} · {c.status}
                  </span>
                  <span className="hint" data-testid="sys-fullauto-meta">
                    {c.tokens} tok · {c.toolCalls} tools{c.toolErrors > 0 ? ` (${c.toolErrors} err)` : ""} ·{" "}
                    <span data-testid="sys-fullauto-sends">{c.sends}</span> send{c.sends === 1 ? "" : "s"}
                  </span>
                </div>
                {c.summary !== null && (
                  <div className="gm-feed-line" data-testid="sys-fullauto-summary">
                    {c.summary}
                  </div>
                )}
                {c.goals !== null && c.goals.length > 0 && (
                  <div className="gm-feed-line fa-cycle-goals" data-testid="sys-fullauto-goals">
                    <span className="fa-goals-mark">next-goals ▸</span> {c.goals.join(" · ")}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          one row per completed cycle (status · tokens · tool calls · gate sends that landed · the structured next-goals
          menu, session-74) + the closing disengage row — cleared on each engagement. caps live in SETTINGS → Agent (cycle
          backstop + session token cap); every send still passes THE gate, and the §7.4 cadence governor still bounds chat.
        </p>
      </section>

      <section className="panel gm-panel">
        <h3>tool widgets</h3>
        {toolStats.length === 0 && <p className="hint">no tool activity yet</p>}
        <table className="perimeter" data-testid="sys-tools">
          <thead>
            <tr>
              <th>tool</th>
              <th>calls</th>
              <th>errors</th>
              <th>last</th>
            </tr>
          </thead>
          <tbody>
            {toolStats.map(([name, s]) => (
              <tr key={name}>
                <td className="mono">{name}</td>
                <td className="mono">{s.calls}</td>
                <td className="mono">{s.errors}</td>
                <td className={s.lastStatus === "error" ? "err-text" : "ok-text"}>{s.lastStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel gm-panel">
        <h3>run transcript export (local file — never a POST)</h3>
        <div className="studio-actions">
          <button
            className="btn"
            onClick={() => downloadFile(`dys-agent-run-${stamp}.json`, agent.exportTranscript(), "application/json")}
            data-testid="sys-export-json"
          >
            export JSON
          </button>
          <button
            className="btn"
            onClick={() => downloadFile(`dys-agent-run-${stamp}.md`, agent.exportMarkdown(), "text/markdown")}
            data-testid="sys-export-md"
          >
            export markdown
          </button>
          <button className="btn" onClick={agent.clearConversation} data-testid="sys-clear">
            clear conversation
          </button>
        </div>
      </section>

      <FleetSection rpcUrl={rpcUrl} />

      <section className="panel gm-panel">
        <h3>journal / memory (§7.10 — local, editable, wipeable)</h3>
        <p className="hint" data-testid="sys-memory-summary">
          {agent.sessionMemory !== null
            ? `session memory injected this session (${agent.sessionMemory.length} chars — facts + last session)`
            : "no session memory yet — runs + facts build it"}
          {" · "}
          {agent.sessionRuns.length} run{agent.sessionRuns.length === 1 ? "" : "s"} this session
        </p>
        <label className="field">
          <span>long-term facts (injected on session start, after the fixed core)</span>
          <textarea
            rows={3}
            value={agent.memoryFacts}
            placeholder="operator facts the core should always remember — e.g. preferred venues, standing cautions"
            onChange={(e) => setFactsDraft(e.target.value)}
            onBlur={() => agent.saveMemoryFacts(factsDraft)}
            data-testid="sys-memory-facts"
          />
        </label>
        <div className="studio-actions">
          <button className="btn" onClick={onSaveFacts} data-testid="sys-memory-save">
            {factsSaved ? "saved ✓" : "save facts"}
          </button>
          {factsSaved && (
            <span className="ok-text hint" data-testid="sys-memory-saved">
              persisted
            </span>
          )}
          <button
            className="btn"
            onClick={() => downloadFile(`dys-runs-${stamp}.json`, agent.exportRuns(), "application/json")}
            data-testid="sys-runs-export"
          >
            export runs JSON
          </button>
          <button
            className="btn"
            onClick={() => downloadFile(`dys-recording-${stamp}.json`, agent.exportRecording(), "application/json")}
            data-testid="sys-recording-export"
            title="the session's RunEvent stream in the fleet recording format — the replay flagship's input"
          >
            export recording
          </button>
          <button className={`btn ${wipeArmed ? "btn-primary" : ""}`} onClick={onWipe} data-testid="sys-memory-wipe">
            {wipeArmed ? "CONFIRM WIPE" : "wipe memory"}
          </button>
        </div>
        {agent.pendingNotes.length > 0 && (
          <div data-testid="sys-notes" style={{ marginTop: "0.75rem" }}>
            <span className="hint">
              agent notes awaiting review ({agent.pendingNotes.length}) — acked notes join the session memory; un-acked notes never reach a prompt
            </span>
            <ul className="gm-feed" data-testid="sys-notes-list">
              {agent.pendingNotes.map((n) => (
                <li key={n.runId} data-testid="sys-note-row">
                  <span className="mono hint">{n.kind}</span> <span className="hint">{n.goal.slice(0, 90)}</span>
                  <div className="gm-feed-line" data-testid="sys-note-text">
                    “{n.text}”
                  </div>
                  <div className="studio-actions">
                    <button className="btn" onClick={() => onAckNote(n.runId)} data-testid="sys-note-ack">
                      ack
                    </button>
                    <button className="btn" onClick={() => void agent.dismissNote(n.runId)} data-testid="sys-note-dismiss">
                      dismiss
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {noteAcked && (
          <span className="ok-text hint" data-testid="sys-note-acked">
            note persisted
          </span>
        )}
        {agent.sessionRuns.length > 0 && (
          <ul className="gm-feed" data-testid="sys-runs">
            {[...agent.sessionRuns].reverse().slice(0, 12).map((r) => (
              <li key={r.id}>
                <span className="mono hint">{r.kind}</span> {runSummaryLine(r)}
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          run records carry tool names + outcomes only — injection-weighted payloads never reach memory; the one model-authored string
          (journal_note) is size-capped and reviews HERE before injection; exports write local files.
        </p>
      </section>

      <section className="panel gm-panel">
        <h3>event feed (journal)</h3>
        <EventFeed journal={gate.journal} />
      </section>
    </div>
  );
}
