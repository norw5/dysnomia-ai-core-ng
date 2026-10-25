import { describe, expect, it } from "vitest";
import {
  etaReadiness,
  isEtaNoLineageError,
  isFreshEta,
  loadVenueState,
  type VenueLiveState,
} from "@/chain/venueState";
import type { Address, PublicClient } from "viem";

const VENUE = "0xe41165bfd2c38a682289b2783d1e6e2e39e3766a" as Address;
const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as Address;
const LAU = "0x1111111111111111111111111111111111111111" as Address;
const YUE = "0x2222222222222222222222222222222222222222" as Address;

/** fake client driving loadVenueState's single aggregate3 batch */
function fakeClient(batch: unknown[] | "fail", block = 27_674_000n) {
  return {
    multicall: async () => {
      if (batch === "fail") {
        return Array.from({ length: 14 }, () => ({
          status: "failure",
          error: new Error("HTTP endpoint terminated"),
        }));
      }
      return batch;
    },
    getBlockNumber: async () => block,
  } as unknown as PublicClient;
}

function ok(v: unknown) {
  return { status: "success", result: v };
}
function fail(msg: string) {
  return { status: "failure", error: new Error(msg) };
}

const WAAT = 546076857050387070169172437346246747552937669132898852294332676898372438558n;
const ASSET = "0x81a6923ca480fada78cb15254c8d8cc382d2fbc0" as Address;

describe("loadVenueState (one anonymous batch, fail-fast discipline)", () => {
  it("anonymous round: no account skips account-dependent reads; GWAT/NoCROWS still read", async () => {
    const client = fakeClient([
      ok(WAAT),
      ok(ASSET),
      ok(77n),
      ok(1234n * 10n ** 18n),
      ok(0n),
      ok(0n),
      fail("MarketRateNotFound()"), // fresh venue — honest no-rate
      ok(true), // GWAT
      ok(false), // NoCROWS
    ]);
    const s = await loadVenueState(client, VENUE, null);
    expect(s.waat).toEqual(WAAT);
    expect(s.asset).toEqual(ASSET);
    expect(s.entropy).toEqual(77n);
    expect(s.coverCharge).toEqual(0n);
    expect(s.marketRateKnown).toBe(false);
    expect(s.marketRateAffection).toBeNull();
    expect(s.admitted).toBeNull();
    expect(s.myBalance).toBeNull();
    expect(s.gwat).toBe(true);
    expect(s.noCrows).toBe(false);
    expect(s.myBouncer).toBeNull();
    expect(s.myOwner).toBeNull();
    expect(s.myHypobar).toBeNull();
    expect(s.myEpibar).toBeNull();
    expect(s.errors).toEqual([]);
    expect(s.blockNumber).toEqual(27_674_000n);
  });

  it("account round: Admitted/balanceOf + the management-gate probes decoded", async () => {
    const client = fakeClient([
      ok(WAAT),
      ok(ASSET),
      ok(1n),
      ok(2n),
      ok(5n * 10n ** 17n),
      ok(1000n),
      ok(2n * 10n ** 18n),
      ok(true),
      ok(3n * 10n ** 18n),
      ok(true), // bouncer(account)
      ok(false), // owner(account)
      ok(true), // GWAT
      ok(false), // NoCROWS
    ]);
    const s = await loadVenueState(client, VENUE, ACCT);
    expect(s.marketRateKnown).toBe(true);
    expect(s.marketRateAffection).toEqual(2n * 10n ** 18n);
    expect(s.admitted).toBe(true);
    expect(s.myBalance).toEqual(3n * 10n ** 18n);
    expect(s.bouncerDivisor).toEqual(1000n);
    expect(s.coverCharge).toEqual(5n * 10n ** 17n);
    expect(s.myBouncer).toBe(true);
    expect(s.myOwner).toBe(false);
    expect(s.gwat).toBe(true);
    expect(s.noCrows).toBe(false);
  });

  it("the bouncer pass ORs the account probe with the LAU probe (the three-way door, kb/dev qing.md)", async () => {
    const client = fakeClient([
      ok(WAAT),
      ok(ASSET),
      ok(1n),
      ok(2n),
      ok(0n),
      ok(32n),
      fail("MarketRateNotFound()"),
      ok(true),
      ok(0n),
      ok(false), // bouncer(account) — no
      ok(false), // owner(account)
      ok(true), // bouncer(LAU) — the tx.origin's LAU passes
      ok(false), // GWAT
      ok(false), // NoCROWS
    ]);
    const s = await loadVenueState(client, VENUE, ACCT, { lau: LAU, yue: null });
    expect(s.myBouncer).toBe(true);
    expect(s.myOwner).toBe(false);
  });

  it("YUE.Bar rides the same batch when a YUE is active — the attendance record", async () => {
    const client = fakeClient([
      ok(WAAT),
      ok(ASSET),
      ok(1n),
      ok(2n),
      ok(0n),
      ok(32n),
      fail("MarketRateNotFound()"),
      ok(true),
      ok(0n),
      ok(false), // bouncer(account)
      ok(true), // owner(account)
      ok(false), // bouncer(LAU)
      ok(false), // GWAT
      ok(false), // NoCROWS
      ok([7n, 9n]), // Bar(venue) → (Hypogram, Epigram)
    ]);
    const s = await loadVenueState(client, VENUE, ACCT, { lau: LAU, yue: YUE });
    expect(s.myHypobar).toEqual(7n);
    expect(s.myEpibar).toEqual(9n);
  });

  it("the deed gate (session-51): own account token as the wrapped asset = the fast path", async () => {
    const client = fakeClient([
      ok(WAAT),
      ok(LAU), // the venue wraps YOUR LAU
      ok(1n),
      ok(2n),
      ok(0n),
      ok(32n),
      fail("MarketRateNotFound()"),
      ok(true),
      ok(0n),
      ok(false),
      ok(false),
      ok(false), // GWAT
      ok(false), // NoCROWS
    ]);
    const s = await loadVenueState(client, VENUE, ACCT, { lau: LAU, yue: null });
    expect(s.assetIsUserToken).toBe(true);
    expect(s.assetOwnerPass).toBe(true);
  });

  it("the deed gate: asset.owner(account) probed on the wrapped asset (follow-up read)", async () => {
    const ownerData = ("0x" + "0".repeat(63) + "1") as `0x${string}`;
    const calls: Array<{ to: string; data: string }> = [];
    const client = fakeClient([
      ok(WAAT),
      ok(ASSET),
      ok(1n),
      ok(2n),
      ok(0n),
      ok(32n),
      fail("MarketRateNotFound()"),
      ok(true),
      ok(0n),
      ok(false),
      ok(false),
      ok(false), // GWAT
      ok(false), // NoCROWS
    ]);
    (client as unknown as { call: unknown }).call = async (args: { to: string; data: string }) => {
      calls.push(args);
      return ownerData;
    };
    const s = await loadVenueState(client, VENUE, ACCT, { lau: LAU, yue: null });
    expect(s.assetIsUserToken).toBe(false);
    expect(s.assetOwnerPass).toBe(true);
    expect(calls[0]!.to.toLowerCase()).toBe(ASSET.toLowerCase());
    expect(calls[0]!.data.slice(0, 10)).toBe("0x666e1b39"); // owner(address)
    expect(calls[0]!.data.slice(10).toLowerCase()).toContain(ACCT.slice(2).toLowerCase());
  });

  it("the deed gate: an asset that does not answer owner(address) reads null (Take reverts raw)", async () => {
    const client = fakeClient([
      ok(WAAT),
      ok(ASSET),
      ok(1n),
      ok(2n),
      ok(0n),
      ok(32n),
      fail("MarketRateNotFound()"),
      ok(true),
      ok(0n),
      ok(false),
      ok(false),
      ok(false), // GWAT
      ok(false), // NoCROWS
    ]);
    (client as unknown as { call: unknown }).call = async () => {
      throw new Error("execution reverted");
    };
    const s = await loadVenueState(client, VENUE, ACCT, { lau: LAU, yue: null });
    expect(s.assetOwnerPass).toBeNull();
    expect(s.assetIsUserToken).toBe(false);
  });

  it("a dead RPC (all-failed round) throws — never renders as an empty venue", async () => {
    const client = fakeClient("fail");
    await expect(loadVenueState(client, VENUE, null)).rejects.toThrow(/venue reads failed/);
  });

  it("an unexpected per-call failure is named, not swallowed", async () => {
    const client = fakeClient([
      ok(WAAT),
      fail("execution reverted: something else"),
      ok(1n),
      ok(2n),
      ok(0n),
      ok(0n),
      fail("MarketRateNotFound()"),
      ok(false), // GWAT
      ok(false), // NoCROWS
    ]);
    const s = await loadVenueState(client, VENUE, null);
    expect(s.asset).toBeNull();
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toContain("Asset");
    expect(s.marketRateKnown).toBe(false); // MarketRateNotFound stays an honest no-rate
  });
});

