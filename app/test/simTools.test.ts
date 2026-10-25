import { beforeEach, describe, expect, it, vi } from "vitest";
import { toFunctionSelector } from "viem";
import encryptAbi from "@abi/ENCRYPT.json";
import gwatAbiJson from "@abi/GWAT.json";
import indexJson from "@abi/index.json";
import { KNOWN_MAINNET_RPC } from "@config/addresses";
import { JournalBus } from "@/chain/journal";
import { simLayerConfig } from "@/chain/simMode";
import { NEW_QING_TOPIC } from "@/chain/venueDeed";
import { toolByName, toolSpecs, type AgentToolContext } from "@/agent/tools";
import { SIM_TOOLS } from "@/agent/simTools";
import { decodeDecryptPlain, decodeEncryptIndex, _lauSaatAbi } from "@/chain/encryptDesk";
import { _gwaterForbiddenAbi } from "@/chain/worldLayer";

/**
 * The SIM-scoped agent tools (session-59, §8 arc part 2): the catalog gate
 * (absent outside sim mode — the §8 law), selector pins vs keccak + the
 * generated index, DRYRUN-first discipline, the fork-verified honesty
 * stories (retry-draw spawn, deterministic index), and the receipt-decode
 * send path. Encodes/reads are mocked at the module seams.
 */

vi.mock("@/chain/worldLayer", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  encodeWorldCode: vi.fn(async () => "0x99790fb6" as `0x${string}`),
  encodeGwatSpawn: vi.fn(async () => ({
    to: simLayerConfig.layer.GWAT as `0x${string}`,
    data: "0x6912b95f" as `0x${string}`,
    abi: gwatAbiJson as never,
  })),
  readGwatForbidden: vi.fn(async () => false),
}));
vi.mock("@/chain/encryptDesk", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  encodeEncryptString: vi.fn(async () => ({
    to: simLayerConfig.layer.ENCRYPT as `0x${string}`,
    data: "0x1227290d" as `0x${string}`,
    abi: encryptAbi as never,
  })),
  encodeDecryptString: vi.fn(async () => ({
    to: simLayerConfig.layer.ENCRYPT as `0x${string}`,
    data: "0x8cfbf772" as `0x${string}`,
    abi: encryptAbi as never,
  })),
  readSoulId: vi.fn(async () => 4242n),
}));
vi.mock("@/chain/client", () => ({
  makeClient: () => ({
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "totalSupply") return 800n * 10n ** 18n;
      if (functionName === "Asset") return "0x3333333333333333333333333333333333333333";
      throw new Error("unexpected read");
    },
  }),
}));

const SIM_RPC = "http://127.0.0.1:9999";
const MAIN_RPC = KNOWN_MAINNET_RPC[0] ?? "https://rpc.pulsechain.com";
const ACCT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as `0x${string}`;
const LAU = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const VENUE = "0x4444444444444444444444444444444444444444" as `0x${string}`;

/** an ABI `bytes` return carrying `text` (the Decrypt preview shape) */
function bytesReturnHex(text: string): `0x${string}` {
  const body = Buffer.from(text, "utf8");
  const offset = (32).toString(16).padStart(64, "0");
  const len = body.length.toString(16).padStart(64, "0");
  const padded = body.length % 32 === 0 ? body : Buffer.concat([body, Buffer.alloc(32 - (body.length % 32))]);
  return ("0x" + offset + len + padded.toString("hex")) as `0x${string}`;
}

let decryptPreviewHex: `0x${string}` = bytesReturnHex("first contact: the fleet channel is open");

interface RecordingCtx extends AgentToolContext {
  __dryrunCount(): number;
  __requests: Array<{ to: string | null; data: string; kind: "dryrun" | "send" }>;
}

