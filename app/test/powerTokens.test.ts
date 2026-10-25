import { describe, expect, it } from "vitest";
import { loadPowerTokens, POWER_TOKENS } from "@/chain/powerTokens";
import { addr } from "@config/addresses";
import type { Address, PublicClient } from "viem";

const ACCT = "0xf39fd6e51aad88f6d4ce6ab8827279cfffb92266" as Address;
const LAU = "0x1111111111111111111111111111111111111111" as Address;
const YUE = "0x2222222222222222222222222222222222222222" as Address;

/** fake client driving loadPowerTokens's single aggregate3 batch */
function fakeClient(batch: unknown[] | "fail", block = 27_674_000n) {
  return {
    multicall: async () => {
      if (batch === "fail") {
        return Array.from({ length: 20 }, () => ({ status: "failure", error: new Error("HTTP endpoint terminated") }));
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

/** per-token batch legs: name, symbol, bal(wallet), bal(lau)?, bal(yue)? */
function legsPerToken(lau: Address | null, yue: Address | null): number {
  return 3 + (lau !== null ? 1 : 0) + (yue !== null ? 1 : 0);
}

function baseBatch(lau: Address | null, yue: Address | null, fill: (token: number, field: string) => unknown): unknown[] {
  const out: unknown[] = [];
  POWER_TOKENS.forEach((_, i) => {
    out.push(ok(fill(i, "name")));
    out.push(ok(fill(i, "symbol")));
    out.push(ok(fill(i, "wallet")));
    if (lau !== null) out.push(ok(fill(i, "lau")));
    if (yue !== null) out.push(ok(fill(i, "yue")));
  });
  return out;
}

describe("POWER_TOKENS (config-driven, the four constellation channels)", () => {
  it("resolves every address through the perimeter table", () => {
    expect(POWER_TOKENS.map((t) => t.key)).toEqual(["Fornax", "Eris", "Fomalhaute", "Tethys"]);
    expect(addr("FornaxSHIO")).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(addr("ErisSHIO")).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(addr("WorldChatSHIO")).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // Tethys IS the CHO hub (kb §1 — the label collision)
    expect(POWER_TOKENS[3]!.config).toBe("CHO");
  });
});

describe("loadPowerTokens (one anonymous batch, the identity discipline)", () => {
  it("anonymous account: wallet balances + names, no LAU/YUE legs, Yuan = wallet", async () => {
    const client = fakeClient(baseBatch(null, null, (i, f) => (f === "name" ? `T${i}` : f === "symbol" ? `S${i}` : BigInt(i + 1) * 10n ** 18n)));
    const s = await loadPowerTokens(client, ACCT, null, null);
    expect(s.rows).toHaveLength(4);
    expect(s.rows[0]).toMatchObject({ key: "Fornax", name: "T0", symbol: "S0" });
    expect(s.rows[0]!.balances).toEqual({ wallet: 10n ** 18n, lau: 0n, yue: 0n });
    expect(s.rows[0]!.yuan).toEqual(10n ** 18n);
    expect(s.errors).toEqual([]);
    expect(s.blockNumber).toEqual(27_674_000n);
  });

  it("full account: Yuan = wallet + 10×LAU + 40×YUE per token", async () => {
    const client = fakeClient(
      baseBatch(LAU, YUE, (_i, f) => {
        if (f === "name") return "N";
        if (f === "symbol") return "S";
        if (f === "wallet") return 1n;
        if (f === "lau") return 2n;
        return 3n; // yue
      })
    );
    const s = await loadPowerTokens(client, ACCT, LAU, YUE);
    for (const r of s.rows) {
      expect(r.balances).toEqual({ wallet: 1n, lau: 2n, yue: 3n });
      expect(r.yuan).toEqual(1n + 10n * 2n + 40n * 3n); // 141
    }
  });

  it("a dead RPC (all-failed round) throws — never renders as zero holdings", async () => {
    const client = fakeClient("fail");
    await expect(loadPowerTokens(client, ACCT, null, null)).rejects.toThrow(/power-token reads failed/);
  });

  it("an unexpected per-call failure is named and blanks that token's Yuan, not everyone's", async () => {
    const batch = baseBatch(LAU, null, (_i, f) => (f === "name" ? "N" : f === "symbol" ? "S" : 5n));
    // corrupt Fornax's wallet-balance leg (index 2)
    batch[2] = fail("execution reverted: weird");
    const client = fakeClient(batch);
    const s = await loadPowerTokens(client, ACCT, LAU, null);
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toContain("Fornax.wallet");
    expect(s.rows[0]!.yuan).toBeNull(); // the corrupted sum is withheld
    expect(s.rows[1]!.yuan).not.toBeNull(); // Eris unaffected
  });

  it("batch shape tracks the LAU/YUE legs (the join the fake client pins)", () => {
    expect(legsPerToken(null, null) * POWER_TOKENS.length).toEqual(12);
    expect(legsPerToken(LAU, null) * POWER_TOKENS.length).toEqual(16);
    expect(legsPerToken(LAU, YUE) * POWER_TOKENS.length).toEqual(20);
  });
});
