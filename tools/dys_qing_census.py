#!/usr/bin/env python3
"""dys_qing_census.py — the QING census regenerator (session-70).

THE ONE census the chain can enumerate: MAP emits
`NewQing(address Qing, address Integrative, uint256 Waat)` (args NOT
indexed — data words; domain/map.sol:73), so unlike LAU/SHIO/YUE (whose
factories emit nothing — origin blockscout exports are their only source,
owner-run) the venue census regenerates from THIS repo against any
PulseChain RPC.

Walk: eth_getLogs over MAP from the current seed's newest block + 1 to
head (paged, range-cap shrinking — the chat-tail pager discipline). Every
find is a REAL venue by construction (failed creates never emit).

Per new venue: name()+symbol() probes + HECKE.Compliment(waat) (selector
read from abi/index.json — never hand-derived, the s34 lesson) → the exact
dys_venue_render.py math (band / south flip / lon_norm / lat2) → rows
appended to:
  data/venue_seed.json + .slim.json + .slim.json.gz
  data/venue_atlas_s32.json (raw ints, the render tool's input)

Then run `tools/dys_venue_render.py` (the render seed self-checks the
whole join). The in-app sync engine (app/src/chain/sync.ts) walks the SAME
event between regens — this tool is the bulk refresh, the engine is the
tail.

Usage: python3 tools/dys_qing_census.py [--rpc URL] [--dry-run]
"""

import argparse
import gzip
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

NG = Path(__file__).resolve().parent.parent
SEED = NG / "data" / "venue_seed.json"
SLIM = NG / "data" / "venue_seed.slim.json"
SLIM_GZ = NG / "data" / "venue_seed.slim.json.gz"
ATLAS = NG / "data" / "venue_atlas_s32.json"
ABI_INDEX = NG / "abi" / "index.json"

RPCS = [
    "https://rpc.pulsechain.com",
    "https://rpc-pulsechain.g4mm4.io",
    "https://rpc.pulsechainstats.com",
]
MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"
SEL_NAME = "0x06fdde03"
SEL_SYMBOL = "0x95d89b41"
UA = {"Content-Type": "application/json", "User-Agent": "dysnomia-ng-seed"}

# pinned in app/src/chain/venueDeed.ts (NEW_QING_TOPIC); asserted against the
# origin repo's keccak when available (the s34 lesson: canonicalize first)
NEW_QING_TOPIC = "0x692bc76be0a4b0d71d90e36ee97b1f3c4141095ea3c22b01b9f620da2e4b5e2e"
NEW_QING_SIG = b"NewQing(address,address,uint256)"


def assert_topic() -> None:
    origin = Path.home() / "projects" / "atropa-terminal"
    if not (origin / "tools" / "rpc.py").exists():
        print(f"note: origin repo not found — topic pin stands on venueDeed.ts ({NEW_QING_TOPIC})")
        return
    sys.path.insert(0, str(origin))
    from tools.rpc import keccak256  # type: ignore

    computed = "0x" + keccak256(NEW_QING_SIG).hex()
    if computed != NEW_QING_TOPIC:
        sys.exit(f"NewQing topic drift: pinned {NEW_QING_TOPIC}, keccak says {computed}")
    print(f"topic pin verified against origin keccak: {NEW_QING_TOPIC}")


def compliment_selector() -> str:
    """read the selector from the GENERATED abi index (never hand-derive)"""
    idx = json.loads(ABI_INDEX.read_text())
    sels = idx["Hecke"]["selectors"]
    for sel, meta in sels.items():
        if meta.get("name") == "Compliment":
            return sel if sel.startswith("0x") else "0x" + sel
    raise SystemExit("Hecke.Compliment not found in abi/index.json")


class Rpc:
    def __init__(self, rpcs):
        self.rpcs = rpcs
        self.ri = 0

    def call(self, method, params, retries=8):
        payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        last = None
        for attempt in range(retries):
            url = self.rpcs[self.ri % len(self.rpcs)]
            self.ri += 1
            try:
                req = urllib.request.Request(url, payload, UA)
                raw = urllib.request.urlopen(req, timeout=60).read()
                out = json.loads(raw)
                if "error" in out:
                    last = out["error"]
                    time.sleep(0.5 * (attempt + 1))
                    continue
                return out["result"]
            except Exception as exc:  # noqa: BLE001 — rotate + retry is the standing gotcha
                last = str(exc)
                time.sleep(0.5 * (attempt + 1))
        raise RuntimeError(f"rpc {method} failed: {last}")


def looks_like_range_cap(msg) -> bool:
    s = str(msg).lower()
    return any(k in s for k in ("limit", "range", "too many", "result window", "exceed", "10000", "query returned"))


