import { useEffect, useMemo, useRef, useState } from "react";
import { useAgent } from "@/agent/store";
import { fullAutoCapsHint } from "@/agent/fullAuto";
import { AgentSysTab } from "@/ui/AgentSysTab";
import { useGate } from "@/chain/GateContext";
import { useWallet } from "@/wallet/WalletContext";
import { useReplay, replayTranscript, type ReplayTranscriptRow } from "@/state/replay";
import { FLEET_VESSELS } from "@/state/vessel";
import { PaneMarkdown } from "@/ui/paneMarkdown";

/**
 * AI_CORE pane (chrome parity + the session-45 model core): the predecessor's
 * purple chatbox idiom — [ AI_CORE ] header, message stream, auto-grow input
 * with EXEC/STOP — now wired to the agent deck. Tabs: CORE (the deck) and
 * SYS (the metrics page — session-46 rename of GOD; the FLEET/REPLAY
 * operator surface lives there since session-63).
 *
 * Session 62.1: when a REPLAY is armed, the pane renders the RECORDED
 * conversation instead — a pure fold of the playhead prefix
 * (replayTranscript), vessel-colored turn markers, clearly badged; the live
 * transcript is untouched and the input is fenced until replay exits.
 *
 * Session 63 (the owner's call — the old site's chatbox "was good"): tool
 * traffic ports the OLD idiom — `[ ▸ CALLING TOOL: name ]` rows with a
 * PARAMETERS fold, `[ ◂ TOOL RESULT: name ]` folds with pretty JSON — and
 * the tx-gate approval envelope renders INLINE as the amber
 * `[ ACTION REQUIRED ]` card (the same resolver as the global modal; the
 * proposal widget kind is dead). The input fences while an approval pends.
 *
 * Session 64 (the pane legibility round): assistant answers get their OWN
 * class (`.apane-msg-answer` — red is for system/error rows ONLY) + compact
 * markdown (headings cyan, strong/code purple — inert); the announce-line
 * renders as a labeled INTENT strip (amber bar + INTENT chip, the literal
 * `▸ plan:` prefix stripped) with any REMAINDER text below it (the replay
 * renderer's behavior, now the live behavior too); tool folds color to the
 * old-site semantics — CALLING purple, RESULT cyan, errors red — with
 * soft-refusal results (ok=true + an error payload) marked ERROR honestly.
 */

/** the §7.11 announce-then-act line — the marker convention is unchanged;
 *  only the RENDER dropped the fold-like glyph (session-64) */
export function intentLine(text: string): string | null {
  const m = /^▸ plan:\s*(.+)$/im.exec(text.trim());
  return m !== null ? m[1]!.trim() : null;
}

/** the strip + the remainder beneath it — ONE split, used live AND in replay */
export function splitIntent(text: string): { intent: string | null; rest: string } {
  const intent = intentLine(text);
  if (intent === null) return { intent: null, rest: text.trim() };
  // drop every line that IS a plan line (the model may emit more than one)
  const kept = text
    .split("\n")
    .filter((l) => intentLine(l) === null)
    .join("\n")
    .trim();
  return { intent, rest: kept };
}

function IntentStrip({ text }: { text: string }) {
  return (
    <div className="apane-msg-intent" data-testid="agent-intent">
      <span className="apane-intent-label">INTENT</span>
      <span className="apane-intent-text">{text}</span>
    </div>
  );
}

/** the assistant answer: its OWN class + compact markdown — never red */
function AnswerBlock({ text }: { text: string }) {
  return (
    <div className="apane-msg-answer" data-testid="agent-answer">
      <PaneMarkdown text={text} />
    </div>
  );
}

/** one arg value as a compact string — arrays/objects summarize structurally
 * (never "[object Object]": `String()` on the plan steps array was the
 * session-72 camera find, on camera twice in the 69+72 guided takes) */
function briefVal(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    const first = briefVal(v[0]);
    return `[${v.length}× ${first.slice(0, 24)}]`;
  }
  if (typeof v === "object") return `{${Object.keys(v as Record<string, unknown>).slice(0, 4).join("/")}}`;
  return String(v);
}

