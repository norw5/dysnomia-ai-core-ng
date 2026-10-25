import { useEffect, useRef, useState } from "react";
import { EXPLORER_BASE, addr } from "@config/addresses";
import { fmtAmt, type PlayerSnapshot } from "@/chain/identity";
import {
  affectionApproveData,
  AFFECTION_UNIT,
  dssChatAndSnipeData,
  dssChatData,
  dssWithdrawLauData,
  lauMintToCapData,
  lauPurchaseData,
  useDssDesk,
} from "@/chain/dssDesk";
import { parseAmount, UNIT } from "@/chain/deskMath";
import { useGateAction } from "@/chain/useGateAction";
import { useDssDeploy } from "@/ui/useDssDeploy";
import { ApprovalCard } from "@/ui/ApprovalCard";
import { messageFenceError } from "@/ui/WorldComposer";
import { useWallet } from "@/wallet/WalletContext";
import type { Address } from "viem";

/**
 * The LAU EMISSION + DSS self-snipe desk (session-66) on IDENTITY. Two
 * halves of one economics (fork-pinned set-2 s14):
 *
 *  - EMISSION: every owner action on your LAU meters 1 unit into the
 *    LAU's OWN balance — a pool ANYONE can buy at 1 Ⓐ/unit (the front-run
 *    window). mintToCap() mints silently (no chat line — batch self-mint
 *    never spams); ONE Purchase(AFFECTION, N×1e18) collects N units.
 *
 *  - THE BUNDLER (DSS): the community self-snipe gist with the one-line
 *    constructor fix (harness fixture dss-fixed, byte-pinned). Deployed by
 *    YOU through THE gate (a creation tx — risk class "deploy"); binds
 *    YOUR LAU at construction; chatAndSnipe bundles world-line + 1-Ⓐ
 *    self-purchase atomically — no window between your line and your
 *    collection. The DSS has NO getter — the address is captured at the
 *    creating receipt (state/dssStore.ts); deployed-elsewhere reads as
 *    not deployed.
 */

export function DssDeskPanel({
  chainUrl,
  account,
  snapshot,
  pendingLau,
  onSent,
}: {
  chainUrl: string;
  account: Address | null;
  snapshot: PlayerSnapshot | null;
  pendingLau: Address | null;
  onSent: () => void;
}) {
  const wallet = useWallet();
  const lau = (snapshot?.lau ?? pendingLau ?? null) as Address | null;
  const deployFlow = useDssDeploy(chainUrl, lau);
  const dssRecord = deployFlow.dss;
  const dss = dssRecord?.dss ?? null;

  const [sentTick, setSentTick] = useState(0);
  const bump = () => setSentTick((t) => t + 1);
  const desk = useDssDesk(chainUrl, account, lau, dss, sentTick);

  // any sent outcome re-reads the desk (pool/allowances move)
  useEffect(() => {
    if (deployFlow.action.outcome?.status === "sent") bump();
  }, [deployFlow.action.outcome]);

  if (account === null) {
    return (
      <section className="panel" data-testid="dss-desk">
        <h2>LAU EMISSION + SELF-SNIPE DESK</h2>
        <p className="hint">connect a wallet (SETTINGS → wallet) to raise the desk.</p>
      </section>
    );
  }

  return (
    <section className="panel" data-testid="dss-desk">
      <h2>LAU EMISSION + SELF-SNIPE DESK</h2>
      {lau === null ? (
        <p className="hint" data-testid="dss-desk-nolau">
          the desk binds your LAU — create one (or finish onboarding) first.
        </p>
      ) : (
        <>
          <EmissionBlock
            chainUrl={chainUrl}
            account={account}
            lau={lau}
            deskState={desk.state}
            deskError={desk.error}
            onSent={() => {
              bump();
              onSent();
            }}
          />
          <BundlerBlock
            chainUrl={chainUrl}
            account={account}
            walletMode={wallet.mode}
            deployFlow={deployFlow}
            deskState={desk.state}
            onSent={() => {
              bump();
              onSent();
            }}
          />
        </>
      )}
    </section>
  );
}