function fakeCtx(overrides: Partial<AgentToolContext> = {}, receiptLogs: Array<{ address: string; topics: string[]; data: `0x${string}` }> = []): RecordingCtx {
  const requests: RecordingCtx["__requests"] = [];
  let dryruns = 0;
  const ctx: AgentToolContext = {
    rpcUrl: SIM_RPC,
    account: ACCT,
    snapshot: {
      account: ACCT,
      lau: LAU,
      yue: null,
      lauName: "Test Lau",
      lauSymbol: "TLAU",
      username: "captain",
      yueName: null,
      yueSymbol: null,
      balances: {
        pls: { wallet: 0n, lau: 0n, yue: 0n },
        affection: { wallet: 0n, lau: 0n, yue: 0n },
        choa: { wallet: 0n, lau: 0n, yue: 0n },
      },
      yuanChoa: 0n,
      blockNumber: null,
      fetchedAt: Date.now(),
    } as AgentToolContext["snapshot"],
    journal: new JournalBus(),
    walletMode: "B",
    chatToolsEnabled: false,
    simToolsEnabled: true,
    gateDryRun: async (req) => {
      dryruns += 1;
      requests.push({ to: req.to, data: req.data, kind: "dryrun" });
      // Decrypt answers dynamic BYTES; Encrypt the lone uint64 index word —
      // shape the mock by selector (0x8cfbf772 = Decrypt)
      const result =
        req.data.startsWith("0x8cfbf772")
          ? decryptPreviewHex
          : ("0x0000000000000000000000000000000000000000000000000000000000001092" as `0x${string}`);
      return {
        request: req,
        cls: { risk: "unknown-contract", tier: "unknown", gate: null, metered: true, reverts: [], contract: "SIMFIXTURE", functionSig: null },
        policy: { allowed: true, reasons: [], risk: "unknown-contract", tier: "unknown", requiresExtraAck: true },
        sim: { ok: true, result, gas: 400_000n, error: null },
      };
    },
    gateSend: async (req) => {
      requests.push({ to: req.to, data: req.data, kind: "send" });
      return {
        status: "sent" as const,
        envelope: {} as never,
        txHash: "0xfeed" as `0x${string}`,
        receipt: { status: "success" as const, gasUsed: 2_000_000n, logs: receiptLogs, blockNumber: 27_674_100n, contractAddress: null },
        receiptError: null,
        movements: [],
        capBreaches: [],
      };
    },
    refreshSnapshot: () => {},
    takeNote: () => {},
    ...overrides,
  };
  // NB: Object.assign flattens getters (the moveTools lesson) — a reader
  // function keeps the closure live
  return Object.assign(ctx, { __requests: requests, __dryrunCount: () => dryruns }) as RecordingCtx;
}