export function briefArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return "{}";
  return (
    keys
      .slice(0, 4)
      .map((k) => `${k}: ${briefVal(args[k]).slice(0, 40)}`)
      .join(" · ") + (keys.length > 4 ? " …" : "")
  );
}

/** the old site's tool-call row: a fold carrying the full PARAMETERS block */
function ToolCallCard({ name, args }: { name: string; args: Record<string, unknown> }) {
  return (
    <details className="apane-msg-tool" data-testid="agent-toolcall">
      <summary className="apane-tool-calling">
        <span className="apane-tool-name">[ ▸ CALLING TOOL: {name} ]</span> <span className="mono">{briefArgs(args)}</span>
      </summary>
      <div className="apane-tool-params">
        <div className="apane-params-label">PARAMETERS:</div>
        <pre className="mono">{JSON.stringify(args, null, 2)}</pre>
      </div>
    </details>
  );
}

/** soft refusals arrive as ok=true WITH an error payload — both are failures in truth */
function resultFailed(ok: boolean | undefined, result: Record<string, unknown> | undefined): boolean {
  if (ok === false) return true;
  const err = result?.["error"];
  return typeof err === "string" && err.length > 0;
}

function ToolResultFold({ name, result, ok }: { name: string | undefined; result: Record<string, unknown> | undefined; ok: boolean | undefined }) {
  const failed = resultFailed(ok, result);
  return (
    <details className="apane-msg-toolresult" data-testid="agent-toolresult">
      <summary className={failed ? "err-text" : "apane-tool-result"}>
        [ ◂ TOOL RESULT: {name} {failed ? "ERROR" : "ok"} ]
      </summary>
      <pre className={`mono ${failed ? "apane-toolresult-err" : ""}`}>{JSON.stringify(result, null, 2).slice(0, 2000)}</pre>
    </details>
  );
}

/** the system-row severity classes (session-65.3): red is reserved for
 *  HARD-STOP errors — approvals/success render ok (green), fences/stops
 *  warn (amber), mode switches + informational notes stay neutral */
function systemToneClass(tone: "info" | "ok" | "warn" | "error" | undefined): string {
  if (tone === "ok") return "apane-msg-ok";
  if (tone === "warn") return "apane-msg-warn";
  if (tone === "error") return "apane-msg-err";
  return "apane-msg-info"; // info + legacy untoned rows: neutral, never red
}

function ReplayMarker({ row }: { row: ReplayTranscriptRow }) {
  const m = row.marker!;
  const vessel = FLEET_VESSELS.find((v) => v.id === m.vessel);
  return (
    <div className="apane-msg-turn replay-turn" data-testid="replay-marker" style={vessel !== undefined ? { color: vessel.accent, borderColor: vessel.accent } : undefined}>
      ── turn {m.turn} · {m.agent}{vessel !== undefined ? ` · ${vessel.role}` : ""} ──
    </div>
  );
}

function ReplayRow({ m }: { m: ReplayTranscriptRow }) {
  if (m.marker !== undefined) return <ReplayMarker row={m} />;
  if (m.kind === "assistant") {
    // replay fidelity: the recorded text is whole — the INTENT strip renders
    // AND the remainder below it (the live convention since session-64)
    const { intent, rest } = splitIntent(m.text ?? "");
    return (
      <>
        {intent !== null && <IntentStrip text={intent} />}
        {rest.length > 0 && <AnswerBlock text={rest} />}
      </>
    );
  }
  if (m.kind === "reasoning") {
    return (
      <details className="apane-msg-reasoning" data-testid="agent-reasoning">
        <summary>▸ reasoning (native, billed)</summary>
        <pre className="mono">{m.text}</pre>
      </details>
    );
  }
  if (m.kind === "tool-call") {
    return <ToolCallCard name={m.toolName ?? "?"} args={m.toolArgs ?? {}} />;
  }
  if (m.kind === "tool-result") {
    return <ToolResultFold name={m.toolName} result={m.toolResult} ok={m.ok} />;
  }
  return (
    <div className="apane-msg-system apane-msg-err">{m.text}</div>
  );
}

