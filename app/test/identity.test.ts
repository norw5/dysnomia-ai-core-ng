import { describe, expect, it } from "vitest";
import { encodeFunctionData, encodeFunctionResult, keccak256, stringToBytes, toFunctionSelector, type AbiFunction } from "viem";
import lauAbi from "@abi/LAU.json";
import siuAbi from "@abi/SIU.json";
import voidAbi from "@abi/VOID.json";
import {
  AGENT_PAYLOAD_CAP,
  fmtAmt,
  isUserNotEnteredError,
  loadPlayerSnapshot,
  onboardingSteps,
  readPlayerBirth,
  readPlayerMoment,
  readVenueLabel,
  toAgentPayload,
  usernameError,
  type PlayerSnapshot,
} from "@/chain/identity";

const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as const;
const LAU = "0x0000000000000000000000000000000000000011" as const;
const YUE = "0x0000000000000000000000000000000000000022" as const;
const ZERO = "0x0000000000000000000000000000000000000000";

describe("username live check (attribute.sol caps Username at 12 BYTES)", () => {
  it("accepts 12 bytes", () => {
    expect(usernameError("alice")).toBeNull();
    expect(usernameError("abcdefghijkl")).toBeNull();
  });
  it("rejects 13 bytes", () => {
    expect(usernameError("abcdefghijklm")).not.toBeNull();
  });
  it("counts bytes, not chars (multibyte handles)", () => {
    expect(usernameError("倫倫倫倫倫")).not.toBeNull(); // 5×3 = 15 bytes > 12
    expect(usernameError("alice倫")).toBeNull(); // 5 + 3 = 8 bytes ≤ 12
  });
  it("accepts byte-exact multibyte", () => {
    expect(usernameError("倫倫倫倫")).toBeNull(); // exactly 12 bytes
  });
  it("rejects empty", () => {
    expect(usernameError("")).toEqual("empty");
  });
});

describe("onboarding chain derivation (session-64: the FOUR-step chain + the pending carriage; session-65: the optional home-QING step)", () => {
  it("all steps open with no account", () => {
    const steps = onboardingSteps(null, null);
    expect(steps.map((s) => s.done)).toEqual([false, false, false, false, false, false]);
    expect(steps.map((s) => s.id)).toEqual(["wallet", "lau", "username", "yue", "register", "qing"]);
    // the home-QING step is OPTIONAL — it never blocks the chain
    expect(steps.map((s) => s.optional ?? false)).toEqual([false, false, false, false, false, true]);
  });
  it("username stays open while the onchain view reverts (unset)", () => {
    const snap = mkSnapshot({ lau: LAU, username: null });
    expect(onboardingSteps(ACCT, snap).map((s) => s.done)).toEqual([true, true, false, false, true, false]);
  });
  it("the Username copy says BYTES (the 12-char claim was wrong — MaximumLength is bytes)", () => {
    const steps = onboardingSteps(null, null);
    const username = steps.find((s) => s.id === "username")!;
    expect(username.label).toContain("12 bytes");
    expect(username.label).not.toContain("12 chars");
  });
  it("full chain done only when REGISTRATION resolved (snapshot.lau) — the optional step rides separately", () => {
    const snap = mkSnapshot({ lau: LAU, username: "alice", yue: YUE });
    // without the home record the optional step stays open…
    expect(onboardingSteps(ACCT, snap).every((s) => s.done)).toBe(false);
    // …but every REQUIRED step is done (optional never blocks)
    expect(onboardingSteps(ACCT, snap).filter((s) => !s.optional).every((s) => s.done)).toBe(true);
    // with the home record captured, everything is done
    expect(onboardingSteps(ACCT, snap, null, true).every((s) => s.done)).toBe(true);
  });
  it("the pending LAU completes the LAU step but NOT register (discovery is the register proof)", () => {
    const PENDING = "0x0000000000000000000000000000000000000033" as typeof LAU;
    // a pending LAU with Username + YUE done reads: wallet v, lau v, username v (carried), yue v, register x
    const snap = mkSnapshot({ username: "alice", yue: YUE }); // no lau — pre-registration
    expect(onboardingSteps(ACCT, snap, PENDING).map((s) => s.done)).toEqual([true, true, true, true, false, false]);
    expect(onboardingSteps(ACCT, snap).map((s) => s.done)).toEqual([true, false, true, true, false, false]); // no pending → the LAU step re-opens
  });
});

