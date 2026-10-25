import type { Address, PublicClient } from "viem";
import { addr } from "@config/addresses";

/**
 * The CHO system address book (IA-REEVAL-49 B1.6, session-53): ~90 named
 * citizens written once at boot by a throwaway loader — "source" (the
 * treasury-side deployer key), the reserve set, the ban tokens, community
 * tokens. `Addresses(alias)`/`Aliases(i)` are VIEWS and anonymous-safe (the
 * session-49 mutability audit: CHO.GetUser/GetUserBySoul re-Recall and meter
 * — never touch those; this reader never does).
 *
 * Walk discipline: `Aliases` is a `string[]` public getter — index access
 * past the end reverts, so ONE anonymous Multicall3 batch probes a fixed
 * index bound and the CONTIGUOUS SUCCESS PREFIX is the book (a gap can only
 * be RPC flakiness, never onchain state). Round 2 resolves every alias
 * through `Addresses` (a mapping written together with the push — a zero
 * there is rendered honestly, never dropped silently). All-failed round =
 * dead RPC, thrown (the session-41 viem trap), never "empty book".
 */

export const choBookAbi = [
  { type: "function", name: "Aliases", stateMutability: "view", inputs: [{ name: "i", type: "uint256" }], outputs: [{ type: "string" }] },
  { type: "function", name: "Addresses", stateMutability: "view", inputs: [{ name: "alias", type: "string" }], outputs: [{ type: "address" }] },
] as const;

/** probe bound: comfortably above the ~90-entry book, below the ~300 aggregate3 batch cap */
export const ALIASES_WALK_BOUND = 160;

const ZERO = "0x0000000000000000000000000000000000000000";

export interface AddressBookRow {
  /** the onchain Aliases index — boot-write order */
  index: number;
  alias: string;
  /** null = Addresses returned zero for a live alias (never seen; rendered honestly) */
  address: Address | null;
}

export interface AddressBook {
  rows: AddressBookRow[];
  blockNumber: bigint | null;
  fetchedAt: number;
}

type MulticallResult<T> = { status: "success"; result: T } | { status: "failure"; error: Error };

function ok<T>(r: MulticallResult<T> | undefined): T | null {
  return r && r.status === "success" ? r.result : null;
}

export async function loadAddressBook(client: PublicClient): Promise<AddressBook> {
  // round 1 — the alias walk (one batch, contiguous success prefix)
  const walk = Array.from({ length: ALIASES_WALK_BOUND }, (_, i) => ({
    address: addr("CHO"),
    abi: choBookAbi,
    functionName: "Aliases",
    args: [BigInt(i)] as const,
  }));
  const r1 = (await client.multicall({ allowFailure: true, contracts: walk })) as MulticallResult<unknown>[];

  // all-failed = dead RPC (the book always has entries; empty is not a real state)
  if (r1.length > 0 && r1.every((r) => r.status === "failure")) {
    const err = (r1[0] as { status: "failure"; error: Error }).error;
    throw new Error(`address-book reads failed (aliases): ${err.message}`);
  }

  const aliases: { index: number; alias: string }[] = [];
  for (let i = 0; i < r1.length; i++) {
    const r = r1[i]!;
    if (r.status === "failure") break; // past the end of the array — the prefix is the book
    const alias = r.result as string;
    if (alias.length === 0) break; // defensive: an empty string is not a book entry
    aliases.push({ index: i, alias });
  }

  // round 2 — resolve every alias through Addresses (same batch discipline)
  const rows: AddressBookRow[] = aliases.map(({ index, alias }) => ({ index, alias, address: null }));
  if (aliases.length > 0) {
    const resolve = aliases.map(({ alias }) => ({
      address: addr("CHO"),
      abi: choBookAbi,
      functionName: "Addresses",
      args: [alias] as const,
    }));
    const r2 = (await client.multicall({ allowFailure: true, contracts: resolve })) as MulticallResult<unknown>[];
    if (r2.length > 0 && r2.every((r) => r.status === "failure")) {
      const err = (r2[0] as { status: "failure"; error: Error }).error;
      throw new Error(`address-book reads failed (addresses): ${err.message}`);
    }
    aliases.forEach((_a, i) => {
      const hit = ok<string>(r2[i] as MulticallResult<string>);
      rows[i]!.address = hit && hit.toLowerCase() !== ZERO ? (hit as Address) : null;
    });
  }

  const blockNumber = await client.getBlockNumber().catch(() => null);
  return { rows, blockNumber, fetchedAt: Date.now() };
}

/** search over the book: alias substring (case-insensitive) or address prefix */
export function searchAddressBook(book: AddressBook, query: string): AddressBookRow[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return book.rows;
  return book.rows.filter((r) => r.alias.toLowerCase().includes(q) || (r.address !== null && r.address.toLowerCase().startsWith(q)));
}
