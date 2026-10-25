import { useEffect, useMemo, useState } from "react";
import { decodeFunctionResult, encodeFunctionData, type Abi, type AbiFunction, type Address } from "viem";
import { EXPLORER_BASE, addr } from "@config/addresses";
import { loadAbi } from "@/chain/abiLoad";
import { fmtAmt, readVenueLabel, type PlayerSnapshot } from "@/chain/identity";
import { useGateAction } from "@/chain/useGateAction";
import type { ChainState } from "@/chain/useChainState";
import { makeClient } from "@/chain/client";
import { encodeTake } from "@/chain/venueDeed";
import { useWallet } from "@/wallet/WalletContext";
import { ApprovalCard } from "@/ui/ApprovalCard";
import { LearnHint } from "@/ui/LearnHint";
import { VenueManageDrawer } from "@/ui/VenueManageDrawer";
import {
  etaReadiness,
  isEtaNoLineageError,
  isFreshEta,
  readEtaSlots,
  useVenueState,
  type EtaSlots,
} from "@/chain/venueState";
import type { RenderRow } from "@/state/atlas";
import type { VenueRow } from "@/state/venueStore";
import type { GateEnvelope, GateOutcome } from "@/chain/txGate";
import { simLayerActive } from "@/chain/simMode";
import { decodeGwatSpawned, encodeGwatSpawn, encodeWorldCode, readGwatForbidden, useWorldTiles, worldAbi } from "@/chain/worldLayer";
import { decodeNewQing, liveVenueRow } from "@/chain/venueDeed";
import { setCurrentVenue } from "@/state/venueStore";

/**
 * The venue (QING) contextual panel (IA-PLAN §4): seed facts + ONE live
 * Multicall3 batch (Waat/Asset/Entropy/rates/bouncer/admission + the
 * session-50 venue-depth reads: GWAT/NoCROWS/management-gate probes and
 * your YUE.Bar attendance history) + the actions through the ONE gate —
 * QING.Join(LAU), QING.Chat(LAU, string) with the informational cost
 * model, META.Beat(Waat) DRYRUN-first with the gas budget + Eta readiness
 * (kb §3 session-40 amendments), and CHEON.Su(qing) — the settle verb,
 * DRYRUN-first, needs a YUE (kb/dev cheon.md). Venue instances are not
 * perimeter addresses: the gate classifies them unknown-contract (extra
 * ack) and every send carries the QING ABI for custom-error decode.
 */

/** kb §3 [chain]: median over 318 Beat txs; the 3M limit is right but not generous */
export const BEAT_GAS_MEDIAN = 1_916_016n;
export const BEAT_GAS_LIMIT = 3_000_000n;

function pickFn(abi: Abi, name: string, inputCount: number): AbiFunction {
  const hits = abi.filter((e): e is AbiFunction => e.type === "function" && e.name === name && e.inputs.length === inputCount);
  if (hits.length === 0) throw new Error(`ABI fragment not found: ${name}/${inputCount}`);
  return hits[0]!;
}

/** decode CHEON.Su's returned (Charge, Hypobar, Epibar) from a DRYRUN's raw result */
export function decodeSettleBars(abi: Abi, result: `0x${string}`): { charge: bigint; hypobar: bigint; epibar: bigint } | null {
  try {
    const decoded = decodeFunctionResult({ abi: [pickFn(abi, "Su", 1)], functionName: "Su", data: result }) as unknown as [
      bigint,
      bigint,
      bigint,
    ];
    if (typeof decoded[0] !== "bigint" || typeof decoded[1] !== "bigint" || typeof decoded[2] !== "bigint") return null;
    return { charge: decoded[0], hypobar: decoded[1], epibar: decoded[2] };
  } catch {
    return null;
  }
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
          {outcome.movements.length > 0 && (
            <>
              {" ·"} transfers:
              {outcome.movements.map((m) => ` ${m.amount.toString()} of ${m.token.slice(0, 10)}…`).join(";")}
            </>
          )}
        </div>
      )}
      {outcome.receiptError && <div className="err-text">receipt: {outcome.receiptError}</div>}
    </>
  );
}

