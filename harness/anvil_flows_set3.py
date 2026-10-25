#!/usr/bin/env python3
"""Flow set 3 (session 58, IA-PLAN §8 / HARNESS.md §5) — the never-deployed
layer fixtures on the fork: WORLD / WAR / H2O / VITUS / GWAT / ENCRYPT.

THE HEADLINE FINDING (fork-proven at pin 27,674,000): the verbatim WORLD and
WAR are UNDEPLOYABLE as written — each constructor deploys its asset
(`new VITUS(address(this))` / `new H2O(address(this))`), and the asset's
constructor calls back into the parent-under-construction (empty code -> bare
revert -> the whole creation fails). This is almost certainly the failed
wave-5 create (kb/dev/world.md: "produced NO code; why, is unknown"). WORLD's
Code additionally never writes `_cauda`, so Tail() == 0 always and the
WAR.Faa -> GWAT.Gwat spawn chain is dead even on a deployed world. The FIXED
variants (DSS-precedent, marked inline) take the live addresses as ctor
params + the one-line cauda write.

Runs on its own managed fork (same pin policy as sets 1/2). Steps:

  0  preflight: chain id 369 + fixture manifest verify + pins present
  1  player onboarding-lite + a fresh MockAsset venue on MAP (Code target)
  2  Eta aging: CHOA.Chat advances the caller's vault-reactor lineage until
     the simulated RING.Eta(from=player) has nonzero slots (the s5 floor —
     WORLD.Code beats internally and needs an aged caller)
  3  verbatim creation-revert pins: WORLD + WAR creations revert bare (the
     under-construction callback); ENCRYPT (constructed against LIVE VOID)
     deploys clean + runtime byte == pin
  4  the fixed stack: WORLDFIXED -> WARFIXED -> verbatim GWAT; byte-pinned
     runtimes; VITUS/H2O deployed inside the fixed constructors
  5  WORLD wiring: getters == config; VITUS seeded 1:1 with the live MV
     totalSupply (+1 wei initial unit); constructor market rates; the
     constructor-lottery cap; CHAN ownership
  6  WAR wiring: H2O seeded 1:1 with the live Call totalSupply; CO2 == 0;
     CHAN ownership (incl. the relocated H2O addOwner)
  7  ENCRYPT wiring: VOID.GetLibraryAddress("encrypt") == deployed
  8  spawn-gate honesty pre-claim: Faa returns 0 (Tail empty), CO2/H2O
     unchanged, GWAT.Gwat reverts SpawningFailure — the errors the SIM
     frontend renders
  9  the loop proof: WORLDFIXED.Code claims the anchor tile (Buzz credit,
     VITUS to the caller's YUE, Tail > 0 — THE CAUDA FIX PROOF, the
     OutOfRange pin one tile off); Faa draws (CO2 advances, H2O mints);
     GWAT.Gwat spawns the player's sub-venue (full-supply ownership, the
     "<user>'s <asset> GWAT" rename, CHO cross-ownership, the tile map)
  10  the VITUS royalty exit: CHAN.OptIn(VITUS) then VITUS.Withdraw moves
      the vault-held royalty to the player wallet (the CHAN escrow path)
  11  the ENCRYPT two-party round trip (session 59, fork-first for the UI):
      alice -> bob Encrypt/Decrypt round-trips EXACTLY (the keystream is a
      deterministic orbit — preview index == committed index), both party
      gates fire NotParty (a third EOA encrypting as alice; ALICE decrypting
      her own sent note — the gate keys on the TO side), every call meters
      +1 to the contract's own supply
  12  ENCRYPT expiry + Prune pins: past 10 days the expired entry decrypts
      ONCE more (delete-after-read) then answers empty; Prune leaves live
      AND expired entries decryptable — it indexes _encryptions by ARRAY
      POSITION, not keystream index (the wrong-key-domain defect, pinned)
  13  overlay: the six deployed addresses == config/sim_addresses.json
      (written on first run — the app's SIM overlay; deterministic CREATE1
      from the deployer at the pin, never hand-edited)
  14  invariants

Usage: python3 harness/anvil_flows_set3.py [--keep | --rpc URL | --fork-block N]
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from eth_utils import to_checksum_address

from anvil_flows import (
    UNIT,
    Actor,
    Canon,
    Chain,
    Fork,
    HarnessError,
    Journal,
    Rpc,
    create1,
    decode,
    encode,
    ksha,
    selector,
)

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
FIXTURE = HERE / "fixtures" / "world-layer"
DEPLOYER = "0x0474606332105A1dA6FC8EF7De2470551D389Cb9"  # HARNESS.md §1 tx.origin of the system
OVERLAY = ROOT / "config" / "sim_addresses.json"
PINS = ("world", "war", "h2o", "vitus", "gwat", "encrypt", "worldfixed", "warfixed", "vitusfixed", "h2ofixed")
DEPLOY_GAS = 30_000_000
SPAWNING_FAILURE = "0x" + ksha(b"SpawningFailure(uint256)").hex()[:8]
OUT_OF_RANGE = "0x" + ksha(b"OutOfRange(int256,int256,uint256)").hex()[:8]
NOT_PARTY = "0x" + ksha(b"NotParty(address,address,address)").hex()[:8]
TEN_DAYS = 10 * 24 * 3600


def decode_bytes(datahex: str) -> bytes:
    """decode an ABI `bytes` return (offset word -> len word -> data)."""
    data = bytes.fromhex(datahex[2:] if datahex.startswith("0x") else datahex)
    off = int.from_bytes(data[0:32], "big")
    ln = int.from_bytes(data[off:off + 32], "big")
    return data[off + 32:off + 32 + ln]


def revert_data(chain: Chain, to: str, data: str, frm: str = None) -> str | None:
    """eth_call expecting a revert; returns the raw revert-data hex (or the
    error string when the node gives none)."""
    params = [{"to": to, "data": data}, "latest"]
    if frm:
        params[0]["from"] = frm
    st, res = chain.rpc.call("eth_call", params)
    if st == "ok":
        return None
    if isinstance(res, dict):
        d = res.get("data")
        if isinstance(d, str) and d.startswith("0x"):
            return d
    return str(res)


def impersonated_send(rpc: Rpc, chain: Chain, frm: str, to: str | None, data: str, gas: int = DEPLOY_GAS) -> dict:
    st, _ = rpc.call("anvil_impersonateAccount", [frm])
    if st != "ok":
        raise HarnessError(f"impersonate failed for {frm}")
    params = [{"from": frm, "data": data, "gas": hex(gas)}]
    if to:
        params[0]["to"] = to
    st, txh = rpc.call("eth_sendTransaction", params)
    if st != "ok":
        raise HarnessError(f"impersonated send failed: {txh}")
    return _wait(chain, txh)


def _wait(chain: Chain, txh: str) -> dict:
    import time

    for _ in range(300):
        st, rec = chain.rpc.call("eth_getTransactionReceipt", [txh])
        if st == "ok" and rec is not None:
            return rec
        time.sleep(0.4)
    raise HarnessError(f"no receipt for {txh}")


def force_send(rpc: Rpc, chain: Chain, actor: Actor, to: str, data: str, gas: int) -> dict:
    """signed send with explicit gas — for txs we EXPECT may revert."""
    tx = {
        "nonce": chain.nonce(actor.addr),
        "to": to_checksum_address(to),
        "value": 0,
        "gas": gas,
        "gasPrice": int(chain.gas_price() * 1.2) + 1_000_000,
        "data": data,
        "chainId": 369,
    }
    signed = actor.acct.sign_transaction(tx)
    st, res = rpc.call("eth_sendRawTransaction", ["0x" + signed.raw_transaction.hex()])
    if st != "ok":
        raise HarnessError(f"force_send rejected: {res}")
    return _wait(chain, res)




def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpc", default=None)
    ap.add_argument("--fork-url", default=os.environ.get("DYS_FORK_URL", "https://rpc.pulsechain.com"))
    ap.add_argument("--fork-block", type=int, default=int(os.environ.get("DYS_FORK_BLOCK", 27674000)))
    ap.add_argument("--port", type=int, default=8546)
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    fork = Fork(args)
    fork.start()
    fork_url = args.rpc or f"http://127.0.0.1:{args.port}"
    rpc = Rpc([fork_url])
    canon = Canon()
    chain = Chain(rpc, canon)

    meta = {
        "started": datetime.now(timezone.utc).isoformat(),
        "rpc": fork_url,
        "managed_fork": not bool(args.rpc),
        "fork_block": None if args.rpc else args.fork_block,
        "chain_id": chain.chain_id(),
        "head_at_start": chain.block_number(),
        "suite": "set3-world-layer",
    }
    jrn = Journal(meta)
    print(json.dumps(meta))

    player = Actor(chain)
    player.fund(1_000_000)
    st_ = {}

    def s0(rec):
        jrn.a(rec, "chain id 369", chain.chain_id() == 369)
        r = subprocess.run(
            [sys.executable, "sync_sources.py"], cwd=FIXTURE, capture_output=True, text=True
        )
        jrn.a(rec, "fixture sources verified vs manifest", r.returncode == 0, (r.stdout + r.stderr)[:300])
        for pin in PINS:
            c = (FIXTURE / "pins" / f"{pin}.creation.hex").read_text().strip()
            rt = (FIXTURE / "pins" / f"{pin}.runtime.hex").read_text().strip()
            jrn.a(rec, f"pin {pin} present", len(c) > 100 and len(rt) > 100)

    def s1(rec):
        lau = create1(canon.address("LAUFactory"), chain.nonce(canon.address("LAUFactory")))
        player.send(canon.address("LAUFactory"), canon.data("LAUFactory", "New", "string,string", ["Sim Player", "SIMY"]))
        jrn.a(rec, "code at LAU", chain.code(lau) != "0x", lau)
        player.send(lau, canon.data("LAU", "Username", "string", ["simlayer"]))
        jrn.a(rec, "username set", chain.view("LAU", "Username", "", [], ["string"], to=lau) == "simlayer")
        sei = canon.address("SEI")
        yue = create1(sei, chain.nonce(sei))
        player.send(sei, canon.data("SEI", "Start", "address,string,string", [lau, "Sim Yue", "SYUE"]))
        jrn.a(rec, "Chan.Yan(player) == YUE",
              chain.view("CHAN", "Yan", "address", [player.addr], ["address"]).lower() == yue, yue)
        st_["lau"], st_["yue"] = lau, yue

        creation_hex = (HERE / "fixtures" / "mock_asset.creation.hex").read_text().strip().removeprefix("0x")
        asset = create1(player.addr, chain.nonce(player.addr))
        player.deploy(creation_hex)
        jrn.a(rec, "mock asset deployed", chain.code(asset) != "0x", asset)
        mp = canon.address("MAP")
        qing = create1(mp, chain.nonce(mp))
        player.send(mp, canon.data("MAP", "New", "address", [asset]))
        jrn.a(rec, "code at QING", chain.code(qing) != "0x", qing)
        waat = chain.view("QING", "Waat", "", [], ["uint256"], to=qing)
        st_["asset"], st_["qing"], st_["waat"] = asset, qing, waat
        # the venue needs ERIS holdings for a nonzero settle Charge (MAI =
        # Eris.balanceOf(venue) / entropy; modExp base 0 => Charge 0 => Code's
        # early return). Fund it from the deployer's Eris (YANG's SHIO).
        eris = canon.address("ErisSHIO")
        eris_whale = chain.view("SHIO", "balanceOf", "address", [DEPLOYER], ["uint256"], to=eris)
        jrn.a(rec, "deployer holds Eris to fund the venue", eris_whale > 0, eris_whale)
        r = impersonated_send(rpc, chain, DEPLOYER, eris,
                              canon.data("SHIO", "transfer", "address,uint256", [qing, str(10 * UNIT)]), gas=1_000_000)
        jrn.a(rec, "Eris -> venue status 1", r["status"] == "0x1")
        jrn.a(rec, "venue holds Eris", chain.view("SHIO", "balanceOf", "address", [qing], ["uint256"], to=eris) == 10 * UNIT)
        # the venue ALSO needs CHO (Tethys): Beat's Dione (the VITUS payout)
        # = Tethys.balanceOf(venue) / venue.entropy, and Deimos = Dione^Phoebe
        # mod Yuan — without venue CHO the whole credit path yields zeros.
        cho = canon.address("CHO")
        r = impersonated_send(rpc, chain, DEPLOYER, cho,
                              canon.data("CHO", "transfer", "address,uint256", [qing, str(10 * UNIT)]), gas=1_000_000)
        jrn.a(rec, "CHO -> venue status 1", r["status"] == "0x1")
        jrn.a(rec, "venue holds CHO (the Dione numerator)",
              chain.view("CHO", "balanceOf", "address", [qing], ["uint256"]) == 10 * UNIT)
        lon, lat = chain.view("Hecke", "Compliment", "uint256", [waat], ["int256", "int256"], to=canon.address("HECKE"))
        st_["lat"], st_["lon"] = lat, lon
        jrn.info(rec, "venue anchor", f"lat={lat} lon={lon} waat={waat}")

    def eta_probe() -> tuple:
        # RING.Eta is non-view + tx.origin-sensitive; a quiet-fork eth_call is a
        # faithful preview (nothing else advances this caller between calls)
        raw = chain.eth_call(canon.address("RING"), canon.data("RING", "Eta", "", []), frm=player.addr)
        return tuple(decode(["uint256", "uint256", "uint256", "uint256"], raw))

    def s2(rec):
        # THE AGED CALLER: WORLD.Code beats + Su's + Eta's ladder inputs need a
        # caller with real ladder lineage — a fresh player stays at the
        # (14,0,0,0) floor (fork-proven: 6 settles + Play + SHIO-funded
        # Fomalhaute/Fornax do NOT age a fresh soul — the accumulators are
        # per-Soul history, not balances). The deployer EOA (mariarahel, the
        # dev's own aged account) carries the lineage — impersonation is the
        # recipe, exactly like the set-2 Beat replays.
        e = eta_probe()
        jrn.a(rec, "fresh-player floor pinned (14,0,0,0)", e == (14, 0, 0, 0), str(e))
        raw = chain.eth_call(canon.address("RING"), canon.data("RING", "Eta", "", []), frm=DEPLOYER)
        aged = tuple(decode(["uint256", "uint256", "uint256", "uint256"], raw))
        jrn.a(rec, "the aged caller (mariarahel/deployer) has nonzero Eta slots",
              aged[1] > 0 and aged[3] > 0, str(aged))
        aged_yue = chain.view("CHAN", "Yan", "address", [DEPLOYER], ["address"]).lower()
        jrn.a(rec, "aged caller has a YUE", int(aged_yue, 16) != 0, aged_yue)
        hold = chain.view("YUE", "balanceOf", "address", [DEPLOYER], ["uint256"], to=aged_yue)
        jrn.a(rec, "aged caller holds their YUE tokens (ZeroHoldings floor)", hold > 0, hold)
        st_["aged_yue"] = aged_yue
        # XIA.Charge's modExp modulus is Fomalhaute.balanceOf(On.Phi) — the
        # CHANNEL KEY, not the wallet (fork-found: even mariarahel's wallet
        # Fomalhaute does not count; aged live players hold it AT their Phi).
        # Fund the aged caller's Phi from their own wallet (fork-legal self-move).
        raw = chain.eth_call(canon.address("CHO"), canon.data("CHO", "GetUser", "", []), frm=DEPLOYER)
        vals = decode(["uint64", "address", "address", "uint64", "uint64", "address", "uint64", "uint64", "uint64", "string", "uint64"], raw)
        phi = vals[1].lower()
        fomal = canon.address("WorldChatSHIO")
        wallet_fomal = chain.view("SHIO", "balanceOf", "address", [DEPLOYER], ["uint256"], to=fomal)
        jrn.a(rec, "aged caller holds wallet Fomalhaute to seed the Phi", wallet_fomal > 0, wallet_fomal)
        r = impersonated_send(rpc, chain, DEPLOYER, fomal,
                              canon.data("SHIO", "transfer", "address,uint256", [phi, str(10 * UNIT)]), gas=1_000_000)
        jrn.a(rec, "Fomalhaute -> Phi status 1", r["status"] == "0x1")
        jrn.a(rec, "Phi holds Fomalhaute (the Charge modulus)",
              chain.view("SHIO", "balanceOf", "address", [phi], ["uint256"], to=fomal) == 10 * UNIT, phi)
        st_["aged_phi"] = phi
        # Beat's Dione/Deimos (the VITUS mint + creator credit) are Yuan-
        # weighted: the CALLER's wallet+10*LAU+40*YUE holdings OF THE VENUE'S
        # TOKEN (the s40 all-zero-outputs finding). Join mints nothing to the
        # joiner (the call-counter supplies the contract) — venue tokens come
        # via the set-2 s4 Ⓐ bridge: AddContractOwner -> AddMarketRate ->
        # exact-amount approve -> Purchase -> transfer-to-LAU (Yuan = 11e18).
        aged_lau = chain.view("CHO", "GetUserTokenAddress", "address", [DEPLOYER], ["address"]).lower()
        jrn.a(rec, "aged caller has a LAU", int(aged_lau, 16) != 0, aged_lau)
        qing = st_["qing"]
        r = impersonated_send(rpc, chain, DEPLOYER, canon.address("CHO"),
                              canon.data("CHO", "AddContractOwner", "address,address", [qing, DEPLOYER]), gas=2_000_000)
        jrn.a(rec, "CHO.AddContractOwner status 1", r["status"] == "0x1")
        r = impersonated_send(rpc, chain, DEPLOYER, qing,
                              canon.data("QING", "AddMarketRate", "address,uint256", [canon.address("AFFECTION"), str(UNIT)]), gas=1_000_000)
        jrn.a(rec, "QING.AddMarketRate(AFFECTION,1e18) status 1", r["status"] == "0x1")
        r = impersonated_send(rpc, chain, DEPLOYER, canon.address("AFFECTION"),
                              selector("approve", "address,uint256") + encode(["address", "uint256"], [qing, str(UNIT)]), gas=1_000_000)
        jrn.a(rec, "exact-amount Ⓐ approve status 1", r["status"] == "0x1")
        r = impersonated_send(rpc, chain, DEPLOYER, qing,
                              canon.data("QING", "Purchase", "address,uint256", [canon.address("AFFECTION"), str(UNIT)]), gas=2_000_000)
        jrn.a(rec, "QING.Purchase status 1", r["status"] == "0x1")
        jrn.a(rec, "caller bought 1e18 venue tokens",
              chain.view("QING", "balanceOf", "address", [DEPLOYER], ["uint256"], to=qing) == UNIT)
        r = impersonated_send(rpc, chain, DEPLOYER, qing,
                              canon.data("QING", "transfer", "address,uint256", [aged_lau, str(UNIT)]), gas=1_000_000)
        jrn.a(rec, "venue tokens -> LAU (10x weight)", r["status"] == "0x1")
        hold_qing = chain.view("QING", "balanceOf", "address", [aged_lau], ["uint256"], to=qing)
        jrn.a(rec, "aged caller's LAU holds the venue token", hold_qing >= UNIT, hold_qing)
        yuan = decode(["uint256"], chain.eth_call(
            canon.address("CHOA"), canon.data("CHOA", "Yuan", "address", [qing]), frm=DEPLOYER))[0]
        jrn.a(rec, "caller Yuan(venue) == 10e18 (10x LAU weight)", yuan == 10 * UNIT, yuan)

    def deploy_fixture(rec, name: str, args_types: list, args_vals: list, gas: int = DEPLOY_GAS) -> str:
        creation = (FIXTURE / "pins" / f"{name.lower()}.creation.hex").read_text().strip()
        creation += encode(args_types, args_vals) if args_types else ""
        pre = create1(DEPLOYER, chain.nonce(DEPLOYER))
        r = impersonated_send(rpc, chain, DEPLOYER, None, "0x" + creation, gas)
        jrn.a(rec, f"{name} deploy status 1", r["status"] == "0x1", r.get("contractAddress"))
        got = r.get("contractAddress", "").lower()
        jrn.a(rec, f"{name} address == create1 precompute", got == pre, f"{got} vs {pre}")
        runtime = (FIXTURE / "pins" / f"{name.lower()}.runtime.hex").read_text().strip()
        jrn.a(rec, f"{name} runtime byte == pin", chain.code(got)[2:] == runtime)
        jrn.info(rec, f"gas {name} deploy", int(r["gasUsed"], 16))
        return got

    def s3(rec):
        cheon, meta_a, map_a = canon.address("CHEON"), canon.address("META"), canon.address("MAP")
        # the verbatim WORLD is UNDEPLOYABLE: `new VITUS(address(this))` makes
        # VITUS's ctor call back into the parent-under-construction (empty
        # code -> bare revert). Fork-proven here; this is the likely cause of
        # the failed wave-5 create (kb/dev/world.md: "produced NO code").
        creation = (FIXTURE / "pins" / "world.creation.hex").read_text().strip()
        creation += encode(["address", "address", "address"], [cheon, meta_a, map_a])
        world_pre = create1(DEPLOYER, chain.nonce(DEPLOYER))
        r = impersonated_send(rpc, chain, DEPLOYER, None, "0x" + creation)
        jrn.a(rec, "verbatim WORLD creation reverts (status 0)", r["status"] == "0x0", r.get("contractAddress"))
        jrn.a(rec, "no code at the failed create address", chain.code(world_pre) == "0x", world_pre)
        sim = revert_data(chain, None, "0x" + creation, frm=DEPLOYER)
        jrn.a(rec, "bare revert (empty data — the under-construction callback)", sim == "0x", sim)
        st_["WORLD_BROKEN"] = world_pre

        # verbatim WAR: H2O's ctor has the same callback bug, and its arg
        # world is dead anyway
        creation = (FIXTURE / "pins" / "war.creation.hex").read_text().strip()
        creation += encode(["address"], [world_pre])
        r = impersonated_send(rpc, chain, DEPLOYER, None, "0x" + creation)
        jrn.a(rec, "verbatim WAR creation reverts (status 0)", r["status"] == "0x0")
        sim = revert_data(chain, None, "0x" + creation, frm=DEPLOYER)
        jrn.a(rec, "bare revert again", sim == "0x", sim)

        # ENCRYPT constructs against LIVE VOID — deploys clean
        st_["ENCRYPT"] = deploy_fixture(rec, "ENCRYPT", ["address"], [canon.address("VOID")], gas=8_000_000)

    def s4(rec):
        # NOTE: the fixed variants are fixture contracts — their selectors
        # route through the template names (WORLD/WAR) with to=<fixed addr>
        w = st_["WORLDFIXED"]
        jrn.a(rec, "WORLDFIXED.Cheon() == config", chain.view("WORLD", "Cheon", "", [], ["address"], to=w).lower() == canon.address("CHEON"))
        jrn.a(rec, "WORLDFIXED.Meta() == config", chain.view("WORLD", "Meta", "", [], ["address"], to=w).lower() == canon.address("META"))
        jrn.a(rec, "WORLDFIXED.Map() == config", chain.view("WORLD", "Map", "", [], ["address"], to=w).lower() == canon.address("MAP"))
        cap = chain.view("WORLD", "maxSupply", "", [], ["uint256"], to=w)
        jrn.a(rec, "constructor-lottery cap drawn (< 111111)", 0 <= cap < 111111, cap)
        for token in ("AFFECTION", "CHEON", "META", "MAP"):
            jrn.a(rec, f"WORLDFIXED rate[{token}] == 1e18",
                  chain.view("WORLD", "GetMarketRate", "address", [canon.address(token)], ["uint256"], to=w) == UNIT,
                  token)
        mv = "0xA1BEe1daE9Af77dAC73aA0459eD63b4D93fC6d29"  # kb/dev/vitus.md — the VITUS 1:1 anchor
        mv_supply = chain.view("DYSNOMIA", "totalSupply", "", [], ["uint256"], to=mv)
        vt = chain.view("VITUS", "totalSupply", "", [], ["uint256"], to=st_["VITUS"])
        jrn.a(rec, "VITUS seeded 1:1 with MV totalSupply",
              vt == mv_supply, f"vitus={vt} mv={mv_supply}")
        jrn.a(rec, "VITUS rate vs MV == 1e18",
              chain.view("VITUS", "GetMarketRate", "address", [mv], ["uint256"], to=st_["VITUS"]) == UNIT)
        jrn.a(rec, "CHAN.owner(VITUS) — ctor addOwner landed",
              chain.view("CHAN", "owner", "address", [st_["VITUS"]], ["bool"]) is True)
        origin_hold = chain.view("WORLD", "balanceOf", "address", [DEPLOYER], ["uint256"], to=w)
        jrn.info(rec, "WORLDFIXED originMint to deployer (tx.origin)", origin_hold)

    def s5(rec):
        wr = st_["WARFIXED"]
        jrn.a(rec, "WAR.World() == WORLDFIXED", chain.view("WAR", "World", "", [], ["address"], to=wr).lower() == st_["WORLDFIXED"])
        jrn.a(rec, "WAR.CO2 == 0", chain.view("WAR", "CO2", "", [], ["uint256"], to=wr) == 0)
        jrn.a(rec, "CHAN.owner(WAR) — ctor addOwner landed",
              chain.view("CHAN", "owner", "address", [wr], ["bool"]) is True)
        jrn.a(rec, "CHAN.owner(H2O) — relocated addOwner landed",
              chain.view("CHAN", "owner", "address", [st_["H2O"]], ["bool"]) is True)
        call = "0xD4FD96BA83d3E6FF1A0Baa44c32Def94e641D97c"  # kb/dev/h2o.md — the H2O 1:1 anchor
        call_supply = chain.view("DYSNOMIA", "totalSupply", "", [], ["uint256"], to=call)
        hw = chain.view("H2O", "totalSupply", "", [], ["uint256"], to=st_["H2O"])
        jrn.a(rec, "H2O seeded 1:1 with Call totalSupply", hw == call_supply, f"h2o={hw} call={call_supply}")
        for token in ("AFFECTION",):
            jrn.a(rec, f"WAR rate[{token}] == 1e18",
                  chain.view("WAR", "GetMarketRate", "address", [canon.address(token)], ["uint256"], to=wr) == UNIT)

    def s6(rec):
        lib = chain.view("VOID", "GetLibraryAddress", "string", ["encrypt"], ["address"])
        jrn.a(rec, 'VOID library "encrypt" == deployed ENCRYPT',
              lib.lower() == st_["ENCRYPT"], lib)
        jrn.a(rec, "ENCRYPT.Type", chain.view("ENCRYPT", "Type", "", [], ["string"], to=st_["ENCRYPT"]) == "LibEncrypt")

    def s7(rec):
        # the fixed stack deploys BEFORE the wiring asserts: WORLDFIXED ->
        # WARFIXED -> verbatim GWAT (its constructor only reads LIVE contracts)
        cheon, meta_a, map_a = canon.address("CHEON"), canon.address("META"), canon.address("MAP")
        st_["WORLDFIXED"] = deploy_fixture(rec, "WORLDFIXED", ["address", "address", "address"], [cheon, meta_a, map_a])
        st_["WARFIXED"] = deploy_fixture(rec, "WARFIXED", ["address"], [st_["WORLDFIXED"]])
        st_["GWAT"] = deploy_fixture(rec, "GWAT", ["address"], [st_["WARFIXED"]])
        st_["VITUS"] = chain.view("WORLD", "Vitus", "", [], ["address"], to=st_["WORLDFIXED"]).lower()
        st_["H2O"] = chain.view("WAR", "Water", "", [], ["address"], to=st_["WARFIXED"]).lower()
        jrn.a(rec, "VITUS code present (deployed by WORLDFIXED ctor)", chain.code(st_["VITUS"]) != "0x", st_["VITUS"])
        jrn.a(rec, "H2O code present (deployed by WARFIXED ctor)", chain.code(st_["H2O"]) != "0x", st_["H2O"])

    def s8(rec):
        # spawn-gate honesty pre-claim: Faa draws 0 (Tail has no cauda yet) and
        # Gwat reverts SpawningFailure — the error the SIM frontend renders
        wr, gw = st_["WARFIXED"], st_["GWAT"]
        qing = st_["qing"]
        faa = decode(["uint256"], chain.eth_call(wr, canon.data("WAR", "Faa", "address,uint256", [qing, 1]), frm=DEPLOYER))[0]
        co2 = chain.view("WAR", "CO2", "", [], ["uint256"], to=wr)
        r = impersonated_send(rpc, chain, DEPLOYER, wr, canon.data("WAR", "Faa", "address,uint256", [qing, 1]), gas=9_000_000)
        jrn.a(rec, "Faa tx status 1 (pre-claim)", r["status"] == "0x1")
        jrn.a(rec, "Faa returns 0 pre-claim (Tail empty)", faa == 0, faa)
        jrn.a(rec, "CO2 unchanged", chain.view("WAR", "CO2", "", [], ["uint256"], to=wr) == co2)
        rd = revert_data(chain, gw, canon.data("GWAT", "Gwat", "address,uint256", [qing, 1]), frm=DEPLOYER)
        jrn.a(rec, "Gwat reverts SpawningFailure pre-claim",
              rd is not None and rd.startswith(SPAWNING_FAILURE), rd)

    def s9(rec):
        wf, wr, gwf = st_["WORLDFIXED"], st_["WARFIXED"], st_["GWAT"]
        qing, lat, lon = st_["qing"], st_["lat"], st_["lon"]
        yue = st_["aged_yue"]

        v_before = chain.view("VITUS", "balanceOf", "address", [yue], ["uint256"], to=st_["VITUS"])
        # GOTCHA (fork-found): WORLD.Code destructures Compliment's (lon, lat)
        # return as (qlat, qlon) — Code's "Latitude" IS Compliment's FIRST
        # word. The bounds check swaps the axes vs the app's lat/lon reading;
        # pass (lon, lat) to claim the anchor.
        r = impersonated_send(rpc, chain, DEPLOYER, wf, canon.data("WORLD", "Code", "int256,int256,address", [lon, lat, qing]), gas=9_000_000)
        jrn.a(rec, "WORLDFIXED.Code(anchor) status 1 (aged caller)", r["status"] == "0x1")
        buzz = chain.view("WORLD", "Buzz", "int256,address,address", [lon, yue, qing], ["uint256"], to=wf)
        jrn.a(rec, "creator Buzz credit > 0", buzz > 0, buzz)
        v_after = chain.view("VITUS", "balanceOf", "address", [yue], ["uint256"], to=st_["VITUS"])
        jrn.a(rec, "VITUS minted to the caller's YUE (Dione)", v_after > v_before, f"{v_before} -> {v_after}")
        tail = chain.view("WORLD", "Tail", "address,uint256", [qing, 1], ["uint256"], to=wf)
        jrn.a(rec, "THE CAUDA FIX PROOF: Tail > 0", tail > 0, tail)
        bun = chain.view("WORLD", "Bun", "int256,int256,address", [lon, lat, qing], ["uint256"], to=wf)
        jrn.info(rec, "tile Bun mass (Hypobar-weighted)", bun)
        # the box radius (Yeo = Chao/Iota) GROWS as the caller's Moments
        # accumulate — "one tile off" is only outside the box before the
        # first Beat. Pin the revert with a tile far beyond any Yeo box.
        rd = revert_data(chain, wf, canon.data("WORLD", "Code", "int256,int256,address", [lon + 10**30, lat, qing]), frm=DEPLOYER)
        jrn.a(rec, "Code one tile off reverts OutOfRange", rd is not None and rd.startswith(OUT_OF_RANGE), rd)
        jrn.info(rec, "gas Code", int(r["gasUsed"], 16))

        faa = decode(["uint256"], chain.eth_call(wr, canon.data("WAR", "Faa", "address,uint256", [qing, 1]), frm=DEPLOYER))[0]
        co2_before = chain.view("WAR", "CO2", "", [], ["uint256"], to=wr)
        h2o_before = chain.view("H2O", "balanceOf", "address", [yue], ["uint256"], to=st_["H2O"])
        r = impersonated_send(rpc, chain, DEPLOYER, wr, canon.data("WAR", "Faa", "address,uint256", [qing, 1]), gas=9_000_000)
        jrn.a(rec, "Faa tx status 1 (post-claim)", r["status"] == "0x1")
        jrn.a(rec, "Faa draw > 0 (the spawn gate opens)", faa > 0, faa)
        co2_after = chain.view("WAR", "CO2", "", [], ["uint256"], to=wr)
        h2o_after = chain.view("H2O", "balanceOf", "address", [yue], ["uint256"], to=st_["H2O"])
        jrn.a(rec, "CO2 advanced + H2O minted to the game YUE", co2_after > co2_before and h2o_after > h2o_before,
              f"co2 {co2_before}->{co2_after} h2o {h2o_before}->{h2o_after}")

        # GWAT's Mu.AddMarketRate(parent, 1e18) caps at parent.totalSupply()/777
        # (TokenMaximumRate — fork-found, 0xf4ccbd00): the parent venue needs
        # >= 777 tokens. Pump our venue to 780 units via mintToCap (the caller
        # became a venue owner through the s2 CHO bridge).
        qcap = chain.view("QING", "maxSupply", "", [], ["uint256"], to=qing)
        jrn.a(rec, "venue lottery cap allows the pump (>= 780 units)", qcap >= 780, qcap)
        mtc = canon.data("QING", "mintToCap", "", [])
        pumped = 0
        while chain.view("QING", "totalSupply", "", [], ["uint256"], to=qing) < 780 * UNIT and pumped < 2000:
            impersonated_send(rpc, chain, DEPLOYER, qing, mtc, gas=200_000)
            pumped += 1
        sup = chain.view("QING", "totalSupply", "", [], ["uint256"], to=qing)
        jrn.a(rec, "venue pumped past the 777-token rate cap", sup >= 780 * UNIT, f"supply={sup // UNIT} pumps={pumped}")

        spawned = None
        last_rd = None
        for _ in range(8):
            pre = create1(gwf, chain.nonce(gwf))
            r = impersonated_send(rpc, chain, DEPLOYER, gwf, canon.data("GWAT", "Gwat", "address,uint256", [qing, 1]), gas=12_000_000)
            if r["status"] == "0x1":
                spawned = pre
                break
            last_rd = revert_data(chain, gwf, canon.data("GWAT", "Gwat", "address,uint256", [qing, 1]), frm=DEPLOYER)
        jrn.a(rec, "GWAT.Gwat spawned the aged caller's sub-venue", spawned is not None, str(last_rd))
        mu = spawned
        jrn.a(rec, "code at spawned QING", chain.code(mu) != "0x", mu)
        username = chain.view("LAU", "Username", "", [], ["string"],
                              to=chain.view("CHO", "GetUserTokenAddress", "address", [DEPLOYER], ["address"]).lower())
        nm = chain.view("QING", "name", "", [], ["string"], to=mu)
        jrn.a(rec, "renamed '<user>'s <asset> GWAT'", nm == f"{username}'s Harness Asset GWAT", nm)
        jrn.a(rec, "symbol 骨<sym>", chain.view("QING", "symbol", "", [], ["string"], to=mu) == "骨HASS")
        mu_cap = chain.view("QING", "maxSupply", "", [], ["uint256"], to=mu)
        got = chain.view("GWAT", "balanceOf", "address", [DEPLOYER], ["uint256"], to=gwf)
        # the spawn mints Mu.maxSupply() to msg.sender; GWAT's OWN constructor
        # originMint (Random()%cap/10) also landed at tx.origin == the caller
        jrn.a(rec, "spawner owns the spawned full supply (+ ctor originMint <= cap/10)",
              got > mu_cap * UNIT and got - mu_cap * UNIT <= mu_cap * UNIT // 10,
              f"got={got} cap={mu_cap}")
        jrn.a(rec, "CHO cross-owns the spawned venue",
              chain.view("CHO", "owner", "address", [mu], ["bool"]) is True)
        swaat = chain.view("QING", "Waat", "", [], ["uint256"], to=mu)
        slon, slat = chain.view("Hecke", "Compliment", "uint256", [swaat], ["int256", "int256"], to=canon.address("HECKE"))
        jrn.a(rec, "GWAT tile map holds the spawn",
              chain.view("GWAT", "GetMapGwat", "int256,int256", [slat, slon], ["address"], to=gwf).lower() == mu,
              f"lat={slat} lon={slon}")
        st_["GWAT_QING"] = mu

    def s10(rec):
        vt, yue = st_["VITUS"], st_["aged_yue"]
        held = chain.view("VITUS", "balanceOf", "address", [yue], ["uint256"], to=vt)
        jrn.a(rec, "the aged YUE holds VITUS royalties", held > 0, held)
        r = impersonated_send(rpc, chain, DEPLOYER, canon.address("CHAN"), canon.data("CHAN", "OptIn", "address,bool", [vt, True]), gas=2_000_000)
        jrn.a(rec, "Chan.OptIn(VITUS) status 1", r["status"] == "0x1")
        # THE EXIT PIN (fork-found defect): the royalty exit reverts OnlyGame-
        # Tokens for EVERY asset — the YUE's hasMint staticcalls keccak("Mint(
        # address, uint256)") WITH A SPACE (0x7a2dd71a vs the real 0x0f6798a5),
        # so the probe matches no contract. YUE.Withdraw is dead code on the
        # live layer; the SIM frontend renders the exit honestly unavailable.
        has = decode(["bool"], chain.eth_call(yue, canon.data("YUE", "hasMint", "address", [vt]), frm=DEPLOYER))[0]
        jrn.a(rec, "YUE.hasMint(VITUS) == false (the spaced-selector probe)", has is False, str(has))
        rd = revert_data(chain, vt, canon.data("VITUS", "Withdraw", "uint256", [held // 2]), frm=DEPLOYER)
        jrn.a(rec, "VITUS.Withdraw reverts OnlyGameTokens(0xd65928ec)",
              rd is not None and rd.startswith("0xd65928ec"), rd)
        jrn.a(rec, "the royalty stays vault-held (no sanctioned exit)",
              chain.view("VITUS", "balanceOf", "address", [yue], ["uint256"], to=vt) == held)

    def s_enc(rec):
        # THE TWO-PARTY ROUND TRIP (session 59, fork-first for the SIM UI).
        # Parties: alice = the s1 player, bob = a FRESH actor with a fresh LAU
        # (both were tx.origin of their own LAU create — SHIOFactory.New adds
        # tx.origin to the SHIO's owners map, which is exactly the VIEW the
        # NotParty gate reads). The aged caller is NOT needed here: the
        # keystream is a deterministic modexp orbit over the pair's per-SHA
        # channels — no ladder lineage involved.
        enc = st_["ENCRYPT"]
        bob = Actor(chain)
        bob.fund(10_000)
        lau_f = canon.address("LAUFactory")
        bob_lau = create1(lau_f, chain.nonce(lau_f))
        bob.send(lau_f, canon.data("LAUFactory", "New", "string,string", ["Bob Cipher", "BOBC"]))
        jrn.a(rec, "bob's LAU deployed", chain.code(bob_lau) != "0x", bob_lau)
        alice_lau = st_["lau"]
        soul_alice = chain.view("LAU", "Saat", "uint256", [1], ["uint64"], to=alice_lau)
        soul_bob = chain.view("LAU", "Saat", "uint256", [1], ["uint64"], to=bob_lau)
        jrn.a(rec, "both souls resolve (uint64 Saat[1])", soul_alice > 0 and soul_bob > 0, f"alice={soul_alice} bob={soul_bob}")

        msg = "meet at the anchor tile"
        key = "bone-key"
        supply0 = chain.view("ENCRYPT", "totalSupply", "", [], ["uint256"], to=enc)

        # the preview is a pure eth_call — and the index is DETERMINISTIC (the
        # stream depends only on hashKey(key) + the pair's fixed SHA channels):
        # preview == committed, preview == re-preview
        idx_a = decode(["uint64"], chain.eth_call(
            enc, canon.data("ENCRYPT", "Encrypt", "uint64,uint64,string,string", [soul_alice, soul_bob, key, msg]), frm=player.addr))[0]
        idx_b = decode(["uint64"], chain.eth_call(
            enc, canon.data("ENCRYPT", "Encrypt", "uint64,uint64,string,string", [soul_alice, soul_bob, key, msg]), frm=player.addr))[0]
        jrn.a(rec, "the Encrypt preview index is deterministic", idx_a == idx_b and idx_a != 0, idx_a)

        r = player.send(enc, canon.data("ENCRYPT", "Encrypt", "uint64,uint64,string,string", [soul_alice, soul_bob, key, msg]))
        jrn.a(rec, "alice Encrypt -> bob status 1", r["status"] == "0x1")
        supply1 = chain.view("ENCRYPT", "totalSupply", "", [], ["uint256"], to=enc)
        # one string-Encrypt mints FOUR units: the string overload, the bytes
        # overload, Crypt AND hashKey each run _mintToCap (fork-pinned +4)
        jrn.a(rec, "Encrypt meters +4 units to the CONTRACT (string->bytes->Crypt+hashKey)",
              supply1 == supply0 + 4 * UNIT, f"{supply0} -> {supply1}")

        st_["enc_key"], st_["soul_alice"], st_["soul_bob"], st_["bob"] = key, soul_alice, soul_bob, bob.addr

        # bob decrypts: the round-trip proof (eth_call preview == the exact plaintext)
        dec = decode_bytes(chain.eth_call(
            enc, canon.data("ENCRYPT", "Decrypt", "uint64,uint64,uint64,string", [soul_alice, soul_bob, idx_a, key]), frm=bob.addr))
        jrn.a(rec, "bob's Decrypt round-trips the plaintext EXACTLY", dec == msg.encode(), dec)
        r = bob.send(enc, canon.data("ENCRYPT", "Decrypt", "uint64,uint64,uint64,string", [soul_alice, soul_bob, idx_a, key]))
        jrn.a(rec, "bob's Decrypt tx status 1", r["status"] == "0x1")

        # the party gates (the VIEW — the owners map, not the tx.origin modifier leg)
        burner = Actor(chain)
        burner.fund(1_000)
        rd = revert_data(chain, enc, canon.data("ENCRYPT", "Encrypt", "uint64,uint64,string,string", [soul_alice, soul_bob, key, msg]), frm=burner.addr)
        jrn.a(rec, "a third EOA encrypting AS alice reverts NotParty", rd is not None and rd.startswith(NOT_PARTY), rd)
        rd = revert_data(chain, enc, canon.data("ENCRYPT", "Decrypt", "uint64,uint64,uint64,string", [soul_alice, soul_bob, idx_a, key]), frm=player.addr)
        jrn.a(rec, "ALICE decrypting her own sent note reverts NotParty (the gate keys on TO)",
              rd is not None and rd.startswith(NOT_PARTY), rd)
        # FORK FINDING: the index is NOT pair-bound — Decrypt(from=bob,
        # to=alice, idx_a) from alice (she owns the TO side of THAT pair)
        # does NOT revert: it XORs the bob->alice keystream against the
        # alice->bob ciphertext and answers GARBAGE. The only guards are the
        # TO-side party gate, the key, and the index.
        swapped = decode_bytes(chain.eth_call(
            enc, canon.data("ENCRYPT", "Decrypt", "uint64,uint64,uint64,string", [soul_bob, soul_alice, idx_a, key]), frm=player.addr))
        jrn.a(rec, "the swapped-pair decrypt SUCCEEDS with garbage (no pair binding)",
              swapped != msg.encode(), swapped)

        # the reply direction works too (bob -> alice)
        idx2 = decode(["uint64"], chain.eth_call(
            enc, canon.data("ENCRYPT", "Encrypt", "uint64,uint64,string,string", [soul_bob, soul_alice, key, "ack"]), frm=bob.addr))[0]
        r = bob.send(enc, canon.data("ENCRYPT", "Encrypt", "uint64,uint64,string,string", [soul_bob, soul_alice, key, "ack"]))
        jrn.a(rec, "bob's reply Encrypt status 1", r["status"] == "0x1")
        dec2 = decode_bytes(chain.eth_call(
            enc, canon.data("ENCRYPT", "Decrypt", "uint64,uint64,uint64,string", [soul_bob, soul_alice, idx2, key]), frm=player.addr))
        jrn.a(rec, "alice decrypts the reply", dec2 == b"ack", dec2)

    def s_exp(rec):
        # EXPIRY + PRUNE (session 59). Expiry: past 10 days the entry decrypts
        # ONCE more (the delete fires AFTER the result is computed), then the
        # same call answers EMPTY bytes. Prune: the wrong-key-domain defect —
        # it iterates _encryptions[ARRAY POSITION] while entries are keyed by
        # KEYSTREAM INDEX, so it mangles the (private) enumeration but leaves
        # BOTH live and expired entries decryptable.
        enc = st_["ENCRYPT"]
        key, sa, sb = st_["enc_key"], st_["soul_alice"], st_["soul_bob"]

        idx3 = decode(["uint64"], chain.eth_call(
            enc, canon.data("ENCRYPT", "Encrypt", "uint64,uint64,string,string", [sa, sb, key, "expiring secret"]), frm=player.addr))[0]
        r = player.send(enc, canon.data("ENCRYPT", "Encrypt", "uint64,uint64,string,string", [sa, sb, key, "expiring secret"]))
        jrn.a(rec, "fresh entry status 1", r["status"] == "0x1")

        st, _ = rpc.call("evm_increaseTime", [TEN_DAYS + 24 * 3600])
        jrn.a(rec, "anvil time advanced past the 10-day expiry", st == "ok")
        rpc.call("evm_mine", [])

        dec = decode_bytes(chain.eth_call(
            enc, canon.data("ENCRYPT", "Decrypt", "uint64,uint64,uint64,string", [sa, sb, idx3, key]), frm=st_["bob"]))
        jrn.a(rec, "expired entry still decrypts (preview — the delete fires after the read)", dec == b"expiring secret", dec)
        r = impersonated_send(rpc, chain, st_["bob"], enc, canon.data("ENCRYPT", "Decrypt", "uint64,uint64,uint64,string", [sa, sb, idx3, key]), gas=3_000_000)
        jrn.a(rec, "the expired Decrypt tx status 1 (delete-after-read)", r["status"] == "0x1")
        dec = decode_bytes(chain.eth_call(
            enc, canon.data("ENCRYPT", "Decrypt", "uint64,uint64,uint64,string", [sa, sb, idx3, key]), frm=st_["bob"]))
        jrn.a(rec, "the SECOND decrypt answers EMPTY (the entry is gone)", len(dec) == 0, dec)

        # a LIVE entry (created after the time travel) + an EXPIRED-untouched
        # entry both survive Prune — the defect pin
        idx4 = decode(["uint64"], chain.eth_call(
            enc, canon.data("ENCRYPT", "Encrypt", "uint64,uint64,string,string", [sa, sb, key, "live one"]), frm=player.addr))[0]
        player.send(enc, canon.data("ENCRYPT", "Encrypt", "uint64,uint64,string,string", [sa, sb, key, "live one"]))
        idx5 = decode(["uint64"], chain.eth_call(
            enc, canon.data("ENCRYPT", "Encrypt", "uint64,uint64,string,string", [sa, sb, key, "stale one"]), frm=player.addr))[0]
        player.send(enc, canon.data("ENCRYPT", "Encrypt", "uint64,uint64,string,string", [sa, sb, key, "stale one"]))
        rpc.call("evm_increaseTime", [TEN_DAYS + 24 * 3600])
        rpc.call("evm_mine", [])

        r = impersonated_send(rpc, chain, st_["bob"], enc, canon.data("ENCRYPT", "Prune", "", []), gas=3_000_000)
        jrn.a(rec, "Prune tx status 1 (public, metered)", r["status"] == "0x1")
        dec4 = decode_bytes(chain.eth_call(
            enc, canon.data("ENCRYPT", "Decrypt", "uint64,uint64,uint64,string", [sa, sb, idx4, key]), frm=st_["bob"]))
        jrn.a(rec, "the LIVE entry still decrypts post-Prune", dec4 == b"live one", dec4)
        dec5 = decode_bytes(chain.eth_call(
            enc, canon.data("ENCRYPT", "Decrypt", "uint64,uint64,uint64,string", [sa, sb, idx5, key]), frm=st_["bob"]))
        jrn.a(rec, "THE DEFECT: the EXPIRED entry also survives Prune (wrong key domain)",
              dec5 == b"stale one", dec5)

    def s11(rec):
        layer = {
            "WORLD": st_["WORLDFIXED"],
            "VITUS": st_["VITUS"],
            "WAR": st_["WARFIXED"],
            "H2O": st_["H2O"],
            "GWAT": st_["GWAT"],
            "ENCRYPT": st_["ENCRYPT"],
        }
        want = {
            "$provenance": (
                "GENERATED by harness/anvil_flows_set3.py at the recorded pin — deterministic "
                "CREATE1 from the deployer EOA in the fixed deploy order. NEVER hand-edit; "
                "re-run the suite to regenerate on a re-pin. The never-deployed layer has NO "
                "live addresses (config/addresses.json $provenance); these are fork fixtures "
                "only (IA-PLAN §8 — a future live deployment would carry NEW addresses)."
            ),
            "pin": args.fork_block if not args.rpc else None,
            "deployedBy": DEPLOYER.lower(),
            "layer": layer,
            "variants": (
                "WORLD/VITUS/WAR/H2O are the fixture-FIXED deployments (harness/fixtures/"
                "world-layer/src: the verbatim sources are UNDEPLOYABLE — VITUS/H2O "
                "constructors call back into the parent under construction, the failed "
                "wave-5 create; WORLD additionally never writes _cauda so the spawn chain "
                "is dead). GWAT and ENCRYPT are VERBATIM (byte-pinned)."
            ),
            "notes": {
                "ENCRYPT": "self-registered as VOID's 'encrypt' library on the fork",
                "GWAT_QING": st_.get("GWAT_QING"),
            },
        }
        if OVERLAY.exists():
            have = json.loads(OVERLAY.read_text())
            jrn.a(rec, "overlay == config/sim_addresses.json",
                  {k: have.get(k) for k in ("pin", "deployedBy", "layer", "variants")} ==
                  {k: want[k] for k in ("pin", "deployedBy", "layer", "variants")},
                  json.dumps({k: have.get(k) for k in ("pin", "layer")}))
        else:
            OVERLAY.write_text(json.dumps(want, indent=2) + "\n")
            jrn.info(rec, "overlay WRITTEN — commit config/sim_addresses.json", str(OVERLAY))

    def s12(rec):
        jrn.a(rec, "chain id 369", chain.chain_id() == 369)
        for name in ("WORLDFIXED", "WARFIXED", "GWAT", "ENCRYPT", "VITUS", "H2O"):
            jrn.a(rec, f"{name} still deployed", chain.code(st_[name]) != "0x")
        jrn.a(rec, "YUE still maps to player",
              chain.view("CHAN", "Yan", "address", [player.addr], ["address"]).lower() == st_["yue"])
        jrn.a(rec, "the failed verbatim WORLD create left no code",
              chain.code(st_["WORLD_BROKEN"]) == "0x", st_["WORLD_BROKEN"])
        jrn.info(rec, "final CO2", chain.view("WAR", "CO2", "", [], ["uint256"], to=st_["WARFIXED"]))

    jrn.step("0 preflight + fixture pins", s0)
    jrn.step("1 player + venue", s1)
    jrn.step("2 the aged caller (mariarahel) + fresh floor pin", s2)
    jrn.step("3 verbatim creation-revert pins + ENCRYPT deploy", s3)
    jrn.step("4 fixed-stack deploy (WORLDFIXED/WARFIXED/GWAT)", s7)
    jrn.step("5 WORLD wiring + VITUS seed", s4)
    jrn.step("6 WAR wiring + H2O seed", s5)
    jrn.step("7 ENCRYPT registration", s6)
    jrn.step("8 spawn-gate honesty (pre-claim)", s8)
    jrn.step("9 the loop proof: Code + Faa + GWAT spawn", s9)
    jrn.step("10 VITUS royalty exit (CHAN escrow)", s10)
    jrn.step("11 ENCRYPT two-party round trip + party gates", s_enc)
    jrn.step("12 ENCRYPT expiry + Prune (the wrong-key-domain defect)", s_exp)
    jrn.step("13 SIM overlay", s11)
    jrn.step("14 invariants", s12)

    ok = jrn.finish()
    fork.stop()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
