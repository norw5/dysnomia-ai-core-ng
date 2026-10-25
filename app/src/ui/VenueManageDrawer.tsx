import { useEffect, useMemo, useState } from "react";
import { encodeFunctionData, parseUnits, type Abi, type AbiFunction, type Address } from "viem";
import { addr } from "@config/addresses";
import { fmtAmt } from "@/chain/identity";
import { makeClient } from "@/chain/client";
import { useGateAction } from "@/chain/useGateAction";
import { ApprovalCard } from "@/ui/ApprovalCard";
import type { VenueStateHook } from "@/chain/venueState";
import type { VenueRow } from "@/state/venueStore";
import type { GateEnvelope, GateOutcome, GateRequest } from "@/chain/txGate";

/**
 * The venue-management drawer (IA-REEVAL-49 B1.3, session-50): the bouncer
 * powers — setCoverCharge/setStaff/setGuestlist/removeGuest/setBouncerDivisor
 * (staff-gated; the CREATOR is auto-staffed from block one, kb §4) — and the
 * owners surface — AllowCROWS / AddMarketRate (rate can only increase, capped
 * at priced-token totalSupply ÷ 777) / Withdraw (asserts !GWAT). The GWAT
 * escrow lock renders FIRST: a locked venue's accumulated covers are a
 * permanent exhibit. Gates are evaluated live in the venue batch
 * (bouncer(account∨LAU), owner(account) — the MultiOwnable two-arg form);
 * every send goes through THE gate (venue instances classify
 * unknown-contract, extra ack — intended).
 */