export function VenuePanel({
  venue,
  render,
  chain,
  snapshot,
  onClear,
  renderSource = "seed",
}: {
  venue: VenueRow;
  render: RenderRow | null;
  chain: ChainState;
  snapshot: PlayerSnapshot | null;
  onClear: () => void;
  /** seed = the render seed row; live = HECKE-computed this session (session-67) */
  renderSource?: "seed" | "live";
}) {
  const wallet = useWallet();
  const account = wallet.account;
  const action = useGateAction();
  const live = useVenueState(chain.url, venue.a as Address, account, {
    lau: snapshot?.lau ?? null,
    yue: snapshot?.yue ?? null,
  });

  const [qingAbi, setQingAbi] = useState<Abi | null>(null);
  const [metaAbi, setMetaAbi] = useState<Abi | null>(null);
  const [cheonAbi, setCheonAbi] = useState<Abi | null>(null);
  const [abiErr, setAbiErr] = useState<string | null>(null);
  const [chatText, setChatText] = useState("");
  const [beatEnv, setBeatEnv] = useState<GateEnvelope | null>(null);
  const [beatBusy, setBeatBusy] = useState(false);
  const [eta, setEta] = useState<{ slots: EtaSlots; error: string | null } | null>(null);
  const [settleEnv, setSettleEnv] = useState<GateEnvelope | null>(null);
  const [settleBusy, setSettleBusy] = useState(false);
  const [deedEnv, setDeedEnv] = useState<GateEnvelope | null>(null);
  const [deedBusy, setDeedBusy] = useState(false);
  const [label, setLabel] = useState<import("@/chain/identity").VenueLabel | null>(null);
  // SIM layer (session 58, §8): the WORLD tile block renders ONLY in sim mode
  const simActive = useMemo(() => simLayerActive(chain.url), [chain.url]);
  const tiles = useWorldTiles(
    chain.url,
    simActive ? (venue.a as Address) : null,
    live.state?.waat ?? (render !== null ? BigInt(render.w) : null),
    (snapshot?.yue as Address | null) ?? null
  );
  const [codeLat, setCodeLat] = useState("");
  const [codeLon, setCodeLon] = useState("");
  const [codeEnv, setCodeEnv] = useState<GateEnvelope | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  // the GWAT spawn block (session 59, SIM-only — beside the WORLD block)
  const [gwatLin, setGwatLin] = useState("1");
  const [gwatEnv, setGwatEnv] = useState<GateEnvelope | null>(null);
  const [gwatBusy, setGwatBusy] = useState(false);
  const [gwatForbidden, setGwatForbidden] = useState<boolean | null>(null);
  const [gwatSelected, setGwatSelected] = useState(false);

  // prefill the claim inputs with the anchor once the tile read resolves
  // (Code's convention: "Latitude" = Compliment's FIRST word — swapped)
  useEffect(() => {
    if (tiles.state?.anchorLat != null && codeLat === "") {
      setCodeLat(tiles.state.anchorLat.toString());
    }
    if (tiles.state?.anchorLon != null && codeLon === "") {
      setCodeLon(tiles.state.anchorLon.toString());
    }
  }, [tiles.state, codeLat, codeLon]);

  // your private label for this venue — VOID.Alias simulated from the LAU
  // (the session lives at the LAU contract, not the wallet — msg.sender key;
  // AliasNotFound revert = "none pinned")
  const lauAddr = snapshot?.lau ?? null;
  useEffect(() => {
    setLabel(null);
    if (lauAddr === null) return;
    let alive = true;
    const client = makeClient(chain.url);
    void readVenueLabel(client, lauAddr, venue.a as Address).then((l) => {
      if (alive) setLabel(l);
    });
    return () => {
      alive = false;
    };
  }, [chain.url, lauAddr, venue.a]);

  // the spawn veto read: MAP.Forbidden(wrappedAsset) — live-perimeter view
  useEffect(() => {
    setGwatForbidden(null);
    if (!simActive || live.state?.asset == null || live.state.asset === "0x0000000000000000000000000000000000000000") return;
    let alive = true;
    const client = makeClient(chain.url);
    void readGwatForbidden(client, live.state.asset as Address).then((f) => {
      if (alive) setGwatForbidden(f);
    });
    return () => {
      alive = false;
    };
  }, [simActive, chain.url, live.state?.asset]);

  useEffect(() => {
    setQingAbi(null);
    setMetaAbi(null);
    setCheonAbi(null);
    setAbiErr(null);
    Promise.all([loadAbi("QING.json"), loadAbi("META.json"), loadAbi("CHEON.json")])
      .then(([q, m, c]) => {
        setQingAbi(q);
        setMetaAbi(m);
        setCheonAbi(c);
      })
      .catch((e: unknown) => setAbiErr(e instanceof Error ? e.message : String(e)));
  }, []);

  // simulated RING.Eta() from the caller — the Beat readiness signal
  useEffect(() => {
    setEta(null);
    if (!account) return;
    let alive = true;
    const client = makeClient(chain.url);
    readEtaSlots(client, account)
      .then((slots) => {
        if (alive) setEta({ slots, error: null });
      })
      .catch((e: unknown) => {
        if (alive) setEta({ slots: [14n, 0n, 0n, 0n], error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      alive = false;
    };
  }, [chain.url, account]);

  useEffect(() => {
    if (action.outcome?.status === "sent") live.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.outcome]);

  const lau = snapshot?.lau ?? null;
  const usernameSet = snapshot?.username != null;
  const waat = live.state?.waat ?? (render !== null ? BigInt(render.w) : null);
  const waatSource = live.state?.waat != null ? "live" : render !== null ? "seed" : null;

  const cover = live.state?.coverCharge ?? null;
  const asset = live.state?.asset ?? null;
  const hasCover = cover !== null && cover > 0n && asset !== null && asset !== "0x0000000000000000000000000000000000000000";

  const beginJoin = async () => {
    if (!account || !lau || !qingAbi) return;
    await action.begin({
      to: venue.a as `0x${string}`,
      data: encodeFunctionData({ abi: [pickFn(qingAbi, "Join", 1)], functionName: "Join", args: [lau] }),
      account,
      abi: qingAbi,
      meta: { source: "manual", label: `MAP join ${venue.n || venue.a}` },
    });
  };

  const beginChat = async () => {
    if (!account || !lau || !qingAbi || chatText.trim().length === 0) return;
    await action.begin({
      to: venue.a as `0x${string}`,
      data: encodeFunctionData({
        abi: [pickFn(qingAbi, "Chat", 2)],
        functionName: "Chat",
        args: [lau, chatText],
      }),
      account,
      abi: qingAbi,
      meta: { source: "manual", label: `MAP chat → ${venue.n || venue.a}` },
    });
  };

  const beatWaat = waat !== null ? waat : 0n;

  const beatDryRun = async () => {
    if (!account || !metaAbi) return;
    setBeatBusy(true);
    setBeatEnv(null);
    try {
      const env = await action.probe({
        to: addr("META"),
        data: encodeFunctionData({ abi: [pickFn(metaAbi, "Beat", 1)], functionName: "Beat", args: [beatWaat] }),
        account,
        abi: metaAbi,
        meta: { source: "manual", label: `MAP Beat ${venue.n || venue.a}` },
      });
      setBeatEnv(env);
    } finally {
      setBeatBusy(false);
    }
  };

  const beginBeat = async () => {
    if (!account || !metaAbi) return;
    await action.begin({
      to: addr("META"),
      data: encodeFunctionData({ abi: [pickFn(metaAbi, "Beat", 1)], functionName: "Beat", args: [beatWaat] }),
      account,
      abi: metaAbi,
      meta: { source: "manual", label: `MAP Beat ${venue.n || venue.a}` },
    });
  };

  // CHEON.Su(venue) — the settle verb (kb/dev cheon.md): ReactYue (advance
  // your YUE bars) → MAI-capped bounty from CHEON's own balance into the YUE →
  // the YUE's 1-unit drip home → returns the refreshed bars. Needs a YUE
  // (Sei.Chi reverts NotStarted otherwise). The DRYRUN decodes the returned
  // (Charge, Hypobar, Epibar) — a pure preview, not the committed numbers.
  const settleRequest = () => {
    if (!account || !cheonAbi) return null;
    return {
      to: addr("CHEON"),
      data: encodeFunctionData({ abi: [pickFn(cheonAbi, "Su", 1)], functionName: "Su", args: [venue.a as `0x${string}`] }),
      account,
      abi: cheonAbi,
      meta: { source: "manual" as const, label: `MAP settle ${venue.n || venue.a}` },
    };
  };

  const settleDryRun = async () => {
    if (!account || !cheonAbi) return;
    setSettleBusy(true);
    setSettleEnv(null);
    try {
      const req = settleRequest();
      if (req === null) return;
      const env = await action.probe(req);
      setSettleEnv(env);
    } finally {
      setSettleBusy(false);
    }
  };

  const beginSettle = async () => {
    if (!account || !cheonAbi) return;
    const req = settleRequest();
    if (req === null) return;
    await action.begin(req);
  };

  // WORLD.Code(lat, lon, qing) — the tile claim (SIM fixture, session 58):
  // settle + Beat + tile mass + VITUS-to-your-YUE in one verb. DRYRUN-first
  // through THE gate; the fixture address classifies unknown-contract (extra
  // ack — intended, like every venue instance).
  const worldCodeRequest = async () => {
    if (!account || codeLat.trim() === "" || codeLon.trim() === "") return null;
    let lat: bigint;
    let lon: bigint;
    try {
      lat = BigInt(codeLat.trim());
      lon = BigInt(codeLon.trim());
    } catch {
      return null;
    }
    return {
      to: (await import("@/chain/simMode")).simAddr("WORLD", chain.url) as `0x${string}`,
      data: await encodeWorldCode(lat, lon, venue.a as Address),
      account,
      abi: await worldAbi(),
      meta: { source: "manual" as const, label: `SIM world claim ${venue.n || venue.a}` },
    };
  };

  const worldCodeDryRun = async () => {
    if (!account) return;
    setCodeBusy(true);
    setCodeEnv(null);
    try {
      const req = await worldCodeRequest();
      if (req === null) return;
      const env = await action.probe(req);
      setCodeEnv(env);
    } finally {
      setCodeBusy(false);
    }
  };

  const beginWorldCode = async () => {
    if (!account) return;
    const req = await worldCodeRequest();
    if (req === null) return;
    await action.begin(req);
  };

  // GWAT.Gwat(qing, lin) — the player-venue spawn (SIM fixture, session 59):
  // forks this venue into the caller's own sub-venue. DRYRUN-first through
  // THE gate; the errors decode (SpawningFailure / YourGwatAlreadyExists /
  // ForbiddenToken); each attempt is a FRESH draw — retry on spawn failure.
  const gwatLinBig = (() => {
    try {
      const v = BigInt(gwatLin.trim());
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  })();

  const gwatRequest = async () => {
    if (!account || gwatLinBig === null) return null;
    const enc = await encodeGwatSpawn(venue.a as Address, gwatLinBig, chain.url);
    return {
      to: enc.to as `0x${string}`,
      data: enc.data,
      account,
      abi: enc.abi,
      meta: { source: "manual" as const, label: `SIM gwat spawn ${venue.n || venue.a}` },
    };
  };

  const gwatDryRun = async () => {
    if (!account) return;
    setGwatBusy(true);
    setGwatEnv(null);
    try {
      const req = await gwatRequest();
      if (req === null) return;
      setGwatEnv(await action.probe(req));
    } finally {
      setGwatBusy(false);
    }
  };

  const beginGwat = async () => {
    if (!account) return;
    const req = await gwatRequest();
    if (req === null) return;
    await action.begin(req);
  };

  // a sent spawn proves itself in the receipt: NewQing(spawned, parent, Luo)
  // — args NOT indexed, data words (the decodeNewQing precedent; GWAT's
  // NewQing is signature-identical to MAP's). word1 (the "asset" slot) is
  // the PARENT qing — the guard that this receipt is THIS venue's spawn.
  const gwatSpawned = useMemo(() => {
    if (action.outcome === null || action.outcome.status !== "sent" || action.outcome.receipt === null) return null;
    const facts = decodeNewQing(action.outcome.receipt.logs);
    if (facts === null) return null;
    return facts.asset.toLowerCase() === venue.a.toLowerCase() ? facts : null;
  }, [action.outcome, venue.a]);

  const selectSpawned = async () => {
    if (gwatSpawned === null || action.outcome?.status !== "sent" || action.outcome.receipt === null) return;
    const client = makeClient(chain.url);
    const block = action.outcome.receipt.blockNumber !== null ? Number(action.outcome.receipt.blockNumber) : 0;
    const row = await liveVenueRow(client, gwatSpawned.qing, block);
    setCurrentVenue(row);
    setGwatSelected(true);
  };

  // the parent-eligibility line: the spawn registers a 1e18 rate against the
  // PARENT and AddMarketRate caps at totalSupply/777 — ≥777 tokens of supply
  const parentSupply = live.state?.totalSupply ?? null;
  const rateCapReady = parentSupply !== null ? parentSupply >= 777n * 10n ** 18n : null;
  const gwatPreviewSpawned = useMemo(() => {
    if (gwatEnv === null || gwatEnv.sim === null || !gwatEnv.sim.ok || gwatEnv.sim.result === null) return null;
    return decodeGwatSpawned(gwatEnv.sim.result);
  }, [gwatEnv]);

  const settleBars = useMemo(() => {
    if (settleEnv === null || settleEnv.sim === null || !settleEnv.sim.ok || cheonAbi === null) return null;
    if (settleEnv.sim.result === null) return null;
    return decodeSettleBars(cheonAbi, settleEnv.sim.result);
  }, [settleEnv, cheonAbi]);

  // DO.Take(venue) — the deed (kb/dev/do.md, session-51 B1.4): adds the
  // caller's EOA as a QING owner via CHO.AddContractOwner + mints 1 DO to
  // the user token. Hand-pinned fragment (no recovered source); the DRYRUN
  // is the honest pre-check — the taken-once flag has no getter.
  const deedRequest = () => {
    if (!account) return null;
    return {
      to: addr("DO"),
      data: encodeTake(venue.a as Address),
      account,
      meta: { source: "manual" as const, label: `MAP take the deed ${venue.n || venue.a}` },
    };
  };

  const deedDryRun = async () => {
    if (!account) return;
    setDeedBusy(true);
    setDeedEnv(null);
    try {
      const req = deedRequest();
      if (req === null) return;
      const env = await action.probe(req);
      setDeedEnv(env);
    } finally {
      setDeedBusy(false);
    }
  };

  const beginDeed = async () => {
    if (!account) return;
    const req = deedRequest();
    if (req === null) return;
    await action.begin(req);
  };

  const etaInfo = useMemo(() => {
    if (!eta || eta.error) return null;
    const readiness = etaReadiness(eta.slots);
    return { ...readiness, fresh: isFreshEta(eta.slots) };
  }, [eta]);

  return (
    <div className="panel venue-panel" data-testid="venue-panel">
      <h2>
        venue{" "}
        <a className="outlink" href={`${EXPLORER_BASE}${venue.a}`} target="_blank" rel="noreferrer noopener">
          ↗ explorer
        </a>{" "}
        <LearnHint file="venues.md" />
        <button className="btn" onClick={onClear} data-testid="map-clear-venue">
          clear selection
        </button>
      </h2>
      {abiErr && <p className="err-text">{abiErr}</p>}

      <dl className="kv">
        <dt>name</dt>
        <dd>{venue.n.length > 0 ? venue.n : "(nameless onchain)"}</dd>
        <dt>symbol</dt>
        <dd className="mono">{venue.s}</dd>
        <dt>address</dt>
        <dd className="mono">{venue.a}</dd>
      </dl>

      <details className="explain" data-testid="venue-explain">
        <summary>? what is a venue</summary>
        <p className="hint">
          a QING is a venue token wrapping an ERC-20 through MAP — the coordinates you see on the
          atlas come from the HECKE meridian transform of its waat. chatting, joining and beating
          are the venue interactions; every action below sends through the one transaction gate.
        </p>
      </details>

      <h3>{renderSource === "live" ? "atlas position (HECKE live-computed — not in the seed)" : "seed facts (s32-exact)"}</h3>
      {render === null ? (
        <p className="hint" data-testid="venue-no-seed">
          no render-seed row for this venue — it was created outside the seed (fresh MAP.New), so
          the band/position rows stay unset until the seed regenerates. the LIVE Waat below is the
          honest coordinate source meanwhile.
        </p>
      ) : (
        <dl className="kv">
          <dt>meridian band</dt>
          <dd className="mono">
            {renderSource === "live" ? render.band : venue.band}
            {render.south && <span className="hint"> · south-flip (band-89 mirror)</span>}
          </dd>
          <dt>position (canonical, kb §9)</dt>
          <dd className="mono">
            {`fold ${render.f >= 0 ? "+" : ""}${(render.f * 180).toFixed(1)}° · |lat|/pole ${render.ln.toFixed(3)} · ${render.south ? "south" : "north"}`}
          </dd>
          <dt>HECKE position (legacy framing)</dt>
          <dd className="mono">{`lon ${render.lon.toFixed(3)}° · lat ${render.lat.toFixed(3)}°`}</dd>
          {render.sys && (
            <>
              <dt>class</dt>
              <dd className="ok-text">first QING (Phobos) — RING's fixed reaction reference</dd>
            </>
          )}
          <dt>created</dt>
          <dd className="mono">{renderSource === "live" && render.blk === 0 ? "block unknown (live venue)" : `block ${renderSource === "live" ? render.blk : venue.blk}`}</dd>
          <dt>waat {renderSource === "live" ? "(live)" : "(seed)"}</dt>
          <dd className="mono waat">{render.w}</dd>
        </dl>
      )}

      <h3>
        live state{" "}
        <button className="btn" disabled={live.loading} onClick={live.refresh} data-testid="venue-live-refresh">
          {live.loading ? "reading…" : "refresh"}
        </button>
      </h3>
      <div data-testid="venue-live">
        {live.error && <p className="err-text">live reads unavailable: {live.error}</p>}
        {!live.error && live.state === null && <p className="hint">reading (one anonymous Multicall3 batch)…</p>}
        {live.state !== null && (
          <>
            <dl className="kv">
              <dt>Waat {live.state.waat !== null ? "(live)" : ""}</dt>
              <dd className="mono waat">{live.state.waat !== null ? live.state.waat.toString() : "read failed"}</dd>
              <dt>Entropy</dt>
              <dd className="mono">{live.state.entropy !== null ? live.state.entropy.toString() : "read failed"}</dd>
              <dt>totalSupply</dt>
              <dd className="mono">{live.state.totalSupply !== null ? fmtAmt(live.state.totalSupply) : "read failed"}</dd>
              <dt>Asset</dt>
              <dd className="mono">{live.state.asset !== null ? live.state.asset : "read failed"}</dd>
              {live.state.blockNumber !== null && (
                <>
                  <dt>block</dt>
                  <dd className="mono">{live.state.blockNumber.toString()}</dd>
                </>
              )}
            </dl>
            {live.state.errors.length > 0 && (
              <p className="err-text" data-testid="venue-live-errors">
                {live.state.errors.join(" · ")}
              </p>
            )}
          </>
        )}
      </div>

      <h3>admission</h3>
      <div data-testid="venue-admission">
        <dl className="kv">
          <dt>BouncerDivisor</dt>
          <dd className="mono">
            {live.state?.bouncerDivisor !== null && live.state?.bouncerDivisor !== undefined
              ? live.state.bouncerDivisor.toString()
              : "—"}
          </dd>
          <dt>CoverCharge</dt>
          <dd className="mono">
            {live.state === null || live.state.coverCharge === null
              ? "—"
              : live.state.coverCharge === 0n
                ? "none set"
                : `${fmtAmt(live.state.coverCharge)} of the venue's Asset`}
          </dd>
          {account !== null && (
            <>
              <dt>Admitted({account.slice(0, 8)}…)</dt>
              <dd className={live.state?.admitted === true ? "ok-text" : ""}>
                {live.state?.admitted === null || live.state === null ? "—" : live.state.admitted ? "yes" : "no"}
              </dd>
              <dt>your venue-token balance</dt>
              <dd className="mono">{live.state?.myBalance !== null && live.state !== null && live.state.myBalance !== undefined ? fmtAmt(live.state.myBalance) : "—"}</dd>
            </>
          )}
        </dl>
        <p className="hint">
          admission runs the bouncer cascade + BouncerDivisor + the auto-bouncer threshold; the
          1-day guest list and NoCROWS overrides apply at the contract, not here.
        </p>
      </div>

      <h3>your history here</h3>
      <div data-testid="venue-history">
        {!account && <p className="hint">connect an account to see your attendance record.</p>}
        {account && !snapshot?.yue && (
          <p className="hint">
            your YUE holds the per-venue attendance record (YUE.Bar) — open one first (IDENTITY →
            start your YUE); settling also needs it.
          </p>
        )}
        {account && snapshot?.yue && (
          <>
            <dl className="kv">
              <dt>Hypobar (this venue)</dt>
              <dd className="mono">{live.state?.myHypobar !== null && live.state !== null && live.state.myHypobar !== undefined ? live.state.myHypobar.toString() : "—"}</dd>
              <dt>Epibar (this venue)</dt>
              <dd className="mono">{live.state?.myEpibar !== null && live.state !== null && live.state.myEpibar !== undefined ? live.state.myEpibar.toString() : "—"}</dd>
            </dl>
            <p className="hint">
              YUE.Bar(qing) — your vault's lifelong attendance bars at this venue, advanced by each
              settle (CHEON.Su). zero + zero means you have never settled here yet.
            </p>
          </>
        )}
      </div>

      <h3>your label for this venue</h3>
      <div data-testid="venue-label">
        {!account && <p className="hint">connect an account — labels are per-soul (VOID.Alias).</p>}
        {account && lauAddr === null && <p className="hint">create your LAU first — the label session lives at the LAU.</p>}
        {account && lauAddr !== null && label === null && <p className="hint">reading your label…</p>}
        {account && lauAddr !== null && label !== null && (
          <dl className="kv">
            <dt>VOID.Alias(venue)</dt>
            <dd>
              {label === "unset" && <span className="hint">none yet — you have not pinned one (the read reverts AliasNotFound until set)</span>}
              {label === "not-entered" && (
                <span className="hint">no session at the LAU (unexpected — the read is simulated from it)</span>
              )}
              {label === "unreadable" && <span className="err-text">label read unavailable (RPC)</span>}
              {typeof label === "object" && <span className="mono">{label.label}</span>}
            </dd>
          </dl>
        )}
        <p className="hint">
          your private pin on this address — ≤ 32 bytes, readable only through your LAU&apos;s session
          (the write surface, LAU.Alias(venue, value), is deliberately not exposed this session).
        </p>
      </div>

      <h3>market (Ⓐ AFFECTION)</h3>
      <div data-testid="venue-market">
        {live.state === null && <p className="hint">live read pending or unavailable — the Ⓐ rate renders once the venue is readable.</p>}
        {live.state?.marketRateKnown === true && live.state.marketRateAffection !== null && (
          <dl className="kv">
            <dt>Ⓐ rate</dt>
            <dd className="mono">{fmtAmt(live.state.marketRateAffection)} Ⓐ per 1.0 venue token</dd>
          </dl>
        )}
        {live.state !== null && live.state.marketRateKnown !== true && (
          <p className="hint" data-testid="venue-no-rate">
            no Ⓐ market rate — fresh venues carry none: Purchase(AFFECTION, ·) reverts
            MarketRateNotFound until an owner runs AddMarketRate(AFFECTION, 1e18). acquisition
            path: only CHO owns a fresh venue (MAP.New adds CHO, not the creator) — ownership
            routes through CHO.AddContractOwner(qing, player) (the move DO.Take automates, once
            per venue) or an owner Withdraw; each chat also mints 1 venue token to the venue
            itself.
          </p>
        )}
      </div>

      <h3>actions (through the gate)</h3>
      {!account && <p className="hint">connect an account (SETTINGS → wallet) to act on this venue.</p>}
      {account && !lau && <p className="hint">you need a LAU first — IDENTITY → create, then act here as that LAU.</p>}

      <div className="venue-action" data-testid="venue-join">
        <p className="hint">
          QING.Join(LAU) — registers you at the venue through the bouncer cascade{hasCover ? " (cover applies to chat, not Join)" : ""}.
        </p>
        <button
          className="btn"
          disabled={action.busy || !account || !lau || !qingAbi}
          onClick={() => void beginJoin()}
          data-testid="venue-join-send"
        >
          SEND — Join {wallet.mode === "A" ? "(wallet prompts)" : "(approval card)"}
        </button>
      </div>

      <div className="venue-action" data-testid="venue-chat">
        <p className="hint">
          QING.Chat(LAU, string) — costs GAS only; the call also mints 1 QING to the venue itself
          (supply-side fact, not a caller cost)
          {hasCover && cover !== null ? `; CoverCharge ${fmtAmt(cover)} of the venue's Asset applies unless you are guest-listed (PayCover revert)` : "; no CoverCharge set"}.
          your line becomes public onchain chat content.
        </p>
        <div className="arg-row">
          <label htmlFor="venue-chat-input">message (public, permanent)</label>
          <input
            id="venue-chat-input"
            className="mono"
            spellCheck={false}
            placeholder="say something to the venue"
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            data-testid="venue-chat-input"
          />
        </div>
        {!usernameSet && lau && (
          <p className="hint">chat paths need your Username set (IDENTITY) before they let you speak.</p>
        )}
        <button
          className="btn"
          disabled={action.busy || !account || !lau || !qingAbi || chatText.trim().length === 0}
          onClick={() => void beginChat()}
          data-testid="venue-chat-send"
        >
          SEND — Chat
        </button>
      </div>

      <div className="venue-action" data-testid="venue-beat">
        <p className="hint">
          META.Beat(Waat) — the world heartbeat: converts Fornax balance + venue state into
          output. DRYRUN first: the call is simulated from your account, gas is estimated against
          the observed budget (median {BEAT_GAS_MEDIAN.toString()} gas over 318 txs; the 3M limit
          is right but not generous). previews are pure — the shared Entropy head makes committed
          results differ.
        </p>
        <p className="hint">
          waat ({waatSource ?? "unavailable"}): <span className="mono waat">{waat !== null ? waat.toString() : "—"}</span>
        </p>
        <div className="studio-actions">
          <button
            className="btn"
            disabled={beatBusy || !account || !metaAbi}
            onClick={() => void beatDryRun()}
            data-testid="venue-beat-dryrun"
          >
            DRYRUN
          </button>
          <button
            className="btn btn-primary"
            disabled={action.busy || !account || !metaAbi}
            onClick={() => void beginBeat()}
            data-testid="venue-beat-send"
          >
            SEND — Beat {wallet.mode === "C" ? "(yolo — policy only)" : ""}
          </button>
        </div>

        {beatEnv && beatEnv.sim && (
          <div className="studio-result" data-testid="venue-beat-sim">
            <pre className="mono">
              {beatEnv.sim.ok
                ? `DRYRUN ok\ngas ~${beatEnv.sim.gas?.toString() ?? "?"} (median ${BEAT_GAS_MEDIAN.toString()} · limit ${BEAT_GAS_LIMIT.toString()})`
                : `DRYRUN revert${beatEnv.sim.error?.decoded ? `: ${beatEnv.sim.error.decoded}` : ""}\n${beatEnv.sim.error?.message ?? ""}`}
            </pre>
          </div>
        )}

        <div className="eta-block" data-testid="venue-eta">
          <h4>
            Beat readiness — your Eta slots <LearnHint file="the-ladder.md" anchor="the-soeng-chain" />
          </h4>
          {!account && <p className="hint">connect an account to read your Eta readiness.</p>}
          {account && eta === null && <p className="hint">simulating RING.Eta() from your account…</p>}
          {account && eta !== null && eta.error !== null && !isEtaNoLineageError(eta.error) && (
            <p className="err-text">Eta simulation failed: {eta.error}</p>
          )}
          {account && eta !== null && eta.error !== null && isEtaNoLineageError(eta.error) && (
            <p className="err-text">
              no vault lineage — the simulated Eta() reverts for callers without a vault: open
              your YUE first (IDENTITY). after onboarding the slots read (14, 0, 0, 0) and Beat
              still panics 0x12 until the vault lineage ages.
            </p>
          )}
          {account && eta !== null && eta.error === null && etaInfo !== null && (
            <>
              <p className="mono">
                slots ({eta.slots.map((s) => s.toString()).join(", ")})
              </p>
              {etaInfo.ready ? (
                <p className="ok-text">
                  nonzero slots — your vault lineage carries history; Beat can run (Yeo still
                  rounds to 0 early — the community lore "Yeo is always 0 on your first Beat" is
                  exactly this).
                </p>
              ) : (
                <p className="err-text">
                  fresh-caller shape (14, 0, 0, 0) — Beat divides by an Eta slot and will panic
                  0x12 at ANY funding level. this is caller state, not holdings: Yuan balances are
                  not a gate. there is no cheap vault-aging path today (the CHOA buffer is empty;
                  Yue.React is owner-gated) — aged callers earned their slots through months of
                  vault-advancing activity. on a SIM fork the harness recipe impersonates an aged
                  caller.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="venue-action" data-testid="venue-settle">
        <p className="hint">
          CHEON.Su(venue) — the settle verb, the ecosystem's most-called function: advance your
          YUE's bars at this venue, draw the MAI-capped bounty (up to 1, from CHEON's own balance
          while it lasts) into your YUE, drip 1 unit of your account token home — and hand back
          the refreshed (Charge, Hypobar, Epibar). needs your YUE (reverts NotStarted without
          one). DRYRUN first: previews are pure — the shared Entropy head makes committed results
          differ.
        </p>
        <div className="studio-actions">
          <button
            className="btn"
            disabled={settleBusy || !account || !cheonAbi || !snapshot?.yue}
            onClick={() => void settleDryRun()}
            data-testid="venue-settle-dryrun"
          >
            DRYRUN
          </button>
          <button
            className="btn btn-primary"
            disabled={action.busy || !account || !cheonAbi || !snapshot?.yue}
            onClick={() => void beginSettle()}
            data-testid="venue-settle-send"
          >
            SEND — Settle {wallet.mode === "C" ? "(yolo — policy only)" : ""}
          </button>
        </div>
        {account && !snapshot?.yue && (
          <p className="hint">settle needs your YUE first — IDENTITY → start your YUE.</p>
        )}
        {settleEnv && settleEnv.sim && (
          <div className="studio-result" data-testid="venue-settle-sim">
            <pre className="mono">
              {settleEnv.sim.ok
                ? `DRYRUN ok${settleBars !== null ? `\npreviewed bars — Charge ${settleBars.charge.toString()} · Hypobar ${settleBars.hypobar.toString()} · Epibar ${settleBars.epibar.toString()}` : ""}`
                : `DRYRUN revert${settleEnv.sim.error?.decoded ? `: ${settleEnv.sim.error.decoded}` : ""}\n${settleEnv.sim.error?.message ?? ""}`}
            </pre>
          </div>
        )}
      </div>

      <div className="venue-action" data-testid="venue-deed">
        <p className="hint">
          DO.Take(venue) — the deed: a once-per-venue-EVER claim that adds your EOA as a QING owner
          (via CHO.AddContractOwner) and mints 1 DO to your user token. Deeds are once-per-venue-EVER — a few dozen venues are taken (54 at the session-51 census).
          the gate keys on the WRAPPED ASSET, not the venue: you may Take when this venue wraps your
          own account token, or you hold an owner (or Creator) stake in the wrapped asset. an
          ineligible Take is a SILENT NO-OP — the tx lands "successful", nothing happens, gas is
          spent — so a green DRYRUN alone cannot prove eligibility: watch the owner line below flip
          after a send. assets that answer neither owner(address) nor Creator() make Take itself
          revert (raw). DO has no recovered source: the gate classifies it unknown-contract with an
          extra ack.
        </p>
        <dl className="kv" data-testid="venue-deed-gate">
          <dt>your stake in the wrapped asset</dt>
          <dd>
            {live.state === null
              ? "— (live read pending)"
              : live.state.assetIsUserToken
                ? <span className="ok-text">this venue wraps YOUR account token — the deed is yours to take</span>
                : live.state.assetOwnerPass === null
                  ? "the asset does not answer owner(address) — Take reverts raw for such assets"
                  : live.state.assetOwnerPass
                    ? <span className="ok-text">you pass owner(address) on the wrapped asset</span>
                    : "no owner stake read — an ineligible Take is the silent no-op above"}
          </dd>
          {live.state?.myOwner === true && (
            <>
              <dt>venue ownership</dt>
              <dd className="ok-text">you already pass an owner path here — the deed adds nothing</dd>
            </>
          )}
        </dl>
        <div className="studio-actions">
          <button
            className="btn"
            disabled={deedBusy || !account || action.busy}
            onClick={() => void deedDryRun()}
            data-testid="venue-deed-dryrun"
          >
            DRYRUN
          </button>
          <button
            className="btn btn-primary"
            disabled={action.busy || !account}
            onClick={() => void beginDeed()}
            data-testid="venue-deed-send"
          >
            SEND — Take the deed {wallet.mode === "C" ? "(yolo — policy only)" : ""}
          </button>
        </div>
        {account && live.state?.myOwner === false && (
          <p className="hint">
            on a real take the ownership line above flips to yes after the send (the panel re-reads
            the batch) — that flip, not the tx status, is the proof the deed landed.
          </p>
        )}
        {deedEnv && deedEnv.sim && (
          <div className="studio-result" data-testid="venue-deed-sim">
            <pre className="mono">
              {deedEnv.sim.ok
                ? `DRYRUN ok — the revert class passes (gas ~${deedEnv.sim.gas?.toString() ?? "?"})\nNOT a deed proof: an ineligible Take still lands "successful" as a silent no-op`
                : `DRYRUN revert${deedEnv.sim.error?.decoded ? `: ${deedEnv.sim.error.decoded}` : ""}\n${deedEnv.sim.error?.message ?? ""}`}
            </pre>
          </div>
        )}
      </div>

      {simActive && (
        <div className="venue-action" data-testid="venue-world">
          <h4>
            WORLD tiles — the coordinate-claim layer <span className="chip chip-sim">SIM · fixture</span>
          </h4>
          <p className="hint">
            the never-deployed world layer on this fork (harness set-3 fixtures — a future live
            deployment would carry NEW addresses). WORLD.Code(lat, lon, venue) is the composed
            claim: it settles this venue (CHEON.Su), beats (META.Beat), adds the tile mass and
            mints VITUS royalties to your YUE. the claim box is bounded by Yeo around the venue's
            anchor (your first Beat's Yeo is 0 — the anchor tile only); beyond it the call reverts
            OutOfRange. a claim with Charge 0 lands "successful" as a silent no-op (the settle's
            charge is venue-Eris-weighted); the VITUS credit needs an AGED caller (the Eta floor)
            and venue-token Yuan — fresh callers see honest zeros, the fork recipe is an aged
            impersonation. the fixture address classifies unknown-contract: extra ack, intended.
            NOTE the coordinate convention: Code's "Latitude" is the transform's FIRST word — the
            inputs below are prefilled in that order.
          </p>
          <dl className="kv" data-testid="venue-world-state">
            <dt>anchor (Code convention)</dt>
            <dd className="mono">
              {tiles.state?.anchorLat != null && tiles.state?.anchorLon != null
                ? `${tiles.state.anchorLat.toString()} / ${tiles.state.anchorLon.toString()}`
                : tiles.error !== null
                  ? "unreadable (fixture not deployed on this RPC?)"
                  : "…"}
            </dd>
            <dt>tile mass (Bun)</dt>
            <dd className="mono">{tiles.state?.bun != null ? tiles.state.bun.toString() : "—"}</dd>
            <dt>cauda credit (Tail @1)</dt>
            <dd className="mono">{tiles.state?.tail != null ? tiles.state.tail.toString() : "—"}</dd>
            {snapshot?.yue != null && (
              <>
                <dt>your Buzz credit</dt>
                <dd className="mono">{tiles.state?.buzz != null ? tiles.state.buzz.toString() : "—"}</dd>
              </>
            )}
            <dt>WAR CO₂ (cumulative)</dt>
            <dd className="mono">{tiles.state?.co2 != null ? tiles.state.co2.toString() : "—"}</dd>
          </dl>
          <div className="studio-actions">
            <label className="hint" htmlFor="world-code-lat">
              Latitude (first word)
            </label>
            <input
              id="world-code-lat"
              className="mono"
              value={codeLat}
              onChange={(e) => setCodeLat(e.target.value)}
              spellCheck={false}
              data-testid="venue-world-lat"
            />
            <label className="hint" htmlFor="world-code-lon">
              Longitude (second word)
            </label>
            <input
              id="world-code-lon"
              className="mono"
              value={codeLon}
              onChange={(e) => setCodeLon(e.target.value)}
              spellCheck={false}
              data-testid="venue-world-lon"
            />
          </div>
          <div className="studio-actions">
            <button
              className="btn"
              disabled={codeBusy || !account || action.busy}
              onClick={() => void worldCodeDryRun()}
              data-testid="venue-world-dryrun"
            >
              DRYRUN
            </button>
            <button
              className="btn btn-primary"
              disabled={action.busy || !account || codeLat.trim() === "" || codeLon.trim() === ""}
              onClick={() => void beginWorldCode()}
              data-testid="venue-world-send"
            >
              SEND — Claim the tile {wallet.mode === "C" ? "(yolo — policy only)" : ""}
            </button>
          </div>
          {codeEnv && codeEnv.sim && (
            <div className="studio-result" data-testid="venue-world-sim">
              <pre className="mono">
                {codeEnv.sim.ok
                  ? `DRYRUN ok (gas ~${codeEnv.sim.gas?.toString() ?? "?"})\nthe silent-no-op rule still applies: watch the Bun/Tail lines above after a send`
                  : `DRYRUN revert${codeEnv.sim.error?.decoded ? `: ${codeEnv.sim.error.decoded}` : ""}\n${codeEnv.sim.error?.message ?? ""}`}
              </pre>
            </div>
          )}
          {tiles.error !== null && <p className="err-text">world reads: {tiles.error}</p>}
        </div>
      )}

      {simActive && (
        <div className="venue-action" data-testid="venue-gwat">
          <h4>
            GWAT — spawn your own sub-venue here <span className="chip chip-sim">SIM · fixture</span>
          </h4>
          <p className="hint">
            GWAT.Gwat(parent, lin) forks THIS venue into your own — named "&lt;you&gt;'s &lt;asset&gt; GWAT", the
            full spawn mint lands at your wallet, CHO cross-owns it, and the spawned venue wraps the PARENT
            (a GWAT's Asset() is the parent QING — the derivative chain the YUE desk walks). the parent
            needs ≥ 777 of its own tokens in supply (the spawn registers a 1e18 rate against it and
            AddMarketRate caps at totalSupply/777). one GWAT per (parent venue, your YUE) ever: a
            duplicate reverts YourGwatAlreadyExists and the error's second word IS your existing GWAT's
            address (there is no getter). each attempt is a FRESH draw (SpawningFailure = the draw hit
            0-mod or a taken tile — retry); the fixture address classifies unknown-contract: extra ack,
            intended.
          </p>
          <dl className="kv" data-testid="venue-gwat-eligibility">
            <dt>parent supply (rate-cap gate)</dt>
            <dd className="mono">
              {parentSupply === null
                ? "— (live read pending)"
                : `${fmtAmt(parentSupply)} ${rateCapReady === true ? "— ≥ 777 tokens, the spawn's 1e18 parent-rate can register" : "— BELOW the 777-token floor: the spawn registers a 1e18 rate against the parent and AddMarketRate caps at totalSupply/777 (TokenMaximumRate)"}`}
            </dd>
            <dt>claim chain (Tail @1)</dt>
            <dd>
              {tiles.state === null
                ? "— (world reads pending)"
                : tiles.state.tail !== null && tiles.state.tail > 0n
                  ? <span className="ok-text">a claim chain exists — the Faa draw has a cauda to ride</span>
                  : "no claim chain yet — the draw needs a prior WORLD.Code claim on THIS parent (the claim block above)"}
            </dd>
            <dt>wrapped asset veto</dt>
            <dd>
              {live.state?.asset == null
                ? "—"
                : gwatForbidden === null
                  ? "MAP.Forbidden unreadable — the DRYRUN decides"
                  : gwatForbidden
                    ? "FORBIDDEN — the wrapped asset is vetoed; the spawn reverts ForbiddenToken"
                    : <span className="ok-text">not forbidden (MAP.Forbidden(asset) = false)</span>}
            </dd>
            {snapshot?.yue == null && (
              <>
                <dt>your YUE</dt>
                <dd className="err-text">none — the spawn resolves your YUE first (Sei.Chi reverts NotStarted without one)</dd>
              </>
            )}
            {snapshot?.username == null && snapshot?.lau != null && (
              <>
                <dt>your Username</dt>
                <dd className="err-text">unset — the spawn's rename reads your Username (IDENTITY first)</dd>
              </>
            )}
          </dl>
          <div className="studio-actions">
            <label className="hint" htmlFor="gwat-lin">
              lin (cauda position)
            </label>
            <input
              id="gwat-lin"
              className="mono"
              value={gwatLin}
              onChange={(e) => setGwatLin(e.target.value)}
              spellCheck={false}
              data-testid="venue-gwat-lin"
            />
          </div>
          <p className="hint">
            lin = the cauda POSITION the draw rides — position 1 is the first creator slot (the same slot
            Tail@1 probes above). the draw itself keys on YOUR Eta: a fresh caller draws a constant
            (Charge 0 ⇒ every draw is 1) and keeps failing the checks — the aged-caller story, same as the
            claim block.
          </p>
          <div className="studio-actions">
            <button
              className="btn"
              disabled={gwatBusy || !account || action.busy || gwatLinBig === null}
              onClick={() => void gwatDryRun()}
              data-testid="venue-gwat-dryrun"
            >
              DRYRUN
            </button>
            <button
              className="btn btn-primary"
              disabled={action.busy || !account || gwatLinBig === null}
              onClick={() => void beginGwat()}
              data-testid="venue-gwat-send"
            >
              SEND — Spawn your GWAT {wallet.mode === "C" ? "(yolo — policy only)" : ""}
            </button>
          </div>
          {gwatEnv && gwatEnv.sim && (
            <div className="studio-result" data-testid="venue-gwat-sim">
              <pre className="mono">
                {gwatEnv.sim.ok
                  ? `DRYRUN ok (gas ~${gwatEnv.sim.gas?.toString() ?? "?"})${gwatPreviewSpawned !== null ? `\npreview spawned venue: ${gwatPreviewSpawned} (nonce-derived — the receipt's NewQing is the proof)` : ""}`
                  : `DRYRUN revert${gwatEnv.sim.error?.decoded ? `: ${gwatEnv.sim.error.decoded}` : ""}\n${gwatEnv.sim.error?.message ?? ""}`}
              </pre>
            </div>
          )}
          {gwatSpawned !== null && (
            <div className="studio-result" data-testid="venue-gwat-spawned">
              <h4>your GWAT spawned</h4>
              <dl className="kv">
                <dt>spawned venue</dt>
                <dd className="mono">
                  <a className="outlink" href={`${EXPLORER_BASE}${gwatSpawned.qing}`} target="_blank" rel="noreferrer noopener">
                    {gwatSpawned.qing} ↗
                  </a>
                </dd>
                <dt>drawn waat (Luo)</dt>
                <dd className="mono waat">{gwatSpawned.waat.toString()}</dd>
              </dl>
              <div className="studio-actions">
                <button className="btn" disabled={gwatSelected} onClick={() => void selectSpawned()} data-testid="venue-gwat-select">
                  {gwatSelected ? "selected as current venue" : "set as current venue"}
                </button>
              </div>
              <p className="hint">
                the full spawn mint landed at your wallet as GWAT tokens (quantity = the new venue's cap);
                the venue itself is CHO-cross-owned and you were added as an owner — the management drawer
                opens on it like any venue.
              </p>
            </div>
          )}
        </div>
      )}

      <VenueManageDrawer
        venue={venue}
        live={live}
        account={account}
        qingAbi={qingAbi}
        walletMode={wallet.mode}
        chainUrl={chain.url}
        onSent={() => live.refresh()}
      />

      {action.error && <p className="err-text">{action.error}</p>}
      {action.outcome && (
        <div className="studio-result" data-testid="venue-outcome">
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

