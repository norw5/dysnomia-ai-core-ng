import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http } from "viem";
import { pulsechain } from "@/chain/client";
import { loadPlayerSnapshot } from "@/chain/identity";
import { FACTS } from "@/chain/facts";
import { DEFAULT_POLICY, freshCounters, type SessionDayCounters } from "@/chain/policy";
import { dryRun, sendTransaction, type GateClient, type GateDeps, type GateRequest } from "@/chain/txGate";
import { simLayerActive } from "@/chain/simMode";
import { setCurrentVenue } from "@/state/venueStore";
import { runAgent, windowHistory } from "@/agent/graph";
import type { AgentToolContext } from "@/agent/tools";
import { RecordingWriter, parseRecording, type Recording } from "@/agent/recording";
import { loadFleetStates } from "@/chain/fleetReads";
import { scoreRowToJson } from "@/chain/fleetScore";
import {
  RunnerJournal,
  emptySession,
  parseDrivePlan,
  parseFetchScript,
  parseSession,
  recordedApproval,
  scriptedChatFetch,
  type DrivePlan,
} from "@/runner/drive";

/**
 * The headless fleet runner entry (session 61 — the owner round's
 * HEADLESS-DRIVE + OBSERVER decision). ONE process drives N roster agents
 * through the SAME app stack — runAgent (the graph + budgets + §7.8 knobs),
 * the full tool catalog, and THE tx gate (policy → DRYRUN → approval →
 * send → journal) — imported, never re-implemented. The approval card is
 * answered by the RECORDED policy block (a DRIVER choice at the
 * approve-callback seam; txGate itself is untouched).
 *
 * The python harbormaster (harness/agent_runner.py --first-contact /
 * --flagship) orchestrates: it spawns this entry per round with a drive
 * plan (roster + prompts — session-62 rows may carry a per-agent `tools`
 * subset, the capability asymmetry), a SCRIPTED fetch when the harness
 * needs determinism (the model rides the real adapter, answered at the
 * fetch boundary), and shuttles the session histories + the append-only
 * RECORDING (62's replay input) between rounds. A four-pillar score
 * snapshot composes onto the merged recording after every invocation (the
 * per-round snapshot law). Live runs (no script) use the real OpenRouter
 * key from the environment — never from any file this tool writes.
 *
 * Usage (after `npm run runner:build` → harness/runner/entry.mjs):
 *   node entry.mjs drive   --plan plan.json [--fetch-script s.json]
 *                          --recording rec.json --session sess.json --result out.json
 *   node entry.mjs score   --plan plan.json --recording rec.json --result score.json
 */

interface Args {
  mode: "drive" | "score";
  plan: string;
  fetchScript: string | null;
  recording: string;
  session: string;
  result: string;
}

