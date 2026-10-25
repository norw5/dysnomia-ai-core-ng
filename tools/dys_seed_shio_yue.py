#!/usr/bin/env python3
"""Session-48 — SHIO + YUE census seed builders for the dysnomia-ai-core-ng package.

Inputs (READ-ONLY from the origin research repo — never written):
  factory_children.json   SHIOFactory children (blockscout internal creates, [chain])
  yue_addresses.json      the 93 verified YUEs (receipt-scan erratum set, [chain])
  sei_tx_zero_mints.json  SEI tx scan → YUE creation blocks

Live probes (Multicall3 aggregate3, RPC rotation, resumable):
  shio   name()+symbol() over all SHIOFactory children — every SHIO deploys
         "CHATLOG Shio"/"SHIO" from the factory template; the probe is the
         rename/anomaly census (renames recorded in the seed; uniformity
         recorded in _meta).
  yue    name()+symbol()+Origin() over the 93 YUEs (user-chosen names; the
         Origin read is the owner wallet).

Outputs (data/, CHECKSUMS-pinned after the run):
  shio_seed.json / .slim.json / .slim.json.gz
  yue_seed.json / .gz
Progress: harness/runs/ (never shipped in data/).
"""

import argparse
import gzip
import json
import sys
import time
import urllib.request
from pathlib import Path

NG = Path(__file__).resolve().parent.parent
DEFAULT_ORIGIN = Path.home() / "projects" / "atropa-terminal"
RPCS = [
    "https://rpc.pulsechain.com",
    "https://rpc-pulsechain.g4mm4.io",
    "https://rpc.pulsechainstats.com",
]
MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"
SEL_NAME = "0x06fdde03"
SEL_SYMBOL = "0x95d89b41"
SEL_ORIGIN = "0x" + "c11a4b47"  # keccak("Origin()")[:8] — runtime-asserted against the origin repo's keccak256
UA = {"Content-Type": "application/json", "User-Agent": "dysnomia-ng-seed"}

# keccak256("Origin()")[:8] — pinned here, recomputed from the origin repo's
# keccak256 on first use and asserted (the s34 lesson: never trust a guessed selector)
KECCAK_ORIGIN = None


def keccak_origin():
    global KECCAK_ORIGIN
    if KECCAK_ORIGIN is None:
        sys.path.insert(0, str(DEFAULT_ORIGIN))
        from tools.rpc import keccak256

        KECCAK_ORIGIN = "0x" + keccak256(b"Origin()").hex()[:8]
    return KECCAK_ORIGIN


class Rpc:
    def __init__(self):
        self.ri = 0

    def call(self, method, params, retries=8):
        payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        last = None
        for attempt in range(retries):
            url = RPCS[self.ri % len(RPCS)]
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


