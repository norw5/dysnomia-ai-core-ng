export interface MockEip1193RequestArgs {
  method: string;
  params?: unknown[];
}

export interface MockEip1193Provider {
  isMetaMask: boolean;
  chainId: string;
  networkVersion: string;
  request(args: MockEip1193RequestArgs): Promise<unknown>;
  on(event: string, handler: (...args: never[]) => void): void;
  removeListener(event: string, handler: (...args: never[]) => void): void;
  isConnect(): boolean;
  enable(): Promise<string[]>;
}

declare global {
  interface Window {
    ethereum?: MockEip1193Provider;
    __DYS_MOCK_RPC__?: string;
    /** session-75 e2e: the controllable SSE seam (agent.spec.ts) */
    __sse?: {
      ctl: ReadableStreamDefaultController<Uint8Array>;
      bodies: Array<Record<string, unknown>>;
    };
    __dysMock?: {
      log: MockEip1193RequestArgs[];
      requests: MockEip1193RequestArgs[];
      sentTransactions: Array<Record<string, unknown>>;
      account: string;
      setAccount(addr: string): void;
      emitAccountsChanged(accounts: string[]): void;
      emitChainChanged(chainIdHex: string): void;
      listenerCount(event: string): number;
      setRpc(url: string): void;
      push(req: MockEip1193RequestArgs): Promise<unknown>;
    };
  }
}

/**
 * The mock wallet used by the playwright harness:
 *  - announces itself over EIP-6963 (mode A discovery),
 *  - holds one deterministic account (anvil #0 by default),
 *  - emits accountsChanged/chainChanged when driven from the test,
 *  - CAPTURES eth_sendTransaction (returns a fake hash) instead of signing,
 *  - forwards everything else to the fork RPC (default http://127.0.0.1:8545).
 */
export const MOCK_PROVIDER_INIT = `
(() => {
  const forkRpc = window.__DYS_MOCK_RPC__ || "http://127.0.0.1:8545";
  const log = [];
  const requests = [];
  const sentTransactions = [];
  const listeners = {};
  let idc = 0;
  let account = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const forward = (payload) => new Promise((resolve, reject) => {
    const id = ++idc;
    requests.push(payload);
    const body = JSON.stringify({ jsonrpc: "2.0", id, method: payload.method, params: payload.params || [] });
    fetch(forkRpc, { method: "POST", headers: { "Content-Type": "application/json" }, body })
      .then((r) => r.json())
      .then((j) => (j.error ? reject(new Error(j.error.message)) : resolve(j.result)))
      .catch(reject);
  });
  const provider = {
    isMetaMask: false,
    chainId: "0x171",
    networkVersion: "369",
    request: async (args) => {
      log.push(args);
      if (args.method === "eth_chainId") return "0x171";
      if (args.method === "eth_accounts") return [account];
      if (args.method === "eth_requestAccounts") return [account];
      if (args.method === "net_version") return "369";
      if (args.method === "wallet_switchEthereumChain") return null;
      if (args.method === "eth_estimateGas") return "0x100000";
      if (args.method === "eth_sendTransaction") {
        sentTransactions.push((args.params || [])[0] || {});
        return "0x00000000000000000000000000000000000000000000000000000000dysmock1";
      }
      return forward(args);
    },
    on: (event, handler) => {
      (listeners[event] = listeners[event] || []).push(handler);
    },
    removeListener: (event, handler) => {
      listeners[event] = (listeners[event] || []).filter((h) => h !== handler);
    },
    isConnect: () => true,
    enable: async () => [account],
  };
  window.__dysMock = {
    log,
    requests,
    sentTransactions,
    get account() { return account; },
    setAccount: (a) => { account = a; },
      emitAccountsChanged: (accounts) => {
        for (const h of listeners["accountsChanged"] || []) h(accounts);
      },
      emitChainChanged: (chainIdHex) => {
        for (const h of listeners["chainChanged"] || []) h(chainIdHex);
      },
      listenerCount: (event) => (listeners[event] || []).length,
    setRpc: (u) => {},
    push: (req) => forward(req),
  };
  window.ethereum = provider;
  // EIP-6963: announce on requestProvider (matches real wallet timing)
  window.addEventListener("eip6963:requestProvider", () => {
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
      detail: { info: { uuid: "c6b4a0d8-6f5e-4f0a-9b1e-dysnomia-mock01", name: "MOX WALLET (harness)", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "io.dysnomia.mox" }, provider },
    }));
  });
})();
`;
