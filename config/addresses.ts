import raw from "./addresses.json";

export interface AddressConfig {
  $provenance: string;
  chainId: number;
  explorer: string;
  knownMainnetRpc: string[];
  contracts: Record<string, `0x${string}`>;
  /** non-perimeter read infra (kb §1) — batching only, never a send destination */
  infra: { multicall3: `0x${string}` };
  /** perimeter name -> abi/index.json name where they differ (instances of a template ABI) */
  abiAliases: Record<string, string>;
  notes: Record<string, string>;
}

export const addressConfig = raw as AddressConfig;

export const CHAIN_ID = addressConfig.chainId;
export const EXPLORER_BASE = addressConfig.explorer;
export const KNOWN_MAINNET_RPC = addressConfig.knownMainnetRpc;
export const MULTICALL3 = addressConfig.infra.multicall3;

export type ContractName = keyof typeof addressConfig.contracts;

export function addr(name: ContractName): `0x${string}` {
  const a = addressConfig.contracts[name];
  if (!a) throw new Error(`address not in perimeter table: ${name}`);
  return a;
}

export const PERIMETER = addressConfig.contracts;
