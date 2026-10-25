#!/usr/bin/env python3
"""harness/manual_fork.py — the MANUAL TESTING KIT (owner round): one
command sets up a pinned PulseChain fork with a FUNDED wallet, optionally
onboards it (LAU + Username + YUE + Play), optionally creates a venue to
play with, and optionally deploys the FULL never-deployed layer at the
overlay addresses (ENCRYPT + the fixed WORLD/WAR pair + GWAT) so the app's
SIM surfaces work end-to-end.

The fork stays up while this process runs (Ctrl-C stops it — kill by PID
via `ss -ltnp`, never `pkill -f anvil`); `--leave` exits leaving anvil
running. Attach to an existing fork with `--rpc`.

Usage (repo root):
  python3 harness/manual_fork.py                       # fork + funded wallet
  python3 harness/manual_fork.py --onboard             # + the full entry chain
  python3 harness/manual_fork.py --onboard --venue     # + a playable venue
  python3 harness/manual_fork.py --sim                 # + the SIM layer at the overlay
  python3 harness/manual_fork.py --key 0xac0974...     # use a chosen key (e.g. anvil #0)
  python3 harness/manual_fork.py --balance 5000000     # a bigger wallet
  python3 harness/manual_fork.py --rpc http://127.0.0.1:8545   # attach (still funds/deploys)

Then, in another terminal:
  cd app && npm run dev
  open http://localhost:5173/?rpc=http://127.0.0.1:8545
  SETTINGS → wallet → mode B → import the printed private key.

Notes: a fresh key is generated + printed when --key is absent (worthless
off-fork). --balance is in whole PLS (default 1,000,000 — anvil's own dev
accounts only hold ~10k PLS, dust at PLS prices). --sim needs
config/sim_addresses.json (set 3 writes it on first run); the layer lands
AT the overlay addresses via the runner's nonce-search deploys, so the app
and the runner see ONE layer.
"""

import argparse
import json
import secrets
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUNS = HERE / "runs"
ROOT = HERE.parent
OVERLAY = ROOT / "config" / "sim_addresses.json"

from anvil_flows import (  # noqa: E402 — after the path guard above
    UNIT,
    Actor,
    Canon,
    Chain,
    DEFAULT_FORK_BLOCK,
    DEFAULT_FORK_URL,
    Fork,
    HarnessError,
    Journal,
    Rpc,
    create1,
)
from agent_runner import deploy_at_overlay, impersonated_send, onboard_agent  # noqa: E402

FX = HERE / "fixtures"

# Proven-aged wallets (the 65.5 live survey + the kb's Beat caller): nonzero
# Eta slots + historical successful Beats. The DEFAULT is the kb's proven
# caller (13 attempts / 6 successes). Used by --aged for fork demos of the
# caller-lineage-gated surfaces (Beat above all).
AGED_WALLETS: dict[str, dict] = {
    "0x7B10aEbd3EdCaA60e587df49023f1E36502ac4f7": {"label": "kb's proven Beat caller (big slots, 6 successful Beats)", "default": True},
    "0xde74fe2d87755284A97042b75A1ee286eA4eF185": {"label": "big slots, 2 successful Beats", "default": False},
    "0x3500a18e909bf1C28095E4dc9D698D81c5A009f0": {"label": "marginal (Chao=1/Charge=1), 1 successful Beat", "default": False},
    "0x93D16BA8c6A31314d221Db92c459e9c8Aa185C29": {"label": "marginal, 1 successful Beat", "default": False},
}
PHOBOS = "0xb0ba7d36b7f0505879179ece7401f24eb653c6e1"  # the established v1-era venue (config/seed-pinned)


def phase(name: str, fn):
    """Run a setup phase LOUDLY — a failure aborts the kit (no silent half-setup)."""
    t0 = time.time()
    try:
        out = fn()
    except Exception as e:
        print(f"[FAIL] {name}: {e}")
        raise
    print(f"[ ok ] {name} ({round(time.time() - t0, 2)}s)")
    return out


