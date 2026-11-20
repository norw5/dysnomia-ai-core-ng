import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { keccak256, stringToBytes, toFunctionSelector } from "viem";
import lauAbi from "@abi/LAU.json";
import { addr } from "@config/addresses";
import {
  _dssAbi,
  _lauDeskAbi,
  affectionApproveData,
  captureDssFromReceipt,
  DSS_FIXED_CREATION,
  DSS_FIXED_RUNTIME,
  dssChatAndSnipeData,
  dssChatData,
  dssWithdrawLauData,
  encodeDssDeploy,
  lauChatData,
  lauMintToCapData,
  lauPurchaseData,
  resolveDssDeployment,
  validateDss,
} from "@/chain/dssDesk";
import { clearDss, dssOf, resetDssForTests, setDss } from "@/state/dssStore";
import type { AbiFunction, Address, PublicClient } from "viem";

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

/**
 * A PUSH-aware opcode scan of the EXECUTABLE prefix (the Solc CBOR metadata
 * is stripped first). Returns any Cancun-only opcodes: BLOBHASH 0x49,
 * BLOBBASEFEE 0x4a, TLOAD 0x5c, TSTORE 0x5d, MCOPY 0x5e. PUSH0 (0x5f) is
 * Shanghai and allowed. Bytes inside PUSH immediates are skipped (the
 * disassembler output's metadata "BLOBBASEFEE" was a false positive).
 */
