#!/usr/bin/env python3

import argparse
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import rlp
from Crypto.Hash import keccak
from eth_account import Account
from eth_utils import to_checksum_address

ROOT = Path(__file__).resolve().parent.parent
RUNS = Path(__file__).resolve().parent / "runs"
RUNS.mkdir(exist_ok=True)

UA = "dysnomia-ng-harness/1.0"
DEFAULT_FORK_BLOCK = 27674000
DEFAULT_FORK_URL = "https://rpc.pulsechain.com"
ANVIL = Path.home() / ".foundry" / "bin" / "anvil"
UNIT = 10**18


def ksha(data: bytes) -> bytes:
    h = keccak.new(digest_bits=256)
    h.update(data)
    return h.digest()


def selector(name: str, types: str) -> str:
    return "0x" + ksha(f"{name}({types})".encode()).hex()[:8]


def create1(sender: str, nonce: int) -> str:
    raw = rlp.encode([bytes.fromhex(sender[2:]), nonce])
    return "0x" + ksha(raw)[12:].hex()


class HarnessError(Exception):
    pass


class Rpc:
    def __init__(self, endpoints):
        self.endpoints = list(endpoints)
        self.i = 0
        self.nid = 0

    def rotate(self):
        self.i = (self.i + 1) % len(self.endpoints)
        if self.i == 0:
            time.sleep(1.0)

    def call(self, method, params, retries=None):
        retries = retries if retries is not None else max(3, len(self.endpoints) * 3)
        last = None
        for _ in range(retries):
            self.nid += 1
            payload = json.dumps(
                {"jsonrpc": "2.0", "id": self.nid, "method": method, "params": params}
            ).encode()
            req = urllib.request.Request(
                self.endpoints[self.i],
                data=payload,
                headers={"Content-Type": "application/json", "User-Agent": UA},
            )
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    body = json.loads(resp.read())
                if "error" in body:
                    return ("error", body["error"])
                return ("ok", body.get("result"))
            except Exception as e:
                last = e
                self.rotate()
        raise HarnessError(f"rpc exhausted: {method} {params} last={last}")


def w32(v: int) -> bytes:
    return v.to_bytes(32, "big")


def enc_head(t: str, v) -> bytes:
    if t == "address":
        return w32(int(v, 16))
    if t in ("uint256", "uint64", "uint8", "uint16"):
        return w32(int(v))
    if t == "int256":
        return int(v).to_bytes(32, "big", signed=True)
    if t == "bool":
        return w32(1 if v else 0)
    raise HarnessError(f"unsupported head type {t}")


def encode(types: list, values: list) -> str:
    if len(types) != len(values):
        raise HarnessError("arity mismatch")
    head = b""
    tail = b""
    running = 32 * len(types)
    parts = []
    for t, v in zip(types, values):
        if t == "string":
            raw = v.encode()
            parts.append(("dyn", w32(len(raw)) + raw + b"\x00" * ((32 - len(raw) % 32) % 32)))
        else:
            parts.append(("stat", enc_head(t, v)))
    for kind, part in parts:
        if kind == "dyn":
            head += w32(running)
            running += len(part)
        else:
            head += part
    for kind, part in parts:
        if kind == "dyn":
            tail += part
    return (head + tail).hex()


def decode_single(t: str, data: bytes, i: int):
    word = data[i * 32:(i + 1) * 32]
    if t == "address":
        return "0x" + word[12:].hex()
    if t == "int256":
        return int.from_bytes(word, "big", signed=True)
    if t in ("uint256", "uint64", "uint8", "uint16"):
        return int.from_bytes(word, "big")
    if t == "bool":
        return int.from_bytes(word, "big") != 0
    if t == "string":
        off = int.from_bytes(word, "big")
        ln = int.from_bytes(data[off:off + 32], "big")
        return data[off + 32:off + 32 + ln].decode()
    raise HarnessError(f"unsupported decode type {t}")


def decode(types: list, datahex: str):
    data = bytes.fromhex(datahex[2:] if datahex.startswith("0x") else datahex)
    if len(data) < 32 * len(types):
        raise HarnessError(f"short return data: {datahex[:80]}")
    return [decode_single(t, data, i) for i, t in enumerate(types)]


