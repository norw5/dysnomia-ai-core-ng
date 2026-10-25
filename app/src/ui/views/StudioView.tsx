import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, type Abi, type AbiFunction } from "viem";
import { EXPLORER_BASE } from "@config/addresses";
import { FACTS, type ContractEntry } from "@/chain/facts";
import { loadAbi } from "@/chain/abiLoad";
import { useGate } from "@/chain/GateContext";
import type { GateEnvelope, GateOutcome } from "@/chain/txGate";
import { useWallet } from "@/wallet/WalletContext";
import { ApprovalCard } from "@/ui/ApprovalCard";
import { devDocForName } from "@/state/guide";
import { openLearn } from "@/state/learnLink";
import { copyText } from "@/ui/clipboard";

/**
 * STUDIO (IA-PLAN §4; session-78 rework): a direct console onto the
 * perimeter — contract index → contract/function workspace → call form.
 * Every state-changing call still DRYRUNs first and sends THROUGH THE GATE
 * (policy → approval → receipt → journal); the rework added no send path.
 *
 * The contract index replaces the old dropdown (discovery ergonomics), the
 * function index carries the generated facts chips, and the Studio's
 * `ENGINEERING DOCS ↗` link opens the contract's kb/dev reference in LEARN
 * (the SAME corpus the agent's search_kb chunks — docs one-source law).
 */

type MutFilter = "all" | "reads" | "writes" | "gated" | "metered";

const FILTERS: Array<{ id: MutFilter; label: string }> = [
  { id: "all", label: "ALL" },
  { id: "reads", label: "READS" },
  { id: "writes", label: "WRITES" },
  { id: "gated", label: "GATED" },
  { id: "metered", label: "METERED" },
];

const STUDIO_CONTRACT_KEY = "dys.studio.contract.v1";

