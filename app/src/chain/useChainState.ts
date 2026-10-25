import { useEffect, useMemo, useState } from "react";
import { makeClient } from "./client";
import { isLocalForkRpc, readQueryRpc, resolveRpc, rpcHost, type RpcSource } from "./rpc";

export interface ChainState {
  url: string;
  host: string;
  source: RpcSource;
  sim: boolean;
  queryOverride: boolean;
  chainId: number | null;
  blockNumber: bigint | null;
  gasPriceGwei: string | null;
  error: string | null;
}

export function useChainState(): ChainState {
  const resolved = useMemo(() => resolveRpc(), []);
  const queryOverride = readQueryRpc() !== null;
  const client = useMemo(() => makeClient(resolved.url), [resolved.url]);
  const [chainId, setChainId] = useState<number | null>(null);
  const [blockNumber, setBlockNumber] = useState<bigint | null>(null);
  const [gasPriceGwei, setGasPriceGwei] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const id = await client.getChainId();
        const head = await client.getBlockNumber();
        const gas = await client.getGasPrice();
        if (!alive) return;
        setChainId(id);
        setBlockNumber(head);
        setGasPriceGwei((Number(gas) / 1e9).toFixed(1));
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    poll();
    const t = window.setInterval(poll, 12_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [client]);

  return {
    url: resolved.url,
    host: rpcHost(resolved.url),
    source: resolved.source,
    sim: isLocalForkRpc(resolved.url),
    queryOverride,
    chainId,
    blockNumber,
    gasPriceGwei,
    error,
  };
}
