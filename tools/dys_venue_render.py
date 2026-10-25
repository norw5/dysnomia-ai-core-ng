#!/usr/bin/env python3
"""dys_venue_render.py — MAP render-seed generator (session-43; canonical
coords session-48).

Reads the two shipped s32 artifacts and emits the canvas render seed:
  in : data/venue_seed.json      (names/symbols — the onchain name probe)
  in : data/venue_atlas_s32.json (raw integer HECKE coords + south flag)
  out: app/src/data/venue_render.json

Per row: a (address) n (name) s (symbol) f (folded lon_norm -1..1) band blk
south sys w (waat decimal string) lon lat (the legacy equirectangular degrees)
ln (CANONICAL |latitude|/pole, 0..1 — kb §9) asset (the wrapped asset — the
atlas Integrative; the app's asset→QING index, session-73).

Two framings ship (kb §9, the session-32 atlas findings):
  LEGACY  lon = meridian*4 + 2*frac (wrapped), lat = latitude/pole*90 — the
          predecessor QingMap globe. Band-as-longitude bunches the venues
          along a diagonal (latitude is anti-monotonic in band by
          construction) — kept as a labeled toggle, not the default.
  CANON   lon = frac*180, lat = ±ln*90 (south negative, band-89 flips north)
          — the disc unrolled onto the globe; the contracts' native space
          (folded signed longitude + linear latitude) with the uniform fill
          the onchain distribution actually has.
The latitude scale is EXACT here: pole = Meridians[88]//333 computed from the
shipped table (the predecessor's 1.2e72 approximation compressed latitudes
~1.4% — the audit's defect (a)).

The generator recomputes every derived value from the RAW atlas ints and
cross-checks against both the atlas `lon_norm` and the seed row — mismatch
aborts, so a stale or hand-edited upstream artifact cannot silently travel.

The output is GENERATED — never hand-edit it (the dys_facts_json.py rule).
`sys` marks the first QING (Phobos) from config/addresses.json — never
hand-listed.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "data" / "venue_seed.json"
ATLAS = ROOT / "data" / "venue_atlas_s32.json"
CONFIG = ROOT / "config" / "addresses.json"
OUT = ROOT / "app" / "src" / "data" / "venue_render.json"


def load(path: Path):
    with path.open() as fh:
        return json.load(fh)


def main() -> int:
    seed = load(SEED)
    atlas = load(ATLAS)
    cfg = load(CONFIG)

    meridians = [int(m) for m in atlas["_meta"]["meridians"]]
    if len(meridians) != 90:
        sys.exit(f"atlas meridians table must hold 90 entries, got {len(meridians)}")
    mer89 = meridians[89]
    # kb §9: the EXACT pole scale (the predecessor's 1.2e72 compressed ~1.4%)
    pole = meridians[88] // 333

    phobos = cfg["contracts"]["PhobosQING"].lower()

    def meridian_of(waat: int) -> int:
        for i, m in enumerate(meridians):
            if m >= waat:
                return i
        return 89

    seed_rows = {r["a"].lower(): r for r in seed["venues"]}
    if len(seed_rows) != len(seed["venues"]):
        sys.exit("venue_seed.json has duplicate addresses")

    out_rows = []
    for row in atlas["venues"]:
        a = row["qing"].lower()
        srow = seed_rows.get(a)
        if srow is None:
            sys.exit(f"atlas venue missing from name seed: {a}")

        waat = int(row["waat_str"])
        raw_lat = int(row["latitude"])
        raw_lon = int(row["longitude"])

        mer = meridian_of(waat)
        flipped = mer == 89 and raw_lat > 0
        eff_waat = mer89 - waat if flipped else waat
        eff_mer = meridian_of(eff_waat) if flipped else mer
        band_start = meridians[eff_mer - 1] if eff_mer > 0 else 0
        band_end = meridians[eff_mer]
        band_width = band_end - band_start

        # s32 convention (atlas-verified 917/917): the fold fraction is
        # longitude / band_half_width for BOTH flip states; the flip only
        # mirrors the latitude. (The old QingMap's posInBand formula for
        # flipped rows shifts venues -2 degrees — a render quirk, not truth.)
        frac = raw_lon / (band_width // 2)
        frac = max(-1.0, min(1.0, frac))

        # cross-check: recomputed fraction vs the atlas lon_norm vs the seed fold
        if abs(frac - row["lon_norm"]) > 1e-12:
            sys.exit(f"lon fraction drift vs atlas for {a}: {frac} != {row['lon_norm']}")
        if abs(frac - srow["lat"]) > 1e-12:
            sys.exit(f"lon fraction drift vs seed for {a}: {frac} != {srow['lat']}")
        if eff_mer != row["band"] or eff_mer != srow["band"]:
            sys.exit(f"band drift for {a}: computed {eff_mer}, atlas {row['band']}, seed {srow['band']}")
        if flipped != row["south_flip"] or flipped != srow.get("south", flipped):
            sys.exit(f"south-flag drift for {a}")

        lon_deg = eff_mer * 4 + frac * 2
        lon_deg = ((lon_deg % 360.0) + 360.0) % 360.0
        if lon_deg > 180:
            lon_deg -= 360

        lat_deg = raw_lat / pole * 90
        if flipped:
            lat_deg = -lat_deg
        lat_deg = max(-90.0, min(90.0, lat_deg))
        if not (abs(lat_deg) <= 90 and -180 <= lon_deg <= 180):
            sys.exit(f"out-of-range degrees for {a}: {lat_deg}, {lon_deg}")

        # CANON (kb §9): |latitude|/pole linear — the uniform-fill coordinate
        # the onchain distribution actually has; the flip carries the sign
        lat_norm = min(1.0, abs(raw_lat) / pole)

        out_rows.append(
            {
                "a": a,
                "n": srow["n"],
                "s": srow["s"],
                "f": round(frac, 12),
                "band": eff_mer,
                "blk": row["block"],
                "south": flipped,
                "sys": a == phobos,
                "w": row["waat_str"],
                "lon": round(lon_deg, 6),
                "lat": round(lat_deg, 6),
                "ln": round(lat_norm, 12),
                # session-73: the wrapped asset (the atlas Integrative —
                # the app's asset→QING index rides the render seed)
                "asset": row.get("integrative", "").lower() or srow.get("asset", ""),
            }
        )

    if len(out_rows) != len(seed["venues"]):
        sys.exit(f"expected {len(seed['venues'])} venues (the name seed), got {len(out_rows)}")
    if len({r["a"] for r in out_rows}) != len(out_rows):
        sys.exit("duplicate addresses in output")
    seen = {r["a"] for r in out_rows}
    for a in seed_rows:
        if a not in seen:
            sys.exit(f"name-seed venue missing from atlas: {a}")

    doc = {
        "_meta": {
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "data/venue_seed.json + data/venue_atlas_s32.json (s32-exact); CANON = fold-fraction*180 lon + ±|lat|/pole*90 lat (kb §9, exact pole = Meridians[88]//333); LEGACY lon/lat = predecessor equirectangular framing (band*4+2*frac — the diagonal-bunching framing, kept as a toggle)",
            "count": len(out_rows),
            "note": "GENERATED by tools/dys_venue_render.py — never hand-edit. f = folded band fraction (-1..1); ln = |latitude|/pole (0..1, kb §9 canonical); lon/lat = legacy equirect degrees; sys marks the first QING (config/addresses.json); asset = the wrapped asset (the NewQing Integrative — the app's asset→QING index, session-73). meridians + pole ship verbatim from the atlas so the app can LIVE-compute coords for venues created after this seed (HECKE.Compliment reads + this exact math — state/atlas.ts heckeCoords mirrors it).",
            # session-67: the meridian table ships VERBATIM from the atlas meta —
            # the app's live-venue synthesis (HECKE.Compliment → RenderRow) needs
            # it; pole = Meridians[88]//333 (kb §9, exact). STRINGS, not JSON
            # numbers: these are ~1e72 ints and JS JSON.parse silently loses
            # precision past 2^53 (the w/pole precedent)
            "meridians": [str(m) for m in meridians],
            "pole": str(pole),
        },
        "venues": out_rows,
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    kb = (OUT.stat().st_size + 1023) // 1024
    print(f"venue_render.json: {len(out_rows)} venues, {kb} KiB -> {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