function cancunOpcodeHits(hexWith0x: string): string[] {
  const raw = hexWith0x.replace(/^0x/, "").toLowerCase();
  const meta = raw.indexOf("a26469706673");
  const code = meta >= 0 ? raw.slice(0, meta) : raw;
  const bytes = code.match(/../g) ?? [];
  const bad: Record<number, string> = { 0x49: "BLOBHASH", 0x4a: "BLOBBASEFEE", 0x5c: "TLOAD", 0x5d: "TSTORE", 0x5e: "MCOPY" };
  const hits: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const op = Number.parseInt(bytes[i]!, 16);
    if (bad[op] !== undefined) hits.push(`${i.toString(16)}:${bad[op]}`);
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f; // skip the PUSH immediate
  }
  return hits;
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

  it("the shipped runtime hex is the harness fixture's runtime (verbatim copy)", () => {
    const shipped = readFileSync(new URL("../src/data/dss_fixed.runtime.hex", import.meta.url), "utf8").trim();
    const fixture = readFileSync(new URL("../../harness/fixtures/dss_fixed.runtime.hex", import.meta.url), "utf8").trim();
    expect(shipped.toLowerCase()).toBe(fixture.toLowerCase());
    expect(DSS_FIXED_RUNTIME).toBe(shipped.toLowerCase());
  });

  it("is Shanghai-only: the fixture targets shanghai and the executable code has no Cancun opcodes", () => {
    const foundry = readFileSync(new URL("../../harness/fixtures/dss-fixed/foundry.toml", import.meta.url), "utf8");
    expect(foundry).toMatch(/evm_version\s*=\s*"shanghai"/);
    const artifactPath = new URL(
      "../../harness/fixtures/dss-fixed/out/DysnomiaSelfSnipeFixed.sol/DSSFixed.json",
      import.meta.url
    );
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
      metadata?: { settings?: { evmVersion?: string }; compiler?: { version?: string } };
    };
    expect(artifact.metadata?.settings?.evmVersion).toBe("shanghai");
    expect(artifact.metadata?.compiler?.version).toContain("0.8.21");
    expect(cancunOpcodeHits(DSS_FIXED_CREATION)).toEqual([]);
    expect(cancunOpcodeHits(DSS_FIXED_RUNTIME)).toEqual([]);
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

describe("resolveDssDeployment (the lagging-receipt fallback)", () => {
  it("prefers the receipt's contractAddress", async () => {
    let reads = 0;
    const client = { getCode: async () => { reads++; return "0x6000"; } } as unknown as PublicClient;
    const r = await resolveDssDeployment(client, DSS, "0x7777777777777777777777777777777777777777", { attempts: 1, delayMs: 0 });
    expect(r.address).toEqual("0x7777777777777777777777777777777777777777");
    expect(r.source).toBe("receipt");
    expect(reads).toBe(0);
  });

  it("falls back to the CREATE1 prediction and polls code presence", async () => {
    let reads = 0;
    const client = {
      getCode: async () => {
        reads++;
        return reads >= 3 ? "0x6000" : "0x";
      },
    } as unknown as PublicClient;
    const r = await resolveDssDeployment(client, DSS, null, { attempts: 4, delayMs: 0 });
    expect(r.address).toEqual(DSS);
    expect(r.source).toBe("predicted");
    expect(reads).toBe(3);
  });

  it("refuses a predicted address that carries non-DSS code (the nonce moved)", async () => {
    const client = { getCode: async () => "0x6001" } as unknown as PublicClient;
    const r = await resolveDssDeployment(client, DSS, null, { attempts: 2, delayMs: 0, validate: async () => false });
    expect(r.address).toBeNull();
    expect(r.note).toContain("not the fixed DSS");
  });

  it("returns an honest manual-adopt note when the prediction/code is unavailable", async () => {
    const client = { getCode: async () => "0x" } as unknown as PublicClient;
    const r = await resolveDssDeployment(client, DSS, null, { attempts: 2, delayMs: 0 });
    expect(r.address).toBeNull();
    expect(r.note).toContain("adopt the address manually");
    const noPred = await resolveDssDeployment(client, null, null, { attempts: 1, delayMs: 0 });
    expect(noPred.address).toBeNull();
    expect(noPred.note).toContain("no CREATE1 prediction");
  });
});

/** a fake PublicClient covering the two structural reads validateDss uses */
function fakeDssClient(opts: {
  code?: string | Error;
  owner?: Address | Error;
  lau?: Address | Error;
}): PublicClient {
  const slot = (a: Address): `0x${string}` => (`0x${a.slice(2).toLowerCase().padStart(64, "0")}`) as `0x${string}`;
  return {
    getCode: async () => {
      if (opts.code instanceof Error) throw opts.code;
      return (opts.code ?? DSS_FIXED_RUNTIME) as `0x${string}`;
    },
    getStorageAt: async ({ slot: s }: { slot: `0x${string}` }) => {
      if (s === "0x0") {
        if (opts.owner instanceof Error) throw opts.owner;
        return slot(opts.owner ?? ACCT);
      }
      if (opts.lau instanceof Error) throw opts.lau;
      return slot(opts.lau ?? LAU);
    },
  } as unknown as PublicClient;
}

describe("validateDss (session-82.1 import path — structural, no getter)", () => {
  it("accepts the fixed runtime + the active account as owner + the active LAU", async () => {
    const v = await validateDss(fakeDssClient({}), DSS, ACCT, LAU);
    expect(v.ok).toBe(true);
    expect(v.code).toBe("match");
    expect(v.ownerMatches).toBe(true);
    expect(v.lauMatches).toBe(true);
    expect(v.reason).toBeNull();
  });

  it("refuses no code, a different runtime, a different owner, and a different LAU", async () => {
    const empty = await validateDss(fakeDssClient({ code: "0x" }), DSS, ACCT, LAU);
    expect(empty.ok).toBe(false);
    expect(empty.code).toBe("empty");

    const wrongCode = await validateDss(fakeDssClient({ code: "0x6000" }), DSS, ACCT, LAU);
    expect(wrongCode.ok).toBe(false);
    expect(wrongCode.code).toBe("mismatch");

    const other = "0x9999999999999999999999999999999999999999" as Address;
    const wrongOwner = await validateDss(fakeDssClient({ owner: other }), DSS, ACCT, LAU);
    expect(wrongOwner.ok).toBe(false);
    expect(wrongOwner.ownerMatches).toBe(false);
    expect(wrongOwner.reason).toContain("owner");

    const wrongLau = await validateDss(fakeDssClient({ lau: other }), DSS, ACCT, LAU);
    expect(wrongLau.ok).toBe(false);
    expect(wrongLau.lauMatches).toBe(false);
    expect(wrongLau.reason).toContain("binds");
  });

  it("treats an unreadable code/slot as unreadable, never a confident invalid", async () => {
    const codeErr = await validateDss(fakeDssClient({ code: new Error("rpc down") }), DSS, ACCT, LAU);
    expect(codeErr.ok).toBe(false);
    expect(codeErr.code).toBe("unreadable");
    expect(codeErr.reason).toContain("could not read the code");

    const slotErr = await validateDss(fakeDssClient({ owner: new Error("rpc down") }), DSS, ACCT, LAU);
    expect(slotErr.ok).toBe(false);
    expect(slotErr.code).toBe("match");
    expect(slotErr.reason).toContain("unreadable");
  });
});

describe("the dss store (capture-at-deploy, the home-QING law)", () => {
  it("records per account and is idempotent on the same address", () => {
    expect(dssOf(ACCT)).toBeNull();
    setDss(ACCT, { dss: DSS, lau: LAU, txHash: "0xabc", source: "deploy" });
    const rec = dssOf(ACCT);
    expect(rec?.dss).toEqual(DSS);
    expect(rec?.lau).toEqual(LAU);
    expect(rec?.source).toEqual("deploy");
    setDss(ACCT, { dss: DSS, lau: LAU, txHash: "0xdef" }); // same address: no-op
    expect(dssOf(ACCT)?.txHash).toEqual("0xabc");
    expect(dssOf(ACCT)?.source).toEqual("deploy");
    expect(dssOf(null)).toBeNull();
    expect(dssOf("0x9999999999999999999999999999999999999999" as Address)).toBeNull();
  });

  it("reset clears the map (the test seam)", () => {
    setDss(ACCT, { dss: DSS, lau: LAU, txHash: null });
    resetDssForTests();
    expect(dssOf(ACCT)).toBeNull();
  });

  it("forget clears one account's local record only", () => {
    const other = "0x9999999999999999999999999999999999999999" as Address;
    setDss(ACCT, { dss: DSS, lau: LAU, txHash: null, source: "import" });
    setDss(other, { dss: "0x7777777777777777777777777777777777777777" as Address, lau: LAU, txHash: null });
    clearDss(ACCT);
    expect(dssOf(ACCT)).toBeNull();
    expect(dssOf(other)?.dss).toEqual("0x7777777777777777777777777777777777777777");
  });
});
