import { type Abi, type Address, type PublicClient } from "viem";
import { loadAbi } from "@/chain/abiLoad";
import { simAddr } from "@/chain/simMode";

/**
 * The ENCRYPT cipher desk reads/encodes (session 59, SIM-only — the compact
 * cipher card on IDENTITY; the owner round: no enumeration getter exists, so
 * the card is the honest shape). Fork-pinned truths riding this module
 * (harness set 3 steps 11–12, pin 27,674,000):
 *
 * - the keystream is a DETERMINISTIC modexp orbit over the pair's fixed SHA
 *   channels — the DRYRUN preview index == the committed index, and the
 *   Decrypt preview == the exact plaintext;
 * - one string-Encrypt meters +4 units to the CONTRACT (string → bytes →
 *   Crypt + hashKey each run _mintToCap — the call-counter law, quadrupled
 *   by the overload chain);
 * - the party gates key on the FROM side for Encrypt and the TO side for
 *   Decrypt, against the SHIO owners MAP (SHIOFactory adds tx.origin at
 *   birth — the wallet that created the LAU passes);
 * - the index is NOT pair-bound: a TO-owner feeding a foreign index through
 *   the swapped pair gets GARBAGE, not a revert;
 * - entries expire in 10 days; an expired entry decrypts ONCE more
 *   (delete-after-read), then answers empty;
 * - Prune indexes _encryptions by ARRAY POSITION, not keystream index — it
 *   mangles the private enumeration but leaves BOTH live and expired
 *   entries decryptable (the wrong-key-domain defect).
 */

/** LAU.Saat(1) — the soul id (uint64) that rides as `From`/`to` */
export const LAU_SAAT_1_SELECTOR = "0x088aee78";

const lauSaatAbi = [
  { type: "function", name: "Saat", stateMutability: "view", inputs: [{ name: "i", type: "uint256" }], outputs: [{ type: "uint64" }] },
] as const;

/** exposed for the selector regression test (never for direct calls) */
export const _lauSaatAbi = lauSaatAbi;

export async function readSoulId(client: PublicClient, lau: Address): Promise<bigint | null> {
  const { encodeFunctionData } = await import("viem");
  try {
    const raw = await client.call({
      to: lau,
      data: encodeFunctionData({ abi: lauSaatAbi as unknown as Abi, functionName: "Saat", args: [1n] }),
    });
    const data = typeof raw === "string" ? (raw as `0x${string}`) : ((raw as { data: `0x${string}` }).data);
    return BigInt(data);
  } catch {
    return null;
  }
}

let encryptAbiCache: Promise<Abi> | null = null;

/** the full ENCRYPT ABI for the gate's custom-error decode (NotParty etc.) */
export function encryptAbi(): Promise<Abi> {
  if (!encryptAbiCache) encryptAbiCache = loadAbi("ENCRYPT.json");
  return encryptAbiCache;
}

type FnEntry = Extract<Abi[number], { type: "function" }>;

/** pick the overload whose inputs match the type list (string vs bytes forms) */
export function pickOverload(abi: Abi, name: string, inputTypes: string[]): FnEntry {
  const hits = abi.filter(
    (e): e is FnEntry =>
      e.type === "function" && e.name === name && e.inputs.length === inputTypes.length && e.inputs.every((i, idx) => i.type === inputTypes[idx]),
  );
  if (hits.length === 0 || hits[0] === undefined) throw new Error(`ABI overload not found: ${name}(${inputTypes.join(",")})`);
  return hits[0];
}

/** ENCRYPT.Encrypt(from, to, string key, string data) — returns the preview index */
export async function encodeEncryptString(from: bigint, to: bigint, key: string, data: string, rpcUrl: string): Promise<{ to: Address; data: `0x${string}`; abi: Abi }> {
  const abi = await encryptAbi();
  const { encodeFunctionData } = await import("viem");
  return {
    to: simAddr("ENCRYPT", rpcUrl),
    data: encodeFunctionData({ abi: [pickOverload(abi, "Encrypt", ["uint64", "uint64", "string", "string"])], functionName: "Encrypt", args: [from, to, key, data] }),
    abi,
  };
}

/** ENCRYPT.Decrypt(from, to, index, string key) — returns the plaintext bytes */
export async function encodeDecryptString(from: bigint, to: bigint, index: bigint, key: string, rpcUrl: string): Promise<{ to: Address; data: `0x${string}`; abi: Abi }> {
  const abi = await encryptAbi();
  const { encodeFunctionData } = await import("viem");
  return {
    to: simAddr("ENCRYPT", rpcUrl),
    data: encodeFunctionData({ abi: [pickOverload(abi, "Decrypt", ["uint64", "uint64", "uint64", "string"])], functionName: "Decrypt", args: [from, to, index, key] }),
    abi,
  };
}

/** ENCRYPT.Prune() — the (defective) sweep */
export async function encodePrune(rpcUrl: string): Promise<{ to: Address; data: `0x${string}`; abi: Abi }> {
  const abi = await encryptAbi();
  const { encodeFunctionData } = await import("viem");
  return { to: simAddr("ENCRYPT", rpcUrl), data: encodeFunctionData({ abi: [pickOverload(abi, "Prune", [])], functionName: "Prune", args: [] }), abi };
}

/** the uint64 index from an Encrypt DRYRUN result (deterministic == committed) */
export function decodeEncryptIndex(result: `0x${string}`): bigint | null {
  try {
    // a lone uint64 return is one 32-byte word
    if (result.length >= 66) return BigInt(result.slice(0, 66));
    return null;
  } catch {
    return null;
  }
}

/** the plaintext bytes from a Decrypt DRYRUN result — utf-8 best-effort */
export function decodeDecryptPlain(result: `0x${string}`): { text: string | null; byteLength: number } {
  try {
    const body = result.slice(2);
    if (body.length < 128) return { text: null, byteLength: 0 };
    const off = Number(BigInt("0x" + body.slice(0, 64)));
    const len = Number(BigInt("0x" + body.slice(off * 2, off * 2 + 64)));
    const raw = result.slice(2 + off * 2 + 64, 2 + off * 2 + 64 + len * 2);
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), byteLength: len };
    } catch {
      return { text: null, byteLength: len };
    }
  } catch {
    return { text: null, byteLength: 0 };
  }
}
