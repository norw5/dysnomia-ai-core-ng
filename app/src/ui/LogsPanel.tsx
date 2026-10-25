import { useEffect, useState } from "react";
import type { Journal, JournalEvent } from "@/chain/journal";

/**
 * SYSTEM_LOGS panel (chrome parity, session-42): the predecessor
 * TerminalLog idiom over the gate journal — typed left-border rows,
 * colored type labels, expandable data. This is the same event stream the
 * old LOGS toggle showed (every gate decision / sim / approval / send /
 * receipt), now fed by the ONE gate.
 */

type LogType = "ERROR" | "SUCCESS" | "GATE" | "WALLET" | "INFO";

function classify(e: JournalEvent): LogType {
  const kind = e.kind.toLowerCase();
  if (kind.includes("error")) return "ERROR";
  if (kind.includes("receipt") || kind.includes("token-cap")) return "SUCCESS";
  if (kind.startsWith("gate.")) return "GATE";
  if (kind.startsWith("wallet.")) return "WALLET";
  return "INFO";
}

export function LogsPanel({ journal }: { journal: Journal }) {
  const [events, setEvents] = useState<JournalEvent[]>(() => [...journal.snapshot()].reverse());

  useEffect(() => {
    const off = journal.subscribe((e) => {
      setEvents((prev) => [e, ...prev].slice(0, 200));
    });
    return off;
  }, [journal]);

  return (
    <div className="logs-pane" data-testid="logs-panel">
      <div className="logs-head">
        <span>SYSTEM_LOGS</span>
        <button
          className="dock-btn"
          onClick={() => {
            void journal.wipe();
            setEvents([]);
          }}
          data-testid="logs-wipe"
        >
          wipe
        </button>
      </div>
      <ul className="tlog" data-testid="event-feed">
        {events.length === 0 && <li className="tlog-empty">SYSTEM IDLE</li>}
        {events.map((e) => {
          const type = classify(e);
          const data = e.detail !== undefined ? JSON.stringify(e.detail, null, 2) : null;
          return (
            <li key={e.id} className={`tlog-item type-${type.toLowerCase()}`}>
              <div className="tlog-top">
                <span>{new Date(e.t).toLocaleTimeString()}</span>
                <span className="tlog-type">
                  {type}/{e.kind}
                </span>
              </div>
              <span className="tlog-msg">{e.line}</span>
              {data !== null && data !== "{}" && <div className="tlog-data">{data}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
