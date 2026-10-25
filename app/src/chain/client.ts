import { createPublicClient, defineChain, http, type PublicClient } from "viem";
import { CHAIN_ID, KNOWN_MAINNET_RPC, MULTICALL3 } from "@config/addresses";

export const pulsechain = defineChain({
  id: CHAIN_ID,
  name: "PulseChain",
  nativeCurrency: { name: "Pulse", symbol: "PLS", decimals: 18 },
  rpcUrls: { default: { http: KNOWN_MAINNET_RPC } },
  contracts: {
    multicall3: { address: MULTICALL3 },
  },
  blockExplorers: {
    default: { name: "PulseChain Scan", url: "https://ipfs.scan.pulsechain.com" },
  },
});

export function makeClient(url: string): PublicClient {
  return createPublicClient({
    chain: pulsechain,
    transport: http(url, { batch: true }),
    pollingInterval: 12_000,
  });
}