class Canon:
    def __init__(self):
        self.index = json.loads((ROOT / "abi" / "index.json").read_text())
        self.cfg = json.loads((ROOT / "config" / "addresses.json").read_text())

    def address(self, name: str) -> str:
        a = self.cfg["contracts"].get(name)
        if not a:
            raise HarnessError(f"address not in perimeter: {name}")
        return a.lower()

    def at(self, contract: str, override: str = None) -> str:
        return override.lower() if override else self.address(contract)

    def data(self, contract: str, fname: str, ftypes: str, args: list) -> str:
        sig_types = [t.strip() for t in ftypes.split(",")] if ftypes else []
        s = selector(fname, ftypes)
        entry = self.index.get(contract, {}).get("selectors", {}).get(s)
        if entry is None:
            raise HarnessError(f"{contract}.{fname}({ftypes}) selector {s} not in abi/index.json")
        if entry["name"] != fname or entry["types"] != ftypes:
            raise HarnessError(
                f"index mismatch for {s}: index={entry['name']}({entry['types']}) asked={fname}({ftypes})"
            )
        return s + encode(sig_types, list(args))


class Chain:
    def __init__(self, rpc: Rpc, canon: Canon):
        self.rpc = rpc
        self.canon = canon

    def eth_call(self, to: str, data: str, frm: str = None) -> str:
        params = [{"to": to, "data": data}, "latest"]
        if frm:
            params[0]["from"] = frm
        st, res = self.rpc.call("eth_call", params)
        if st == "error":
            err = res.get("data") or res.get("message") or str(res)
            raise HarnessError(f"eth_call revert to={to} sel={data[:10]} err={err}")
        return res

    def view(self, contract: str, fname: str, ftypes: str, args: list, out_types: list, to: str = None):
        data = self.canon.data(contract, fname, ftypes, args)
        raw = self.eth_call(self.canon.at(contract, to), data)
        vals = decode(out_types, raw)
        return vals[0] if len(vals) == 1 else vals

    def code(self, addr: str) -> str:
        st, res = self.rpc.call("eth_getCode", [addr, "latest"])
        return res

    def nonce(self, addr: str) -> int:
        st, res = self.rpc.call("eth_getTransactionCount", [addr, "latest"])
        return int(res, 16)

    def chain_id(self) -> int:
        st, res = self.rpc.call("eth_chainId", [])
        return int(res, 16)

    def block_number(self) -> int:
        st, res = self.rpc.call("eth_blockNumber", [])
        return int(res, 16)

    def set_balance(self, addr: str, wei: int):
        st, res = self.rpc.call("anvil_setBalance", [addr, hex(wei)])
        if st == "error":
            raise HarnessError(f"anvil_setBalance failed: {res}")

    def gas_price(self) -> int:
        st, res = self.rpc.call("eth_gasPrice", [])
        return int(res, 16)


class Actor:
    def __init__(self, chain: Chain, priv: str = None):
        self.chain = chain
        self.acct = Account.from_key(priv or "0x" + secrets.token_hex(32))
        self.addr = self.acct.address.lower()

    def fund(self, pls: int = 1000):
        self.chain.set_balance(self.addr, pls * UNIT)

    def estimate(self, to: str, data: str) -> int:
        params = [{"from": self.addr, "data": data}, "latest"]
        if to:
            params[0]["to"] = to
        st, res = self.chain.rpc.call("eth_estimateGas", params)
        if st == "error":
            err = res.get("data") or res.get("message") or str(res)
            raise HarnessError(f"estimate revert to={to} sel={data[:10]} err={err}")
        return int(res, 16)

    def raw_send(self, to: str, data: str, gas: int = None) -> str:
        est = self.estimate(to, data)
        gas = gas or min(int(est * 1.3) + 60000, 29_500_000)
        tx = {
            "nonce": self.chain.nonce(self.addr),
            "to": to_checksum_address(to) if to else None,
            "value": 0,
            "gas": gas,
            "gasPrice": int(self.chain.gas_price() * 1.2) + 1_000_000,
            "data": data,
            "chainId": 369,
        }
        signed = self.acct.sign_transaction(tx)
        st, res = self.chain.rpc.call("eth_sendRawTransaction", ["0x" + signed.raw_transaction.hex()])
        if st == "error":
            raise HarnessError(f"send rejected to={to} sel={data[:10] if data else '(create)'} err={res}")
        return res

    def wait(self, txh: str) -> dict:
        for _ in range(300):
            st, rec = self.chain.rpc.call("eth_getTransactionReceipt", [txh])
            if st == "ok" and rec is not None:
                return rec
            time.sleep(0.4)
        raise HarnessError(f"no receipt for {txh}")

    def send(self, to: str, data: str, gas: int = None) -> dict:
        return self.wait(self.raw_send(to, data, gas))

    def deploy(self, creation_hex: str, gas: int = 3_000_000) -> dict:
        return self.send(None, "0x" + creation_hex.removeprefix("0x"), gas)


