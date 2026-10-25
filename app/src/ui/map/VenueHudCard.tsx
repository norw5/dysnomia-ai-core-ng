import { EXPLORER_BASE } from "@config/addresses";
import type { RenderRow } from "@/state/atlas";
import type { VenueRow } from "@/state/venueStore";

/**
 * The venue click-HUD card (session-67, the map-page restructure): the
 * compact selection overlay the old site's TARGET_LOCKED card was —
 * name/symbol/address/class/coords — shown when a venue is selected. The
 * FULL contextual panel opens from its affordance (the MAP drawer / the
 * DECK's venue bay); this card is the always-there quick overview, and the
 * agent reaches it for free: focus_map drives the same app-global
 * selection. Coordinate source honesty is load-bearing: SEED (s32) rows
 * and LIVE rows (HECKE.Compliment computed this session) render distinct
 * chips, and a failed live read renders "coords unavailable", never a
 * phantom position.
 */
export function VenueHudCard({
  venue,
  render,
  source,
  error,
  variant = "map",
  onOpenFull,
  onSurfaceVenue,
  onClose,
}: {
  venue: VenueRow;
  render: RenderRow | null;
  /** seed = the render seed; live = HECKE-computed this session */
  source: "seed" | "live" | null;
  /** live read failure (dead RPC / not a venue) — honest, never silent */
  error?: string | null;
  variant?: "map" | "deck";
  onOpenFull?: () => void;
  onSurfaceVenue?: () => void;
  onClose?: () => void;
}) {
  const sourceChip =
    source === "seed" ? (
      <span className="venue-hud-chip seed">SEED · s32</span>
    ) : source === "live" ? (
      <span className="venue-hud-chip live">HECKE · LIVE</span>
    ) : (
      <span className="venue-hud-chip err">COORDS UNAVAILABLE</span>
    );
  return (
    <div className={`venue-hud${variant === "deck" ? " deck" : ""}`} data-testid="venue-hud-card">
      <div className="venue-hud-head">
        <span className="venue-hud-title">
          TARGET{render?.sys === true ? " · FIRST QING (PHOBOS)" : " · VENUE (QING)"}
        </span>
        {onClose !== undefined && (
          <button className="venue-hud-x" onClick={onClose} aria-label="close the venue card" data-testid="venue-hud-close">
            ✕
          </button>
        )}
      </div>
      <div className="venue-hud-body">
        <p className="venue-hud-name">{venue.n.length > 0 ? venue.n : "(nameless onchain)"}</p>
        <p className="venue-hud-addr mono">
          <span className="mono">{venue.s}</span> ·{" "}
          <a className="outlink" href={`${EXPLORER_BASE}${venue.a}`} target="_blank" rel="noreferrer noopener">
            {venue.a} ↗
          </a>
        </p>
        <div className="venue-hud-coords" data-testid="venue-hud-coords">
          {render !== null ? (
            <>
              <p className="mono">
                band {render.band} · fold {render.f >= 0 ? "+" : ""}
                {(render.f * 180).toFixed(1)}° · |lat|/pole {render.ln.toFixed(3)} · {render.south ? "south" : "north"}
              </p>
              <p className="mono hint">
                legacy lon {render.lon.toFixed(1)}° lat {render.lat.toFixed(1)}°
              </p>
            </>
          ) : (
            <p className="hint">
              {error !== null && error !== undefined && error.length > 0
                ? `live coordinates unavailable: ${error.slice(0, 90)}`
                : "computing coordinates live (HECKE.Compliment)…"}
            </p>
          )}
          {sourceChip}
        </div>
        <p className="hint">
          {render !== null && render.blk > 0 ? (
            <>
              block <span className="mono">{render.blk}</span>
              {source === "live" ? " (from the creating receipt)" : ""}
            </>
          ) : source === "live" ? (
            "creation block unknown (live venue)"
          ) : (
            "block —"
          )}
        </p>
        <div className="venue-hud-actions">
          {variant === "map" && onOpenFull !== undefined && (
            <button className="btn btn-primary" onClick={onOpenFull} data-testid="venue-hud-open-full">
              OPEN FULL PANEL
            </button>
          )}
          {variant === "deck" && onSurfaceVenue !== undefined && (
            <button className="btn btn-primary" onClick={onSurfaceVenue} data-testid="venue-hud-open-bay">
              OPEN VENUE BAY
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
