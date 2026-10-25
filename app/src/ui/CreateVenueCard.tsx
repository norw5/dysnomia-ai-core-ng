import { useEffect, useMemo, useState } from "react";
import { encodeFunctionData, type Abi, type AbiFunction, type Address } from "viem";
import { EXPLORER_BASE, addr } from "@config/addresses";
import { loadAbi } from "@/chain/abiLoad";
import { makeClient } from "@/chain/client";
import { useGateAction } from "@/chain/useGateAction";
import { useWallet } from "@/wallet/WalletContext";
import { ApprovalCard } from "@/ui/ApprovalCard";
import { setCurrentVenue } from "@/state/venueStore";
import { decodeNewQing, liveVenueRow, readCreatePrecheck, type CreatePrecheck } from "@/chain/venueDeed";
import { readWalletLau } from "@/chain/identity";
import { pendingLau } from "@/state/pendingLau";
import { setHomeVenue } from "@/state/homeVenue";
import type { ChainState } from "@/chain/useChainState";
import type { GateEnvelope, GateOutcome } from "@/chain/txGate";

/**
 * Venue creation (session-51, IA-REEVAL-49 B1.8 — the §7.3 `create_venue`
 * story, manual side): MAP.New(asset) wraps any ERC-20 into a fresh QING —
 * no approval, gas only. The card carries the honest preview story
 * (Forbidden pre-check read WITH the account so the WITHOUT ban leg is
 * caller-honest; one-QING-per-asset ever with no asset→QING getter, so the
 * DRYRUN is the pre-check; the tile-collision assert; preview before
 * creating, never spray-create) and decodes NewQing from the sent receipt —
 * NewQing's args are NOT indexed, so the data words carry
 * (Qing, Integrative, Waat).
 */

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function pickFn(abi: Abi, name: string, inputCount: number): AbiFunction {
  const hits = abi.filter((e): e is AbiFunction => e.type === "function" && e.name === name && e.inputs.length === inputCount);
  if (hits.length === 0) throw new Error(`ABI fragment not found: ${name}/${inputCount}`);
  return hits[0]!;
}

