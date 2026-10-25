import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, PublicClient } from "viem";
import { encodeAbiParameters } from "viem";
import { addr } from "@config/addresses";
import type { SimBundleKey } from "@/chain/simBootstrap";

/**
 * Session-81 — the SIM in-frontend bootstrap (Option A). Pins:
 *  - the shipped bundle file set + hashes (never hand-edited);
 *  - the preflight refusal matrix (non-loopback, wrong chain, non-anvil,
 *    missing perimeter) and the no-anvil-on-remote law;
 *  - the four-creation order + constructor args (ENCRYPT → WORLD → WAR → GWAT);
 *  - overlay precedence (runtime first, static fixture second) + reset;
 *  - the fork-only player default 2,000,000 PLS with a user-editable amount.
 */

const backing = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  },
  addEventListener: () => undefined,
});

const bootstrap = await import("@/chain/simBootstrap");
const simMode = await import("@/chain/simMode");
const overlay = await import("@/state/simOverlay");

const FORK = "http://127.0.0.1:8545";
const REMOTE = "https://my-own-pulsechain-node.example";
const DATA_DIR = fileURLToPath(new URL("../src/data/sim_layer", import.meta.url));
const SOURCES_MANIFEST = fileURLToPath(new URL("../../harness/fixtures/world-layer/sources.manifest", import.meta.url));
const MANIFEST = JSON.parse(readFileSync(`${DATA_DIR}/manifest.json`, "utf8")) as {
  pin: number;
  compiler: string;
  sourceRevision: string;
  sourceManifestSha256: string;
  files: Record<string, { file: string; contract: string; bytes: number; sha256: string }>;
};

beforeEach(() => {
  backing.clear();
  overlay.clearSimOverlay(FORK);
});

describe("the shipped SIM bundle", () => {
  it("carries exactly the four creation files + the manifest", () => {
    expect(readdirSync(DATA_DIR).sort()).toEqual([
      "encrypt.creation.hex",
      "gwat.creation.hex",
      "manifest.json",
      "warfixed.creation.hex",
      "worldfixed.creation.hex",
    ]);
    expect(Object.keys(MANIFEST.files).sort()).toEqual(["encrypt", "gwat", "warfixed", "worldfixed"]);
  });

  it("every file hash/byte count matches the manifest and the manifest is pinned", () => {
    expect(MANIFEST.pin).toBe(27_674_000);
    expect(MANIFEST.compiler).toContain("0.8.21");
    expect(MANIFEST.sourceRevision).toBe("harness/fixtures/world-layer/sources.manifest");
    expect(createHash("sha256").update(readFileSync(SOURCES_MANIFEST)).digest("hex")).toBe(MANIFEST.sourceManifestSha256);
    for (const [key, meta] of Object.entries(MANIFEST.files)) {
      const bytes = readFileSync(`${DATA_DIR}/${meta.file}`);
      const text = bytes.toString("utf8").trim().replace(/^0x/, "");
      expect(text).toMatch(/^[0-9a-f]+$/);
      expect(text.length / 2).toBe(meta.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(meta.sha256);
      expect(bootstrap.simCreationHex(key as SimBundleKey)).toBe("0x" + text);
    }
  });

  it("orders the four creations ENCRYPT → WORLD → WAR → GWAT (the set-3 order)", () => {
    expect(bootstrap.SIM_DEPLOY_STEPS.map((s) => s.name)).toEqual(["ENCRYPT", "WORLD", "WAR", "GWAT"]);
  });
});

describe("constructor args + deploy encoding", () => {
  it("ENCRYPT takes VOID; WORLD takes CHEON/META/MAP", () => {
    const encrypt = bootstrap.SIM_DEPLOY_STEPS[0]!;
    const world = bootstrap.SIM_DEPLOY_STEPS[1]!;
    expect(bootstrap.deployArgs(encrypt, {})).toEqual([addr("VOID")]);
    expect(bootstrap.deployArgs(world, {})).toEqual([addr("CHEON"), addr("META"), addr("MAP")]);
  });

  it("WAR/GWAT resolve the previously deployed addresses and refuse out of order", () => {
    const war = bootstrap.SIM_DEPLOY_STEPS[2]!;
    const gwat = bootstrap.SIM_DEPLOY_STEPS[3]!;
    const w = "0x1111111111111111111111111111111111111111" as Address;
    const r = "0x2222222222222222222222222222222222222222" as Address;
    expect(() => bootstrap.deployArgs(war, {})).toThrow(/WORLD must be deployed/);
    expect(bootstrap.deployArgs(war, { WORLD: w })).toEqual([w]);
    expect(() => bootstrap.deployArgs(gwat, { WORLD: w })).toThrow(/WAR must be deployed/);
    expect(bootstrap.deployArgs(gwat, { WAR: r })).toEqual([r]);
  });

  it("encodeSimDeploy appends the ABI-encoded constructor arguments to the pinned bytecode", () => {
    const world = bootstrap.SIM_DEPLOY_STEPS[1]!;
    const abi = [
      {
        type: "constructor",
        stateMutability: "nonpayable",
        inputs: [
          { name: "CheonAddress", type: "address" },
          { name: "MetaAddress", type: "address" },
          { name: "MapAddress", type: "address" },
        ],
      },
    ] as const;
    const data = bootstrap.encodeSimDeploy(world, {}, abi as never);
    const bytecode = bootstrap.simCreationHex("worldfixed");
    expect(data.startsWith(bytecode)).toBe(true);
    const tail = data.slice(bytecode.length);
    const expected = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }],
      [addr("CHEON"), addr("META"), addr("MAP")]
    );
    expect(tail).toBe(expected.slice(2));
  });
});

