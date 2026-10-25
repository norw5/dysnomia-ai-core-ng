#!/usr/bin/env python3
"""Sync + verify the recovered source tree into this fixture (session 58).

The never-deployed layer imports `../addresses.sol`, which the repo tree does
NOT ship (the dev's private env file). This fixture compiles the tree VERBATIM
plus a fixture-owned addresses.sol (constants pinned from config/addresses.json
+ kb/dev anchors) and the world_fixed variant (the one-line cauda patch).

Copy direction: contracts/src/**/*.sol -> src/** (layout preserved, so every
relative import resolves unchanged). Fixture-owned files (addresses.sol at the
fixture root, src/domain/world_fixed.sol) are never written by a sync and must
not exist in the source tree.

Manifest discipline: sources.manifest pins sha256 per copied file. Default
mode VERIFIES (a drifted tree fails loudly — never a silent recompile);
--resync rewrites the manifest after a deliberate tree change, --sync copies
without manifest questions (first setup / after resync).

After ANY --resync: run build.py to regenerate pins/ (solc at the pinned
config), then re-run harness/anvil_flows_set3.py (it asserts the deployed
runtime matches pins/ byte-for-byte). Do NOT compile inside the suite —
solc at opt-200 on this closure can run long and is SIGTERM-immune in this
box (session-58 gotcha); the manifest + pins are the drift guards.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

FIXTURE = Path(__file__).resolve().parent
REPO = FIXTURE.parents[2]
SRC = REPO / "contracts" / "src"
MANIFEST = FIXTURE / "sources.manifest"

# fixture-owned files living under src/ — the sync refuses to touch these
FIXTURE_OWNED = {"addresses.sol", "domain/world_fixed.sol"}

# excluded from the copy: NYM (pre-move import layout, incompatible with the
# deployed CHO — HARNESS.md §5 "document, don't force"; out of the SIM arc)
EXCLUDE = {"domain/old/nym.sol"}


def source_files() -> list[Path]:
    return sorted(
        p for p in SRC.rglob("*.sol")
        if p.relative_to(SRC).as_posix() not in EXCLUDE
    )


def manifest_lines(files: list[tuple[str, bytes]]) -> list[str]:
    return [
        f"{hashlib.sha256(data).hexdigest()}  {rel}"
        for rel, data in files
    ]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--resync", action="store_true", help="rewrite the manifest from the current tree")
    ap.add_argument("--sync", action="store_true", help="copy now (no manifest questions)")
    args = ap.parse_args()

    files = source_files()
    if not files:
        print("no sources found under contracts/src", file=sys.stderr)
        return 1
    for p in files:
        rel = p.relative_to(SRC).as_posix()
        if rel in FIXTURE_OWNED:
            print(f"source tree must not contain fixture-owned {rel}", file=sys.stderr)
            return 1

    current: list[tuple[str, bytes]] = []
    for p in files:
        current.append((p.relative_to(SRC).as_posix(), p.read_bytes()))

    if args.resync:
        MANIFEST.write_text("\n".join(manifest_lines(current)) + "\n")
        print(f"manifest rewritten: {len(current)} files")

    if args.resync or args.sync:
        for rel, data in current:
            dst = FIXTURE / "src" / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(data)
        print(f"copied {len(current)} files -> src/")
        return 0

    # default: verify copy + manifest against the tree
    stale: list[str] = []
    for rel, data in current:
        dst = FIXTURE / "src" / rel
        if not dst.exists() or dst.read_bytes() != data:
            stale.append(rel)
            continue
    if stale:
        print("copied tree is stale (run: python3 sync_sources.py --sync):", file=sys.stderr)
        for rel in stale:
            print(f"  {rel}", file=sys.stderr)
        return 1

    if not MANIFEST.exists():
        print("sources.manifest missing — confirm the tree, then: sync_sources.py --resync --sync", file=sys.stderr)
        return 1
    want = dict(
        line.split("  ", 1)[::-1]
        for line in MANIFEST.read_text().splitlines()
        if line.strip()
    )
    have = {rel: hashlib.sha256(data).hexdigest() for rel, data in current}
    if want != have:
        missing = sorted(set(want) - set(have))
        added = sorted(set(have) - set(want))
        changed = sorted(rel for rel in set(want) & set(have) if want[rel] != have[rel])
        print("source tree DRIFTED from sources.manifest — deliberate change? then --resync --sync", file=sys.stderr)
        for rel in changed:
            print(f"  changed: {rel}", file=sys.stderr)
        for rel in missing:
            print(f"  removed: {rel}", file=sys.stderr)
        for rel in added:
            print(f"  added:   {rel}", file=sys.stderr)
        return 1

    print(f"verified: {len(current)} files match sources.manifest + src/ copy")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
