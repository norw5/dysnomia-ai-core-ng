import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Address } from "viem";
import { useGate } from "@/chain/GateContext";
import { useWallet } from "@/wallet/WalletContext";
import type { Journal } from "@/chain/journal";
import type { PlayerSnapshot } from "@/chain/identity";
import { loadPersona, savePersona } from "@/agent/knowledge";
import {
  fetchKeyInfo,
  fetchModels,
  resolveApiKey,
  type KeyInfo,
  type ModelInfo,
  type WireMessage,
} from "@/agent/openrouter";
import { DEFAULT_RUN_MAX_TOKENS, runAgent, windowHistory, type AgentRunResult, type RunEvent } from "@/agent/graph";
import { emitRunEvent } from "@/agent/events";
import {
  fullAutoContinues,
  fullAutoCycleText,
  fullAutoKickoffText,
  fullAutoTokenFence,
  parseObjectiveWhisper,
  sanitizeObjective,
  type FullAutoCycleRecord,
  FULL_AUTO_CHAT_MIN_INTERVAL_MS,
  FULL_AUTO_MAX_CYCLES,
  FULL_AUTO_MAX_TOKENS,
} from "@/agent/fullAuto";
import { runStrategist } from "@/agent/strategist";
import { RecordingWriter, serializeRecording } from "@/agent/recording";
import { executePlan } from "@/agent/planRunner";
import { simLayerActive } from "@/chain/simMode";
import { pendingLau as pendingLauValue } from "@/state/pendingLau";
import { dssOf } from "@/state/dssStore";
import type { AgentToolContext } from "@/agent/tools";
import { approvePlan, currentPlan, stopPlan } from "@/state/planStore";
import { RunsLedger, buildSessionMemory, type AgentRunRecord, type RunKind } from "@/chain/runs";

/**
 * The agent deck's app-global runtime (session-45): settings (BYOK key /
 * model / persona / budgets / the §7.4 chat-tools opt-in), the run driver
 * wired to the ONE gate through GateContext, spend accounting, and the
 * transcript state the AI_CORE pane + SYS tab render. The BYOK key lives
 * in localStorage only when the user opts to remember it — never in the
 * journal, never in exports, never in git.
 */

const SETTINGS_KEY = "dys.agent.v1";

export interface AgentSettings {
  apiKey: string | null;
  model: string;
  /** max model turns (model API calls) per run — 0 = no step limit (the
   *  token budget + abort + L2 knobs still apply) */
  maxSteps: number;
  maxTokens: number;
  chatToolsEnabled: boolean;
  /** §7.11 native-reasoning opt-in, PER MODEL (models with it on) */
  reasoningModels: string[];
  /**
   * The §7.11 STREAMING opt-in (session-75), PER MODEL: models with it on
   * ride the SSE completion path — the pane renders the live partial per
   * frame batch and STOP unlocks mid-generation (the partial is preserved;
   * the tokens produced are still burned). Non-streaming stays the default.
   */
  streamingModels: string[];
  /** §7.8 L2 autonomy knobs (session-52) — tighten-only run guards; 0 = off */
  maxConsecutiveToolFailures: number;
  checkpointEverySteps: number;
  /** per-RUN agent send budget (each gate send attempt counts; 0 = off).
   *  The SESSION/DAY policy caps in the tx gate still apply on top. */
  maxAgentTxPerRun: number;
  /**
   * Plan AUTO-APPROVE (session-65, the yolo relaxation): auto-answer the
   * plan widget's one-gate with YES — honored ONLY in wallet mode C, and
   * sends inside the plan still resolve through THE gate (per-tx approvals
   * in A/B; mode-C breadth applies to those sends like any other).
   * Default OFF: the human's one-gate on multi-step autonomy.
   */
  autoApprovePlans: boolean;
  /**
   * FULL-AUTO loop caps (session-68 hardening): the cycle backstop (the
   * 65 constant, now operator-settable — clamped ≥ 1) and the SESSION
   * token cap (cumulative model tokens burned while engaged; 0 = off).
   * Loop-length fences only — no gate bypass, the per-run budget still
   * applies inside every cycle.
   */
  fullAutoMaxCycles: number;
  fullAutoMaxTokens: number;
  /**
   * Session-74 THE STRATEGY LAYER: the persistent operator OBJECTIVE — the
   * standing goal carried by every FULL-AUTO kickoff (the strategy
   * boundary). Hybrid edit paths (the owner round): the pane field,
   * SETTINGS → Agent, and an `objective:` whisper (live mid-engagement).
   * App-global persistence — survives disengage/reload until edited or
   * cleared. Empty string = self-goaling cycles (the 65 default).
   */
  fullAutoObjective: string;
  /**
   * The two-tier strategist (session-74 owner round — opt-in, default
   * OFF): when enabled AND strategistModel is non-empty, ONE bounded
   * read-only call between full-auto cycles picks the next goal. Kickoff
   * self-goaling stays the default and the fallback; strategist tokens
   * count toward the full-auto session cap.
   */
  strategistEnabled: boolean;
  strategistModel: string;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  apiKey: null,
  model: "deepseek/deepseek-v4.1-flash",
  maxSteps: 32,
  // session-76: 300k (was 150k) — the fat-cycle datum; see graph.ts's
  // DEFAULT_RUN_MAX_TOKENS note. Persisted settings keep their stored value.
  maxTokens: DEFAULT_RUN_MAX_TOKENS,
  chatToolsEnabled: false,
  reasoningModels: [],
  streamingModels: [],
  maxConsecutiveToolFailures: 3,
  checkpointEverySteps: 0,
  maxAgentTxPerRun: 4,
  autoApprovePlans: false,
  fullAutoMaxCycles: FULL_AUTO_MAX_CYCLES,
  fullAutoMaxTokens: FULL_AUTO_MAX_TOKENS,
  fullAutoObjective: "",
  strategistEnabled: false,
  strategistModel: "",
};