/** the live STREAMING partial (session-75): rendered through the SAME
 *  strip/answer split as a finalized message — the INTENT strip appears the
 *  moment its line completes mid-stream — plus the frame-batched cursor.
 *  The finalized assistant row replaces this atomically. */
function StreamPartialRow({ text }: { text: string }) {
  const { intent, rest } = splitIntent(text);
  return (
    <div className="apane-msg-group" data-testid="agent-streaming">
      {intent !== null && <IntentStrip text={intent} />}
      {rest.length > 0 && <AnswerBlock text={rest} />}
      <span className="apane-streaming-cursor" aria-hidden="true" />
    </div>
  );
}

/**
 * The INLINE approval envelope (session-63): the old site's amber
 * `[ ACTION REQUIRED ]` card, in-stream — the same pendingApproval source
 * and the same resolver as the global modal card. The proposal widget kind
 * is dead; the agent's output is paused awaiting this anyway.
 */
function InlineApproval() {
  const gate = useGate();
  const pending = gate.pendingApproval;
  if (pending === null) return null;
  const r = pending.request;
  const simFailed = pending.sim !== null && !pending.sim.ok;
  return (
    <div className="apane-approval" data-testid="agent-approval">
      <div className="apane-approval-head">[ ACTION REQUIRED ]</div>
      <dl className="kv">
        <dt>to</dt>
        <dd className="mono">{r.to}</dd>
        <dt>selector</dt>
        <dd className="mono">{r.data.slice(0, 10)}{pending.cls.functionSig ? ` · ${pending.cls.functionSig}` : ""}</dd>
        <dt>risk</dt>
        <dd className="mono">
          {pending.cls.risk}
          {pending.policy.requiresExtraAck ? " · extra ack" : ""}
        </dd>
        <dt>DRYRUN</dt>
        <dd>
          {pending.sim === null ? (
            "not run"
          ) : pending.sim.ok ? (
            <span className="ok-text">ok{pending.sim.gas !== null ? ` · gas ~${pending.sim.gas.toString()}` : ""}</span>
          ) : (
            <span className="err-text">
              reverted{pending.sim.error?.decoded ? ` — ${pending.sim.error.decoded}` : ""}
            </span>
          )}
        </dd>
        <dt>source</dt>
        <dd className="mono">{r.meta?.source ?? "manual"}</dd>
      </dl>
      {simFailed && (
        <p className="hint">
          the DRYRUN reverted — the override-with-warning checkbox lives on the global approval card (the header of this
          pane stays honest: previews are pure).
        </p>
      )}
      <div className="studio-actions">
        <button className="btn btn-primary" onClick={() => gate.resolveApproval(true)} data-testid="agent-approval-approve">
          APPROVE
        </button>
        <button className="btn" onClick={() => gate.resolveApproval(false)} data-testid="agent-approval-reject">
          REJECT
        </button>
      </div>
    </div>
  );
}