function OutcomeLine({ outcome }: { outcome: ReturnType<typeof useGateAction>["outcome"] }) {
  if (outcome === null) return null;
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
          {outcome.receipt.contractAddress !== null && <> · created {outcome.receipt.contractAddress}</>}
        </div>
      )}
      {outcome.receiptError && <div className="err-text">receipt: {outcome.receiptError}</div>}
    </>
  );
}

function LocalCard({
  action,
  mode,
}: {
  action: ReturnType<typeof useGateAction>;
  mode: string;
}) {
  if (action.envelope === null) return null;
  return (
    <ApprovalCard
      envelope={action.envelope}
      mode={mode}
      busy={action.busy}
      onResolve={(accept, allowSimFailure) => {
        if (!accept) {
          action.reject();
          return;
        }
        void action.confirm(allowSimFailure);
      }}
    />
  );
}

function EmissionBlock({
  account,
  lau,
  deskState,
  deskError,
  onSent,
}: {
  chainUrl: string;
  account: Address;
  lau: Address;
  deskState: ReturnType<typeof useDssDesk>["state"];
  deskError: string | null;
  onSent: () => void;
}) {
  const wallet = useWallet();
  const action = useGateAction();
  const [units, setUnits] = useState("1");
  const chained = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (action.outcome?.status === "sent") {
      const next = chained.current;
      chained.current = null;
      if (next) next();
      else onSent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.outcome]);

  const parsed = parseAmount(units);
  const cost = parsed !== null ? parsed : null;
  const pool = deskState?.lauPool ?? null;
  const allowance = deskState?.affectionToLau ?? null;
  const allowanceShort = allowance === null || cost === null || allowance < cost;
  const walletShort = deskState !== null && deskState.myAffection !== null && cost !== null && deskState.myAffection < cost;

  const beginMint = async () => {
    await action.begin({
      to: lau,
      data: lauMintToCapData(),
      account,
      meta: { source: "manual", label: "EMISSION silent mint (LAU.mintToCap)" },
    });
  };

  const beginCollect = async () => {
    if (cost === null || cost <= 0n) return;
    const purchase = () =>
      void action.begin({
        to: lau,
        data: lauPurchaseData(cost),
        account,
        meta: { source: "manual", label: `EMISSION collect ${fmtAmt(cost)} LAU for ${fmtAmt(cost)} Ⓐ` },
      });
    if (allowanceShort) {
      // the auto-approve-when-short pattern (deskTools): exact-amount
      // Ⓐ APPROVE first, then the Purchase — two gate sends
      chained.current = purchase;
      await action.begin({
        to: addr("AFFECTION"),
        data: affectionApproveData(lau, cost),
        account,
        meta: { source: "manual", label: "EMISSION approve Ⓐ → your LAU (exact)" },
      });
      return;
    }
    purchase();
  };

  return (
    <div data-testid="dss-emission">
      <h3>your LAU emission — the purchasable pool</h3>
      <p className="hint">
        every owner action on your LAU (a chat line, a Username set, a silent mint) meters{" "}
        <span className="mono">1 unit</span> into the LAU's own balance. that pool is{" "}
        <strong>publicly purchasable at 1 Ⓐ per unit</strong> — anyone front-running your emission
        collects YOUR identity tokens (they feed Yuan ×10 and the soeng ladder). collect your own:
        <code> LAU.Purchase(AFFECTION, amount)</code>.
      </p>
      <dl className="kv">
        <dt>pool (held by your LAU)</dt>
        <dd className="mono">{pool !== null ? `${fmtAmt(pool)} units` : "—"}</dd>
        <dt>your Ⓐ</dt>
        <dd className="mono">{deskState !== null && deskState.myAffection !== null ? fmtAmt(deskState.myAffection) : "—"}</dd>
        <dt>Ⓐ allowance → your LAU</dt>
        <dd className="mono">{allowance !== null ? fmtAmt(allowance) : "—"}</dd>
      </dl>
      {deskError !== null && <p className="err-text">desk reads unavailable: {deskError.slice(0, 120)}</p>}
      <div className="studio-actions">
        <button className="btn" disabled={action.busy} onClick={() => void beginMint()} data-testid="dss-mint">
          MINT +1 — SILENT (no chat line)
        </button>
      </div>
      <div className="arg-row">
        <label htmlFor="dss-collect-units">collect units (1 Ⓐ each)</label>
        <input
          id="dss-collect-units"
          className="mono"
          spellCheck={false}
          placeholder="e.g. 3"
          value={units}
          onChange={(e) => setUnits(e.target.value)}
          data-testid="dss-collect-units"
        />
      </div>
      {walletShort && (
        <p className="err-text" data-testid="dss-collect-short">
          wallet Ⓐ short of the collect cost — acquire Ⓐ first (MARKET → ASSETS).
        </p>
      )}
      <div className="studio-actions">
        <button
          className="btn btn-primary"
          disabled={action.busy || cost === null || cost <= 0n || walletShort || (pool !== null && pool < cost)}
          onClick={() => void beginCollect()}
          data-testid="dss-collect"
        >
          COLLECT {cost !== null ? fmtAmt(cost) : "—"} units{allowanceShort ? " (approve + purchase — two sends)" : ""}
        </button>
      </div>
      {action.error && <p className="err-text">{action.error}</p>}
      {action.outcome && (
        <div className="studio-result" data-testid="dss-emission-outcome">
          <OutcomeLine outcome={action.outcome} />
        </div>
      )}
      <LocalCard action={action} mode={wallet.mode} />
    </div>
  );
}