def walk_new_qing(rpc, from_block, to_block):
    """paged eth_getLogs over MAP's NewQing — yields raw log dicts."""
    cursor = from_block
    attempts = [5000, 1000, 200]
    while cursor <= to_block:
        got = None
        span = 0
        for size in attempts:
            to = min(cursor + size - 1, to_block)
            try:
                got = rpc.call(
                    "eth_getLogs",
                    [{
                        "address": map_address,
                        "topics": [NEW_QING_TOPIC],
                        "fromBlock": hex(cursor),
                        "toBlock": hex(to),
                    }],
                )
                span = to - cursor + 1
                break
            except Exception as exc:  # noqa: BLE001
                if size is not attempts[-1] and looks_like_range_cap(exc):
                    continue
                raise
        if got is None or span == 0:
            raise SystemExit("getLogs page failed at every size")
        for log in got:
            yield log
        cursor += span


def word(data, i):
    body = data[2:]
    return int(body[i * 64 : (i + 1) * 64], 16)


def decode_new_qing(log):
    qing = "0x" + log["data"][2 + 24 : 2 + 64]
    asset = "0x" + log["data"][2 + 88 : 2 + 128]
    waat = word(log["data"], 2)
    if int(qing, 16) == 0:
        return None
    return qing, asset, waat


def aggregate3(rpc, calls, batch=300):
    """aggregate3 over Multicall3 (the dys_seed_shio_yue encoding, verbatim
    discipline) — returns [(ok, returndata-hex)] per call; a failing batch
    falls back to individual eth_calls so one bad probe never kills the run."""
    sel = "0x82ad56cb"
    results: list[tuple[bool, str]] = []
    for i in range(0, len(calls), batch):
        chunk = calls[i : i + batch]
        n = len(chunk)
        bodies = []
        for target, data in chunk:
            d = data[2:].lower()
            pad = (64 - len(d) % 64) % 64
            bodies.append(
                f"{int(target, 16):064x}{0:064x}{96:064x}{len(d) // 2:064x}" + d + "0" * pad
            )
        head = f"{32:064x}{n:064x}"
        off = n * 32
        for b in bodies:
            head += f"{off:064x}"
            off += len(b) // 2
        payload = sel + head + "".join(bodies)
        try:
            result = rpc.call("eth_call", [{"to": MULTICALL3, "data": payload}, "latest"])
            raw = bytes.fromhex(result[2:])
            for j in range(n):
                ao = 64 + int.from_bytes(raw[64 + j * 32 : 96 + j * 32], "big")
                retlen = int.from_bytes(raw[ao + 32 : ao + 64], "big")
                ln = int.from_bytes(raw[ao + retlen : ao + retlen + 32], "big")
                data_hex = "0x" + raw[ao + retlen + 32 : ao + retlen + 32 + ln].hex()
                results.append((True, data_hex))
        except Exception:  # noqa: BLE001 — degrade to per-call probes
            for target, data in chunk:
                try:
                    ret = rpc.call("eth_call", [{"to": target, "data": data}, "latest"])
                    results.append((True, ret))
                except Exception:  # noqa: BLE001
                    results.append((False, "0x"))
    return results


def decode_string_returndata(data):
    """decode a solidity `string` return (len + bytes) — None on failure."""
    try:
        body = data[2:]
        if len(body) < 128:
            return None
        off = int(body[0:64], 16)
        if off != 32:
            return None
        n = int(body[64:128], 16)
        if n > 512:
            return None
        raw = bytes.fromhex(body[128 : 128 + n * 2])
        return raw.decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return None


def meridian_of(waat, meridians):
    for i, m in enumerate(meridians):
        if m >= waat:
            return i
    return 89


