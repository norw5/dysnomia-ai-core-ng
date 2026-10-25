import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeFunctionResult, encodeFunctionData, formatUnits, type Address, type PublicClient } from "viem";
import { makeClient } from "@/chain/client";
import { addr, MULTICALL3 } from "@config/addresses";

/**
 * The per-turn player-state snapshot (IA-PLAN §7.6 — the identity subset,
 * session-41): wallet/LAU/YUE addresses, onboarding flags, PLS + AFFECTION +
 * CHOA balances across wallet/LAU/YUE. Code-computed through ONE Multicall3
 * `aggregate3` batch per round, ANONYMOUS reads only (`from=` never set —
 * the V2-TT-echo lesson, IA-PLAN §9). This is what the agent deck injects
 * per-turn later; `toAgentPayload` is the capped form.
 *
 * Discovery semantics (all deployed, kb §1/§4 + harness-proven):
 *  - LAU  = CHO.GetUserTokenAddress(wallet)
 *  - YUE  = CHAN.Yan(wallet)
 *  - Username: LAU.Username() REVERTS while unset (attribute-lib gate) —
 *    a failed read inside the batch means "unset", not an error.
 */

const erc20BalanceAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const mc3Abi = [
  { type: "function", name: "getEthBalance", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const choAbi = [
  { type: "function", name: "GetUserTokenAddress", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "address" }] },
] as const;
const chanAbi = [
  { type: "function", name: "Yan", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "address" }] },
] as const;
const lauAbi = [
  { type: "function", name: "Username", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;
const yueAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "Origin", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export interface TriBalance {
  wallet: bigint;
  lau: bigint;
  yue: bigint;
}

export interface PlayerSnapshot {
  account: Address;
  lau: Address | null;
  yue: Address | null;
  lauName: string | null;
  lauSymbol: string | null;
  /** null = unset (the onchain view reverts until first set — expected, not an error) */
  username: string | null;
  yueName: string | null;
  yueSymbol: string | null;
  balances: { pls: TriBalance; affection: TriBalance; choa: TriBalance };
  /** CHOA Yuan = wallet + 10×LAU + 40×YUE holdings (deployed formula, 02_choa.sol:28-33) */
  yuanChoa: bigint;
  blockNumber: bigint | null;
  fetchedAt: number;
}

type MulticallResult<T> = { status: "success"; result: T } | { status: "failure"; error: Error };

function ok<T>(r: MulticallResult<T>): T | null {
  return r.status === "success" ? r.result : null;
}

/**
 * viem wraps TRANSPORT failures (dead RPC) as per-call failures inside
 * multicall-allowFailure — a snapshot rendered from them would look like
 * "owns nothing" instead of "unreadable". The honesty rule: round-1 reads
 * can never legitimately revert onchain, so ANY failure there is fatal; a
 * round-2 all-fail is fatal too (only LAU.Username() may revert, and only
 * while unset — never alongside name()/symbol() also failing).
 */
function failFast(results: MulticallResult<unknown>[], round: string): void {
  if (results.length > 0 && results.every((r) => r.status === "failure")) {
    const err = (results[0] as { status: "failure"; error: Error }).error;
    throw new Error(`identity reads failed (${round}): ${err.message}`);
  }
}

function addrOrNull(a: string | null | undefined): Address | null {
  return a && a.toLowerCase() !== ZERO.toLowerCase() ? (a as Address) : null;
}

/** DIRECTORY live resolver (portal-v2 pattern): CHAN.Yan(wallet) → the wallet's YUE, null when none */
export async function readWalletYue(client: PublicClient, wallet: Address): Promise<Address | null> {
  const yue = (await client.readContract({ address: addr("CHAN"), abi: chanAbi, functionName: "Yan", args: [wallet] })) as string;
  return addrOrNull(yue);
}

/**
 * The live wallet→LAU discovery (session-64.1): the same read the snapshot
 * round-1 carries, exposed for callers that must NOT trust a frozen
 * snapshot — the plan runner executes its whole checklist with ONE ctx, so
 * a step after `register` sends still sees the stale pre-Play snapshot.
 */
export async function readWalletLau(client: PublicClient, wallet: Address): Promise<Address | null> {
  const lau = (await client.readContract({ address: addr("CHO"), abi: choAbi, functionName: "GetUserTokenAddress", args: [wallet] })) as string;
  return addrOrNull(lau);
}

export async function loadPlayerSnapshot(client: PublicClient, account: Address): Promise<PlayerSnapshot> {
  const empty: TriBalance = { wallet: 0n, lau: 0n, yue: 0n };
  // round 1 — discovery + wallet-side balances (anonymous: no `from` anywhere)
  const r1 = (await client.multicall({
    allowFailure: true,
    contracts: [
      { address: addr("CHO"), abi: choAbi, functionName: "GetUserTokenAddress", args: [account] },
      { address: addr("CHAN"), abi: chanAbi, functionName: "Yan", args: [account] },
      { address: MULTICALL3, abi: mc3Abi, functionName: "getEthBalance", args: [account] },
      { address: addr("AFFECTION"), abi: erc20BalanceAbi, functionName: "balanceOf", args: [account] },
      { address: addr("CHOA"), abi: erc20BalanceAbi, functionName: "balanceOf", args: [account] },
    ],
  })) as MulticallResult<unknown>[];
  failFast(r1, "discovery");
  for (const r of r1) {
    if (r.status === "failure") {
      throw new Error(`identity read failed (discovery): ${r.error.message}`);
    }
  }

  const lau = addrOrNull(ok<string>(r1[0]! as MulticallResult<string>));
  const yue = addrOrNull(ok<string>(r1[1]! as MulticallResult<string>));
  const plsWallet = ok<bigint>(r1[2]! as MulticallResult<bigint>) ?? 0n;
  const aWallet = ok<bigint>(r1[3]! as MulticallResult<bigint>) ?? 0n;
  const cWallet = ok<bigint>(r1[4]! as MulticallResult<bigint>) ?? 0n;

  let pls = { ...empty, wallet: plsWallet };
  let affection = { ...empty, wallet: aWallet };
  let choa = { ...empty, wallet: cWallet };
  let username: string | null = null;
  let lauName: string | null = null;
  let lauSymbol: string | null = null;
  let yueName: string | null = null;
  let yueSymbol: string | null = null;

  // round 2 — per-entity detail, only for what exists
  const lauCalls = lau
    ? [
        { address: lau, abi: lauAbi, functionName: "Username", args: [] as const },
        { address: lau, abi: lauAbi, functionName: "name", args: [] as const },
        { address: lau, abi: lauAbi, functionName: "symbol", args: [] as const },
        { address: MULTICALL3, abi: mc3Abi, functionName: "getEthBalance", args: [lau] as const },
        { address: addr("AFFECTION"), abi: erc20BalanceAbi, functionName: "balanceOf", args: [lau] as const },
        { address: addr("CHOA"), abi: erc20BalanceAbi, functionName: "balanceOf", args: [lau] as const },
      ]
    : [];
  const yueCalls = yue
    ? [
        { address: yue, abi: yueAbi, functionName: "name", args: [] as const },
        { address: yue, abi: yueAbi, functionName: "symbol", args: [] as const },
        { address: MULTICALL3, abi: mc3Abi, functionName: "getEthBalance", args: [yue] as const },
        { address: addr("AFFECTION"), abi: erc20BalanceAbi, functionName: "balanceOf", args: [yue] as const },
        { address: addr("CHOA"), abi: erc20BalanceAbi, functionName: "balanceOf", args: [yue] as const },
      ]
    : [];
  const calls = [...lauCalls, ...yueCalls];
  if (calls.length > 0) {
    const r2 = (await client.multicall({ allowFailure: true, contracts: calls })) as MulticallResult<unknown>[];
    failFast(r2, "detail");
    let i = 0;
    if (lau) {
      // Username() reverts while unset — the failure IS the "unset" answer
      username = ok<string>(r2[i]! as MulticallResult<string>) ?? null;
      lauName = ok<string>(r2[i + 1]! as MulticallResult<string>) ?? null;
      lauSymbol = ok<string>(r2[i + 2]! as MulticallResult<string>) ?? null;
      pls.lau = ok<bigint>(r2[i + 3]! as MulticallResult<bigint>) ?? 0n;
      affection.lau = ok<bigint>(r2[i + 4]! as MulticallResult<bigint>) ?? 0n;
      choa.lau = ok<bigint>(r2[i + 5]! as MulticallResult<bigint>) ?? 0n;
      i += 6;
    }
    if (yue) {
      yueName = ok<string>(r2[i]! as MulticallResult<string>) ?? null;
      yueSymbol = ok<string>(r2[i + 1]! as MulticallResult<string>) ?? null;
      pls.yue = ok<bigint>(r2[i + 2]! as MulticallResult<bigint>) ?? 0n;
      affection.yue = ok<bigint>(r2[i + 3]! as MulticallResult<bigint>) ?? 0n;
      choa.yue = ok<bigint>(r2[i + 4]! as MulticallResult<bigint>) ?? 0n;
    }
  }

  const yuanChoa = choa.wallet + 10n * choa.lau + 40n * choa.yue;
  const blockNumber = await client.getBlockNumber().catch(() => null);
  return {
    account,
    lau,
    yue,
    lauName,
    lauSymbol,
    username,
    yueName,
    yueSymbol,
    balances: { pls, affection, choa },
    yuanChoa,
    blockNumber,
    fetchedAt: Date.now(),
  };
}

/**
 * The guided onboarding chain (IA-PLAN §6 form; the same chain the harness
 * asserts). Session-64: the FOUR-step chain — LAU → Username → YUE →
 * register (CHOA.Play writes the wallet→LAU mapping the discovery reads).
 * `pending` = the receipt-carried pre-registration LAU (state/pendingLau):
 * the LAU step completes on pending-OR-registered, the register step only
 * on registration (snapshot.lau resolved).
 *
 * Session-65: the OPTIONAL fifth step — the home QING (MAP.New on your own
 * LAU; owner round: recommended YES, still optional — it is a one-way
 * planet-wide claim). `home` = the app's captured record exists
 * (state/homeVenue; MAP has no asset→QING getter, so capture-at-create is
 * the only truth the app can hold). Optional steps never block "chain
 * complete" — callers skip them when picking the next blocking step.
 */
export interface OnboardingStep {
  id: "wallet" | "lau" | "username" | "yue" | "register" | "qing";
  label: string;
  hint: string;
  done: boolean;
  /** true = shown + listed but never blocking (the optional home-QING step) */
  optional?: boolean;
}

export function onboardingSteps(account: Address | null, s: PlayerSnapshot | null, pending: Address | null = null, home = false): OnboardingStep[] {
  return [
    {
      id: "wallet",
      label: "connect an account",
      hint: "key mode A (browser wallet) or B (key) — SETTINGS → wallet",
      done: account !== null,
    },
    {
      id: "lau",
      label: "create your LAU — the account token that carries your name into the world",
      hint: "LAUFactory.New(name, symbol); it can hold tokens and pay them back out",
      done: s !== null && s.lau !== null ? true : pending !== null,
    },
    {
      id: "username",
      label: "set your Username (≤ 12 bytes) — what the world sees on your chat lines",
      hint: "LAU.Username(string); the chat paths need it before they let you speak",
      done: s !== null && s.username !== null,
    },
    {
      id: "yue",
      label: "open your YUE — the account-vault that holds what the world pays you",
      hint: "SEI.Start(LAU, name, symbol); one vault per wallet, renames by calling Start again",
      done: s !== null && s.yue !== null,
    },
    {
      id: "register",
      label: "register — write your wallet→LAU mapping into the world",
      hint: "CHOA.Play(LAU) — the registrar the app's discovery reads; needs Username + YUE; the last onboarding step",
      done: s !== null && s.lau !== null,
    },
    {
      id: "qing",
      label: "optional — make yourself at home: wrap your LAU into your home QING",
      hint: "MAP.New(your LAU) — gas only, ONE venue per asset EVER planet-wide; unlocks the deed (the venue wraps your own account token) and a natural Beat target",
      done: home,
      optional: true,
    },
  ];
}

/** hard cap for the per-turn agent payload (IA-PLAN §7.6: ~1.5KB) */
export const AGENT_PAYLOAD_CAP = 1536;

const w = (v: bigint): string => v.toString();

/** Capped compact form — this is what the agent deck will inject per turn. */
export function toAgentPayload(s: PlayerSnapshot): Record<string, unknown> {
  return {
    v: 1,
    acct: s.account,
    lau: s.lau,
    yue: s.yue,
    user: s.username,
    lauSym: s.lauSymbol,
    pls: [w(s.balances.pls.wallet), w(s.balances.pls.lau), w(s.balances.pls.yue)],
    a: [w(s.balances.affection.wallet), w(s.balances.affection.lau), w(s.balances.affection.yue)],
    choa: [w(s.balances.choa.wallet), w(s.balances.choa.lau), w(s.balances.choa.yue)],
    yuanChoa: w(s.yuanChoa),
    blk: s.blockNumber !== null ? s.blockNumber.toString() : null,
  };
}

export function agentPayloadSize(s: PlayerSnapshot): number {
  return JSON.stringify(toAgentPayload(s)).length;
}

/** attribute.sol pins Username at 12 BYTES (addAttribute("Username", 12)) — not 12 chars. */
export const USERNAME_MAX_BYTES = 12;

// ---- your recorded moment (RING.Moments — session-50 venue depth, B1.2) ----

const getUserSoulAbi = [
  // view but tx.origin-keyed (01_cho.sol:130) — read as a SIMULATED call from the account
  { type: "function", name: "GetUserSoul", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
] as const;
const momentsAbi = [
  // RING.Moments(soul) — cheap public view of the last recorded moment per soul (kb/dev ring.md)
  { type: "function", name: "Moments", stateMutability: "view", inputs: [{ name: "soul", type: "uint64" }], outputs: [{ type: "uint256" }] },
] as const;

export interface PlayerMoment {
  soul: bigint;
  /** the recorded Iota — zero means "no moment recorded yet" (a real state, not an error) */
  iota: bigint;
}

/** the not-entered class: GetUserSoul reverts UserNotEntered while the wallet has no delegate */
export function isUserNotEnteredError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("UserNotEntered");
}

/**
 * Your moment line for the identity profile: CHO.GetUserSoul (simulated
 * from the account — tx.origin-keyed) then RING.Moments(soul) (anonymous
 * view). The moment is REFRESHED by each RING.Eta() call — a tiny per-player
 * monument, not a live oracle.
 */
export async function readPlayerMoment(client: PublicClient, account: Address): Promise<PlayerMoment> {
  const soulData = encodeFunctionData({ abi: getUserSoulAbi, functionName: "GetUserSoul" });
  const rawSoul = await client.call({ to: addr("CHO"), data: soulData, account });
  const soul = decodeFunctionResult({
    abi: getUserSoulAbi,
    functionName: "GetUserSoul",
    data: typeof rawSoul === "string" ? (rawSoul as `0x${string}`) : ((rawSoul as { data: `0x${string}` }).data),
  }) as unknown as bigint;
  const iota = (await client.readContract({
    address: addr("RING"),
    abi: momentsAbi,
    functionName: "Moments",
    args: [soul],
  })) as bigint;
  return { soul, iota };
}

// ---- your birth record (session-53 identity enrichment, IA-REEVAL-49 B1.7) ----

const baoComponents = [
  { name: "Phi", type: "address" },
  { name: "Mu", type: "address" },
  { name: "Xi", type: "uint64" },
  { name: "Pi", type: "uint64" },
  { name: "Shio", type: "address" },
  { name: "Ring", type: "uint64" },
  { name: "Omicron", type: "uint64" },
  { name: "Omega", type: "uint64" },
] as const;

const lauBirthAbi = [
  // Bao public On — the universal entity record (include/bao.sol)
  { type: "function", name: "On", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "tuple", components: baoComponents }] },
  // uint64[3] public Saat — the id triple, set once at birth by SIU.Miu
  { type: "function", name: "Saat", stateMutability: "view", inputs: [{ name: "i", type: "uint256" }], outputs: [{ type: "uint64" }] },
] as const;
const siuAuraAbi = [
  // view but tx.origin-keyed (09_siu.sol:27-29) — read as a SIMULATED call from the account
  { type: "function", name: "Aura", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
] as const;
const shioEndsAbi = [
  { type: "function", name: "Rod", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "Cone", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export interface PlayerBao {
  /** the entity key — the Bao's anchor (for a user: their channel's address) */
  phi: Address | null;
  /** the Rod SHA address */
  mu: Address | null;
  xi: bigint | null;
  pi: bigint | null;
  /** the user's own channel */
  shio: Address | null;
  ring: bigint | null;
  omicron: bigint | null;
  omega: bigint | null;
}

export interface PlayerBirth {
  /** the Saat triple (kb/dev/lau.md §4): [0] Pole state at generation, [1] Soul, [2] Aura at birth */
  saat: { pole: bigint; soul: bigint; aura: bigint };
  bao: PlayerBao;
  /** SIU.Aura() simulated from the connected wallet — the live fingerprint vs the birth record */
  auraNow: bigint | null;
  /** the user's channel's SHA pair (Rod/Cone read on the Bao's Shio) */
  rod: Address | null;
  cone: Address | null;
  blockNumber: bigint | null;
  fetchedAt: number;
}

function addrOrZero(a: string | null | undefined): Address | null {
  return addrOrNull(a);
}

/**
 * Your birth record for the identity profile: LAU.On()/Saat(i) (anonymous
 * views on the LAU) + SIU.Aura() (tx.origin-keyed — SIMULATED from the
 * account, the GetUserSoul discipline) + the channel's Rod/Cone pair
 * (second anonymous batch on On.Shio — the DIRECTORY SHIO wiring, reused).
 */
export async function readPlayerBirth(client: PublicClient, account: Address, lau: Address): Promise<PlayerBirth> {
  const r1 = (await client.multicall({
    allowFailure: true,
    contracts: [
      { address: lau, abi: lauBirthAbi, functionName: "On", args: [] as const },
      { address: lau, abi: lauBirthAbi, functionName: "Saat", args: [0n] as const },
      { address: lau, abi: lauBirthAbi, functionName: "Saat", args: [1n] as const },
      { address: lau, abi: lauBirthAbi, functionName: "Saat", args: [2n] as const },
    ],
  })) as MulticallResult<unknown>[];
  if (r1.length > 0 && r1.every((r) => r.status === "failure")) {
    const err = (r1[0] as { status: "failure"; error: Error }).error;
    throw new Error(`birth reads failed (batch): ${err.message}`);
  }
  const baoRaw = ok<{ Phi: string; Mu: string; Xi: bigint; Pi: bigint; Shio: string; Ring: bigint; Omicron: bigint; Omega: bigint }>(
    r1[0] as MulticallResult<{ Phi: string; Mu: string; Xi: bigint; Pi: bigint; Shio: string; Ring: bigint; Omicron: bigint; Omega: bigint }>,
  );
  const bao: PlayerBao = {
    phi: baoRaw ? addrOrZero(baoRaw.Phi) : null,
    mu: baoRaw ? addrOrZero(baoRaw.Mu) : null,
    xi: baoRaw ? baoRaw.Xi : null,
    pi: baoRaw ? baoRaw.Pi : null,
    shio: baoRaw ? addrOrZero(baoRaw.Shio) : null,
    ring: baoRaw ? baoRaw.Ring : null,
    omicron: baoRaw ? baoRaw.Omicron : null,
    omega: baoRaw ? baoRaw.Omega : null,
  };
  const saat = {
    pole: ok<bigint>(r1[1] as MulticallResult<bigint>) ?? 0n,
    soul: ok<bigint>(r1[2] as MulticallResult<bigint>) ?? 0n,
    aura: ok<bigint>(r1[3] as MulticallResult<bigint>) ?? 0n,
  };

  // the channel's SHA pair — anonymous batch on the Bao's Shio (DIRECTORY SHIO wiring)
  let rod: Address | null = null;
  let cone: Address | null = null;
  if (bao.shio !== null) {
    const r2 = (await client.multicall({
      allowFailure: true,
      contracts: [
        { address: bao.shio, abi: shioEndsAbi, functionName: "Rod", args: [] as const },
        { address: bao.shio, abi: shioEndsAbi, functionName: "Cone", args: [] as const },
      ],
    })) as MulticallResult<unknown>[];
    rod = ok<Address>(r2[0] as MulticallResult<Address>);
    cone = ok<Address>(r2[1] as MulticallResult<Address>);
  }

  // SIU.Aura() — tx.origin-keyed view, simulated from the account
  const auraNow = (await client
    .readContract({ address: addr("SIU"), abi: siuAuraAbi, functionName: "Aura", account })
    .catch(() => null)) as bigint | null;

  const blockNumber = await client.getBlockNumber().catch(() => null);
  return { saat, bao, auraNow, rod, cone, blockNumber, fetchedAt: Date.now() };
}

// ---- your label for a venue (VOID.Alias — session-53, B1.7 read leg) ----

const voidAliasReadAbi = [
  // public view, tx.origin-keyed (delegates to libattribute with the caller's Soul)
  { type: "function", name: "Alias", stateMutability: "view", inputs: [{ name: "name", type: "address" }], outputs: [{ type: "string" }] },
] as const;

export type VenueLabel = { label: string } | "unset" | "not-entered" | "unreadable";

/**
 * Your private label for an address (typically the current venue). SEMANTICS
 * (10_void.sol:95-103 + attribute.sol:47-57, source-read + fork-pinned
 * session-53): VOID's session table `_activeUsers` is keyed by MSG.SENDER —
 * and the entry is written by `Enter`, which the LAU constructor calls — so
 * the session lives AT THE LAU CONTRACT ADDRESS, never at the wallet. The
 * read is therefore simulated from the LAU (`from=lau`). The VIEW has NO
 * session gate of its own (it passes the soul straight through), and the
 * attribute lib's view REVERTS `AliasNotFound` while no label is set — the
 * failure IS the answer (Username discipline).
 */
export async function readVenueLabel(client: PublicClient, lau: Address, target: Address): Promise<VenueLabel> {
  try {
    const label = (await client.readContract({
      address: addr("VOID"),
      abi: voidAliasReadAbi,
      functionName: "Alias",
      args: [target],
      account: lau,
    })) as string;
    return { label };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("AliasNotFound")) return "unset";
    // NoUserEntry lives only on the WRITE (the view has no session gate) —
    // the branch is defensive, kept for chain-state honesty
    if (msg.includes("NoUserEntry")) return "not-entered";
    return "unreadable";
  }
}

export function usernameError(value: string): string | null {
  const bytes = new TextEncoder().encode(value).length;
  if (bytes === 0) return "empty";
  if (bytes > USERNAME_MAX_BYTES) return `${bytes} bytes > ${USERNAME_MAX_BYTES} (MaximumLength revert — Username is capped at 12 bytes onchain)`;
  return null;
}

export function fmtAmt(v: bigint, decimals = 18, digits = 4): string {
  if (v === 0n) return "0";
  const s = formatUnits(v, decimals);
  const parts = s.split(".");
  const int = parts[0] ?? "0";
  const frac = parts.length > 1 ? (parts[1] ?? "") : "";
  if (frac.length === 0) return int;
  const cut = frac.slice(0, digits);
  const trimmed = cut.replace(/0+$/, "");
  return trimmed.length === 0 ? int : `${int}.${trimmed}`;
}

export interface PlayerSnapshotState {
  snapshot: PlayerSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function usePlayerSnapshot(rpcUrl: string, account: Address | null): PlayerSnapshotState {
  const client = useMemo(() => makeClient(rpcUrl), [rpcUrl]);
  const [snapshot, setSnapshot] = useState<PlayerSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!account) {
      setSnapshot(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadPlayerSnapshot(client, account)
      .then((s) => {
        if (!cancelled && alive.current) setSnapshot(s);
      })
      .catch((e: unknown) => {
        if (!cancelled && alive.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled && alive.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, account, tick]);

  // quiet periodic refresh (12s, matches the chain-state poll cadence)
  useEffect(() => {
    if (!account) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 12_000);
    return () => window.clearInterval(t);
  }, [account]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { snapshot, loading, error, refresh };
}
