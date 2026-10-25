import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { makeClient } from "@/chain/client";
import { FACTS } from "@/chain/facts";
import type { Journal } from "@/chain/journal";
import {
  DEFAULT_POLICY,
  freshCounters,
  type PolicyConfig,
  type SessionDayCounters,
} from "@/chain/policy";
import {
  loadGateSettings,
  saveGateSettings,
  type GateSettings,
} from "@/chain/gateSettings";
import {
  dryRun,
  sendTransaction,
  type GateClient,
  type GateDeps,
  type GateEnvelope,
  type GateOutcome,
  type GateRequest,
  type GateSigner,
  type SendOptions,
} from "@/chain/txGate";
import { useWallet } from "@/wallet/WalletContext";

/**
 * Runtime for the ONE tx gate: journal + policy (persisted) + spend counters +
 * the approval-card hookup. Views call gateDryRun/gateSend; nothing else may
 * reach a signer.
 */

const POLICY_KEY = "dys.policy.v1";

interface StoredPolicy {
  maxTxPerSession: number;
  maxTxPerDay: number;
  maxValuePerTxWei: string;
  maxValuePerSessionWei: string;
  maxValuePerDayWei: string;
  allowUnknownDestinations: boolean;
  perTokenSessionCapWei: Record<string, string>;
}

