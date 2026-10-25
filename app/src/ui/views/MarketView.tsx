import { useEffect, useMemo, useState } from "react";
import { encodeFunctionData, type Abi, type AbiFunction, type Address } from "viem";
import { EXPLORER_BASE, addr } from "@config/addresses";
import { loadAbi } from "@/chain/abiLoad";
import { makeClient } from "@/chain/client";
import { fmtAmt, type PlayerSnapshot } from "@/chain/identity";
import { usePowerTokens, scaffoldPowerRows } from "@/chain/powerTokens";
import { useGateAction } from "@/chain/useGateAction";
import { useVenueState } from "@/chain/venueState";
import { useVenueRedeemLeg, useYueDesk } from "@/chain/yueDesk";
import { parseAmount, purchaseCost } from "@/chain/deskMath";
import { useWallet } from "@/wallet/WalletContext";
import { ApprovalCard } from "@/ui/ApprovalCard";
import { LearnHint } from "@/ui/LearnHint";
import { VenueSidebar } from "@/ui/VenueSidebar";
import { useCurrentVenue } from "@/state/venueStore";
import { fmtWpls, loadPairs, pairLegLabel, pairLinks, searchPairs, type PairRow } from "@/state/pairsSeed";
import type { ChainState } from "@/chain/useChainState";
import type { GateEnvelope, GateOutcome } from "@/chain/txGate";

/**
 * MARKET (IA-PLAN §5, session-48) — four tabs:
 *  POWER    the four constellation power tokens (Fornax/Eris/Fomalhaute/
 *           Tethys) + Ⓐ/CHOA from the identity subset: balances across
 *           wallet/LAU/YUE and the Yuan view (bal + 10×LAU + 40×YUE), one
 *           anonymous Multicall3 batch; the current venue's Ⓐ rate rides
 *           the shared venue reader;
 *  ASSETS   the AFFECTION desk on the current venue (the unified QING
 *           sidebar is the picker): live GetMarketRate(AFFECTION) preview,
 *           allowance check, APPROVE + PURCHASE both through THE gate
 *           (Purchase pulls Ⓐ via transferFrom — the approval is a real
 *           prerequisite, not a nicety) + the REDEEM leg (session-52: the
 *           reverse bridge — venue tokens back into Ⓐ from the venue's Ⓐ
 *           escrow; the allowance quirk: spender == the VENUE ITSELF);
 *  EXCHANGE the YUE Hong/Hung desk (session-52, IA-REEVAL-49 B1.5): swap
 *           the wrapped asset ⇄ venue token THROUGH YOUR VAULT at the
 *           composed GetAssetRate walk — both legs pay from the VAULT'S
 *           OWN inventory (fork-pinned, set-2 s12);
 *  PAIRS    the curated LP seed (188) — OUT-LINKS ONLY (explorer +
 *           dexscreener), WPLS-anchored figures, no trading surface.
 */

type MarketTab = "power" | "assets" | "exchange" | "pairs";

function pickFn(abi: Abi, name: string, inputCount: number): AbiFunction {
  const hits = abi.filter((e): e is AbiFunction => e.type === "function" && e.name === name && e.inputs.length === inputCount);
  if (hits.length === 0) throw new Error(`ABI fragment not found: ${name}/${inputCount}`);
  return hits[0]!;
}

function OutcomeLine({ outcome }: { outcome: GateOutcome }) {
  if (outcome.status === "denied") return <span className="err-text">DENIED by policy: {outcome.reasons.join("; ")}</span>;
  if (outcome.status === "sim-failed") return <span className="err-text">blocked: DRYRUN reverted — override needs the explicit card ack</span>;
  if (outcome.status === "aborted") return <span className="err-text">aborted: {outcome.reason}</span>;
  return (
    <>
      <span className="ok-text">sent</span>
      <pre className="mono">{outcome.txHash}</pre>
      {outcome.receipt && (
        <div className="hint">
          receipt {outcome.receipt.status} · gas {outcome.receipt.gasUsed.toString()}
        </div>
      )}
      {outcome.receiptError && <div className="err-text">receipt: {outcome.receiptError}</div>}
    </>
  );
}

export function MarketView({ chain, snapshot, isCompact }: { chain: ChainState; snapshot: PlayerSnapshot | null; isCompact: boolean }) {
  const [tab, setTab] = useState<MarketTab>("power");
  const { current } = useCurrentVenue();
  return (
    <section className="view market view-center" data-testid="view-market">
      <h1>//trade MARKET — power tokens · assets · pairs</h1>
      <nav className="dock-tabs" aria-label="market tabs">
        <button className={tab === "power" ? "dock-tab active" : "dock-tab"} onClick={() => setTab("power")} data-testid="market-tab-power">
          POWER
        </button>
        <button className={tab === "assets" ? "dock-tab active" : "dock-tab"} onClick={() => setTab("assets")} data-testid="market-tab-assets">
          ASSETS
        </button>
        <button className={tab === "exchange" ? "dock-tab active" : "dock-tab"} onClick={() => setTab("exchange")} data-testid="market-tab-exchange">
          EXCHANGE
        </button>
        <button className={tab === "pairs" ? "dock-tab active" : "dock-tab"} onClick={() => setTab("pairs")} data-testid="market-tab-pairs">
          PAIRS
        </button>
      </nav>
      {isCompact && tab !== "pairs" && <VenueSidebar compact />}
      {tab === "power" && <PowerTab chain={chain} snapshot={snapshot} />}
      {tab === "assets" && <AssetsTab chain={chain} snapshot={snapshot} venue={current} />}
      {tab === "exchange" && <ExchangeTab chain={chain} snapshot={snapshot} venue={current} />}
      {tab === "pairs" && <PairsTab />}
    </section>
  );
}

