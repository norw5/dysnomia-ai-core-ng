import { useEffect, useMemo, useState } from "react";
import { useCurrentVenue } from "@/state/venueStore";
import { loadRenderRows, renderRowAsVenueRow, type RenderRow } from "@/state/atlas";
import { mergeByAddress, useSyncState } from "@/chain/sync";
import { useLiveRenderRow } from "@/chain/liveAtlas";
import { AtlasCanvas } from "@/ui/map/AtlasCanvas";
import { VenueHudCard } from "@/ui/map/VenueHudCard";
import { VenuePanel } from "@/ui/VenuePanel";
import { VenueSidebar } from "@/ui/VenueSidebar";
import { CreateVenueCard } from "@/ui/CreateVenueCard";
import type { PlayerSnapshot } from "@/chain/identity";
import type { ChainState } from "@/chain/useChainState";
import type { LayoutState } from "@/ui/layout/SplitGutter";

/**
 * MAP (IA-PLAN §10 item 4; session-67 RESTRUCTURE — the agent-driven map
 * UX prerequisite): the EDGE-TO-EDGE atlas fills the main container (the
 * old site's map-in-main-container feel — the view-level panel frame is
 * gone). Selection surfaces the compact click-HUD card (the old
 * TARGET_LOCKED idiom) over the canvas; the FULL contextual panel opens
 * from its affordance as a right-side overlay drawer (internally
 * scrollable). Compact keeps the in-flow panel below the map.
 *
 * Session-67 live markers: a venue created after the last seed regen gets
 * its TRUE coordinates computed live (QING.Waat + HECKE.Compliment —
 * kb §9's exact math) and draws on the canvas like any seed venue; the
 * card's chip names the source honestly (SEED · s32 / HECKE · LIVE).
 */
export function MapView({
  layout,
  isCompact,
  onLayout,
  chain,
  snapshot,
}: {
  layout: LayoutState;
  isCompact: boolean;
  onLayout: (patch: Partial<LayoutState>) => void;
  chain: ChainState;
  snapshot: PlayerSnapshot | null;
}) {
  const { current, setCurrent } = useCurrentVenue();
  const [rows, setRows] = useState<RenderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cardHiddenFor, setCardHiddenFor] = useState<string | null>(null);
  const live = useLiveRenderRow(chain.url, current, rows);
  const sync = useSyncState();
  const sidebarOpen = layout.sidebar >= 220;

  useEffect(() => {
    let alive = true;
    loadRenderRows()
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const renderRow = live.row;

  // the canvas rows: the seed + the sync engine's caught-up rows + the
  // live-computed row merged in (a venue outside the seed draws a TRUE
  // marker; selection ring + camera focus work)
  const canvasRows = useMemo(() => {
    if (rows === null) return null;
    let out = mergeByAddress(rows, sync.qingRows);
    if (renderRow !== null && live.source === "live" && !out.some((r) => r.a === renderRow.a)) {
      out = [...out, renderRow];
    }
    return out;
  }, [rows, renderRow, live.source, sync.qingRows]);

  const selectRow = (row: RenderRow) => {
    setCurrent(renderRowAsVenueRow(row));
    setCardHiddenFor(null);
  };

  const clearVenue = () => {
    setCurrent(null);
    setDrawerOpen(false);
  };

  const panel = current !== null && rows !== null && (
    <VenuePanel
      venue={current}
      render={renderRow}
      renderSource={live.source === "live" ? "live" : "seed"}
      chain={chain}
      snapshot={snapshot}
      onClear={clearVenue}
    />
  );

  const emptySpace = (
    <>
      <p className="hint">
        none selected — pick one on the canvas or in the venue list; the choice is shared across every view.
      </p>
      <details className="explain" data-testid="map-create-toggle">
        <summary>… or claim empty space — create a venue</summary>
        <CreateVenueCard chain={chain} />
      </details>
    </>
  );

  return (
    <section className="view map" data-testid="view-map">
      <h1>
        //world MAP — the venue atlas{" "}
        {!isCompact && (
          <button
            className="btn"
            onClick={() => onLayout({ sidebar: sidebarOpen ? 0 : 320 })}
            data-testid="map-sidebar-toggle"
          >
            {sidebarOpen ? "hide venue list" : "show venue list"}
          </button>
        )}
      </h1>

      {isCompact && <VenueSidebar compact />}

      {error && <p className="err-text">{error}</p>}
      {rows === null && !error && <p className="hint">loading the render seed…</p>}
      {canvasRows !== null && (
        <div className="map-stage" data-testid="map-stage">
          <AtlasCanvas
            rows={canvasRows}
            selectedAddr={current !== null ? current.a.toLowerCase() : null}
            onSelect={selectRow}
          />
          {!isCompact && (
            <div data-testid="current-venue" className="map-hud-layer">
              {current !== null && cardHiddenFor !== current.a.toLowerCase() ? (
                <VenueHudCard
                  venue={current}
                  render={renderRow}
                  source={live.source}
                  error={live.error}
                  onOpenFull={() => setDrawerOpen(true)}
                  onClose={() => setCardHiddenFor(current.a.toLowerCase())}
                />
              ) : current === null ? (
                <div className="map-empty-hud" data-testid="map-empty-space">
                  {emptySpace}
                </div>
              ) : (
                <button
                  className="btn"
                  onClick={() => setCardHiddenFor(null)}
                  title="restore the venue card"
                  data-testid="venue-hud-restore"
                >
                  ▸ {current.n.length > 0 ? current.n : current.a.slice(0, 10) + "…"}
                </button>
              )}
            </div>
          )}
          {!isCompact && drawerOpen && current !== null && (
            <div className="map-drawer" data-testid="map-drawer">
              <div className="map-drawer-head">
                <span className="mono">VENUE PANEL — FULL</span>
                <button className="venue-hud-x" onClick={() => setDrawerOpen(false)} data-testid="map-drawer-close">
                  ✕
                </button>
              </div>
              {panel}
            </div>
          )}
        </div>
      )}

      {isCompact && (
        <div data-testid="current-venue">
          {current !== null ? panel : (
            <div data-testid="map-empty-space">
              <div className="panel">
                <h2>current venue</h2>
                {emptySpace}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
