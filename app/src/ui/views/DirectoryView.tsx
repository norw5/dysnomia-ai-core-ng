import { useEffect, useMemo, useState } from "react";
import { EXPLORER_BASE, PERIMETER, addressConfig } from "@config/addresses";
import { makeClient } from "@/chain/client";
import { fmtAmt, readWalletYue } from "@/chain/identity";
import { useEntityProfile } from "@/chain/entityProfile";
import { loadAddressBook, searchAddressBook, type AddressBook } from "@/chain/addressBook";
import { loadLaus, searchLaus, type LauRow } from "@/state/lauSeed";
import { loadShios, searchShios, type ShioRow } from "@/state/shioSeed";
import { loadYues, searchYues, type YueRow } from "@/state/yueSeed";
import { useCurrentVenue } from "@/state/venueStore";
import { useSyncState } from "@/chain/sync";
import { VenueSidebar } from "@/ui/VenueSidebar";
import { CreateVenueCard } from "@/ui/CreateVenueCard";
import { LearnHint } from "@/ui/LearnHint";
import type { ChainState } from "@/chain/useChainState";
import type { Address } from "viem";

/**
 * DIRECTORY (IA-PLAN §5; skeleton session-44, completed session-48): local
 * browse + search over the seeded censuses + read-only entity profiles.
 * LAU tab = the 18,660-row census; QING tab = the unified QING sidebar per
 * the owner's one-sidebar rule; SHIO tab = the 12,363-channel census (every
 * SHIO names itself "CHATLOG Shio" — the profile reads the Rod/Cone SHA
 * pair that actually distinguishes a channel); YUE tab = the 93 verified
 * account-vaults + the live wallet→YUE resolver (CHAN.Yan — the portal-v2
 * name-probe pattern: local index first, onchain probe for what the seed
 * may not cover). CHO tab (session-53, B1.6) = the system address book —
 * the hundred-odd boot-written named citizens (103 at the session-53 fork
 * walk), walked LIVE (no seed): Aliases(i) then Addresses(alias), both
 * anonymous views.
 */

type DirTab = "laus" | "qing" | "shios" | "yues" | "cho";

/**
 * session-70: honest seed staleness — the LAU/SHIO/YUE census snapshots
 * carry no date, but their newest row IS the as-of. These factories emit
 * NO events (no onchain enumerator), so the lists cannot be caught up
 * client-side; refresh = a seed regen. The chip says so.
 */
function SeedAsOfChip({ rows, testid }: { rows: ReadonlyArray<{ blk: number | null }> | null; testid: string }) {
  if (rows === null) return null;
  let max = 0;
  for (const r of rows) if (r.blk !== null && r.blk > max) max = r.blk;
  if (max === 0) return null;
  return (
    <span
      className="chip"
      title="frozen census snapshot — the factory emits no events, so this list only moves on a seed regen; profiles + resolvers read live"
      data-testid={testid}
    >
      SEED · as of {max.toLocaleString()}
    </span>
  );
}

/**
 * The seed marks an unreadable/absent probe as "" or the literal "?" (2,128
 * rows at the session-70 census). A lone question mark reads like a loading
 * glyph in a list — render the honest label instead (session-77 face-lift).
 */
function readableLauName(u: string): string | null {
  const t = u.trim();
  return t.length === 0 || t === "?" ? null : t;
}