export function AgentPane({ rpcUrl }: { rpcUrl?: string | undefined }) {
  const agent = useAgent();
  const gate = useGate();
  const wallet = useWallet();
  const replay = useReplay();
  // session-77 (the 71.3 pattern, extended to the pane): the DOM textarea is
  // the source of truth — typing re-renders NOTHING; only the EXEC/WHISPER
  // enabled state rides a debounced flag. Auto-grow is CSS `field-sizing`.
  const [hasText, setHasText] = useState(false);
  const [tab, setTab] = useState<"core" | "sys">("core");
  // session-74: the OBJECTIVE draft (the pane edit path — saved on Enter/blur;
  // SETTINGS and the `objective:` whisper write the same store field)
  const [objDraft, setObjDraft] = useState(agent.settings.fullAutoObjective);
  const [objSaved, setObjSaved] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const textTimer = useRef<number | null>(null);
  /** the draft survives a CORE↔SYS tab switch (the textarea unmounts) */
  const draft = useRef("");

  const readText = (): string => taRef.current?.value ?? "";
  const syncHasText = (value: string) => {
    if (textTimer.current !== null) window.clearTimeout(textTimer.current);
    textTimer.current = window.setTimeout(() => setHasText(value.trim().length > 0), 120);
  };
  useEffect(
    () => () => {
      if (textTimer.current !== null) window.clearTimeout(textTimer.current);
    },
    []
  );

  useEffect(() => {
    setObjDraft(agent.settings.fullAutoObjective);
  }, [agent.settings.fullAutoObjective]);

  const saveObjective = (): void => {
    const next = objDraft.trim();
    if (next === agent.settings.fullAutoObjective) return;
    agent.setSettings({ ...agent.settings, fullAutoObjective: next });
    setObjSaved(true);
    window.setTimeout(() => setObjSaved(false), 1500);
  };

  const replayRows = replay.armed && replay.recording !== null && tab === "core"
    ? replayTranscript(replay.recording, replay.index, replay.filter)
    : null;
  const pendingApproval = gate.pendingApproval !== null;

  // session-75: the finalized rows keep their ELEMENT identity across
  // partial-lane commits — React bails out of re-rendering the historical
  // subtree while the one live partial row re-renders on its frame cadence
  // (the 71.3 never-the-whole-stream-per-chunk law)
  const liveRows = useMemo(
    () =>
      agent.messages.map((m) =>
        m.kind === "user" ? (
          <div key={m.id} className="apane-msg-user">
            {m.text}
          </div>
        ) : m.kind === "assistant" ? (
          (() => {
            // the strip + the remainder: BOTH render (session-64 —
            // the old live pane dropped the remainder)
            const { intent, rest } = splitIntent(m.text ?? "");
            return (
              <div key={m.id} className="apane-msg-group">
                {intent !== null && <IntentStrip text={intent} />}
                {rest.length > 0 && <AnswerBlock text={rest} />}
              </div>
            );
          })()
        ) : m.kind === "reasoning" ? (
          <details key={m.id} className="apane-msg-reasoning" data-testid="agent-reasoning">
            <summary>▸ reasoning (native, billed)</summary>
            <pre className="mono">{m.text}</pre>
          </details>
        ) : m.kind === "tool-call" ? (
          <ToolCallCard key={m.id} name={m.toolName ?? "?"} args={m.toolArgs ?? {}} />
        ) : m.kind === "tool-result" ? (
          <ToolResultFold key={m.id} name={m.toolName ?? "?"} result={m.toolResult} ok={m.ok} />
        ) : m.kind === "whisper" ? (
          <div key={m.id} className="apane-msg-whisper" data-testid="agent-whisper">
            <span className="apane-whisper-label">WHISPER → next turn</span> {m.text}
          </div>
        ) : (
          <div key={m.id} className={`apane-msg-system ${systemToneClass(m.tone)}`}>
            {m.text}
          </div>
        ),
      ),
    [agent.messages],
  );

  // follow the stream bottom while generating (instant scroll per commit —
  // smooth at frame cadence stutters), smooth everywhere else
  const streamLen = agent.streamPartial?.length ?? 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: streamLen > 0 ? "auto" : "smooth" });
  }, [replayRows !== null ? replayRows.length : agent.messages.length, streamLen, tab, gate.pendingApproval]);

  // session-65: while a run is BUSY (and nothing pends) the input becomes
  // the WHISPER channel — a queued note injected into the run's NEXT model
  // turn, never aborting the in-flight call
  const whisperMode = agent.busy && !pendingApproval && replayRows === null;

  const submit = () => {
    const text = readText().trim();
    if (text.length === 0 || pendingApproval || replayRows !== null) return;
    // clear optimistically (the previous controlled behavior), then reset the
    // debounced affordance — a pending timer must not resurrect EXEC
    if (textTimer.current !== null) window.clearTimeout(textTimer.current);
    if (taRef.current) taRef.current.value = "";
    draft.current = "";
    setHasText(false);
    if (agent.busy) agent.whisper(text);
    else void agent.send(text);
  };

  return (
    <div className="agent-dock" data-testid="agent-dock">
      <header className="dock-head">
        {/* session-60: two designed rows — title (+ PROCESSING) with the tabs,
            the model/keychip on its own line below. No three-line wrap. */}
        <div className="dock-head-row">
          <span className="dock-title">AI_CORE</span>
          {agent.busy && (
            <span className="dock-processing" data-testid="agent-processing">
              PROCESSING...
            </span>
          )}
          <nav className="dock-tabs">
            <button className={tab === "core" ? "dock-tab active" : "dock-tab"} onClick={() => setTab("core")} data-testid="agent-tab-core">
              CORE
            </button>
            <button className={tab === "sys" ? "dock-tab active" : "dock-tab"} onClick={() => setTab("sys")} data-testid="agent-tab-sys">
              SYS
            </button>
          </nav>
        </div>
        <div className="dock-head-sub">
          <span className="apane-keychip" data-testid="agent-keychip">
            {agent.keySource === null ? (
              <span className="err-text">NO KEY</span>
            ) : (
              <>
                <span className={agent.keySource === "dev-env" ? "warn-text" : "ok-text"}>{agent.keySource === "dev-env" ? "DEV.ENV" : "BYOK"}</span>
                <span className="hint"> · {agent.settings.model}</span>
              </>
            )}
          </span>
          {/* session-65.3 (the owner's call): FULL-AUTO lives in the HEADER,
              not the message box — it is an extra harness mode ("how far can
              the agent go"), not a control operators reach for per-message;
              still mode-C + key gated; engaged shows the cycle count */}
          {tab === "core" && wallet.mode === "C" && agent.keySource !== null && !replay.armed && (
            <button
              className={agent.fullAuto !== null ? "apane-stop apane-fullauto-engaged" : "apane-fullauto"}
              onClick={agent.fullAuto !== null ? agent.stopFullAuto : agent.startFullAuto}
              data-testid="agent-fullauto"
              title={
                agent.fullAuto !== null
                  ? "disengage FULL-AUTO (the current run finishes)"
                  : "engage FULL-AUTO — the extra harness mode: the agent sets its own goals under the mode-C policy; STOP or any spend/failure fence disengages"
              }
            >
              {agent.fullAuto !== null ? `FULL-AUTO ● ${agent.fullAuto.cycles}` : "FULL-AUTO"}
            </button>
          )}
        </div>
      </header>

      {/* session-74 THE STRATEGY LAYER: the operator OBJECTIVE — the pane edit
          path (the same store field SETTINGS and the `objective:` whisper
          write). Mode-C + key gated like the trigger; editable while
          disengaged, read-only while engaged (whispers steer live). */}
      {tab === "core" && wallet.mode === "C" && agent.keySource !== null && !replay.armed && (
        <>
          <div className="fa-obj-row" data-testid="fa-objective-row">
            <span className="fa-obj-label">OBJECTIVE</span>
            {agent.fullAuto !== null ? (
              <span className="fa-obj-view" data-testid="fa-objective-view" title={agent.settings.fullAutoObjective}>
                {agent.settings.fullAutoObjective.trim().length > 0
                  ? agent.settings.fullAutoObjective
                  : "none set — cycles self-goal · whisper `objective: …` to steer"}
              </span>
            ) : (
              <>
                <input
                  className="fa-obj-input"
                  value={objDraft}
                  spellCheck={false}
                  placeholder="the standing goal carried by every FULL-AUTO kickoff (blank = self-goaling)"
                  onChange={(e) => setObjDraft(e.target.value)}
                  onBlur={() => saveObjective()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveObjective();
                    }
                  }}
                  data-testid="fa-objective-input"
                />
                {objSaved && (
                  <span className="ok-text hint" data-testid="fa-objective-saved">
                    saved ✓
                  </span>
                )}
              </>
            )}
          </div>
          {/* session-76 (the owner round): the engage-time CAPS MATH — what
              the CURRENT knobs imply in cycles, named BEFORE engaging (the
              75 live fire watched a 484k fat cycle-1 tail fenced by the old
              150k per-run default into a budget-stop disengage). DISENGAGED
              only — while engaged the spend line carries the live meter. */}
          {agent.fullAuto === null && (
            <p className="fa-caps-hint" data-testid="fa-caps-hint">
              {fullAutoCapsHint(agent.settings.maxTokens, agent.settings.fullAutoMaxTokens, agent.settings.fullAutoMaxCycles)}
            </p>
          )}
        </>
      )}

      {tab === "sys" ? (
        <AgentSysTab rpcUrl={rpcUrl} />
      ) : (
        <>
          <div className="apane-stream" data-testid="agent-chat">
            {replayRows !== null ? (
              <>
                <div className="apane-replay-banner" data-testid="replay-banner">
                  <span className="mono replay-badge">REPLAY</span>{" "}
                  <span className="hint">
                    the recorded conversation{replay.filter !== null ? ` · ${replay.filter}` : " · the whole fleet"} — inert history, seek on the
                    header replay strip. exit replay to converse.
                  </span>
                </div>
                {replayRows.length === 0 && (
                  <div className="apane-empty">replay armed — press ▶ play on the header replay strip.</div>
                )}
                {replayRows.map((m) => (
                  <ReplayRow key={m.id} m={m} />
                ))}
              </>
            ) : (
              <>
                {agent.messages.length === 0 && agent.streamPartial === null && (
                  <div className="apane-empty">
                    Agent shell initialized. Awaiting commands.
                    <div className="apane-msg-hint" style={{ marginTop: "0.8rem" }}>
                      read tools (state/venue/entity/contract + KB search) answer directly; act tools
                      DRYRUN first and send through the one transaction gate.
                    </div>
                  </div>
                )}
                {liveRows}
                {agent.streamPartial !== null && <StreamPartialRow text={agent.streamPartial} />}
                <InlineApproval />
              </>
            )}
            <div ref={endRef} />
          </div>

          <div className="apane-input">
            <div className="apane-input-box">
              <textarea
                ref={taRef}
                rows={1}
                placeholder={
                  replayRows !== null
                    ? "replay mode — exit replay on the header strip to converse…"
                    : pendingApproval
                      ? "an approval is pending — APPROVE or REJECT above…"
                      : whisperMode
                        ? "whisper to the running agent — queued for its next model turn (never aborts the call)…"
                        : "Initialize command sequence..."
                }
                spellCheck={false}
                disabled={replayRows !== null || pendingApproval}
                defaultValue={draft.current}
                onChange={(e) => {
                  draft.current = e.target.value;
                  syncHasText(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                data-testid="agent-input"
              />
              <div className="apane-input-row">
                <span className="hint" data-testid="agent-spend">
                  {replayRows !== null
                    ? `replay · event ${replay.index + 1}${replay.filter !== null ? ` · ${replay.filter}` : ""}`
                    : agent.fullAuto !== null
                      ? `FULL-AUTO · ${agent.fullAuto.cycles} cycle${agent.fullAuto.cycles === 1 ? "" : "s"} done${agent.fullAuto.tokens > 0 ? ` · ${agent.fullAuto.tokens} tok${agent.settings.fullAutoMaxTokens > 0 ? ` / ${agent.settings.fullAutoMaxTokens}` : ""}` : ""}`
                      : agent.sessionTokens > 0
                        ? `${agent.sessionTokens} tok this session`
                        : ""}
                </span>
                {replayRows !== null ? (
                  <span className="hint">REPLAY</span>
                ) : pendingApproval ? (
                  <span className="warn-text hint">AWAITING APPROVAL</span>
                ) : (
                  <>
                    {agent.busy ? (
                      <>
                        <button className="apane-whisper" onClick={submit} disabled={!hasText} data-testid="agent-whisper-send" title="queue this note into the run's next model turn">
                          WHISPER
                        </button>
                        <button className="apane-stop" onClick={agent.abort} data-testid="agent-stop">
                          STOP
                        </button>
                      </>
                    ) : (
                      <button className="apane-exec" onClick={submit} disabled={!hasText} data-testid="agent-exec">
                        EXEC
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
