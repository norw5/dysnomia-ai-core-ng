import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes, toFunctionSelector } from "viem";
import type { Address, PublicClient } from "viem";
import index from "@abi/index.json";
import {
  _erc20ViewAbi,
  _yueDeskAbi,
  loadVenuePurchaseLeg,
  loadVenueRedeemLeg,
  loadYueDesk,
} from "@/chain/yueDesk";
import { purchaseCost } from "@/ui/views/MarketView";

const YUE = "0x2222222222222222222222222222222222222222" as Address;
const VENUE = "0xe41165bfd2c38a682289b2783d1e6e2e39e3766a" as Address;
const ASSET = "0x81a6923ca480fada78cb15254c8d8cc382d2fbc0" as Address;
const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as Address;

describe("yueDesk reader (one anonymous batch, fail-fast discipline)", () => {
  it("the hand-pinned fragments match keccak selectors + the generated YUE.json index", () => {
    expect(keccak256(stringToBytes("GetAssetRate(address,address)")).slice(0, 10)).toBe("0x7f3c46c0");
    expect(keccak256(stringToBytes("IsValidAsset(address,address)")).slice(0, 10)).toBe("0xc7a68962");
    expect(keccak256(stringToBytes("Hong(address,address,uint256)")).slice(0, 10)).toBe("0xb3bde122");
    expect(keccak256(stringToBytes("Hung(address,address,uint256)")).slice(0, 10)).toBe("0x518945cd");
    expect(keccak256(stringToBytes("Redeem(address,uint256)")).slice(0, 10)).toBe("0x222838db");
    // the desk fragments encode to exactly those selectors
    expect(toFunctionSelector(_yueDeskAbi[0])).toBe("0x7f3c46c0");
    expect(toFunctionSelector(_yueDeskAbi[1])).toBe("0xc7a68962");
    expect(toFunctionSelector(_erc20ViewAbi[0])).toBe("0x70a08231");
    expect(toFunctionSelector(_erc20ViewAbi[1])).toBe("0xdd62ed3e");
    // the generated index carries the YUE desk rows with matching signatures
    const ys = (index as unknown as { YUE: { selectors: Record<string, { name: string; types: string; mutability?: string }> } }).YUE.selectors;
    expect(ys["0xb3bde122"]?.name).toBe("Hong");
    expect(ys["0xb3bde122"]?.types).toBe("address,address,uint256");
    expect(ys["0xb3bde122"]?.mutability).toBe("nonpayable");
    expect(ys["0x518945cd"]?.name).toBe("Hung");
    expect(ys["0x7f3c46c0"]?.name).toBe("GetAssetRate");
    expect(ys["0xc7a68962"]?.name).toBe("IsValidAsset");
    expect(ys["0x222838db"]?.name).toBe("Redeem");
  });

  it("anonymous round: no account reads only the four vault-side rows; 0 rate is an honest no-route", async () => {
    const client = fakeClient([ok(0n), ok(true), ok(5n), ok(0n)]);
    const s = await loadYueDesk(client, YUE, VENUE, ASSET, null);
    expect(s.rate).toBe(0n); // no route — ExchangeRateNotFound on use
    expect(s.pairValid).toBe(true);
    expect(s.yueQingPot).toBe(5n);
    expect(s.yueAssetPot).toBe(0n);
    expect(s.myQing).toBeNull();
    expect(s.qingAllowance).toBeNull();
    expect(s.errors).toEqual([]);
  });

  it("full round: the walk rate, both vault pots and the two spend legs", async () => {
    const client = fakeClient([ok(10n ** 18n), ok(true), ok(30n), ok(7n), ok(3n), ok(100n), ok(0n), ok(2n)]);
    const s = await loadYueDesk(client, YUE, VENUE, ASSET, ACCT);
    expect(s.rate).toBe(10n ** 18n);
    expect(s.yueQingPot).toBe(30n);
    expect(s.yueAssetPot).toBe(7n);
    expect(s.myQing).toBe(3n);
    expect(s.myAsset).toBe(100n);
    expect(s.qingAllowance).toBe(0n);
    expect(s.assetAllowance).toBe(2n);
  });

  it("a dead RPC (all-failed round) throws — never renders as an empty vault", async () => {
    const client = fakeClient("fail", 8n);
    await expect(loadYueDesk(client, YUE, VENUE, ASSET, ACCT)).rejects.toThrow(/desk reads failed/);
  });

  it("per-call failures are named, not swallowed", async () => {
    const client = fakeClient([fail("execution reverted"), ok(true), fail("nope"), ok(0n), ok(0n), ok(0n), ok(0n), ok(0n)]);
    const s = await loadYueDesk(client, YUE, VENUE, ASSET, ACCT);
    expect(s.rate).toBeNull();
    expect(s.yueQingPot).toBeNull();
    expect(s.errors).toHaveLength(2);
    expect(s.errors.join(" ")).toContain("GetAssetRate");
    expect(s.errors.join(" ")).toContain("vault qing pot");
  });

  it("the desk cost is the deployed rate math (amount × rate / 1e18)", () => {
    const UNIT = 10n ** 18n;
    expect(purchaseCost(2n * UNIT, UNIT)).toBe(2n * UNIT); // the s12 fork pin: 1:1 posted rate
    expect(purchaseCost(3n * UNIT, 2n * UNIT)).toBe(6n * UNIT);
    expect(purchaseCost(UNIT, 10n ** 17n)).toBe(10n ** 17n);
  });
});