describe("Eta readiness (kb §3 session-40 amendments)", () => {
  it("fresh-caller shape (14,0,0,0) is not ready — Beat would panic 0x12", () => {
    const slots = [14n, 0n, 0n, 0n] as const;
    expect(isFreshEta([...slots] as [bigint, bigint, bigint, bigint])).toBe(true);
    expect(etaReadiness([14n, 0n, 0n, 0n]).ready).toBe(false);
  });

  it("any nonzero slot past the head means the vault lineage exists", () => {
    expect(etaReadiness([14n, 7973995094115691n, 50653n, 69343957n]).ready).toBe(true);
    expect(etaReadiness([14n, 0n, 50653n, 0n]).ready).toBe(true);
    expect(etaReadiness([42n, 0n, 0n, 1n]).ready).toBe(true);
  });

  it("the reference sample classifies ready and is not the fresh marker", () => {
    const r = etaReadiness([14n, 7973995094115691n, 50653n, 69343957n]);
    expect(r.ready).toBe(true);
    expect(isFreshEta(r.slots)).toBe(false);
  });

  it("the no-vault-lineage revert (0x12efd467, session-43 fork probe) is classified", () => {
    expect(
      isEtaNoLineageError(
        new Error(
          "execution reverted: custom error 0x12efd467: 0000000000000000000000009522229037ae187b3757546f80aac1d9988f9d1e"
        )
      )
    ).toBe(true);
    expect(isEtaNoLineageError(new Error("HTTP 502"))).toBe(false);
  });
});

describe("VenueLiveState shape (agent payload source later)", () => {
  it("distinguishes unknown-rate from zero-rate", () => {
    const a: VenueLiveState = {
      venue: VENUE,
      waat: null,
      asset: null,
      entropy: null,
      totalSupply: null,
      coverCharge: null,
      bouncerDivisor: null,
      marketRateAffection: null,
      marketRateKnown: false,
      admitted: null,
      myBalance: null,
      gwat: null,
      noCrows: null,
      myBouncer: null,
      myOwner: null,
      myHypobar: null,
      myEpibar: null,
      assetOwnerPass: null,
      assetIsUserToken: false,
      errors: [],
      blockNumber: null,
      fetchedAt: 0,
    };
    const b = { ...a, marketRateAffection: 0n, marketRateKnown: true };
    expect(a.marketRateKnown).toBe(false);
    expect(b.marketRateKnown).toBe(true);
  });
});