export function DirectoryView({ chain }: { chain: ChainState }) {
  const [tab, setTab] = useState<DirTab>("laus");
  return (
    <section className="view directory view-center" data-testid="view-directory">
      <h1>//directory DIRECTORY — the censuses</h1>
      <nav className="dock-tabs" aria-label="directory tabs">
        <button className={tab === "laus" ? "dock-tab active" : "dock-tab"} onClick={() => setTab("laus")} data-testid="dir-tab-laus">
          LAUS
        </button>
        <button className={tab === "qing" ? "dock-tab active" : "dock-tab"} onClick={() => setTab("qing")} data-testid="dir-tab-qing">
          QING
        </button>
        <button className={tab === "shios" ? "dock-tab active" : "dock-tab"} onClick={() => setTab("shios")} data-testid="dir-tab-shios">
          SHIO
        </button>
        <button className={tab === "yues" ? "dock-tab active" : "dock-tab"} onClick={() => setTab("yues")} data-testid="dir-tab-yues">
          YUE
        </button>
        <button className={tab === "cho" ? "dock-tab active" : "dock-tab"} onClick={() => setTab("cho")} data-testid="dir-tab-cho">
          CHO
        </button>
      </nav>
      {tab === "laus" ? (
        <LauDirectory chain={chain} />
      ) : tab === "shios" ? (
        <ShioDirectory chain={chain} />
      ) : tab === "yues" ? (
        <YueDirectory chain={chain} />
      ) : tab === "cho" ? (
        <ChoBookTab chain={chain} />
      ) : (
        <QingDirectory chain={chain} />
      )}
      <p className="hint" data-testid="dir-foot">
        seeds: LAU census 18,660 (97.8% with readable usernames, kb §6) · venue atlas + live NewQing catch-up (the
        sync engine) · SHIO channels 12,363 (12,460 factory children − 3 unresolvable − 94 duplicates) · YUE vaults
        93 (the receipt-scan census) — LAU/SHIO/YUE are frozen snapshots (their factories emit nothing); profiles
        read live.
      </p>
    </section>
  );
}