describe("per-turn agent payload (§7.6 identity subset)", () => {
  it("stays under the cap with everything set", () => {
    const snap = mkSnapshot({ lau: LAU, username: "alice", yue: YUE });
    const size = JSON.stringify(toAgentPayload(snap)).length;
    expect(size).toBeLessThanOrEqual(AGENT_PAYLOAD_CAP);
  });
  it("carries the identity subset fields", () => {
    const p = toAgentPayload(mkSnapshot({ lau: LAU, username: "alice", yue: YUE }));
    expect(p.acct).toEqual(ACCT);
    expect(p.lau).toEqual(LAU);
    expect(p.yue).toEqual(YUE);
    expect(p.user).toEqual("alice");
    expect(Array.isArray(p.pls)).toBe(true);
  });
});

describe("fmtAmt", () => {
  it("zero", () => {
    expect(fmtAmt(0n)).toEqual("0");
  });
  it("trims trailing zeros", () => {
    expect(fmtAmt(15n * 10n ** 17n)).toEqual("1.5");
  });
  it("keeps 4 digits", () => {
    expect(fmtAmt(12_345n * 10n ** 14n)).toEqual("1.2345");
  });
});

/** fake client driving loadPlayerSnapshot's two multicall rounds */
function fakeClient(rounds: { multicall: unknown[] }[], block = 12345n) {
  let i = 0;
  return {
    multicall: async () => {
      const r = rounds[i];
      i += 1;
      if (!r) throw new Error("no round programmed");
      return r.multicall;
    },
    getBlockNumber: async () => block,
  } as never;
}

describe("loadPlayerSnapshot (two-round aggregate3 batching)", () => {
  it("zero addresses mean no entities; username failure means unset", async () => {
    const client = fakeClient([
      {
        multicall: [
          { status: "success", result: ZERO },
          { status: "success", result: ZERO },
          { status: "success", result: 10n ** 18n },
          { status: "success", result: 5n * 10n ** 18n },
          { status: "success", result: 0n },
        ],
      },
    ]);
    const s = await loadPlayerSnapshot(client, ACCT);
    expect(s.lau).toBeNull();
    expect(s.yue).toBeNull();
    expect(s.username).toBeNull();
    expect(s.balances.pls.wallet).toEqual(10n ** 18n);
    expect(s.balances.affection.wallet).toEqual(5n * 10n ** 18n);
    expect(s.yuanChoa).toEqual(0n);
  });

  it("full identity: yuan weights 1:10:40 computed from CHOA balances", async () => {
    const unit = 10n ** 18n;
    const client = fakeClient([
      {
        multicall: [
          { status: "success", result: LAU },
          { status: "success", result: YUE },
          { status: "success", result: 2n * unit },
          { status: "success", result: 3n * unit },
          { status: "success", result: 1n * unit },
        ],
      },
      {
        multicall: [
          // LAU round: Username reverts (unset), name, symbol, pls@lau, a@lau, choa@lau
          { status: "failure", error: new Error("AttributeNotFound") },
          { status: "success", result: "Alice" },
          { status: "success", result: "ALICE" },
          { status: "success", result: 7n * unit },
          { status: "success", result: 0n },
          { status: "success", result: 2n * unit },
          // YUE round: name, symbol, pls@yue, a@yue, choa@yue
          { status: "success", result: "Alice Vault" },
          { status: "success", result: "vALICE" },
          { status: "success", result: 0n },
          { status: "success", result: 9n * unit },
          { status: "success", result: 3n * unit },
        ],
      },
    ]);
    const s = await loadPlayerSnapshot(client, ACCT);
    expect(s.lau).toEqual(LAU);
    expect(s.username).toBeNull();
    expect(s.lauName).toEqual("Alice");
    expect(s.yueName).toEqual("Alice Vault");
    expect(s.balances.affection.yue).toEqual(9n * unit);
    // wallet 1 + 10×2 (LAU) + 40×3 (YUE) = 141
    expect(s.yuanChoa).toEqual(141n * unit);
    expect(s.blockNumber).toEqual(12345n);
  });
});

function mkSnapshot(patch: { lau?: string | null; username?: string | null; yue?: string | null }): PlayerSnapshot {
  const zero = { wallet: 0n, lau: 0n, yue: 0n };
  return {
    account: ACCT,
    lau: (patch.lau ?? null) as PlayerSnapshot["lau"],
    yue: (patch.yue ?? null) as PlayerSnapshot["yue"],
    lauName: patch.lau ? "Alice" : null,
    lauSymbol: patch.lau ? "ALICE" : null,
    username: patch.username ?? null,
    yueName: patch.yue ? "Alice Vault" : null,
    yueSymbol: patch.yue ? "vALICE" : null,
    balances: { pls: zero, affection: zero, choa: zero },
    yuanChoa: 0n,
    blockNumber: 12345n,
    fetchedAt: 0,
  };
}

