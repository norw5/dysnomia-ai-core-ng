#!/usr/bin/env python3
"""Flow set 2 (HARNESS.md §3 items 2/4/5) — Beat + DSS + approval-gate asserts.

Runs on its own managed fork (same pin policy as set 1). Steps:

  0  preflight (chain id 369)
  1  onboarding-lite: LAUFactory.New → Username → SEI.Start → CHOA.Play
  2  venue: MockAsset deploy + MAP.New (fresh QING + Waat)
  3  whale funding (fork-only): Ⓐ from a whale candidate to the player;
     FornaxSHIO into the player's LAU (the XIE.Power numerator floor)
  4  the Ⓐ-bridge mechanics (state-delta asserts on the venue-token
     acquisition path: rate → approve → Purchase → transfer → Yuan tiers)
  5  META.Beat DRYRUN pin: the fresh probe caller panics 0x12 — RESOLVED
     mechanism (owner txs replayed green): the deployed RING.Eta() returns
     (14,0,0,0) for fresh callers (vault-reactor lineage; Eta is NON-VIEW in
     the tree) and Beat divides by an Eta slot. Beat itself WORKS for aged
     callers; the "wedged"/"Yuan floor" session-40 claims are retracted.
     PANG.Push below works (asserted).
  6  META.Beat tx: asserts the same revert for this fresh caller (status 0)
     with gas inside the census envelope (1.5M..2.4M — observed 1,926,388 ≈
     the historical median 1,916,016)
  7  DSS deploy (fixtures/dss, solc 0.8.21) + runtime byte-pin; exact-amount
     player approval (1e18 Ⓐ, never MaxUint256); chatAndSnipe state deltas
  8  approval-gate + fallback: Purchase without Ⓐ approval reverts; snipe
     with spent allowance reverts; plain-chat fallback below 1 Ⓐ mints, no Ⓐ
  9  CHEON.Su settle (session-50 venue depth): the DRYRUN decodes the bars;
     the send advances YUE.Bar monotonically and matches the pure preview
     (quiet fork — no interleaving callers); CHEON at cap ⇒ meter is a no-op
     (supply unchanged, kb §5)
 10  DO.Take — the deed (session-51 B1.4, fork-audit corrected): the gate
     keys on the WRAPPED ASSET (own user token / asset owner / asset
     Creator); an asset answering neither probe reverts Take raw; an
     ineligible Take and a second Take on a taken venue are SILENT NO-OPs
     (status 1, nothing happens); on success the owner probe flips and DO
     mints exactly 1 to the USER TOKEN
  11  MAP.New late-revert + the CHO Qu-claim observation (session-51 B1.8):
      an evil asset (name()/symbol() staticcall-succeed with EMPTY
      returndata) forces the rename decode to revert AFTER the CHO.Luo()
      draw; the fork observes whether the drawn Qu claim survives the revert
      (kb/dev/map.md's "permanent scar" claim) — EVM semantics say the whole
      tx rolls back and the retry re-draws (and re-claims) the SAME De
  12  the YUE exchange desk (session-52 B1.5): GetAssetRate no-route → rate
      the venue for its OWN asset → the direct pair returns the POSTED rate
      (the 777-mod attenuation divides a zero accumulator on hop one — it
      can never bite on a direct pair); Hong and Hung BOTH pay from the
      VAULT'S OWN INVENTORY (every transfer inside the desk is called BY the
      YUE — fork-corrected: the venue is never the counterparty); the
      approval gates (the base transferFrom reverts internally — the "Need
      Approved" requires in yue.sol are unreachable on the DYSNOMIA base);
      + the base Ⓐ Redeem leg (the venue-token allowance with spender ==
      THE VENUE ITSELF; pays from the Ⓐ escrow Purchase filled)
  13  identity enrichment + the LAU pocket sweep + the venue-label
      semantics + the CHO address-book walk (session-53 B1.6/7): the Bao
      structural pins (On.Phi == the channel; Saat[2] == SIU.Aura());
      Withdraw moves the pocket unmetered; VOID's session is msg.sender-
      keyed (lives AT THE LAU — labels go through the LAU wrapper; the
      VIEW has no session gate: unentered senders read the soul-0 grades
      and revert AliasNotFound, while NoUserEntry lives only on the WRITE);
      the CHO book: 103 entries at the pin, all resolvable, inside the
      app's 160 probe bound
  14  LAU emission desk + the DSS desk + the deployment gate surface
      (session-66): every owner action meters 1 LAU unit into a PUBLICLY
      PURCHASABLE pool (1 Ⓐ/unit — the front-run window the DSS closes
      atomically); mintToCap mints SILENTLY (batch self-mint needs no
      chat) and one Purchase collects N units for N Ⓐ; LAU.Chat posts
      "<Username> …" onto the WORLD SHIO (the composer's WORLD leg); a
      sniper wallet proves the front-run; the deploy DRYRUN shape
      (eth_call with no `to`) + CREATE1 prediction == receipt address

Usage: python3 harness/anvil_flows_set2.py [--keep | --rpc URL | --fork-block N]
"""

from __future__ import annotations

import argparse
import json
import os
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
    selector,
)

MAX_UINT256 = 2**256 - 1
DEPLOYER = "0x0474606332105A1dA6FC8EF7De2470551D389Cb9"  # HARNESS.md §1 tx.origin of the system
WHALE_CANDIDATES = [DEPLOYER, "PhobosQING", "CHO", "VOID", "CHOA", "META", "XIE", "SEI"]
FUND_AFFECTION = 100 * UNIT
FUND_FORNAX = 100 * UNIT
PANIC_DIV0 = "0x4e487b710000000000000000000000000000000000000000000000000000000000000012"
OFFSET = 476733977057179  # Meridians[0] — the MAP.New Waat multiplier (kb/dev/map.md §4)


def dss_data(fname: str, ftypes: str, args_: list) -> str:
    """DSS is a harness fixture, not in abi/index — hand-encode. NOTE:
    anvil_flows.encode() already returns BARE hex (no 0x) — do not strip."""
    return selector(fname, ftypes) + encode(ftypes.split(","), args_)


def erc20_data(fname: str, ftypes: str, args_: list) -> str:
    """AFFECTION is IAlchemicalGold in the index (burn/mint only) — its ERC-20
    surface is hand-encoded with keccak selectors, self-checked against the
    index's IERC20 pins where available."""
    return selector(fname, ftypes) + (encode(ftypes.split(","), args_) if ftypes else "")