def main():
    ap = argparse.ArgumentParser(description="manual testing fork: funded wallet + optional sim layer")
    ap.add_argument("--rpc", default=None, help="attach to an existing fork at this URL (localhost)")
    ap.add_argument("--fork-url", default=DEFAULT_FORK_URL)
    ap.add_argument("--fork-block", type=int, default=DEFAULT_FORK_BLOCK)
    ap.add_argument("--port", type=int, default=8545)
    ap.add_argument("--key", default=None, help="wallet private key (0x…); a fresh one is generated + printed otherwise")
    ap.add_argument("--balance", type=int, default=1_000_000, help="wallet funding in whole PLS (default 1,000,000)")
    ap.add_argument("--onboard", action="store_true", help="run the set-1 entry chain for the wallet (LAU + Username + YUE + Play)")
    ap.add_argument("--venue", action="store_true", help="also deploy a MockAsset venue and join it (implies --onboard)")
    ap.add_argument(
        "--aged", nargs="?", const="auto", default=None, metavar="ADDR",
        help=(
            "also prepare an AGED account for caller-lineage demos (Beat!): funds it, "
            "impersonates it on anvil, reads its Eta slots + LAU/YUE. 'auto' or an address "
            "from the proven list. The app cannot sign as it (we hold no key) — harness/"
            "script flows CAN via anvil impersonation. Composes with --onboard (both actors)."
        ),
    )
    ap.add_argument("--aged-beat", action="store_true", help="with --aged: also run a REAL committed Beat as the aged wallet (default venue: Phobos) — the caller-lineage proof")
    ap.add_argument(
        "--aged-transfer", nargs="?", const="auto", default=None, metavar="ADDR",
        help=(
            "hand a FORK COPY of an aged account to THIS wallet (the app key) via the "
            "system's own transfer path: LAU.addOwner + CHAN.TransferYue + CHO.Enter + a "
            "YUE token top-up — the wallet then reads AGED Eta slots and can Beat through "
            "the app + THE gate. Fork-only simulation (the real owner's chain is untouched). "
            "NOT combinable with --onboard/--venue (the wallet must be YUE-less)."
        ),
    )
    ap.add_argument("--sim", action="store_true", help="deploy the never-deployed layer AT the overlay (ENCRYPT + WORLD/WAR fixed + GWAT)")
    ap.add_argument("--leave", action="store_true", help="exit leaving the fork running (default: hold until Ctrl-C, then stop it)")
    args = ap.parse_args()
    if args.venue:
        args.onboard = True
    if args.aged_transfer and (args.onboard or args.venue):
        raise HarnessError("--aged-transfer needs a YUE-less wallet — drop --onboard/--venue (the wallet receives the aged LAU/YUE instead)")

    meta = {
        "started": datetime.now(timezone.utc).isoformat(),
        "rpc": None,
        "managed_fork": not bool(args.rpc),
        "fork_block": None if args.rpc else args.fork_block,
    }

    # ---- the fork ----
    fork = Fork(args)
    phase("fork up (pinned, shanghai)", fork.start)
    fork_url = args.rpc or f"http://127.0.0.1:{args.port}"
    rpc = Rpc([fork_url])
    canon = Canon()
    chain = Chain(rpc, canon)
    meta["rpc"] = fork_url

    def preflight():
        cid = chain.chain_id()
        if cid != 369:
            raise HarnessError(f"chain id {cid} — not a PulseChain fork")
        return {"chain_id": cid, "head": chain.block_number(), "gas_price": chain.gas_price()}

    info = phase("preflight (chain 369)", preflight)
    meta.update({"chain_id": info["chain_id"], "head_at_start": info["head"]})
    jrn = Journal(meta)

    # ---- the wallet ----
    key = args.key or ("0x" + secrets.token_hex(32))
    wallet = Actor(chain, key)

    def fund():
        wallet.fund(args.balance)
        bal = chain.rpc.call("eth_getBalance", [wallet.addr, "latest"])[1]
        return {"address": wallet.addr, "balance_pls": int(bal, 16) // UNIT}

    w = phase(f"wallet funded ({args.balance:,} PLS)", fund)

    # ---- the optional SIM layer AT the overlay ----
    sim_addrs: dict = {}
    if args.sim:
        if not OVERLAY.exists():
            raise HarnessError(f"{OVERLAY} is missing — run `python3 harness/anvil_flows_set3.py` once to generate it")
        overlay = json.loads(OVERLAY.read_text())["layer"]

        def deploy_sim():
            got = {}
            for name in ("ENCRYPT", "WORLDFIXED", "WARFIXED", "GWAT"):
                addr = deploy_at_overlay(rpc, chain, jrn, {"asserts": []}, name)
                want_key = {"WORLDFIXED": "WORLD", "WARFIXED": "WAR"}.get(name, name)
                if addr != overlay[want_key].lower():
                    raise HarnessError(f"{name} landed at {addr}, not the overlay entry {overlay[want_key]}")
                got[name] = addr
            # the fixed pair's ctor children
            got["VITUS"] = chain.view("WORLD", "Vitus", "", [], ["address"], to=got["WORLDFIXED"]).lower()
            got["H2O"] = chain.view("WAR", "Water", "", [], ["address"], to=got["WARFIXED"]).lower()
            if chain.code(got["VITUS"]) == "0x" or chain.code(got["H2O"]) == "0x":
                raise HarnessError("VITUS/H2O children have no code — the fixed pair did not construct them")
            # ENCRYPT must be registered on the live VOID (the app's cipher desk reads this)
            lib = chain.view("VOID", "GetLibraryAddress", "string", ["encrypt"], ["address"]).lower()
            if lib != got["ENCRYPT"]:
                raise HarnessError("VOID library \"encrypt\" != the deployed fixture")
            return got

        sim_addrs = phase("SIM layer at the overlay (ENCRYPT + WORLD/WAR fixed + GWAT + children)", deploy_sim)

    # ---- the optional onboarding chain ----
    row: dict | None = None
    if args.onboard:
        tag = "MANUAL"
        row = onboard_agent(chain, canon, jrn, 1, tag, priv=key)
        if not (row.get("lau") and row.get("yue")):
            raise HarnessError("onboarding failed — see the assert output above")
        phase("wallet re-funded to the requested balance after onboarding", fund)

    # ---- the optional venue ----
    venue: dict = {}
    if args.venue:
        if row is None:
            raise HarnessError("--venue needs --onboard (a LAU to join with)")
        lau = row["lau"]

        def make_venue():
            mock_creation = (FX / "mock_asset.creation.hex").read_text().strip().removeprefix("0x")
            mock_runtime = (FX / "mock_asset.runtime.hex").read_text().strip().removeprefix("0x")
            asset = create1(wallet.addr, chain.nonce(wallet.addr))
            r = wallet.deploy(mock_creation)
            if r["status"] != "0x1" or chain.code(asset)[2:] != mock_runtime:
                raise HarnessError("mock asset deploy failed its byte-pin")
            mp = canon.address("MAP")
            qing = create1(mp, chain.nonce(mp))
            r = wallet.send(mp, canon.data("MAP", "New", "address", [asset]))
            if r["status"] != "0x1":
                raise HarnessError("MAP.New failed")
            r = wallet.send(qing, canon.data("QING", "Join", "address", [lau]), gas=1_500_000)
            if r["status"] != "0x1":
                raise HarnessError("QING.Join failed")
            return {
                "qing": qing,
                "asset": asset,
                "waat": chain.view("QING", "Waat", "", [], ["uint256"], to=qing),
            }

        venue = phase("venue: MockAsset + MAP.New + Join", make_venue)

    # ---- the optional AGED actor (caller-lineage demos: Beat) ----
    aged: dict = {}
    if args.aged or args.aged_transfer:
        pick = args.aged or args.aged_transfer
        if pick == "auto":
            aged_addr = next(a for a, m in AGED_WALLETS.items() if m["default"])
        elif pick.lower() in {a.lower() for a in AGED_WALLETS}:
            aged_addr = next(a for a in AGED_WALLETS if a.lower() == pick.lower())
        elif pick.startswith("0x") and len(pick) == 42:
            aged_addr = pick  # any custom wallet — read its lineage honestly
        else:
            raise HarnessError(f"--aged: unknown wallet {pick!r} (use 'auto', an address, or one of {list(AGED_WALLETS)})")

        def aged_lineage():
            # the lineage preflight: Eta slots (simulated from the aged wallet)
            raw = chain.eth_call(canon.address("RING"), canon.data("RING", "Eta", "", []), frm=aged_addr)
            words = [raw[2 + i * 64 : 2 + (i + 1) * 64] for i in range(4)]
            slots = [str(int(w, 16)) for w in words]
            lau = chain.view("CHO", "GetUserTokenAddress", "address", [aged_addr], ["address"])
            yue = chain.view("CHAN", "Yan", "address", [aged_addr], ["address"])
            if all(s == "0" for s in slots[1:]):
                raise HarnessError(
                    f"the aged wallet {aged_addr} reads FRESH slots {slots} on this fork — "
                    "Beat would panic 0x12; pick a proven wallet (auto) or drop the aged flags"
                )
            return {
                "addr": aged_addr,
                "slots": slots,
                "lau": lau if int(lau, 16) != 0 else None,
                "yue": yue if int(yue, 16) != 0 else None,
            }

        aged = phase(f"aged lineage verified ({aged_addr[:10]}…)", aged_lineage)

        if args.aged:
            def prep_aged():
                st, _ = chain.rpc.call("anvil_setBalance", [aged_addr, hex(args.balance * UNIT)])
                if st != "ok":
                    raise HarnessError(f"anvil_setBalance failed for {aged_addr}")
                st, _ = chain.rpc.call("anvil_impersonateAccount", [aged_addr])
                if st != "ok":
                    raise HarnessError(f"impersonate failed for {aged_addr}")

            phase(f"aged actor prepared ({aged_addr[:10]}…)", prep_aged)

            if args.aged_beat:
                def aged_beat():
                    waat = chain.view("QING", "Waat", "", [], ["uint256"], to=PHOBOS)
                    rc = impersonated_send(chain.rpc, chain, aged_addr, canon.address("META"), canon.data("META", "Beat", "uint256", [waat]), gas=3_000_000)
                    if rc["status"] != "0x1":
                        raise HarnessError(f"the aged Beat REVERTED (gas {int(rc['gasUsed'], 16)}) — see the receipt {rc['transactionHash']}")
                    return {"tx": rc["transactionHash"], "gas": int(rc["gasUsed"], 16)}

                beat = phase("aged Beat COMMITTED (the caller-lineage proof)", aged_beat)
                aged["beat_tx"] = beat["tx"]
                aged["beat_gas"] = beat["gas"]

        if args.aged_transfer:
            # the system's OWN transfer path (fork-proven, session-65.6): the aging
            # rides the YUE (the vault reactor) and moves with TransferYue; the
            # identity needs LAU ownership + CHO.Enter; ZeroHoldings needs the
            # wallet to hold its own YUE token. Fork-only: the real owner's
            # chain is untouched.
            def transfer_aged():
                lau, yue = aged["lau"], aged["yue"]
                # 1. LAU ownership -> the wallet (Enter's gate)
                impersonated_send(chain.rpc, chain, aged_addr, lau, canon.data("LAU", "addOwner", "address", [wallet.addr]))
                # 2. the vault + the Yan mapping (this CLEARS the aged wallet's resolver)
                impersonated_send(chain.rpc, chain, aged_addr, canon.address("CHAN"), canon.data("CHAN", "TransferYue", "address,address", [yue, wallet.addr]))
                # 3. identity discovery: the wallet Enters the aged LAU
                r = wallet.send(canon.address("CHO"), canon.data("CHO", "Enter", "address", [lau]), gas=1_000_000)
                if r["status"] != "0x1":
                    raise HarnessError("CHO.Enter failed for the wallet")
                # 4. ZeroHoldings: the wallet must hold its own YUE token
                impersonated_send(chain.rpc, chain, aged_addr, yue, canon.data("YUE", "transfer", "address,uint256", [wallet.addr, str(10 * UNIT)]))
                # verify: discovery + aged slots FROM THE WALLET
                got_lau = chain.view("CHO", "GetUserTokenAddress", "address", [wallet.addr], ["address"]).lower()
                got_yue = chain.view("CHAN", "Yan", "address", [wallet.addr], ["address"]).lower()
                if got_lau != lau.lower() or got_yue != yue.lower():
                    raise HarnessError(f"handover incomplete: wallet resolves ({got_lau}, {got_yue})")
                raw = chain.eth_call(canon.address("RING"), canon.data("RING", "Eta", "", []), frm=wallet.addr)
                words = [raw[2 + i * 64 : 2 + (i + 1) * 64] for i in range(4)]
                slots = [str(int(w, 16)) for w in words]
                if all(x == "0" for x in slots[1:]):
                    raise HarnessError(f"the transferred account still reads FRESH slots {slots} — the aging did not ride along")
                # the proof: a committed Beat FROM THE WALLET (the app's key!)
                waat = chain.view("QING", "Waat", "", [], ["uint256"], to=PHOBOS)
                r = wallet.send(canon.address("META"), canon.data("META", "Beat", "uint256", [waat]), gas=3_000_000)
                if r["status"] != "0x1":
                    raise HarnessError("the wallet's first AGED Beat reverted")
                return {"lau": got_lau, "yue": got_yue, "slots": slots, "beat_tx": r["transactionHash"], "beat_gas": int(r["gasUsed"], 16)}

            moved = phase("AGED account TRANSFERRED to the wallet (the 4-step path + proof Beat)", transfer_aged)
            aged["transferred"] = moved

    # ---- the summary ----
    print("\n" + "=" * 66)
    print("MANUAL FORK READY — " + fork_url)
    print("=" * 66)
    print(f"  block         {info['head']} (pinned {meta['fork_block'] or 'attached fork'})")
    print(f"  wallet        {w['address']}")
    print(f"  private key   {key}")
    print(f"  balance       {w['balance_pls']:,} PLS")
    if row is not None:
        print(f"  LAU           {row['lau']}")
        print(f"  YUE           {row['yue']}")
        print(f"  Username      agent-01 (the onboarding-lite label)")
    if venue:
        print(f"  venue (QING)  {venue['qing']}   waat {venue['waat']}")
        print(f"  venue asset   {venue['asset']}")
    if aged:
        label = AGED_WALLETS.get(aged["addr"], {}).get("label", "custom wallet")
        print(f"  AGED actor    {aged['addr']}  ({label})")
        print(f"  Eta slots     {aged['slots']}")
        if "transferred" in aged:
            t = aged["transferred"]
            print(f"  └ TRANSFERRED to the wallet above — the app key IS the aged account now:")
            print(f"     LAU {t['lau']} · YUE {t['yue']} · slots {t['slots']}")
            print(f"     proof Beat from the wallet: tx {t['beat_tx']} (gas {t['beat_gas']:,})")
        else:
            print(f"  aged LAU/YUE  {aged['lau']} / {aged['yue']}")
            if "beat_tx" in aged:
                print(f"  aged Beat     COMMITTED — tx {aged['beat_tx']} (gas {aged['beat_gas']:,})")
            print("                (impersonated — harness/scripts can send as it; for the APP")
            print("                 use --aged-transfer instead: it hands the aged account to a key you hold)")
    if sim_addrs:
        print("  SIM layer (AT the overlay addresses — the app sees SIM mode):")
        for name in ("ENCRYPT", "WORLDFIXED", "WARFIXED", "GWAT", "VITUS", "H2O"):
            print(f"    {name:<11} {sim_addrs[name]}")
    print("-" * 66)
    print("  app:  cd app && npm run dev")
    print(f"        http://localhost:5173/?rpc={fork_url}")
    print("        SETTINGS → wallet → mode B → import the key above")
    print("=" * 66 + "\n")

    if args.leave:
        print(f"leaving anvil running (PID {fork.proc.pid if fork.proc else 'attached'}) — kill by PID when done")
        return
    print("fork is up — Ctrl-C to stop it")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    print("\nstopping the fork…")
    fork.args.keep = False
    fork.stop()
    jrn.finish()


if __name__ == "__main__":
    try:
        main()
    except HarnessError as e:
        print(f"\n[ABORT] {e}")
        sys.exit(1)
