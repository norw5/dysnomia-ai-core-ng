import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createWalletClient, custom, http, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { pulsechain } from "@/chain/client";
import type { GateSigner, WalletMode } from "@/chain/txGate";
import type { Journal } from "@/chain/journal";
import {
  decryptKey,
  encryptKey,
  idbVault,
  type KeyVaultRecord,
} from "@/wallet/keyStore";
import {
  discoverProviders,
  providerList,
  subscribeProviders,
  type Eip1193Provider,
  type Eip6963AnnounceDetail,
  type Eip6963ProviderInfo,
} from "@/wallet/eip6963";

/**
 * Key modes A/B/C (IA-PLAN §7.2).
 *  A — injected browser wallet (EIP-6963); every send prompts the wallet.
 *  B — key in memory or passphrase-encrypted at rest; per-action approval.
 *  C — yolo: B without per-action approval, distinct visual state, explicit
 *      opt-in; still bounded by the policy gate and extra-acks.
 */

const MODE_KEY = "dys.wallet.mode"; // remembers A|B only — never C
const AUTO_LOCK_MS = 10 * 60 * 1000;
const PRIV_RE = /^0x[0-9a-fA-F]{64}$/;

export interface WalletState {
  mode: WalletMode;
  providers: Eip6963AnnounceDetail[];
  connected: Eip6963ProviderInfo | null;
  accountA: `0x${string}` | null;
  chainIdA: number | null;
  walletError: string | null;
  hasVault: boolean;
  vaultAddress: string | null;
  unlocked: boolean;
  accountB: `0x${string}` | null;
  memoryOnly: boolean;
  yolo: boolean;
}

export interface WalletApi extends WalletState {
  account: `0x${string}` | null;
  connectProvider(detail: Eip6963AnnounceDetail): Promise<void>;
  disconnectA(): void;
  importKey(privateKeyHex: string, passphrase: string | null): Promise<void>;
  unlockVault(passphrase: string): Promise<void>;
  lock(): void;
  deleteVault(): Promise<void>;
  enterYolo(confirmText: string): boolean;
  exitYolo(): void;
  setMode(mode: WalletMode): void;
  buildSigner(): GateSigner | null;
}

function readStoredMode(): WalletMode {
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    return v === "B" ? "B" : "A";
  } catch {
    return "A";
  }
}

const Ctx = createContext<WalletApi | null>(null);