function BundlerBlock({
  account,
  walletMode,
  deployFlow,
  deskState,
  onSent,
}: {
  chainUrl: string;
  account: Address;
  walletMode: string;
  deployFlow: ReturnType<typeof useDssDeploy>;
  deskState: ReturnType<typeof useDssDesk>["state"];
  onSent: () => void;
}) {
  const wallet = useWallet();
  const action = useGateAction();
  const [text, setText] = useState("");
  const chained = useRef<(() => void) | null>(null);
  const dssRecord = deployFlow.dss;
  const dss = dssRecord?.dss ?? null;

  useEffect(() => {
    if (action.outcome?.status === "sent") {
      const next = chained.current;
      chained.current = null;
      if (next) next();
      else onSent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.outcome]);

  const fence = messageFenceError(text);
  const snipeAllowance = deskState?.affectionToDss ?? null;
  const snipeShort = snipeAllowance === null || snipeAllowance < AFFECTION_UNIT;

  const beginSnipe = async () => {
    if (dss === null || fence !== null) return;
    const snipe = () =>
      void action.begin({
        to: dss,
        data: dssChatAndSnipeData(text),
        account,
        meta: { source: "manual", label: "DSS chatAndSnipe (world line + self-purchase)" },
      });
    if (snipeShort) {
      // exact 1e18 Ⓐ APPROVE (spender = the DSS) first, then the snipe
      chained.current = snipe;
      await action.begin({
        to: addr("AFFECTION"),
        data: affectionApproveData(dss, AFFECTION_UNIT),
        account,
        meta: { source: "manual", label: "DSS approve Ⓐ → your bundler (exact 1)" },
      });
      return;
    }
    snipe();
  };

  const beginChat = async () => {
    if (dss === null || fence !== null) return;
    await action.begin({
      to: dss,
      data: dssChatData(text),
      account,
      meta: { source: "manual", label: "DSS plain chat (the below-1-Ⓐ fallback)" },
    });
  };

  const beginWithdraw = async () => {
    if (dss === null) return;
    await action.begin({
      to: dss,
      data: dssWithdrawLauData(UNIT),
      account,
      meta: { source: "manual", label: "DSS withdrawLAU (1 unit)" },
    });
  };

  return (
    <div data-testid="dss-bundler">
      <h3>the self-snipe bundler (DSS)</h3>
      {dss === null ? (
        <>
          <p className="hint">
            the community self-snipe gist, one-line-fixed (the as-shipped version binds address(0)
            and reverts — kb §DSS; our reference is the harness-byte-pinned fix). deploying binds{" "}
            <strong>your LAU</strong> at construction and costs deploy gas only — after that{" "}
            <code>chatAndSnipe(text)</code> posts your world line and self-purchases the minted
            unit atomically for 1 Ⓐ. the DSS carries no getter — the app remembers the address from
            the creation receipt (deployed-elsewhere reads as not deployed).
          </p>
          <dl className="kv">
            <dt>predicted address</dt>
            <dd className="mono">
              {deployFlow.predicted ?? (deployFlow.predictionError !== null ? "unreadable" : "…")}
            </dd>
          </dl>
          {deployFlow.predictionError !== null && (
            <p className="hint">prediction read failed: {deployFlow.predictionError.slice(0, 100)}</p>
          )}
          <div className="studio-actions">
            <button
              className="btn btn-primary"
              disabled={deployFlow.action.busy}
              onClick={() => void deployFlow.deploy()}
              data-testid="dss-deploy"
            >
              DEPLOY THE FIXED DSS {walletMode === "A" ? "(wallet prompts)" : walletMode === "C" ? "(yolo — policy only)" : "(approval card)"}
            </button>
          </div>
          {deployFlow.action.error && <p className="err-text">{deployFlow.action.error}</p>}
          {deployFlow.action.outcome && (
            <div className="studio-result" data-testid="dss-deploy-outcome">
              <OutcomeLine outcome={deployFlow.action.outcome} />
              {deployFlow.action.outcome.status === "sent" && dss === null && (
                <p className="hint">address captured from the receipt — awaiting the read…</p>
              )}
            </div>
          )}
          <LocalCard action={deployFlow.action} mode={walletMode} />
        </>
      ) : (
        <>
          <dl className="kv">
            <dt>your bundler</dt>
            <dd>
              <span className="mono">{dss}</span>{" "}
              <a className="outlink" href={`${EXPLORER_BASE}${dss}`} target="_blank" rel="noreferrer noopener">
                ↗
              </a>
            </dd>
            <dt>bound LAU</dt>
            <dd className="mono">{dssRecord?.lau ?? "—"}</dd>
            <dt>code at the address</dt>
            <dd className="mono">
              {deskState?.dssDeployed === null || deskState === null
                ? "unreadable"
                : deskState.dssDeployed
                  ? "present"
                  : "EMPTY (wrong chain? recreated?)"}
            </dd>
            <dt>Ⓐ allowance → the DSS</dt>
            <dd className="mono">{snipeAllowance !== null ? fmtAmt(snipeAllowance) : "—"}</dd>
          </dl>
          <div className="arg-row">
            <label htmlFor="dss-snipe-text">world line (public, permanent — “&lt;Username&gt; …”)</label>
            <input
              id="dss-snipe-text"
              className="mono"
              spellCheck={false}
              placeholder="say something to the world"
              value={text}
              onChange={(e) => setText(e.target.value)}
              data-testid="dss-snipe-text"
            />
          </div>
          {fence !== null && text.length > 0 && <p className="err-text">{fence}</p>}
          <div className="studio-actions">
            <button
              className="btn btn-primary"
              disabled={action.busy || fence !== null || text.trim().length === 0}
              onClick={() => void beginSnipe()}
              data-testid="dss-snipe"
            >
              CHAT + SELF-SNIPE — 1 Ⓐ{snipeShort ? " (approve + snipe — two sends)" : ""}
            </button>
            <button
              className="btn"
              disabled={action.busy || fence !== null || text.trim().length === 0}
              onClick={() => void beginChat()}
              data-testid="dss-plain-chat"
            >
              PLAIN CHAT (no Ⓐ — the unit stays in the pool)
            </button>
            <button className="btn" disabled={action.busy} onClick={() => void beginWithdraw()} data-testid="dss-withdraw">
              WITHDRAW 1 LAU from the bundler
            </button>
          </div>
          {action.error && <p className="err-text">{action.error}</p>}
          {action.outcome && (
            <div className="studio-result" data-testid="dss-bundler-outcome">
              <OutcomeLine outcome={action.outcome} />
            </div>
          )}
          <LocalCard action={action} mode={wallet.mode} />
        </>
      )}
    </div>
  );
}