def multicall(rpc, calls, batch=300):
    """aggregate3 over Multicall3 — yields (address, ok, data) per call."""
    out = []
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
        payload = "0x82ad56cb" + head + "".join(bodies)
        result = rpc.call("eth_call", [{"to": MULTICALL3, "data": payload}, "latest"])
        raw = bytes.fromhex(result[2:])
        for j in range(n):
            ao = 64 + int.from_bytes(raw[64 + j * 32 : 96 + j * 32], "big")
            retlen = int.from_bytes(raw[ao + 32 : ao + 64], "big")
            ln = int.from_bytes(raw[ao + retlen : ao + retlen + 32], "big")
            out.append((chunk[j][0], raw[ao + retlen + 32 : ao + retlen + 32 + ln]))
        if (i // batch) % 6 == 0:
            print(f"  probed {min(i + batch, len(calls))}/{len(calls)}", flush=True)
    return out


def decode_string(b):
    if not isinstance(b, (bytes, bytearray)) or len(b) < 32:
        return ""
    off = int.from_bytes(b[0:32], "big")
    if off + 32 <= len(b):
        ln = int.from_bytes(b[off : off + 32], "big")
        if 0 < ln <= 4096 and off + 32 + ln <= len(b):
            return b[off + 32 : off + 32 + ln].decode("utf-8", "replace")
    return ""


def decode_address(b):
    if not isinstance(b, (bytes, bytearray)) or len(b) < 32:
        return ""
    return "0x" + b[12:32].hex()


def progress_path():
    p = NG / "harness" / "runs"
    p.mkdir(parents=True, exist_ok=True)
    return p


def save_progress(name, obj):
    (progress_path() / name).write_text(json.dumps(obj))


def load_progress(name):
    p = progress_path() / name
    if p.exists():
        return json.loads(p.read_text())
    return None


def cmd_shio(args):
    origin = Path(args.origin)
    fc = json.loads((origin / "data" / "dysnomia" / "factory_children.json").read_text())
    children_all = fc["SHIOFactory"]["children"]
    # blockscout attribution gaps: internal-create rows with no created-contract
    # address are unresolvable (same class the LAU seed cleaning drops)
    children = [c for c in children_all if c.get("contract")]
    dropped = len(children_all) - len(children)
    print(f"SHIOFactory children: {len(children_all)} (dropped {dropped} unresolvable; blocks {children[0]['block']}..{children[-1]['block']})")

    probed = {}
    if args.resume:
        prev = load_progress("shio_probe_progress.json")
        if prev:
            probed = prev.get("probed", {})
    todo = [c for c in children if c["contract"].lower() not in probed]
    print(f"to probe: {len(todo)}")
    rpc = Rpc()
    B = args.batch
    for i in range(0, len(todo), B):
        part = todo[i : i + B]
        calls = [(c["contract"], SEL_NAME) for c in part] + [(c["contract"], SEL_SYMBOL) for c in part]
        try:
            res = multicall(rpc, calls, batch=len(calls))
        except Exception as exc:  # noqa: BLE001 — skip batch, retry next run
            print(f"  batch at {i} failed ({exc}); retry next run")
            time.sleep(2)
            continue
        for j, c in enumerate(part):
            probed[c["contract"].lower()] = {
                "n": decode_string(res[j][1]),
                "s": decode_string(res[len(part) + j][1]),
            }
        if (i // B) % 8 == 0:
            save_progress("shio_probe_progress.json", {"probed": probed})
            print(f"  {min(i + B, len(todo))}/{len(todo)}", flush=True)
    save_progress("shio_probe_progress.json", {"probed": probed})

    rows = []
    renamed = 0
    # blockscout double-attribution: keep the EARLIEST block per address (the
    # LAU-seed cleaning rule — same address probed at different blocks)
    seen = {}
    for c in children:
        la = c["contract"].lower()
        if la in seen:
            if c["block"] < seen[la]["blk"]:
                seen[la]["blk"] = c["block"]
            continue
        seen[la] = {"a": la, "n": "", "s": "", "blk": c["block"]}
    duplicates = len(children) - len(seen)
    for la in sorted(seen, key=lambda k: seen[k]["blk"]):
        meta = probed.get(la, {})
        n, s = meta.get("n", ""), meta.get("s", "")
        if n and n != "CHATLOG Shio":
            renamed += 1
        rows.append({"a": la, "n": n, "s": s, "blk": seen[la]["blk"]})
    out = {
        "_meta": {
            "count": len(rows),
            "source": "origin factory_children.json (SHIOFactory, blockscout internal creates) + name/symbol multicall probe",
            "note": 'factory template deploys "CHATLOG Shio"/"SHIO" — n/s record renames (count in meta.renamed); channel identity is the Rod/Cone SHA pair, not a string label',
            "renamed": renamed,
            "probed": len(probed),
            "factory_children": len(children_all),
            "dropped_unresolvable": dropped,
            "duplicates_collapsed": duplicates,
        },
        "shios": rows,
    }
    data = NG / "data"
    (data / "shio_seed.json").write_text(json.dumps(out, ensure_ascii=False))
    slim = {
        "_meta": {k: out["_meta"][k] for k in ("count", "source", "note", "renamed")},
        "shios": [
            {"a": r["a"], "n": r["n"], "s": r["s"]}
            for r in rows
        ],
    }
    (data / "shio_seed.slim.json").write_text(json.dumps(slim, ensure_ascii=False))
    (data / "shio_seed.slim.json.gz").write_bytes(
        gzip.compress((data / "shio_seed.slim.json").read_bytes())
    )
    for f in ("shio_seed.json", "shio_seed.slim.json", "shio_seed.slim.json.gz"):
        print(f"{f}: {(data / f).stat().st_size:,} B")
    print(f"renamed (name != 'CHATLOG Shio'): {renamed}/{len(rows)}")


def cmd_yue(args):
    origin = Path(args.origin)
    yues = [a.lower() for a in json.loads((origin / "data" / "dysnomia" / "yue_addresses.json").read_text())]
    txs = json.loads((origin / "data" / "dysnomia" / "sei_tx_zero_mints.json").read_text())
    blk = {}
    for t in txs:
        nc = (t.get("new_contract") or "").lower()
        if nc in yues and nc not in blk:
            blk[nc] = t["block"]
    missing_blk = [a for a in yues if a not in blk]
    print(f"YUEs: {len(yues)}; creation blocks resolved: {len(blk)}; missing: {len(missing_blk)}")

    probed = {}
    if args.resume:
        prev = load_progress("yue_probe_progress.json")
        if prev:
            probed = prev.get("probed", {})
    todo = [a for a in yues if a not in probed]
    rpc = Rpc()
    sel_origin = keccak_origin()
    assert sel_origin == SEL_ORIGIN, f"keccak(Origin()) mismatch: {sel_origin}"
    if todo:
        calls = []
        for a in todo:
            calls += [(a, SEL_NAME), (a, SEL_SYMBOL), (a, sel_origin)]
        res = multicall(rpc, calls, batch=len(calls))
        for j, a in enumerate(todo):
            probed[a] = {
                "n": decode_string(res[3 * j][1]),
                "s": decode_string(res[3 * j + 1][1]),
                "o": decode_address(res[3 * j + 2][1]),
            }
        save_progress("yue_probe_progress.json", {"probed": probed})

    rows = []
    for a in yues:
        meta = probed.get(a, {})
        rows.append({"a": a, "n": meta.get("n", ""), "s": meta.get("s", ""), "o": meta.get("o", ""), "blk": blk.get(a)})
    rows.sort(key=lambda r: r["blk"] or 0)
    out = {
        "_meta": {
            "count": len(rows),
            "source": "origin yue_addresses.json (receipt-scan erratum census, Type()==YUE verified) + name/symbol/Origin multicall probe; blocks from sei_tx_zero_mints.json",
            "note": "o = Origin() at probe time (owner wallet; ChangeOrigin can move it); n/s are user-chosen and rename via SEI.Start/Bar",
        },
        "yues": rows,
    }
    data = NG / "data"
    (data / "yue_seed.json").write_text(json.dumps(out, ensure_ascii=False))
    (data / "yue_seed.json.gz").write_bytes(gzip.compress((data / "yue_seed.json").read_bytes()))
    for f in ("yue_seed.json", "yue_seed.json.gz"):
        print(f"{f}: {(data / f).stat().st_size:,} B")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--origin", default=str(DEFAULT_ORIGIN), help="the origin research repo (read-only inputs)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("shio")
    p.add_argument("--batch", type=int, default=300)
    p.add_argument("--resume", action="store_true")
    p.set_defaults(fn=cmd_shio)
    p = sub.add_parser("yue")
    p.add_argument("--resume", action="store_true")
    p.set_defaults(fn=cmd_yue)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