describe("preflight refusal matrix", () => {
  function fakeClient(opts: { chainId?: number | Error; code?: (address: string) => string } = {}): Pick<PublicClient, "getChainId" | "getCode"> {
    return {
      getChainId: async () => {
        if (opts.chainId instanceof Error) throw opts.chainId;
        return opts.chainId ?? 369;
      },
      getCode: async ({ address }: { address: Address }) => (opts.code ? opts.code(address) : "0x60006000") as `0x${string}`,
    } as unknown as Pick<PublicClient, "getChainId" | "getCode">;
  }
  const anvilProbe = (forkBlock: number | null = 27_674_000) => ({
    clientVersion: async () => "anvil/v0.2.0",
    nodeInfo: async () => ({ forkConfig: { forkBlockNumber: forkBlock } }),
  });
  const gethProbe = {
    clientVersion: async () => "Geth/v1.13.0",
    nodeInfo: async () => {
      throw new Error("method not found");
    },
  };

  it("refuses a non-loopback RPC before any probe (no anvil_* on a remote RPC)", async () => {
    let chainCalls = 0;
    const watched = {
      getChainId: async () => {
        chainCalls++;
        return 369;
      },
      getCode: async () => "0x6000" as `0x${string}`,
    };
    const probe = {
      clientVersion: async () => {
        throw new Error("must not be called");
      },
      nodeInfo: async () => {
        throw new Error("must not be called");
      },
    };
    const p = await bootstrap.preflightSimBootstrap({ rpcUrl: REMOTE, client: watched as never, probe });
    expect(p.ok).toBe(false);
    expect(chainCalls).toBe(0);
    expect(p.checks.find((c) => c.id === "rpc")?.ok).toBe(false);
    expect(p.reasons.join(" ")).toMatch(/not a local loopback/);
  });

  it("refuses an unreachable loopback RPC with a plain-language reason", async () => {
    const p = await bootstrap.preflightSimBootstrap({
      rpcUrl: "http://127.0.0.1:9999",
      client: fakeClient({ chainId: new Error("connect ECONNREFUSED") }),
      probe: anvilProbe(),
    });
    expect(p.ok).toBe(false);
    expect(p.checks.find((c) => c.id === "chain")?.ok).toBe(false);
    expect(p.reasons.join(" ")).toMatch(/did not answer eth_chainId/);
  });

  it("refuses the wrong chain id", async () => {
    const p = await bootstrap.preflightSimBootstrap({ rpcUrl: FORK, client: fakeClient({ chainId: 1 }), probe: anvilProbe() });
    expect(p.ok).toBe(false);
    expect(p.checks.find((c) => c.id === "chain")?.ok).toBe(false);
    expect(p.reasons.join(" ")).toMatch(/not 369/);
  });

  it("refuses a non-anvil loopback node", async () => {
    const p = await bootstrap.preflightSimBootstrap({ rpcUrl: FORK, client: fakeClient(), probe: gethProbe });
    expect(p.ok).toBe(false);
    expect(p.checks.find((c) => c.id === "anvil")?.ok).toBe(false);
    expect(p.reasons.join(" ")).toMatch(/not anvil/);
  });

  it("refuses when the forked perimeter is missing (half a chain)", async () => {
    const p = await bootstrap.preflightSimBootstrap({
      rpcUrl: FORK,
      client: fakeClient({ code: (a) => (a.toLowerCase() === addr("CHAN").toLowerCase() ? "0x" : "0x6000") }),
      probe: anvilProbe(),
    });
    expect(p.ok).toBe(false);
    expect(p.checks.find((c) => c.id === "perimeter")?.ok).toBe(false);
    expect(p.reasons.join(" ")).toMatch(/perimeter is missing/);
  });

  it("passes on a healthy pinned loopback anvil fork and reads the fork block", async () => {
    const p = await bootstrap.preflightSimBootstrap({ rpcUrl: FORK, client: fakeClient(), probe: anvilProbe() });
    expect(p.ok).toBe(true);
    expect(p.chainId).toBe(369);
    expect(p.forkBlock).toBe(27_674_000);
    expect(p.checks.every((c) => c.ok)).toBe(true);
  });

  it("parses anvil_nodeInfo fork blocks (number / hex / decimal string)", () => {
    expect(bootstrap.forkBlockOf({ forkConfig: { forkBlockNumber: 123 } })).toBe(123);
    expect(bootstrap.forkBlockOf({ forkConfig: { forkBlockNumber: "0x10" } })).toBe(16);
    expect(bootstrap.forkBlockOf({ forkBlockNumber: "42" })).toBe(42);
    expect(bootstrap.forkBlockOf(null)).toBeNull();
  });
});