function loadPolicy(): PolicyConfig {
  try {
    const raw = window.localStorage.getItem(POLICY_KEY);
    if (!raw) return DEFAULT_POLICY;
    const s = JSON.parse(raw) as StoredPolicy;
    return {
      maxTxPerSession: s.maxTxPerSession,
      maxTxPerDay: s.maxTxPerDay,
      maxValuePerTxWei: BigInt(s.maxValuePerTxWei),
      maxValuePerSessionWei: BigInt(s.maxValuePerSessionWei),
      maxValuePerDayWei: BigInt(s.maxValuePerDayWei),
      allowUnknownDestinations: s.allowUnknownDestinations,
      perTokenSessionCapWei: Object.fromEntries(
        Object.entries(s.perTokenSessionCapWei ?? {}).map(([k, v]) => [k, BigInt(v)])
      ),
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

function savePolicy(p: PolicyConfig): void {
  const s: StoredPolicy = {
    maxTxPerSession: p.maxTxPerSession,
    maxTxPerDay: p.maxTxPerDay,
    maxValuePerTxWei: p.maxValuePerTxWei.toString(),
    maxValuePerSessionWei: p.maxValuePerSessionWei.toString(),
    maxValuePerDayWei: p.maxValuePerDayWei.toString(),
    allowUnknownDestinations: p.allowUnknownDestinations,
    perTokenSessionCapWei: Object.fromEntries(
      Object.entries(p.perTokenSessionCapWei).map(([k, v]) => [k, v.toString()])
    ),
  };
  try {
    window.localStorage.setItem(POLICY_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export interface GateApi {
  journal: Journal;
  policy: PolicyConfig;
  setPolicy(p: PolicyConfig): void;
  /** session-65: gate-level toggles (the mode-C breadth auto-ack) */
  gateSettings: GateSettings;
  setGateSettings(s: GateSettings): void;
  counters: SessionDayCounters;
  dryRun(request: GateRequest): Promise<GateEnvelope>;
  send(request: GateRequest, opts?: SendOptions): Promise<GateOutcome | { status: "no-signer" }>;
  /**
   * The session-81 seam: the SAME gate pipeline (policy → DRYRUN → approval
   * → send → receipt → journal) with an explicit signer. Used ONLY by the SIM
   * bootstrap's impersonated live-deployer signer — never a bypass: the gate
   * still classifies, simulates, asks, journals, and records counters.
   */
  sendWithSigner(
    request: GateRequest,
    signer: GateSigner,
    opts?: SendOptions
  ): Promise<GateOutcome | { status: "no-signer" }>;
  /** the pending approval envelope the modal must resolve */
  pendingApproval: GateEnvelope | null;
  resolveApproval(accept: boolean): void;
}

const Ctx = createContext<GateApi | null>(null);

export function GateProvider({
  children,
  rpcUrl,
  journal,
}: {
  children: ReactNode;
  rpcUrl: string;
  journal: Journal;
}) {
  const [policy, setPolicyState] = useState<PolicyConfig>(loadPolicy);
  const [gateSettings, setGateSettingsState] = useState<GateSettings>(loadGateSettings);
  const [counters, setCounters] = useState<SessionDayCounters>(() => freshCounters(new Date()));
  const [pendingApproval, setPendingApproval] = useState<GateEnvelope | null>(null);
  const approvalResolve = useRef<((accept: boolean) => void) | null>(null);
  const wallet = useWallet();

  const client = useMemo(() => makeClient(rpcUrl), [rpcUrl]);

  const gateClient: GateClient = useMemo(
    () => ({
      call: async (args) => {
        const r = await client.call({
          to: args.to,
          data: args.data,
          value: args.value ?? undefined,
          account: args.account,
        });
        return (r.data ?? r) as `0x${string}`;
      },
      estimateGas: async (args) =>
        client.estimateGas({
          to: args.to,
          data: args.data,
          value: args.value ?? undefined,
          account: args.account,
        }),
      waitForReceipt: async (txHash, timeoutMs) => {
        const r = await client.waitForTransactionReceipt({ hash: txHash, timeout: timeoutMs });
        return {
          status: r.status === "success" ? "success" : "reverted",
          gasUsed: r.gasUsed,
          blockNumber: r.blockNumber ?? null,
          logs: r.logs.map((l) => ({ address: l.address, topics: [...l.topics], data: l.data })),
          contractAddress: r.contractAddress ?? null,
        };
      },
    }),
    [client]
  );

  const setPolicy = useCallback((p: PolicyConfig) => {
    setPolicyState(p);
    savePolicy(p);
  }, []);

  const setGateSettings = useCallback((s: GateSettings) => {
    setGateSettingsState(s);
    saveGateSettings(s);
  }, []);

  const buildDeps = useCallback((signerOverride?: GateSigner): GateDeps | null => {
    const signer = signerOverride ?? wallet.buildSigner();
    if (!signer) return null;
    return {
      client: gateClient,
      signer,
      signerMode: signer.mode,
      facts: FACTS,
      policy,
      modeCBreadth: gateSettings.modeCBreadth,
      journal,
      counters: freshCounters(new Date(), counters),
      onCounters: setCounters,
      receiptTimeoutMs: 12_000,
      approval: async (envelope) => {
        setPendingApproval(envelope);
        return await new Promise<boolean>((resolve) => {
          approvalResolve.current = resolve;
        });
      },
    };
  }, [gateClient, policy, gateSettings, journal, counters, wallet]);

  const runDryRun = useCallback(
    async (request: GateRequest): Promise<GateEnvelope> => {
      return dryRun(
        {
          client: gateClient,
          facts: FACTS,
          policy,
          journal,
          counters: freshCounters(new Date(), counters),
        },
        request
      );
    },
    [gateClient, policy, journal, counters]
  );

  const runSend = useCallback(
    async (request: GateRequest, opts: SendOptions = {}): Promise<GateOutcome | { status: "no-signer" }> => {
      const deps = buildDeps();
      if (!deps) return { status: "no-signer" };
      return sendTransaction(deps, request, opts);
    },
    [buildDeps]
  );

  const runSendWithSigner = useCallback(
    async (
      request: GateRequest,
      signer: GateSigner,
      opts: SendOptions = {}
    ): Promise<GateOutcome | { status: "no-signer" }> => {
      const deps = buildDeps(signer);
      if (!deps) return { status: "no-signer" };
      return sendTransaction(deps, request, opts);
    },
    [buildDeps]
  );

  const resolveApproval = useCallback((accept: boolean) => {
    setPendingApproval(null);
    approvalResolve.current?.(accept);
    approvalResolve.current = null;
  }, []);

  const api: GateApi = {
    journal,
    policy,
    setPolicy,
    gateSettings,
    setGateSettings,
    counters,
    dryRun: runDryRun,
    send: runSend,
    sendWithSigner: runSendWithSigner,
    pendingApproval,
    resolveApproval,
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useGate(): GateApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useGate outside GateProvider");
  return v;
}
