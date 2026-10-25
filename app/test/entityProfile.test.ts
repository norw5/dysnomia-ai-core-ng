import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { loadEntityProfile } from "@/chain/entityProfile";

/**
 * Entity-profile read discipline (DIRECTORY skeleton): one anonymous batch,
 * Username-revert = unset (honest null), all-failed round = dead RPC thrown
 * — never an empty profile (the session-41 viem trap, identity.ts rule).
 */

type Call = { address: string; functionName: string; args: readonly unknown[] };

function fakeClient(results: { status: "success" | "failure"; result?: unknown; error?: Error }[]) {
  const seen: Call[] = [];
  return {
    seen,
    client: {
      multicall: async ({ contracts }: { contracts: Call[] }) => {
        seen.push(...contracts);
        return results;
      },
      getBlockNumber: async () => 27_674_000n,
    } as unknown as PublicClient,
  };
}

describe("loadEntityProfile", () => {
  it("decodes a full batch and treats Username failure as UNSET (null), not an error", async () => {
    const fake = fakeClient([
      { status: "success", result: 1_000_000n },
      { status: "success", result: 5n },
      { status: "success", result: 0n },
      { status: "failure" },
      { status: "success", result: "Some Name" },
      { status: "success", result: "SN" },
    ]);
    const p = await loadEntityProfile(fake.client, "0xd32c39fee49391c7952d1b30b15921b0d3b42e69" as `0x${string}`);
    expect(p.pls).toEqual(1_000_000n);
    expect(p.affection).toEqual(5n);
    expect(p.choa).toEqual(0n);
    expect(p.username).toBeNull();
    expect(p.name).toEqual("Some Name");
    expect(p.symbol).toEqual("SN");
    expect(p.blockNumber).toEqual(27_674_000n);
    // anonymity: the reads carry the entity as an ARG; nothing sets from=
    expect(fake.seen).toHaveLength(6);
  });

  it("an all-failed round is a dead RPC — thrown, never an empty profile", async () => {
    const dead = { status: "failure" as const, error: new Error("fetch failed") };
    const fake = fakeClient([dead, dead, dead, dead, dead, dead]);
    await expect(
      loadEntityProfile(fake.client, "0xd32c39fee49391c7952d1b30b15921b0d3b42e69" as `0x${string}`)
    ).rejects.toThrow("entity reads failed");
  });

  it("kind=shio appends Rod/Cone to the SAME batch — the channel's SHA pair", async () => {
    const ROD = "0x1111111111111111111111111111111111111111";
    const CONE = "0x2222222222222222222222222222222222222222";
    const fake = fakeClient([
      { status: "success", result: 0n },
      { status: "success", result: 0n },
      { status: "success", result: 0n },
      { status: "failure" },
      { status: "success", result: "CHATLOG Shio" },
      { status: "success", result: "SHIO" },
      { status: "success", result: ROD },
      { status: "success", result: CONE },
    ]);
    const p = await loadEntityProfile(fake.client, "0x7ae73c498a308247be73688c09c96b3fd06ddb84" as `0x${string}`, "shio");
    expect(fake.seen).toHaveLength(8); // one batch
    expect(p.rod).toEqual(ROD);
    expect(p.cone).toEqual(CONE);
    expect(p.origin).toBeNull();
    expect(fake.seen[6]!.functionName).toBe("Rod");
    expect(fake.seen[7]!.functionName).toBe("Cone");
  });

  it("kind=yue appends Origin to the SAME batch; a failed read stays null", async () => {
    const fake = fakeClient([
      { status: "success", result: 1n },
      { status: "success", result: 2n },
      { status: "success", result: 3n },
      { status: "failure" },
      { status: "success", result: "mariarahel" },
      { status: "success", result: "德" },
      { status: "success", result: "0x047460633210e2dd1f0cd6f5e26d92b30f9bd70f" },
    ]);
    const p = await loadEntityProfile(fake.client, "0xc7c28ea0e31a7d29e22b7600e34e65e99d8712ec" as `0x${string}`, "yue");
    expect(fake.seen).toHaveLength(7); // one batch
    expect(p.origin).toEqual("0x047460633210e2dd1f0cd6f5e26d92b30f9bd70f");
    expect(p.rod).toBeNull();
    expect(p.cone).toBeNull();
  });

  it("kind=shio with a failed Rod read keeps the honest null (never zero-address)", async () => {
    const fake = fakeClient([
      { status: "success", result: 0n },
      { status: "success", result: 0n },
      { status: "success", result: 0n },
      { status: "failure" },
      { status: "failure" },
      { status: "failure" },
      { status: "failure", error: new Error("not a shio") },
      { status: "failure", error: new Error("not a shio") },
    ]);
    const p = await loadEntityProfile(fake.client, "0x0000000000000000000000000000000000000001" as `0x${string}`, "shio");
    expect(p.rod).toBeNull();
    expect(p.cone).toBeNull();
  });
});
