import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbi, toFunctionSelector, type AbiFunction } from "viem";
import choaAbi from "@abi/CHOA.json";
import qingAbi from "@abi/QING.json";
import lauAbi from "@abi/LAU.json";
import indexJson from "@abi/index.json";
import { _qingViewAbi, _yueBarAbi } from "@/chain/venueState";
import { PERIMETER } from "@config/addresses";

const CHOA_CHAT = "0xb340a780";
const CHAT_STRING = "0x21516fc4";

function fnOf(abi: unknown[], name: string, argCount: number): AbiFunction {
  const hits = (abi as AbiFunction[]).filter(
    (e) => e.type === "function" && e.name === name && e.inputs.length === argCount
  );
  if (hits.length !== 1) throw new Error(`expected exactly one ${name}/${argCount}, got ${hits.length}`);
  return hits[0]!;
}

describe("CHOA.Chat selector regression (the s34-class ABI source test)", () => {
  it("canonical abi/CHOA.json pins Chat(address,string) = 0xb340a780", () => {
    const chat = fnOf(choaAbi, "Chat", 2);
    expect(toFunctionSelector(chat)).toEqual(CHOA_CHAT);
  });

  it("the stale (string) form is a different selector (0x21516fc4)", () => {
    const stale = parseAbi(["function Chat(string)"]);
    expect(toFunctionSelector(stale[0]!)).toEqual(CHAT_STRING);
    expect(CHAT_STRING).not.toEqual(CHOA_CHAT);
  });

  it("CHOA exposes no Chat(string) overload — the old app's encoding cannot be produced from this ABI", () => {
    const oneArg = (choaAbi as { type: string; name: string; inputs: unknown[] }[]).filter(
      (e) => e.type === "function" && e.name === "Chat" && e.inputs.length === 1
    );
    expect(oneArg).toHaveLength(0);
  });

  it("encodeFunctionData through the canonical ABI emits the deployed selector", () => {
    const data = encodeFunctionData({
      abi: choaAbi,
      functionName: "Chat",
      args: [PERIMETER.PhobosQING!, "ng selector test"],
    });
    expect(data.slice(0, 10)).toEqual(CHOA_CHAT);
  });

  it("LAU.Chat(string) documents the confusion source: same name, LAU-only shape", () => {
    const lauChat = fnOf(lauAbi, "Chat", 1);
    expect(toFunctionSelector(lauChat)).toEqual(CHAT_STRING);
  });

  it("QING.Chat(address,string) shares the deployed selector", () => {
    const qingChat = fnOf(qingAbi, "Chat", 2);
    expect(toFunctionSelector(qingChat)).toEqual(CHOA_CHAT);
    const data = encodeFunctionData({
      abi: qingAbi,
      functionName: "Chat",
      args: [PERIMETER.PhobosQING!, "ng selector test"],
    });
    expect(data.slice(0, 10)).toEqual(CHOA_CHAT);
  });
});

describe("venue-panel surface (session-43): hand fragments vs canonical ABIs vs abi/index", () => {
  const EXPECTED: Record<string, string> = {
    "Waat()": "0xa138da0b",
    "Asset()": "0xdf42e80e",
    "Entropy()": "0x40c48dfa",
    "totalSupply()": "0x18160ddd",
    "CoverCharge()": "0xfbe5a232",
    "BouncerDivisor()": "0x0aae7978",
    "GetMarketRate(address)": "0x2b83b1fc",
    "Admitted(address)": "0xdfffcc74",
    "balanceOf(address)": "0x70a08231",
    "Join(address)": "0x0764c80c",
    "Chat(address,string)": CHOA_CHAT,
    // session-50 venue depth (management-gate probes, kb §4)
    "GWAT()": "0x8dd6363c",
    "NoCROWS()": "0xd5ca77c4",
    "bouncer(address)": "0x37d74ffe",
    "owner(address)": "0x666e1b39",
  };

  it("every pinned selector matches abi/index.json's QING table", () => {
    const index = indexJson as unknown as {
      QING: { selectors: Record<string, { name: string; types: string }> };
    };
    const bySig = new Map<string, string>();
    for (const [sel, meta] of Object.entries(index.QING.selectors)) {
      bySig.set(`${meta.name}(${meta.types})`, sel);
    }
    for (const [sig, sel] of Object.entries(EXPECTED)) {
      expect(bySig.get(sig), `${sig} missing from abi/index QING`).toEqual(sel);
    }
  });

  it("the venueState hand fragments encode to the canonical selectors", () => {
    for (const frag of _qingViewAbi) {
      const sig = `${frag.name}(${frag.inputs.map((i) => i.type).join(",")})`;
      const sel = EXPECTED[sig];
      expect(sel, `no pin for hand fragment ${sig}`).toBeDefined();
      expect(toFunctionSelector(frag as unknown as AbiFunction)).toEqual(sel);
    }
  });

  it("the YUE.Bar hand fragment encodes to the canonical YUE selector", () => {
    for (const frag of _yueBarAbi) {
      expect(toFunctionSelector(frag as unknown as AbiFunction)).toEqual("0xc253aded");
    }
  });

  it("the venue-depth act/read signatures are index-pinned (CHEON.Su, RING.Moments, CHO.GetUserSoul, QING management)", () => {
    const index = indexJson as unknown as Record<string, { selectors: Record<string, { name: string; types: string }> }>;
    const find = (c: string, want: string) =>
      Object.entries(index[c]!.selectors).find(([, m]) => `${m.name}(${m.types})` === want)![0];
    expect(find("CHEON", "Su(address)")).toEqual("0x753a0c09");
    expect(find("RING", "Moments(uint64)")).toEqual("0x50acdbdc");
    expect(find("CHO", "GetUserSoul()")).toEqual("0xe1ed6e72");
    expect(find("QING", "setCoverCharge(uint256)")).toEqual("0x7dfe96f3");
    expect(find("QING", "setStaff(address,bool)")).toEqual("0x328d13e3");
    expect(find("QING", "setGuestlist(address)")).toEqual("0x0d4ec845");
    expect(find("QING", "removeGuest(address)")).toEqual("0x5256bfe7");
    expect(find("QING", "setBouncerDivisor(uint16)")).toEqual("0x3c7e0c00");
    expect(find("QING", "AllowCROWS(bool)")).toEqual("0x7b166306");
    expect(find("QING", "AddMarketRate(address,uint256)")).toEqual("0x989ae288");
    expect(find("QING", "Withdraw(address,uint256)")).toEqual("0x884edad9");
  });

  it("META.Beat(uint256) and RING.Eta() selectors are index-pinned", () => {
    const index = indexJson as unknown as {
      META: { selectors: Record<string, { name: string; types: string }> };
      RING: { selectors: Record<string, { name: string; types: string }> };
    };
    const find = (t: { selectors: Record<string, { name: string; types: string }> }, want: string) =>
      Object.entries(t.selectors).find(([, m]) => `${m.name}(${m.types})` === want)![0];
    expect(find(index.META, "Beat(uint256)")).toEqual("0xd5215e06");
    expect(find(index.RING, "Eta()")).toEqual("0x4209b07c");
  });
});
