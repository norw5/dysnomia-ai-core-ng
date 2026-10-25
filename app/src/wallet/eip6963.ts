/**
 * EIP-6963 multi-wallet discovery (mode A). Wallets announce on
 * `eip6963:announceProvider` in response to our `eip6963:requestProvider`
 * dispatch; we keep a deduped list by rdns.
 */

export interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
}

export interface Eip6963AnnounceDetail {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
}

const announced = new Map<string, Eip6963AnnounceDetail>();
const listeners = new Set<(list: Eip6963AnnounceDetail[]) => void>();

function isWindowLike(w: unknown): w is Window {
  return typeof w === "object" && w !== null && "dispatchEvent" in w && "addEventListener" in w;
}

/** call once at app boot (and again to re-probe late-announcing wallets) */
export function discoverProviders(): void {
  if (!isWindowLike(globalThis)) return;
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<Eip6963AnnounceDetail>).detail;
    if (!detail?.info?.rdns || announced.has(detail.info.rdns)) return;
    announced.set(detail.info.rdns, detail);
    for (const fn of listeners) fn([...announced.values()]);
  };
  globalThis.addEventListener("eip6963:announceProvider", handler as EventListener);
  globalThis.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function providerList(): Eip6963AnnounceDetail[] {
  return [...announced.values()];
}

export function subscribeProviders(fn: (list: Eip6963AnnounceDetail[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