// ---------------- POWER ----------------

function PowerTab({ chain, snapshot }: { chain: ChainState; snapshot: PlayerSnapshot | null }) {
  const { current } = useCurrentVenue();
  const account = (snapshot?.account ?? null) as Address | null;
  const power = usePowerTokens(chain.url, account, (snapshot?.lau ?? null) as Address | null, (snapshot?.yue ?? null) as Address | null);
  const rate = useVenueState(chain.url, (current?.a ?? null) as Address | null, account);

  return (
    <div className="market-power" data-testid="market-power">
      <div className="panel">
        <h2>constellation power tokens</h2>
        <p className="hint">
          balances across wallet / LAU / YUE and the Yuan view — <span className="mono">bal + 10×LAU + 40×YUE</span>{" "}
          (the deployed CHOA weighting, 02_choa.sol:28-33). one anonymous Multicall3 batch per refresh.
        </p>
        {!account && <p className="hint">connect an account (SETTINGS → wallet) to read your balances.</p>}
        {power.error && <p className="err-text">power reads unavailable: {power.error}</p>}
        {power.state !== null && power.state.errors.length > 0 && (
          <p className="err-text" data-testid="market-power-errors">
            {power.state.errors.join(" · ")}
          </p>
        )}
        <div className="table-wrap">
          <table className="kv-table" data-testid="market-power-table">
            <thead>
              <tr>
                <th>token</th>
                <th>wallet</th>
                <th>LAU</th>
                <th>YUE</th>
                <th>Yuan view</th>
              </tr>
            </thead>
            <tbody>
              {(power.state?.rows ?? scaffoldPowerRows()).map((r) => (
                <tr key={r.key} data-testid={`market-power-${r.key.toLowerCase()}`}>
                  <td>
                    <span className="mono power-key">{r.key}</span>
                    <a className="outlink" href={`${EXPLORER_BASE}${r.address}`} target="_blank" rel="noreferrer noopener">
                      ↗
                    </a>
                    <div className="hint">{r.symbol ?? r.address.slice(0, 12)}…</div>
                  </td>
                  <td className="mono">{account !== null && power.state !== null ? fmtAmt(r.balances.wallet) : "—"}</td>
                  <td className="mono">{snapshot?.lau != null && power.state !== null ? fmtAmt(r.balances.lau) : "—"}</td>
                  <td className="mono">{snapshot?.yue != null && power.state !== null ? fmtAmt(r.balances.yue) : "—"}</td>
                  <td className="mono">{r.yuan !== null && account !== null ? fmtAmt(r.yuan) : "—"}</td>
                </tr>
              ))}
              {power.state === null && account !== null && !power.error && (
                <tr>
                  <td colSpan={5} className="hint">
                    reading (one anonymous batch)…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="hint" data-testid="market-power-notes">
          Fornax — the ladder's constant; the deployed Goldilocks ceiling is REAL (kb §2) · Eris — QI divides by it ·
          Fomalhaute — XIA's modulus, carries world chat · Tethys — CHO itself (ZI's modulus).
        </div>
        <button className="btn" disabled={power.loading || account === null} onClick={power.refresh} data-testid="market-power-refresh">
          {power.loading ? "reading…" : "refresh"}
        </button>
      </div>

      {snapshot !== null && (
        <div className="panel">
          <h2>identity subset (the §7.6 snapshot reader)</h2>
          <div className="table-wrap">
            <table className="kv-table">
              <thead>
                <tr>
                  <th>token</th>
                  <th>wallet</th>
                  <th>LAU</th>
                  <th>YUE</th>
                  <th>Yuan view</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="mono power-key">Ⓐ AFFECTION</td>
                  <td className="mono">{fmtAmt(snapshot.balances.affection.wallet)}</td>
                  <td className="mono">{snapshot.lau !== null ? fmtAmt(snapshot.balances.affection.lau) : "—"}</td>
                  <td className="mono">{snapshot.yue !== null ? fmtAmt(snapshot.balances.affection.yue) : "—"}</td>
                  <td className="mono">
                    {fmtAmt(snapshot.balances.affection.wallet + 10n * snapshot.balances.affection.lau + 40n * snapshot.balances.affection.yue)}
                  </td>
                </tr>
                <tr>
                  <td className="mono power-key">CHOA</td>
                  <td className="mono">{fmtAmt(snapshot.balances.choa.wallet)}</td>
                  <td className="mono">{snapshot.lau !== null ? fmtAmt(snapshot.balances.choa.lau) : "—"}</td>
                  <td className="mono">{snapshot.yue !== null ? fmtAmt(snapshot.balances.choa.yue) : "—"}</td>
                  <td className="mono">{fmtAmt(snapshot.yuanChoa)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel" data-testid="market-venue-rate">
        <h2>QING-asset rate — current venue</h2>
        {current === null ? (
          <p className="hint">no venue selected — pick one in the sidebar (the app-global selection).</p>
        ) : (
          <RateBlock
            name={current.n.length > 0 ? current.n : current.a}
            symbol={current.s}
            address={current.a as Address}
            venueState={rate}
          />
        )}
      </div>
    </div>
  );
}

function RateBlock({
  name,
  symbol,
  address,
  venueState,
}: {
  name: string;
  symbol: string;
  address: Address;
  venueState: ReturnType<typeof useVenueState>;
}) {
  const s = venueState.state;
  return (
    <>
      <dl className="kv">
        <dt>venue</dt>
        <dd className="mono">
          {name} ({symbol}){" "}
          <a className="outlink" href={`${EXPLORER_BASE}${address}`} target="_blank" rel="noreferrer noopener">
            ↗
          </a>
        </dd>
        {venueState.error && <p className="err-text">venue reads unavailable: {venueState.error}</p>}
        {s !== null && (
          <>
            <dt>Asset</dt>
            <dd className="mono">{s.asset ?? "read failed"}</dd>
            <dt>Ⓐ rate</dt>
            <dd className="mono">{s.marketRateKnown && s.marketRateAffection !== null ? `${fmtAmt(s.marketRateAffection)} Ⓐ / 1.0 ${symbol}` : "—"}</dd>
          </>
        )}
      </dl>
      {s !== null && !s.marketRateKnown && (
        <p className="hint" data-testid="market-no-rate">
          no Ⓐ market rate — fresh venues carry none: Purchase(AFFECTION, ·) reverts MarketRateNotFound
          until an owner runs AddMarketRate(AFFECTION, 1e18) (kb §3). Phobos's rate is a KNOWN 0 — a
          real state, distinct from the no-rate revert.
        </p>
      )}
    </>
  );
}

// ---------------- ASSETS (the AFFECTION Purchase desk) ----------------

const erc20AllowanceAbi = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const erc20ApproveAbi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }] },
] as const;

