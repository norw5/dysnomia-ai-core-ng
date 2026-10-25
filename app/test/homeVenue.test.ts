import { afterEach, describe, expect, it } from "vitest";
import type { Address } from "viem";
import { homeVenue, resetHomeVenueForTests, setHomeVenue } from "@/state/homeVenue";
import { onboardingSteps, type PlayerSnapshot } from "@/chain/identity";
import { snapshotMessage } from "@/agent/knowledge";

/**
 * The home-QING store (session-65, the owner's feature round): the captured
 * record of the venue that wraps the account's own LAU — per-account, the
 * pendingLau pattern; the OPTIONAL fifth onboarding step completes on it and
 * PLAYER_STATE carries it.
 */

const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as Address;
const ACCT2 = "0x2222222222222222222222222222222222222222" as Address;
const LAU = "0x1111111111111111111111111111111111111111" as Address;
const QING = "0x3333333333333333333333333333333333333333" as Address;
const QING2 = "0x4444444444444444444444444444444444444444" as Address;

afterEach(() => {
  resetHomeVenueForTests();
});

const SNAP: PlayerSnapshot = {
  account: ACCT,
  lau: LAU,
  yue: "0x2222222222222222222222222222222222222222" as Address,
  lauName: null,
  lauSymbol: null,
  username: "alice",
  yueName: null,
  yueSymbol: null,
  balances: {
    pls: { wallet: 10n, lau: 0n, yue: 0n },
    affection: { wallet: 0n, lau: 0n, yue: 0n },
    choa: { wallet: 0n, lau: 0n, yue: 0n },
  },
  yuanChoa: 0n,
  blockNumber: 27_674_000n,
  fetchedAt: 1_700_000_000_000,
};

describe("the home-QING store lifecycle (per account, the pendingLau pattern)", () => {
  it("starts empty and records the captured create", () => {
    expect(homeVenue(ACCT)).toBeNull();
    setHomeVenue(ACCT, { venue: QING, asset: LAU, waat: "12345", txHash: "0xabc" });
    const rec = homeVenue(ACCT);
    expect(rec).not.toBeNull();
    expect(rec!.venue).toEqual(QING);
    expect(rec!.asset).toEqual(LAU);
    expect(rec!.waat).toEqual("12345");
  });

  it("is keyed per account — a second wallet keeps its own row", () => {
    setHomeVenue(ACCT, { venue: QING, asset: LAU, waat: "1", txHash: null });
    expect(homeVenue(ACCT2)).toBeNull();
    setHomeVenue(ACCT2, { venue: QING2, asset: "0x5555555555555555555555555555555555555555" as Address, waat: "2", txHash: null });
    expect(homeVenue(ACCT)!.venue).toEqual(QING);
    expect(homeVenue(ACCT2)!.venue).toEqual(QING2);
  });

  it("re-capturing the same venue is idempotent (timestamp survives)", () => {
    setHomeVenue(ACCT, { venue: QING, asset: LAU, waat: "1", txHash: null });
    const first = homeVenue(ACCT)!;
    setHomeVenue(ACCT, { venue: QING, asset: LAU, waat: "1", txHash: null });
    expect(homeVenue(ACCT)).toEqual(first);
  });

  it("null account answers null — never throws", () => {
    expect(homeVenue(null)).toBeNull();
  });
});

describe("the optional fifth onboarding step (owner round: recommended YES, still optional)", () => {
  it("completes only on the captured record and never blocks the required chain", () => {
    const without = onboardingSteps(ACCT, SNAP);
    expect(without.find((s) => s.id === "qing")!.done).toBe(false);
    expect(without.filter((s) => !s.optional).every((s) => s.done)).toBe(true);

    setHomeVenue(ACCT, { venue: QING, asset: LAU, waat: "1", txHash: null });
    const with_ = onboardingSteps(ACCT, SNAP, null, homeVenue(ACCT) !== null);
    expect(with_.every((s) => s.done)).toBe(true);
  });

  it("PLAYER_STATE names the home QING; without it the optional step rides the remaining list", () => {
    setHomeVenue(ACCT, { venue: QING, asset: LAU, waat: "1", txHash: null });
    const msg = snapshotMessage(SNAP, null);
    expect(msg.content).toContain("homeQing");
    expect(msg.content).toContain(QING);
    // the required chain is complete → no "onboarding remaining" noise at all
    expect(msg.content).not.toContain("onboarding remaining");
    // without the record: no homeQing line, the optional step listed AS optional
    resetHomeVenueForTests();
    const msg2 = snapshotMessage(SNAP, null);
    expect(msg2.content).not.toContain("homeQing");
    expect(msg2.content).toContain("onboarding remaining");
    expect(msg2.content).toContain("(optional)");
  });
});