export function WalletProvider({
  children,
  rpcUrl,
  journal,
}: {
  children: ReactNode;
  rpcUrl: string;
  journal: Journal;
}) {
  const [mode, setModeState] = useState<WalletMode>(readStoredMode);
  const [providers, setProviders] = useState<Eip6963AnnounceDetail[]>(() => providerList());
  const [connected, setConnected] = useState<Eip6963ProviderInfo | null>(null);
  const [accountA, setAccountA] = useState<`0x${string}` | null>(null);
  const [chainIdA, setChainIdA] = useState<number | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [hasVault, setHasVault] = useState(false);
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [accountB, setAccountB] = useState<`0x${string}` | null>(null);
  const [memoryOnly, setMemoryOnly] = useState(false);
  const [yolo, setYolo] = useState(false);

  const providerRef = useRef<Eip1193Provider | null>(null);
  const accountRef = useRef<ReturnType<typeof privateKeyToAccount> | null>(null);
  const vault = useMemo(() => idbVault(), []);
  const rpcRef = useRef(rpcUrl);
  rpcRef.current = rpcUrl;

  useEffect(() => {
    // subscribe BEFORE dispatching requestProvider — wallets announce synchronously
    const off = subscribeProviders(setProviders);
    discoverProviders();
    return off;
  }, []);

  useEffect(() => {
    void vault.get().then((r: KeyVaultRecord | null) => {
      setHasVault(r !== null);
      setVaultAddress(r?.address ?? null);
    });
  }, [vault]);

  const lock = useCallback(() => {
    accountRef.current = null;
    setUnlocked(false);
    setAccountB(null);
    setYolo(false);
    setMemoryOnly(false);
    journal.emit("wallet.account", "key locked (dropped from memory)");
  }, [journal]);

  // auto-lock on inactivity (modes B/C only)
  const lastActivity = useRef(Date.now());
  useEffect(() => {
    if (!unlocked) return;
    const bump = () => {
      lastActivity.current = Date.now();
    };
    const evs: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "focus"];
    for (const e of evs) window.addEventListener(e, bump);
    const t = window.setInterval(() => {
      if (Date.now() - lastActivity.current > AUTO_LOCK_MS) lock();
    }, 20_000);
    lastActivity.current = Date.now();
    return () => {
      for (const e of evs) window.removeEventListener(e, bump);
      window.clearInterval(t);
    };
  }, [unlocked, lock]);

  const setMode = useCallback(
    (m: WalletMode) => {
      if (m === "C") return; // C is entered via enterYolo from B, never selected directly
      setModeState(m);
      setYolo(false);
      try {
        window.localStorage.setItem(MODE_KEY, m);
      } catch {
        /* storage unavailable */
      }
      journal.emit("wallet.mode", `mode set to ${m}`);
    },
    [journal]
  );

  const connectProvider = useCallback(
    async (detail: Eip6963AnnounceDetail) => {
      setWalletError(null);
      const provider = detail.provider;
      try {
        const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
        if (!accounts || accounts.length === 0) throw new Error("no accounts returned");
        const chainHex = (await provider.request({ method: "eth_chainId" })) as string;
        let chain = Number.parseInt(chainHex, 16);
        if (chain !== pulsechain.id) {
          try {
            await provider.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: "0x" + pulsechain.id.toString(16) }],
            });
            const again = (await provider.request({ method: "eth_chainId" })) as string;
            chain = Number.parseInt(again, 16);
          } catch {
            /* switch refused below */
          }
        }
        if (chain !== pulsechain.id) {
          setAccountA(null);
          setChainIdA(chain);
          setWalletError(`wallet is on chain ${chain} — switch it to PulseChain (369) to send`);
          return;
        }
        providerRef.current = provider;
        setConnected(detail.info);
        setAccountA(accounts[0]! as `0x${string}`);
        setChainIdA(chain);
        journal.emit("wallet.account", `connected ${detail.info.name} · ${accounts[0]!}`);
        provider.on?.(
          "accountsChanged",
          ((accounts: string[]) => {
            // EIP-1193: payload arrives as one array argument
            const a = Array.isArray(accounts) ? (accounts[0] as `0x${string}` | undefined) : undefined;
            setAccountA(a ?? null);
            if (!a) {
              setConnected(null);
              providerRef.current = null;
            }
          }) as (...args: never[]) => void
        );
        provider.on?.(
          "chainChanged",
          ((hex: string) => {
            if (typeof hex === "string") setChainIdA(Number.parseInt(hex, 16));
          }) as (...args: never[]) => void
        );
      } catch (e) {
        setWalletError(e instanceof Error ? e.message : String(e));
      }
    },
    [journal]
  );

  const disconnectA = useCallback(() => {
    providerRef.current = null;
    setConnected(null);
    setAccountA(null);
    setChainIdA(null);
    journal.emit("wallet.account", "wallet disconnected");
  }, [journal]);

  const importKey = useCallback(
    async (privateKeyHex: string, passphrase: string | null) => {
      const hex = privateKeyHex.trim();
      if (!PRIV_RE.test(hex)) throw new Error("not a private key (expected 0x + 64 hex chars)");
      const account = privateKeyToAccount(hex as `0x${string}`);
      if (passphrase !== null) {
        const record = await encryptKey(hex, passphrase);
        record.address = account.address;
        await vault.set(record);
        setHasVault(true);
        setVaultAddress(account.address);
      }
      accountRef.current = account;
      setUnlocked(true);
      setAccountB(account.address);
      setMemoryOnly(passphrase === null);
      setModeState("B");
      setYolo(false);
      try {
        window.localStorage.setItem(MODE_KEY, "B");
      } catch {
        /* ignore */
      }
      journal.emit("wallet.account", `key ${passphrase === null ? "loaded in memory" : "stored encrypted"} · ${account.address}`);
    },
    [vault, journal]
  );

  const unlockVault = useCallback(
    async (passphrase: string) => {
      const record = await vault.get();
      if (!record) throw new Error("no stored key");
      const hex = await decryptKey(record, passphrase);
      const account = privateKeyToAccount(hex as `0x${string}`);
      accountRef.current = account;
      setUnlocked(true);
      setAccountB(account.address);
      setMemoryOnly(false);
      journal.emit("wallet.account", `vault unlocked · ${account.address}`);
    },
    [vault, journal]
  );

  const deleteVault = useCallback(async () => {
    await vault.delete();
    setHasVault(false);
    setVaultAddress(null);
    lock();
  }, [vault, lock]);

  const enterYolo = useCallback(
    (confirmText: string) => {
      if (!unlocked) return false;
      if (confirmText !== "DANGERS") return false;
      setYolo(true);
      setModeState("C");
      journal.emit("wallet.mode", "YOLO mode entered — per-action approval OFF, policy bounds remain");
      return true;
    },
    [unlocked, journal]
  );

  const exitYolo = useCallback(() => {
    setYolo(false);
    setModeState("B");
    journal.emit("wallet.mode", "yolo exited — back to mode B");
  }, [journal]);

  // distinct visual state while in C (DESIGN.md)
  useEffect(() => {
    document.body.classList.toggle("yolo", yolo);
    return () => document.body.classList.remove("yolo");
  }, [yolo]);

  const buildSigner = useCallback((): GateSigner | null => {
    if (mode === "A") {
      const provider = providerRef.current;
      if (!provider || !accountA) return null;
      const client: WalletClient = createWalletClient({
        account: accountA,
        chain: pulsechain,
        transport: custom(provider),
      });
      return {
        mode: "A",
        account: accountA,
        sendTransaction: async (args) =>
          client.sendTransaction({
            to: args.to,
            data: args.data,
            value: args.value ?? undefined,
            gas: args.gas ?? undefined,
            account: accountA,
            chain: pulsechain,
          }),
      };
    }
    const account = accountRef.current;
    if (!account) return null;
    const client = createWalletClient({
      account,
      chain: pulsechain,
      transport: http(rpcRef.current),
    });
    return {
      mode,
      account: account.address,
      sendTransaction: async (args) =>
        client.sendTransaction({
          to: args.to,
          data: args.data,
          value: args.value ?? undefined,
          gas: args.gas ?? undefined,
          account,
          chain: pulsechain,
        }),
    };
  }, [mode, accountA]);

  const account = mode === "A" ? accountA : accountB;

  const api: WalletApi = {
    mode,
    providers,
    connected,
    accountA,
    chainIdA,
    walletError,
    hasVault,
    vaultAddress,
    unlocked,
    accountB,
    memoryOnly,
    yolo,
    account,
    connectProvider,
    disconnectA,
    importKey,
    unlockVault,
    lock,
    deleteVault,
    enterYolo,
    exitYolo,
    setMode,
    buildSigner,
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