function OutcomeLine({ outcome }: { outcome: GateOutcome }) {
  if (outcome.status === "denied") return <span className="err-text">DENIED by policy: {outcome.reasons.join("; ")}</span>;
  if (outcome.status === "sim-failed")
    return <span className="err-text">blocked: DRYRUN reverted — override needs the explicit card ack</span>;
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

export function CreateVenueCard({ chain }: { chain: ChainState }) {
  const wallet = useWallet();
  const account = wallet.account;
  const action = useGateAction();
  const [assetText, setAssetText] = useState("");
  const [mapAbi, setMapAbi] = useState<Abi | null>(null);
  const [precheck, setPrecheck] = useState<CreatePrecheck | null>(null);
  const [precheckBusy, setPrecheckBusy] = useState(false);
  const [dryEnv, setDryEnv] = useState<GateEnvelope | null>(null);
  const [dryBusy, setDryBusy] = useState(false);
  const [gwat, setGwat] = useState<boolean | null>(null);
  const [selected, setSelected] = useState(false);

  const asset = useMemo(() => (ADDRESS_RE.test(assetText.trim()) ? (assetText.trim() as Address) : null), [assetText]);

  const loadMapAbi = async (): Promise<Abi | null> => {
    if (mapAbi !== null) return mapAbi;
    const abi = await loadAbi("MAP.json");
    setMapAbi(abi);
    return abi;
  };

  const runPrecheck = async () => {
    if (asset === null) return;
    setPrecheckBusy(true);
    try {
      const client = makeClient(chain.url);
      setPrecheck(await readCreatePrecheck(client, asset, account));
    } catch (e) {
      setPrecheck({ forbidden: null, assetName: null, assetSymbol: null, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setPrecheckBusy(false);
    }
  };

  const newRequest = async () => {
    if (asset === null || account === null) return null;
    const abi = await loadMapAbi();
    if (abi === null) return null;
    return {
      to: addr("MAP"),
      data: encodeFunctionData({ abi: [pickFn(abi, "New", 1)], functionName: "New", args: [asset] }),
      account,
      abi,
      meta: { source: "manual" as const, label: `MAP create venue for ${asset}` },
    };
  };

  const dryRun = async () => {
    if (asset === null || account === null) return;
    setDryBusy(true);
    setDryEnv(null);
    try {
      const req = await newRequest();
      if (req === null) return;
      setDryEnv(await action.probe(req));
    } finally {
      setDryBusy(false);
    }
  };

  const beginSend = async () => {
    if (asset === null || account === null) return;
    const req = await newRequest();
    if (req === null) return;
    await action.begin(req);
  };

  // post-send: decode NewQing from the receipt (args NOT indexed — data words)
  const created = useMemo(() => {
    if (action.outcome === null || action.outcome.status !== "sent") return null;
    if (action.outcome.receipt === null) return null;
    return decodeNewQing(action.outcome.receipt.logs);
  }, [action.outcome]);

  // the home-QING capture (session-65): the wrapped asset IS this account's
  // LAU (registered — read LIVE, the send just landed — or the pending
  // carriage). Recorded once; the onboarding checklist's optional step
  // completes on it. One anonymous read on the created path only.
  const [homeClaimed, setHomeClaimed] = useState(false);
  useEffect(() => {
    if (created === null || account === null || homeClaimed) return;
    const outcome = action.outcome;
    if (outcome === null || outcome.status !== "sent") return;
    let alive = true;
    void (async () => {
      let mine: Address | null = pendingLau(account)?.lau ?? null;
      if (mine === null) {
        try {
          mine = await readWalletLau(makeClient(chain.url), account);
        } catch {
          mine = null;
        }
      }
      if (!alive || mine === null) return;
      if (created.asset.toLowerCase() !== mine.toLowerCase()) return;
      setHomeVenue(account, { venue: created.qing, asset: created.asset, waat: created.waat.toString(), txHash: outcome.txHash });
      if (alive) setHomeClaimed(true);
    })();
    return () => {
      alive = false;
    };
  }, [created, account, chain.url, homeClaimed, action.outcome]);

  // the creation-lottery escrow lock on the fresh venue (most venues lock)
  const readGwat = async () => {
    if (created === null) return;
    const client = makeClient(chain.url);
    try {
      const raw = await client.call({
        to: created.qing,
        data: encodeFunctionData({
          abi: [{ type: "function", name: "GWAT", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] }],
          functionName: "GWAT",
        }),
      });
      const data = typeof raw === "string" ? (raw as `0x${string}`) : ((raw as { data: `0x${string}` }).data);
      setGwat(BigInt(data) !== 0n);
    } catch {
      setGwat(null);
    }
  };

  const selectCreated = async () => {
    if (created === null || action.outcome?.status !== "sent" || action.outcome.receipt === null) return;
    const client = makeClient(chain.url);
    const block = action.outcome.receipt.blockNumber !== null ? Number(action.outcome.receipt.blockNumber) : 0;
    const row = await liveVenueRow(client, created.qing, block);
    setCurrentVenue(row);
    setSelected(true);
  };

  return (
    <div className="panel create-venue" data-testid="create-venue">
      <h2>create a venue — MAP.New(asset)</h2>
      <p className="hint">
        wrap any ERC-20 into a fresh QING — no approval, gas only. one venue per asset, EVER,
        planet-wide (a taken asset reverts QingAlreadyExists — the DRYRUN below DECODES it and
        names the existing venue: the chain's own asset→QING oracle). the asset's owner can veto
        in advance (MAP.Forbid — pre-checked here); wrapping another venue is refused
        (DerivativeQing). the tile placement asserts free — a collision reverts the whole create
        with gas spent and no venue: DRYRUN first, never spray-create.
      </p>
      <p className="hint">
        the world assigns the coordinates: the position comes from the HECKE transform of a CHO.Luo
        lottery draw taken inside the create — unpredictable before it lands. you (the creator) are
        auto-STAFFED from block one (bouncer powers) but NOT an owner — MAP adds CHO, not you; the
        venue carries no Ⓐ rate until an owner runs AddMarketRate, and the GWAT escrow lottery
        draws at creation (most venues lock permanently).
      </p>
      <div className="arg-row">
        <label htmlFor="create-venue-asset">asset address (any ERC-20)</label>
        <input
          id="create-venue-asset"
          className="mono"
          spellCheck={false}
          placeholder="0x… the token to wrap"
          value={assetText}
          onChange={(e) => {
            setAssetText(e.target.value);
            setPrecheck(null);
            setDryEnv(null);
          }}
          data-testid="create-venue-asset"
        />
      </div>
      <div className="studio-actions">
        <button className="btn" disabled={precheckBusy || asset === null} onClick={() => void runPrecheck()} data-testid="create-venue-precheck">
          {precheckBusy ? "reading…" : "pre-check (Forbidden)"}
        </button>
        <button className="btn" disabled={dryBusy || asset === null || account === null || action.busy} onClick={() => void dryRun()} data-testid="create-venue-dryrun">
          DRYRUN
        </button>
        <button
          className="btn btn-primary"
          disabled={action.busy || asset === null || account === null}
          onClick={() => void beginSend()}
          data-testid="create-venue-send"
        >
          SEND — Create {wallet.mode === "C" ? "(yolo — policy only)" : ""}
        </button>
      </div>
      {!account && <p className="hint">connect an account (SETTINGS → wallet) to create a venue.</p>}

      {precheck !== null && (
        <div className="studio-result" data-testid="create-venue-precheck-result">
          <pre className="mono">
            {precheck.error !== null
              ? `pre-check unreadable: ${precheck.error}`
              : precheck.forbidden === null
                ? "Forbidden read failed — treat as unknown, the DRYRUN decides"
                : precheck.forbidden
                  ? "FORBIDDEN — the asset's owner vetoed venue-wrapping (or the caller holds WITHOUT): New reverts ForbiddenToken"
                  : "not forbidden — the asset is wrappable as far as the read path knows"}
            {precheck.assetName !== null ? `\nasset name: ${precheck.assetName}` : ""}
            {precheck.assetSymbol !== null ? `\nasset symbol: ${precheck.assetSymbol} (the venue renames to "q${precheck.assetSymbol}")` : "\n(no readable name/symbol — the onchain rename skips them too)"}
          </pre>
        </div>
      )}

      {dryEnv && dryEnv.sim && (
        <div className="studio-result" data-testid="create-venue-sim">
          <pre className="mono">
            {dryEnv.sim.ok
              ? `DRYRUN ok\ngas ~${dryEnv.sim.gas?.toString() ?? "?"}\n(previews are pure — the draw and every check re-run on the committed call)`
              : `DRYRUN revert${dryEnv.sim.error?.decoded ? `: ${dryEnv.sim.error.decoded}` : ""}\n${dryEnv.sim.error?.message ?? ""}`}
          </pre>
        </div>
      )}

      {created !== null && (
        <div className="studio-result" data-testid="create-venue-created">
          <h4>venue created{homeClaimed ? " — your HOME QING" : ""}</h4>
          <dl className="kv">
            <dt>QING</dt>
            <dd className="mono">
              <a className="outlink" href={`${EXPLORER_BASE}${created.qing}`} target="_blank" rel="noreferrer noopener">
                {created.qing} ↗
              </a>
            </dd>
            <dt>asset</dt>
            <dd className="mono">{created.asset}</dd>
            <dt>waat (the drawn coordinate)</dt>
            <dd className="mono waat">{created.waat.toString()}</dd>
          </dl>
          <div className="studio-actions">
            <button className="btn" onClick={() => void readGwat()} data-testid="create-venue-gwat">
              read the GWAT lottery result
            </button>
            <button className="btn" disabled={selected} onClick={() => void selectCreated()} data-testid="create-venue-select">
              {selected ? "selected as current venue" : "set as current venue"}
            </button>
          </div>
          {gwat !== null && (
            <p className={gwat ? "err-text" : "ok-text"} data-testid="create-venue-gwat-result">
              {gwat
                ? "GWAT locked — the escrow lottery drew the permanent-exhibit majority (Withdraw assert-blocked forever)."
                : "GWAT unlocked — this venue drew the withdrawable minority."}
            </p>
          )}
          <p className="hint">
            you are staff here from block one (the management drawer opens); ownership is not yours
            unless you Took the deed — and the deed's Take is available on this venue like any other.
          </p>
        </div>
      )}

      {action.error && <p className="err-text">{action.error}</p>}
      {action.outcome && action.outcome.status !== "sent" && (
        <div className="studio-result" data-testid="create-venue-outcome">
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
    </div>
  );
}
