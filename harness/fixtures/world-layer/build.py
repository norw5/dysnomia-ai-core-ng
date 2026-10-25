#!/usr/bin/env python3
"""Direct pinned-solc compile of the never-deployed layer (session 58).

forge build spun nondeterministically in this box (first run 90s, later runs
98% CPU forever, SIGTERM-immune) — the fixture now drives the svm-managed
solc binary directly with EXACTLY the pinned toolchain (contracts/solc-config.json:
0.8.21 / shanghai / optimizer 200), no forge in the path.

Compiles the layer entry files (their import closure pulls the base + assets
+ interfaces) and writes pins/<name>.{creation,runtime}.hex. Byte-deterministic:
same sources + same solc + same flags => same bytes; sync_sources.py's manifest
guards the source side, these pins guard the artifact side.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

FIXTURE = Path(__file__).resolve().parent
SOLC = Path.home() / ".local" / "share" / "svm" / "0.8.21" / "solc-0.8.21"

# entry file -> {artifact contract name: pin name}
ENTRIES = {
    "src/domain/world.sol": "world",
    "src/domain/world_fixed.sol": "worldfixed",
    "src/domain/dan/04_war.sol": "war",
    "src/domain/dan/war_fixed.sol": "warfixed",
    "src/domain/soeng/07_gwat.sol": "gwat",
    "src/lib/encrypt.sol": "encrypt",
}
# VITUSFIXED/H2OFIXED compile inside the fixed closures; solc emits them from
# the same invocation — map their artifact names explicitly
EXTRA_ARTIFACTS = {"VITUS": "vitus", "H2O": "h2o", "VITUSFIXED": "vitusfixed", "H2OFIXED": "h2ofixed"}


def main() -> int:
    if not SOLC.exists():
        print(f"solc missing: {SOLC}", file=sys.stderr)
        return 1
    out_dir = FIXTURE / "out-direct"
    out_dir.mkdir(exist_ok=True)
    cmd = [
        str(SOLC),
        "--evm-version", "shanghai",
        "--optimize", "--optimize-runs", "200",
        "--bin", "--bin-runtime", "--overwrite",
        "--output-dir", str(out_dir),
    ] + [str(FIXTURE / rel) for rel in ENTRIES]
    r = subprocess.run(cmd, cwd=FIXTURE, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-2000:], file=sys.stderr)
        print(r.stderr[-2000:], file=sys.stderr)
        return 1

    pins = FIXTURE / "pins"
    pins.mkdir(exist_ok=True)
    mapping = {name: pin for name, pin in
               [(Path(rel).stem, pin) for rel, pin in ENTRIES.items()]}
    # solc artifact file names carry the contract name (World.bin etc.)
    file_map = {
        "WORLD": "world", "WORLDFIXED": "worldfixed", "WAR": "war", "WARFIXED": "warfixed",
        "GWAT": "gwat", "ENCRYPT": "encrypt", **EXTRA_ARTIFACTS,
    }
    for art, pin in file_map.items():
        created = (out_dir / f"{art}.bin").read_text().strip()
        runtime = (out_dir / f"{art}.bin-runtime").read_text().strip()
        if not created or not runtime:
            print(f"missing artifact bytes for {art}", file=sys.stderr)
            return 1
        (pins / f"{pin}.creation.hex").write_text(created.removeprefix("0x") + "\n")
        (pins / f"{pin}.runtime.hex").write_text(runtime.removeprefix("0x") + "\n")
        print(f"{pin}: creation {len(created)//2}B runtime {len(runtime)//2}B")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
