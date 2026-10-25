import { describe, expect, it } from "vitest";
import { encodeFunctionData, keccak256, stringToBytes, toFunctionSelector, type AbiFunction } from "viem";
import choAbi from "@abi/CHO.json";
import { ALIASES_WALK_BOUND, choBookAbi, loadAddressBook, searchAddressBook } from "@/chain/addressBook";
import type { PublicClient } from "viem";

/**
 * The CHO address book (session-53, B1.6): walk discipline — ONE batch
 * probes a fixed index bound, the CONTIGUOUS SUCCESS PREFIX is the book
 * (Aliases is a string[]; past-the-end reverts), round 2 resolves every
 * alias through Addresses. All-failed round = dead RPC thrown, never an
 * empty book (the session-41 viem trap). Selector pins: the hand fragments
 * must match keccak + the generated CHO.json (the s34 discipline).
 */

type Call = { address: string; functionName: string; args: readonly unknown[] };
type Res = { status: "success" | "failure"; result?: unknown; error?: Error };

function fakeClient(rounds: Res[][]) {
  let round = 0;
  const seen: Call[] = [];
  return {
    seen,
    client: {
      multicall: async ({ contracts }: { contracts: Call[] }) => {
        seen.push(...contracts);
        const r = rounds[round];
        round++;
        if (r === undefined) throw new Error("unexpected extra multicall round");
        return r;
      },
      getBlockNumber: async () => 27_674_000n,
    } as unknown as PublicClient,
  };
}

const fail = (): Res => ({ status: "failure", error: new Error("out of range") });

describe("loadAddressBook", () => {
  it("walks the contiguous prefix and resolves addresses in boot order", async () => {
    const r1: Res[] = [
      { status: "success", result: "source" },
      { status: "success", result: "CROWS" },
      { status: "success", result: "WITHOUT" },
      ...Array.from({ length: ALIASES_WALK_BOUND - 3 }, fail),
    ];
    const A1 = "0x0474606332105a1da6fc8ef7de2470551d389cb9";
    const A2 = "0x203e366a1821570b2f84ff5ae8b3bdeb48dc4fa1";
    const A3 = "0x173216ed67ebf3e6767d86e8b3ff32e0d64437bf";
    const fake = fakeClient([r1, [{ status: "success", result: A1 }, { status: "success", result: A2 }, { status: "success", result: A3 }]]);
    const book = await loadAddressBook(fake.client);
    expect(fake.seen[0]!.functionName).toBe("Aliases");
    expect(fake.seen).toHaveLength(ALIASES_WALK_BOUND + 3); // one walk batch + one resolve batch
    expect(book.rows.map((r) => r.alias)).toEqual(["source", "CROWS", "WITHOUT"]);
    expect(book.rows.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(book.rows[0]!.address?.toLowerCase()).toBe(A1);
    expect(book.rows[2]!.address?.toLowerCase()).toBe(A3);
    expect(book.blockNumber).toEqual(27_674_000n);
    // anonymity: args carry indices/aliases; nothing sets from= (multicall discipline)
  });

  it("a gap in the walk truncates the book to the prefix (never skips past a failure)", async () => {
    const r1: Res[] = [
      { status: "success", result: "source" },
      { status: "failure", error: new Error("flaky") },
      { status: "success", result: "WITHOUT" }, // must NOT be picked up
      ...Array.from({ length: ALIASES_WALK_BOUND - 3 }, fail),
    ];
    const fake = fakeClient([r1, [{ status: "success", result: "0x0474606332105a1da6fc8ef7de2470551d389cb9" }]]);
    const book = await loadAddressBook(fake.client);
    expect(book.rows.map((r) => r.alias)).toEqual(["source"]);
  });

  it("an all-failed aliases round is a dead RPC — thrown, never an empty book", async () => {
    const dead = Array.from({ length: ALIASES_WALK_BOUND }, () => ({ status: "failure" as const, error: new Error("fetch failed") }));
    const fake = fakeClient([dead]);
    await expect(loadAddressBook(fake.client)).rejects.toThrow("address-book reads failed (aliases)");
  });

  it("an all-failed addresses round is thrown too", async () => {
    const r1: Res[] = [{ status: "success", result: "source" }, ...Array.from({ length: ALIASES_WALK_BOUND - 1 }, fail)];
    const fake = fakeClient([r1, [{ status: "failure", error: new Error("fetch failed") }]]);
    await expect(loadAddressBook(fake.client)).rejects.toThrow("address-book reads failed (addresses)");
  });

  it("a zero Addresses result stays an honest null address row", async () => {
    const r1: Res[] = [{ status: "success", result: "ghost" }, ...Array.from({ length: ALIASES_WALK_BOUND - 1 }, fail)];
    const fake = fakeClient([r1, [{ status: "success", result: "0x0000000000000000000000000000000000000000" }]]);
    const book = await loadAddressBook(fake.client);
    expect(book.rows).toHaveLength(1);
    expect(book.rows[0]!.address).toBeNull();
  });
});

describe("searchAddressBook", () => {
  const book = {
    rows: [
      { index: 0, alias: "source", address: ("0x0474606332105a1da6fc8ef7de2470551d389cb9" as `0x${string}`) },
      { index: 1, alias: "CROWS", address: ("0x203e366a1821570b2f84ff5ae8b3bdeb48dc4fa1" as `0x${string}`) },
      { index: 2, alias: "WITHOUT", address: null },
    ],
    blockNumber: null,
    fetchedAt: 0,
  };
  it("empty query returns the whole book", () => {
    expect(searchAddressBook(book, "")).toHaveLength(3);
  });
  it("matches alias substrings case-insensitively", () => {
    expect(searchAddressBook(book, "crows").map((r) => r.alias)).toEqual(["CROWS"]);
  });
  it("matches address prefixes", () => {
    expect(searchAddressBook(book, "0x203e36").map((r) => r.alias)).toEqual(["CROWS"]);
  });
  it("null-address rows never match address queries", () => {
    expect(searchAddressBook(book, "0x0000")).toHaveLength(0);
  });
});

describe("selector pins (the s34 discipline)", () => {
  it("the hand fragments match keccak selectors", () => {
    expect(keccak256(stringToBytes("Aliases(uint256)")).slice(0, 10)).toEqual(encodeFunctionData({ abi: choBookAbi, functionName: "Aliases", args: [0n] }).slice(0, 10));
    expect(keccak256(stringToBytes("Addresses(string)")).slice(0, 10)).toEqual(encodeFunctionData({ abi: choBookAbi, functionName: "Addresses", args: ["x"] }).slice(0, 10));
  });
  it("the canonical abi/CHO.json carries both views with matching selectors", () => {
    const fns = (choAbi as unknown as AbiFunction[]).filter((e) => e.type === "function" && (e.name === "Aliases" || e.name === "Addresses"));
    const aliases = fns.find((f) => f.name === "Aliases")!;
    const addresses = fns.find((f) => f.name === "Addresses")!;
    expect(aliases.stateMutability).toBe("view");
    expect(addresses.stateMutability).toBe("view");
    expect(toFunctionSelector(aliases)).toEqual(keccak256(stringToBytes("Aliases(uint256)")).slice(0, 10));
    expect(toFunctionSelector(addresses)).toEqual(keccak256(stringToBytes("Addresses(string)")).slice(0, 10));
  });
});