function parseArgs(argv: string[]): Args {
  const mode = argv[0] === "score" ? "score" : "drive";
  const get = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && i + 1 < argv.length ? (argv[i + 1] as string) : null;
  };
  const plan = get("plan");
  const recording = get("recording");
  const result = get("result");
  if (plan === null) throw new Error("--plan is required");
  if (recording === null) throw new Error("--recording is required");
  if (result === null) throw new Error("--result is required");
  return {
    mode,
    plan,
    fetchScript: get("fetch-script"),
    recording,
    session: get("session") ?? `${recording}.session.json`,
    result,
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function writeJson(path: string, doc: unknown): void {
  writeFileSync(path, JSON.stringify(doc));
}

/** append an invocation's capture onto an existing recording (index-shifted, pure) */
function mergeRecordings(base: Recording, add: Recording): Recording {
  const offset = base.events.length;
  return {
    ...base,
    events: [...base.events, ...add.events.map((ev, i) => ({ ...ev, i: offset + i }))],
    scores: [...base.scores, ...add.scores.map((s) => ({ ...s, atEvent: s.atEvent + offset }))],
    finished: add.finished,
  };
}

function chain369() {
  // the app's own chain def (multicall3 wired from config — the runner must
  // resolve the SAME infra the app's snapshot reads ride on)
  return pulsechain;
}

let plan: DrivePlan;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  plan = parseDrivePlan(readJson(args.plan));
  const journal = new RunnerJournal();
  // a fork-local public client: same chain + batching as makeClient, but a
  // 1s poll — the app's 12s interval would drag receipt waits on anvil
  const chain = chain369();
  const client = createPublicClient({ chain, transport: http(plan.rpc, { batch: true }), pollingInterval: 1_000 });

  if (args.mode === "score") {
    const rec = parseRecording(readFileSync(args.recording, "utf8"));
    const composed = await loadFleetStates(client, rec.roster, rec);
    writeJson(args.result, {
      rows: composed.rows.map(scoreRowToJson),
      ranked: composed.ranked.map((r) => r.agent),
      errors: composed.errors,
      atEvent: rec.events.length - 1,
    });
    console.log(JSON.stringify({ mode: "score", agents: composed.rows.length, errors: composed.errors.length }));
    return 0;
  }

  // ---- drive mode ----
  const session = existsSync(args.session) ? parseSession(readJson(args.session), plan.roster.map((r) => r.name)) : emptySession(plan.roster.map((r) => r.name));
  const baseRecording: Recording | null = existsSync(args.recording) ? parseRecording(readFileSync(args.recording, "utf8")) : null;
  const writer = new RecordingWriter({
    rpc: plan.rpc,
    forkBlock: plan.forkBlock,
    roster: plan.roster.map(({ name, address, lau, yue, vessel }) => ({ name, address, lau, yue, vessel })),
    ...(baseRecording !== null ? { started: baseRecording.started } : {}),
  });
  const script = args.fetchScript !== null ? parseFetchScript(readJson(args.fetchScript)) : null;
  const fetchState = { consumed: 0 };
  const fetchImpl = script !== null ? scriptedChatFetch(script, fetchState) : undefined;
  const apiKey = script !== null ? "scripted-harness-key" : (process.env["OPENROUTER_API_KEY"] ?? null);

  if (plan.venue !== null) {
    setCurrentVenue({ a: plan.venue, n: "", s: "", lat: 0, band: 0, blk: 0 });
  }

  const turnCounts = new Map<string, number>();
  for (const row of plan.roster) turnCounts.set(row.name, baseRecording?.events.filter((e) => e.agent === row.name && e.e.type === "turn-start").length ?? 0);

  // per-agent gate counters — each roster agent is its own "browser session"
  const countersByAgent = new Map<string, SessionDayCounters>(plan.roster.map((r) => [r.name, freshCounters(new Date())]));
  const perAgentCounters = (name: string): SessionDayCounters => countersByAgent.get(name) ?? freshCounters(new Date());

  const results: Array<Record<string, unknown>> = [];
  // legacy gas price, fetched once per invocation (anvil forks inherit the
  // pin's; pad like the harness Actor does)
  const gasPrice = (await client.getGasPrice()) * 12n / 10n + 1_000_000n;

  for (const turn of plan.turns) {
    const row = plan.roster.find((r) => r.name === turn.agent)!;
    const account = row.address as `0x${string}`;
    const walletAccount = privateKeyToAccount(row.key as `0x${string}`);
    if (walletAccount.address.toLowerCase() !== account.toLowerCase()) {
      throw new Error(`roster row ${row.name}: key does not match address (${walletAccount.address} vs ${account})`);
    }
    const walletClient = createWalletClient({ account: walletAccount, chain, transport: http(plan.rpc) });

    const gateClient: GateClient = {
      call: async (a) => {
        const r = await client.call({ to: a.to, data: a.data, value: a.value ?? undefined, account: a.account });
        return (r.data ?? r) as `0x${string}`;
      },
      estimateGas: async (a) => client.estimateGas({ to: a.to, data: a.data, value: a.value ?? undefined, account: a.account }),
      waitForReceipt: async (txHash, timeoutMs) => {
        const r = await client.waitForTransactionReceipt({ hash: txHash, timeout: timeoutMs });
        return {
          status: r.status === "success" ? ("success" as const) : ("reverted" as const),
          gasUsed: r.gasUsed,
          blockNumber: r.blockNumber ?? null,
          logs: r.logs.map((l) => ({ address: l.address, topics: [...l.topics], data: l.data })),
          contractAddress: r.contractAddress ?? null,
        };
      },
    };

    let runTx = 0;
    let runNote: string | null = null;
    const deps = (): GateDeps => ({
      client: gateClient,
      facts: FACTS,
      policy: DEFAULT_POLICY,
      journal,
      counters: perAgentCounters(turn.agent),
      onCounters: (c) => countersByAgent.set(turn.agent, c),
      signer: {
        mode: "C",
        account,
        sendTransaction: async (a) =>
          walletClient.sendTransaction({
            to: a.to,
            data: a.data,
            value: a.value ?? undefined,
            gas: a.gas ?? undefined,
            gasPrice,
            chain: null,
            account: walletAccount,
          }) as Promise<`0x${string}`>,
      },
      signerMode: "C",
      approval: recordedApproval(plan.policy.autoApprove, journal),
      receiptTimeoutMs: 30_000,
    });

    const snapshot = await loadPlayerSnapshot(client, account);
    const toolCtx: AgentToolContext & { collectNote(): string | null } = {
      rpcUrl: plan.rpc,
      account,
      snapshot,
      journal,
      walletMode: "C",
      chatToolsEnabled: plan.policy.chatToolsEnabled,
      simToolsEnabled: simLayerActive(plan.rpc),
      // session-62 capability asymmetry: the drive plan's per-agent subset
      // binds at the advertise + execute seams (null = the full catalog)
      toolAllowlist: row.tools !== null ? new Set(row.tools) : null,
      gateDryRun: (request: GateRequest) => dryRun(deps(), request),
      gateSend: async (request: GateRequest) => {
        runTx += 1;
        if (plan.policy.maxAgentTxPerRun > 0 && runTx > plan.policy.maxAgentTxPerRun) {
          journal.emit("agent.tool", "run tx cap reached (L2 knob)", { runTx, cap: plan.policy.maxAgentTxPerRun });
          throw new Error(`agent run tx cap reached (${plan.policy.maxAgentTxPerRun} — L2 knob, the manifest policy block)`);
        }
        return sendTransaction(deps(), request);
      },
      refreshSnapshot: () => {},
      takeNote: (text: string) => {
        runNote = text;
      },
      collectNote: () => runNote,
    };

    const turnNo = (turnCounts.get(turn.agent) ?? 0) + 1;
    turnCounts.set(turn.agent, turnNo);
    const ac = new AbortController();
    const result = await runAgent({
      apiKey,
      apiKeySource: script !== null ? "dev-env" : "byok",
      model: plan.policy.model,
      reasoning: plan.policy.reasoning,
      persona: row.persona,
      sessionMemory: null,
      history: windowHistory(session.histories[turn.agent] ?? []),
      userText: turn.prompt,
      snapshot,
      previousPayload: null,
      toolCtx,
      budget: { maxSteps: plan.policy.maxSteps, maxTokens: plan.policy.maxTokens },
      autonomy: {
        maxConsecutiveToolFailures: plan.policy.maxConsecutiveToolFailures,
        checkpointEverySteps: plan.policy.checkpointEverySteps,
      },
      signal: ac.signal,
      journal,
      ...(fetchImpl !== undefined ? { fetchImpl } : {}),
      onEvent: (e) => {
        writer.append(turn.agent, turnNo, e);
      },
    });
    session.histories[turn.agent] = result.messages.filter((m) => m.role !== "system");
    results.push({
      agent: turn.agent,
      turn: turnNo,
      status: result.status,
      error: result.error,
      steps: result.steps,
      tokens: result.tokens,
      toolCalls: result.toolCalls.map((c) => ({ name: c.name, ok: c.ok })),
    });

    // incremental flush — a failed later round keeps the earlier capture
    const finished = writer.finish();
    const merged = baseRecording !== null ? mergeRecordings(baseRecording, finished) : finished;
    writeJson(args.recording, merged);
    writeJson(args.session, session);
    writeJson(args.result, { turns: results, scriptConsumed: fetchState.consumed });
    console.log(JSON.stringify({ turn: turn.agent, status: result.status, steps: result.steps, tokens: result.tokens, tools: result.toolCalls.map((c) => `${c.name}:${c.ok ? "ok" : "err"}`).join(" ") }));
  }

  if (script !== null && fetchState.consumed < script.length) {
    console.log(JSON.stringify({ warning: `fetch script has ${script.length - fetchState.consumed} unconsumed turns` }));
  }

  // session-62 (the owner round's per-round snapshot law): a four-pillar
  // score snapshot composes after EVERY drive invocation, on the MERGED
  // recording — the pillar counts must see earlier rounds' committed legs.
  // A compose failure (dead fork at snapshot time) skips the snapshot
  // honestly: the event capture stands, later snapshots still land.
  {
    const finished = writer.finish();
    const merged = baseRecording !== null ? mergeRecordings(baseRecording, finished) : finished;
    const rosterRows = plan.roster.map(({ name, address, lau, yue, vessel }) => ({ name, address, lau, yue, vessel }));
    try {
      const composed = await loadFleetStates(client, rosterRows, merged);
      writer.snapshotScore(composed.rows.map(scoreRowToJson));
      const withSnap = baseRecording !== null ? mergeRecordings(baseRecording, writer.finish()) : writer.finish();
      writeJson(args.recording, withSnap);
      console.log(JSON.stringify({ snapshot: { atEvent: withSnap.events.length - 1, rows: composed.rows.length, errors: composed.errors.length } }));
    } catch (e) {
      writeJson(args.recording, merged);
      console.log(JSON.stringify({ warning: `score snapshot skipped (compose failed): ${e instanceof Error ? e.message : String(e)}` }));
    }
  }
  console.log(JSON.stringify({ mode: "drive", turns: results.length, recording: args.recording }));
  return results.some((r) => r["status"] === "error") ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error(`runner entry failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    process.exit(1);
  });