def do_view(fname: str) -> str:
    """DO has no recovered source — hand-encoded no-arg view calldata
    (totalSupply/balanceOf rides the IERC20 pins from s0)."""
    return selector(fname, "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpc", default=None)
    ap.add_argument("--fork-url", default=os.environ.get("DYS_FORK_URL", "https://rpc.pulsechain.com"))
    ap.add_argument("--fork-block", type=int, default=int(os.environ.get("DYS_FORK_BLOCK", 27674000)))
    ap.add_argument("--port", type=int, default=8545)
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
        "suite": "set2",
        "rpc": fork_url,
        "managed_fork": not bool(args.rpc),
        "fork_block": None if args.rpc else args.fork_block,
        "chain_id": chain.chain_id(),
        "head_at_start": chain.block_number(),
    }
    jrn = Journal(meta)
    print(json.dumps(meta))

    player = Actor(chain)
    player.fund(2_000_000)
    fx = Path(__file__).resolve().parent / "fixtures"
    mock_creation = (fx / "mock_asset.creation.hex").read_text().strip().removeprefix("0x")
    mock_runtime = (fx / "mock_asset.runtime.hex").read_text().strip().removeprefix("0x")
    evil_creation = (fx / "evil_asset.creation.hex").read_text().strip().removeprefix("0x")
    evil_runtime = (fx / "evil_asset.runtime.hex").read_text().strip().removeprefix("0x")
    dss_creation = (fx / "dss.creation.hex").read_text().strip().removeprefix("0x")
    dss_runtime = (fx / "dss.runtime.hex").read_text().strip().removeprefix("0x")
    dss_fixed_creation = (fx / "dss_fixed.creation.hex").read_text().strip().removeprefix("0x")
    dss_fixed_runtime = (fx / "dss_fixed.runtime.hex").read_text().strip().removeprefix("0x")

    affection = canon.address("AFFECTION")
    fornax = canon.address("FornaxSHIO")

    def bal_erc20(token: str, who: str, frm: str | None = None) -> int:
        return int(chain.eth_call(token, erc20_data("balanceOf", "address", [who]), frm=frm), 16)

    def bal(token_name: str, who: str) -> int:
        # index-typed views: QING/SHIO are template names; address via `to`
        if token_name == "FornaxSHIO":
            return chain.view("SHIO", "balanceOf", "address", [who], ["uint256"], to=fornax)
        if token_name == "QING":
            return chain.view("QING", "balanceOf", "address", [who], ["uint256"], to=st_["qing"])
        return chain.view(token_name, "balanceOf", "address", [who], ["uint256"])

    st_ = {}

    def impersonated_send(frm: str, to: str, data: str) -> str:
        st, _ = rpc.call("anvil_impersonateAccount", [frm])
        if st != "ok":
            raise HarnessError(f"impersonate failed for {frm}")
        st, txh = rpc.call("eth_sendTransaction", [{"from": frm, "to": to, "data": data}])
        if st != "ok":
            raise HarnessError(f"impersonated send failed: {txh}")
        return txh

    def force_send(to: str, data: str, gas: int = 1_000_000) -> dict:
        """signed send with explicit gas — for txs we EXPECT to revert (raw_send
        estimates first and would raise on the revert)."""
        tx = {
            "nonce": chain.nonce(player.addr),
            "to": to_checksum_address(to),
            "value": 0,
            "gas": gas,
            "gasPrice": int(chain.gas_price() * 1.2) + 1_000_000,
            "data": data,
            "chainId": 369,
        }
        signed = player.acct.sign_transaction(tx)
        st, res = rpc.call("eth_sendRawTransaction", ["0x" + signed.raw_transaction.hex()])
        if st != "ok":
            raise HarnessError(f"force_send rejected: {res}")
        return player.wait(res)

    def s0(rec):
        jrn.a(rec, "fork chain id 369", chain.chain_id() == 369, chain.chain_id())
        jrn.a(rec, "IERC20 selector pins (hand-encoding self-check)",
              selector("balanceOf", "address") == "0x70a08231"
              and selector("approve", "address,uint256") == "0x095ea7b3"
              and selector("allowance", "address,address") == "0xdd62ed3e"
              and selector("transfer", "address,uint256") == "0xa9059cbb")

    def s1(rec):
        # onboarding-lite (the set-1 order: Username MUST precede Start)
        factory = canon.address("LAUFactory")
        lau = create1(factory, chain.nonce(factory))
        r = player.send(factory, canon.data("LAUFactory", "New", "string,string", ["Beat Player", "BPLR"]))
        jrn.a(rec, "LAUFactory.New status 1", r["status"] == "0x1", lau)
        jrn.a(rec, "code at LAU", chain.code(lau) != "0x", lau)
        r = player.send(lau, canon.data("LAU", "Username", "string", ["beat_ng"]))
        jrn.a(rec, "Username status 1", r["status"] == "0x1")
        sei = canon.address("SEI")
        yue = create1(sei, chain.nonce(sei))
        r = player.send(sei, canon.data("SEI", "Start", "address,string,string", [lau, "Beat Yue", "BYUE"]))
        jrn.a(rec, "SEI.Start status 1", r["status"] == "0x1", yue)
        jrn.a(rec, "Chan.Yan(player) == YUE",
              chain.view("CHAN", "Yan", "address", [player.addr], ["address"]).lower() == yue, yue)
        r = player.send(canon.address("CHOA"), canon.data("CHOA", "Play", "address", [lau]))
        jrn.a(rec, "CHOA.Play status 1 (sets user Entropy)", r["status"] == "0x1")
        st_["lau"], st_["yue"] = lau, yue

    def s2(rec):
        asset = create1(player.addr, chain.nonce(player.addr))
        r0 = player.deploy(mock_creation)
        jrn.a(rec, "mock deploy status 1", r0["status"] == "0x1")
        jrn.a(rec, "mock runtime byte-pin", chain.code(asset)[2:] == mock_runtime)
        mp = canon.address("MAP")
        qing = create1(mp, chain.nonce(mp))
        r = player.send(mp, canon.data("MAP", "New", "address", [asset]))
        jrn.a(rec, "MAP.New status 1", r["status"] == "0x1", qing)
        waat = chain.view("QING", "Waat", "", [], ["uint256"], to=qing)
        jrn.a(rec, "Waat > 0", waat > 0, waat)
        jrn.a(rec, "MAP.GetQing(waat) == qing",
              chain.view("MAP", "GetQing", "uint256", [waat], ["address"]).lower() == qing)
        st_["qing"], st_["waat"], st_["mock_asset"] = qing, waat, asset

    def s3(rec):
        lau = st_["lau"]
        cho = canon.address("CHO")

        a_whale = None
        f_whale = None
        c_whale = None
        for name in WHALE_CANDIDATES:
            try:
                addr = DEPLOYER if name == DEPLOYER else canon.address(name)
            except HarnessError:
                continue
            if a_whale is None and bal_erc20(affection, addr) >= FUND_AFFECTION:
                a_whale = addr
            if f_whale is None and bal("FornaxSHIO", addr) >= FUND_FORNAX:
                f_whale = addr
            if c_whale is None and chain.view("CHO", "balanceOf", "address", [addr], ["uint256"]) >= FUND_FORNAX:
                c_whale = addr
        jrn.a(rec, "AFFECTION whale found among candidates", a_whale is not None, str(a_whale))
        jrn.a(rec, "FornaxSHIO whale found among candidates", f_whale is not None, str(f_whale))
        jrn.a(rec, "CHO whale found among candidates (the Tethys modulus floor)", c_whale is not None, str(c_whale))

        txh = impersonated_send(a_whale, affection,
                                erc20_data("transfer", "address,uint256", [player.addr, FUND_AFFECTION]))
        jrn.a(rec, "whale Ⓐ transfer status 1", player.wait(txh)["status"] == "0x1")
        got_a = bal_erc20(affection, player.addr)
        jrn.a(rec, "player Ⓐ funded", got_a >= FUND_AFFECTION, got_a)

        # FornaxSHIO is SHIO-typed: index selectors apply, address from perimeter
        txh = impersonated_send(f_whale, fornax,
                                canon.data("SHIO", "transfer", "address,uint256", [lau, FUND_FORNAX]))
        jrn.a(rec, "whale Fornax transfer status 1", player.wait(txh)["status"] == "0x1")
        got_f = bal("FornaxSHIO", lau)
        jrn.a(rec, "Fornax floor funded in LAU (XIE.Power numerator)", got_f >= FUND_FORNAX, got_f)

        # CHO into wallet + LAU: Yuan(CHO) is a modExp modulus in ZI.Spin —
        # zero CHO holdings panic 0x12 exactly like the venue-token floor
        txh = impersonated_send(c_whale, cho,
                                canon.data("CHO", "transfer", "address,uint256", [player.addr, FUND_FORNAX]))
        jrn.a(rec, "whale CHO transfer (wallet) status 1", player.wait(txh)["status"] == "0x1")
        txh = impersonated_send(c_whale, cho,
                                canon.data("CHO", "transfer", "address,uint256", [lau, FUND_FORNAX]))
        jrn.a(rec, "whale CHO transfer (LAU) status 1", player.wait(txh)["status"] == "0x1")
        got_c = chain.view("CHO", "balanceOf", "address", [player.addr], ["uint256"])
        jrn.a(rec, "CHO funded (wallet + LAU tiers)", got_c >= FUND_FORNAX, got_c)
        st_["a_whale"], st_["f_whale"] = a_whale, f_whale

    def s4(rec):
        # the Ⓐ-bridge mechanics: acquire venue tokens and exercise the Yuan tiers
        # (also demonstrates the fresh-caller panic independent of funding — the
        # Eta lineage floor, not a holdings floor; see s5)
        lau = st_["lau"]
        qing = st_["qing"]
        choa = canon.address("CHOA")

        yuan_zero = chain.eth_call(choa, canon.data("CHOA", "Yuan", "address", [qing]), frm=player.addr)
        jrn.a(rec, "CHOA.Yuan(fresh qing) == 0 before venue holdings", int(yuan_zero, 16) == 0, yuan_zero)

        panicked = False
        try:
            chain.eth_call(canon.address("META"), canon.data("META", "Beat", "uint256", [st_["waat"]]),
                           frm=player.addr)
        except HarnessError as e:
            panicked = PANIC_DIV0 in str(e)
            jrn.info(rec, "unfunded Beat preview revert", str(e)[-80:])
        jrn.a(rec, "unfunded Beat preview panics 0x12 (fresh-caller Eta lineage floor, funding-independent)", panicked)

        # fresh QINGs (v2 base) carry NO AFFECTION market rate — MarketRateNotFound.
        # Only CHO owns a fresh venue (MAP.New adds CHO, not the creator); route
        # ownership through CHO.AddContractOwner — fork-legal, impersonating the
        # deployer EOA (a CHO owner), exactly the admin move that rated live venues.
        rate_missing = False
        try:
            chain.eth_call(qing, canon.data("QING", "Purchase", "address,uint256", [affection, UNIT]),
                           frm=player.addr)
        except HarnessError as e:
            rate_missing = "0x90b23441" in str(e)
        jrn.a(rec, "QING.Purchase(AFFECTION) reverts MarketRateNotFound before a rate exists", rate_missing)
        txh = impersonated_send(DEPLOYER, canon.address("CHO"),
                                canon.data("CHO", "AddContractOwner", "address,address", [qing, player.addr]))
        jrn.a(rec, "CHO.AddContractOwner(qing, player) status 1 (deployer-impersonated)",
              player.wait(txh)["status"] == "0x1")
        jrn.a(rec, "player is now a QING owner",
              chain.view("QING", "owner", "address", [player.addr], ["bool"], to=qing) is True)
        r = player.send(qing, canon.data("QING", "AddMarketRate", "address,uint256", [affection, UNIT]))
        jrn.a(rec, "AddMarketRate(AFFECTION, 1e18) status 1", r["status"] == "0x1")

        # acquire venue tokens via the Ⓐ bridge: approve exact, Purchase 1:1
        r = player.send(affection, erc20_data("approve", "address,uint256", [qing, 2 * UNIT]))
        jrn.a(rec, "exact Ⓐ approve(qing, 2e18) status 1", r["status"] == "0x1")
        r = player.send(qing, canon.data("QING", "Purchase", "address,uint256", [affection, 2 * UNIT]))
        jrn.a(rec, "QING.Purchase status 1 (Ⓐ bridge)", r["status"] == "0x1")
        wallet_q = bal("QING", player.addr)
        jrn.a(rec, "player holds 2 QING from the purchase", wallet_q == 2 * UNIT, wallet_q)

        # park 1 QING in the LAU — the 10× Yuan tier
        r = player.send(qing, canon.data("QING", "transfer", "address,uint256", [lau, UNIT]))
        jrn.a(rec, "QING transfer wallet→LAU status 1", r["status"] == "0x1")
        yuan = int(chain.eth_call(choa, canon.data("CHOA", "Yuan", "address", [qing]), frm=player.addr), 16)
        jrn.a(rec, "Yuan(qing) == 1e18 wallet + 10e18 LAU = 11e18", yuan == 11 * UNIT, yuan)

    def s5(rec):
        waat = st_["waat"]
        meta_c = canon.address("META")

        # fully funded (Yuan(qing)=11e18, Yuan(CHO)>0, Fornax in the LAU) —
        # yet this FRESH caller panics: the deployed RING.Eta() returns
        # (14,0,0,0) for callers without vault-reactor lineage and Beat
        # divides by an Eta slot. RESOLVED with owner txs (replayed green);
        # see README gotchas. Pure preview ⇒ deterministic for THIS caller.
        panicked = False
        try:
            chain.eth_call(meta_c, canon.data("META", "Beat", "uint256", [waat]), frm=player.addr)
        except HarnessError as e:
            panicked = PANIC_DIV0 in str(e)
            jrn.info(rec, "funded Beat preview revert", str(e)[-80:])
        jrn.a(rec, "fresh caller panics 0x12 (Eta=(14,0,0,0) — vault-reactor lineage floor; Beat works for aged callers)", panicked)

        # Eta is tx.origin-sensitive: call from the player.
        eta = decode(["uint256", "uint256", "uint256", "uint256"], chain.eth_call(
            canon.address("RING"), canon.data("RING", "Eta", "", []), frm=player.addr))
        phoebe, iota1, chao, charge1 = [int(x) for x in eta]
        jrn.info(rec, "RING.Eta() (3rd revision)",
                 f"Phoebe={phoebe} Iota1={iota1} Chao={chao} Charge1={charge1}")

        # the layer below META still functions
        out = decode(["uint256", "uint256", "uint256", "uint256", "uint256"], chain.eth_call(
            canon.address("PANG"), canon.data("PANG", "Push", "uint256", [waat]), frm=player.addr))
        jrn.info(rec, "PANG.Push preview", f"Iota={out[0]} Omicron={out[1]} Eta={out[2]} Omega={out[3]} Charge={out[4]}")
        jrn.a(rec, "PANG.Push (the layer under Beat) succeeds for the funded player", True)

    def s6(rec):
        waat = st_["waat"]
        meta_c = canon.address("META")
        r = force_send(meta_c, canon.data("META", "Beat", "uint256", [waat]), gas=3_000_000)
        jrn.a(rec, "Beat tx reverts for this fresh caller (status 0; aged callers succeed)", r["status"] == "0x0")
        gas = int(r["gasUsed"], 16)
        jrn.a(rec, "revert gas inside the census envelope (median 1,916,016)",
              1_500_000 <= gas <= 2_400_000, gas)
        jrn.info(rec, "gas META.Beat (reverted)", gas)

    def s7(rec):
        lau = st_["lau"]
        dss_creation_arg = lau[2:].lower().rjust(64, "0")

        # (a) the AS-SHIPPED gist: byte-pin + the init-order bug made explicit
        dss = create1(player.addr, chain.nonce(player.addr))
        r = player.deploy(dss_creation + dss_creation_arg)
        jrn.a(rec, "as-shipped DSS deploy status 1", r["status"] == "0x1", dss)
        jrn.a(rec, "as-shipped DSS runtime byte-pin (fixtures/dss)", chain.code(dss)[2:] == dss_runtime, dss)
        r = force_send(dss, dss_data("chatAndSnipe", "string", ["as-shipped"]), gas=1_500_000)
        jrn.a(rec, "as-shipped chatAndSnipe REVERTS (LAUContract bound ILAU(0) at declaration — session-40 finding)",
              r["status"] == "0x0")
        st_["dss_shipped"] = dss

        # (b) the one-line-fixed fixture (dss-fixed) — validates the SEMANTICS:
        # chat mints 1 LAU to the LAU; 1 Ⓐ buys it; owner receives it
        dss2 = create1(player.addr, chain.nonce(player.addr))
        r = player.deploy(dss_fixed_creation + dss_creation_arg)
        jrn.a(rec, "DSSFixed deploy status 1", r["status"] == "0x1", dss2)
        jrn.a(rec, "DSSFixed runtime byte-pin (fixtures/dss-fixed)", chain.code(dss2)[2:] == dss_fixed_runtime, dss2)

        # exact-amount approval — NEVER MaxUint256 (the standing approval rule)
        r = player.send(affection, erc20_data("approve", "address,uint256", [dss2, UNIT]))
        jrn.a(rec, "approve status 1", r["status"] == "0x1")
        allowance = int(chain.eth_call(
            affection, erc20_data("allowance", "address,address", [player.addr, dss2])), 16)
        jrn.a(rec, "exact-amount allowance == 1e18", allowance == UNIT, allowance)
        jrn.a(rec, "allowance is NOT MaxUint256", allowance != MAX_UINT256)

        lau_supply_before = chain.view("LAU", "totalSupply", "", [], ["uint256"], to=lau)
        player_lau_before = chain.view("LAU", "balanceOf", "address", [player.addr], ["uint256"], to=lau)
        player_a_before = bal_erc20(affection, player.addr)
        r = player.send(dss2, dss_data("chatAndSnipe", "string", ["self-snipe from ng harness"]))
        jrn.a(rec, "DSSFixed chatAndSnipe status 1", r["status"] == "0x1")
        jrn.a(rec, "player LAU +1e18 (sniped the chat mint)",
              chain.view("LAU", "balanceOf", "address", [player.addr], ["uint256"], to=lau) - player_lau_before == UNIT)
        jrn.a(rec, "player Ⓐ -1e18 (the 1-Ⓐ-per-token price)",
              player_a_before - bal_erc20(affection, player.addr) == UNIT)
        jrn.a(rec, "LAU supply +1e18 (the chat mint)",
              chain.view("LAU", "totalSupply", "", [], ["uint256"], to=lau) - lau_supply_before == UNIT)
        st_["dss"] = dss2

    def s8(rec):
        lau = st_["lau"]
        dss = st_["dss"]

        # allowance spent → snipe reverts (exact-amount approve means once-only)
        r = force_send(dss, dss_data("chatAndSnipe", "string", ["second snipe"]), gas=1_500_000)
        jrn.a(rec, "chatAndSnipe with spent allowance reverts", r["status"] == "0x0")

        # LAU.Purchase without Ⓐ approval reverts (the approval gate, onchain leg)
        r = force_send(lau, canon.data("LAU", "Purchase", "address,uint256", [affection, UNIT]))
        jrn.a(rec, "Purchase without Ⓐ approval reverts", r["status"] == "0x0")

        # below-1-Ⓐ fallback: plain chat through the DSS still mints, costs no Ⓐ
        lau_supply_before = chain.view("LAU", "totalSupply", "", [], ["uint256"], to=lau)
        player_a_before = bal_erc20(affection, player.addr)
        r = player.send(dss, dss_data("chat", "string", ["plain fallback below 1 Ⓐ"]))
        jrn.a(rec, "DSS.chat fallback status 1", r["status"] == "0x1")
        jrn.a(rec, "fallback mints 1 LAU",
              chain.view("LAU", "totalSupply", "", [], ["uint256"], to=lau) - lau_supply_before == UNIT)
        jrn.a(rec, "fallback costs no Ⓐ", bal_erc20(affection, player.addr) == player_a_before)

    def s9(rec):
        # CHEON.Su(qing) — the settle verb (kb/dev cheon.md; session-50 B1.1).
        # Su: ReactYue (advance the caller's YUE bars via XIE.Power) → MAI-capped
        # bounty from CHEON's own balance → YueMintToOrigin (the 1-unit drip) →
        # returns the refreshed (Charge, Hypobar, Epibar) = Chi.Bar AFTER the move.
        # Needs the caller's YUE (Sei.Chi reverts NotStarted) — the onboarding in
        # s1 + the YUE origin mint to tx.origin cover both Su floors here.
        qing = st_["qing"]
        yue = st_["yue"]
        cheon = canon.address("CHEON")

        def bar() -> tuple[int, int]:
            raw = chain.view("YUE", "Bar", "address", [qing], ["uint256", "uint256"], to=yue)
            return (int(raw[0]), int(raw[1]))

        h0, e0 = bar()
        jrn.a(rec, "YUE.Bar(qing) reads before settle (view; zero-first-visit is a real state)", True, f"({h0}, {e0})")

        # the pure DRYRUN decodes the bars the panel previews — quiet fork, no
        # interleaving callers, so the committed call reproduces them exactly
        charge, hyp, epi = [int(x) for x in decode(
            ["uint256", "uint256", "uint256"],
            chain.eth_call(cheon, canon.data("CHEON", "Su", "address", [qing]), frm=player.addr))]
        jrn.a(rec, "Su preview returns bars that only ADVANCE the current state",
              hyp >= h0 and epi >= e0, f"charge={charge} hyp {h0}→{hyp} epi {e0}→{epi}")

        cheon_supply_before = chain.view("CHEON", "totalSupply", "", [], ["uint256"])
        r = player.send(cheon, canon.data("CHEON", "Su", "address", [qing]))
        jrn.a(rec, "CHEON.Su status 1 (the settle works for this caller)", r["status"] == "0x1")
        h1, e1 = bar()
        jrn.a(rec, "YUE.Bar after == the previewed (Hypobar, Epibar) — Su returns the POST state",
              (h1, e1) == (hyp, epi), f"({h1}, {e1})")
        jrn.a(rec, "CHEON supply unchanged (at cap — _mintToCap is a guarded no-op, kb §5)",
              chain.view("CHEON", "totalSupply", "", [], ["uint256"]) == cheon_supply_before)

        # settle is an every-visit verb: a second call advances the bars again
        _, hyp2, epi2 = [int(x) for x in decode(
            ["uint256", "uint256", "uint256"],
            chain.eth_call(cheon, canon.data("CHEON", "Su", "address", [qing]), frm=player.addr))]
        r = player.send(cheon, canon.data("CHEON", "Su", "address", [qing]))
        jrn.a(rec, "second CHEON.Su status 1", r["status"] == "0x1")
        h2, e2 = bar()
        jrn.a(rec, "bars advance monotonically across settles", h2 >= h1 and e2 >= e1, f"hyp {h1}→{h2} epi {e1}→{e2}")
        jrn.a(rec, "second settle's Bar == its own preview", (h2, e2) == (hyp2, epi2), f"({h2}, {e2})")

    def s10(rec):
        # DO.Take — the deed (kb/dev/do.md; session-51 B1.4 + the fork-audit
        # CORRECTION). The gate keys on the WRAPPED ASSET, not the venue
        # (fork-verified + bytecode-disassembled): eligible when the venue
        # wraps your own user token, when asset.owner(tx.origin) passes, or
        # (assets exposing Creator()) when asset.Creator() == tx.origin.
        # Assets answering NEITHER probe make Take revert RAW (empty data);
        # an ineligible Take is a SILENT NO-OP (status 1, nothing happens,
        # gas spent) — and so is a second Take on a taken venue (the
        # per-QING flag). The mint lands on the USER TOKEN (the LAU).
        do = canon.address("DO")
        lau = st_["lau"]
        mp = canon.address("MAP")

        jrn.a(rec, "DO.Take selector pin (kb/dev/do.md [chain])",
              selector("Take", "address") == "0x8f26e8d5")

        # (a) the raw-revert shape: the s2 venue wraps MockAsset — answers
        # neither owner(address) nor Creator() ⇒ the probe's revert bubbles
        r = force_send(do, selector("Take", "address") + encode(["address"], [st_["qing"]]), gas=1_000_000)
        jrn.a(rec, "Take on an asset answering neither probe REVERTS (raw empty revert)",
              r["status"] == "0x0")

        # (b) the eligible branch: a venue wrapping the player's OWN user token
        qing3 = create1(mp, chain.nonce(mp))
        r = player.send(mp, canon.data("MAP", "New", "address", [lau]))
        jrn.a(rec, "MAP.New(own LAU) status 1 (the deed's stage)", r["status"] == "0x1", qing3)
        jrn.a(rec, "player NOT an owner before the deed",
              chain.view("QING", "owner", "address", [player.addr], ["bool"], to=qing3) is False)
        do_supply = int(chain.eth_call(do, do_view("totalSupply")), 16)
        do_lau = int(chain.eth_call(do, erc20_data("balanceOf", "address", [lau])), 16)
        r = player.send(do, selector("Take", "address") + encode(["address"], [qing3]))
        jrn.a(rec, "DO.Take status 1 (asset == userToken branch)", r["status"] == "0x1")
        jrn.a(rec, "owner(player) flips to True (the venue-panel probe, session-50 batch)",
              chain.view("QING", "owner", "address", [player.addr], ["bool"], to=qing3) is True)
        jrn.a(rec, "DO mints exactly 1e18 to the USER TOKEN (the LAU), not the wallet",
              int(chain.eth_call(do, erc20_data("balanceOf", "address", [lau])), 16) - do_lau == UNIT)
        jrn.a(rec, "DO supply +1e18 (one deed)",
              int(chain.eth_call(do, do_view("totalSupply")), 16) - do_supply == UNIT)

        # (c) the taken-once flag: a second Take lands "successful" but is a
        # SILENT NO-OP — no re-mint, no supply move, no state change
        r = player.send(do, selector("Take", "address") + encode(["address"], [qing3]))
        jrn.a(rec, "second Take lands status 1 — the SILENT NO-OP shape", r["status"] == "0x1")
        jrn.a(rec, "…but NOTHING happens: DO supply unchanged",
              int(chain.eth_call(do, do_view("totalSupply")), 16) == do_supply + UNIT)
        jrn.a(rec, "…and the LAU deed balance unchanged",
              int(chain.eth_call(do, erc20_data("balanceOf", "address", [lau])), 16) == do_lau + UNIT)

    def s11(rec):
        # MAP.New late-revert + the CHO Qu-claim observation (session-51
        # B1.8). kb/dev/map.md §6 claims a reverted New leaves the drawn De
        # claimed in CHO's Qu map FOREVER ("cross-contract revert leak").
        # EVM semantics say otherwise — the Qu write rides the SAME tx, so a
        # late revert rolls it back (with the entropy advance too), and on a
        # QUIET fork the retry re-draws and re-claims the SAME De. The evil
        # asset forces the late revert AFTER the draw: name()/symbol()
        # staticcall-succeed (MAP.has() says yes) but return EMPTY
        # returndata, so New's rename-step decode reverts.
        mp = canon.address("MAP")
        cho = canon.address("CHO")

        evil = create1(player.addr, chain.nonce(player.addr))
        r0 = player.deploy(evil_creation)
        jrn.a(rec, "EvilAsset deploy status 1", r0["status"] == "0x1", evil)
        jrn.a(rec, "EvilAsset runtime byte-pin (fixtures/evil-asset)", chain.code(evil)[2:] == evil_runtime)

        # pure preview of the NEXT draw (Luo is owners-gated: MAP calls it;
        # nothing between here and the sends touches CHO on this quiet fork —
        # EOA deploys and the reverted tx leave the entropy head unchanged)
        de0 = int(chain.eth_call(cho, canon.data("CHO", "Luo", "", []), frm=mp), 16)
        jrn.info(rec, "previewed next De (pure CHO.Luo from MAP)", str(de0))
        jrn.a(rec, "Qu(de0) unclaimed before anything", int(chain.view("CHO", "Qu", "uint256", [de0], ["address"]), 16) == 0)

        r = force_send(mp, canon.data("MAP", "New", "address", [evil]), gas=6_000_000)
        jrn.a(rec, "New(evil) reverts LATE (the rename decode, after the draw)", r["status"] == "0x0")
        qu_after = int(chain.view("CHO", "Qu", "uint256", [de0], ["address"]), 16)
        jrn.a(rec, "Qu(de0) == 0x0 after the reverted New — the claim ROLLS BACK with the tx",
              qu_after == 0, hex(qu_after))

        # the retry (fresh good asset) — quiet fork, entropy rolled back, so
        # the retry re-draws the SAME De and claims it: Waat == de0 x Offset
        asset3 = create1(player.addr, chain.nonce(player.addr))
        r0 = player.deploy(mock_creation)
        jrn.a(rec, "third MockAsset deploy status 1", r0["status"] == "0x1", asset3)
        qing3 = create1(mp, chain.nonce(mp))
        r = player.send(mp, canon.data("MAP", "New", "address", [asset3]))
        jrn.a(rec, "New(good #3) status 1 — the retry succeeds", r["status"] == "0x1", qing3)
        waat3 = int(chain.view("QING", "Waat", "", [], ["uint256"], to=qing3))
        jrn.a(rec, "waat3 == de0 x Offset (the rolled-back draw was re-claimed — no permanent Qu scar)",
              waat3 == de0 * OFFSET, waat3)
        jrn.a(rec, "Qu(de0) == MAP after the successful retry (claimed, not burned)",
              int(chain.view("CHO", "Qu", "uint256", [de0], ["address"]), 16) == int(mp, 16))
        jrn.a(rec, "MAP.GetQing(waat3) == qing3 (the retry's index is whole)",
              chain.view("MAP", "GetQing", "uint256", [waat3], ["address"]).lower() == qing3)

    def s12(rec):
        # the YUE Hong/Hung exchange desk + the Ⓐ Redeem leg (session-52
        # B1.5, fork-first like s10). FORK CORRECTION on the funding story:
        # BOTH desk legs pay from the VAULT'S OWN INVENTORY — inside
        # Hong/Hung every transfer is called BY the YUE, so `transfer` moves
        # the YUE's own balance (DysnomiaInsufficientBalance names from=YUE
        # when the pot is empty — the first draft's "the venue pays Hong from
        # its self-escrow" was wrong). Hong(spend, qing, amt): pulls
        # amt×rate/1e18 of the wrapped asset from the caller into the vault,
        # pays the venue tokens OUT of the YUE's own qing holdings. Hung(qing,
        # receive, amt): pulls the venue tokens into the vault, pays the
        # receive asset out of the YUE's own asset holdings. The venue is
        # never the counterparty (unlike the BASE desk on the venue itself —
        # Purchase/Redeem pay from the venue's escrow; pinned in (g)). The
        # base Redeem(t, a) pulls the VENUE TOKEN from the caller with
        # spender == the venue address and pays a×rate/1e18 of t from the
        # venue's escrow of t.
        qing = st_["qing"]
        yue = st_["yue"]
        mock = st_["mock_asset"]

        jrn.a(rec, "desk selector pins (abi/index + keccak self-check)",
              selector("Hong", "address,address,uint256") == "0xb3bde122"
              and selector("Hung", "address,address,uint256") == "0x518945cd"
              and selector("GetAssetRate", "address,address") == "0x7f3c46c0"
              and selector("IsValidAsset", "address,address") == "0xc7a68962"
              and selector("Redeem", "address,uint256") == "0x222838db")

        def rate_of(spend: str, recv: str) -> int:
            return chain.view("YUE", "GetAssetRate", "address,address", [spend, recv], ["uint256"], to=yue)

        # (a) no-route before a rate exists: GetAssetRate == 0 and the use
        # reverts ExchangeRateNotFound
        rate0 = rate_of(qing, mock)
        jrn.a(rec, "GetAssetRate(qing, asset) == 0 before any posted rate (no route)",
              rate0 == 0, rate0)
        no_route = False
        try:
            chain.eth_call(yue, canon.data("YUE", "Hong", "address,address,uint256", [mock, qing, UNIT]), frm=player.addr)
        except HarnessError as e:
            no_route = "0x464460b9" in str(e)  # ExchangeRateNotFound(address,address)
        jrn.a(rec, "Hong with a 0 rate reverts ExchangeRateNotFound", no_route)

        # (b) InvalidPair: the venue wraps MockAsset, not Ⓐ — the walk never
        # reaches AFFECTION
        bad_pair = False
        try:
            chain.eth_call(yue, canon.data("YUE", "Hong", "address,address,uint256", [affection, qing, UNIT]), frm=player.addr)
        except HarnessError as e:
            bad_pair = "0xd9a764d9" in str(e)  # InvalidPair(address,address)
        jrn.a(rec, "Hong with a non-ancestor spend asset reverts InvalidPair", bad_pair)

        # (c) rate the venue for its OWN wrapped asset (player is a venue
        # owner since s4; cap = asset.totalSupply()/777 = 1e24/777 ≫ 1e18)
        r = player.send(qing, canon.data("QING", "AddMarketRate", "address,uint256", [mock, UNIT]))
        jrn.a(rec, "AddMarketRate(asset, 1e18) status 1", r["status"] == "0x1")
        gwat = chain.view("QING", "GWAT", "", [], ["bool"], to=qing)
        jrn.info(rec, "venue GWAT lock flag (which GetAssetRate path runs)", str(gwat))
        jrn.a(rec, "GetAssetRate(direct pair) == the POSTED rate — the 777-mod attenuation divides a ZERO accumulator on hop one and can never bite here",
              rate_of(qing, mock) == UNIT, rate_of(qing, mock))
        jrn.a(rec, "IsValidAsset(qing, its direct asset) is True",
              chain.view("YUE", "IsValidAsset", "address,address", [qing, mock], ["bool"], to=yue) is True)

        # (d) Hong — the payout pot is the YUE's OWN qing inventory. Top the
        # player up via the Ⓐ desk (2 more qing; exact-amount approve — the
        # s4 allowance is spent), park 2e18 qing in the vault, then Hong:
        # asset player→YUE in, qing YUE→player out. The venue's self-escrow
        # never moves.
        r = player.send(affection, erc20_data("approve", "address,uint256", [qing, 2 * UNIT]))
        jrn.a(rec, "exact Ⓐ approve(qing, 2e18) top-up status 1", r["status"] == "0x1")
        r = player.send(qing, canon.data("QING", "Purchase", "address,uint256", [affection, 2 * UNIT]))
        jrn.a(rec, "Purchase top-up status 1 (player wallet qing 3e18)", r["status"] == "0x1")
        r = player.send(qing, canon.data("QING", "transfer", "address,uint256", [yue, 2 * UNIT]))
        jrn.a(rec, "park 2e18 qing in the YUE (the Hong payout pot) status 1", r["status"] == "0x1")
        yue_q = chain.view("QING", "balanceOf", "address", [yue], ["uint256"], to=qing)
        jrn.a(rec, "the YUE holds 2e18 qing (the desk's inventory)", yue_q == 2 * UNIT, yue_q)
        venue_pot = chain.view("QING", "balanceOf", "address", [qing], ["uint256"], to=qing)
        r = player.send(mock, erc20_data("approve", "address,uint256", [yue, 2 * UNIT]))
        jrn.a(rec, "exact approve(asset → YUE, 2e18) status 1", r["status"] == "0x1")
        p_asset = bal_erc20(mock, player.addr)
        p_q = bal("QING", player.addr)
        r = player.send(yue, canon.data("YUE", "Hong", "address,address,uint256", [mock, qing, 2 * UNIT]))
        jrn.a(rec, "YUE.Hong status 1", r["status"] == "0x1")
        jrn.a(rec, "Hong: player asset −2e18 (pulled into the VAULT)",
              p_asset - bal_erc20(mock, player.addr) == 2 * UNIT, bal_erc20(mock, player.addr))
        jrn.a(rec, "Hong: player qing +2e18 — paid from the YUE's OWN inventory",
              bal("QING", player.addr) - p_q == 2 * UNIT, bal("QING", player.addr))
        jrn.a(rec, "Hong: the YUE's qing pot dropped by exactly 2e18",
              yue_q - chain.view("QING", "balanceOf", "address", [yue], ["uint256"], to=qing) == 2 * UNIT)
        jrn.a(rec, "Hong: the VENUE's self-escrow is untouched (the venue is never the counterparty)",
              chain.view("QING", "balanceOf", "address", [qing], ["uint256"], to=qing) == venue_pot)
        jrn.a(rec, "Hong: the YUE now holds the 2e18 asset (the Hung payout pot)",
              bal_erc20(mock, yue) == 2 * UNIT, bal_erc20(mock, yue))

        # (e) Hung: redeem 2 qing back into the asset — the YUE pays from its
        # OWN holdings (funded by the Hong leg one step ago)
        r = player.send(qing, canon.data("QING", "approve", "address,uint256", [yue, 2 * UNIT]))
        jrn.a(rec, "exact approve(qing → YUE, 2e18) status 1", r["status"] == "0x1")
        p_q = bal("QING", player.addr)
        p_asset = bal_erc20(mock, player.addr)
        r = player.send(yue, canon.data("YUE", "Hung", "address,address,uint256", [qing, mock, 2 * UNIT]))
        jrn.a(rec, "YUE.Hung status 1", r["status"] == "0x1")
        jrn.a(rec, "Hung: player qing −2e18 (pulled into the VAULT)",
              p_q - bal("QING", player.addr) == 2 * UNIT, bal("QING", player.addr))
        jrn.a(rec, "Hung: player asset +2e18 — paid from the YUE's OWN pot, not the venue",
              bal_erc20(mock, player.addr) - p_asset == 2 * UNIT, bal_erc20(mock, player.addr))
        jrn.a(rec, "Hung: the YUE's asset pot drained to 0",
              bal_erc20(mock, yue) == 0, bal_erc20(mock, yue))

        # (f) the approval gate: Hung without a qing→YUE allowance reverts
        # (the base transferFrom reverts DysnomiaInsufficientAllowance
        # internally, so yue.sol's "Need Approved" require-strings are
        # UNREACHABLE on the DYSNOMIA base — kb/dev correction)
        r = force_send(yue, canon.data("YUE", "Hung", "address,address,uint256", [qing, mock, UNIT]), gas=1_000_000)
        jrn.a(rec, "Hung without approval reverts (status 0)", r["status"] == "0x0")

        # (g) the Ⓐ Redeem leg on the s4 desk (rate Ⓐ=1e18; the s4 Purchase
        # pulled 2e18 Ⓐ into the venue): the quirky prerequisite is a
        # VENUE-TOKEN allowance with spender == THE VENUE ITSELF
        venue_a = bal_erc20(affection, qing)
        jrn.a(rec, "the venue's Ⓐ escrow can pay the Redeem leg", venue_a >= UNIT, venue_a)
        r = player.send(qing, canon.data("QING", "approve", "address,uint256", [qing, UNIT]))
        jrn.a(rec, "exact approve(qing → the VENUE itself, 1e18) status 1 (Redeem's spender is the venue)", r["status"] == "0x1")
        p_q = bal("QING", player.addr)
        p_a = bal_erc20(affection, player.addr)
        r = player.send(qing, canon.data("QING", "Redeem", "address,uint256", [affection, UNIT]))
        jrn.a(rec, "QING.Redeem(AFFECTION, 1e18) status 1 — PUBLIC, no owner gate", r["status"] == "0x1")
        jrn.a(rec, "Redeem: player qing −1e18 (pulled back to the venue)",
              p_q - bal("QING", player.addr) == UNIT, bal("QING", player.addr))
        jrn.a(rec, "Redeem: player Ⓐ +1e18 at the 1e18 rate (the exact Purchase reverse)",
              bal_erc20(affection, player.addr) - p_a == UNIT, bal_erc20(affection, player.addr))
        jrn.a(rec, "Redeem: the venue's Ⓐ escrow dropped by 1e18",
              venue_a - bal_erc20(affection, qing) == UNIT, bal_erc20(affection, qing))

    def s13(rec):
        # identity enrichment + the pocket sweep + the label semantics +
        # the CHO address-book walk (session-53, IA-REEVAL-49 B1.6/7). The
        # headline pin (source-read, fork-verified): VOID's session table
        # `_activeUsers` is keyed by MSG.SENDER and written by Enter — which
        # the LAU constructor calls — so the session lives AT THE LAU
        # contract, never at the wallet. Labels are read/written through the
        # LAU (its onlyOwners wrapper passes tx.origin=player and delegates
        # with msg.sender=LAU); a plain-wallet VOID.Alias reverts
        # NoUserEntry(wallet) even for a fully-entered player.
        lau = st_["lau"]
        qing = st_["qing"]
        mock = st_["mock_asset"]
        void = canon.address("VOID")

        jrn.a(rec, "session-53 selector pins (keccak self-check)",
              selector("On", "") == "0x85bcb519"
              and selector("Saat", "uint256") == "0x088aee78"
              and selector("Withdraw", "address,uint256") == "0x884edad9"
              and selector("Alias", "address") == "0xed70e46c"
              and selector("Aliases", "uint256") == "0x1ca30a2f"
              and selector("Addresses", "string") == "0xac5bd44f")

        # (a) the birth record: Saat triple + the On() Bao (static tuple —
        # 8 words head-only). Structural pins from 05_zheng.sol Mau:
        # On.Phi == address(On.Shio); On.Mu = the Rod SHA; Saat[2] == the
        # player's SIU.Aura() (the wallet fingerprint, tx.origin-keyed).
        saat = [chain.view("LAU", "Saat", "uint256", [i], ["uint64"], to=lau) for i in range(3)]
        raw_on = chain.eth_call(lau, canon.data("LAU", "On", "", []))
        w = [raw_on[2 + 64 * i: 2 + 64 * (i + 1)] for i in range(8)]
        on_phi = "0x" + w[0][24:]
        on_mu = "0x" + w[1][24:]
        on_shio = "0x" + w[4][24:]
        jrn.a(rec, "On().Phi == address(On().Shio) — the Bao's entity key is the channel (Mau)",
              on_phi == on_shio.lower(), f"{on_phi} vs {on_shio.lower()}")
        jrn.a(rec, "On().Mu (the Rod SHA) is nonzero", int(w[1], 16) != 0, on_mu)
        jrn.a(rec, "Saat[1] (the Soul) is nonzero", saat[1] != 0, saat[1])
        aura_now = int(chain.eth_call(canon.address("SIU"), canon.data("SIU", "Aura", "", []), frm=player.addr), 16)
        jrn.a(rec, "Saat[2] == SIU.Aura() simulated from the creating wallet (the fingerprint pin)",
              saat[2] == aura_now, f"{saat[2]} vs {aura_now}")

        # (b) the pocket sweep: fund the LAU's pocket with the mock asset,
        # Withdraw moves it back to the owner; LAU supply untouched
        # (Withdraw is unmetered — no self-mint)
        r = player.send(mock, erc20_data("transfer", "address,uint256", [lau, 5 * UNIT]))
        jrn.a(rec, "fund the LAU pocket (5e18 mock) status 1", r["status"] == "0x1")
        lau_sup0 = chain.view("LAU", "totalSupply", "", [], ["uint256"], to=lau)
        p0, l0 = bal_erc20(mock, player.addr), bal_erc20(mock, lau)
        r = player.send(lau, canon.data("LAU", "Withdraw", "address,uint256", [mock, 2 * UNIT]))
        jrn.a(rec, "LAU.Withdraw status 1", r["status"] == "0x1")
        jrn.a(rec, "Withdraw: LAU pocket −2e18", l0 - bal_erc20(mock, lau) == 2 * UNIT, bal_erc20(mock, lau))
        jrn.a(rec, "Withdraw: player +2e18", bal_erc20(mock, player.addr) - p0 == 2 * UNIT, bal_erc20(mock, player.addr))
        jrn.a(rec, "Withdraw does not meter (LAU supply unchanged)",
              chain.view("LAU", "totalSupply", "", [], ["uint256"], to=lau) == lau_sup0)

        # (c) the venue-label semantics: unset reverts AliasNotFound (the
        # failure IS the answer); the WRITE goes through the LAU wrapper
        # (wallet sender passes onlyOwners via tx.origin; VOID then sees
        # msg.sender=LAU → the session); a plain-wallet VOID.Alias read
        # reverts NoUserEntry(wallet) — the msg.sender-key pin.
        def decode_str(hexret: str) -> str:
            off = int(hexret[2:66], 16)
            ln = int(hexret[2 + off * 2: 2 + (off + 32) * 2], 16)
            data_hex = hexret[2 + (off + 32) * 2:]
            return bytes.fromhex(data_hex[: ln * 2]).decode()

        unset = False
        try:
            chain.eth_call(void, canon.data("VOID", "Alias", "address", [qing]), frm=lau)
        except HarnessError as e:
            unset = selector("AliasNotFound", "address") in str(e)
        jrn.a(rec, "VOID.Alias(venue) from the LAU reverts AliasNotFound while unset", unset)
        # NOTE the VIEW has NO session gate (10_void.sol:101-103): it passes
        # _activeUsers[msg.sender] — ZERO for an unentered sender — straight
        # to the lib, so the read reverts AliasNotFound (soul-0 grade store)
        # and NOT NoUserEntry; NoUserEntry lives only on the WRITE. The
        # msg.sender-key itself is pinned by the LAU-wrapper route below.
        unentered_unset = False
        try:
            chain.eth_call(void, canon.data("VOID", "Alias", "address", [qing]), frm="0x000000000000000000000000000000000000dEaD")
        except HarnessError as e:
            unentered_unset = selector("AliasNotFound", "address") in str(e)
        jrn.a(rec, "VOID.Alias(venue) from an unentered sender ALSO reverts AliasNotFound — the view has no session gate (reads the soul-0 grades)",
              unentered_unset)
        r = player.send(lau, canon.data("LAU", "Alias", "address,string", [qing, "harness pin"]))
        jrn.a(rec, "LAU.Alias(venue, label) write status 1 (the owners wrapper route)", r["status"] == "0x1")
        back = decode_str(chain.eth_call(void, canon.data("VOID", "Alias", "address", [qing]), frm=lau))
        jrn.a(rec, "the label reads back through the LAU session", back == "harness pin", back)

        # (d) the CHO address book: pure-view walk — Aliases(i) reverts past
        # the end; every live alias resolves through Addresses to nonzero;
        # the book size pins the app's 160 probe bound
        cho = canon.address("CHO")
        aliases = []
        for i in range(200):
            try:
                aliases.append(decode_str(chain.eth_call(cho, canon.data("CHO", "Aliases", "uint256", [i]))))
            except HarnessError:
                break
        jrn.a(rec, "the address book walk found the kb-sized corpus (≥ 60 entries)", len(aliases) >= 60, len(aliases))
        jrn.a(rec, "the book fits the app's 160 probe bound", len(aliases) < 160, len(aliases))
        nonzero = all(
            int(chain.eth_call(cho, canon.data("CHO", "Addresses", "string", [a])), 16) != 0
            for a in aliases[:10]
        )
        jrn.a(rec, "the first 10 aliases resolve to nonzero addresses", nonzero, aliases[:10])

    def s14(rec):
        # session-66: the LAU EMISSION desk + the deployment gate surface.
        # Grounds the app's DSS desk (deploy/chatAndSnipe/withdraw), the
        # composer's WORLD leg (LAU.Chat), and the direct self-collection
        # path the emission economics make possible:
        #  - every owner action on the LAU meters 1 unit into the LAU's OWN
        #    balance (a purchasable pool at 1 Ⓐ/unit, rate 1:1 from the
        #    DYSNOMIA ctor — Purchase is PUBLIC, so anyone can buy your
        #    emission: the front-run window the DSS closes atomically)
        #  - mintToCap() mints SILENTLY (no world line) — batch self-mint
        #    does NOT need chat spam; N units then collect in ONE Purchase
        #  - LAU.Chat posts "<Username> line" onto the WORLD SHIO (ZHOU
        #    route) — the world channel's write path, LAU-owned
        #  - the deployment gate surface: eth_call with NO `to` (viem's
        #    to:null) is the DRYRUN for creation sends; CREATE1 address
        #    prediction == receipt.contractAddress
        lau = st_["lau"]
        world_shio = canon.address("WorldChatSHIO")
        dss3 = None

        # (a) the deploy DRYRUN shape — eth_call with no `to` + a gas estimate
        arg = lau[2:].lower().rjust(64, "0")
        st_call, res_call = rpc.call(
            "eth_call", [{"from": player.addr, "data": "0x" + dss_fixed_creation + arg}, "latest"]
        )
        jrn.a(rec, "deploy DRYRUN (eth_call with NO `to`) is revert-free", st_call == "ok", str(res_call)[:24])
        est = player.estimate(None, "0x" + dss_fixed_creation + arg)
        jrn.a(rec, "deploy estimateGas sane", 100_000 < est < 3_000_000, est)

        # (b) CREATE1 prediction == the receipt's contractAddress
        pred = create1(player.addr, chain.nonce(player.addr))
        r = player.deploy(dss_fixed_creation + arg)
        jrn.a(rec, "DSSFixed deploy (desk path) status 1", r["status"] == "0x1", pred)
        jrn.a(rec, "predicted CREATE1 address == receipt.contractAddress",
              r["contractAddress"].lower() == pred, r["contractAddress"])
        dss3 = r["contractAddress"].lower()
        st_["dss3"] = dss3

        # (c) LAU.Chat posts a WORLD line: the receipt carries a LogEvent on
        # the world SHIO; the line reads "<Username> …" (ZHOU route). Harvest
        # the topic — the silence pin in (d) reuses it.
        r = player.send(lau, canon.data("LAU", "Chat", "string", ["emission desk pin line"]))
        jrn.a(rec, "LAU.Chat status 1 (the composer's WORLD leg)", r["status"] == "0x1")
        world_logs = [l for l in r["logs"] if l["address"].lower() == world_shio]
        jrn.a(rec, "LAU.Chat lands a LogEvent on the WORLD SHIO", len(world_logs) == 1)
        logev_topic = world_logs[0]["topics"][0] if world_logs else None
        line = ""
        if world_logs:
            d = world_logs[0]["data"][2:]
            # LogEvent(uint64,uint64,string) — nothing indexed:
            # [soul][aura][offset=0x40][len][bytes]
            ln = int(d[64 * 3: 64 * 4], 16)
            line = bytes.fromhex(d[64 * 4: 64 * 4 + ln * 2]).decode()
        jrn.a(rec, "the world line carries the '<Username> ' prefix", line == "<beat_ng> emission desk pin line", line)

        # (d) mintToCap mints SILENTLY — supply/pool +1e18, NO world LogEvent
        sup0 = chain.view("LAU", "totalSupply", "", [], ["uint256"], to=lau)
        pool0 = chain.view("LAU", "balanceOf", "address", [lau], ["uint256"], to=lau)
        r = player.send(lau, canon.data("LAU", "mintToCap", "", []))
        jrn.a(rec, "mintToCap status 1 (silent self-mint — no chat needed)", r["status"] == "0x1")
        jrn.a(rec, "mintToCap: supply +1e18",
              chain.view("LAU", "totalSupply", "", [], ["uint256"], to=lau) - sup0 == UNIT)
        jrn.a(rec, "mintToCap: the LAU's own pool +1e18",
              chain.view("LAU", "balanceOf", "address", [lau], ["uint256"], to=lau) - pool0 == UNIT)
        noisy = [l for l in r["logs"] if l["address"].lower() == world_shio and l["topics"][0] == logev_topic]
        jrn.a(rec, "mintToCap posts NO world line (batch self-mint ≠ chat spam)", len(noisy) == 0)

        # (e) batch collect: one more silent mint, then ONE Purchase for the
        # whole pool delta — 2 units for 2 Ⓐ in a single tx (exact-amount
        # approve; the 1-Ⓐ-per-unit rate from the DYSNOMIA ctor)
        player.send(lau, canon.data("LAU", "mintToCap", "", []))
        r = player.send(affection, erc20_data("approve", "address,uint256", [lau, 2 * UNIT]))
        jrn.a(rec, "approve Ⓐ→LAU (exact 2e18) status 1", r["status"] == "0x1")
        pl0, pa0 = (
            chain.view("LAU", "balanceOf", "address", [player.addr], ["uint256"], to=lau),
            bal_erc20(affection, player.addr),
        )
        r = player.send(lau, canon.data("LAU", "Purchase", "address,uint256", [affection, 2 * UNIT]))
        jrn.a(rec, "batch Purchase (2e18 for 2e18 Ⓐ) status 1", r["status"] == "0x1")
        jrn.a(rec, "player LAU +2e18 (the whole pool delta, ONE tx)",
              chain.view("LAU", "balanceOf", "address", [player.addr], ["uint256"], to=lau) - pl0 == 2 * UNIT)
        jrn.a(rec, "player Ⓐ −2e18 (1 Ⓐ per unit)", pa0 - bal_erc20(affection, player.addr) == 2 * UNIT)

        # (f) the front-run risk is REAL: a second wallet buys the next
        # minted unit out from under you (Purchase is permissionless)
        sniper = Actor(chain)
        sniper.fund(1000)
        txh = impersonated_send(st_["a_whale"], affection,
                                erc20_data("transfer", "address,uint256", [sniper.addr, 3 * UNIT]))
        jrn.a(rec, "sniper Ⓐ funded status 1", player.wait(txh)["status"] == "0x1")
        player.send(lau, canon.data("LAU", "mintToCap", "", []))
        r = sniper.send(affection, erc20_data("approve", "address,uint256", [lau, UNIT]))
        jrn.a(rec, "sniper approve status 1", r["status"] == "0x1")
        r = sniper.send(lau, canon.data("LAU", "Purchase", "address,uint256", [affection, UNIT]))
        jrn.a(rec, "sniper Purchase of YOUR minted unit status 1 (the open front-run window)",
              r["status"] == "0x1")
        jrn.a(rec, "sniper holds your LAU emission",
              chain.view("LAU", "balanceOf", "address", [sniper.addr], ["uint256"], to=lau) == UNIT)

        # (g) the DSS closes the window atomically: chat + pull 1 Ⓐ +
        # Purchase + forward — AND the line lands on the WORLD SHIO too
        r = player.send(affection, erc20_data("approve", "address,uint256", [dss3, UNIT]))
        jrn.a(rec, "approve Ⓐ→DSS (exact 1e18) status 1", r["status"] == "0x1")
        pl1 = chain.view("LAU", "balanceOf", "address", [player.addr], ["uint256"], to=lau)
        r = player.send(dss3, dss_data("chatAndSnipe", "string", ["atomic snipe from the desk"]))
        jrn.a(rec, "DSS chatAndSnipe status 1 (the routed WORLD leg)", r["status"] == "0x1")
        jrn.a(rec, "the sniped unit lands in the player's wallet (DSS forwards)",
              chain.view("LAU", "balanceOf", "address", [player.addr], ["uint256"], to=lau) - pl1 == UNIT)
        world_logs = [l for l in r["logs"] if l["address"].lower() == world_shio and l["topics"][0] == logev_topic]
        jrn.a(rec, "the DSS line ALSO lands on the WORLD SHIO (LAU.Chat inside)", len(world_logs) == 1)

    steps = [
        ("0 preflight + selector pins", s0),
        ("1 onboarding-lite", s1),
        ("2 venue (MAP.New)", s2),
        ("3 whale funding (Ⓐ + Fornax floor)", s3),
        ("4 venue-token acquisition (Ⓐ bridge, Yuan tiers)", s4),
        ("5 META.Beat DRYRUN (fresh-caller Eta floor pin)", s5),
        ("6 META.Beat tx (fresh-caller revert, gas envelope)", s6),
        ("7 DSS deploy + chatAndSnipe", s7),
        ("8 approval-gate + fallback asserts", s8),
        ("9 CHEON.Su settle (bars move; at-cap meter no-op)", s9),
        ("10 DO.Take deed (owner flip, DO→user-token mint, taken-once)", s10),
        ("11 MAP.New late-revert + Qu-claim rollback observation", s11),
        ("12 YUE Hong/Hung exchange desk + the Ⓐ Redeem leg", s12),
        ("13 identity enrichment + pocket sweep + label semantics + the CHO book walk", s13),
        ("14 LAU emission desk + DSS desk + the deployment gate surface", s14),
    ]
    all_ok = True
    for name, fn in steps:
        all_ok &= jrn.step(name, fn)

    ok = jrn.finish() and all_ok
    if not args.rpc:
        fork.stop()
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
