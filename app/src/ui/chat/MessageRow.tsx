import { Fragment, memo } from "react";
import { EXPLORER_BASE } from "@config/addresses";
import { renderChatBody } from "@/ui/safeContent";
import { handleColor } from "@/ui/chat/handleColor";
import { ChatSigil } from "@/ui/chat/ChatSigil";
import { isSystemLine, type ViewLine } from "@/ui/chat/viewLine";
import type { ChatLayout } from "@/state/chatLayout";

/**
 * One chat message, two display layouts (session-71, the owner's 69.4
 * spec): IRC (the session-44 one-line idiom — default) and RICH (sigil
 * pfps, colored handles, soul ids, UTC timestamps, bubbles). The untrusted
 * BODY always renders through the §7.4 fence (renderChatBody — text +
 * DOMPurify-guarded http(s) out-links only, in BOTH layouts); the sigil +
 * handle button are OUR chrome and open the user pane. Soul 0 kernel lines
 * render as neutral system rows.
 *
 * Session-71.1: the row is HARD-MEMOIZED on its line's FIELDS (line object
 * references churn on every tail refresh — fields don't) so re-renders
 * (pane open/close, search typing, timestamps landing) touch only the rows
 * whose data actually changed. The whole corpus renders at once now —
 * render-all — so this memo is load-bearing.
 */

const TX_EXPLORER = EXPLORER_BASE.replace(/\/address\/$/, "/tx/");

function MessageRowImpl({
  line,
  layout,
  mine,
  showBoundary,
  time,
  onUser,
  timeRef,
}: {
  line: ViewLine;
  layout: ChatLayout;
  mine: boolean;
  /** the seed→live honesty divider renders above this row */
  showBoundary: boolean;
  /** resolved UTC seconds (null = unreadable, undefined = not fetched yet) */
  time: number | null | undefined;
  onUser: (l: ViewLine) => void;
  /** stable ref-callback registering the row for lazy timestamp fetches (rich only) */
  timeRef?: (el: HTMLElement | null) => (() => void) | undefined;
}) {
  const system = isSystemLine(line);
  const color = system ? undefined : handleColor(line.soul);
  return (
    <Fragment>
      {showBoundary && (
        <div className="chat-divider live-boundary" data-testid="chat-live-divider">
          ── LIVE TAIL · anonymous getLogs · seed archive ends above ──
        </div>
      )}
      {layout === "irc" ? (
        <div
          className={`chat-line${mine ? " mine" : ""}${system ? " system" : ""}`}
          data-testid="chat-line"
          data-source={line.source}
          data-line-id={line.id}
          data-block={line.block}
        >
          <span className="chat-blk" title={line.tx}>
            [{line.block.toLocaleString()}]
          </span>
          {!system && (
            <span className="chat-soul" style={{ color }} title={`Soul ${line.soul.toString()} · Aura ${line.aura.toString()}`}>
              #{line.soul.toString()}
            </span>
          )}
          {!system ? (
            <button
              className="chat-handle chat-handle-btn"
              style={{ color }}
              onClick={() => onUser(line)}
              title={`Soul ${line.soul.toString()} · Aura ${line.aura.toString()} — open the user overview`}
              data-testid="chat-line-handle"
            >
              {`${line.handle ?? "soul"}${mine ? " (you)" : ""}:`}
            </button>
          ) : (
            <span className="chat-handle">·</span>
          )}
          <span className="chat-body">{renderChatBody(line.body)}</span>
          <a
            className="chat-tx"
            href={`${TX_EXPLORER}${line.tx}`}
            target="_blank"
            rel="noreferrer noopener"
            title={`${line.tx} · log ${line.logIndex}`}
          >
            ↗
          </a>
        </div>
      ) : (
        <div
          className={`chat-line rich${mine ? " mine" : ""}${system ? " system" : ""}`}
          data-testid="chat-line"
          data-source={line.source}
          data-line-id={line.id}
          data-block={line.block}
          ref={timeRef}
        >
          <div className="chat-rich-head">
            <ChatSigil soul={line.soul} size={22} system={system} />
            {!system ? (
              <button
                className="chat-handle chat-handle-btn"
                style={{ color }}
                onClick={() => onUser(line)}
                title={`Soul ${line.soul.toString()} · Aura ${line.aura.toString()} — open the user overview`}
                data-testid="chat-line-handle"
              >
                {line.handle ?? "soul"}
                {mine ? " (you)" : ""}
              </button>
            ) : (
              <span className="chat-handle">system</span>
            )}
            {!system && (
              <span className="chat-rich-soul" style={{ color }}>
                #{line.soul.toString()}
              </span>
            )}
            <span
              className="chat-rich-time"
              title={
                time !== null && time !== undefined
                  ? `${new Date(time * 1000).toISOString()} · block ${line.block} · ${line.tx}`
                  : `block ${line.block} · ${line.tx}${time === null ? " · timestamp unreadable" : " · fetching timestamp…"}`
              }
              data-testid="chat-line-time"
            >
              {time !== null && time !== undefined ? `${formatUtcShort(time)}Z` : `blk ${line.block.toLocaleString()}`}
            </span>
            <a
              className="chat-tx"
              href={`${TX_EXPLORER}${line.tx}`}
              target="_blank"
              rel="noreferrer noopener"
              title={`${line.tx} · log ${line.logIndex} — explorer`}
            >
              ↗ explorer
            </a>
          </div>
          <div className={`chat-bubble${mine ? " mine" : ""}${system ? " system" : ""}`} data-testid="chat-line-bubble">
            {renderChatBody(line.body)}
          </div>
        </div>
      )}
    </Fragment>
  );
}

function sameLine(a: ViewLine, b: ViewLine): boolean {
  return (
    a.id === b.id &&
    a.block === b.block &&
    a.soul === b.soul &&
    a.aura === b.aura &&
    a.handle === b.handle &&
    a.body === b.body &&
    a.source === b.source
  );
}

export const MessageRow = memo(
  MessageRowImpl,
  (a, b) =>
    sameLine(a.line, b.line) &&
    a.layout === b.layout &&
    a.mine === b.mine &&
    a.showBoundary === b.showBoundary &&
    a.time === b.time &&
    a.onUser === b.onUser &&
    a.timeRef === b.timeRef
);

function formatUtcShort(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(5, 16).replace("T", " ");
}