describe("the Ⓐ Redeem leg reader", () => {
  it("anonymous round reads only the venue's Ⓐ escrow", async () => {
    const client = fakeClient([ok(4n * 10n ** 18n)]);
    const s = await loadVenueRedeemLeg(client, VENUE, null);
    expect(s.affectionEscrow).toBe(4n * 10n ** 18n);
    expect(s.selfAllowance).toBeNull();
    expect(s.myQing).toBeNull();
  });

  it("full round: the escrow + the venue-token self-allowance + your venue tokens", async () => {
    const client = fakeClient([ok(4n), ok(1n), ok(2n)]);
    const s = await loadVenueRedeemLeg(client, VENUE, ACCT);
    expect(s.affectionEscrow).toBe(4n);
    expect(s.selfAllowance).toBe(1n);
    expect(s.myQing).toBe(2n);
  });

  it("a dead RPC throws (the identity.ts discipline)", async () => {
    const client = fakeClient("fail", 3n);
    await expect(loadVenueRedeemLeg(client, VENUE, ACCT)).rejects.toThrow(/redeem-leg reads failed/);
  });
});

describe("the Ⓐ Purchase leg reader (session-55)", () => {
  it("anonymous round reads nothing (the allowance is account-dependent)", async () => {
    const client = fakeClient([]);
    const s = await loadVenuePurchaseLeg(client, VENUE, null);
    expect(s.affectionAllowance).toBeNull();
    expect(s.errors).toEqual([]);
  });

  it("full round: the Ⓐ allowance with spender == the venue (the Purchase prerequisite)", async () => {
    const client = fakeClient([ok(7n)]);
    const s = await loadVenuePurchaseLeg(client, VENUE, ACCT);
    expect(s.affectionAllowance).toBe(7n);
    expect(s.errors).toEqual([]);
  });

  it("a dead RPC throws (a 1-call batch: any failure is the whole round — the tool then treats the allowance as unreadable/short)", async () => {
    const client = fakeClient("fail", 1n);
    await expect(loadVenuePurchaseLeg(client, VENUE, ACCT)).rejects.toThrow(/purchase-leg read failed/);
    const reverted = fakeClient([fail("execution reverted")]);
    await expect(loadVenuePurchaseLeg(reverted, VENUE, ACCT)).rejects.toThrow(/purchase-leg read failed/);
  });
});

// ---------------- the fake-client harness ----------------

function ok(v: unknown) {
  return { status: "success", result: v };
}
function fail(msg: string) {
  return { status: "failure", error: new Error(msg) };
}

/** fake client driving the single aggregate3 batch */
function fakeClient(batch: unknown[] | "fail", block = 27_674_000n, len = 0) {
  return {
    multicall: async () => {
      if (batch === "fail") {
        return Array.from({ length: len || 8 }, () => ({
          status: "failure",
          error: new Error("HTTP endpoint terminated"),
        }));
      }
      return batch;
    },
    getBlockNumber: async () => block,
  } as unknown as PublicClient;
}