describe("readPlayerMoment (soul + RING.Moments — session-50 venue depth)", () => {
  const soulAbi = [{ type: "function", name: "GetUserSoul", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] }] as const;
  const momentsAbi = [{ type: "function", name: "Moments", stateMutability: "view", inputs: [{ name: "soul", type: "uint64" }], outputs: [{ type: "uint256" }] }] as const;

  function momentClient(soulData: `0x${string}`, throws?: Error) {
    return {
      call: async () => {
        if (throws) throw throws;
        return { data: soulData };
      },
      readContract: async (r: { functionName: string; args: unknown[] }) => {
        if (r.functionName === "Moments") {
          if ((r.args[0] as bigint) !== 4242n) throw new Error("wrong soul routed to Moments");
          return 99n;
        }
        throw new Error("unexpected read");
      },
    } as never;
  }

  it("reads the soul (simulated GetUserSoul) then Moments(soul)", async () => {
    const encoded = encodeFunctionResult({ abi: soulAbi, functionName: "GetUserSoul", result: 4242n });
    const m = await readPlayerMoment(momentClient(encoded), ACCT);
    expect(m.soul).toEqual(4242n);
    expect(m.iota).toEqual(99n);
  });

  it("zero Iota passes through as a real state (no moment recorded yet)", async () => {
    const encoded = encodeFunctionResult({ abi: soulAbi, functionName: "GetUserSoul", result: 7n });
    const client = {
      call: async () => ({ data: encoded }),
      readContract: async () => 0n,
    } as never;
    const m = await readPlayerMoment(client, ACCT);
    expect(m.iota).toEqual(0n);
  });

  it("the UserNotEntered revert class is classified (wallet has no delegate)", () => {
    expect(isUserNotEnteredError(new Error("execution reverted: UserNotEntered(address)"))).toBe(true);
    expect(isUserNotEnteredError(new Error("HTTP 502"))).toBe(false);
  });

  it("carries the Moments selector pin (the s34 discipline)", () => {
    expect(keccak256(stringToBytes("Moments(uint64)")).slice(0, 10)).toBe(encodeFunctionData({ abi: momentsAbi, functionName: "Moments", args: [1n] }).slice(0, 10));
  });
});

// ---- your birth record (session-53 identity enrichment, B1.7) ----

