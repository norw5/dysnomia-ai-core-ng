import { openDb } from "@/chain/idb";

/**
 * The gate's observability spine (IA-PLAN §7.9): every gate decision, sim,
 * approval, send, receipt, decode lands here. In-memory bus + best-effort
 * IndexedDB persistence (runs/journal survive reloads; never key material).
 */

export type JournalKind =
  | "gate.request"
  | "gate.policy"
  | "gate.sim"
  | "gate.approval"
  | "gate.send"
  | "gate.receipt"
  | "gate.error"
  | "gate.token-cap"
  | "wallet.mode"
  | "wallet.account"
  | "agent.turn"
  | "agent.tool"
  | "agent.deck"
  | "agent.spend"
  | "agent.error"
  | "agent.abort"
  | "agent.plan";

export interface JournalEvent {
  id: number;
  t: number;
  kind: JournalKind;
  /** short human line for the event feed */
  line: string;
  /** structured detail (never secrets) */
  detail?: Record<string, unknown>;
}

export interface Journal {
  subscribe(fn: (e: JournalEvent) => void): () => void;
  snapshot(): readonly JournalEvent[];
  emit(kind: JournalKind, line: string, detail?: Record<string, unknown>): JournalEvent;
  wipe(): Promise<void>;
}

type Listener = (e: JournalEvent) => void;

const STORE = "journal";
const MAX_PERSISTED = 500;

export class JournalBus implements Journal {
  private listeners = new Set<Listener>();
  private nextId = 1;
  private evts: JournalEvent[] = [];
  private db: IDBDatabase | null = null;
  private dbReady: Promise<void>;

  constructor() {
    this.dbReady = openDb().then((db) => {
      this.db = db;
    });
  }

  async loadRecent(): Promise<JournalEvent[]> {
    await this.dbReady;
    if (!this.db) return [];
    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => {
          const rows = (req.result as JournalEvent[]).sort((a, b) => a.id - b.id);
          for (const r of rows.slice(-100)) {
            this.evts.push(r);
            this.nextId = Math.max(this.nextId, r.id + 1);
          }
          resolve(rows);
        };
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  emit(kind: JournalKind, line: string, detail?: Record<string, unknown>): JournalEvent {
    const base = { id: this.nextId++, t: Date.now(), kind, line };
    const e: JournalEvent = detail === undefined ? base : { ...base, detail };
    this.evts.push(e);
    if (this.evts.length > 300) this.evts.splice(0, this.evts.length - 300);
    for (const fn of this.listeners) fn(e);
    void this.persist(e);
    return e;
  }

  private async persist(e: JournalEvent): Promise<void> {
    await this.dbReady;
    if (!this.db) return;
    try {
      const tx = this.db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.put(e);
      const countReq = store.count();
      countReq.onsuccess = () => {
        if (countReq.result > MAX_PERSISTED) {
          // trim oldest
          const cursorReq = store.openCursor(null, "next");
          let toDelete = countReq.result - MAX_PERSISTED;
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor && toDelete > 0) {
              cursor.delete();
              toDelete -= 1;
              cursor.continue();
            }
          };
        }
      };
    } catch {
      /* persistence is best-effort */
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): readonly JournalEvent[] {
    return this.evts;
  }

  async wipe(): Promise<void> {
    this.evts = [];
    await this.dbReady;
    if (!this.db) return;
    try {
      this.db.transaction(STORE, "readwrite").objectStore(STORE).clear();
    } catch {
      /* best-effort */
    }
  }
}
