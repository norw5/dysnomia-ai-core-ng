import raw from "./addresses.json";

export interface AddressConfig {
  $provenance: string;
  chainId: number;
  explorer: string;
  /** transaction path — tx_status links a hash without guessing the explorer shape */
  explorerTx: string;
  knownMainnetRpc: string[];
  contracts: Record<string, `0x${string}`>;
  /**
   * Non-perimeter infrastructure. multicall3 = batching only, never a send
   * destination (kb §1). The PulseX V2 router/factory/WPLS are EXTERNAL DEX
   * infrastructure (session-83): the router IS a send destination for
   * swap_pls_for_token (through THE gate, never a raw path); the factory
   * and WPLS are read/route constants. Verified on-chain + against the
   * official PulseX docs.
   */
  infra: {
    multicall3: `0x${string}`;
    pulsexV2Router: `0x${string}`;
    pulsexV2Factory: `0x${string}`;
    wpls: `0x${string}`;
  };
  /** perimeter name -> abi/index.json name where they differ (instances of a template ABI) */
  abiAliases: Record<string, string>;
  notes: Record<string, string>;
}

export const addressConfig = raw as AddressConfig;

export const CHAIN_ID = addressConfig.chainId;
export const EXPLORER_BASE = addressConfig.explorer;
export const EXPLORER_TX = addressConfig.explorerTx;
export const KNOWN_MAINNET_RPC = addressConfig.knownMainnetRpc;
export const MULTICALL3 = addressConfig.infra.multicall3;
/** external PulseX V2 DEX constants (session-83) — see the infra comment above */
export const PULSEX_V2_ROUTER = addressConfig.infra.pulsexV2Router;
export const PULSEX_V2_FACTORY = addressConfig.infra.pulsexV2Factory;
export const WPLS = addressConfig.infra.wpls;

export type ContractName = keyof typeof addressConfig.contracts;

export function addr(name: ContractName): `0x${string}` {
  const a = addressConfig.contracts[name];
  if (!a) throw new Error(`address not in perimeter table: ${name}`);
  return a;
}

export const PERIMETER = addressConfig.contracts;
