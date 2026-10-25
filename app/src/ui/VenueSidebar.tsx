import { useEffect, useMemo, useState } from "react";
import {
  searchVenues,
  useCurrentVenue,
  type VenueRow,
  type VenueSeedDoc,
} from "@/state/venueStore";
import { mergeByAddress, useSyncState } from "@/chain/sync";
import { renderRowAsVenueRow } from "@/state/atlas";
import { setChatChannelMode, useChatChannelMode } from "@/state/chatChannel";

/**
 * The unified QING sidebar (IA-PLAN §3, owner directive): ONE searchable
 * venue list reused by MAP (layer panel — now), CHAT (channel list), DIRECTORY
 * (QING tab), MARKET (asset picker — later). Data = the s32-exact seed + the
 * session-70 sync engine's caught-up venues (the NewQing walk — a venue
 * created after the last seed regen appears here with a LIVE chip). Selection
 * goes through the app-global store.
 *
 * `mode="channels"` (CHAT, session-44): the same list wearing its channel
 * hat — a pinned WORLD row (the VOID channel) on top, venue rows become
 * channel picks (they set BOTH the app-global venue and the chat channel
 * mode). One component, one data source, the owner's one-sidebar rule.
 */

const SEED_LOADERS = import.meta.glob("../../../data/venue_seed.slim.json") as Record<
  string,
  () => Promise<{ default: VenueSeedDoc }>
>;

let seedPromise: Promise<VenueRow[]> | null = null;

function loadSeed(): Promise<VenueRow[]> {
  if (!seedPromise) {
    const key = Object.keys(SEED_LOADERS)[0];
    if (!key) return Promise.reject(new Error("venue seed not found"));
    seedPromise = SEED_LOADERS[key]!().then((m) => m.default.venues);
  }
  return seedPromise;
}

export function VenueSidebar({ compact = false, mode = "venues" }: { compact?: boolean; mode?: "venues" | "channels" }) {
  const { current, setCurrent } = useCurrentVenue();
  const chat = useChatChannelMode();
  const sync = useSyncState();
  const [seed, setSeed] = useState<VenueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    loadSeed()
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

  // session-70: the sync engine's caught-up venues join the browse (address
  // dedupe — a seed regen absorbs them); names/coords resolved via HECKE
  const liveVenueRows = useMemo(() => sync.qingRows.map((r) => renderRowAsVenueRow(r)), [sync.qingRows]);
  const merged = useMemo(() => (seed !== null ? mergeByAddress(seed, liveVenueRows) : null), [seed, liveVenueRows]);
  const found = useMemo(() => (merged ? searchVenues(merged, query) : null), [merged, query]);

  const liveAddrs = useMemo(() => new Set(liveVenueRows.map((r) => r.a.toLowerCase())), [liveVenueRows]);

  const pickVenue = (v: VenueRow) => {
    setCurrent(v);
    if (mode === "channels") setChatChannelMode("venue");
  };

  // the channel hat: a venue row is the active channel ONLY in venue mode;
  // after selecting THE VOID the app-global current venue may stay set for
  // MAP/MARKET, but exactly one sidebar row may be highlighted.
  const venueRowActive = (v: VenueRow): boolean =>
    current !== null && current.a === v.a && (mode === "venues" || chat.mode === "venue");

  return (
    <div className="venue-sidebar" data-testid="venue-sidebar">
      <div className="venue-side-head">
        <span className="dock-title">
          {mode === "channels" ? "CHANNELS" : "VENUES"}{" "}
          {merged !== null && (
            <span className="dim" data-testid="venue-count">
              · {merged.length}
              {liveVenueRows.length > 0 && ` (+${liveVenueRows.length} live)`}
            </span>
          )}
        </span>
        {current && mode === "venues" && (
          <button
            className="dock-btn"
            onClick={() => setCurrent(null)}
            title="clear the app-global selection"
            data-testid="venue-clear"
          >
            clear
          </button>
        )}
      </div>
      <input
        className="venue-search mono"
        type="search"
        placeholder="search name · symbol · address · band"
        spellCheck={false}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="search venues"
        data-testid="venue-search"
      />
      {mode === "channels" && (
        <ul className="venue-list venue-list-main">
          <li>
            <button
              className={chat.mode === "world" ? "venue-row active" : "venue-row"}
              onClick={() => chat.setMode("world")}
              data-testid="channel-world"
            >
              <span className="venue-name">THE VOID — world channel</span>
              <span className="venue-meta">
                <span className="mono">ZHOU</span>
                <span className="dim"> seed + live tail</span>
              </span>
            </button>
          </li>
        </ul>
      )}
      {error && <p className="err-text">{error}</p>}
      {found && found.total > found.rows.length && (
        <p className="hint" data-testid="venue-more">
          showing {found.rows.length} of {found.total} matches — refine the search
        </p>
      )}
      <ul className="venue-list" data-testid="venue-list">
        {found?.rows.map((v) => (
          <li key={v.a}>
            <button
              className={
                venueRowActive(v) ? "venue-row active" : "venue-row"
              }
              onClick={() => pickVenue(v)}
              data-testid={`venue-row-${v.a}`}
            >
              <span className="venue-name">{v.n.length > 0 ? v.n : "(nameless)"}</span>
              <span className="venue-meta">
                <span className="mono">{v.s}</span>
                <span className="dim"> band {v.band}</span>
                {liveAddrs.has(v.a.toLowerCase()) && (
                  <span className="mono" title="found by the sync engine's NewQing walk — not yet in the seed" data-testid="venue-live-flag">
                    {" "}LIVE
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
        {found !== null && found.total === 0 && (
          <li className="hint venue-empty">no venue matches “{query.trim()}”</li>
        )}
      </ul>
      {!compact && (
        <p className="hint venue-side-foot">
          {mode === "channels"
            ? "world channel = the VOID LogEvent archive (seed) + live RPC tail; picking a venue tunes CHAT to that QING's own channel"
            : "seed venues (s32-exact) + the sync engine's live catch-up (NewQing walk — MAP emits it; the header DATA control pauses it)"}
        </p>
      )}
    </div>
  );
}