// the desk math lives in chain/deskMath.ts (shared with the agent desk
// tools, session-55) — re-exported here for the existing importers
export { parseAmount, purchaseCost } from "@/chain/deskMath";

function AssetsTab({
  chain,
  snapshot,
  venue,
}: {
  chain: ChainState;
  snapshot: PlayerSnapshot | null;
  venue: { a: string; n: string; s: string } | null;
}) {
  const wallet = useWallet();
  const account = (wallet.account ?? null) as Address | null;
  const action = useGateAction();
  const live = useVenueState(chain.url, (venue?.a ?? null) as Address | null, account);
  const leg = useVenueRedeemLeg(chain.url, (venue?.a ?? null) as Address | null, account);
  const client = useMemo(() => makeClient(chain.url), [chain.url]);

  const [amountText, setAmountText] = useState("");
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [allowanceErr, setAllowanceErr] = useState<string | null>(null);
  const [probe, setProbe] = useState<GateEnvelope | null>(null);
  const [qingAbi, setQingAbi] = useState<Abi | null>(null);

  useEffect(() => {
    setQingAbi(null);
    loadAbi("QING.json")
      .then(setQingAbi)
      .catch(() => setQingAbi(null));
  }, []);

  const venueAddr = (venue?.a ?? null) as Address | null;
  useEffect(() => {
    setAllowance(null);
    setAllowanceErr(null);
    if (account === null || venueAddr === null) return;
    let alive = true;
    client
      .readContract({ address: addr("AFFECTION"), abi: erc20AllowanceAbi, functionName: "allowance", args: [account, venueAddr] })
      .then((v) => {
        if (alive) setAllowance(BigInt(v));
      })
      .catch((e: unknown) => {
        if (alive) setAllowanceErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [client, account, venueAddr, action.outcome]);

  const amount = parseAmount(amountText);
  const rate = live.state?.marketRateAffection ?? null;
  const cost = amount !== null && rate !== null ? purchaseCost(amount, rate) : null;
  const needsApprove = cost !== null && (allowance === null || allowance < cost);
  const affectionWallet = snapshot?.balances.affection.wallet ?? null;

  const beginApprove = async () => {
    if (!account || !venueAddr || cost === null || cost === 0n) return;
    await action.begin({
      to: addr("AFFECTION"),
      data: encodeFunctionData({ abi: erc20ApproveAbi, functionName: "approve", args: [venueAddr, cost] }),
      account,
      abi: [...erc20ApproveAbi] as unknown as Abi,
      meta: { source: "manual", label: `MARKET approve Ⓐ → ${venue?.n || venueAddr}` },
    });
  };

  const beginPurchase = async () => {
    if (!account || !venueAddr || amount === null || !qingAbi) return;
    await action.begin({
      to: venueAddr,
      data: encodeFunctionData({ abi: [pickFn(qingAbi, "Purchase", 2)], functionName: "Purchase", args: [addr("AFFECTION"), amount] }),
      account,
      abi: qingAbi,
      meta: { source: "manual", label: `MARKET Purchase ${venue?.n || venueAddr}` },
    });
  };

  const dryRunPurchase = async () => {
    if (!account || !venueAddr || amount === null || !qingAbi) return;
    setProbe(null);
    const env = await action.probe({
      to: venueAddr,
      data: encodeFunctionData({ abi: [pickFn(qingAbi, "Purchase", 2)], functionName: "Purchase", args: [addr("AFFECTION"), amount] }),
      account,
      abi: qingAbi,
      meta: { source: "manual", label: `MARKET Purchase DRYRUN ${venue?.n || venueAddr}` },
    });
    setProbe(env);
  };

  useEffect(() => {
    if (action.outcome?.status === "sent") {
      live.refresh();
      leg.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.outcome]);

  return (
    <div className="market-assets" data-testid="market-assets">
      <div className="panel">
        <h2>
          the AFFECTION purchase desk <LearnHint file="economy.md" anchor="the-internal-exchange" />
        </h2>
        {venue === null ? (
          <p className="hint">no venue selected — pick one in the sidebar (the unified QING picker); the desk buys ITS venue token.</p>
        ) : (
          <>
            <RateBlock name={venue.n.length > 0 ? venue.n : venue.a} symbol={venue.s} address={venue.a as Address} venueState={live} />
            <div className="arg-row">
              <label htmlFor="market-amount">amount of {venue.s} to buy</label>
              <input
                id="market-amount"
                className="mono"
                spellCheck={false}
                placeholder="1.0"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                data-testid="market-amount"
              />
            </div>
            <dl className="kv" data-testid="market-cost">
              <dt>rate (live)</dt>
              <dd className="mono">{rate !== null ? `${fmtAmt(rate)} Ⓐ / 1.0 ${venue.s}` : "—"}</dd>
              <dt>cost</dt>
              <dd className="mono">{cost !== null ? `${fmtAmt(cost)} Ⓐ` : "—"}</dd>
              <dt>your Ⓐ (wallet)</dt>
              <dd className="mono">{affectionWallet !== null ? fmtAmt(affectionWallet) : "—"}</dd>
              <dt>Ⓐ allowance → venue</dt>
              <dd className="mono">
                {allowanceErr !== null
                  ? "read failed"
                  : allowance === null
                    ? "…"
                    : fmtAmt(allowance)}
              </dd>
            </dl>
            {cost !== null && affectionWallet !== null && affectionWallet < cost && (
              <p className="err-text" data-testid="market-insufficient">
                wallet Ⓐ below the cost — Purchase pulls Ⓐ from the SENDER via transferFrom.
              </p>
            )}
            <p className="hint">
              Purchase(AFFECTION, amount) — buys the venue token with Ⓐ at the venue's rate. the Ⓐ moves
              via transferFrom, so the desk sends an exact-amount APPROVE first when the allowance is
              short; both legs go through the ONE gate. venue contracts are not perimeter addresses —
              the approval card carries the extra ack (intended).
            </p>
            <div className="studio-actions">
              <button className="btn" disabled={!account || amount === null || rate === null || live.state?.marketRateKnown !== true} onClick={() => void dryRunPurchase()} data-testid="market-purchase-dryrun">
                DRYRUN
              </button>
              <button className="btn" disabled={!account || amount === null || cost === null || cost === 0n || needsApprove || action.busy} onClick={() => void beginPurchase()} data-testid="market-purchase-send">
                SEND — Purchase {wallet.mode === "A" ? "(wallet prompts)" : "(approval card)"}
              </button>
              {needsApprove && cost !== null && (
                <button className="btn" disabled={!account || action.busy} onClick={() => void beginApprove()} data-testid="market-approve-send">
                  SEND — Approve Ⓐ {fmtAmt(cost)}
                </button>
              )}
            </div>
            {probe && probe.sim && (
              <div className="studio-result" data-testid="market-purchase-sim">
                <pre className="mono">
                  {probe.sim.ok
                    ? `DRYRUN ok\ngas ~${probe.sim.gas?.toString() ?? "?"}`
                    : `DRYRUN revert${probe.sim.error?.decoded ? `: ${probe.sim.error.decoded}` : ""}\n${probe.sim.error?.message ?? ""}`}
                </pre>
              </div>
            )}
            {action.error && <p className="err-text">{action.error}</p>}
            {action.outcome && (
              <div className="studio-result" data-testid="market-outcome">
                <OutcomeLine outcome={action.outcome} />
              </div>
            )}
            {action.envelope && (
              <ApprovalCard
                envelope={action.envelope}
                mode={wallet.mode}
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
          </>
        )}
      </div>
      {venue !== null && (
        <RedeemLegPanel
          venue={venue}
          account={account}
          walletMode={wallet.mode}
          rate={rate}
          amount={amount}
          leg={leg}
          live={live}
        />
      )}
      <details className="explain">
        <summary>? what is the internal exchange</summary>
        <p className="hint">
          every DYSNOMIA-family token carries Purchase/Redeem at internally-tracked market rates with
          Ⓐ seeded 1:1 — Ⓐ buys Dysnomia assets directly, no bridge, no wrapper. the venue desk here
          is that machinery aimed at one venue token.
        </p>
      </details>
    </div>
  );
}

// ---------------- the Ⓐ REDEEM leg (session-52) ----------------

function RedeemLegPanel({
  venue,
  account,
  walletMode,
  rate,
  amount,
  leg,
  live,
}: {
  venue: { a: string; n: string; s: string };
  account: Address | null;
  walletMode: string;
  rate: bigint | null;
  amount: bigint | null;
  leg: ReturnType<typeof useVenueRedeemLeg>;
  live: ReturnType<typeof useVenueState>;
}) {
  const action = useGateAction();
  const [probe, setProbe] = useState<GateEnvelope | null>(null);
  const [qingAbi, setQingAbi] = useState<Abi | null>(null);

  useEffect(() => {
    loadAbi("QING.json")
      .then(setQingAbi)
      .catch(() => setQingAbi(null));
  }, []);

  const venueAddr = venue.a as Address;
  const payout = amount !== null && rate !== null ? purchaseCost(amount, rate) : null;
  const escrow = leg.state?.affectionEscrow ?? null;
  const selfAllowance = leg.state?.selfAllowance ?? null;
  const myQing = leg.state?.myQing ?? null;
  const needsSelfApprove = amount !== null && amount > 0n && (selfAllowance === null || selfAllowance < amount);

  const beginSelfApprove = async () => {
    if (!account || amount === null || amount === 0n) return;
    await action.begin({
      to: venueAddr,
      data: encodeFunctionData({ abi: erc20ApproveAbi, functionName: "approve", args: [venueAddr, amount] }),
      account,
      abi: [...erc20ApproveAbi] as unknown as Abi,
      meta: { source: "manual", label: `MARKET self-approve ${venue.s} → the venue itself` },
    });
  };

  const beginRedeem = async () => {
    if (!account || amount === null || !qingAbi) return;
    await action.begin({
      to: venueAddr,
      data: encodeFunctionData({ abi: [pickFn(qingAbi, "Redeem", 2)], functionName: "Redeem", args: [addr("AFFECTION"), amount] }),
      account,
      abi: qingAbi,
      meta: { source: "manual", label: `MARKET Redeem ${venue.n || venueAddr}` },
    });
  };

  const dryRunRedeem = async () => {
    if (!account || amount === null || !qingAbi) return;
    setProbe(null);
    const env = await action.probe({
      to: venueAddr,
      data: encodeFunctionData({ abi: [pickFn(qingAbi, "Redeem", 2)], functionName: "Redeem", args: [addr("AFFECTION"), amount] }),
      account,
      abi: qingAbi,
      meta: { source: "manual", label: `MARKET Redeem DRYRUN ${venue.n || venueAddr}` },
    });
    setProbe(env);
  };

  useEffect(() => {
    if (action.outcome?.status === "sent") {
      leg.refresh();
      live.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.outcome]);

  return (
    <div className="panel" data-testid="market-redeem">
      <h2>the AFFECTION redeem leg — the reverse bridge</h2>
      <p className="hint">
        Redeem(AFFECTION, amount) hands back {venue.s} and pays amount × the Ⓐ rate out of the venue's
        Ⓐ escrow — the exact Purchase reverse. the prerequisite is a quirk: the venue-token allowance's
        spender is <span className="mono">THE VENUE ITSELF</span> (the base Redeem pulls its own token
        via transferFrom). fork-pinned session-52 (harness set-2 s12).
      </p>
      {leg.error && <p className="err-text">redeem-leg reads unavailable: {leg.error}</p>}
      <dl className="kv" data-testid="market-redeem-preview">
        <dt>Ⓐ payout (at the live rate)</dt>
        <dd className="mono">{payout !== null && live.state?.marketRateKnown ? `${fmtAmt(payout)} Ⓐ` : "—"}</dd>
        <dt>your {venue.s}</dt>
        <dd className="mono">{myQing !== null ? fmtAmt(myQing) : account === null ? "—" : "…"}</dd>
        <dt>venue's Ⓐ escrow</dt>
        <dd className="mono">{escrow !== null ? fmtAmt(escrow) : "…"}</dd>
        <dt>{venue.s} allowance → the venue</dt>
        <dd className="mono">{selfAllowance !== null ? fmtAmt(selfAllowance) : account === null ? "—" : "…"}</dd>
      </dl>
      {payout !== null && escrow !== null && escrow < payout && (
        <p className="err-text" data-testid="market-redeem-thin-escrow">
          the venue's Ⓐ escrow is below this payout — it only holds what Purchases deposited; Redeem
          reverts insufficient-balance rather than paying.
        </p>
      )}
      {myQing !== null && amount !== null && myQing < amount && (
        <p className="err-text" data-testid="market-redeem-insufficient">
          you hold less {venue.s} than the redeem amount.
        </p>
      )}
      <div className="studio-actions">
        <button className="btn" disabled={!account || amount === null || live.state?.marketRateKnown !== true} onClick={() => void dryRunRedeem()} data-testid="market-redeem-dryrun">
          DRYRUN
        </button>
        <button
          className="btn"
          disabled={!account || amount === null || amount === 0n || payout === null || payout === 0n || needsSelfApprove || action.busy}
          onClick={() => void beginRedeem()}
          data-testid="market-redeem-send"
        >
          SEND — Redeem {walletMode === "A" ? "(wallet prompts)" : "(approval card)"}
        </button>
        {needsSelfApprove && amount !== null && (
          <button className="btn" disabled={!account || action.busy} onClick={() => void beginSelfApprove()} data-testid="market-self-approve-send">
            SEND — Approve {venue.s} {fmtAmt(amount)} → the venue
          </button>
        )}
      </div>
      {probe && probe.sim && (
        <div className="studio-result" data-testid="market-redeem-sim">
          <pre className="mono">
            {probe.sim.ok
              ? `DRYRUN ok\ngas ~${probe.sim.gas?.toString() ?? "?"}`
              : `DRYRUN revert${probe.sim.error?.decoded ? `: ${probe.sim.error.decoded}` : ""}\n${probe.sim.error?.message ?? ""}`}
          </pre>
        </div>
      )}
      {action.error && <p className="err-text">{action.error}</p>}
      {action.outcome && (
        <div className="studio-result" data-testid="market-redeem-outcome">
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

// ---------------- EXCHANGE (the YUE Hong/Hung desk, session-52 B1.5) ----------------

function ExchangeTab({
  chain,
  snapshot,
  venue,
}: {
  chain: ChainState;
  snapshot: PlayerSnapshot | null;
  venue: { a: string; n: string; s: string } | null;
}) {
  const wallet = useWallet();
  const account = (wallet.account ?? null) as Address | null;
  const yue = (snapshot?.yue ?? null) as Address | null;
  const venueAddr = (venue?.a ?? null) as Address | null;
  const live = useVenueState(chain.url, venueAddr, account);
  const asset = (live.state?.asset ?? null) as Address | null;
  const desk = useYueDesk(chain.url, yue, venueAddr, asset, account);
  const action = useGateAction();

  const [dir, setDir] = useState<"hong" | "hung">("hong");
  const [amountText, setAmountText] = useState("");
  const [probe, setProbe] = useState<GateEnvelope | null>(null);
  const [yueAbi, setYueAbi] = useState<Abi | null>(null);

  useEffect(() => {
    loadAbi("YUE.json")
      .then(setYueAbi)
      .catch(() => setYueAbi(null));
  }, []);

  const amount = parseAmount(amountText);
  const rate = desk.state?.rate ?? null;
  const hasRoute = rate !== null && rate !== 0n;
  const cost = amount !== null && hasRoute ? purchaseCost(amount, rate!) : null;

  const s = desk.state;
  const spendBalance = dir === "hong" ? (s?.myAsset ?? null) : (s?.myQing ?? null);
  const spendAllowance = dir === "hong" ? (s?.assetAllowance ?? null) : (s?.qingAllowance ?? null);
  const payoutPot = dir === "hong" ? (s?.yueQingPot ?? null) : (s?.yueAssetPot ?? null);
  const spendNeed = dir === "hong" ? cost : amount; // Hong spends `cost` asset; Hung spends `amount` qing
  const needsApprove = spendNeed !== null && spendNeed > 0n && (spendAllowance === null || spendAllowance < spendNeed);

  const beginApprove = async () => {
    if (!account || !yue || spendNeed === null || spendNeed === 0n || asset === null) return;
    const token = dir === "hong" ? asset : (venueAddr as Address);
    await action.begin({
      to: token,
      data: encodeFunctionData({ abi: erc20ApproveAbi, functionName: "approve", args: [yue, spendNeed] }),
      account,
      abi: [...erc20ApproveAbi] as unknown as Abi,
      meta: { source: "manual", label: `MARKET EXCHANGE approve ${dir === "hong" ? "asset" : (venue?.s ?? "qing")} → your YUE` },
    });
  };

  const encodeDesk = () => {
    if (!yueAbi || !yue || !venueAddr || !asset || amount === null) return null;
    return dir === "hong"
      ? {
          to: yue,
          data: encodeFunctionData({ abi: [pickFn(yueAbi, "Hong", 3)], functionName: "Hong", args: [asset, venueAddr, amount] }),
          abi: yueAbi,
          label: `MARKET EXCHANGE Hong ${venue?.n || venueAddr}`,
        }
      : {
          to: yue,
          data: encodeFunctionData({ abi: [pickFn(yueAbi, "Hung", 3)], functionName: "Hung", args: [venueAddr, asset, amount] }),
          abi: yueAbi,
          label: `MARKET EXCHANGE Hung ${venue?.n || venueAddr}`,
        };
  };

  const dryRun = async () => {
    const req = encodeDesk();
    if (!req || !account) return;
    setProbe(null);
    const env = await action.probe({
      to: req.to,
      data: req.data,
      account,
      abi: req.abi,
      meta: { source: "manual", label: `${req.label} DRYRUN` },
    });
    setProbe(env);
  };

  const begin = async () => {
    const req = encodeDesk();
    if (!req || !account) return;
    await action.begin({ to: req.to, data: req.data, account, abi: req.abi, meta: { source: "manual", label: req.label } });
  };

  useEffect(() => {
    if (action.outcome?.status === "sent") {
      desk.refresh();
      live.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.outcome]);

  if (snapshot !== null && yue === null) {
    return (
      <div className="market-exchange" data-testid="market-exchange">
        <div className="panel">
          <h2>
            the vault exchange desk (Hong / Hung) <LearnHint file="economy.md" anchor="the-internal-exchange" />
          </h2>
          <p className="hint" data-testid="market-exchange-no-yue">
            this desk lives ON your YUE — you have none yet. open the account first: IDENTITY → start
            your YUE (SEI.Start). same prerequisite as the settle verb.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="market-exchange" data-testid="market-exchange">
      <div className="panel">
        <h2>
          the vault exchange desk (Hong / Hung) <LearnHint file="economy.md" anchor="the-internal-exchange" />
        </h2>
        {venue === null ? (
          <p className="hint">no venue selected — pick one in the sidebar; the desk trades its token against its wrapped asset.</p>
        ) : account === null ? (
          <p className="hint">connect an account (SETTINGS → wallet) — the desk swaps through YOUR vault.</p>
        ) : (
          <>
            <dl className="kv">
              <dt>venue</dt>
              <dd className="mono">
                {venue.n.length > 0 ? venue.n : venue.a} ({venue.s}){" "}
                <a className="outlink" href={`${EXPLORER_BASE}${venue.a}`} target="_blank" rel="noreferrer noopener">
                  ↗
                </a>
              </dd>
              <dt>wrapped asset</dt>
              <dd className="mono">{asset !== null ? asset : live.error ? "read failed" : "…"}</dd>
              <dt>your YUE (the desk)</dt>
              <dd className="mono">{yue !== null ? yue : "—"}</dd>
            </dl>
            {live.error && <p className="err-text">venue reads unavailable: {live.error}</p>}
            {desk.error && <p className="err-text">desk reads unavailable: {desk.error}</p>}
            {asset !== null && (
              <>
                <nav className="dock-tabs" aria-label="desk direction">
                  <button className={dir === "hong" ? "dock-tab active" : "dock-tab"} onClick={() => setDir("hong")} data-testid="market-exchange-hong">
                    HONG — buy {venue.s} with the wrapped asset
                  </button>
                  <button className={dir === "hung" ? "dock-tab active" : "dock-tab"} onClick={() => setDir("hung")} data-testid="market-exchange-hung">
                    HUNG — redeem {venue.s} into the wrapped asset
                  </button>
                </nav>
                <div className="arg-row">
                  <label htmlFor="market-exchange-amount">amount of {venue.s} {dir === "hong" ? "to buy" : "to redeem"}</label>
                  <input
                    id="market-exchange-amount"
                    className="mono"
                    spellCheck={false}
                    placeholder="1.0"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    data-testid="market-exchange-amount"
                  />
                </div>
                <dl className="kv" data-testid="market-exchange-preview">
                  <dt>rate (GetAssetRate — live walk)</dt>
                  <dd className="mono">{rate !== null ? (hasRoute ? `${fmtAmt(rate)} asset / 1.0 ${venue.s}` : "0 — NO ROUTE") : "…"}</dd>
                  <dt>{dir === "hong" ? "you pay (wrapped asset)" : "you receive (wrapped asset)"}</dt>
                  <dd className="mono">{cost !== null && hasRoute ? fmtAmt(cost) : "—"}</dd>
                  <dt>{dir === "hong" ? `you receive (${venue.s})` : `you hand back (${venue.s})`}</dt>
                  <dd className="mono">{amount !== null ? fmtAmt(amount) : "—"}</dd>
                  <dt>your {dir === "hong" ? "wrapped asset (wallet)" : `${venue.s} (wallet)`}</dt>
                  <dd className="mono">{spendBalance !== null ? fmtAmt(spendBalance) : "…"}</dd>
                  <dt>allowance → your YUE</dt>
                  <dd className="mono">{spendAllowance !== null ? fmtAmt(spendAllowance) : "…"}</dd>
                  <dt>the vault's payout pot</dt>
                  <dd className="mono">{payoutPot !== null ? fmtAmt(payoutPot) : "…"}</dd>
                </dl>
                {rate !== null && !hasRoute && (
                  <p className="err-text" data-testid="market-exchange-no-route">
                    GetAssetRate walked 0 — no route. this venue carries no posted rate for its own
                    wrapped asset; Hong/Hung revert ExchangeRateNotFound until an owner runs
                    AddMarketRate(asset, ·).
                  </p>
                )}
                {s?.pairValid === false && (
                  <p className="err-text">the pair check fails — Hong/Hung revert InvalidPair for this asset.</p>
                )}
                {spendNeed !== null && spendBalance !== null && spendBalance < spendNeed && (
                  <p className="err-text" data-testid="market-exchange-insufficient">
                    wallet short of the {dir === "hong" ? "wrapped asset" : venue.s} leg — the desk pulls it via transferFrom.
                  </p>
                )}
                {amount !== null && cost !== null && payoutPot !== null && hasRoute && payoutPot < (dir === "hong" ? amount : cost) && (
                  <p className="err-text" data-testid="market-exchange-thin-pot">
                    your vault holds less {dir === "hong" ? venue.s : "of the wrapped asset"} than this pays out — BOTH desk
                    legs pay from the VAULT'S OWN inventory (fork-pinned), so the vault must already hold
                    the {dir === "hong" ? venue.s : "asset"} side. (Hung pays the rate-scaled cost — amount × rate / 1e18
                    of the asset, yue.sol:63-66 — not the raw venue-token amount.)
                  </p>
                )}
                <p className="hint">
                  {dir === "hong" ? "Hong" : "Hung"} runs on YOUR YUE at the composed GetAssetRate walk; the
                  vault is the counterparty on both legs — it pays out of its own holdings and keeps what
                  you pay in. exact-amount APPROVE first when the allowance is short; every send goes
                  through the ONE gate. YUE sends are factory-instance contracts — the approval card
                  carries the extra ack (intended).
                </p>
                <div className="studio-actions">
                  <button className="btn" disabled={!hasRoute || amount === null || !yueAbi} onClick={() => void dryRun()} data-testid="market-exchange-dryrun">
                    DRYRUN
                  </button>
                  <button
                    className="btn"
                    disabled={!hasRoute || amount === null || amount === 0n || cost === null || cost === 0n || needsApprove || action.busy}
                    onClick={() => void begin()}
                    data-testid="market-exchange-send"
                  >
                    SEND — {dir === "hong" ? "Hong" : "Hung"} {wallet.mode === "A" ? "(wallet prompts)" : "(approval card)"}
                  </button>
                  {needsApprove && spendNeed !== null && (
                    <button className="btn" disabled={!account || action.busy || !yue} onClick={() => void beginApprove()} data-testid="market-exchange-approve-send">
                      SEND — Approve {dir === "hong" ? "asset" : venue.s} {fmtAmt(spendNeed)} → YUE
                    </button>
                  )}
                </div>
                {probe && probe.sim && (
                  <div className="studio-result" data-testid="market-exchange-sim">
                    <pre className="mono">
                      {probe.sim.ok
                        ? `DRYRUN ok\ngas ~${probe.sim.gas?.toString() ?? "?"}`
                        : `DRYRUN revert${probe.sim.error?.decoded ? `: ${probe.sim.error.decoded}` : ""}\n${probe.sim.error?.message ?? ""}`}
                    </pre>
                  </div>
                )}
                {action.error && <p className="err-text">{action.error}</p>}
                {action.outcome && (
                  <div className="studio-result" data-testid="market-exchange-outcome">
                    <OutcomeLine outcome={action.outcome} />
                  </div>
                )}
                {action.envelope && (
                  <ApprovalCard
                    envelope={action.envelope}
                    mode={wallet.mode}
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
              </>
            )}
          </>
        )}
      </div>
      <details className="explain" data-testid="market-exchange-explain">
        <summary>? the 777-mod attenuation — why always GetAssetRate first</summary>
        <p className="hint">
          the desk prices through a WALK: start at the venue and hop inward via Asset(); each hop reads
          the venue's posted rate for its parent and multiplies it into an accumulator. whenever a
          posted rate is "cheap" — rate ÷ 1e16 under 777 (under 7.77 per unit) — the accumulator is
          DIVIDED by (777 − Mod) × 10¹³, and it is re-normalized whenever it crosses 1e18. chained
          pricing is deliberately lossy, and a hop with no posted rate kills the route outright (0 ⇒
          ExchangeRateNotFound). on the DIRECT pair (a venue and its own wrapped asset — what this desk
          trades) the accumulator is still zero on hop one, so the walk returns the POSTED rate
          unchanged; the attenuation only bites on chained QING-on-QING routes, which additionally
          require unlock-lottery venues to walk at all. fork-pinned session-52 (harness set-2 s12).
        </p>
      </details>
    </div>
  );
}

// ---------------- PAIRS ----------------

function PairsTab() {
  const [pairs, setPairs] = useState<PairRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    loadPairs()
      .then((rows) => {
        if (alive) setPairs(rows);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const found = useMemo(() => (pairs !== null ? searchPairs(pairs, query) : null), [pairs, query]);

  return (
    <div className="market-pairs" data-testid="market-pairs">
      <div className="panel">
        <h2>curated pairs — out-links only</h2>
        <p className="hint">
          {pairs !== null ? `${pairs.length} curated LPs ` : "… "}
          (the W3b reconciliation, `in_webs` only + core-reserve best pairs). links out to the block
          explorer and dexscreener — there is NO trading surface in this terminal; figures are
          WPLS-anchored only (never pseudo-USD).
        </p>
        <input
          className="venue-search mono"
          type="search"
          placeholder="search ticker · label · address"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="search pairs"
          data-testid="pairs-search"
        />
        {error && <p className="err-text">{error}</p>}
        {pairs === null && !error && <p className="hint">loading the pairs seed…</p>}
        {found !== null && found.total > found.rows.length && (
          <p className="hint" data-testid="pairs-more">
            showing {found.rows.length} of {found.total} matches — refine the search
          </p>
        )}
        <div className="table-wrap pairs-table-wrap">
          <table className="kv-table" data-testid="pairs-table">
            <thead>
              <tr>
                <th>curated</th>
                <th>pair</th>
                <th>factory</th>
                <th>liquidity (WPLS-anchored)</th>
                <th>links</th>
              </tr>
            </thead>
            <tbody>
              {found?.rows.map((r) => {
                const links = pairLinks(r);
                return (
                  <tr key={r.p} data-testid="pairs-row">
                    <td className="mono power-key">{r.cur ?? <span className="dim">core-reserve</span>}</td>
                    <td className="mono">
                      {pairLegLabel(r, 0)} / {pairLegLabel(r, 1)}
                    </td>
                    <td className="mono">{r.f}</td>
                    <td className="mono">
                      {fmtWpls(r.wpls)}
                      {r.live !== null && <span className="dim"> · {r.live.toLocaleString()} live pairs</span>}
                    </td>
                    <td>
                      <a className="outlink" href={links.explorer} target="_blank" rel="noreferrer noopener" data-testid="pairs-explorer">
                        ↗ explorer
                      </a>{" "}
                      <a className="outlink" href={links.dexscreener} target="_blank" rel="noreferrer noopener" data-testid="pairs-dexscreener">
                        ↗ dexscreener
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