def main() -> int:
    global map_address

    ap = argparse.ArgumentParser()
    ap.add_argument("--rpc", action="append", default=[], help="extra RPC url (repeatable)")
    ap.add_argument("--dry-run", action="store_true", help="walk + probe, write nothing")
    args = ap.parse_args()

    assert_topic()

    cfg = json.loads((NG / "config" / "addresses.json").read_text())
    map_address = cfg["contracts"]["MAP"]
    hecke = cfg["contracts"]["HECKE"]
    comp_sel = compliment_selector()
    print(f"MAP {map_address} · HECKE {hecke} · Compliment selector {comp_sel}")

    rpc = Rpc(args.rpc if args.rpc else RPCS)

    seed = json.loads(SEED.read_text())
    atlas = json.loads(ATLAS.read_text())
    meridians = [int(m) for m in atlas["_meta"]["meridians"]]
    mer89 = meridians[89]
    pole = meridians[88] // 333

    # ---- session-73: the asset backfill ----
    # The atlas rows carry `integrative` (the NewQing-decoded wrapped asset)
    # for EVERY venue; the compact seed rows never did. The seed IS the app's
    # asset→QING index now (state/atlas.ts qingForAsset), so backfill it from
    # the atlas locally — no RPC needed.
    integrative = {r["qing"].lower(): r["integrative"].lower() for r in atlas["venues"] if "integrative" in r}
    backfilled = 0
    for row in seed["venues"]:
        if "asset" not in row:
            a = integrative.get(row["a"].lower())
            if a is None:
                sys.exit(f"venue {row['a']} has no integrative in the atlas — cannot backfill asset (regen the atlas from origin inputs)")
            row["asset"] = a
            backfilled += 1
    if backfilled:
        print(f"asset backfill: {backfilled} seed rows gained `asset` (the atlas join)")

    seed_floor = max(r["blk"] for r in seed["venues"])
    head = int(rpc.call("eth_blockNumber", []), 16)
    print(f"seed floor {seed_floor} · head {head} · walking {head - seed_floor} blocks")

    known = {r["a"].lower() for r in seed["venues"]}
    finds = []
    for log in walk_new_qing(rpc, seed_floor + 1, head):
        dec = decode_new_qing(log)
        if dec is None:
            continue
        qing, asset, waat = dec
        a = qing.lower()
        if a in known:
            continue
        known.add(a)
        finds.append({"qing": a, "integrative": asset.lower(), "waat": waat, "block": int(log["blockNumber"], 16), "tx": log["transactionHash"]})
    print(f"new venues found: {len(finds)}")

    if finds:
        # one aggregate3 pass: name+symbol per venue + Compliment per venue
        calls = []
        for f in finds:
            calls.append((f["qing"], SEL_NAME))
            calls.append((f["qing"], SEL_SYMBOL))
            calls.append((hecke, comp_sel + hex(f["waat"])[2:].rjust(64, "0")))
        rets = aggregate3(rpc, calls)
        for i, f in enumerate(finds):
            name_ok, name_ret = rets[i * 3]
            sym_ok, sym_ret = rets[i * 3 + 1]
            comp_ok, comp_ret = rets[i * 3 + 2]
            f["n"] = decode_string_returndata(name_ret) if name_ok else ""
            f["s"] = decode_string_returndata(sym_ret) if sym_ok else ""
            if not comp_ok or len(comp_ret) < 2 + 128:
                sys.exit(f"venue {f['qing']}: HECKE.Compliment failed — coords are required, never phantom")
            raw_lon = int(comp_ret[2:66], 16)
            raw_lat = int(comp_ret[66:130], 16)
            # two's-complement int256
            if raw_lon >= 1 << 255:
                raw_lon -= 1 << 256
            if raw_lat >= 1 << 255:
                raw_lat -= 1 << 256
            f["lon"] = raw_lon
            f["lat"] = raw_lat

        # the render tool's exact math → the atlas + seed row fields
        for f in finds:
            waat = f["waat"]
            mer = meridian_of(waat, meridians)
            flipped = mer == 89 and f["lat"] > 0
            eff_waat = mer89 - waat if flipped else waat
            eff_mer = meridian_of(eff_waat, meridians) if flipped else mer
            band_start = meridians[eff_mer - 1] if eff_mer > 0 else 0
            band_end = meridians[eff_mer]
            band_width = band_end - band_start
            half = band_width // 2
            frac = max(-1.0, min(1.0, f["lon"] / half)) if half else 0.0
            f["band"] = eff_mer
            f["south"] = flipped
            f["lon_norm"] = frac
            f["band_half_width"] = half

    if args.dry_run:
        for f in finds:
            print(json.dumps({k: (str(v) if isinstance(v, int) else v) for k, v in f.items()}))
        print("dry-run: nothing written")
        return 0

    if not finds and not backfilled:
        print("seed already current — nothing to write")
        return 0

    # ---- write venue_seed.json (+ slim + gz) ----
    for f in finds:
        seed["venues"].append({"a": f["qing"], "n": f["n"], "s": f["s"], "lat": f["lon_norm"], "lat2": f["lat"], "band": f["band"], "blk": f["block"], "south": f["south"], "asset": f["integrative"]})
        atlas["venues"].append({"qing": f["qing"], "integrative": f["integrative"], "waat": f["waat"], "waat_str": str(f["waat"]), "longitude": f["lon"], "latitude": f["lat"], "band": f["band"], "south_flip": f["south"], "band_half_width": f["band_half_width"], "lon_norm": f["lon_norm"], "block": f["block"], "taken": False})
    seed["_meta"] = {
        "count": len(seed["venues"]),
        "source": "s32 atlas + name/symbol probe + MAP.NewQing walk (tools/dys_qing_census.py)",
        "note": f"lat=lon_norm (folded -1..1), lat2=raw integer latitude, asset=the NewQing Integrative (the asset→QING index, session-73) — regen {datetime.now(timezone.utc).isoformat(timespec='seconds')} through block {head}",
    }
    slim = {"_meta": dict(seed["_meta"]), "venues": [{k: r[k] for k in ("a", "n", "s", "lat", "band", "blk", "asset")} for r in seed["venues"]]}
    SEED.write_text(json.dumps(seed, separators=(",", ":")) + "\n")
    SLIM.write_text(json.dumps(slim, separators=(",", ":")) + "\n")
    SLIM_GZ.write_bytes(gzip.compress(json.dumps(slim, separators=(",", ":")).encode()))
    ATLAS.write_text(json.dumps(atlas, separators=(",", ":")) + "\n")
    print(f"venue_seed.json: {len(seed['venues'])} venues (+{len(finds)}) through block {head}")

    print("NEXT: python3 tools/dys_venue_render.py  (the render seed self-checks the join)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
