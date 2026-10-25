import { encodeDeployData, parseEther, type Abi, type Address, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { addr } from "@config/addresses";
import { loadAbi } from "@/chain/abiLoad";
import { isLocalForkRpc } from "@/chain/rpc";
import { simLayerActive, simEntryEnabled, type SimLayerName } from "@/chain/simMode";
import { checkOverlayCode, readSimOverlay, writeSimOverlay, type SimOverlayRecord } from "@/state/simOverlay";
import type { GateOutcome, GateRequest, GateSigner, WalletMode } from "@/chain/txGate";

/**
 * SIM LAYER IN-FRONTEND BOOTSTRAP (session-81, Option A).
 *
 * The app deploys the four never-deployed creations on the user's LOCAL anvil
 * fork as the IMPERSONATED LIVE deployer EOA — never the player's wallet:
 *
 *   ENCRYPT(VOID) · WORLDFIXED(CHEON, META, MAP) · WARFIXED(WORLD) · GWAT(WAR)
 *
 * The live deployer is required by the constructors' owner gates on the
 * forked perimeter (`VOID.AddLibrary` is onlyOwners; VITUS/H2O/WAR call
 * `CHAN.addOwner`). On a fork `tx.origin` is the live deployer, so anvil
 * impersonation passes those gates. A fresh user wallet cannot.
 *
 * LAWS (session-81):
 *  - local anvil only: every `anvil_*` method is refused unless the URL is a
 *    loopback host (never on a remote/real RPC);
 *  - every creation rides THE gate (`to: null`, risk "deploy", DRYRUN-first,
 *    policy, approval, journal) through a SIM-only GateSigner;
 *  - explicit gas on impersonated sends (the set-60 OOG lesson);
 *  - the runtime overlay is the truth (actual receipt addresses);
 *  - the deployer is never imported as the player; stop impersonation after.
 */

export const LIVE_DEPLOYER = "0x0474606332105A1dA6FC8EF7De2470551D389Cb9" as const;
export const SUGGESTED_PIN = 27_674_000;
export const DEPLOY_GAS = 30_000_000n;
/** the LIVE math anchors for the VITUS/H2O 1:1 supply checks (kb/dev) */
export const VITUS_ANCHOR = "0xA1BEe1daE9Af77dAC73aA0459eD63b4D93fC6d29" as const;
export const H2O_ANCHOR = "0xD4FD96BA83d3E6FF1A0Baa44c32Def94e641D97c" as const;
export const PERIMETER_GATES = ["VOID", "CHAN", "CHEON", "META", "MAP"] as const;

export type SimDeployName = "ENCRYPT" | "WORLD" | "WAR" | "GWAT";
export type SimBundleKey = "encrypt" | "worldfixed" | "warfixed" | "gwat";

export interface SimDeployStepDef {
  name: SimDeployName;
  /** the deployed contract's own name in the layer overlay (WORLD/WAR stay the interface names) */
  contract: string;
  bundleKey: SimBundleKey;
  abiFile: string;
  label: string;
}

export const SIM_DEPLOY_STEPS: SimDeployStepDef[] = [
  { name: "ENCRYPT", contract: "ENCRYPT", bundleKey: "encrypt", abiFile: "ENCRYPT.json", label: "ENCRYPT(VOID) — self-registers the encrypt library" },
  { name: "WORLD", contract: "WORLDFIXED", bundleKey: "worldfixed", abiFile: "WORLD.json", label: "WORLD(CHEON, META, MAP) — fixture-fixed; deploys VITUS" },
  { name: "WAR", contract: "WARFIXED", bundleKey: "warfixed", abiFile: "WAR.json", label: "WAR(WORLD) — fixture-fixed; deploys H2O" },
  { name: "GWAT", contract: "GWAT", bundleKey: "gwat", abiFile: "GWAT.json", label: "GWAT(WAR) — the spawn gate instrument" },
];

const BYTECODE_RAW = import.meta.glob("../data/sim_layer/*.creation.hex", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function simCreationHex(key: SimBundleKey): `0x${string}` {
  const raw = BYTECODE_RAW[`../data/sim_layer/${key}.creation.hex`];
  if (!raw || raw.trim().length === 0) throw new Error(`SIM bundle missing: ${key}.creation.hex`);
  const t = raw.trim();
  return (t.startsWith("0x") ? t : "0x" + t) as `0x${string}`;
}

export function anvilCommand(pin: number = SUGGESTED_PIN): string {
  return `~/.foundry/bin/anvil --fork-url https://rpc.pulsechain.com --hardfork shanghai --fork-block-number ${pin} --port 8545`;
}

// ---------------------------------------------------------------------------
// the RPC seam — anvil_* is refused before any call on a non-loopback URL
// ---------------------------------------------------------------------------

export interface SimRpc {
  request<T>(method: string, params?: unknown[]): Promise<T>;
}

export function assertLocalForkRpc(rpcUrl: string): void {
  if (!isLocalForkRpc(rpcUrl)) {
    throw new Error("anvil admin RPC refused — LOCAL FORK ONLY (loopback URL required, never a remote RPC)");
  }
}

export function makeSimRpc(rpcUrl: string): SimRpc {
  return {
    async request<T>(method: string, params: unknown[] = []): Promise<T> {
      if (method.startsWith("anvil_")) assertLocalForkRpc(rpcUrl);
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const json = (await res.json()) as { result?: T; error?: { message?: string } };
      if (json.error) throw new Error(json.error.message ?? `${method} failed`);
      return json.result as T;
    },
  };
}

export interface SimNodeProbe {
  clientVersion(): Promise<string>;
  nodeInfo(): Promise<unknown>;
}

export function makeNodeProbe(rpcUrl: string): SimNodeProbe {
  const rpc = makeSimRpc(rpcUrl);
  return {
    clientVersion: () => rpc.request<string>("web3_clientVersion"),
    nodeInfo: () => rpc.request<unknown>("anvil_nodeInfo"),
  };
}

/** anvil_nodeInfo carries the fork block under forkConfig (accept number/hex/dec string) */
export function forkBlockOf(nodeInfo: unknown): number | null {
  if (nodeInfo === null || typeof nodeInfo !== "object") return null;
  const o = nodeInfo as Record<string, unknown>;
  const fc = o["forkConfig"];
  const candidates: unknown[] = [
    fc !== null && typeof fc === "object" ? (fc as Record<string, unknown>)["forkBlockNumber"] : undefined,
    o["forkBlockNumber"],
    o["fork_block_number"],
  ];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
    if (typeof c === "string") {
      const n = c.startsWith("0x") ? Number.parseInt(c, 16) : Number.parseInt(c, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// preflight
// ---------------------------------------------------------------------------

export interface PreflightCheck {
  id: "build" | "rpc" | "chain" | "anvil" | "perimeter" | "pin" | "overlay";
  label: string;
  ok: boolean;
  detail: string;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
  reasons: string[];
  host: string;
  chainId: number | null;
  forkBlock: number | null;
  overlay: SimOverlayRecord | null;
  staleOverlay: boolean;
}

export interface PreflightOpts {
  rpcUrl: string;
  client: Pick<PublicClient, "getChainId" | "getCode">;
  probe?: SimNodeProbe;
  entryEnabled?: boolean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** the strong checks before any anvil_* call: local, chain 369, anvil, perimeter code */
export async function preflightSimBootstrap(opts: PreflightOpts): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];
  const reasons: string[] = [];
  const host = hostOf(opts.rpcUrl);
  const entryEnabled = opts.entryEnabled ?? simEntryEnabled;

  checks.push({
    id: "build",
    label: "SIM entry enabled in this build",
    ok: entryEnabled,
    detail: entryEnabled ? "build flag on" : "VITE_ENABLE_SIM_MODE is not set for this build",
  });
  if (!entryEnabled) reasons.push("SIM entry is disabled in this build");

  const local = isLocalForkRpc(opts.rpcUrl);
  checks.push({
    id: "rpc",
    label: "local loopback fork",
    ok: local,
    detail: local ? host : `${host} is not loopback — the bootstrap NEVER calls anvil_* on a remote RPC`,
  });
  if (!local) {
    reasons.push("the active RPC is not a local loopback fork");
    return { ok: false, checks, reasons, host, chainId: null, forkBlock: null, overlay: null, staleOverlay: false };
  }

  let chainId: number | null = null;
  try {
    chainId = await opts.client.getChainId();
  } catch (e) {
    checks.push({ id: "chain", label: "chain id 369", ok: false, detail: `RPC unreachable: ${e instanceof Error ? e.message : String(e)}` });
    reasons.push("the RPC did not answer eth_chainId — is anvil running?");
    return { ok: false, checks, reasons, host, chainId, forkBlock: null, overlay: readSimOverlay(opts.rpcUrl), staleOverlay: false };
  }
  const chainOk = chainId === 369;
  checks.push({
    id: "chain",
    label: "chain id 369 (PulseChain)",
    ok: chainOk,
    detail: `eth_chainId = ${chainId}`,
  });
  if (!chainOk) reasons.push(`chain id is ${chainId}, not 369 — fork PulseChain, not another chain`);

  // perimeter code BEFORE any anvil_* probe: a random loopback service that
  // happens to answer chain 369 must not receive an anvil admin call.
  let missing: string[] = [];
  if (chainOk) {
    for (const name of PERIMETER_GATES) {
      try {
        const code = await opts.client.getCode({ address: addr(name) });
        if (!code || code === "0x") missing.push(name);
      } catch {
        missing.push(name);
      }
    }
  } else {
    missing = [...PERIMETER_GATES];
  }
  const perimeterOk = missing.length === 0;
  checks.push({
    id: "perimeter",
    label: "live perimeter present at the config addresses",
    ok: perimeterOk,
    detail: perimeterOk ? PERIMETER_GATES.join(" · ") : `no code at ${missing.join(", ")} — fork PulseChain at a block where the system exists`,
  });
  if (!perimeterOk) reasons.push("the forked perimeter is missing — check the fork URL/block");

  // anvil detection: web3_clientVersion first; anvil_nodeInfo only after the
  // local + chain + perimeter gates (never send an anvil_* probe to an
  // arbitrary node)
  const probe = opts.probe ?? makeNodeProbe(opts.rpcUrl);
  let version = "";
  let nodeInfo: unknown = null;
  let versionError: string | null = null;
  try {
    version = await probe.clientVersion();
  } catch (e) {
    versionError = e instanceof Error ? e.message : String(e);
  }
  const versionAnvil = /anvil/i.test(version);
  if (chainOk) {
    // the fork block lives in anvil_nodeInfo; only ask after the local +
    // chain gates (never send an anvil_* probe to an arbitrary node)
    try {
      nodeInfo = await probe.nodeInfo();
    } catch {
      nodeInfo = null;
    }
  }
  const isAnvil = versionAnvil || nodeInfo !== null;
  checks.push({
    id: "anvil",
    label: "anvil node",
    ok: isAnvil,
    detail: isAnvil
      ? nodeInfo !== null
        ? "anvil_nodeInfo answered"
        : version
      : versionError !== null
        ? `web3_clientVersion failed: ${versionError}`
        : `${version || "unknown client"} is not anvil — the deploy needs anvil admin RPC`,
  });
  if (!isAnvil) reasons.push("the node is not anvil (or does not expose anvil_nodeInfo)");

  const forkBlock = forkBlockOf(nodeInfo);
  const pinOk = forkBlock === null || forkBlock === SUGGESTED_PIN;
  checks.push({
    id: "pin",
    label: `fork block ${SUGGESTED_PIN.toLocaleString()} (recommended)`,
    ok: true,
    detail:
      forkBlock === null
        ? "no fork block reported (fork from head) — the seeds/chat snapshot may be behind"
        : pinOk
          ? `forked at ${forkBlock.toLocaleString()}`
          : `forked at ${forkBlock.toLocaleString()} — later/earlier than the recommended pin; the deploy works, the seeds/snapshot are behind`,
  });

  const code = await checkOverlayCode(opts.client, opts.rpcUrl, chainId);
  const overlay = code.overlay;
  const overlayLabel =
    overlay === null
      ? "static fixture fallback"
      : code.chainMismatch
        ? `STALE — recorded on chain ${overlay.chainId}, active ${chainId}`
        : code.stale
          ? "STALE — redeploy"
          : "runtime overlay live";
  checks.push({
    id: "overlay",
    label: "layer overlay status",
    ok: true,
    detail: overlayLabel,
  });

  const ok = entryEnabled && local && chainOk && isAnvil && perimeterOk;
  return {
    ok,
    checks,
    reasons,
    host,
    chainId,
    forkBlock,
    overlay,
    staleOverlay: overlay !== null && code.stale,
  };
}

// ---------------------------------------------------------------------------
// the four creation txs through THE gate
// ---------------------------------------------------------------------------

export function deployArgs(step: SimDeployStepDef, deployed: Partial<Record<SimDeployName, Address>>): readonly unknown[] {
  switch (step.name) {
    case "ENCRYPT":
      return [addr("VOID")];
    case "WORLD":
      return [addr("CHEON"), addr("META"), addr("MAP")];
    case "WAR": {
      const world = deployed.WORLD;
      if (!world) throw new Error("WORLD must be deployed before WAR");
      return [world];
    }
    case "GWAT": {
      const war = deployed.WAR;
      if (!war) throw new Error("WAR must be deployed before GWAT");
      return [war];
    }
  }
}

export function encodeSimDeploy(step: SimDeployStepDef, deployed: Partial<Record<SimDeployName, Address>>, abi: Abi): `0x${string}` {
  return encodeDeployData({ abi, bytecode: simCreationHex(step.bundleKey), args: deployArgs(step, deployed) });
}

export async function loadSimDeployAbi(step: SimDeployStepDef): Promise<Abi> {
  return loadAbi(step.abiFile);
}

// ---------------------------------------------------------------------------
// the SIM-only signer: impersonate the LIVE deployer (loopback only)
// ---------------------------------------------------------------------------

/**
 * Gas-only fork funding for the impersonated deployer. NOT a player balance:
 * the pin's gas price is ~5e14 wei, so four padded 30M-gas creations cost
 * ~60,000 PLS — 100,000 PLS is gas headroom and nothing else.
 */
export const DEPLOYER_GAS_FUND_WEI = 100_000n * 10n ** 18n;

export async function prepareImpersonatedDeployer(rpcUrl: string, deployer: Address = LIVE_DEPLOYER): Promise<void> {
  assertLocalForkRpc(rpcUrl);
  const rpc = makeSimRpc(rpcUrl);
  await rpc.request("anvil_impersonateAccount", [deployer]);
  await rpc.request("anvil_setBalance", [deployer, "0x" + DEPLOYER_GAS_FUND_WEI.toString(16)]);
}

export async function stopImpersonatingDeployer(rpcUrl: string, deployer: Address = LIVE_DEPLOYER): Promise<void> {
  assertLocalForkRpc(rpcUrl);
  try {
    await makeSimRpc(rpcUrl).request("anvil_stopImpersonatingAccount", [deployer]);
  } catch {
    /* already stopped / node restarted — nothing to unwind */
  }
}

/**
 * The SIM-only GateSigner. It signs NOTHING: anvil signs as the impersonated
 * live deployer via eth_sendTransaction. Explicit gas always (the set-60
 * lesson: an impersonated send without gas mines a cheap empty revert).
 * `mode` is the operator's wallet mode so the gate's approval policy is the
 * ordinary one (mode C + breadth auto-acks creations; A/B card each).
 */
export function makeImpersonatedSigner(rpcUrl: string, mode: WalletMode, deployer: Address = LIVE_DEPLOYER): GateSigner {
  assertLocalForkRpc(rpcUrl);
  return {
    mode,
    account: deployer,
    async sendTransaction(args): Promise<`0x${string}`> {
      await prepareImpersonatedDeployer(rpcUrl, deployer);
      const tx: Record<string, unknown> = {
        from: deployer,
        data: args.data,
        value: "0x" + (args.value ?? 0n).toString(16),
        gas: "0x" + (args.gas ?? DEPLOY_GAS).toString(16),
      };
      if (args.to !== null) tx["to"] = args.to;
      return makeSimRpc(rpcUrl).request<`0x${string}`>("eth_sendTransaction", [tx]);
    },
  };
}

// ---------------------------------------------------------------------------
// post-deploy wiring verification (mirrors harness set 3)
// ---------------------------------------------------------------------------

export interface WiringCheck {
  id: string;
  label: string;
  ok: boolean;
  expected: string;
  actual: string;
}

const chanOwnerAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "bool" }] },
] as const;
const voidLibAbi = [
  {
    type: "function",
    name: "GetLibraryAddress",
    stateMutability: "view",
    inputs: [{ name: "n", type: "string" }],
    outputs: [{ type: "address" }],
  },
] as const;
const worldMetaAbi = [
  { type: "function", name: "Vitus", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "Cheon", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "Meta", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "Map", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "maxSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "GetMarketRate",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
const warMetaAbi = [
  { type: "function", name: "World", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "Water", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "maxSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "GetMarketRate",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
const supplyAbi = [{ type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const;

type LooseRead = (args: {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}) => Promise<unknown>;

function looseRead(client: PublicClient, address: Address, abi: Abi, functionName: string, args?: readonly unknown[]): Promise<unknown> {
  const read = client.readContract as unknown as LooseRead;
  return read(args === undefined ? { address, abi, functionName } : { address, abi, functionName, args });
}

function eqAddr(a: unknown, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

const UNIT = 10n ** 18n;
const MAX_LOTTERY_CAP = 111_111n;

export interface LayerVerification {
  ok: boolean;
  checks: WiringCheck[];
  layer: Partial<Record<SimLayerName, Address>>;
  error: string | null;
}

/**
 * Verify the deployed stack exactly the way set 3 does: VITUS/H2O exist and
 * are CHAN owners, VOID knows the encrypt library, the WORLD/WAR wiring +
 * rates + caps hold, and the 1:1 supply anchors match. Any failure = no
 * runtime overlay write (a half-wired layer is not exposed).
 */
export async function verifySimLayer(
  client: PublicClient,
  addresses: Partial<Record<SimDeployName, Address>>
): Promise<LayerVerification> {
  const checks: WiringCheck[] = [];
  const layer: Partial<Record<SimLayerName, Address>> = {};
  const fail = (error: string | null = null): LayerVerification => ({ ok: false, checks, layer, error });
  const add = (id: string, label: string, ok: boolean, expected: string, actual: string | bigint | boolean) => {
    const text = typeof actual === "bigint" ? actual.toString() : String(actual);
    checks.push({ id, label, ok, expected, actual: text });
  };

  const world = addresses.WORLD;
  const war = addresses.WAR;
  const encrypt = addresses.ENCRYPT;
  const gwat = addresses.GWAT;
  if (!world || !war || !encrypt || !gwat) return fail("deploy sequence incomplete");
  layer.WORLD = world;
  layer.WAR = war;
  layer.ENCRYPT = encrypt;
  layer.GWAT = gwat;

  let vitus: Address | null = null;
  let h2o: Address | null = null;
  try {
    const v = await looseRead(client, world, worldMetaAbi as unknown as Abi, "Vitus");
    if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) vitus = v as Address;
  } catch (e) {
    return fail(`WORLD.Vitus() failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const h = await looseRead(client, war, warMetaAbi as unknown as Abi, "Water");
    if (typeof h === "string" && /^0x[0-9a-fA-F]{40}$/.test(h)) h2o = h as Address;
  } catch (e) {
    return fail(`WAR.Water() failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!vitus || !h2o) return fail("constructor-created VITUS/H2O did not resolve");
  layer.VITUS = vitus;
  layer.H2O = h2o;

  const codeOf = async (a: Address): Promise<string> => {
    try {
      return (await client.getCode({ address: a })) ?? "0x";
    } catch {
      return "0x";
    }
  };
  add("vitus-code", "VITUS has code (deployed by the WORLD constructor)", (await codeOf(vitus)) !== "0x", "code", "code");
  add("h2o-code", "H2O has code (deployed by the WAR constructor)", (await codeOf(h2o)) !== "0x", "code", "code");

  const worldCheon = await looseRead(client, world, worldMetaAbi as unknown as Abi, "Cheon");
  const worldMeta = await looseRead(client, world, worldMetaAbi as unknown as Abi, "Meta");
  const worldMap = await looseRead(client, world, worldMetaAbi as unknown as Abi, "Map");
  add("world-cheon", "WORLD.Cheon() == config CHEON", eqAddr(worldCheon, addr("CHEON")), addr("CHEON"), String(worldCheon));
  add("world-meta", "WORLD.Meta() == config META", eqAddr(worldMeta, addr("META")), addr("META"), String(worldMeta));
  add("world-map", "WORLD.Map() == config MAP", eqAddr(worldMap, addr("MAP")), addr("MAP"), String(worldMap));

  const warWorld = await looseRead(client, war, warMetaAbi as unknown as Abi, "World");
  add("war-world", "WAR.World() == deployed WORLD", eqAddr(warWorld, world), world, String(warWorld));

  const lib = await looseRead(client, addr("VOID"), voidLibAbi as unknown as Abi, "GetLibraryAddress", ["encrypt"]);
  add("void-encrypt", "VOID library 'encrypt' == deployed ENCRYPT", eqAddr(lib, encrypt), encrypt, String(lib));

  // set 3's expectation: VITUS (its own ctor), WAR + H2O (the WARFIXED ctor +
  // the relocated H2O callback) are CHAN owners. WORLD and GWAT are not
  // CHAN owners in the deployed semantics — do not invent that check.
  for (const [label, a] of [
    ["VITUS", vitus],
    ["WAR", war],
    ["H2O", h2o],
  ] as const) {
    const owner = await looseRead(client, addr("CHAN"), chanOwnerAbi as unknown as Abi, "owner", [a]);
    add(`chan-owner-${label.toLowerCase()}`, `CHAN.owner(${label})`, owner === true, "true", Boolean(owner));
  }

  try {
    const vitusSupply = await looseRead(client, vitus, supplyAbi as unknown as Abi, "totalSupply");
    const mvSupply = await looseRead(client, VITUS_ANCHOR, supplyAbi as unknown as Abi, "totalSupply");
    add("vitus-supply", "VITUS seeded 1:1 with the MV anchor supply", vitusSupply === mvSupply, String(mvSupply), String(vitusSupply));
    const h2oSupply = await looseRead(client, h2o, supplyAbi as unknown as Abi, "totalSupply");
    const callSupply = await looseRead(client, H2O_ANCHOR, supplyAbi as unknown as Abi, "totalSupply");
    add("h2o-supply", "H2O seeded 1:1 with the Call anchor supply", h2oSupply === callSupply, String(callSupply), String(h2oSupply));
  } catch (e) {
    return fail(`supply anchors unreadable: ${e instanceof Error ? e.message : String(e)}`);
  }

  for (const token of ["AFFECTION", "CHEON", "META", "MAP"] as const) {
    const rate = await looseRead(client, world, worldMetaAbi as unknown as Abi, "GetMarketRate", [addr(token)]);
    add(`world-rate-${token.toLowerCase()}`, `WORLD rate[${token}] == 1e18`, rate === UNIT, UNIT.toString(), String(rate));
  }
  const warRate = await looseRead(client, war, warMetaAbi as unknown as Abi, "GetMarketRate", [addr("AFFECTION")]);
  add("war-rate-affection", "WAR rate[AFFECTION] == 1e18", warRate === UNIT, UNIT.toString(), String(warRate));

  try {
    const worldCap = await looseRead(client, world, worldMetaAbi as unknown as Abi, "maxSupply");
    const warCap = await looseRead(client, war, warMetaAbi as unknown as Abi, "maxSupply");
    const gwatCap = await looseRead(client, gwat, worldMetaAbi as unknown as Abi, "maxSupply");
    const capOk = (v: unknown) => typeof v === "bigint" && v >= 0n && v < MAX_LOTTERY_CAP;
    add("world-cap", "WORLD constructor-lottery cap drawn (< 111111)", capOk(worldCap), "< 111111", String(worldCap));
    add("war-cap", "WAR constructor-lottery cap drawn (< 111111)", capOk(warCap), "< 111111", String(warCap));
    add("gwat-cap", "GWAT constructor-lottery cap drawn (< 111111)", capOk(gwatCap), "< 111111", String(gwatCap));
  } catch (e) {
    return fail(`caps unreadable: ${e instanceof Error ? e.message : String(e)}`);
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks, layer, error: ok ? null : "wiring verification failed — the runtime overlay was NOT written" };
}

// ---------------------------------------------------------------------------
// the deploy run
// ---------------------------------------------------------------------------

export type StepState = "pending" | "sending" | "sent" | "failed";

export interface SimBootstrapDeps {
  rpcUrl: string;
  chainId: number;
  preflight: PreflightResult;
  client: PublicClient;
  signer: GateSigner;
  /** the ONE gate path: GateContext.send with a signer override */
  send: (request: GateRequest, signer: GateSigner) => Promise<GateOutcome | { status: "no-signer" }>;
  onStep?: (index: number, state: StepState, detail: string) => void;
  /** verify the constructors' wiring before writing the overlay (tests can stub) */
  verify?: typeof verifySimLayer;
  /** test seams — the defaults are the anvil impersonation calls */
  prepare?: () => Promise<void>;
  stop?: () => Promise<void>;
}

export interface StepOutcome {
  name: SimDeployName;
  state: StepState;
  address: Address | null;
  txHash: string | null;
  detail: string;
}

export interface SimBootstrapResult {
  ok: boolean;
  steps: StepOutcome[];
  verification: LayerVerification | null;
  overlay: SimOverlayRecord | null;
  error: string | null;
}

export async function runSimBootstrap(deps: SimBootstrapDeps): Promise<SimBootstrapResult> {
  if (!deps.preflight.ok) {
    return { ok: false, steps: [], verification: null, overlay: null, error: deps.preflight.reasons.join("; ") || "preflight failed" };
  }
  if (!simLayerActive(deps.rpcUrl)) {
    return { ok: false, steps: [], verification: null, overlay: null, error: "SIM layer is not active for this RPC (local fork + build flag required)" };
  }

  const steps: StepOutcome[] = SIM_DEPLOY_STEPS.map((s) => ({
    name: s.name,
    state: "pending",
    address: null,
    txHash: null,
    detail: "waiting",
  }));
  const deployed: Partial<Record<SimDeployName, Address>> = {};
  let error: string | null = null;

  deps.onStep?.(0, "pending", "preparing the impersonated live deployer (gas only)");
  try {
    if (deps.prepare) await deps.prepare();
    else await prepareImpersonatedDeployer(deps.rpcUrl, deps.signer.account);
  } catch (e) {
    return {
      ok: false,
      steps,
      verification: null,
      overlay: null,
      error: `could not impersonate the live deployer: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  try {
    for (let i = 0; i < SIM_DEPLOY_STEPS.length; i++) {
      const def = SIM_DEPLOY_STEPS[i]!;
      const out = steps[i]!;
      try {
        deps.onStep?.(i, "sending", def.label);
        out.state = "sending";
        out.detail = def.label;
        const abi = await loadSimDeployAbi(def);
        const data = encodeSimDeploy(def, deployed, abi);
        const request: GateRequest = {
          to: null,
          data,
          account: deps.signer.account,
          abi,
          meta: { source: "manual", label: `SIM bootstrap · ${def.name} (${def.contract})` },
        };
        const outcome = await deps.send(request, deps.signer);
        if (outcome.status === "no-signer") throw new Error("the gate has no signer");
        if (outcome.status === "denied") throw new Error(`denied by policy: ${outcome.reasons.join("; ")}`);
        if (outcome.status === "sim-failed") throw new Error(`DRYRUN reverted${outcome.envelope.sim?.error?.decoded ? `: ${outcome.envelope.sim.error.decoded}` : ""}`);
        if (outcome.status === "aborted") throw new Error(outcome.reason);
        const receipt = outcome.receipt;
        if (receipt === null) throw new Error(`no receipt: ${outcome.receiptError ?? "unknown"}`);
        if (receipt.status !== "success") throw new Error(`creation reverted (gas ${receipt.gasUsed.toString()})`);
        if (receipt.contractAddress === null) throw new Error("receipt carries no contractAddress");
        const address = receipt.contractAddress as Address;
        deployed[def.name] = address;
        out.state = "sent";
        out.address = address;
        out.txHash = outcome.txHash;
        out.detail = `deployed at ${address}`;
        deps.onStep?.(i, "sent", out.detail);
      } catch (e) {
        out.state = "failed";
        out.detail = e instanceof Error ? e.message : String(e);
        deps.onStep?.(i, "failed", out.detail);
        error = `${def.name}: ${out.detail}`;
        break;
      }
    }

    if (error !== null) return { ok: false, steps, verification: null, overlay: null, error };

    const verification = await (deps.verify ?? verifySimLayer)(deps.client, deployed);
    if (!verification.ok || !verification.layer.WORLD || !verification.layer.VITUS || !verification.layer.WAR || !verification.layer.H2O || !verification.layer.GWAT || !verification.layer.ENCRYPT) {
      return {
        ok: false,
        steps,
        verification,
        overlay: null,
        error: verification.error ?? "wiring verification failed — the runtime overlay was NOT written",
      };
    }

    const overlay = writeSimOverlay(deps.rpcUrl, {
      chainId: deps.chainId,
      deployedBy: deps.signer.account,
      layer: {
        WORLD: verification.layer.WORLD,
        VITUS: verification.layer.VITUS,
        WAR: verification.layer.WAR,
        H2O: verification.layer.H2O,
        GWAT: verification.layer.GWAT,
        ENCRYPT: verification.layer.ENCRYPT,
      },
      pin: deps.preflight.forkBlock,
      forkBlock: deps.preflight.forkBlock,
      deployedAt: Date.now(),
      notes: {
        ENCRYPT: "self-registered as VOID's 'encrypt' library on the fork",
        source: "in-frontend bootstrap (session-81) — actual creation receipts, not the static fixture",
        fixedVariants: "WORLD/VITUS/WAR/H2O are the fixture-FIXED variants; GWAT/ENCRYPT are verbatim",
      },
    });
    return { ok: true, steps, verification, overlay, error: null };
  } finally {
    if (deps.stop) await deps.stop();
    else await stopImpersonatingDeployer(deps.rpcUrl, deps.signer.account);
    deps.onStep?.(-1, "pending", "stopped impersonating the live deployer");
  }
}

// ---------------------------------------------------------------------------
// the fork-only player (separate from the deployer)
// ---------------------------------------------------------------------------

export const DEFAULT_FORK_PLAYER_PLS = "2000000";

export interface PlayerAmount {
  ok: boolean;
  wei: bigint | null;
  error: string | null;
}

/** whole-PLS input, > 0, finite — no hardcoded ceiling (the owner direction) */
export function validatePlayerAmount(input: string): PlayerAmount {
  const t = input.trim();
  if (t.length === 0) return { ok: false, wei: null, error: "enter an amount in whole PLS" };
  if (!/^[0-9]+$/.test(t)) return { ok: false, wei: null, error: "whole PLS only (digits, no decimals)" };
  try {
    const whole = BigInt(t);
    if (whole <= 0n) return { ok: false, wei: null, error: "amount must be greater than zero" };
    if (whole > 10n ** 15n) return { ok: false, wei: null, error: "amount is implausibly large (max 1e15 whole PLS)" };
    return { ok: true, wei: parseEther(t), error: null };
  } catch {
    return { ok: false, wei: null, error: "not a valid PLS amount" };
  }
}

export interface ForkPlayerKey {
  address: Address;
  privateKey: `0x${string}`;
}

/** a fresh fork-only key — worthless off the fork, never a real wallet */
export function createForkPlayer(): ForkPlayerKey {
  const privateKey = generatePrivateKey();
  return { address: privateKeyToAccount(privateKey).address, privateKey };
}

/** anvil_setBalance on the local fork (never a transfer; no remote calls) */
export async function fundForkPlayer(rpcUrl: string, address: Address, amountInput: string): Promise<{ wei: bigint; balance: bigint }> {
  assertLocalForkRpc(rpcUrl);
  const amount = validatePlayerAmount(amountInput);
  if (!amount.ok || amount.wei === null) throw new Error(amount.error ?? "invalid amount");
  const rpc = makeSimRpc(rpcUrl);
  await rpc.request("anvil_setBalance", [address, "0x" + amount.wei.toString(16)]);
  const balance = await rpc.request<string>("eth_getBalance", [address, "latest"]);
  return { wei: amount.wei, balance: BigInt(balance) };
}

export async function readForkBalance(rpcUrl: string, address: Address): Promise<bigint> {
  const rpc = makeSimRpc(rpcUrl);
  const balance = await rpc.request<string>("eth_getBalance", [address, "latest"]);
  return BigInt(balance);
}