describe("the anvil-only law", () => {
  it("makeSimRpc refuses anvil_* on a non-loopback URL without fetching", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return { json: async () => ({ result: null }) } as Response;
    });
    expect(() => bootstrap.assertLocalForkRpc(REMOTE)).toThrow(/LOCAL FORK ONLY/);
    await expect(bootstrap.makeSimRpc(REMOTE).request("anvil_impersonateAccount", [bootstrap.LIVE_DEPLOYER])).rejects.toThrow(/LOCAL FORK ONLY/);
    expect(calls).toBe(0);
    expect(() => bootstrap.makeImpersonatedSigner(REMOTE, "C")).toThrow(/LOCAL FORK ONLY/);
    vi.unstubAllGlobals();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => backing.get(k) ?? null,
        setItem: (k: string, v: string) => void backing.set(k, v),
        removeItem: (k: string) => void backing.delete(k),
      },
      addEventListener: () => undefined,
    });
  });
});

describe("the runtime overlay precedence + reset", () => {
  it("runtime overlay wins over the static fixture; reset falls back", () => {
    expect(simMode.simAddr("WORLD", FORK).toLowerCase()).toBe(simMode.simLayerConfig.layer.WORLD.toLowerCase());
    const layer = {
      WORLD: "0x1000000000000000000000000000000000000001",
      VITUS: "0x1000000000000000000000000000000000000002",
      WAR: "0x1000000000000000000000000000000000000003",
      H2O: "0x1000000000000000000000000000000000000004",
      GWAT: "0x1000000000000000000000000000000000000005",
      ENCRYPT: "0x1000000000000000000000000000000000000006",
    } as const;
    overlay.writeSimOverlay(FORK, {
      chainId: 369,
      deployedBy: bootstrap.LIVE_DEPLOYER,
      layer,
      pin: 27_674_000,
      forkBlock: 27_674_000,
      deployedAt: 1,
      notes: {},
    });
    expect(simMode.simAddr("WORLD", FORK)).toBe(layer.WORLD);
    expect(overlay.readSimOverlay(FORK + "/")?.chainId).toBe(369);
    overlay.clearSimOverlay(FORK);
    expect(simMode.simAddr("WORLD", FORK).toLowerCase()).toBe(simMode.simLayerConfig.layer.WORLD.toLowerCase());
  });

  it("marks the runtime overlay stale when the fork has no code there (or the chain changed)", async () => {
    const layer = {
      WORLD: "0x1000000000000000000000000000000000000001",
      VITUS: "0x1000000000000000000000000000000000000002",
      WAR: "0x1000000000000000000000000000000000000003",
      H2O: "0x1000000000000000000000000000000000000004",
      GWAT: "0x1000000000000000000000000000000000000005",
      ENCRYPT: "0x1000000000000000000000000000000000000006",
    } as const;
    overlay.writeSimOverlay(FORK, {
      chainId: 369,
      deployedBy: bootstrap.LIVE_DEPLOYER,
      layer,
      pin: 27_674_000,
      forkBlock: 27_674_000,
      deployedAt: 1,
      notes: {},
    });
    const live = await overlay.checkOverlayCode({ getCode: async () => "0x6000" } as never, FORK, 369);
    expect(live.stale).toBe(false);
    const gone = await overlay.checkOverlayCode({ getCode: async () => "0x" } as never, FORK, 369);
    expect(gone.stale).toBe(true);
    expect(gone.missing).toHaveLength(6);
    const wrongChain = await overlay.checkOverlayCode({ getCode: async () => "0x6000" } as never, FORK, 1);
    expect(wrongChain.chainMismatch).toBe(true);
    expect(wrongChain.stale).toBe(true);
  });
});