class Fork:
    def __init__(self, args):
        self.args = args
        self.proc = None

    def start(self):
        if self.args.rpc:
            return
        stale = subprocess.run(["ss", "-ltnp"], capture_output=True, text=True).stdout
        if f":{self.args.port} " in stale:
            raise HarnessError(f"port {self.args.port} already squatted; kill by PID first (HARNESS.md)")
        cmd = [
            str(ANVIL),
            "--fork-url", self.args.fork_url,
            "--hardfork", "shanghai",
            "--fork-block-number", str(self.args.fork_block),
            "--port", str(self.args.port),
        ]
        logf = open(RUNS / "anvil.log", "w")
        self.proc = subprocess.Popen(cmd, stdout=logf, stderr=subprocess.STDOUT)
        deadline = time.time() + 240
        while time.time() < deadline:
            try:
                probe = Rpc([f"http://127.0.0.1:{self.args.port}"])
                st, res = probe.call("eth_chainId", [], retries=1)
                if st == "ok" and int(res, 16) == 369:
                    return
            except Exception:
                pass
            if self.proc.poll() is not None:
                raise HarnessError(f"anvil died early; see {RUNS / 'anvil.log'}")
            time.sleep(1.0)
        raise HarnessError("anvil did not become ready in 240s")

    def stop(self):
        if self.proc and self.proc.poll() is None and not self.args.keep:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()