function LauDirectory({ chain }: { chain: ChainState }) {
  const [seed, setSeed] = useState<LauRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<LauRow | null>(null);

  useEffect(() => {
    let alive = true;
    loadLaus()
      .then((rows) => {
        if (alive) setSeed(rows);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const found = useMemo(() => (seed ? searchLaus(seed, query) : null), [seed, query]);

  return (
    <div className="dir-lau">
      <div className="dir-list-panel">
        <p className="hint" data-testid="lau-seed-chip-host">
          <SeedAsOfChip rows={seed} testid="lau-seed-chip" />
        </p>
        <input
          className="venue-search mono"
          type="search"
          placeholder="search username · address"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="search laus"
          data-testid="lau-search"
        />
        {error && <p className="err-text">{error}</p>}
        {seed === null && !error && <p className="hint">loading the census (18,660 LAUs)…</p>}
        {found !== null && found.total > found.rows.length && (
          <p className="hint" data-testid="lau-more">
            showing {found.rows.length} of {found.total.toLocaleString()} matches — refine the search
          </p>
        )}
        <ul className="venue-list dir-lau-list" data-testid="lau-list">
          {found?.rows.map((r) => (
            <li key={r.a}>
              <button
                className={picked !== null && picked.a === r.a ? "venue-row active" : "venue-row"}
                onClick={() => setPicked(r)}
                data-testid={`lau-row-${r.a}`}
              >
                <span className={readableLauName(r.u) === null ? "venue-name dim" : "venue-name"}>
                  {readableLauName(r.u) ?? "unnamed"}
                </span>
                <span className="venue-meta">
                  <span className="mono">{r.a.slice(0, 12)}…</span>
                  <span className="dim"> block {r.blk.toLocaleString()}</span>
                </span>
              </button>
            </li>
          ))}
          {found !== null && found.total === 0 && (
            <li className="hint venue-empty">no LAU matches “{query.trim()}”</li>
          )}
        </ul>
      </div>
      <div data-testid="lau-profile-host">
        {picked !== null ? (
          <LauProfile chain={chain} row={picked} onClear={() => setPicked(null)} />
        ) : (
          <div className="panel">
            <h2>entity profile</h2>
            <p className="hint">pick a LAU — read-only profile: seed facts + one anonymous live batch.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function LauProfile({ chain, row, onClear }: { chain: ChainState; row: LauRow; onClear: () => void }) {
  const live = useEntityProfile(chain.url, row.a as Address);
  return (
    <div className="panel" data-testid="lau-profile">
      <h2>
        {readableLauName(row.u) ?? "(unreadable username)"}{" "}
        <a className="outlink" href={`${EXPLORER_BASE}${row.a}`} target="_blank" rel="noreferrer noopener">
          ↗ explorer
        </a>{" "}
        <button className="btn" onClick={onClear} data-testid="lau-clear">
          clear
        </button>
      </h2>
      <h3>seed facts (census)</h3>
      <dl className="kv">
        <dt>address</dt>
        <dd className="mono">{row.a}</dd>
        <dt>username (seed)</dt>
        <dd>{readableLauName(row.u) ?? "—"}</dd>
        <dt>created</dt>
        <dd className="mono">block {row.blk.toLocaleString()}</dd>
      </dl>
      <h3>
        live state{" "}
        <button className="btn" disabled={live.loading} onClick={live.refresh} data-testid="lau-refresh">
          {live.loading ? "reading…" : "refresh"}
        </button>
      </h3>
      <div data-testid="lau-live">
        {live.error && <p className="err-text">live reads unavailable: {live.error}</p>}
        {!live.error && live.state === null && <p className="hint">reading (one anonymous Multicall3 batch)…</p>}
        {live.state !== null && (
          <dl className="kv">
            <dt>PLS (contract)</dt>
            <dd className="mono">{fmtAmt(live.state.pls)}</dd>
            <dt>Ⓐ AFFECTION</dt>
            <dd className="mono">{fmtAmt(live.state.affection)}</dd>
            <dt>CHOA</dt>
            <dd className="mono">{fmtAmt(live.state.choa)}</dd>
            <dt>Username (live)</dt>
            <dd>{readableLauName(live.state.username ?? "") ?? "unset (view reverts until set)"}</dd>
            <dt>name / symbol</dt>
            <dd className="mono">
              {live.state.name ?? "—"} / {live.state.symbol ?? "—"}
            </dd>
            {live.state.blockNumber !== null && (
              <>
                <dt>block</dt>
                <dd className="mono">{live.state.blockNumber.toString()}</dd>
              </>
            )}
          </dl>
        )}
      </div>
      <details className="explain">
        <summary>? what is a LAU</summary>
        <p className="hint">
          a LAU is a personal account token — your handle, wallet-inside-the-world, and chat
          identity in one; it can hold anything and pay it back out. balances shown here belong to
          the LAU CONTRACT (what the world has paid it), not a wallet.
        </p>
      </details>
    </div>
  );
}

function QingDirectory({ chain }: { chain: ChainState }) {
  const { current } = useCurrentVenue();
  const sync = useSyncState();
  return (
    <div className="dir-qing">
      <div className="panel">
        <h2>
          venue (QING) census{" "}
          <span
            className="chip"
            title="the ONE enumerable census: MAP.NewQing logs — the sync engine walks them from the seed floor to head (the header DATA control pauses it)"
            data-testid="qing-sync-chip"
          >
            {sync.running ? (sync.qing.busy ? "SYNCING…" : `SYNC → ${sync.qing.cursor.toLocaleString()}`) : "SYNC PAUSED"}
            {sync.qingRows.length > 0 && ` · +${sync.qingRows.length} live`}
            {sync.qingPending > 0 && ` · ${sync.qingPending} resolving`}
          </span>
        </h2>
        <p className="hint">
          the unified QING sidebar, reused per the owner's one-sidebar rule — pick a venue to
          select it app-globally (MAP + CHAT follow); venues created after the last seed regen
          join the list via the sync engine's NewQing walk.
          {current !== null && (
            <>
              {" "}
              current: <span className="mono">{current.n.length > 0 ? current.n : current.a}</span>
            </>
          )}
        </p>
      </div>
      <VenueSidebar />
      <details className="explain" data-testid="dir-create-toggle">
        <summary>… or add to the census — create a venue (MAP.New)</summary>
        <CreateVenueCard chain={chain} />
      </details>
    </div>
  );
}

function ShioDirectory({ chain }: { chain: ChainState }) {
  const [seed, setSeed] = useState<ShioRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ShioRow | null>(null);

  useEffect(() => {
    let alive = true;
    loadShios()
      .then((rows) => {
        if (alive) setSeed(rows);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const found = useMemo(() => (seed ? searchShios(seed, query) : null), [seed, query]);

  return (
    <div className="dir-lau">
      <div className="dir-list-panel">
        <p className="hint" data-testid="shio-seed-chip-host">
          <SeedAsOfChip rows={seed} testid="shio-seed-chip" />
        </p>
        <input
          className="venue-search mono"
          type="search"
          placeholder="search channel address"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="search shios"
          data-testid="shio-search"
        />
        {error && <p className="err-text">{error}</p>}
        {seed === null && !error && <p className="hint">loading the SHIO census (12,363 channels)…</p>}
        {found !== null && found.total > found.rows.length && (
          <p className="hint" data-testid="shio-more">
            showing {found.rows.length} of {found.total.toLocaleString()} matches — refine the search
          </p>
        )}
        <ul className="venue-list dir-lau-list" data-testid="shio-list">
          {found?.rows.map((r) => (
            <li key={r.a}>
              <button
                className={picked !== null && picked.a === r.a ? "venue-row active" : "venue-row"}
                onClick={() => setPicked(r)}
                data-testid={`shio-row-${r.a}`}
              >
                <span className="venue-name mono">{r.a.slice(0, 14)}…{r.a.slice(-6)}</span>
                <span className="venue-meta">
                  <span className="dim">block {r.blk.toLocaleString()}</span>
                </span>
              </button>
            </li>
          ))}
          {found !== null && found.total === 0 && <li className="hint venue-empty">no SHIO matches “{query.trim()}”</li>}
        </ul>
      </div>
      <div data-testid="shio-profile-host">
        {picked !== null ? (
          <ShioProfile chain={chain} row={picked} onClear={() => setPicked(null)} />
        ) : (
          <div className="panel">
            <h2>channel profile</h2>
            <p className="hint">
              pick a SHIO — every channel names itself “CHATLOG Shio” (0 renames in the full-census
              probe); what distinguishes one is its Rod/Cone SHA pair, read live in the profile.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ShioProfile({ chain, row, onClear }: { chain: ChainState; row: ShioRow; onClear: () => void }) {
  const live = useEntityProfile(chain.url, row.a as Address, "shio");
  return (
    <div className="panel" data-testid="shio-profile">
      <h2>
        SHIO channel{" "}
        <a className="outlink" href={`${EXPLORER_BASE}${row.a}`} target="_blank" rel="noreferrer noopener">
          ↗ explorer
        </a>{" "}
        <button className="btn" onClick={onClear} data-testid="shio-clear">
          clear
        </button>
      </h2>
      <h3>seed facts (census)</h3>
      <dl className="kv">
        <dt>address</dt>
        <dd className="mono">{row.a}</dd>
        <dt>created</dt>
        <dd className="mono">block {row.blk.toLocaleString()}</dd>
        <dt>name (probe)</dt>
        <dd className="mono">{row.n || "—"}</dd>
      </dl>
      <h3>
        live state{" "}
        <button className="btn" disabled={live.loading} onClick={live.refresh} data-testid="shio-refresh">
          {live.loading ? "reading…" : "refresh"}
        </button>
      </h3>
      <div data-testid="shio-live">
        {live.error && <p className="err-text">live reads unavailable: {live.error}</p>}
        {!live.error && live.state === null && <p className="hint">reading (one anonymous Multicall3 batch)…</p>}
        {live.state !== null && (
          <dl className="kv">
            <dt>name / symbol</dt>
            <dd className="mono">
              {live.state.name ?? "—"} / {live.state.symbol ?? "—"}
            </dd>
            <dt>Rod end (SHA)</dt>
            <dd className="mono">
              {live.state.rod !== null ? (
                <>
                  {live.state.rod}{" "}
                  <a className="outlink" href={`${EXPLORER_BASE}${live.state.rod}`} target="_blank" rel="noreferrer noopener">
                    ↗
                  </a>
                </>
              ) : (
                "— (not a SHIO or read failed)"
              )}
            </dd>
            <dt>Cone end (SHA)</dt>
            <dd className="mono">
              {live.state.cone !== null ? (
                <>
                  {live.state.cone}{" "}
                  <a className="outlink" href={`${EXPLORER_BASE}${live.state.cone}`} target="_blank" rel="noreferrer noopener">
                    ↗
                  </a>
                </>
              ) : (
                "—"
              )}
            </dd>
            <dt>PLS (contract)</dt>
            <dd className="mono">{fmtAmt(live.state.pls)}</dd>
            <dt>Ⓐ AFFECTION</dt>
            <dd className="mono">{fmtAmt(live.state.affection)}</dd>
            <dt>CHOA</dt>
            <dd className="mono">{fmtAmt(live.state.choa)}</dd>
            {live.state.blockNumber !== null && (
              <>
                <dt>block</dt>
                <dd className="mono">{live.state.blockNumber.toString()}</dd>
              </>
            )}
          </dl>
        )}
      </div>
      <details className="explain">
        <summary>? what is a SHIO</summary>
        <p className="hint">
          a SHIO is a chat channel — the token contract holding the conversation state between two
          SHA particles (Rod and Cone), advanced from both sides by React() steps. the world
          channel (ZHOU's SHIO) is one of these; its LogEvent stream is what the CHAT world view
          reads.
        </p>
      </details>
    </div>
  );
}

function YueDirectory({ chain }: { chain: ChainState }) {
  const [seed, setSeed] = useState<YueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<YueRow | null>(null);

  // the live wallet→YUE resolver (portal-v2 pattern): CHAN.Yan(wallet)
  const [probeWallet, setProbeWallet] = useState("");
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeResult, setProbeResult] = useState<{ yue: string; inSeed: boolean } | "none" | "error" | null>(null);
  const client = useMemo(() => makeClient(chain.url), [chain.url]);

  useEffect(() => {
    let alive = true;
    loadYues()
      .then((rows) => {
        if (alive) setSeed(rows);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const found = useMemo(() => (seed ? searchYues(seed, query) : null), [seed, query]);

  const runProbe = async () => {
    const w = probeWallet.trim().toLowerCase();
    setProbeResult(null);
    if (!/^0x[0-9a-f]{40}$/.test(w)) return;
    setProbeBusy(true);
    try {
      const yue = await readWalletYue(client, w as Address);
      if (yue === null) setProbeResult("none");
      else setProbeResult({ yue: yue.toLowerCase(), inSeed: seed?.some((r) => r.a === yue.toLowerCase()) ?? false });
    } catch (e: unknown) {
      setProbeResult("error");
    } finally {
      setProbeBusy(false);
    }
  };

  return (
    <div className="dir-lau">
      <div className="dir-list-panel">
        <p className="hint" data-testid="yue-seed-chip-host">
          <SeedAsOfChip rows={seed} testid="yue-seed-chip" />
        </p>
        <input
          className="venue-search mono"
          type="search"
          placeholder="search name · symbol · owner wallet"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="search yues"
          data-testid="yue-search"
        />
        {error && <p className="err-text">{error}</p>}
        {seed === null && !error && <p className="hint">loading the YUE census (93 vaults)…</p>}
        {found !== null && found.total > found.rows.length && (
          <p className="hint" data-testid="yue-more">
            showing {found.rows.length} of {found.total} matches
          </p>
        )}
        <ul className="venue-list dir-lau-list" data-testid="yue-list">
          {found?.rows.map((r) => (
            <li key={r.a}>
              <button
                className={picked !== null && picked.a === r.a ? "venue-row active" : "venue-row"}
                onClick={() => setPicked(r)}
                data-testid={`yue-row-${r.a}`}
              >
                <span className="venue-name">{r.n.length > 0 ? r.n : "(unnamed)"}</span>
                <span className="venue-meta">
                  <span className="mono">{r.s.length > 0 ? r.s : "—"}</span>
                  <span className="dim">{r.blk !== null ? ` block ${r.blk.toLocaleString()}` : ""}</span>
                </span>
              </button>
            </li>
          ))}
          {found !== null && found.total === 0 && <li className="hint venue-empty">no YUE matches “{query.trim()}”</li>}
        </ul>
        <div className="yue-resolver" data-testid="yue-resolver">
          <h3>wallet → YUE (live)</h3>
          <p className="hint">CHAN.Yan(wallet) — resolves any wallet's vault live, including YUEs newer than the seed.</p>
          <input
            className="venue-search mono"
            type="search"
            placeholder="0x… wallet address"
            spellCheck={false}
            value={probeWallet}
            onChange={(e) => {
              setProbeWallet(e.target.value);
              setProbeResult(null);
            }}
            aria-label="probe wallet"
            data-testid="yue-probe-input"
          />
          <button className="btn" disabled={probeBusy || !/^0x[0-9a-fA-F]{40}$/.test(probeWallet.trim())} onClick={() => void runProbe()} data-testid="yue-probe-run">
            {probeBusy ? "probing…" : "resolve"}
          </button>
          {probeResult === "none" && <p className="hint" data-testid="yue-probe-none">no YUE for that wallet (the CHAN registry returns zero).</p>}
          {probeResult === "error" && <p className="err-text" data-testid="yue-probe-error">read failed — RPC unavailable.</p>}
          {probeResult !== null && typeof probeResult === "object" && (
            <p className="hint mono" data-testid="yue-probe-hit">
              <a className="outlink" href={`${EXPLORER_BASE}${probeResult.yue}`} target="_blank" rel="noreferrer noopener">
                {probeResult.yue} ↗
              </a>
              {probeResult.inSeed
                ? " — in the census below"
                : " — NEWER than the seed (or renamed); the census ships the 93 verified at freeze)"}
            </p>
          )}
        </div>
      </div>
      <div data-testid="yue-profile-host">
        {picked !== null ? (
          <YueProfile chain={chain} row={picked} onClear={() => setPicked(null)} />
        ) : (
          <div className="panel">
            <h2>vault profile</h2>
            <p className="hint">pick a YUE — read-only profile: seed facts + one anonymous live batch (+ live Origin).</p>
          </div>
        )}
      </div>
    </div>
  );
}

function YueProfile({ chain, row, onClear }: { chain: ChainState; row: YueRow; onClear: () => void }) {
  const live = useEntityProfile(chain.url, row.a as Address, "yue");
  return (
    <div className="panel" data-testid="yue-profile">
      <h2>
        {row.n.length > 0 ? row.n : "(unnamed)"}{" "}
        <a className="outlink" href={`${EXPLORER_BASE}${row.a}`} target="_blank" rel="noreferrer noopener">
          ↗ explorer
        </a>{" "}
        <button className="btn" onClick={onClear} data-testid="yue-clear">
          clear
        </button>
      </h2>
      <h3>seed facts (census)</h3>
      <dl className="kv">
        <dt>address</dt>
        <dd className="mono">{row.a}</dd>
        <dt>name / symbol (probe)</dt>
        <dd className="mono">
          {row.n.length > 0 ? row.n : "—"} / {row.s.length > 0 ? row.s : "—"}
        </dd>
        <dt>owner wallet (Origin at probe)</dt>
        <dd className="mono">
          {row.o.length > 0 ? (
            <>
              {row.o}{" "}
              <a className="outlink" href={`${EXPLORER_BASE}${row.o}`} target="_blank" rel="noreferrer noopener">
                ↗
              </a>
            </>
          ) : (
            "—"
          )}
        </dd>
        <dt>created</dt>
        <dd className="mono">{row.blk !== null ? `block ${row.blk.toLocaleString()}` : "—"}</dd>
      </dl>
      <h3>
        live state{" "}
        <button className="btn" disabled={live.loading} onClick={live.refresh} data-testid="yue-refresh">
          {live.loading ? "reading…" : "refresh"}
        </button>
      </h3>
      <div data-testid="yue-live">
        {live.error && <p className="err-text">live reads unavailable: {live.error}</p>}
        {!live.error && live.state === null && <p className="hint">reading (one anonymous Multicall3 batch)…</p>}
        {live.state !== null && (
          <dl className="kv">
            <dt>name / symbol</dt>
            <dd className="mono">
              {live.state.name ?? "—"} / {live.state.symbol ?? "—"}
            </dd>
            <dt>Origin (live)</dt>
            <dd className="mono">{live.state.origin ?? "—"}</dd>
            <dt>PLS (contract)</dt>
            <dd className="mono">{fmtAmt(live.state.pls)}</dd>
            <dt>Ⓐ AFFECTION</dt>
            <dd className="mono">{fmtAmt(live.state.affection)}</dd>
            <dt>CHOA</dt>
            <dd className="mono">{fmtAmt(live.state.choa)}</dd>
            {live.state.blockNumber !== null && (
              <>
                <dt>block</dt>
                <dd className="mono">{live.state.blockNumber.toString()}</dd>
              </>
            )}
          </dl>
        )}
      </div>
      <details className="explain">
        <summary>? what is a YUE</summary>
        <p className="hint">
          a YUE is a personal account-vault token — one per wallet, earnings land in it (the CHOA
          chat bounty), withdrawals leave only through CHAN escrow consent. balances shown are the
          vault CONTRACT's holdings, not the owner wallet's.
        </p>
      </details>
    </div>
  );
}

/**
 * The CHO system address book (session-53, B1.6): the hundred-odd named
 * citizens written once at boot — "source" (the treasury-side deployer
 * key), the reserve set (dai/usdc/usdt…), the ban tokens, community
 * tokens. Pure-view live walk (Aliases(i) → Addresses(alias)); no seed
 * exists, so a dead RPC is the honest unavailable state, never an empty
 * book. Rows matching the configured perimeter get a chip — this is the
 * honest grounding for the CROWS/WITHOUT references the bouncer UI makes.
 */
function ChoBookTab({ chain }: { chain: ChainState }) {
  const [book, setBook] = useState<AddressBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const client = useMemo(() => makeClient(chain.url), [chain.url]);

  const read = () => {
    setBusy(true);
    setError(null);
    loadAddressBook(client)
      .then(setBook)
      .catch((e: unknown) => {
        setBook(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const known = useMemo(() => {
    const m = new Map<string, string>();
    for (const [name, a] of Object.entries(PERIMETER)) m.set(a.toLowerCase(), name);
    return m;
  }, []);

  const rows = useMemo(() => (book ? searchAddressBook(book, query) : null), [book, query]);

  return (
    <div className="panel" data-testid="cho-book">
      <h2>
        the CHO address book <LearnHint file="venues.md" anchor="cho-the-hub" />{" "}
        <button className="btn" disabled={busy} onClick={read} data-testid="cho-refresh">
          {busy ? "walking…" : "refresh"}
        </button>
      </h2>
      <p className="hint">
        the system's phone book — named citizens registered once at boot by a throwaway loader:
        "source" (the treasury-side deployer key), the reserve set, community tokens, and the two
        tokens the doors actually check (CROWS — the 25-token bouncer threshold; WITHOUT — the ban
        token, hold zero). read live through two anonymous views: <code>Aliases(i)</code> →{" "}
        <code>Addresses(alias)</code>.
      </p>
      <input
        className="venue-search mono"
        type="search"
        placeholder="search alias · address"
        spellCheck={false}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="search the address book"
        data-testid="cho-search"
      />
      {error && (
        <p className="err-text" data-testid="cho-book-error">
          live reads unavailable: {error}
        </p>
      )}
      {!error && book === null && <p className="hint">walking the book (two anonymous batches)…</p>}
      {rows !== null && (
        <>
          <p className="hint" data-testid="cho-count">
            {rows.length.toLocaleString()} of {book?.rows.length.toLocaleString() ?? "—"} entries — boot-write order
          </p>
          <table className="bal-table cho-table" data-testid="cho-table">
            <thead>
              <tr>
                <th>#</th>
                <th>alias</th>
                <th>address</th>
                <th>known as</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const name = r.address !== null ? known.get(r.address.toLowerCase()) : undefined;
                return (
                  <tr key={r.index} data-testid={`cho-row-${r.alias}`}>
                    <td className="mono dim">{r.index}</td>
                    <td className="mono">{r.alias}</td>
                    <td className="mono">
                      {r.address !== null ? (
                        <>
                          {r.address}{" "}
                          <a className="outlink" href={`${EXPLORER_BASE}${r.address}`} target="_blank" rel="noreferrer noopener">
                            ↗
                          </a>
                        </>
                      ) : (
                        "— ( Addresses returned zero )"
                      )}
                    </td>
                    <td>
                      {name !== undefined ? (
                        <span className="chip" title={addressConfig.notes[name] ?? name} data-testid={`cho-chip-${name}`}>
                          {name}
                        </span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="hint">
                    no book entry matches “{query.trim()}”
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
      <details className="explain">
        <summary>? why this book matters</summary>
        <p className="hint">
          the hub's registration desk: when a venue door says "CROWS" or the world says "WITHOUT",
          these are the onchain entries those words resolve to — the one place the system's proper
          nouns live as addresses. browse-only: the loader that wrote it is spent, entries are not
          added anymore.
        </p>
      </details>
    </div>
  );
}