describe("the fork-only player", () => {
  it("defaults to 2,000,000 PLS and accepts a user-edited amount", () => {
    expect(bootstrap.DEFAULT_FORK_PLAYER_PLS).toBe("2000000");
    expect(bootstrap.validatePlayerAmount("2000000")).toEqual({ ok: true, wei: 2_000_000n * 10n ** 18n, error: null });
    expect(bootstrap.validatePlayerAmount(" 123456 ").wei).toBe(123_456n * 10n ** 18n);
  });

  it("rejects zero, negatives, decimals, empty, and junk", () => {
    for (const bad of ["0", "", "1.5", "-1", "abc", "1e6"]) {
      const r = bootstrap.validatePlayerAmount(bad);
      expect(r.ok).toBe(false);
      expect(r.wei).toBeNull();
    }
  });

  it("never funds a remote RPC", async () => {
    await expect(
      bootstrap.fundForkPlayer(REMOTE, "0x1111111111111111111111111111111111111111", "2000000")
    ).rejects.toThrow(/LOCAL FORK ONLY/);
  });
});

describe("runSimBootstrap — the four gate sends", () => {
  it("sends ENCRYPT → WORLD → WAR → GWAT through the gate and writes the actual addresses", async () => {
    const sent: Array<{ to: string | null; data: string; account: string }> = [];
    const fakeAddresses: Address[] = [
      "0x2000000000000000000000000000000000000001",
      "0x2000000000000000000000000000000000000002",
      "0x2000000000000000000000000000000000000003",
      "0x2000000000000000000000000000000000000004",
    ];
    let i = 0;
    const verifyCalls: unknown[] = [];
    const res = await bootstrap.runSimBootstrap({
      rpcUrl: FORK,
      chainId: 369,
      preflight: { ok: true, checks: [], reasons: [], host: "127.0.0.1:8545", chainId: 369, forkBlock: 27_674_000, overlay: null, staleOverlay: false },
      client: {} as PublicClient,
      signer: { mode: "C", account: bootstrap.LIVE_DEPLOYER, sendTransaction: async () => "0x" },
      prepare: async () => undefined,
      stop: async () => undefined,
      send: async (request) => {
        sent.push({ to: request.to, data: request.data, account: request.account });
        const address = fakeAddresses[i++]!;
        return {
          status: "sent",
          envelope: { request, cls: {} as never, policy: {} as never, sim: null },
          txHash: (`0x${i.toString().padStart(64, "0")}`) as `0x${string}`,
          receipt: { status: "success", gasUsed: 1n, logs: [], blockNumber: 1n, contractAddress: address },
          receiptError: null,
          movements: [],
          capBreaches: [],
        };
      },
      verify: async (_client, addresses) => {
        verifyCalls.push(addresses);
        return {
          ok: true,
          checks: [],
          layer: {
            WORLD: addresses.WORLD!,
            WAR: addresses.WAR!,
            ENCRYPT: addresses.ENCRYPT!,
            GWAT: addresses.GWAT!,
            VITUS: "0x2000000000000000000000000000000000000005",
            H2O: "0x2000000000000000000000000000000000000006",
          },
          error: null,
        };
      },
    });
    expect(res.ok).toBe(true);
    expect(sent.map((s) => s.to)).toEqual([null, null, null, null]);
    expect(sent.every((s) => s.account === bootstrap.LIVE_DEPLOYER)).toBe(true);
    expect(sent[0]!.data.startsWith(bootstrap.simCreationHex("encrypt"))).toBe(true);
    expect(sent[1]!.data.startsWith(bootstrap.simCreationHex("worldfixed"))).toBe(true);
    expect(sent[2]!.data.startsWith(bootstrap.simCreationHex("warfixed"))).toBe(true);
    expect(sent[3]!.data.startsWith(bootstrap.simCreationHex("gwat"))).toBe(true);
    expect(verifyCalls).toHaveLength(1);
    expect(res.overlay?.layer.WORLD).toBe(fakeAddresses[1]);
    expect(res.overlay?.deployedBy).toBe(bootstrap.LIVE_DEPLOYER);
    expect(res.overlay?.forkBlock).toBe(27_674_000);
    expect(overlay.readSimOverlay(FORK)?.layer.WAR).toBe(fakeAddresses[2]);
  });

  it("stops at the first failed creation and never writes an overlay", async () => {
    const res = await bootstrap.runSimBootstrap({
      rpcUrl: FORK,
      chainId: 369,
      preflight: { ok: true, checks: [], reasons: [], host: "127.0.0.1:8545", chainId: 369, forkBlock: null, overlay: null, staleOverlay: false },
      client: {} as PublicClient,
      signer: { mode: "B", account: bootstrap.LIVE_DEPLOYER, sendTransaction: async () => "0x" },
      prepare: async () => undefined,
      stop: async () => undefined,
      send: async () => ({ status: "aborted", envelope: {} as never, reason: "rejected in approval card" }),
    });
    expect(res.ok).toBe(false);
    expect(res.steps[0]?.state).toBe("failed");
    expect(res.steps[1]?.state).toBe("pending");
    expect(overlay.readSimOverlay(FORK)).toBeNull();
  });
});
