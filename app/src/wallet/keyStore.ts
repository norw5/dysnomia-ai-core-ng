/**
 * Mode B key storage (IA-PLAN §7.2): the private key is EITHER live in memory
 * only, OR passphrase-encrypted at rest — WebCrypto AES-GCM-256 with a
 * PBKDF2-SHA256 derived key, random salt + IV, ciphertext in IndexedDB.
 * The key NEVER touches localStorage or the journal. Unlock is per session;
 * auto-lock on inactivity lives in the wallet context.
 */

export interface KeyVaultRecord {
  v: 1;
  salt: string; // hex
  iv: string; // hex
  ct: string; // hex
  address: string; // checksummed, for identification only
  createdAt: number;
  iterations: number;
}

import { openDb } from "@/chain/idb";

export interface KvLike {
  get(): Promise<KeyVaultRecord | null>;
  set(record: KeyVaultRecord): Promise<void>;
  delete(): Promise<void>;
}

export const PBKDF2_ITERATIONS = 600_000;


function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto unavailable in this context");
  return c.subtle;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await subtle().importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptKey(
  privateKeyHex: string,
  passphrase: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<KeyVaultRecord> {
  if (passphrase.length < 8) throw new Error("passphrase too short (min 8 chars)");
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(salt);
  globalThis.crypto.getRandomValues(iv);
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(privateKeyHex)
  );
  return {
    v: 1,
    salt: hex(salt),
    iv: hex(iv),
    ct: hex(new Uint8Array(ct)),
    address: "",
    createdAt: Date.now(),
    iterations,
  };
}

export async function decryptKey(record: KeyVaultRecord, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, unhex(record.salt), record.iterations);
  try {
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: unhex(record.iv) as BufferSource },
      key,
      unhex(record.ct) as BufferSource
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("wrong passphrase (or corrupted vault)");
  }
}

/** IndexedDB-backed KV; degrades to null-store where IDB is unavailable (tests). */
export function idbVault(): KvLike {
  const STORE = "keystore";
  const KEY = "vault";
  return {
    async get() {
      const db = await openDb();
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
          req.onsuccess = () => resolve((req.result as KeyVaultRecord | undefined) ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    },
    async set(record) {
      const db = await openDb();
      if (!db) throw new Error("IndexedDB unavailable — use in-memory key instead");
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(record, KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error("vault write failed"));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },
    async delete() {
      const db = await openDb();
      if (!db) return;
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).delete(KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    },
  };
}
