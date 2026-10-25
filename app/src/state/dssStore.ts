import { useSyncExternalStore } from "react";
import type { Address } from "viem";

/**
 * The DSS store (session-66): the self-snipe bundler a player DEPLOYED
 * through the app's desk. The DSS exposes no getter of any kind (no
 * owner(), no bound-LAU view) and no registry exists — so the app carries
 * the address the way it carries the home QING: captured at the creating
 * SEND (the creation receipt's contractAddress) and persisted per
 * account. A DSS deployed by another frontend or wallet reads as "not
 * deployed" here — capture-at-deploy only (the home-QING capture law).
 */

const KEY = "dys.dss.v1";

export interface DssRecord {
  /** the deployed DSS (creation receipt decode) */
  dss: Address;
  /** the LAU it was bound to at construction (the desk binds YOUR LAU) */
  lau: Address;
  txHash: string | null;
  t: number;
}

type DssMap = Record<string, DssRecord>;

function load(): DssMap {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DssMap;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

let records: DssMap = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* storage unavailable */
  }
}

function notify(): void {
  for (const fn of listeners) fn();
}

function keyOf(account: Address): string {
  return account.toLowerCase();
}

export function dssOf(account: Address | null): DssRecord | null {
  if (account === null) return null;
  return records[keyOf(account)] ?? null;
}

/**
 * Record the deployed DSS. Only called when the creation receipt landed
 * (the address is the receipt's contractAddress — the chain's own answer).
 */
export function setDss(account: Address, record: Omit<DssRecord, "t">): void {
  const k = keyOf(account);
  const prev = records[k];
  if (prev !== undefined && prev.dss.toLowerCase() === record.dss.toLowerCase()) return;
  records = { ...records, [k]: { ...record, t: Date.now() } };
  persist();
  notify();
}

export function dssSnapshot(): DssMap {
  return records;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const subscribeDss = subscribe;

export function useDss(account: Address | null): DssRecord | null {
  const value = useSyncExternalStore(subscribeDss, dssSnapshot, dssSnapshot);
  return account !== null ? (value[account.toLowerCase()] ?? null) : null;
}

/** test seam — restore a clean slate between rows */
export function resetDssForTests(): void {
  records = {};
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
  notify();
}
