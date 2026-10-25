import { afterEach, describe, expect, it } from "vitest";
import { keccak256, stringToBytes, toFunctionSelector } from "viem";
import lauAbi from "@abi/LAU.json";
import { addr } from "@config/addresses";
import {
  _dssAbi,
  _lauDeskAbi,
  affectionApproveData,
  captureDssFromReceipt,
  DSS_FIXED_CREATION,
  dssChatAndSnipeData,
  dssChatData,
  dssWithdrawLauData,
  encodeDssDeploy,
  lauChatData,
  lauMintToCapData,
  lauPurchaseData,
} from "@/chain/dssDesk";
import { dssOf, resetDssForTests, setDss } from "@/state/dssStore";
import type { AbiFunction, Address } from "viem";

/**
 * The DSS desk (session-66): the shipped FIXED creation bytecode, the
 * hand-pinned fragment encodes (parity against the canonical generated
 * LAU ABI where one exists), and the capture-at-deploy store. The
 * contract-side semantics are fork-pinned by harness set-2 s7/s8/s14.
 */

const LAU = "0x1111111111111111111111111111111111111111" as Address;
const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as Address;
const DSS = "0x5555555555555555555555555555555555555555" as Address;

function sel(sig: string): string {
  return keccak256(stringToBytes(sig)).slice(0, 10);
}

afterEach(() => {
  resetDssForTests();
});

describe("the shipped fixed bytecode", () => {
  it("is the harness fixture's creation hex (EVM creation preamble + the Ⓐ constant embedded)", () => {
    expect(DSS_FIXED_CREATION.startsWith("0x6080")).toBe(true);
    // AFFECTIONAddress is baked into the constructor (fixtures/dss-fixed
    // addresses.sol) — tamper evidence against a wrong-fixture copy
    expect(DSS_FIXED_CREATION.toLowerCase()).toContain(addr("AFFECTION").slice(2).toLowerCase());
  });

  it("encodeDssDeploy appends the 32-byte padded ctor arg (set-2 s14's exact shape)", () => {
    const data = encodeDssDeploy(LAU);
    expect(data.startsWith(DSS_FIXED_CREATION)).toBe(true);
    expect(data.slice(-64)).toEqual(LAU.slice(2).toLowerCase().padStart(64, "0"));
  });
});

describe("fragment encodes (hand-pinned == canonical where one exists)", () => {
  it("the DSS fragments hit the fork-proven selectors", () => {
    expect(dssChatAndSnipeData("hi").slice(0, 10)).toEqual(sel("chatAndSnipe(string)"));
    expect(dssChatData("hi").slice(0, 10)).toEqual(sel("chat(string)"));
    expect(dssWithdrawLauData(1n).slice(0, 10)).toEqual(sel("withdrawLAU(uint256)"));
  });

  it("the LAU desk fragments match the canonical generated abi/LAU.json selectors", () => {
    const canon = (name: string, n: number): string => {
      const hits = (lauAbi as AbiFunction[]).filter((e) => e.type === "function" && e.name === name && e.inputs.length === n);
      if (hits.length !== 1) throw new Error(`no canonical ${name}/${n}`);
      return toFunctionSelector(hits[0]!);
    };
    expect(lauMintToCapData().slice(0, 10)).toEqual(canon("mintToCap", 0));
    expect(lauPurchaseData(2n * 10n ** 18n).slice(0, 10)).toEqual(canon("Purchase", 2));
    expect(lauPurchaseData(1n).slice(0, 10)).toEqual("0x2499a533"); // the kb-pinned deployed selector
    expect(lauChatData("hi").slice(0, 10)).toEqual(canon("Chat", 1));
    expect(_lauDeskAbi).toBeDefined();
    expect(_dssAbi).toBeDefined();
  });

  it("the Ⓐ approve encode hits IERC20's deployed selector and the exact amount rides last", () => {
    const data = affectionApproveData(DSS, 10n ** 18n);
    expect(data.slice(0, 10)).toEqual("0x095ea7b3");
    expect(data.slice(-64)).toEqual((10n ** 18n).toString(16).padStart(64, "0"));
  });
});

describe("capture from the creation receipt", () => {
  it("captures the receipt's contractAddress on sent outcomes only", () => {
    expect(captureDssFromReceipt({ status: "sent", receipt: { contractAddress: DSS } })).toEqual(DSS);
    expect(captureDssFromReceipt({ status: "sent", receipt: { contractAddress: null } })).toBeNull();
    expect(captureDssFromReceipt({ status: "denied", receipt: { contractAddress: DSS } })).toBeNull();
    expect(captureDssFromReceipt({ status: "sent", receipt: null })).toBeNull();
  });
});

describe("the dss store (capture-at-deploy, the home-QING law)", () => {
  it("records per account and is idempotent on the same address", () => {
    expect(dssOf(ACCT)).toBeNull();
    setDss(ACCT, { dss: DSS, lau: LAU, txHash: "0xabc" });
    const rec = dssOf(ACCT);
    expect(rec?.dss).toEqual(DSS);
    expect(rec?.lau).toEqual(LAU);
    setDss(ACCT, { dss: DSS, lau: LAU, txHash: "0xdef" }); // same address: no-op
    expect(dssOf(ACCT)?.txHash).toEqual("0xabc");
    expect(dssOf(null)).toBeNull();
    expect(dssOf("0x9999999999999999999999999999999999999999" as Address)).toBeNull();
  });

  it("reset clears the map (the test seam)", () => {
    setDss(ACCT, { dss: DSS, lau: LAU, txHash: null });
    resetDssForTests();
    expect(dssOf(ACCT)).toBeNull();
  });
});
