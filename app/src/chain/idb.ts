/**
 * Shared IndexedDB opener — the ONE schema definition. Both the journal and
 * the key vault open the same "dysnomia" DB; whichever opens first runs the
 * upgrade and must create EVERY store (the other's onupgradeneeded never runs
 * at the same version).
 */

export const DB_NAME = "dysnomia";
/** v3 (session-70): the sync-engine `sync` store joins journal + keystore + runs */
export const DB_VERSION = 3;
/** store name → keyPath (undefined = out-of-line keys) */
export const DB_STORES = { journal: "id", keystore: undefined, runs: "id", sync: "id" } as const;

export function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [store, keyPath] of Object.entries(DB_STORES)) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, keyPath !== undefined ? { keyPath } : undefined);
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
