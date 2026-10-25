#!/usr/bin/env python3
"""Generate app/src/data/contract-facts.json from the GENERATED sources.

Inputs (all generated or config, never hand-transcribed):
  - abi/index.json          (solc-derived selectors + mutability)
  - kb/contract-facts.md    (fn_tables-derived gates/meter/reverts — partial
                             coverage is real: some perimeter contracts have
                             no fn_tables section; those carry gate: null)
  - config/addresses.json   (the perimeter single-source + abiAliases)

Output is consumed by the app's tx gate (method-risk classes) and STUDIO
(curated facts panel). Regenerate with:
    python3 tools/dys_facts_json.py
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "src" / "data" / "contract-facts.json"

MD_SECTION = re.compile(r"^### (\S+)(.*)$")
MD_TABLE_ROW = re.compile(r"^\| `([^`]+)` \| ([^|]*) \| ([^|]*) \| ([^|]*) \|$")
ADDR_IN_HEADING = re.compile(r"`(0x[0-9a-fA-F]{40})`")
SIG_NOISE = re.compile(r"\s+(memory|calldata|storage)")


def parse_gate(cell: str) -> str:
    g = cell.strip()
    return g if g else "public"


def parse_metered(cell: str) -> bool:
    return "yes" in cell.strip().lower()


def parse_reverts(cell: str) -> list[str]:
    v = cell.strip()
    if not v:
        return []
    return [p.strip() for p in v.split(",") if p.strip()]


def parse_markdown(path: Path) -> dict[str, dict]:
    """contract name -> {address?, functions: {key: {gate, metered, reverts}}}

    key = `name/argcount` — fn_tables sigs use source type names (LAU, Bao, …)
    while abi/index.json uses ABI types (address, tuple, …), so exact sig
    reconstruction is impossible; name+arity is unambiguous for this corpus
    (overloads differ in arity — e.g. VOID.Alias).
    """
    out: dict[str, dict] = {}
    current: dict | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        m = MD_SECTION.match(line)
        if m:
            name, rest = m.group(1), m.group(2)
            am = ADDR_IN_HEADING.search(rest)
            current = {
                "address": am.group(1).lower() if am else None,
                "functions": {},
            }
            out[name] = current
            continue
        if current is None:
            continue
        rm = MD_TABLE_ROW.match(line)
        if rm:
            sig = rm.group(1)
            fn = sig.split("(")[0]
            types = sig[sig.index("(") + 1 : sig.rindex(")")]
            types = SIG_NOISE.sub("", types)
            arity = len([t for t in types.split(",") if t.strip()])
            current["functions"][f"{fn}/{arity}"] = {
                "gate": parse_gate(rm.group(2)),
                "metered": parse_metered(rm.group(3)),
                "reverts": parse_reverts(rm.group(4)),
            }
    return out


def main() -> int:
    index = json.loads((ROOT / "abi" / "index.json").read_text(encoding="utf-8"))
    addr_cfg = json.loads((ROOT / "config" / "addresses.json").read_text(encoding="utf-8"))
    md = parse_markdown(ROOT / "kb" / "contract-facts.md")
    perimeter: dict[str, str] = addr_cfg["contracts"]
    aliases: dict[str, str] = addr_cfg.get("abiAliases", {})

    # every index-live contract must be reachable through the perimeter
    index_live = {n for n, e in index.items() if e.get("address")}
    perimeter_addrs = {a.lower() for a in perimeter.values()}
    for n in index_live:
        if index[n]["address"].lower() not in perimeter_addrs:
            print(f"index-live {n} ({index[n]['address']}) missing from perimeter", file=sys.stderr)
            return 1

    contracts: dict[str, dict] = {}
    covered: set[str] = set()
    skipped: list[str] = []
    for pname, paddr in sorted(perimeter.items()):
        source = aliases.get(pname)
        if source is None:
            # same-name match against the index (case-sensitive first, then case-insensitive)
            if pname in index:
                source = pname
            else:
                ci = [n for n in index if n.lower() == pname.lower()]
                source = ci[0] if len(ci) == 1 else None
        if source is None or source not in index:
            skipped.append(f"{pname} (no abi/index entry)")
            continue
        entry = index[source]
        facts = md.get(source)
        if facts and facts.get("address") and entry.get("address") and facts["address"] != entry["address"].lower():
            print(f"address mismatch for {source}: md {facts['address']} vs index {entry['address']}", file=sys.stderr)
            return 1
        fns: dict[str, dict] = {}
        for sel, info in entry["selectors"].items():
            sig = f"{info['name']}({info['types']})"
            arity = len([t for t in info["types"].split(",") if t.strip()])
            md_fn = facts["functions"].get(f"{info['name']}/{arity}") if facts else None
            if md_fn is None and facts is not None:
                # md row absent for this selector — honest null, not a guess
                pass
            fns[sig] = {
                "selector": sel,
                "mutability": info["mutability"],
                "gate": md_fn["gate"] if md_fn else None,
                "metered": md_fn["metered"] if md_fn else False,
                "reverts": md_fn["reverts"] if md_fn else [],
            }
        contracts[pname] = {
            "sourceContract": source,
            "file": entry.get("file"),
            "address": paddr,
            "abiFile": f"{source}.json",
            "factsCovered": facts is not None,
            "functions": fns,
        }
        if entry.get("address"):
            covered.add(source)

    uncovered = sorted(index_live - covered)
    if uncovered:
        print(f"warning: index-live contracts without a perimeter facts entry: {uncovered}", file=sys.stderr)

    doc = {
        "$generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "$sources": ["abi/index.json", "kb/contract-facts.md", "config/addresses.json"],
        "$skipped": skipped,
        "contracts": contracts,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=1, sort_keys=False) + "\n", encoding="utf-8")
    total = sum(len(c["functions"]) for c in contracts.values())
    full = sum(1 for c in contracts.values() if c["factsCovered"])
    print(f"wrote {OUT.relative_to(ROOT)}: {len(contracts)} contracts ({full} with fn_tables facts), {total} functions")
    if skipped:
        print(f"skipped: {skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