function loadSettings(): AgentSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_AGENT_SETTINGS;
    const s = JSON.parse(raw) as Partial<AgentSettings>;
    const knob = (v: unknown, d: number): number =>
      typeof v === "number" && v >= 0 && Number.isFinite(v) ? Math.floor(v) : d;
    return {
      apiKey: typeof s.apiKey === "string" ? s.apiKey : null,
      model: typeof s.model === "string" && s.model.length > 0 ? s.model : DEFAULT_AGENT_SETTINGS.model,
      maxSteps: typeof s.maxSteps === "number" && Number.isFinite(s.maxSteps) && s.maxSteps >= 0 ? Math.floor(s.maxSteps) : DEFAULT_AGENT_SETTINGS.maxSteps,
      maxTokens: typeof s.maxTokens === "number" && s.maxTokens > 0 ? Math.floor(s.maxTokens) : DEFAULT_AGENT_SETTINGS.maxTokens,
      chatToolsEnabled: s.chatToolsEnabled === true,
      reasoningModels: Array.isArray(s.reasoningModels) ? s.reasoningModels.filter((m): m is string => typeof m === "string") : [],
      streamingModels: Array.isArray(s.streamingModels) ? s.streamingModels.filter((m): m is string => typeof m === "string") : [],
      maxConsecutiveToolFailures: knob(s.maxConsecutiveToolFailures, DEFAULT_AGENT_SETTINGS.maxConsecutiveToolFailures),
      checkpointEverySteps: knob(s.checkpointEverySteps, DEFAULT_AGENT_SETTINGS.checkpointEverySteps),
      maxAgentTxPerRun: knob(s.maxAgentTxPerRun, DEFAULT_AGENT_SETTINGS.maxAgentTxPerRun),
      autoApprovePlans: s.autoApprovePlans === true,
      fullAutoMaxCycles: Math.max(1, knob(s.fullAutoMaxCycles, DEFAULT_AGENT_SETTINGS.fullAutoMaxCycles)),
      fullAutoMaxTokens: knob(s.fullAutoMaxTokens, DEFAULT_AGENT_SETTINGS.fullAutoMaxTokens),
      fullAutoObjective: typeof s.fullAutoObjective === "string" ? sanitizeObjective(s.fullAutoObjective) ?? "" : "",
      strategistEnabled: s.strategistEnabled === true,
      strategistModel: typeof s.strategistModel === "string" ? s.strategistModel.trim() : "",
    };
  } catch {
    return DEFAULT_AGENT_SETTINGS;
  }
}

export interface ChatDisplayMessage {
  id: number;
  kind: "user" | "assistant" | "reasoning" | "tool-call" | "tool-result" | "system" | "whisper";
  text: string | null;
  /** system-row severity (session-65.3, the owner's chrome round): red is
   *  reserved for HARD-STOP errors — approvals/success render ok, mode
   *  switches + fences render info/warn */
  tone?: "info" | "ok" | "warn" | "error";
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: Record<string, unknown>;
  ok?: boolean;
  /** session-64: the RunEvent tool-call id on BOTH the call and its result —
   *  the task graph folds one row per call instead of doubling */
  toolCallId?: string;
  t: number;
}

/** FULL-AUTO runtime shape (session-65): null = disengaged */
export interface FullAutoState {
  active: boolean;
  /** completed cycles (the kickoff is cycle 1) */
  cycles: number;
  /** cumulative model tokens burned while engaged (the session-68 fence meter) */
  tokens: number;
  /**
   * Session-74: the strategy-layer MENU — the last structured next-goals
   * close (the next_goals tool), carried to the next kickoff as advisory
   * data (latest wins; a cycle without a structured close keeps the last
   * recorded menu + its age).
   */
  nextGoals: string[] | null;
  nextGoalsCycle: number | null;
}

export interface AgentRuntimeState {
  settings: AgentSettings;
  setSettings(next: AgentSettings): void;
  persona: string;
  setPersona(text: string): void;
  keySource: "byok" | "dev-env" | null;
  modelList: ModelInfo[];
  modelListError: string | null;
  refreshModelList(): Promise<void>;
  keyInfo: KeyInfo | null;
  keyInfoError: string | null;
  probeKey(): Promise<void>;
  messages: ChatDisplayMessage[];
  busy: boolean;
  /**
   * The live STREAMING partial (session-75): the in-flight streamed answer
   * text, re-rendered on a frame cadence; null while not streaming. The
   * finalized assistant row replaces it atomically — the transcript (and
   * every capture surface) only ever holds whole messages.
   */
  streamPartial: string | null;
  lastError: string | null;
  sessionTokens: number;
  lastRun: AgentRunResult | null;
  runEvents: RunEvent[];
  clearConversation(): void;
  send(text: string): Promise<void>;
  /**
   * The MID-RUN WHISPER (session-65): queue an operator note while a run is
   * busy — it lands in the run's NEXT model turn as a system note, never
   * aborting the in-flight call. Outside a run it behaves like send().
   */
  whisper(text: string): void;
  abort(): void;
  /** FULL-AUTO (session-65): the mode-C self-goaling loop state + levers */
  fullAuto: FullAutoState | null;
  startFullAuto(): void;
  stopFullAuto(): void;
  /**
   * The full-auto CYCLE LEDGER (session-68): one row per completed cycle of
   * the CURRENT engagement (cleared on engage) + the closing disengage row.
   * Observability only — the transcript stays the record.
   */
  fullAutoCycles: FullAutoCycleRecord[];
  exportTranscript(): string;
  exportMarkdown(): string;
  /** §7.10 — the L1 plan levers (approve-once executes; STOP is the human's) */
  runPlan(planId: string): Promise<void>;
  stopActivePlan(): void;
  /** §7.10 journal/memory — local, user-visible, editable, wipeable */
  sessionMemory: string | null;
  memoryFacts: string;
  saveMemoryFacts(text: string): Promise<void>;
  sessionRuns: AgentRunRecord[];
  exportRuns(): string;
  wipeMemory(): Promise<void>;
  /**
   * The session's RunEvent recording (session 61): the serialized stream in
   * the fleet recording format — the in-app capture half of "recording =
   * BOTH". A local file download, never a POST; the replay flagship's input.
   */
  exportRecording(): string;
  /**
   * Agent-authored lessons (session-54): pending notes await the
   * operator's ack in SYS (persisted — the promise resolves after the IDB
   * write). Ack'd notes join the session memory through runSummaryLine;
   * dismiss removes the note from the record.
   */
  pendingNotes: PendingNote[];
  ackNote(runId: string, ack: boolean): Promise<void>;
  dismissNote(runId: string): Promise<void>;
}

export interface PendingNote {
  runId: string;
  kind: RunKind;
  goal: string;
  text: string;
  t: number;
}

const Ctx = createContext<AgentRuntimeState | null>(null);