describe("readPlayerBirth (Saat + Bao + Aura + Rod/Cone)", () => {
  const BAO = {
    Phi: "0x0000000000000000000000000000000000000033",
    Mu: "0x0000000000000000000000000000000000000044",
    Xi: 7n,
    Pi: 8n,
    Shio: "0x0000000000000000000000000000000000000055",
    Ring: 9n,
    Omicron: 10n,
    Omega: 11n,
  };
  const ROD = "0x0000000000000000000000000000000000000066";
  const CONE = "0x0000000000000000000000000000000000000077";

  function birthClient(opts: { aura?: bigint | "fail"; rod?: "fail" } = {}) {
    return {
      multicall: async ({ contracts }: { contracts: { functionName: string }[] }) => {
        if (contracts[0]!.functionName === "On") {
          return [
            { status: "success", result: BAO },
            { status: "success", result: 1n },
            { status: "success", result: 4242n },
            { status: "success", result: 777n },
          ];
        }
        return [
          opts.rod === "fail" ? { status: "failure", error: new Error("no rod") } : { status: "success", result: ROD },
          opts.rod === "fail" ? { status: "failure", error: new Error("no cone") } : { status: "success", result: CONE },
        ];
      },
      readContract: async () => {
        if (opts.aura === "fail") throw new Error("HTTP 502");
        return opts.aura ?? 777n;
      },
      getBlockNumber: async () => 12345n,
    } as never;
  }

  it("decodes the Saat triple, the Bao, the Aura cross-read and the channel pair", async () => {
    const b = await readPlayerBirth(birthClient({ aura: 777n }), ACCT, LAU);
    expect(b.saat).toEqual({ pole: 1n, soul: 4242n, aura: 777n });
    expect(b.bao.phi).toEqual(BAO.Phi);
    expect(b.bao.mu).toEqual(BAO.Mu);
    expect(b.bao.shio).toEqual(BAO.Shio);
    expect(b.bao.xi).toEqual(7n);
    expect(b.bao.omega).toEqual(11n);
    expect(b.rod).toEqual(ROD);
    expect(b.cone).toEqual(CONE);
    expect(b.auraNow).toEqual(777n);
    expect(b.blockNumber).toEqual(12345n);
  });

  it("a failed Aura sim stays an honest null (birth record still renders)", async () => {
    const b = await readPlayerBirth(birthClient({ aura: "fail" }), ACCT, LAU);
    expect(b.auraNow).toBeNull();
    expect(b.saat.soul).toEqual(4242n);
  });

  it("a failed Rod/Cone read keeps nulls (never zero-addresses)", async () => {
    const b = await readPlayerBirth(birthClient({ rod: "fail" }), ACCT, LAU);
    expect(b.rod).toBeNull();
    expect(b.cone).toBeNull();
  });

  it("a zero Shio in the Bao skips the channel batch entirely", async () => {
    const zeroBao = { ...BAO, Shio: ZERO };
    const client = {
      multicall: async () => [
        { status: "success", result: zeroBao },
        { status: "success", result: 1n },
        { status: "success", result: 2n },
        { status: "success", result: 3n },
      ],
      readContract: async () => 3n,
      getBlockNumber: async () => 1n,
    } as never;
    const b = await readPlayerBirth(client, ACCT, LAU);
    expect(b.bao.shio).toBeNull();
    expect(b.rod).toBeNull();
    expect(b.cone).toBeNull();
  });

  it("an all-failed first round is a dead RPC — thrown", async () => {
    const dead = { status: "failure" as const, error: new Error("fetch failed") };
    const client = {
      multicall: async () => [dead, dead, dead, dead],
      readContract: async () => 1n,
      getBlockNumber: async () => 1n,
    } as never;
    await expect(readPlayerBirth(client, ACCT, LAU)).rejects.toThrow("birth reads failed");
  });

  it("carries the selector pins (On() / Saat(uint256) / Aura())", () => {
    type Fnish = { name: string; type: string; inputs?: unknown[] };
    const onSel = keccak256(stringToBytes("On()")).slice(0, 10);
    const fnOf = (abi: unknown[], name: string) => (abi as Fnish[]).filter((f) => f.type === "function" && f.name === name);
    const lauOn = fnOf(lauAbi, "On").find((f) => (f.inputs ?? []).length === 0)!;
    expect(toFunctionSelector(lauOn as unknown as AbiFunction)).toEqual(onSel);
    const saat = fnOf(lauAbi, "Saat").find((f) => (f.inputs ?? []).length === 1)!;
    expect(toFunctionSelector(saat as unknown as AbiFunction)).toEqual(keccak256(stringToBytes("Saat(uint256)")).slice(0, 10));
    const siuAura = fnOf(siuAbi, "Aura")[0]!;
    expect(toFunctionSelector(siuAura as unknown as AbiFunction)).toEqual(keccak256(stringToBytes("Aura()")).slice(0, 10));
  });
});

// ---- your label for a venue (VOID.Alias — session-53 read leg) ----

describe("readVenueLabel (VOID.Alias — simulated from the LAU: the session is msg.sender-keyed)", () => {
  const VENUE = "0x0000000000000000000000000000000000000099" as const;

  it("returns the label string on success", async () => {
    const client = { readContract: async () => "home away from home" } as never;
    expect(await readVenueLabel(client, LAU, VENUE)).toEqual({ label: "home away from home" });
  });

  it("classifies AliasNotFound as unset (the failure IS the answer)", async () => {
    const client = {
      readContract: async () => {
        throw new Error("The contract function 'Alias' reverted: AliasNotFound(address)");
      },
    } as never;
    expect(await readVenueLabel(client, LAU, VENUE)).toBe("unset");
  });

  it("classifies NoUserEntry (a sender without a session — robustness branch)", async () => {
    const client = {
      readContract: async () => {
        throw new Error("The contract function 'Alias' reverted: NoUserEntry(address)");
      },
    } as never;
    expect(await readVenueLabel(client, LAU, VENUE)).toBe("not-entered");
  });

  it("anything else is unreadable (dead RPC honesty)", async () => {
    const client = {
      readContract: async () => {
        throw new Error("HTTP 502");
      },
    } as never;
    expect(await readVenueLabel(client, LAU, VENUE)).toBe("unreadable");
  });

  it("carries the Alias(address) selector pin", () => {
    const voidAlias = (voidAbi as unknown as { name: string; type: string; inputs: { type: string }[] }[]).find(
      (f) => f.type === "function" && f.name === "Alias" && f.inputs.length === 1 && f.inputs[0]!.type === "address",
    );
    expect(toFunctionSelector(voidAlias as unknown as AbiFunction)).toEqual(keccak256(stringToBytes("Alias(address)")).slice(0, 10));
  });
});