function pickFn(abi: Abi, name: string, inputCount: number): AbiFunction {
  const hits = abi.filter((e): e is AbiFunction => e.type === "function" && e.name === name && e.inputs.length === inputCount);
  if (hits.length === 0) throw new Error(`ABI fragment not found: ${name}/${inputCount}`);
  return hits[0]!;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL_RE = /^\d+(\.\d+)?$/;

function OutcomeLine({ outcome }: { outcome: GateOutcome }) {
  if (outcome.status === "denied") return <span className="err-text">DENIED by policy: {outcome.reasons.join("; ")}</span>;
  if (outcome.status === "sim-failed")
    return <span className="err-text">blocked: DRYRUN reverted — override needs the explicit card ack</span>;
  if (outcome.status === "aborted") return <span className="err-text">aborted: {outcome.reason}</span>;
  return (
    <span className="ok-text">
      sent <span className="mono">{outcome.txHash}</span>
    </span>
  );
}

/** one management action row: inputs → DRYRUN + SEND through its own gate flow */
function ManageAction({
  label,
  hint,
  buildRequest,
  account,
  qingAbi,
  walletMode,
  enabled,
  disabledReason,
  onSent,
  children,
}: {
  label: string;
  hint: string;
  buildRequest: () => GateRequest | null;
  account: Address | null;
  qingAbi: Abi | null;
  walletMode: string;
  enabled: boolean;
  disabledReason: string | null;
  onSent: () => void;
  children?: React.ReactNode;
}) {
  const action = useGateAction();
  const [dry, setDry] = useState<GateEnvelope | null>(null);
  const [busyDry, setBusyDry] = useState(false);

  useEffect(() => {
    if (action.outcome?.status === "sent") onSent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.outcome]);

  const runDry = async () => {
    const req = buildRequest();
    if (req === null) return;
    setBusyDry(true);
    setDry(null);
    try {
      setDry(await action.probe(req));
    } finally {
      setBusyDry(false);
    }
  };

  const runSend = async () => {
    const req = buildRequest();
    if (req === null) return;
    setDry(null);
    await action.begin(req);
  };

  return (
    <div className="venue-action" data-testid={`manage-${label.replace(/\s+/g, "-").toLowerCase()}`}>
      <p className="hint">{hint}</p>
      {children}
      {enabled ? (
        <div className="studio-actions">
          <button className="btn" disabled={busyDry || !account || !qingAbi} onClick={() => void runDry()} data-testid={`manage-${label.replace(/\s+/g, "-").toLowerCase()}-dryrun`}>
            DRYRUN
          </button>
          <button
            className="btn btn-primary"
            disabled={action.busy || !account || !qingAbi}
            onClick={() => void runSend()}
            data-testid={`manage-${label.replace(/\s+/g, "-").toLowerCase()}-send`}
          >
            SEND {walletMode === "C" ? "(yolo — policy only)" : ""}
          </button>
        </div>
      ) : account !== null ? (
        <p className="hint" data-testid={`manage-${label.replace(/\s+/g, "-").toLowerCase()}-locked`}>
          {disabledReason ?? "your account does not hold this gate here."}
        </p>
      ) : null}
      {dry?.sim && (
        <div className="studio-result">
          <pre className="mono">
            {dry.sim.ok
              ? `DRYRUN ok${dry.sim.gas !== null ? ` · gas ~${dry.sim.gas.toString()}` : ""}`
              : `DRYRUN revert${dry.sim.error?.decoded ? `: ${dry.sim.error.decoded}` : ""}\n${dry.sim.error?.message ?? ""}`}
          </pre>
        </div>
      )}
      {action.error && <p className="err-text">{action.error}</p>}
      {action.outcome && (
        <div className="studio-result">
          <OutcomeLine outcome={action.outcome} />
        </div>
      )}
      {action.envelope && (
        <ApprovalCard
          envelope={action.envelope}
          mode={walletMode}
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

function ArgLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="arg-label">
      {children}
    </label>
  );
}

export function VenueManageDrawer({
  venue,
  live,
  account,
  qingAbi,
  walletMode,
  chainUrl,
  onSent,
}: {
  venue: VenueRow;
  live: VenueStateHook;
  account: Address | null;
  qingAbi: Abi | null;
  walletMode: string;
  chainUrl: string;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [cover, setCover] = useState("");
  const [divisor, setDivisor] = useState("");
  const [staffAddr, setStaffAddr] = useState("");
  const [staffActive, setStaffActive] = useState(true);
  const [guestAddr, setGuestAddr] = useState("");
  const [unGuestAddr, setUnGuestAddr] = useState("");
  const [allowCrows, setAllowCrows] = useState(true);
  const [priced, setPriced] = useState("AFFECTION");
  const [rate, setRate] = useState("");
  const [withdrawToken, setWithdrawToken] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  // escrow inspection (anonymous reads, drawer-open only)
  const [escrow, setEscrow] = useState<{ asset: bigint | null; affection: bigint | null } | null>(null);

  const state = live.state;
  const isBouncer = state?.myBouncer ?? null;
  const isOwner = state?.myOwner ?? null;
  const gwat = state?.gwat ?? null;
  const noCrows = state?.noCrows ?? null;
  const asset = state?.asset ?? null;

  // escrow inspection (anonymous reads, drawer-open only): what the room holds
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const client = makeClient(chainUrl);
    const v = venue.a as Address;
    const erc20 = [
      { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
      { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
      { type: "function", name: "GetMarketRate", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
    ] as const;
    (async () => {
      try {
        const rs = (await client.multicall({
          allowFailure: true,
          contracts: [
            ...(asset !== null ? [{ address: asset, abi: erc20, functionName: "balanceOf", args: [v] as const }] : []),
            { address: addr("AFFECTION"), abi: erc20, functionName: "balanceOf", args: [v] as const },
          ],
        })) as Array<{ status: "success"; result: unknown } | { status: "failure"; error: Error }>;
        if (!alive) return;
        const pick = (i: number): bigint | null => {
          const r = rs[i];
          return r && r.status === "success" && typeof r.result === "bigint" ? r.result : null;
        };
        setEscrow({ asset: asset !== null ? pick(0) : null, affection: pick(asset !== null ? 1 : 0) });
      } catch {
        /* the drawer renders without the inspection — the sends stay honest through the gate */
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, venue.a, asset, chainUrl]);

  // the priced-token preview for AddMarketRate: totalSupply (the ÷777 cap) +
  // the venue's current rate for that token. One anonymous round on change.
  const [pricedPreview, setPricedPreview] = useState<{ cap: bigint | null; current: bigint | null } | null>(null);
  const pricedAddress = useMemo(() => {
    if (priced.toUpperCase() === "AFFECTION") return addr("AFFECTION");
    return ADDRESS_RE.test(priced) ? (priced as Address) : null;
  }, [priced]);

  useEffect(() => {
    if (!open || pricedAddress === null) {
      setPricedPreview(null);
      return;
    }
    let alive = true;
    const client = makeClient(chainUrl);
    const v = venue.a as Address;
    const erc20 = [
      { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
      { type: "function", name: "GetMarketRate", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
    ] as const;
    (async () => {
      try {
        const rs = (await client.multicall({
          allowFailure: true,
          contracts: [
            { address: pricedAddress, abi: erc20, functionName: "totalSupply", args: [] as const },
            { address: v, abi: erc20, functionName: "GetMarketRate", args: [pricedAddress] as const },
          ],
        })) as Array<{ status: "success"; result: unknown } | { status: "failure"; error: Error }>;
        if (!alive) return;
        const supply = rs[0] !== undefined && rs[0].status === "success" && typeof rs[0].result === "bigint" ? rs[0].result : null;
        const current = rs[1] !== undefined && rs[1].status === "success" && typeof rs[1].result === "bigint" ? rs[1].result : null;
        setPricedPreview({ cap: supply !== null ? supply / 777n : null, current });
      } catch {
        setPricedPreview(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, pricedAddress, venue.a, chainUrl]);

  const req = (fn: string, arity: number, args: unknown[], label: string): GateRequest | null => {
    if (!account || !qingAbi) return null;
    return {
      to: venue.a as `0x${string}`,
      data: encodeFunctionData({ abi: [pickFn(qingAbi, fn, arity)], functionName: fn, args: args as never }),
      account,
      abi: qingAbi,
      meta: { source: "manual", label: `MAP manage ${label} ${venue.n || venue.a}` },
    };
  };

  // honest disabled reasons: unreadable ≠ refused
  const gateReason =
    account === null
      ? "connect an account to evaluate your gates."
      : state === null
        ? "venue reads unavailable — the live gates cannot be evaluated."
        : "you do not hold the bouncer gate here (staff / ≥25 CROWS / asset stake / asset owner).";
  const ownerReason =
    account === null
      ? "connect an account to evaluate your gates."
      : state === null
        ? "venue reads unavailable — the live gates cannot be evaluated."
        : "owners only — CHO, the wrapped asset's owner, or a deed holder.";

  const parseWei = (v: string): bigint | null => (DECIMAL_RE.test(v.trim()) ? parseUnits(v.trim(), 18) : null);

  return (
    <details className="explain venue-manage" data-testid="venue-manage" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>? manage this venue — bouncer + owner powers</summary>
      <p className="hint">
        the staff surface runs the room (cover, divisor, staff list, guest list); the owners
        surface (AllowCROWS / AddMarketRate / Withdraw) belongs to CHO, the wrapped asset's owner,
        and anyone who Took the deed. the CREATOR is auto-staffed from block one — full bouncer
        powers without owning. gates below are evaluated live from the venue batch.
      </p>
      {account === null && (
        <p className="hint" data-testid="venue-manage-connect">
          connect an account (SETTINGS → wallet) to evaluate the staff and owner gates below.
        </p>
      )}

      <dl className="kv" data-testid="venue-manage-gates">
        <dt>your door/staff pass</dt>
        <dd className={isBouncer === true ? "ok-text" : ""}>{isBouncer === null ? "—" : isBouncer ? "yes — staff/door powers available" : "no"}</dd>
        <dt>your owners membership</dt>
        <dd className={isOwner === true ? "ok-text" : ""}>{isOwner === null ? "—" : isOwner ? "yes — owners surface available" : "no"}</dd>
        <dt>CROWS door leg</dt>
        <dd>{noCrows === null ? "—" : noCrows ? "switched OFF (NoCROWS — AllowCROWS(false) was run)" : "active (≥ 25 CROWS passes the door)"}</dd>
        <dt>GWAT escrow lock</dt>
        <dd className={gwat === true ? "err-text" : "ok-text"}>
          {gwat === null ? "—" : gwat ? "LOCKED (creation lottery) — Withdraw is permanently assert-blocked; the escrow stays on display" : "withdrawable (the lucky minority)"}
        </dd>
      </dl>

      {escrow !== null && (
        <dl className="kv" data-testid="venue-manage-escrow">
          <dt>escrow — venue's Asset</dt>
          <dd className="mono">{escrow.asset !== null ? fmtAmt(escrow.asset) : asset !== null ? "0" : "—"}</dd>
          <dt>escrow — Ⓐ AFFECTION</dt>
          <dd className="mono">{escrow.affection !== null ? fmtAmt(escrow.affection) : "—"}</dd>
        </dl>
      )}

      <h4>staff powers (bouncer-gated)</h4>
      <ManageAction
        label="cover"
        hint="setCoverCharge(uint256) — the cover in the venue's wrapped Asset, charged on Join/Chat unless guest-listed. 0 = no cover."
        buildRequest={() => {
          const c = parseWei(cover);
          return c === null ? null : req("setCoverCharge", 1, [c], "setCoverCharge");
        }}
        account={account}
        qingAbi={qingAbi}
        walletMode={walletMode}
        enabled={isBouncer === true}
        disabledReason={gateReason}
        onSent={onSent}
      >
        <div className="arg-row">
          <ArgLabel htmlFor="manage-cover-input">cover (tokens, 18d)</ArgLabel>
          <input id="manage-cover-input" className="mono" spellCheck={false} placeholder="e.g. 2.5 or 0" value={cover} onChange={(e) => setCover(e.target.value)} data-testid="manage-cover-input" />
        </div>
      </ManageAction>

      <ManageAction
        label="divisor"
        hint="setBouncerDivisor(uint16) — the asset-stake door threshold: holding ≥ asset totalSupply ÷ divisor passes. default 32."
        buildRequest={() => {
          const d = divisor.trim();
          if (!/^\d+$/.test(d)) return null;
          const n = Number(d);
          if (!Number.isSafeInteger(n) || n > 65_535) return null;
          return req("setBouncerDivisor", 1, [n], "setBouncerDivisor");
        }}
        account={account}
        qingAbi={qingAbi}
        walletMode={walletMode}
        enabled={isBouncer === true}
        disabledReason={gateReason}
        onSent={onSent}
      >
        <div className="arg-row">
          <ArgLabel htmlFor="manage-divisor-input">divisor (uint16)</ArgLabel>
          <input id="manage-divisor-input" className="mono" spellCheck={false} placeholder="32" value={divisor} onChange={(e) => setDivisor(e.target.value)} data-testid="manage-divisor-input" />
        </div>
      </ManageAction>

      <ManageAction
        label="staff"
        hint="setStaff(address, bool) — add or remove a bouncer. staff pass every door check this venue runs."
        buildRequest={() => (ADDRESS_RE.test(staffAddr.trim()) ? req("setStaff", 2, [staffAddr.trim(), staffActive], "setStaff") : null)}
        account={account}
        qingAbi={qingAbi}
        walletMode={walletMode}
        enabled={isBouncer === true}
        disabledReason={gateReason}
        onSent={onSent}
      >
        <div className="arg-row">
          <ArgLabel htmlFor="manage-staff-input">staff address</ArgLabel>
          <input id="manage-staff-input" className="mono" spellCheck={false} placeholder="0x…" value={staffAddr} onChange={(e) => setStaffAddr(e.target.value)} data-testid="manage-staff-input" />
        </div>
        <div className="arg-row">
          <ArgLabel htmlFor="manage-staff-active">state</ArgLabel>
          <select id="manage-staff-active" value={staffActive ? "grant" : "revoke"} onChange={(e) => setStaffActive(e.target.value === "grant")} data-testid="manage-staff-active">
            <option value="grant">grant (true)</option>
            <option value="revoke">revoke (false)</option>
          </select>
        </div>
      </ManageAction>

      <ManageAction
        label="guest"
        hint="setGuestlist(address) — a 1-day guest pass: admission + chat without the cover charge."
        buildRequest={() => (ADDRESS_RE.test(guestAddr.trim()) ? req("setGuestlist", 1, [guestAddr.trim()], "setGuestlist") : null)}
        account={account}
        qingAbi={qingAbi}
        walletMode={walletMode}
        enabled={isBouncer === true}
        disabledReason={gateReason}
        onSent={onSent}
      >
        <div className="arg-row">
          <ArgLabel htmlFor="manage-guest-input">guest address</ArgLabel>
          <input id="manage-guest-input" className="mono" spellCheck={false} placeholder="0x…" value={guestAddr} onChange={(e) => setGuestAddr(e.target.value)} data-testid="manage-guest-input" />
        </div>
      </ManageAction>

      <ManageAction
        label="unguest"
        hint="removeGuest(address) — end a guest pass early."
        buildRequest={() => (ADDRESS_RE.test(unGuestAddr.trim()) ? req("removeGuest", 1, [unGuestAddr.trim()], "removeGuest") : null)}
        account={account}
        qingAbi={qingAbi}
        walletMode={walletMode}
        enabled={isBouncer === true}
        disabledReason={gateReason}
        onSent={onSent}
      >
        <div className="arg-row">
          <ArgLabel htmlFor="manage-unguest-input">guest address</ArgLabel>
          <input id="manage-unguest-input" className="mono" spellCheck={false} placeholder="0x…" value={unGuestAddr} onChange={(e) => setUnGuestAddr(e.target.value)} data-testid="manage-unguest-input" />
        </div>
      </ManageAction>

      <h4>owner powers</h4>
      <ManageAction
        label="allowcrows"
        hint="AllowCROWS(bool) — true keeps the ≥ 25 CROWS door leg active; false switches it off (NoCROWS)."
        buildRequest={() => req("AllowCROWS", 1, [allowCrows], "AllowCROWS")}
        account={account}
        qingAbi={qingAbi}
        walletMode={walletMode}
        enabled={isOwner === true}
        disabledReason={ownerReason}
        onSent={onSent}
      >
        <div className="arg-row">
          <ArgLabel htmlFor="manage-allowcrows-select">door leg</ArgLabel>
          <select id="manage-allowcrows-select" value={allowCrows ? "on" : "off"} onChange={(e) => setAllowCrows(e.target.value === "on")} data-testid="manage-allowcrows-select">
            <option value="on">require CROWS (AllowCROWS true)</option>
            <option value="off">switch the CROWS leg off (AllowCROWS false)</option>
          </select>
        </div>
      </ManageAction>

      <ManageAction
        label="rate"
        hint="AddMarketRate(priced, rate) — set the venue's purchase rate for a token. the rate can ONLY increase (MarketRateCanOnlyBeIncreased) and is capped at priced totalSupply ÷ 777 (TokenMaximumRate)."
        buildRequest={() => {
          const r = parseWei(rate);
          if (r === null || pricedAddress === null) return null;
          return req("AddMarketRate", 2, [pricedAddress, r], "AddMarketRate");
        }}
        account={account}
        qingAbi={qingAbi}
        walletMode={walletMode}
        enabled={isOwner === true}
        disabledReason={ownerReason}
        onSent={onSent}
      >
        <div className="arg-row">
          <ArgLabel htmlFor="manage-rate-priced">priced token</ArgLabel>
          <input id="manage-rate-priced" className="mono" spellCheck={false} placeholder="AFFECTION or 0x…" value={priced} onChange={(e) => setPriced(e.target.value)} data-testid="manage-rate-priced" />
        </div>
        <div className="arg-row">
          <ArgLabel htmlFor="manage-rate-input">rate (tokens per 1.0 venue token, 18d)</ArgLabel>
          <input id="manage-rate-input" className="mono" spellCheck={false} placeholder="e.g. 1.0" value={rate} onChange={(e) => setRate(e.target.value)} data-testid="manage-rate-input" />
        </div>
        {pricedPreview !== null && (
          <p className="hint" data-testid="manage-rate-preview">
            current rate {pricedPreview.current !== null ? fmtAmt(pricedPreview.current) : "— (none set)"} · cap{" "}
            {pricedPreview.cap !== null ? fmtAmt(pricedPreview.cap) : "—"} (totalSupply ÷ 777) — the DRYRUN enforces both.
          </p>
        )}
      </ManageAction>

      <ManageAction
        label="withdraw"
        hint="Withdraw(what, amount) — pay escrow out to the caller. asserts !GWAT: a locked venue can NEVER withdraw."
        buildRequest={() => {
          const a = parseWei(withdrawAmount);
          if (a === null || !ADDRESS_RE.test(withdrawToken.trim())) return null;
          return req("Withdraw", 2, [withdrawToken.trim(), a], "Withdraw");
        }}
        account={account}
        qingAbi={qingAbi}
        walletMode={walletMode}
        enabled={isOwner === true && gwat === false}
        disabledReason={
          account === null
            ? "connect an account to evaluate your gates."
            : gwat === true
              ? "GWAT-LOCKED — this venue drew the permanent-exhibit lottery; Withdraw asserts !GWAT and can never pass."
              : state === null
                ? "venue reads unavailable — the live gates cannot be evaluated."
                : "owners only — CHO, the wrapped asset's owner, or a deed holder."
        }
        onSent={onSent}
      >
        <div className="arg-row">
          <ArgLabel htmlFor="manage-withdraw-token">token address</ArgLabel>
          <input id="manage-withdraw-token" className="mono" spellCheck={false} placeholder="0x…" value={withdrawToken} onChange={(e) => setWithdrawToken(e.target.value)} data-testid="manage-withdraw-token" />
        </div>
        <div className="arg-row">
          <ArgLabel htmlFor="manage-withdraw-amount">amount (tokens, 18d)</ArgLabel>
          <input id="manage-withdraw-amount" className="mono" spellCheck={false} placeholder="e.g. 1.0" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} data-testid="manage-withdraw-amount" />
        </div>
        {asset !== null && (
          <p className="hint">
            quick fill:{" "}
            <button
              type="button"
              className="linkish"
              onClick={() => setWithdrawToken(asset)}
              data-testid="manage-withdraw-asset"
            >
              the venue's Asset
            </button>{" "}
            ·{" "}
            <button
              type="button"
              className="linkish"
              onClick={() => setWithdrawToken(addr("AFFECTION"))}
              data-testid="manage-withdraw-affection"
            >
              Ⓐ AFFECTION
            </button>
          </p>
        )}
      </ManageAction>
    </details>
  );
}