export function AgentProvider({
  children,
  journal,
  rpcUrl,
  snapshot,
  refreshSnapshot,
}: {
  children: ReactNode;
  journal: Journal;
  rpcUrl: string;
  snapshot: PlayerSnapshot | null;
  refreshSnapshot(): void;
}) {
  const [settings, setSettingsState] = useState<AgentSettings>(loadSettings);
  const [persona, setPersonaState] = useState<string>(loadPersona);
  const [messages, setMessages] = useState<ChatDisplayMessage[]>([]);
  const [busy, setBusy] = useState(false);
  // session-75: the live streaming partial lane — deltas accumulate in the
  // REF and commit to state on a frame/rAF cadence (the 71.3
  // uncontrolled-input law analog: never a state write per chunk, never a
  // whole-stream re-render per chunk). The finalized assistant-text event
  // clears the lane and pushes the whole row in the same batch.
  const [streamPartial, setStreamPartial] = useState<string | null>(null);
  const streamPartialRef = useRef<string | null>(null);
  const streamFrameRef = useRef<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [sessionTokens, setSessionTokens] = useState(0);
  const [lastRun, setLastRun] = useState<AgentRunResult | null>(null);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [modelListError, setModelListError] = useState<string | null>(null);
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);
  const [keyInfoError, setKeyInfoError] = useState<string | null>(null);

  const historyRef = useRef<WireMessage[]>([]);
  const prevPayloadRef = useRef<Record<string, unknown> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  // session-65.2: the LIVE busy mirror — the post-run seams (plan
  // auto-approve, the FULL-AUTO cycle) call send/runPlan SYNCHRONOUSLY
  // after `setBusy(false)`, before React re-renders; a guard on the
  // captured `busy` state sees the STALE true and silently returns (the
  // owner's find: the auto-approved plan sat at the buttons until clicked).
  // Async-flow re-entrancy guards read this ref; the UI keeps the state.
  const busyRef = useRef(false);
  // session-65: the whisper queue (session-level — drained by the run's
  // next model turn, whenever that is), the FULL-AUTO loop state + its ref
  // mirror (the chat governor reads the ref, never stale closure state),
  // and the latest-fn refs for the mutually-recursive post-run seams
  // (send → plan auto-approve → full-auto cycle → send)
  const whisperRef = useRef<string[]>([]);
  const [fullAuto, setFullAuto] = useState<FullAutoState | null>(null);
  const fullAutoRef = useRef<FullAutoState | null>(null);
  // session-68: the cycle ledger (current engagement) + its appender — the
  // seams call this synchronously after the run's finally; plain setState
  // batching keeps rows ordered. The REF mirror (session-74) is the honest
  // read for async seams (the strategist) — closure state may lag the
  // just-appended row across await boundaries.
  const [fullAutoCycles, setFullAutoCycles] = useState<FullAutoCycleRecord[]>([]);
  const fullAutoCyclesRef = useRef<FullAutoCycleRecord[]>([]);
  const logCycle = useCallback((row: FullAutoCycleRecord): void => {
    fullAutoCyclesRef.current = [...fullAutoCyclesRef.current, row];
    setFullAutoCycles(fullAutoCyclesRef.current);
  }, []);
  const lastChatSendAtRef = useRef(0);
  const sendRef = useRef<(text: string) => Promise<void>>(async () => {});
  const runPlanRef = useRef<(planId: string) => Promise<void>>(async () => {});
  const ledgerRef = useRef(new RunsLedger());
  const sessionStartRef = useRef(Date.now());
  // §61 recording capture: the whole session's RunEvent stream, attributed
  // "operator" — exportRecording serializes it in the fleet format (the
  // in-app half of the owner round's "recording = BOTH" law)
  const recordingRef = useRef<RecordingWriter | null>(null);
  const turnRef = useRef(0);
  const captureEvent = useCallback((e: RunEvent): void => {
    if (recordingRef.current === null) {
      recordingRef.current = new RecordingWriter({ rpc: rpcUrl, forkBlock: null, roster: [] });
    }
    recordingRef.current.append("operator", turnRef.current, e);
  }, [rpcUrl]);
  const gate = useGate();
  const wallet = useWallet();

  // §7.10: the session memory = operator facts (live) + the PREVIOUS
  // session's runs (frozen at mount — within-session continuity is the
  // conversation itself). Built from records that never carry tool
  // args/results, so nothing injection-weighted reaches the system layer.
  const [memoryFacts, setMemoryFacts] = useState("");
  const [prevRuns, setPrevRuns] = useState<AgentRunRecord[]>([]);
  const [sessionRuns, setSessionRuns] = useState<AgentRunRecord[]>([]);
  const sessionMemory = useMemo(() => buildSessionMemory(memoryFacts, prevRuns), [memoryFacts, prevRuns]);

  useEffect(() => {
    void (async () => {
      const ledger = ledgerRef.current;
      const facts = await ledger.getFacts();
      const before = (await ledger.listRuns()).filter((r) => r.t < sessionStartRef.current);
      setMemoryFacts(facts);
      setPrevRuns(before);
    })();
  }, []);

  const recordRun = useCallback(
    async (record: Omit<AgentRunRecord, "id" | "t">): Promise<void> => {
      try {
        const saved = await ledgerRef.current.appendRun(record);
        setSessionRuns((prev) => [...prev, saved]);
      } catch {
        /* the ledger is best-effort; the run already happened */
      }
    },
    []
  );

  const resolved = resolveApiKey(settings.apiKey);
  const keySource = resolved.source;

  const setSettings = useCallback((next: AgentSettings) => {
    setSettingsState(next);
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const setPersona = useCallback((text: string) => {
    setPersonaState(text);
    savePersona(text);
  }, []);

  const refreshModelList = useCallback(async () => {
    setModelListError(null);
    try {
      setModelList(await fetchModels());
    } catch (e) {
      setModelListError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const probeKey = useCallback(async () => {
    setKeyInfoError(null);
    const key = resolveApiKey(settings.apiKey).key;
    if (key === null) {
      setKeyInfo(null);
      setKeyInfoError("no key configured");
      return;
    }
    try {
      setKeyInfo(await fetchKeyInfo({ apiKey: key }));
    } catch (e) {
      setKeyInfo(null);
      setKeyInfoError(e instanceof Error ? e.message : String(e));
    }
  }, [settings.apiKey]);

  const push = useCallback((m: Omit<ChatDisplayMessage, "id" | "t">): void => {
    setMessages((prev) => [...prev, { ...m, id: nextId.current++, t: Date.now() }]);
  }, []);

  // ---- session-75: the streaming partial lane's commit/clear discipline ----
  const flushStreamPartial = useCallback((): void => {
    streamFrameRef.current = null;
    setStreamPartial(streamPartialRef.current);
  }, []);

  const scheduleStreamFlush = useCallback((): void => {
    if (streamFrameRef.current !== null) return; // one frame in flight — deltas coalesce
    const schedule: (cb: () => void) => number =
      typeof requestAnimationFrame === "function" ? (cb) => requestAnimationFrame(cb) : (cb) => window.setTimeout(cb, 16) as unknown as number;
    streamFrameRef.current = schedule(flushStreamPartial);
  }, [flushStreamPartial]);

  const clearStreamLane = useCallback((): void => {
    if (streamFrameRef.current !== null) {
      const cancel: (id: number) => void =
        typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : (id) => window.clearTimeout(id) as unknown as void;
      cancel(streamFrameRef.current);
      streamFrameRef.current = null;
    }
    streamPartialRef.current = null;
    setStreamPartial(null);
  }, []);

  /** abort/error mid-stream: the partial IS said text — keep it as a row */
  const finalizeStreamLane = useCallback((): void => {
    const partial = streamPartialRef.current;
    clearStreamLane();
    if (partial !== null && partial.trim().length > 0) {
      push({ kind: "assistant", text: `${partial}\n[stream stopped mid-generation]` });
    }
  }, [clearStreamLane, push]);

  const buildToolCtx = useCallback(
    (): AgentToolContext & { collectNote(): string | null; collectNextGoals(): string[] | null } => {
      // §7.8 L2: the per-RUN send budget — every gate send ATTEMPT counts
      // (denials included); beyond the cap the wrapper refuses without ever
      // touching the gate. Tighten-only: the gate's own session/day policy
      // caps still apply on top, and no knob can bypass an approval card.
      let runTx = 0;
      // §7.10: the per-RUN note collector (journal_note) — attached to the
      // run record when the run completes, PENDING operator ack; a fresh
      // ctx per run keeps notes run-scoped (last call wins)
      let runNote: string | null = null;
      // session-74: the per-RUN next-goals collector (next_goals) — the
      // full-auto seam attaches the collected menu to the cycle's ledger
      // row and feeds the next kickoff; fresh ctx per run (last call wins)
      let runNextGoals: string[] | null = null;
      return {
        rpcUrl,
        account: (wallet.account as Address | null) ?? null,
        snapshot,
        journal,
        walletMode: wallet.mode,
        chatToolsEnabled: settings.chatToolsEnabled,
        simToolsEnabled: simLayerActive(rpcUrl),
        // session-66: the captured DSS (state/dssStore — read live at ctx
        // build; the store has no getter onchain)
        dss: dssOf(wallet.account as Address | null)?.dss ?? null,
        gateDryRun: (request) => gate.dryRun(request),
        gateSend: async (request) => {
          runTx += 1;
          if (settings.maxAgentTxPerRun > 0 && runTx > settings.maxAgentTxPerRun) {
            journal.emit("agent.tool", "run tx cap reached (L2 knob)", { runTx, cap: settings.maxAgentTxPerRun });
            // refuses BEFORE the gate — surfaces as a failed tool result the
            // model sees (and the consecutive-failure knob can stop on)
            throw new Error(`agent run tx cap reached (${settings.maxAgentTxPerRun} — L2 knob, SETTINGS → Agent)`);
          }
          return gate.send(request);
        },
        refreshSnapshot,
        takeNote: (text: string) => {
          runNote = text;
          journal.emit("agent.tool", "journal_note recorded (pending operator ack)", { noteChars: text.length });
        },
        collectNote: () => runNote,
        takeNextGoals: (goals: string[]) => {
          runNextGoals = goals;
          journal.emit("agent.tool", "next_goals recorded (the cycle's structured close)", { count: goals.length });
        },
        collectNextGoals: () => runNextGoals,
        // the §7.4 chat cadence governor (session-65): binds ONLY while
        // FULL-AUTO is engaged — min-interval between chat SENDS, no spray.
        // DRYRUNs pass free (only real send intent consumes cadence); a
        // refusal names the wait so the model can plan around it honestly.
        chatGate: (send: boolean) => {
          if (fullAutoRef.current === null || !send) return { ok: true };
          const now = Date.now();
          const elapsed = now - lastChatSendAtRef.current;
          if (lastChatSendAtRef.current > 0 && elapsed < FULL_AUTO_CHAT_MIN_INTERVAL_MS) {
            const waitSec = Math.ceil((FULL_AUTO_CHAT_MIN_INTERVAL_MS - elapsed) / 1000);
            journal.emit("agent.tool", `chat cadence governor: refused (${waitSec}s to the window)`, {});
            return { ok: false, error: `FULL-AUTO chat cadence governor: last chat send was ${Math.floor(elapsed / 1000)}s ago — wait ~${waitSec}s before the next (no spray; continue other work)` };
          }
          lastChatSendAtRef.current = now;
          return { ok: true };
        },
      };
    },
    [rpcUrl, wallet.account, wallet.mode, snapshot, journal, settings.chatToolsEnabled, settings.maxAgentTxPerRun, gate, refreshSnapshot]
  );

  // ---- session-74: the unified FULL-AUTO continuation seam ----
  // Both post-cycle paths (the run seam + the plan seam) land here after
  // logging their cycle row: the fences decide disengage-vs-continue; a
  // continue (a) carries the menu forward (latest wins), (b) optionally
  // runs the STRATEGIST window (one bounded read-only call, opt-in — holds
  // the busy mirror so no manual send interleaves the kickoff), then
  // (c) kicks the next cycle with the objective + menu (+ the pick).
  const continueFullAuto = useCallback(
    async (a: {
      cycles: number;
      verdictStatus: AgentRunResult["status"];
      executorTokens: number;
      /** this cycle's structured close — null keeps the last recorded menu */
      menu: string[] | null;
    }): Promise<void> => {
      const fa = fullAutoRef.current;
      if (fa === null) return; // disengage handled by the caller
      const verdict = fullAutoContinues(a.verdictStatus, a.cycles, settings.fullAutoMaxCycles);
      const cumulative = fa.tokens + a.executorTokens;
      const fence = verdict.next ? fullAutoTokenFence(cumulative, settings.fullAutoMaxTokens) : { stop: false, reason: null };
      const stopReason = !verdict.next ? verdict.reason : fence.stop ? fence.reason : null;
      if (stopReason !== null) {
        setFullAuto(null);
        fullAutoRef.current = null;
        push({ kind: "system", tone: "warn", text: `[FULL-AUTO disengaged — ${stopReason}.]` });
        logCycle({ n: a.cycles, kind: "disengage", status: stopReason, tokens: 0, toolCalls: 0, toolErrors: 0, sends: 0, summary: null, goals: null, t: Date.now() });
        return;
      }
      const nextGoals = a.menu ?? fa.nextGoals;
      const nextGoalsCycle = a.menu !== null ? a.cycles : fa.nextGoalsCycle;
      // the strategist window (opt-in): one bounded read-only call between
      // cycles. The busy mirror holds the pane through it; the operator's
      // STOP still kills the loop (the post-window ref check closes the
      // ledger honestly) and aborts the in-flight call (abortRef).
      let goal: string | null = null;
      let stratTokens = 0;
      const keyNow = resolved.key;
      if (settings.strategistEnabled && settings.strategistModel.length > 0 && keyNow !== null) {
        const ac = new AbortController();
        abortRef.current = ac;
        busyRef.current = true;
        setBusy(true);
        try {
          const r = await runStrategist({
            apiKey: keyNow,
            apiKeySource: resolved.source,
            model: settings.strategistModel,
            persona,
            objective: sanitizeObjective(settings.fullAutoObjective),
            menu: nextGoals,
            menuCycle: nextGoalsCycle,
            ledger: fullAutoCyclesRef.current,
            nextCycle: a.cycles + 1,
            snapshot,
            toolCtx: buildToolCtx(),
            signal: ac.signal,
            journal,
          });
          stratTokens = r.tokens;
          if (r.goal !== null) goal = r.goal;
          if (fullAutoRef.current === null) {
            // STOP during the window — the loop is dead; close the ledger
            logCycle({ n: a.cycles, kind: "disengage", status: "operator STOP during the strategist window", tokens: 0, toolCalls: 0, toolErrors: 0, sends: 0, summary: null, goals: null, t: Date.now() });
            return;
          }
          if (goal !== null) {
            push({ kind: "system", tone: "ok", text: `[STRATEGIST cycle ${a.cycles + 1} — picked: ${goal} (${r.tokens} tok)]` });
          } else {
            push({ kind: "system", tone: "warn", text: `[STRATEGIST fell back to self-goaling — ${r.error ?? "no pick"}]` });
          }
        } catch (e) {
          if (fullAutoRef.current === null) {
            logCycle({ n: a.cycles, kind: "disengage", status: "operator STOP during the strategist window", tokens: 0, toolCalls: 0, toolErrors: 0, sends: 0, summary: null, goals: null, t: Date.now() });
            return;
          }
          push({ kind: "system", tone: "warn", text: `[STRATEGIST fell back to self-goaling — ${e instanceof Error ? e.message : String(e)}]` });
        } finally {
          abortRef.current = null;
          busyRef.current = false; // the LIVE mirror — cleared before the kickoff send
          setBusy(false);
        }
      }
      const cumulativeWithStrategist = cumulative + stratTokens;
      fullAutoRef.current = { active: true, cycles: a.cycles, tokens: cumulativeWithStrategist, nextGoals, nextGoalsCycle };
      setFullAuto(fullAutoRef.current);
      // the kickoff names the cycle STARTING now (cycles = completed)
      push({
        kind: "system",
        tone: "info",
        text:
          goal !== null
            ? `[FULL-AUTO cycle ${a.cycles + 1} — the strategist picked the goal.]`
            : `[FULL-AUTO cycle ${a.cycles + 1} — the agent picks the next goal.]`,
      });
      void sendRef.current(
        fullAutoCycleText(a.cycles + 1, { objective: settings.fullAutoObjective, menu: nextGoals, menuCycle: nextGoalsCycle, goal })
      );
    },
    [settings.fullAutoMaxCycles, settings.fullAutoMaxTokens, settings.fullAutoObjective, settings.strategistEnabled, settings.strategistModel, resolved.key, resolved.source, persona, snapshot, buildToolCtx, journal, push, logCycle]
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      // busyRef (the live mirror — the post-run seams call this before the
      // re-render; the state would still read true and eat the cycle)
      if (trimmed.length === 0 || busyRef.current) return;
      if (resolved.key === null) {
        push({ kind: "system", tone: "error", text: "[ERROR] no API key — SETTINGS → Agent (BYOK field), or app/.env for dev runs. Manual views + the tx gate cover everything meanwhile." });
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setLastError(null);
      setRunEvents([]);
      clearStreamLane(); // a fresh run starts with an empty partial lane
      push({ kind: "user", text: trimmed });
      const ac = new AbortController();
      abortRef.current = ac;
        // session-68: the engagement snapshot at run entry (STOP/disengage
        // mid-run nulls the live ref — the seam still owes the ledger its
        // row) + the per-cycle trackers the seam folds into the ledger
        const faAtStart = fullAutoRef.current;
        let cycleSends = 0;
        let cycleSummary: string | null = null;
        const toolCtx = buildToolCtx();
        turnRef.current += 1;
        let runResult: AgentRunResult | null = null;
        try {
          const result = await runAgent({
            apiKey: resolved.key,
            apiKeySource: resolved.source,
            model: settings.model,
            persona,
            sessionMemory,
            history: windowHistory(historyRef.current),
            userText: trimmed,
            snapshot,
            pendingLau: pendingLauValue(wallet.account)?.lau ?? null,
            previousPayload: prevPayloadRef.current,
            toolCtx,
            budget: { maxSteps: settings.maxSteps, maxTokens: settings.maxTokens },
            autonomy: {
              maxConsecutiveToolFailures: settings.maxConsecutiveToolFailures,
              checkpointEverySteps: settings.checkpointEverySteps,
            },
            reasoning: settings.reasoningModels.includes(settings.model),
            streaming: settings.streamingModels.includes(settings.model),
            takeWhisper: () => whisperRef.current.shift() ?? null,
            signal: ac.signal,
            journal,
            onEvent: (e) => {
              // session-75: text deltas ride ONLY this pane's live partial
              // lane — the runEvents array, the recording capture, and the
              // deck bus stay WHOLE-MESSAGE (the finalized assistant-text
              // is the record; the recording never carries a delta)
              if (e.type === "assistant-text-delta") {
                streamPartialRef.current = (streamPartialRef.current ?? "") + e.text;
                scheduleStreamFlush();
                return;
              }
              setRunEvents((prev) => [...prev, e]);
              captureEvent(e);
              // the lifted §7.11 bus: app-global surfaces (the DECK) subscribe
              emitRunEvent(e);
            if (e.type === "assistant-text") {
              // the atomic finalize: the partial lane clears and the whole
              // row lands in ONE batched render
              clearStreamLane();
              push({ kind: "assistant", text: e.text });
            }
            if (e.type === "assistant-reasoning") push({ kind: "reasoning", text: e.text });
            if (e.type === "tool-call") push({ kind: "tool-call", text: null, toolName: e.name, toolArgs: e.args, toolCallId: e.id });
            if (e.type === "tool-result") {
              push({ kind: "tool-result", text: null, toolName: e.name, toolResult: e.result, ok: e.ok, toolCallId: e.id });
              // the session-68 cycle trackers: gate sends that landed + the
              // agent's own closing text (the ledger's summary line)
              if (e.result?.status === "sent") cycleSends += 1;
            }
            if (e.type === "assistant-text" && e.text.trim().length > 0) cycleSummary = e.text;
            if (e.type === "budget-stop") push({ kind: "system", tone: "error", text: `[BUDGET] ${e.reason} — caps are in SETTINGS → Agent` });
            if (e.type === "checkpoint") push({ kind: "system", tone: "info", text: `[CHECKPOINT] ${e.steps} model turns used — say "continue" to proceed (L2 cadence knob)` });
            if (e.type === "whisper") push({ kind: "system", tone: "info", text: `[WHISPER delivered to the running turn] ${e.text}` });
            if (e.type === "error") {
              finalizeStreamLane(); // a mid-stream failure keeps the partial as a said row
              push({ kind: "system", tone: "error", text: `[ERROR] ${e.ownerLine ?? e.message}` });
            }
            if (e.type === "aborted") {
              finalizeStreamLane(); // STOP mid-generation: the partial stays
              push({ kind: "system", tone: "error", text: "[ERROR] User aborted agent execution." });
            }
          },
        });
        runResult = result;
        setSessionTokens((n) => n + result.tokens);
        setLastRun(result);
        if (result.status === "error" && result.error !== null) setLastError(result.error);
        // §7.10: every completed turn is a run — goal → steps → outcome →
        // lesson (code-derived) + the agent's journal_note, if any, PENDING
        // operator ack in SYS
        if (result.status !== "aborted") {
          const noteText = toolCtx.collectNote();
          void recordRun({
            kind: "turn",
            goal: trimmed,
            outcome: result.status === "error" ? "error" : result.status,
            lesson:
              result.status === "budget-stop"
                ? "budget stop — raise caps in SETTINGS → Agent for longer runs"
                : result.status === "checkpoint"
                  ? "checkpoint pause — resumable with 'continue'"
                  : result.status === "error"
                    ? (result.error ?? "run error").slice(0, 160)
                    : null,
            note: noteText !== null ? { text: noteText, ack: false } : null,
            steps: result.toolCalls.map((c) => ({ tool: c.name, ok: c.ok })),
            tokens: result.tokens,
          });
        }
        // carry the wire history forward (windowed); drop tool payloads from
        // the older turns' context weight by keeping them verbatim — capped
        // at the tool layer already
        historyRef.current = result.messages.filter((m) => m.role !== "system");
        if (snapshot !== null) {
          prevPayloadRef.current = JSON.parse(
            JSON.stringify({
              v: 1,
              acct: snapshot.account,
              lau: snapshot.lau,
              yue: snapshot.yue,
              user: snapshot.username,
              lauSym: snapshot.lauSymbol,
              pls: [snapshot.balances.pls.wallet.toString(), snapshot.balances.pls.lau.toString(), snapshot.balances.pls.yue.toString()],
              a: [snapshot.balances.affection.wallet.toString(), snapshot.balances.affection.lau.toString(), snapshot.balances.affection.yue.toString()],
              choa: [snapshot.balances.choa.wallet.toString(), snapshot.balances.choa.lau.toString(), snapshot.balances.choa.yue.toString()],
              yuanChoa: snapshot.yuanChoa.toString(),
              blk: snapshot.blockNumber !== null ? snapshot.blockNumber.toString() : null,
            })
          ) as Record<string, unknown>;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setLastError(msg);
        push({ kind: "system", tone: "error", text: `[ERROR] ${msg}` });
      } finally {
        abortRef.current = null;
        busyRef.current = false; // the LIVE mirror — cleared before the seam below
        setBusy(false);
      }
      // ---- the POST-RUN seam (session-65; the session-68 ledger + fences) ----
      // 1. plan auto-approve (mode C + the toggle): a plan this run proposed
      //    answers its one-gate YES — the checklist executes, sends still
      //    resolve through THE gate.
      // 2. else FULL-AUTO: only a CLEAN done (under the cycle + session-token
      //    caps) continues the loop.
      if (runResult !== null) {
        const plan = currentPlan();
        if (plan !== null && plan.status === "proposed" && settings.autoApprovePlans && wallet.mode === "C") {
          push({ kind: "system", tone: "ok", text: "PLAN auto-approved (mode C toggle — SETTINGS → Agent); executing the checklist. Sends still pass the gate." });
          void runPlanRef.current(plan.id);
          return;
        }
        const fa = fullAutoRef.current;
        if (fa !== null || faAtStart !== null) {
          const cycles = (fa ?? faAtStart)!.cycles + 1;
          // TS can't see the closure mutations — widen the tracker reads
          const summaryNow = cycleSummary as string | null;
          // session-74: the cycle's structured close (the next_goals
          // collector — last call wins, fresh ctx per run)
          const menuNow = toolCtx.collectNextGoals();
          // the ledger row FIRST — every cycle that RAN under full-auto lands,
          // whatever the verdict (the transcript stays the record; this is the
          // observability layer)
          logCycle({
            n: cycles,
            kind: "run",
            status: runResult.status,
            tokens: runResult.tokens,
            toolCalls: runResult.toolCalls.length,
            toolErrors: runResult.toolCalls.filter((c) => !c.ok).length,
            sends: cycleSends,
            summary: summaryNow !== null ? summaryNow.slice(0, 160) : null,
            goals: menuNow,
            t: Date.now(),
          });
          if (fa === null) {
            // disengaged mid-run (STOP / the FULL-AUTO button / clear) — the
            // cycle still closes out in the ledger, the loop does not continue
            logCycle({
              n: cycles,
              kind: "disengage",
              status: runResult.status === "aborted" ? "operator STOP" : "operator disengaged mid-cycle (the run finished)",
              tokens: 0,
              toolCalls: 0,
              toolErrors: 0,
              sends: 0,
              summary: null,
              goals: null,
              t: Date.now(),
            });
            return;
          }
          await continueFullAuto({ cycles, verdictStatus: runResult.status, executorTokens: runResult.tokens, menu: menuNow });
        }
      }
    },
    [resolved.key, resolved.source, settings.model, settings.maxSteps, settings.maxTokens, settings.maxConsecutiveToolFailures, settings.checkpointEverySteps, settings.reasoningModels, settings.streamingModels, settings.autoApprovePlans, settings.fullAutoMaxCycles, settings.fullAutoMaxTokens, persona, snapshot, wallet.account, wallet.mode, sessionMemory, buildToolCtx, journal, push, recordRun, captureEvent, logCycle, continueFullAuto, clearStreamLane, scheduleStreamFlush, finalizeStreamLane]
  );

  const abort = useCallback(() => {
    // the operator's STOP ends FULL-AUTO too — the loop's one human lever
    if (fullAutoRef.current !== null) {
      fullAutoRef.current = null;
      setFullAuto(null);
    }
    abortRef.current?.abort();
  }, []);

  // the mid-run whisper: queue + a pane row; the graph drains it into the
  // next model turn (sendRef/send() outside a busy run behaves normally).
  // Session-74: an `objective:` whisper is ALSO the live steering path — the
  // stored objective updates (persisted, app-global) and the note still
  // queues so the running turn sees the operator say it; every kickoff from
  // the next cycle carries the new objective.
  const whisper = useCallback(
    (text: string): void => {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      const ow = parseObjectiveWhisper(trimmed);
      if (ow !== null) {
        setSettings({ ...settings, fullAutoObjective: ow.kind === "set" ? ow.objective : "" });
        push({
          kind: "system",
          tone: "ok",
          text:
            ow.kind === "set"
              ? `[OBJECTIVE updated — every kickoff from the next cycle carries it: ${ow.objective}]`
              : "[OBJECTIVE cleared — cycles self-goal again]",
        });
      }
      if (!busy) {
        void sendRef.current(trimmed);
        return;
      }
      whisperRef.current = [...whisperRef.current, trimmed];
      push({ kind: "whisper", text: trimmed });
    },
    [busy, push, settings, setSettings]
  );

  // ---- FULL-AUTO (session-65): the mode-C self-goaling loop ----

  const startFullAuto = useCallback(() => {
    if (busy || fullAutoRef.current !== null) return;
    if (wallet.mode !== "C") return; // mode C + explicit opt-in only
    if (resolved.key === null) return;
    const state: FullAutoState = { active: true, cycles: 0, tokens: 0, nextGoals: null, nextGoalsCycle: null };
    fullAutoRef.current = state;
    setFullAuto(state);
    fullAutoCyclesRef.current = []; // the ledger documents ONE engagement
    setFullAutoCycles(fullAutoCyclesRef.current);
    lastChatSendAtRef.current = 0; // a fresh cadence window per engagement
    // session-74: the engagement row names the OBJECTIVE (the strategy
    // boundary) — or its honest absence
    const objective = sanitizeObjective(settings.fullAutoObjective);
    push({
      kind: "system",
      tone: "info",
      text:
        objective !== null
          ? `[FULL-AUTO engaged — mode C, objective: ${objective}. STOP or any spend/failure fence disengages; whisper to steer mid-run (objective: … re-aims).]`
          : "[FULL-AUTO engaged — mode C, self-goaling cycles; no objective set (the pane field or SETTINGS → Agent); STOP or any spend/failure fence disengages. Whisper to steer mid-run.]",
    });
    void sendRef.current(fullAutoKickoffText({ objective }));
  }, [busy, wallet.mode, resolved.key, settings.fullAutoObjective, push]);

  const stopFullAuto = useCallback(() => {
    if (fullAutoRef.current === null) return;
    fullAutoRef.current = null;
    setFullAuto(null);
    push({ kind: "system", tone: "info", text: "[FULL-AUTO disengaged — the current run finishes; no further cycles.]" });
  }, [push]);

  // ---- L1 plan execution (§7.8/§7.11.4): the approve-once path ----

  const runPlan = useCallback(
    async (planId: string): Promise<void> => {
      const plan = currentPlan();
      // busyRef (the live mirror — the auto-approve seam calls this in the
      // same tick as the run-end finally; the captured state still says
      // busy and silently ate the auto-approval — the owner's 65.2 find)
      if (plan === null || plan.id !== planId || busyRef.current) return;
      if (!approvePlan(planId)) return;
      busyRef.current = true;
      setBusy(true);
      setLastError(null);
      const ac = new AbortController();
      abortRef.current = ac;
      push({ kind: "system", tone: "ok", text: `PLAN approved — executing ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"} (${plan.steps.filter((s) => s.sends).length} SEND). STOP halts between steps.` });
      // session-68: the engagement snapshot + the plan-cycle trackers (a
      // full-auto cycle whose work was the auto-approved plan — zero model
      // turns, sends counted from the step results)
      const faAtStart = fullAutoRef.current;
      let planSends = 0;
      let planDone = false;
      let planSteps = 0;
      let planErrors = 0;
      try {
        // journal_note is fenced out of plan steps (planTools), so the
        // collector stays empty here — wired anyway so the record shape is
        // one path, not two
        const toolCtx = buildToolCtx();
        const result = await executePlan(plan, toolCtx, journal, ac.signal, {
          onEvent: (e) => {
            setRunEvents((prev) => [...prev, e]);
            captureEvent(e);
            if (e.type === "tool-call") push({ kind: "tool-call", text: null, toolName: e.name, toolArgs: e.args, toolCallId: e.id });
            if (e.type === "tool-result") {
              push({ kind: "tool-result", text: null, toolName: e.name, toolResult: e.result, ok: e.ok, toolCallId: e.id });
              if (e.result?.status === "sent") planSends += 1;
            }
          },
        });
        if (result.status === "done") {
          push({ kind: "system", tone: "ok", text: `PLAN done — ${result.steps.length} step${result.steps.length === 1 ? "" : "s"} ok.` });
        } else {
          push({ kind: "system", tone: "warn", text: `PLAN STOPPED — ${result.stopReason ?? "stop-condition"} — rolled back to L0 (one action per approval).` });
        }
        const planNote = toolCtx.collectNote();
        void recordRun({ ...result.record, note: planNote !== null ? { text: planNote, ack: false } : null });
        planDone = result.status === "done";
        planSteps = result.record.steps.length;
        planErrors = result.record.steps.filter((s) => !s.ok).length;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setLastError(msg);
        push({ kind: "system", tone: "error", text: `[ERROR] plan execution failed: ${msg} — rolled back to L0.` });
      } finally {
        abortRef.current = null;
        busyRef.current = false; // the live mirror — cleared before the seam
        setBusy(false);
      }
      // the post-PLAN seam (session-65 + the 68 ledger/fences): a finished
      // plan was a cycle's work — FULL-AUTO continues with the next cycle (a
      // stopped plan disengages). Runs AFTER the finally so the chained send
      // passes the busy mirror.
      if (faAtStart !== null) {
        const fa = fullAutoRef.current;
        const cycles = (fa ?? faAtStart).cycles + 1;
        logCycle({
          n: cycles,
          kind: "plan",
          status: planDone ? "plan done" : "plan stopped",
          tokens: 0, // zero model turns — the plan runner is deterministic
          toolCalls: planSteps,
          toolErrors: planErrors,
          sends: planSends,
          summary: planDone ? `auto-approved plan — ${planSteps} steps` : "auto-approved plan — stopped",
          goals: null, // next_goals is fenced out of plan steps — the menu carries over unchanged
          t: Date.now(),
        });
        if (fa === null) {
          logCycle({ n: cycles, kind: "disengage", status: "operator disengaged mid-plan", tokens: 0, toolCalls: 0, toolErrors: 0, sends: 0, summary: null, goals: null, t: Date.now() });
          return;
        }
        await continueFullAuto({ cycles, verdictStatus: planDone ? "done" : "budget-stop", executorTokens: 0, menu: null });
      }
    },
    [buildToolCtx, journal, push, recordRun, captureEvent, logCycle, settings.fullAutoMaxCycles, settings.fullAutoMaxTokens, continueFullAuto]
  );

  // the latest-fn refs for the mutually-recursive seams (send ⇄ runPlan)
  sendRef.current = send;
  runPlanRef.current = runPlan;

  const stopActivePlan = useCallback((): void => {
    stopPlan("user STOP");
  }, []);

  const clearConversation = useCallback(() => {
    historyRef.current = [];
    prevPayloadRef.current = null;
    whisperRef.current = [];
    fullAutoRef.current = null;
    setFullAuto(null);
    fullAutoCyclesRef.current = [];
    setFullAutoCycles([]);
    setMessages([]);
    setRunEvents([]);
    setLastRun(null);
    clearStreamLane();
  }, [clearStreamLane]);

  const exportTranscript = useCallback((): string => {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        model: settings.model,
        keySource,
        sessionTokens,
        messages,
        lastRun,
      },
      null,
      2
    );
  }, [settings.model, keySource, sessionTokens, messages, lastRun]);

  const exportMarkdown = useCallback((): string => {
    const lines = [`# agent run transcript`, ``, `- model: ${settings.model}`, `- key source: ${keySource ?? "none"}`, `- session tokens: ${sessionTokens}`, `- exported: ${new Date().toISOString()}`, ``];
    for (const m of messages) {
      if (m.kind === "user") lines.push(`## user`, ``, m.text ?? "", ``);
      else if (m.kind === "assistant") lines.push(`## assistant`, ``, m.text ?? "", ``);
      else if (m.kind === "tool-call") lines.push(`### tool → ${m.toolName}`, ``, "```json", JSON.stringify(m.toolArgs ?? {}, null, 2), "```", ``);
      else if (m.kind === "tool-result") lines.push(`#### result (${m.ok === false ? "error" : "ok"})`, ``, "```json", JSON.stringify(m.toolResult ?? {}, null, 2), "```", ``);
      else lines.push(`> ${m.text ?? ""}`, ``);
    }
    return lines.join("\n");
  }, [settings.model, keySource, sessionTokens, messages]);

  // ---- §7.10 memory surfaces ----

  const saveMemoryFacts = useCallback(
    async (text: string): Promise<void> => {
      setMemoryFacts(text);
      await ledgerRef.current.setFacts(text); // resolves when the IDB write lands
    },
    []
  );

  const exportRuns = useCallback((): string => {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        memoryFacts,
        sessionRuns,
        knownRuns: sessionRuns.length,
        note: "§7.10 run ledger export (local file, never a POST). Steps carry tool names + outcomes only — injection-weighted payloads stay out.",
      },
      null,
      2
    );
  }, [memoryFacts, sessionRuns]);

  const exportRecording = useCallback((): string => {
    // the session capture as it stands (un-finished — the session continues)
    const rec = recordingRef.current?.current() ?? null;
    return serializeRecording(
      rec !== null
        ? { ...rec, finished: new Date().toISOString() }
        : new RecordingWriter({ rpc: rpcUrl, forkBlock: null, roster: [] }).current()
    );
  }, [rpcUrl]);

  const wipeMemory = useCallback(async (): Promise<void> => {
    await ledgerRef.current.wipe();
    setMemoryFacts("");
    setPrevRuns([]);
    setSessionRuns([]);
  }, []);

  // ---- agent-authored lessons (§7.10, session-54): the review gate ----

  const pendingNotes = useMemo<PendingNote[]>(
    () =>
      [...prevRuns, ...sessionRuns]
        .filter((r) => r.note !== null && r.note !== undefined && r.note.ack !== true)
        .map((r) => ({ runId: r.id, kind: r.kind, goal: r.goal, text: r.note!.text, t: r.t })),
    [prevRuns, sessionRuns]
  );

  const patchRuns = useCallback((runId: string, fn: (r: AgentRunRecord) => AgentRunRecord): void => {
    const patch = (rs: AgentRunRecord[]): AgentRunRecord[] => rs.map((r) => (r.id === runId ? fn(r) : r));
    setPrevRuns(patch);
    setSessionRuns(patch);
  }, []);

  const ackNote = useCallback(
    async (runId: string, ack: boolean): Promise<void> => {
      await ledgerRef.current.setNoteAck(runId, ack); // persisted-ack: resolves after the IDB write (the saveMemoryFacts pattern)
      patchRuns(runId, (r) => (r.note ? { ...r, note: { ...r.note, ack } } : r));
    },
    [patchRuns]
  );

  const dismissNote = useCallback(
    async (runId: string): Promise<void> => {
      await ledgerRef.current.clearNote(runId);
      patchRuns(runId, (r) => ({ ...r, note: null }));
    },
    [patchRuns]
  );

  const api: AgentRuntimeState = {
    settings,
    setSettings,
    persona,
    setPersona,
    keySource,
    modelList,
    modelListError,
    refreshModelList,
    keyInfo,
    keyInfoError,
    probeKey,
    messages,
    busy,
    streamPartial,
    lastError,
    sessionTokens,
    lastRun,
    runEvents,
    clearConversation,
    send,
    whisper,
    abort,
    fullAuto,
    startFullAuto,
    stopFullAuto,
    fullAutoCycles,
    exportTranscript,
    exportMarkdown,
    runPlan,
    stopActivePlan,
    sessionMemory,
    memoryFacts,
    saveMemoryFacts,
    sessionRuns,
    exportRuns,
    exportRecording,
    wipeMemory,
    pendingNotes,
    ackNote,
    dismissNote,
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAgent(): AgentRuntimeState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAgent outside AgentProvider");
  return v;
}