class Journal:
    def __init__(self, meta: dict):
        self.meta = meta
        self.steps = []
        self.ok = 0
        self.fail = 0

    def step(self, name: str, fn):
        rec = {"step": name, "asserts": [], "error": None}
        t0 = time.time()
        try:
            fn(rec)
            self.ok += 1
            rec["status"] = "pass"
            print(f"[ ok ] {name} ({len(rec['asserts'])} asserts, {round(time.time() - t0, 2)}s)")
        except Exception as e:
            self.fail += 1
            rec["status"] = "fail"
            rec["error"] = str(e)
            print(f"[FAIL] {name}: {e}")
        rec["secs"] = round(time.time() - t0, 2)
        self.steps.append(rec)
        return rec["status"] == "pass"

    def a(self, rec, label, cond, detail=""):
        rec["asserts"].append({"label": label, "pass": bool(cond), "detail": str(detail)[:400]})
        if not cond:
            raise HarnessError(f"assert failed: {label} {detail}")

    def info(self, rec, label, detail):
        rec["asserts"].append({"label": label, "pass": True, "detail": str(detail)[:400]})

    def finish(self):
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        out = {"meta": self.meta, "steps": self.steps, "ok": self.ok, "fail": self.fail}
        path = RUNS / f"run_{ts}.json"
        path.write_text(json.dumps(out, indent=1))
        print(json.dumps({"ok": self.ok, "fail": self.fail, "log": str(path)}))
        return self.fail == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpc", default=None)
    ap.add_argument("--fork-url", default=os.environ.get("DYS_FORK_URL", DEFAULT_FORK_URL))
    ap.add_argument("--fork-block", type=int, default=int(os.environ.get("DYS_FORK_BLOCK", DEFAULT_FORK_BLOCK)))
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
        "rpc": fork_url,
        "managed_fork": not bool(args.rpc),
        "fork_block": None if args.rpc else args.fork_block,
        "chain_id": chain.chain_id(),
        "head_at_start": chain.block_number(),
    }
    jrn = Journal(meta)
    print(json.dumps(meta))

    player = Actor(chain)
    player.fund(1_000_000)
    fx = Path(__file__).resolve().parent / "fixtures"
    creation_hex = (fx / "mock_asset.creation.hex").read_text().strip().removeprefix("0x")
    runtime_hex = (fx / "mock_asset.runtime.hex").read_text().strip().removeprefix("0x")

    lau_name = "Harness Player"
    lau_sym = "HPLY"
    username = "harness_ng"
    yue_name = "Harness Yue"
    yue_sym = "HYUE"
    qing_msg = "hello world chat from the ng harness"
    choa_msg = "choa-routed chat from the ng harness"

    st_ = {}

    def s1(rec):
        factory = canon.address("LAUFactory")
        lau = create1(factory, chain.nonce(factory))
        pv = decode(["address"], chain.eth_call(
            factory, canon.data("LAUFactory", "New", "string,string", [lau_name, lau_sym]), frm=player.addr))[0].lower()
        jrn.a(rec, "create1 precompute == eth_call preview", lau == pv, f"{lau} vs {pv}")
        r = player.send(factory, canon.data("LAUFactory", "New", "string,string", [lau_name, lau_sym]))
        jrn.a(rec, "tx status 1", r["status"] == "0x1")
        jrn.a(rec, "code at LAU", chain.code(lau) != "0x", lau)
        jrn.a(rec, "LAU.name()", chain.view("LAU", "name", "", [], ["string"], to=lau) == lau_name)
        jrn.a(rec, "LAU.symbol()", chain.view("LAU", "symbol", "", [], ["string"], to=lau) == lau_sym)
        jrn.a(rec, "LAU.owner(player)", chain.view("LAU", "owner", "address", [player.addr], ["bool"], to=lau) is True)
        jrn.a(rec, "LAU supply >= 1 unit", chain.view("LAU", "totalSupply", "", [], ["uint256"], to=lau) >= UNIT)
        jrn.info(rec, "gas LAUFactory.New", int(r["gasUsed"], 16))
        st_["lau"] = lau

    def s2(rec):
        lau = st_["lau"]
        unset_reverted = False
        try:
            chain.view("LAU", "Username", "", [], ["string"], to=lau)
        except HarnessError:
            unset_reverted = True
        jrn.a(rec, "Username view reverts while unset (attribute-lib gate)", unset_reverted)
        r = player.send(lau, canon.data("LAU", "Username", "string", [username]))
        jrn.a(rec, "tx status 1", r["status"] == "0x1")
        jrn.a(rec, "username set", chain.view("LAU", "Username", "", [], ["string"], to=lau) == username)

    def s3(rec):
        lau = st_["lau"]
        sei = canon.address("SEI")
        yan_before = chain.view("CHAN", "Yan", "address", [player.addr], ["address"])
        jrn.a(rec, "no YUE before", int(yan_before, 16) == 0, yan_before)
        yue = create1(sei, chain.nonce(sei))
        pv = decode(["address", "address"], chain.eth_call(
            sei, canon.data("SEI", "Start", "address,string,string", [lau, yue_name, yue_sym]), frm=player.addr))
        jrn.a(rec, "create1 precompute == eth_call preview", yue == pv[0].lower(), f"{yue} vs {pv[0]}")
        r = player.send(sei, canon.data("SEI", "Start", "address,string,string", [lau, yue_name, yue_sym]))
        jrn.a(rec, "tx status 1", r["status"] == "0x1")
        yan = chain.view("CHAN", "Yan", "address", [player.addr], ["address"]).lower()
        jrn.a(rec, "Chan.Yan(player) == new YUE", yan == yue, yan)
        jrn.a(rec, "YUE.Origin == player",
              chain.view("YUE", "Origin", "", [], ["address"], to=yue).lower() == player.addr)
        jrn.a(rec, "YUE.name()", chain.view("YUE", "name", "", [], ["string"], to=yue) == yue_name)
        jrn.a(rec, "CHO entry maps player->LAU",
              chain.view("CHO", "GetUserTokenAddress", "address", [player.addr], ["address"]).lower() == lau)
        jrn.info(rec, "gas SEI.Start", int(r["gasUsed"], 16))
        st_["yue"] = yue

    def s4(rec):
        lau = st_["lau"]
        yue = st_["yue"]
        choa = canon.address("CHOA")
        c_before = chain.view("CHOA", "totalSupply", "", [], ["uint256"])
        y_before = chain.view("YUE", "balanceOf", "address", [player.addr], ["uint256"], to=yue)
        r = player.send(choa, canon.data("CHOA", "Play", "address", [lau]))
        jrn.a(rec, "tx status 1", r["status"] == "0x1")
        c_after = chain.view("CHOA", "totalSupply", "", [], ["uint256"])
        y_after = chain.view("YUE", "balanceOf", "address", [player.addr], ["uint256"], to=yue)
        choa_cap = chain.view("CHOA", "maxSupply", "", [], ["uint256"]) * UNIT
        jrn.a(rec, "CHOA is at lottery cap (mintToCap no-ops)",
              c_after == choa_cap and c_after - c_before == 0,
              f"supply={c_after} cap={choa_cap}")
        jrn.a(rec, "first Play minted 1 YUE to origin", y_after - y_before == UNIT, y_after - y_before)
        jrn.info(rec, "gas CHOA.Play", int(r["gasUsed"], 16))

    def s5(rec):
        asset = create1(player.addr, chain.nonce(player.addr))
        r0 = player.deploy(creation_hex)
        jrn.a(rec, "mock deploy status 1", r0["status"] == "0x1")
        got = chain.code(asset)[2:]
        jrn.a(rec, "mock runtime deployed", got == runtime_hex, f"{asset} len={len(got)}")
        jrn.a(rec, "mock name()", chain.view("MAP", "name", "", [], ["string"], to=asset) == "Harness Asset")

        mp = canon.address("MAP")
        qing = create1(mp, chain.nonce(mp))
        pv = decode(["address"], chain.eth_call(
            mp, canon.data("MAP", "New", "address", [asset]), frm=player.addr))[0].lower()
        jrn.a(rec, "create1 precompute == eth_call preview", qing == pv, f"{qing} vs {pv}")
        r = player.send(mp, canon.data("MAP", "New", "address", [asset]))
        jrn.a(rec, "tx status 1", r["status"] == "0x1")
        jrn.a(rec, "code at QING", chain.code(qing) != "0x", qing)
        waat = chain.view("QING", "Waat", "", [], ["uint256"], to=qing)
        jrn.a(rec, "Waat > 0", waat > 0, waat)
        jrn.a(rec, "MAP.GetQing(waat) == qing",
              chain.view("MAP", "GetQing", "uint256", [waat], ["address"]).lower() == qing)
        jrn.a(rec, "QING.Asset == mock",
              chain.view("QING", "Asset", "", [], ["address"], to=qing).lower() == asset)
        qname = chain.view("QING", "name", "", [], ["string"], to=qing)
        jrn.a(rec, "QING renamed from asset name", qname == "Harness Asset QING", qname)
        jrn.a(rec, "QING renamed symbol",
              chain.view("QING", "symbol", "", [], ["string"], to=qing) == "qHASS")
        lon, lat = chain.view("Hecke", "Compliment", "uint256", [waat], ["int256", "int256"], to=canon.address("HECKE"))
        jrn.a(rec, "MAP.GetMapQing(lat,lon) == qing",
              chain.view("MAP", "GetMapQing", "int256,int256", [lat, lon], ["address"]).lower() == qing,
              f"lat={lat} lon={lon}")
        jrn.a(rec, "player is staff-bouncer on new QING",
              chain.view("QING", "bouncer", "address", [player.addr], ["bool"], to=qing) is True)
        jrn.info(rec, "gas MAP.New", int(r["gasUsed"], 16))
        st_["qing"] = qing
        st_["waat"] = waat

    def s6(rec):
        qing = st_["qing"]
        before = chain.view("QING", "totalSupply", "", [], ["uint256"], to=qing)
        r = player.send(qing, canon.data("QING", "Join", "address", [st_["lau"]]))
        jrn.a(rec, "tx status 1", r["status"] == "0x1")
        after = chain.view("QING", "totalSupply", "", [], ["uint256"], to=qing)
        jrn.a(rec, "QING supply +1e18 on Join", after - before == UNIT, after - before)

    def s7(rec):
        qing = st_["qing"]
        before = chain.view("QING", "totalSupply", "", [], ["uint256"], to=qing)
        r = player.send(qing, canon.data("QING", "Chat", "address,string", [st_["lau"], qing_msg]))
        jrn.a(rec, "tx status 1", r["status"] == "0x1")
        after = chain.view("QING", "totalSupply", "", [], ["uint256"], to=qing)
        jrn.a(rec, "QING supply +1e18 on Chat", after - before == UNIT, after - before)
        found = None
        for lg in r.get("logs") or []:
            if lg["address"].lower() == qing and lg["topics"][0] == "0x" + ksha(b"LogEvent(string,uint64,uint64,string)").hex():
                found = decode(["string", "uint64", "uint64", "string"], lg["data"])
        jrn.a(rec, "LogEvent carries username+line",
              found is not None and found[0] == username and found[3] == qing_msg, str(found))

    def s8(rec):
        qing = st_["qing"]
        yue = st_["yue"]
        choa = canon.address("CHOA")
        q_before = chain.view("QING", "totalSupply", "", [], ["uint256"], to=qing)
        c_before = chain.view("CHOA", "totalSupply", "", [], ["uint256"])
        reward_before = chain.view("CHOA", "balanceOf", "address", [yue], ["uint256"])
        r = player.send(choa, canon.data("CHOA", "Chat", "address,string", [qing, choa_msg]))
        jrn.a(rec, "tx status 1", r["status"] == "0x1")
        q_after = chain.view("QING", "totalSupply", "", [], ["uint256"], to=qing)
        c_after = chain.view("CHOA", "totalSupply", "", [], ["uint256"])
        reward_after = chain.view("CHOA", "balanceOf", "address", [yue], ["uint256"])
        jrn.a(rec, "QING supply +1e18 via CHOA.Chat", q_after - q_before == UNIT, q_after - q_before)
        choa_cap = chain.view("CHOA", "maxSupply", "", [], ["uint256"]) * UNIT
        jrn.a(rec, "CHOA stays at cap (no mint on deployed ladder)", c_after == choa_cap and c_after - c_before == 0)
        jrn.info(rec, "CHOA->YUE reward delta (buffer-dependent)", reward_after - reward_before)
        jrn.info(rec, "gas CHOA.Chat", int(r["gasUsed"], 16))

    def s9(rec):
        qing = st_["qing"]
        choa = canon.address("CHOA")
        good = selector("Chat", "address,string")
        jrn.a(rec, "static Chat(address,string) == 0xb340a780", good == "0xb340a780", good)
        bad_sel = selector("Chat", "string")
        jrn.a(rec, "static Chat(string) != 0xb340a780", bad_sel == "0x21516fc4" and bad_sel != good, bad_sel)
        jrn.a(rec, "index pins CHOA.Chat(address,string)",
              canon.index["CHOA"]["selectors"]["0xb340a780"]["types"] == "address,string")
        bogus = bad_sel + encode(["string"], ["stale (string) form"])
        call_reverted = False
        try:
            chain.eth_call(choa, bogus, frm=player.addr)
        except HarnessError:
            call_reverted = True
        jrn.a(rec, "eth_call Chat(string) on CHOA reverts", call_reverted)
        supply_before = chain.view("QING", "totalSupply", "", [], ["uint256"], to=qing)
        tx_reverted = False
        try:
            player.send(choa, bogus, gas=500000)
        except HarnessError:
            tx_reverted = True
        jrn.a(rec, "tx Chat(string) on CHOA reverts", tx_reverted)
        supply_after = chain.view("QING", "totalSupply", "", [], ["uint256"], to=qing)
        jrn.a(rec, "QING supply unchanged by bogus call", supply_after == supply_before)

    def s10(rec):
        jrn.a(rec, "player VOID balance still zero",
              chain.view("VOID", "balanceOf", "address", [player.addr], ["uint256"]) == 0)
        jrn.a(rec, "chain id 369", chain.chain_id() == 369)
        jrn.a(rec, "YUE still maps to player",
              chain.view("CHAN", "Yan", "address", [player.addr], ["address"]).lower() == st_["yue"])
        jrn.a(rec, "CHO entry intact",
              chain.view("CHO", "GetUserTokenAddress", "address", [player.addr], ["address"]).lower() == st_["lau"])

    jrn.step("0 preflight fork", lambda rec: jrn.a(rec, "chain id 369", chain.chain_id() == 369))
    jrn.step("1 LAUFactory.New", s1)
    jrn.step("2 LAU.Username", s2)
    jrn.step("3 SEI.Start", s3)
    jrn.step("4 CHOA.Play", s4)
    jrn.step("5 MAP.New mock asset", s5)
    jrn.step("6 QING.Join", s6)
    jrn.step("7 QING.Chat", s7)
    jrn.step("8 CHOA.Chat", s8)
    jrn.step("9 CHOA.Chat selector regression", s9)
    jrn.step("10 invariants", s10)

    ok = jrn.finish()
    fork.stop()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
