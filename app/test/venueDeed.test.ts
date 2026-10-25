import { describe, expect, it } from "vitest";
import { encodeFunctionResult, keccak256, stringToBytes, type Address } from "viem";
import {
  DO_TAKE_SELECTOR,
  NEW_QING_TOPIC,
  decodeNewQing,
  encodeTake,
  readCreatePrecheck,
  type NewQingFacts,
} from "@/chain/venueDeed";
import type { PublicClient } from "viem";

/**
 * The session-51 deed + creation layer: the hand-pinned DO fragment (no
 * recovered source — the selector is chain-verified knowledge and gets
 * regression-pinned HERE), the NewQing data-word decode (args NOT indexed),
 * and the Forbidden pre-check read discipline.
 */

const VENUE = "0xb0ba7d36b7f0505879179ece7401f24eb653c6e1" as Address; // Phobos (config-pinned)
const ASSET = "0x81a6923ca480fada78cb15254c8d8cc382d2fbc0" as Address;
const ACCT = "0xf39fd6e51aad88f6f4ce6279cfffb92266f4ce6ab" as Address;

describe("DO.Take fragment (kb/dev/do.md §5 — hand-pinned, [chain]-verified)", () => {
  it("encodes the chain-verified selector 0x8f26e8d5", () => {
    expect(DO_TAKE_SELECTOR).toBe("0x8f26e8d5");
    const data = encodeTake(VENUE);
    expect(data.slice(0, 10)).toBe("0x8f26e8d5");
    expect(keccak256(stringToBytes("Take(address)")).slice(0, 10)).toBe("0x8f26e8d5");
    expect(data.slice(10).toLowerCase()).toBe(VENUE.slice(2).toLowerCase().padStart(64, "0"));
  });
});

describe("decodeNewQing (args NOT indexed — the data words carry the facts)", () => {
  it("topic pin: keccak(NewQing(address,address,uint256))", () => {
    expect(NEW_QING_TOPIC).toBe(keccak256(stringToBytes("NewQing(address,address,uint256)")));
  });

  function newQingLog(qing: Address, asset: Address, waat: bigint) {
    const body =
      qing.slice(2).toLowerCase().padStart(64, "0") +
      asset.slice(2).toLowerCase().padStart(64, "0") +
      waat.toString(16).padStart(64, "0");
    return { address: "0xD3a7A95012Edd46Ea115c693B74c5e524b3DdA75", topics: [NEW_QING_TOPIC], data: ("0x" + body) as `0x${string}` };
  }

  it("decodes (qing, asset, waat) from the receipt log", () => {
    const waat = 546076857050387070169172437346246747552937669132898852294332676898372438558n;
    const facts: NewQingFacts | null = decodeNewQing([newQingLog(VENUE, ASSET, waat)]);
    expect(facts).not.toBeNull();
    expect(facts!.qing.toLowerCase()).toBe(VENUE.toLowerCase());
    expect(facts!.asset.toLowerCase()).toBe(ASSET.toLowerCase());
    expect(facts!.waat).toBe(waat);
  });

  it("ignores unrelated logs and refuses junk data", () => {
    const transfer = {
      address: ASSET,
      topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x00", "0x00"],
      data: "0x" as `0x${string}`,
    };
    expect(decodeNewQing([transfer])).toBeNull();
    expect(decodeNewQing([{ ...newQingLog(VENUE, ASSET, 1n), data: "0x" }])).toBeNull();
    expect(decodeNewQing([])).toBeNull();
  });
});

describe("readCreatePrecheck (Forbidden with the caller as tx.origin + name/symbol probes)", () => {
  const calls: Array<{ to: string; data: string; account?: Address }> = [];

  function fakeClient(results: Array<`0x${string}` | Error>) {
    let i = 0;
    return {
      call: async (args: { to: string; data: `0x${string}`; account?: Address }) => {
        calls.push(args);
        const r = results[Math.min(i, results.length - 1)]!;
        i += 1;
        if (r instanceof Error) throw r;
        return r;
      },
    } as unknown as PublicClient;
  }

  const boolWord = (v: boolean) => ("0x" + (v ? "1" : "0").padStart(64, "0")) as `0x${string}`;
  const strWord = (s: string) =>
    encodeFunctionResult({ abi: [{ type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }], functionName: "name", result: s });

  it("reads Forbidden(asset) with from=account (the WITHOUT leg is tx.origin-keyed)", async () => {
    const client = fakeClient([boolWord(false), strWord("Harness Asset"), strWord("HASS")]);
    const p = await readCreatePrecheck(client, ASSET, ACCT);
    expect(calls[0]!.to.toLowerCase()).toBe("0xd3a7a95012edd46ea115c693b74c5e524b3dda75"); // MAP (config-pinned)
    expect(calls[0]!.data.slice(0, 10)).toBe("0xa59d7f4d"); // Forbidden(address)
    expect(calls[0]!.data.slice(10).toLowerCase()).toContain(ASSET.slice(2).toLowerCase());
    expect(calls[0]!.account).toBe(ACCT);
    expect(p.forbidden).toBe(false);
    expect(p.assetName).toBe("Harness Asset");
    expect(p.assetSymbol).toBe("HASS");
    expect(p.error).toBeNull();
  });

  it("a forbidden asset reads true (owner veto or the caller holds WITHOUT)", async () => {
    const p = await readCreatePrecheck(fakeClient([boolWord(true), strWord("X"), strWord("Y")]), ASSET, ACCT);
    expect(p.forbidden).toBe(true);
  });

  it("an unreadable Forbidden is null — never a confident not-forbidden", async () => {
    const p = await readCreatePrecheck(fakeClient([new Error("HTTP endpoint terminated")]), ASSET, ACCT);
    expect(p.forbidden).toBeNull();
    expect(p.error).toContain("terminated");
  });

  it("anonymous pre-check omits the account (the read stays anonymous-shaped)", async () => {
    calls.length = 0;
    await readCreatePrecheck(fakeClient([boolWord(false)]), ASSET, null);
    expect(calls[0]!.account).toBeUndefined();
  });
});