function initialContractName(): string {
  try {
    const saved = window.localStorage.getItem(STUDIO_CONTRACT_KEY);
    if (saved !== null && FACTS.contracts.some((c) => c.name === saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  // the system hub is a better first read than the alphabetical AFFECTION
  return FACTS.contracts.find((c) => c.name === "CHOA")?.name ?? FACTS.contracts[0]!.name;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function parseArg(type: string, raw: string): unknown {
  const t = type.trim();
  const v = raw.trim();
  if (t === "address") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`bad address: ${v}`);
    return v as `0x${string}`;
  }
  if (t === "bool") {
    if (v !== "true" && v !== "false") throw new Error("bool must be true|false");
    return v === "true";
  }
  if (t.startsWith("uint") || t.startsWith("int")) {
    if (v === "") throw new Error(`empty ${t}`);
    return BigInt(v);
  }
  if (t.startsWith("bytes")) return v as `0x${string}`;
  if (t.startsWith("string")) return v;
  if (t.startsWith("(") || t.includes("[]") || t.endsWith("]")) {
    const parsed = JSON.parse(v) as unknown;
    return parsed;
  }
  throw new Error(`unsupported arg type: ${t}`);
}

function argPlaceholder(type: string): string {
  if (type === "address") return "0x… (42 chars)";
  if (type === "bool") return "true | false";
  if (type.startsWith("uint") || type.startsWith("int")) return "123 (decimal or 0x…)";
  if (type.startsWith("bytes")) return "0x…";
  if (type.startsWith("string")) return "text";
  return "JSON";
}

export function StudioView() {
  const gate = useGate();
  const wallet = useWallet();
  const [contractName, setContractName] = useState<string>(initialContractName);
  const [contractQuery, setContractQuery] = useState("");
  const [fnQuery, setFnQuery] = useState("");
  const [mutFilter, setMutFilter] = useState<MutFilter>("all");
  const [toOverride, setToOverride] = useState<string>("");
  const [abi, setAbi] = useState<Abi | null>(null);
  const [fnSig, setFnSig] = useState<string | null>(null);
  const [args, setArgs] = useState<Record<number, string>>({});
  const [valueWei, setValueWei] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [envelope, setEnvelope] = useState<GateEnvelope | null>(null);
  const [outcome, setOutcome] = useState<GateOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const contract = useMemo(
    () => FACTS.contracts.find((c) => c.name === contractName) ?? FACTS.contracts[0]!,
    [contractName]
  );
  const to = (toOverride.trim().length > 0 ? toOverride.trim() : contract.address) as `0x${string}`;

  useEffect(() => {
    setAbi(null);
    setFnSig(null);
    setArgs({});
    setError(null);
    loadAbi(contract.abiFile)
      .then(setAbi)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [contract]);

  const fns = useMemo(() => {
    const list = Object.entries(contract.functions).sort(([a], [b]) => a.localeCompare(b));
    return list;
  }, [contract]);

  const stats = useMemo(() => {
    let reads = 0;
    let writes = 0;
    let gated = 0;
    let metered = 0;
    for (const [, fn] of fns) {
      if (fn.mutability === "view" || fn.mutability === "pure") reads++;
      else writes++;
      if (fn.gate !== null && fn.gate !== "public") gated++;
      if (fn.metered) metered++;
    }
    return { functions: fns.length, reads, writes, gated, metered };
  }, [fns]);

  const contractHits = useMemo(() => {
    const q = contractQuery.trim().toLowerCase();
    if (q.length === 0) return FACTS.contracts;
    return FACTS.contracts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.sourceContract.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q)
    );
  }, [contractQuery]);

  const filteredFns = useMemo(() => {
    const q = fnQuery.trim().toLowerCase();
    return fns.filter(([sig, fn]) => {
      if (q.length > 0 && !sig.toLowerCase().includes(q) && !(fn.gate ?? "").toLowerCase().includes(q)) {
        return false;
      }
      if (mutFilter === "reads") return fn.mutability === "view" || fn.mutability === "pure";
      if (mutFilter === "writes") return fn.mutability !== "view" && fn.mutability !== "pure";
      if (mutFilter === "gated") return fn.gate !== null && fn.gate !== "public";
      if (mutFilter === "metered") return fn.metered;
      return true;
    });
  }, [fns, fnQuery, mutFilter]);

  const devDoc = useMemo(
    () => devDocForName(contract.sourceContract) ?? devDocForName(contract.name),
    [contract]
  );

  const abiFn = useMemo<AbiFunction | null>(() => {
    if (!abi || !fnSig) return null;
    const name = fnSig.slice(0, fnSig.indexOf("("));
    const count = fnSig.slice(fnSig.indexOf("(") + 1, fnSig.length - 1).split(",").filter(Boolean).length;
    const hits = (abi as AbiFunction[]).filter(
      (e) => e.type === "function" && e.name === name && e.inputs.length === count
    );
    return hits[0] ?? null;
  }, [abi, fnSig]);

  const factsFn = fnSig !== null ? (contract.functions[fnSig] ?? null) : null;
  const isView = factsFn?.mutability === "view" || factsFn?.mutability === "pure";
  const isPayable = factsFn?.mutability === "payable";

  const selectContract = useCallback((name: string) => {
    setContractName(name);
    setContractQuery("");
    setFnQuery("");
    setMutFilter("all");
    setToOverride("");
    setResult(null);
    setEnvelope(null);
    setOutcome(null);
    setError(null);
    setCopied(false);
    setCopyFailed(false);
    try {
      window.localStorage.setItem(STUDIO_CONTRACT_KEY, name);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const selectFn = useCallback((sig: string) => {
    setFnSig(sig);
    setArgs({});
    setResult(null);
    setEnvelope(null);
    setOutcome(null);
    setError(null);
  }, []);

  // session-79: the compact tap path — the call form sits below the bounded
  // function index, so a selected function gets an explicit jump affordance
  // (desktop never moves: the button only renders in the compact container).
  const jumpToCall = useCallback(() => {
    document
      .querySelector<HTMLElement>('[data-testid="studio-call"]')
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  const copyAddress = useCallback(async () => {
    const ok = await copyText(contract.address);
    setCopied(ok);
    setCopyFailed(!ok);
    if (!ok) {
      // plain-http LAN fallback: put the caret on the address so a manual
      // Ctrl+C works; the button names the state instead of failing silently
      const el = document.querySelector<HTMLElement>('[data-testid="studio-contract-address"]');
      if (el !== null) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    window.setTimeout(() => {
      setCopied(false);
      setCopyFailed(false);
    }, 1600);
  }, [contract.address]);
  const encode = useCallback((): `0x${string}` => {
    if (!abiFn) throw new Error("select a function first");
    const parsed = abiFn.inputs.map((input, i) => parseArg(input.type, args[i] ?? ""));
    return encodeFunctionData({ abi: [abiFn], functionName: abiFn.name, args: parsed });
  }, [abiFn, args]);

  const runCall = useCallback(async () => {
    setError(null);
    setResult(null);
    setOutcome(null);
    setBusy(true);
    try {
      const data = encode();
      const env = await gate.dryRun({
        to,
        data,
        account: wallet.account ?? "0x0000000000000000000000000000000000000000",
        abi: abi ?? undefined,
        meta: { source: "manual", label: `STUDIO ${contract.name}.${fnSig ?? ""}` },
      });
      setEnvelope(env);
      if (env.sim?.ok && env.sim.result) setResult(`0x${env.sim.result.slice(2)}`);
      else if (env.sim?.error) setError(env.sim.error.decoded ?? env.sim.error.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [encode, gate, to, wallet.account, abi, contract.name, fnSig]);

  const beginSend = useCallback(async () => {
    setError(null);
    setResult(null);
    setOutcome(null);
    setBusy(true);
    try {
      const data = encode();
      const env = await gate.dryRun({
        to,
        data,
        value: BigInt(valueWei === "" ? "0" : valueWei),
        account: wallet.account ?? "0x0000000000000000000000000000000000000000",
        abi: abi ?? undefined,
        meta: { source: "manual", label: `STUDIO ${contract.name}.${fnSig ?? ""}` },
      });
      if (wallet.yolo) {
        // mode C: no per-action card — policy bounds only
        setBusy(false);
        await yoloSend(data, (env.sim?.ok ?? false) === true);
        return;
      }
      setEnvelope(env);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
    async function yoloSend(data: `0x${string}`, _simOk: boolean): Promise<void> {
      setBusy(true);
      try {
        const out = await gate.send(
          {
            to,
            data,
            value: BigInt(valueWei === "" ? "0" : valueWei),
            account: wallet.account ?? "0x0000000000000000000000000000000000000000",
            abi: abi ?? undefined,
            meta: { source: "manual", label: `STUDIO ${contract.name}.${fnSig ?? ""}` },
          },
          { approvalAlreadyGranted: true }
        );
        if (out.status === "no-signer") {
          setError("no account active — SETTINGS → wallet to connect (A) or load a key (B)");
          return;
        }
        setOutcome(out);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    }
  }, [encode, gate, to, valueWei, wallet.account, wallet.yolo, abi, contract.name, fnSig]);

  const finishSend = useCallback(
    async (allowSimFailure: boolean) => {
      if (!envelope) return;
      setBusy(true);
      try {
        const data = encode();
        const out = await gate.send(
          {
            to,
            data,
            value: BigInt(valueWei === "" ? "0" : valueWei),
            account: wallet.account ?? "0x0000000000000000000000000000000000000000",
            abi: abi ?? undefined,
            meta: { source: "manual", label: `STUDIO ${contract.name}.${fnSig ?? ""}` },
          },
          { approvalAlreadyGranted: true, allowSimFailure }
        );
        if (out.status === "no-signer") {
          setError("no account active — SETTINGS → wallet to connect (A) or load a key (B)");
          return;
        }
        setOutcome(out);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [envelope, encode, gate, to, valueWei, wallet.account, abi, contract.name, fnSig]
  );

  return (
    <section className="view studio view-center" data-testid="view-studio">
      <h1>//eng STUDIO — raw contract interaction (everything sends through the gate)</h1>

      <div className="studio-grid">
        <aside className="panel studio-index" data-testid="studio-contract-index">
          <div className="studio-index-head">
            <h2>contracts</h2>
            <span className="mono studio-count" data-testid="studio-contract-count">
              {contractHits.length} / {FACTS.contracts.length} contracts
            </span>
          </div>
          <input
            id="studio-contract-search"
            className="mono studio-search"
            spellCheck={false}
            value={contractQuery}
            placeholder="name / source / address"
            aria-label="filter contracts"
            onChange={(e) => setContractQuery(e.target.value)}
            data-testid="studio-contract-search"
          />
          <ul className="studio-contract-list" data-testid="studio-contract-list">
            {contractHits.map((c: ContractEntry) => (
              <li key={c.name}>
                <button
                  className={c.name === contract.name ? "studio-contract active" : "studio-contract"}
                  onClick={() => selectContract(c.name)}
                  aria-pressed={c.name === contract.name}
                  data-testid={`studio-contract-${c.name}`}
                >
                  <span className="studio-contract-name">
                    <span>{c.name}</span>
                    <span className="studio-contract-n">{Object.keys(c.functions).length}</span>
                  </span>
                  <span className="studio-contract-sub mono">
                    {c.sourceContract !== c.name && (
                      <span className="studio-contract-source">{c.sourceContract}</span>
                    )}
                    <span>{shortAddress(c.address)}</span>
                    <span className={c.factsCovered ? "studio-facts-ok" : "studio-facts-none"}>
                      {c.factsCovered ? "facts" : "no facts"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {contractHits.length === 0 && (
              <li className="studio-empty-row" data-testid="studio-contract-empty">
                no contracts match “{contractQuery}”
              </li>
            )}
          </ul>
          <p className="hint studio-index-foot">
            perimeter · facts {FACTS.generated.slice(0, 10)}
          </p>
        </aside>

        <div className="panel studio-workspace" data-testid="studio-workspace">
          <div className="studio-contract-head">
            <div className="studio-title-row">
              <h2 className="studio-contract-title" data-testid="studio-contract-title">
                {contract.name}
              </h2>
              {contract.sourceContract !== contract.name && (
                <span className="studio-source-tag mono">source · {contract.sourceContract}</span>
              )}
            </div>
            <div className="studio-meta-row">
              <span className={`chip ${contract.factsCovered ? "studio-chip-facts" : "studio-chip-nofacts"}`}>
                {contract.factsCovered ? "FACTS · fn tables" : "NO fn_tables FACTS"}
              </span>
              <span className="chip">{contract.abiFile}</span>
              <span className="chip">{stats.functions} functions</span>
            </div>
            <div className="studio-address-row">
              <code className="mono studio-address" data-testid="studio-contract-address">
                {contract.address}
              </code>
              <button
                className="btn btn-mini"
                onClick={copyAddress}
                title={copyFailed ? "clipboard unavailable — the address is selected; press Ctrl+C" : "copy the contract address"}
                data-testid="studio-copy-address"
              >
                {copied ? "copied" : copyFailed ? "select" : "copy"}
              </button>
              <a
                className="outlink"
                href={`${EXPLORER_BASE}${contract.address}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                ↗ explorer
              </a>
            </div>
            <div className="studio-docs">
              {devDoc !== null ? (
                <button
                  className="btn btn-mini studio-docs-link"
                  onClick={() => openLearn({ source: "dev", file: devDoc })}
                  title={`open kb/dev/${devDoc} in LEARN`}
                  data-testid="studio-docs-link"
                >
                  ENGINEERING DOCS ↗
                </button>
              ) : (
                <span className="dim" data-testid="studio-docs-none">
                  no engineering doc for this contract
                </span>
              )}
              <span className="hint">kb/dev reference · one corpus with the AI core</span>
            </div>
          </div>

          <div className="studio-stats" data-testid="studio-stats">
            <div className="studio-stat" data-testid="studio-stat-functions">
              <span className="studio-stat-n">{stats.functions}</span>
              <span className="studio-stat-l">functions</span>
            </div>
            <div className="studio-stat" data-testid="studio-stat-reads">
              <span className="studio-stat-n">{stats.reads}</span>
              <span className="studio-stat-l">reads</span>
            </div>
            <div className="studio-stat" data-testid="studio-stat-writes">
              <span className="studio-stat-n">{stats.writes}</span>
              <span className="studio-stat-l">writes</span>
            </div>
            <div className="studio-stat" data-testid="studio-stat-gated">
              <span className="studio-stat-n">{stats.gated}</span>
              <span className="studio-stat-l">gated</span>
            </div>
            <div className="studio-stat" data-testid="studio-stat-metered">
              <span className="studio-stat-n">{stats.metered}</span>
              <span className="studio-stat-l">metered</span>
            </div>
          </div>

          <div className="studio-fn-head">
            <h2>function index</h2>
            <div className="studio-fn-tools">
              <span className="mono studio-count" data-testid="studio-fn-count">
                {filteredFns.length} / {stats.functions}
              </span>
              {fnSig !== null && (
                <button
                  className="btn btn-mini studio-jump-call"
                  onClick={jumpToCall}
                  title="scroll to the call form"
                  data-testid="studio-jump-call"
                >
                  call form ↓
                </button>
              )}
            </div>
          </div>
          <input
            id="studio-fn-search"
            className="mono studio-search"
            spellCheck={false}
            value={fnQuery}
            placeholder="filter — signature / gate"
            aria-label="filter functions"
            onChange={(e) => setFnQuery(e.target.value)}
            data-testid="studio-fn-search"
          />
          <div className="studio-filters" role="group" aria-label="function filter">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                className={mutFilter === f.id ? "studio-filter active" : "studio-filter"}
                onClick={() => setMutFilter(f.id)}
                aria-pressed={mutFilter === f.id}
                data-testid={`studio-filter-${f.id}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <ul className="fn-list studio-fn-list" data-testid="studio-fns">
            {filteredFns.map(([sig, fn]) => (
              <li key={sig}>
                <button
                  className={sig === fnSig ? "fn-row active" : "fn-row"}
                  onClick={() => selectFn(sig)}
                  title={fn.reverts.length > 0 ? `documented reverts: ${fn.reverts.join(", ")}` : undefined}
                  data-testid={`studio-fn-${sig.slice(0, sig.indexOf("("))}`}
                >
                  <span className="fn-sig">{sig}</span>
                  <span className={`mut mut-${fn.mutability}`}>{fn.mutability}</span>
                  {fn.gate !== null && fn.gate !== "public" && <span className="gate-chip">gate: {fn.gate}</span>}
                  {fn.metered && <span className="gate-chip metered">metered</span>}
                </button>
              </li>
            ))}
            {filteredFns.length === 0 && (
              <li className="studio-empty-row" data-testid="studio-fn-empty">
                no functions match the filter
              </li>
            )}
          </ul>
        </div>

        <div className="panel studio-call" data-testid="studio-call">
          <div className="studio-fn-head">
            <h2>call form</h2>
            {factsFn && <span className="mono studio-count">{factsFn.selector}</span>}
          </div>

          <div className="arg-row studio-target-row">
            <label htmlFor="studio-to" className="mono">
              to <em>(editable fallback)</em>
            </label>
            <input
              id="studio-to"
              className="mono"
              spellCheck={false}
              value={toOverride}
              placeholder={contract.address}
              onChange={(e) => setToOverride(e.target.value)}
              data-testid="studio-to"
            />
          </div>

          {!abiFn && (
            <div className="studio-empty" data-testid="studio-empty">
              <p className="studio-empty-kicker mono">THE GATE PATH — nothing is sent until you approve</p>
              <ol className="studio-flow">
                <li>
                  <span className="studio-flow-n mono">01</span>
                  <span>
                    <strong>pick a function</strong> in the index — the chips name its mutability, gate and
                    metering facts.
                  </span>
                </li>
                <li>
                  <span className="studio-flow-n mono">02</span>
                  <span>
                    <strong>fill the arguments</strong> — strict parsers (address / bool / integer / bytes /
                    string / JSON tuple).
                  </span>
                </li>
                <li>
                  <span className="studio-flow-n mono">03</span>
                  <span>
                    <strong>DRYRUN</strong> — a pure preview through THE gate; previews are never the final
                    numbers (shared Entropy head).
                  </span>
                </li>
                <li>
                  <span className="studio-flow-n mono">04</span>
                  <span>
                    <strong>SEND</strong> — policy → approval → receipt → decoded movements → the journal.
                    there is no bypass.
                  </span>
                </li>
              </ol>
              <p className="hint">
                views run an anonymous <code>eth_call</code>; state-changing calls always DRYRUN first. the
                fallback target sends the same ABI to any address (unknown destinations obey the policy).
              </p>
            </div>
          )}

          {abiFn && (
            <>
              <div className="studio-fn-active">
                <div className="studio-fn-active-sig mono">
                  {abiFn.name}(
                  {abiFn.inputs
                    .map((input, i) => `${i > 0 ? ", " : ""}${input.type}${input.name ? ` ${input.name}` : ""}`)
                    .join("")}
                  )
                </div>
                <div className="studio-fn-active-meta">
                  <span className={`mut mut-${factsFn?.mutability ?? "nonpayable"}`}>
                    {factsFn?.mutability ?? "?"}
                  </span>
                  {factsFn !== null && factsFn.gate !== null && factsFn.gate !== "public" && (
                    <span className="gate-chip">gate: {factsFn.gate}</span>
                  )}
                  {factsFn?.metered && <span className="gate-chip metered">metered</span>}
                  {factsFn !== null && factsFn.reverts.length > 0 && (
                    <span className="dim">documented reverts: {factsFn.reverts.join(", ")}</span>
                  )}
                </div>
              </div>
              {abiFn.inputs.length === 0 && <p className="hint">no arguments</p>}
              {abiFn.inputs.map((input, i) => (
                <div className="arg-row" key={i}>
                  <label htmlFor={`arg-${i}`} className="mono">
                    {input.name || input.type} <em>({input.type})</em>
                  </label>
                  <input
                    id={`arg-${i}`}
                    className="mono"
                    spellCheck={false}
                    placeholder={argPlaceholder(input.type)}
                    value={args[i] ?? ""}
                    onChange={(e) => setArgs((prev) => ({ ...prev, [i]: e.target.value }))}
                    data-testid={`studio-arg-${i}`}
                  />
                </div>
              ))}
              {isPayable && (
                <div className="arg-row">
                  <label htmlFor="arg-value" className="mono">
                    value (wei)
                  </label>
                  <input
                    id="arg-value"
                    className="mono"
                    spellCheck={false}
                    placeholder="0"
                    value={valueWei}
                    onChange={(e) => setValueWei(e.target.value)}
                    data-testid="studio-value"
                  />
                </div>
              )}

              <div className="studio-actions">
                {isView ? (
                  <button className="btn" disabled={busy || !abi} onClick={runCall} data-testid="studio-call">
                    CALL (read)
                  </button>
                ) : (
                  <>
                    <button className="btn" disabled={busy || !abi} onClick={runCall} data-testid="studio-dryrun">
                      DRYRUN
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={busy || !abi || !wallet.account}
                      onClick={beginSend}
                      title={wallet.account ? "opens the gate approval card" : "connect a wallet / load a key first"}
                      data-testid="studio-send"
                    >
                      SEND{" "}
                      {wallet.mode === "A"
                        ? "(wallet prompts)"
                        : wallet.mode === "B"
                          ? "(approval card)"
                          : "(yolo — policy only)"}
                    </button>
                  </>
                )}
              </div>
              {!wallet.account && (
                <p className="hint">no account active — SETTINGS → wallet to connect (A) or load a key (B)</p>
              )}
            </>
          )}

          {error && (
            <div className="studio-result err-text" data-testid="studio-error">
              {error}
            </div>
          )}
          {result && (
            <div className="studio-result" data-testid="studio-result">
              <span className="hint">eth_call returned:</span>
              <pre className="mono">{result}</pre>
            </div>
          )}
          {envelope && !isView && (
            <div className="studio-result" data-testid="studio-policy">
              <span className={envelope.policy.allowed ? "ok-text" : "err-text"}>
                policy: {envelope.policy.allowed ? "PASS" : `DENIED — ${envelope.policy.reasons.join("; ")}`}
              </span>
            </div>
          )}
          {envelope && !isView && envelope.sim && (
            <div className="studio-result" data-testid="studio-sim">
              <span className="hint">DRYRUN — previews are pure; committed results can differ (shared Entropy head):</span>
              <pre className="mono">
                {envelope.sim.ok
                  ? `ok${envelope.sim.gas !== null ? `\ngas ~${envelope.sim.gas.toString()}` : ""}`
                  : `reverted${envelope.sim.error?.decoded ? `: ${envelope.sim.error.decoded}` : ""}\n${envelope.sim.error?.message ?? ""}`}
              </pre>
            </div>
          )}
          {outcome && (
            <div className="studio-result" data-testid="studio-outcome">
              {outcome.status === "denied" && <span className="err-text">DENIED by policy: {outcome.reasons.join("; ")}</span>}
              {outcome.status === "sim-failed" && <span className="err-text">blocked: DRYRUN reverted (override in the card)</span>}
              {outcome.status === "aborted" && <span className="err-text">aborted: {outcome.reason}</span>}
              {outcome.status === "sent" && (
                <>
                  <span className="ok-text">sent</span>
                  <pre className="mono">{outcome.txHash}</pre>
                  {outcome.receipt && (
                    <div className="hint">
                      receipt {outcome.receipt.status} · gas {outcome.receipt.gasUsed.toString()}
                      {outcome.movements.length > 0 && (
                        <>
                          {" ·"} transfers:
                          {outcome.movements
                            .map((m) => ` ${m.amount.toString()} of ${m.token.slice(0, 10)}…`)
                            .join(";")}
                        </>
                      )}
                    </div>
                  )}
                  {outcome.receiptError && <div className="err-text">receipt: {outcome.receiptError}</div>}
                  {outcome.capBreaches.length > 0 && (
                    <div className="err-text">{outcome.capBreaches.join("; ")}</div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {envelope && !isView && !outcome && busy === false && envelope.policy.allowed && (
        <ApprovalCard
          envelope={envelope}
          mode={wallet.mode}
          busy={busy}
          onResolve={(accept, allowSimFailure) => {
            if (!accept) {
              setEnvelope(null);
              return;
            }
            setEnvelope(null);
            void finishSend(allowSimFailure);
          }}
        />
      )}
    </section>
  );
}