/** a NewQing log body: (spawned, parent, waat) — nothing indexed */
function newQingLog(spawned: `0x${string}`, parent: `0x${string}`, waat: bigint) {
  const w = (v: string | bigint) => BigInt(v).toString(16).padStart(64, "0");
  return {
    address: simLayerConfig.layer.GWAT,
    topics: [NEW_QING_TOPIC],
    data: ("0x" + w(spawned) + w(parent) + w(waat.toString())) as `0x${string}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("catalog gating (§8 — the SIM tools are never advertised on a live RPC)", () => {
  it("world_code/spawn_gwat/encrypt_note/decrypt_note are ABSENT by default and present in sim mode", () => {
    const off = toolSpecs(false).map((t) => t.function.name);
    const on = toolSpecs(false, true).map((t) => t.function.name);
    for (const name of ["world_code", "spawn_gwat", "encrypt_note", "decrypt_note"]) {
      expect(off).not.toContain(name);
      expect(on).toContain(name);
    }
    expect([...SIM_TOOLS.map((t) => t.name)].sort()).toEqual(["decrypt_note", "encrypt_note", "spawn_gwat", "world_code"]);
  });

  it("toolByName still resolves them (the planRunner path) — execute re-guards", () => {
    expect(toolByName("spawn_gwat")).not.toBeNull();
    expect(toolByName("world_code")).not.toBeNull();
    expect(toolByName("encrypt_note")).not.toBeNull();
    expect(toolByName("decrypt_note")).not.toBeNull();
  });
});

describe("world_code", () => {
  it("refuses outside sim mode with the honest error (never a fallback)", async () => {
    const ctx = fakeCtx({ rpcUrl: MAIN_RPC, simToolsEnabled: false });
    const out = await toolByName("world_code")!.execute({ lat: "1", lon: "2", address: VENUE }, ctx);
    expect(out["error"]).toContain("SIM-only");
  });

  it("DRYRUNs by default against the overlay WORLD fixture", async () => {
    const ctx = fakeCtx();
    const out = await toolByName("world_code")!.execute({ lat: "5", lon: "-7", address: VENUE, send: false }, ctx);
    expect(out["mode"]).toBe("DRYRUN");
    expect(out["venue"]).toBe(VENUE);
    expect(ctx.__requests[0]!.to!.toLowerCase()).toBe(simLayerConfig.layer.WORLD);
    expect(JSON.stringify(out)).toContain("SWAPPED");
  });

  it("sends through the gate on send=true", async () => {
    const ctx = fakeCtx();
    const out = await toolByName("world_code")!.execute({ lat: "5", lon: "-7", address: VENUE, send: true }, ctx);
    expect(out["mode"]).toBe("SEND");
    expect(out["status"]).toBe("sent");
  });

  it("fences non-integer coords", async () => {
    const ctx = fakeCtx();
    const out = await toolByName("world_code")!.execute({ lat: "abc", lon: "2", address: VENUE }, ctx);
    expect(out["error"]).toContain("integers");
  });
});

describe("spawn_gwat", () => {
  it("DRYRUNs with the eligibility preview (supply vs the 777-token rate cap)", async () => {
    const ctx = fakeCtx();
    const out = await toolByName("spawn_gwat")!.execute({ address: VENUE }, ctx);
    expect(out["mode"]).toBe("DRYRUN");
    expect((out["eligibility"] as Record<string, unknown>)["rateCapReady"]).toBe(true);
    expect(JSON.stringify(out)).toContain("fresh draw");
  });

  it("a send decodes the spawned venue from the receipt's NewQing (word1 = the parent guard)", async () => {
    const spawned = "0x5555555555555555555555555555555555555555" as `0x${string}`;
    const ctx = fakeCtx({}, [newQingLog(spawned, VENUE, 12345n)]);
    const out = await toolByName("spawn_gwat")!.execute({ address: VENUE, send: true }, ctx);
    expect(out["spawned"]).toBe(spawned);
    expect(out["drawnWaat"]).toBe("12345");
  });

  it("a NewQing from a DIFFERENT parent is not claimed as this venue's spawn", async () => {
    const ctx = fakeCtx({}, [newQingLog("0x5555555555555555555555555555555555555555", "0x6666666666666666666666666666666666666666", 1n)]);
    const out = await toolByName("spawn_gwat")!.execute({ address: VENUE, send: true }, ctx);
    expect(out["spawned"]).toBeUndefined();
  });

  it("refuses outside sim mode", async () => {
    const ctx = fakeCtx({ rpcUrl: MAIN_RPC, simToolsEnabled: false });
    const out = await toolByName("spawn_gwat")!.execute({ address: VENUE }, ctx);
    expect(out["error"]).toContain("SIM-only");
  });
});

describe("encrypt_note", () => {
  it("needs a LAU (the soul is its Saat[1])", async () => {
    const ctx = fakeCtx({ snapshot: null });
    const out = await toolByName("encrypt_note")!.execute({ to: "7", key: "k", message: "m" }, ctx);
    expect(out["error"]).toContain("LAU");
  });

  it("DRYRUNs with the deterministic index decoded (4242) and the offchain-handoff story", async () => {
    const ctx = fakeCtx();
    const out = await toolByName("encrypt_note")!.execute({ to: "7", key: "bone-key", message: "meet at the anchor" }, ctx);
    expect(out["mode"]).toBe("DRYRUN");
    expect(out["index"]).toBe("4242");
    expect(out["from"]).toBe("4242"); // readSoulId mocked to the same value
    expect(out["toSoul"]).toBe("7"); // the SOUL key — never the envelope's `to` address
    expect(JSON.stringify(out)).toContain("offchain");
  });

  it("the 280-char schema fence", async () => {
    const ctx = fakeCtx();
    const out = await toolByName("encrypt_note")!.execute({ to: "7", key: "k", message: "x".repeat(281) }, ctx);
    expect(out["error"]).toContain("280");
  });

  it("a send lands once AND re-derives the index via a pure preview (never a second send)", async () => {
    const ctx = fakeCtx();
    const out = await toolByName("encrypt_note")!.execute({ to: "7", key: "k", message: "m", send: true }, ctx);
    expect(out["mode"]).toBe("SEND");
    expect(out["index"]).toBe("4242");
    expect(out["handoff"]).toContain("index 4242");
    const sends = ctx.__requests.filter((r) => r.kind === "send" && r.to!.toLowerCase() === simLayerConfig.layer.ENCRYPT);
    // exactly ONE gate send; the index re-derivation rode a DRYRUN
    expect(sends).toHaveLength(1);
    expect(ctx.__dryrunCount()).toBe(1);
  });

  it("refuses outside sim mode", async () => {
    const ctx = fakeCtx({ rpcUrl: MAIN_RPC, simToolsEnabled: false });
    const out = await toolByName("encrypt_note")!.execute({ to: "7", key: "k", message: "m" }, ctx);
    expect(out["error"]).toContain("SIM-only");
  });
});

describe("decrypt_note (session 61 — the cipher READ leg)", () => {
  it("needs a LAU (you must be the note's TO party)", async () => {
    const ctx = fakeCtx({ snapshot: null });
    const out = await toolByName("decrypt_note")!.execute({ from: "7", index: "10", key: "k" }, ctx);
    expect(out["error"]).toContain("LAU");
  });

  it("DRYRUN previews the EXACT plaintext (the deterministic orbit) without consuming", async () => {
    const ctx = fakeCtx();
    const out = await toolByName("decrypt_note")!.execute({ from: "7", index: "10", key: "bone-key" }, ctx);
    expect(out["mode"]).toBe("DRYRUN");
    expect(out["plaintext"]).toBe("first contact: the fleet channel is open");
    expect(out["toSoul"]).toBe("4242"); // my soul read live (readSoulId mocked)
    expect(out["from"]).toBe("7");
    expect(String(out["previewHonesty"])).toContain("EXACT");
    // the §61 owner round: NO deck widget for either cipher tool
    expect(ctx.__requests).toHaveLength(1);
    expect(ctx.__requests[0]!.kind).toBe("dryrun");
  });

  it("SENDs the read; a LIVE entry SURVIVES it (deletion keys on expiry — the 61 fork finding), proven by the pure re-preview", async () => {
    // the post-send re-preview answers the SAME plaintext (never a second send)
    const ctx = fakeCtx();
    const out = await toolByName("decrypt_note")!.execute({ from: "7", index: "10", key: "k", send: true }, ctx);
    expect(out["mode"]).toBe("SEND");
    expect(out["status"]).toBe("sent");
    expect(out["entrySurvives"]).toBe(true);
    const sends = ctx.__requests.filter((r) => r.kind === "send" && r.to!.toLowerCase() === simLayerConfig.layer.ENCRYPT);
    expect(sends).toHaveLength(1); // exactly ONE gate send
    expect(ctx.__dryrunCount()).toBe(1); // the re-read proof rode a DRYRUN
  });

  it("refuses outside sim mode", async () => {
    const ctx = fakeCtx({ rpcUrl: MAIN_RPC, simToolsEnabled: false });
    const out = await toolByName("decrypt_note")!.execute({ from: "7", index: "10", key: "k" }, ctx);
    expect(out["error"]).toContain("SIM-only");
  });

  it("fences non-numeric from/index", async () => {
    const ctx = fakeCtx();
    const out = await toolByName("decrypt_note")!.execute({ from: "soul-seven", index: "10", key: "k" }, ctx);
    expect(out["error"]).toContain("uint64");
  });
});

describe("selector pins (the s29 law — keccak-checked against abi/index.json)", () => {
  it("the hand-pinned fragments match keccak", () => {
    expect(toFunctionSelector(_lauSaatAbi[0]!)).toEqual("0x088aee78");
    expect(toFunctionSelector(_gwaterForbiddenAbi[0]!)).toEqual("0xa59d7f4d");
  });

  it("the canonical SIM-layer selectors match the generated index", () => {
    const idx = indexJson as Record<string, { selectors: Record<string, { name: string; types: string }> }>;
    expect(idx["LAU"]!.selectors["0x088aee78"]).toMatchObject({ name: "Saat" });
    expect(idx["MAP"]!.selectors["0xa59d7f4d"]).toMatchObject({ name: "Forbidden" });
    expect(idx["GWAT"]!.selectors["0x6912b95f"]).toMatchObject({ name: "Gwat", types: "address,uint256" });
    expect(idx["ENCRYPT"]!.selectors["0x1227290d"]).toMatchObject({ name: "Encrypt", types: "uint64,uint64,string,string" });
    expect(idx["ENCRYPT"]!.selectors["0x8cfbf772"]).toMatchObject({ name: "Decrypt", types: "uint64,uint64,uint64,string" });
    expect(idx["ENCRYPT"]!.selectors["0xd8be150f"]).toMatchObject({ name: "Prune" });
  });
});

describe("the cipher decode helpers", () => {
  it("decodeEncryptIndex reads the lone uint64 word", () => {
    expect(decodeEncryptIndex("0x0000000000000000000000000000000000000000000000000000000000001092")).toBe(4242n);
    expect(decodeEncryptIndex("0x")).toBeNull();
  });

  it("decodeDecryptPlain reads dynamic bytes (utf-8) and reports non-utf8 honestly", () => {
    const msg = "meet at the anchor tile";
    const body = Buffer.from(msg, "utf8");
    const offset = (32).toString(16).padStart(64, "0"); // 0x20 — relative to the return area
    const len = body.length.toString(16).padStart(64, "0");
    const padded = body.length % 32 === 0 ? body : Buffer.concat([body, Buffer.alloc(32 - (body.length % 32))]);
    const hex = "0x" + offset + len + padded.toString("hex");
    const out = decodeDecryptPlain(hex as `0x${string}`);
    expect(out.text).toBe(msg);
    expect(out.byteLength).toBe(body.length);
    const bin = decodeDecryptPlain(("0x" + (32).toString(16).padStart(64, "0") + (1).toString(16).padStart(64, "0") + "ff") as `0x${string}`);
    expect(bin.text).toBeNull();
    expect(bin.byteLength).toBe(1);
  });
});
