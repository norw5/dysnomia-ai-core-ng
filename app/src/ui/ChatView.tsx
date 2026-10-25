import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo, startTransition } from "react";
import { EXPLORER_BASE } from "@config/addresses";
import { makeClient } from "@/chain/client";
import {
  mergeLines,
  readChatTail,
  readMySoul,
  venueChannel,
  worldChannel,
  type ChatChannel,
  type ChatTail,
} from "@/chain/chatTail";
import { getBlockTime } from "@/chain/blockTime";
import {
  loadAllSeedChunks,
  loadSeedChunk,
  seedSummary,
  type SeedSummary,
} from "@/state/chatSeed";
import { chatSearchLines } from "@/state/chatSearch";
import { useChatChannelMode } from "@/state/chatChannel";
import { useChatLayout } from "@/state/chatLayout";
import { useCurrentVenue } from "@/state/venueStore";
import { kickSync, setSyncRunning, useSyncState } from "@/chain/sync";
import { LearnHint } from "@/ui/LearnHint";
import { VenueSidebar } from "@/ui/VenueSidebar";
import { ChatComposer } from "@/ui/WorldComposer";
import { MessageRow } from "@/ui/chat/MessageRow";
import { ChatUserPane } from "@/ui/chat/ChatUserPane";
import { combineLines, seedToLine, tailToLine, type ViewLine } from "@/ui/chat/viewLine";
import type { PlayerSnapshot } from "@/chain/identity";
import type { ChainState } from "@/chain/useChainState";
import type { LayoutState } from "@/ui/layout/SplitGutter";

/**
 * CHAT (IA-PLAN §10 item 5, session-44; THE DESIGN OVERHAUL session-71 + the
 * 71.1 owner review): the module IS the chat surface — no
 * panel-inside-a-container nesting. The message list fills the main
 * container, the composer is docked to its bottom (ONE line: input + count
 * + the DSS arm + DRY + SEND — the target is the VIEWED channel), the
 * scroll anchors at the bottom (new lines arrive at the bottom).
 *
 * Session-71.1 (the owner round): RENDER-ALL — the archive loads eagerly
 * (the newest chunk paints first, the full corpus merges in a transition)
 * and EVERY line stays mounted; rows are hard-memoized so re-renders touch
 * only changed rows. No pagination machinery at all (the corpus is ~8k
 * lines growing ~11/day — the windowing/sentinel code is gone; virtualize
 * later only if corpora ever explode). NATIVE search runs over the whole
 * corpus in place — highlights land directly, jumps scroll by line id.
 * UTC timestamps (rich layout) fetch lazily through ONE shared
 * IntersectionObserver for rows near the viewport.
 *
 * Every line is untrusted community content (§7.4): bodies render inert
 * (React-escaped text + DOMPurify-guarded http(s) out-links only) and the
 * fence banner stays on. The POST path stays the composer in the foot —
 * behind the §7.4 opt-in, through the gate.
 */

/** default live-tail windows (blocks): recent activity first, bridge on demand */
const WORLD_TAIL_WINDOW = 25_000;
const VENUE_TAIL_WINDOW = 50_000;
const VENUE_EXTEND_STEP = 100_000;
/** per-tick block-timestamp reads (rich layout only — bounded, cached) */
const TIME_BATCH = 24;

/**
 * The message list as ONE memoized subtree (session-71.1): render-all
 * mounts ~8k rows, and parent state that does NOT affect the list (the
 * user pane opening/closing, search-box focus, sync chips) must not pay
 * the 8k createElement + comparator pass. All props are primitives or
 * stable identities (useMemo/useCallback products), so the default
 * shallow memo skips the whole subtree until the corpus, layout, matches,
 * or timestamps actually change.
 */
const MessageList = memo(function MessageList({
  combined,
  layout,
  mySoul,
  timeMap,
  onUser,
  timeRef,
}: {
  combined: ViewLine[];
  layout: "irc" | "rich";
  mySoul: bigint | null;
  timeMap: Record<number, number>;
  onUser: (l: ViewLine) => void;
  timeRef: (el: HTMLElement | null) => (() => void) | undefined;
}) {
  return (
    <>
      {combined.map((l, i) => (
        <MessageRow
          key={l.id}
          line={l}
          layout={layout}
          mine={mySoul !== null && l.soul === mySoul}
          showBoundary={i > 0 && combined[i - 1]!.source === "seed" && l.source === "live"}
          time={timeMap[l.block]}
          onUser={onUser}
          timeRef={timeRef}
        />
      ))}
    </>
  );
});

export function ChatView({
  chain,
  snapshot,
  layout,
  isCompact,
  onLayout,
  onGoMap,
}: {
  chain: ChainState;
  snapshot: PlayerSnapshot | null;
  layout: LayoutState;
  isCompact: boolean;
  onLayout: (patch: Partial<LayoutState>) => void;
  onGoMap: () => void;
}) {
  const { current } = useCurrentVenue();
  const chat = useChatChannelMode();
  const display = useChatLayout();
  const client = useMemo(() => makeClient(chain.url), [chain.url]);

  const channelKey = chat.mode === "world" ? "world" : current !== null ? current.a.toLowerCase() : null;
  const channel: ChatChannel | null = useMemo(
    () => (chat.mode === "world" ? worldChannel() : current !== null ? venueChannel(current.a as `0x${string}`) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channelKey]
  );

  // ---- seed side (world channel only; venue channels are tail-only) ----
  // 71.1 render-all: the newest chunk paints FIRST, then the full archive
  // merges in a transition (loadAllSeedChunks memoizes; the newest chunk's
  // promise is reused — one fetch, two commits, no jank)
  const [summary, setSummary] = useState<SeedSummary | null>(null);
  const [seedLines, setSeedLines] = useState<ViewLine[]>([]);
  const [seedErr, setSeedErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSeedErr(null);
    seedSummary()
      .then((s) => {
        if (alive) setSummary(s);
      })
      .catch((e: unknown) => {
        if (alive) setSeedErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (summary === null) return;
    let alive = true;
    // paint the newest chunk immediately…
    loadSeedChunk(summary.chunks - 1)
      .then((msgs) => {
        if (!alive) return;
        setSeedLines((prev) => (prev.length === 0 ? msgs.map(seedToLine) : prev));
      })
      .catch((e: unknown) => {
        if (alive) setSeedErr(e instanceof Error ? e.message : String(e));
      });
    // …then the whole archive (render-all) as a TRANSITION (71.2): the ~8k-row
    // merge commit renders at low priority so typing + input stay interactive
    // while it lands (the owner's "significant lag when typing" — a sync merge
    // blocked frames up to ~600ms per keystroke burst)
    loadAllSeedChunks()
      .then((msgs) => {
        if (!alive) return;
        startTransition(() => {
          setSeedLines(msgs.map(seedToLine));
        });
      })
      .catch((e: unknown) => {
        if (alive) setSeedErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [summary]);

  // ---- live tail ----
  const [tail, setTail] = useState<ChatTail | null>(null);
  const [tailErr, setTailErr] = useState<string | null>(null);
  const [tailBusy, setTailBusy] = useState(false);
  /** persistent floor extension (world: bridge to seed; venue: deeper history) */
  const [floorOverride, setFloorOverride] = useState<number | null>(null);
  const tailRef = useRef<{ channel: ChatChannel | null; busy: boolean }>({ channel: null, busy: false });

  const refreshTail = useCallback(async () => {
    if (channel === null || tailRef.current.busy) return;
    tailRef.current = { channel, busy: true };
    setTailBusy(true);
    setTailErr(null);
    try {
      const head = await client.getBlockNumber();
      const seedFloor = chat.mode === "world" && summary !== null ? summary.lastBlock + 1 : 0;
      const window = chat.mode === "world" ? WORLD_TAIL_WINDOW : VENUE_TAIL_WINDOW;
      const creationFloor = chat.mode === "venue" && current ? current.blk : 0;
      const from =
        floorOverride !== null
          ? floorOverride
          : Math.max(Number(head) - window, seedFloor, creationFloor);
      const got = await readChatTail(client, channel, head, from);
      setTail(got);
    } catch (e: unknown) {
      setTail(null);
      setTailErr(e instanceof Error ? e.message : String(e));
    } finally {
      tailRef.current.busy = false;
      setTailBusy(false);
    }
  }, [channel, client, chat.mode, summary, floorOverride, current]);

  // ---- the user pane (right side; one line at a time) ----
  const [userLine, setUserLine] = useState<ViewLine | null>(null);

  useEffect(() => {
    setTail(null);
    setTailErr(null);
    setUserLine(null);
    firstLayout.current = true;
    nearBottom.current = true;
    setAtBottom(true);
    if (channel !== null) void refreshTail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelKey, client, summary?.lastBlock]);

  // quiet tail poll while the view is open (ref-stable, no resubscribe churn)
  const refreshRef = useRef(refreshTail);
  useEffect(() => {
    refreshRef.current = refreshTail;
  });
  useEffect(() => {
    if (channel === null) return;
    const t = window.setInterval(() => void refreshRef.current(), 20_000);
    return () => window.clearInterval(t);
  }, [channel]);

  // ---- the viewer's own soul (isMe highlight; fail-soft) ----
  const [mySoul, setMySoul] = useState<bigint | null>(null);
  useEffect(() => {
    setMySoul(null);
    const lau = snapshot?.lau ?? null;
    if (lau === null) return;
    let alive = true;
    readMySoul(client, lau).then((s) => {
      if (alive) setMySoul(s);
    });
    return () => {
      alive = false;
    };
  }, [client, snapshot?.lau]);

  // ---- combined corpus (render-all: every line stays mounted) ----
  // session-70: the sync engine's world backfill rides the LIVE side (same
  // id space, mergeLines dedupes)
  const sync = useSyncState();
  const liveLines = useMemo(
    () =>
      chat.mode === "world" && sync.chatLines.length > 0
        ? mergeLines(sync.chatLines, tail !== null ? tail.lines : [])
        : tail !== null
          ? tail.lines
          : [],
    [chat.mode, sync.chatLines, tail]
  );
  const combined = useMemo(
    () =>
      chat.mode === "world"
        ? combineLines(seedLines, liveLines.map(tailToLine))
        : liveLines.map(tailToLine),
    [chat.mode, seedLines, liveLines]
  );

  // ---- scroll: bottom-anchored + search-jump-anchored ----
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottom = useRef(true);
  const firstLayout = useRef(true);
  const [focusId, setFocusId] = useState<string | null>(null);
  // session-80: the "jump to newest" affordance — visible only while the
  // view is scrolled up (the bottom-anchor process keeps the true state)
  const [atBottom, setAtBottom] = useState(true);

  /**
   * Pin to the bottom, then RE-ASSERT until heights stabilize: content-
   * visibility placeholders mean scrollHeight keeps refining as offscreen
   * rows first lay out (a rich-layout switch spends ~2s rendering), so the
   * anchor is a process — keep pinning while the height still moves, under
   * a frame budget, guarded by an epoch so newer pins supersede older
   * loops and any user scroll (nearBottom false) stops them.
   */
  const pinEpoch = useRef(0);
  const pinBottom = useCallback((budget = 600) => {
    const epoch = ++pinEpoch.current;
    const step = (left: number) => {
      const el = scrollRef.current;
      if (!el || !nearBottom.current || pinEpoch.current !== epoch || left <= 0) return;
      const before = el.scrollHeight;
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        const cur = scrollRef.current;
        if (!cur) return;
        if (cur.scrollHeight !== before || cur.scrollHeight - cur.scrollTop - cur.clientHeight > 8) {
          step(left - 1);
        }
      });
    };
    step(budget);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (nearBottom.current || firstLayout.current) {
      firstLayout.current = false;
      pinBottom();
    }
  }, [combined.length, chat.mode, current?.a, display.layout, pinBottom]);

  // scroll a search-jump target into view once it renders
  useLayoutEffect(() => {
    if (focusId === null) return;
    const el = scrollRef.current;
    if (!el) return;
    const row = el.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(focusId)}"]`);
    if (row !== null) {
      row.scrollIntoView({ block: "center" });
      setFocusId(null);
    }
  }, [focusId, combined.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    nearBottom.current = near;
    setAtBottom((prev) => (prev === near ? prev : near));
  };

  const scrollToBottom = useCallback(() => {
    nearBottom.current = true;
    setAtBottom(true);
    pinBottom();
  }, [pinBottom]);

  // ---- native search (session-71): the whole corpus, in place ----
  // session-79: the input is UNCONTROLLED (the 71.3/77 law — typing must not
  // re-render the view); a 160ms debounce reads the ref and commits the
  // results as a transition. `query` is the COMMITTED query (notes/counts).
  const [query, setQuery] = useState("");
  const [matchIds, setMatchIds] = useState<string[]>([]);
  const [matchIdx, setMatchIdx] = useState(0);
  const [searchedCount, setSearchedCount] = useState<number | null>(null);
  const [searchTick, setSearchTick] = useState(0);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const searchTimer = useRef<number | null>(null);

  const scheduleSearch = useCallback(() => {
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      searchTimer.current = null;
      setSearchTick((n) => n + 1);
    }, 160);
  }, []);

  const clearSearch = useCallback(() => {
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    if (searchInput.current !== null) searchInput.current.value = "";
    setQuery("");
    setMatchIds([]);
    setMatchIdx(0);
    setSearchedCount(null);
  }, []);

  useEffect(() => {
    return () => {
      if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    };
  }, []);

  useEffect(() => {
    const q = (searchInput.current?.value ?? "").trim();
    if (q.length === 0) {
      setQuery("");
      setMatchIds([]);
      setMatchIdx(0);
      setSearchedCount(null);
      return;
    }
    const res = chatSearchLines(combined, q);
    // the result commit runs as a transition; the highlight pass is a DOM
    // effect below, so no row re-renders (session-79 — the OPEN 77 residual)
    startTransition(() => {
      setQuery(q);
      setMatchIds(res.ids);
      setMatchIdx((i) => (i < res.ids.length ? i : 0));
      setSearchedCount(res.searched);
    });
  }, [searchTick, combined]);

  const matchSet = useMemo(() => new Set(matchIds), [matchIds]);
  const activeMatchId = matchIds.length > 0 ? (matchIds[matchIdx % matchIds.length] ?? null) : null;

  // session-79 (the OPEN 77 residual): search highlighting is a DOM pass, not
  // a React prop. The 8k-row MessageList memo no longer sees search state, so
  // a result commit renders ZERO rows; this effect toggles `data-search-hit`
  // / `data-search-active` on matched rows only (O(rows) scan, O(hits) DOM
  // writes). Attributes (not classes) survive React re-renders of a hit row
  // (rich timestamps landing) — React never manages attributes it was not
  // given. The 77.1 composer fence is untouched.
  const searchHits = useRef<HTMLElement[]>([]);
  const searchActive = useRef<HTMLElement | null>(null);
  const activeIdRef = useRef<string | null>(activeMatchId);
  activeIdRef.current = activeMatchId;
  useEffect(() => {
    const root = scrollRef.current;
    if (root === null) return;
    // session-79: the root attribute GATES the highlight rules, so per-row
    // attribute writes never trigger a style recalc while the gate is off;
    // turning it on once paints the new hit set (a clear is one attribute).
    root.removeAttribute("data-searching");
    searchActive.current?.removeAttribute("data-search-active");
    searchActive.current = null;
    for (const el of searchHits.current) el.removeAttribute("data-search-hit");
    if (matchSet.size === 0) {
      searchHits.current = [];
      return;
    }
    const hits: HTMLElement[] = [];
    const rows = root.querySelectorAll<HTMLElement>(".chat-line[data-line-id]");
    for (const el of rows) {
      const id = el.dataset.lineId;
      if (id !== undefined && matchSet.has(id)) {
        el.setAttribute("data-search-hit", "");
        hits.push(el);
      }
    }
    searchHits.current = hits;
    const activeId = activeIdRef.current;
    if (activeId !== null) {
      const el =
        hits.find((h) => h.dataset.lineId === activeId) ??
        root.querySelector<HTMLElement>(`.chat-line[data-line-id="${CSS.escape(activeId)}"]`);
      if (el !== null) {
        el.setAttribute("data-search-active", "");
        searchActive.current = el;
      }
    }
    root.setAttribute("data-searching", "");
  }, [matchSet, combined, display.layout]);

  // the active marker moves independently: Enter/Shift+Enter must repaint
  // only the two affected rows, never the whole hit set
  useEffect(() => {
    const root = scrollRef.current;
    if (root === null) return;
    searchActive.current?.removeAttribute("data-search-active");
    searchActive.current = null;
    if (activeMatchId === null) return;
    const el =
      searchHits.current.find((h) => h.dataset.lineId === activeMatchId) ??
      root.querySelector<HTMLElement>(`.chat-line[data-line-id="${CSS.escape(activeMatchId)}"]`);
    if (el !== null) {
      el.setAttribute("data-search-active", "");
      searchActive.current = el;
    }
  }, [activeMatchId]);

  const jumpMatch = (dir: 1 | -1) => {
    if (matchIds.length === 0) return;
    const next = (matchIdx + dir + matchIds.length) % matchIds.length;
    setMatchIdx(next);
    const id = matchIds[next];
    if (id === undefined) return;
    nearBottom.current = false; // the jump anchors the view, not the tail
    setFocusId(id);
  };

  // ---- rich layout: UTC timestamps via ONE shared viewport observer ----
  // rows near the viewport report in (data-block); blocks are attempted at
  // most once per mount, batched ≤ TIME_BATCH, cached forever
  const [timeMap, setTimeMap] = useState<Record<number, number>>({});
  const timeAttempted = useRef(new Set<number>());
  const timeIo = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const blocks: number[] = [];
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const b = Number((e.target as HTMLElement).dataset.block ?? NaN);
          if (!Number.isFinite(b) || timeAttempted.current.has(b) || blocks.includes(b)) continue;
          blocks.push(b);
          if (blocks.length >= TIME_BATCH) break;
        }
        if (blocks.length === 0) return;
        for (const b of blocks) timeAttempted.current.add(b);
        void Promise.all(
          blocks.map(async (b) => [b, await getBlockTime(client, b)] as const)
        ).then((pairs) => {
          const add: Record<number, number> = {};
          for (const [b, t] of pairs) if (t !== null) add[b] = t;
          if (Object.keys(add).length > 0) setTimeMap((m) => ({ ...m, ...add }));
        });
      },
      { root, rootMargin: "300px 0px" }
    );
    timeIo.current = io;
    return () => {
      io.disconnect();
      timeIo.current = null;
    };
  }, [client]);

  /** stable row registration (memo-safe: never changes identity) */
  const registerTimeRow = useCallback((el: HTMLElement | null) => {
    const io = timeIo.current;
    if (el !== null && io !== null) {
      if (el.dataset.block !== undefined) io.observe(el);
      return () => io.unobserve(el);
    }
    return undefined;
  }, []);

  // contiguous live coverage: the view's own tail floor + the engine's
  // (cursor through N; floor = where its kept lines start, or the seed end
  // when the backfill found nothing). The bridge affordance renders only
  // for the blocks NEITHER has read.
  const syncFrom =
    sync.chat.cursor > 0 ? (sync.chatFloor > 0 ? sync.chatFloor : summary !== null ? summary.lastBlock + 1 : null) : null;
  const coveredCandidates = [tail !== null ? tail.coveredFrom : null, syncFrom];
  const coveredFrom = coveredCandidates.reduce<number | null>(
    (a, b) => (b === null ? a : a === null ? b : Math.min(a, b)),
    null
  );
  const gapBlocks =
    chat.mode === "world" && summary !== null && coveredFrom !== null && coveredFrom > summary.lastBlock + 1
      ? { from: summary.lastBlock + 1, to: coveredFrom - 1 }
      : null;

  const bridgeToSeed = () => {
    if (summary === null) return;
    setFloorOverride(summary.lastBlock + 1);
  };
  const extendVenue = () => {
    if (current === null || tail === null) return;
    setFloorOverride(Math.max(tail.coveredFrom - VENUE_EXTEND_STEP, current.blk));
  };

  const sidebarOpen = layout.sidebar >= 220;
  // stable identity so the memoized composer skips ChatView re-renders that
  // are not its business (search typing, tail ticks) — session-77
  const onComposerSent = useCallback(() => {
    void refreshTail();
  }, [refreshTail]);
  const searchNote =
    query.trim().length > 0 && searchedCount !== null
      ? chat.mode === "world"
        ? `searched ${searchedCount.toLocaleString()} lines (archive + caught-up + live)`
        : `searched ${searchedCount.toLocaleString()} lines (the loaded venue window)`
      : null;

  return (
    <section className="view chat" data-testid="view-chat">
      <h1>
        //social CHAT — world + venue channels <LearnHint file="accounts-and-chat.md" anchor="how-a-chat-line-travels" />{" "}
        {!isCompact && (
          <button
            className="btn"
            onClick={() => onLayout({ sidebar: sidebarOpen ? 0 : 320 })}
            data-testid="chat-sidebar-toggle"
          >
            {sidebarOpen ? "hide channel list" : "show channel list"}
          </button>
        )}
      </h1>

      {isCompact && <VenueSidebar compact mode="channels" />}

      {chat.mode === "venue" && current === null && (
        <div className="panel">
          <h2>venue channel</h2>
          <p className="hint">no venue selected — pick a channel above; the choice is shared with MAP.</p>
        </div>
      )}

      {channel !== null && (
        <div className="chat-surface" data-testid="chat-panel">
          <div className="chat-head" data-testid="chat-head">
            <div>
              <h2>
                {chat.mode === "world"
                  ? "THE VOID — world channel"
                  : `${current && current.n.length > 0 ? current.n : "(nameless)"} — venue channel`}{" "}
                <a
                  className="outlink"
                  href={`${EXPLORER_BASE}${channel.address}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  ↗ explorer
                </a>
              </h2>
              <p className="hint mono">
                {chat.mode === "world"
                  ? "LAU.Chat → VOID → your SHIO Log → LogEvent(Soul, Aura, line) on ZHOU's channel"
                  : "QING.Chat(LAU, string) → LogEvent(Username, Soul, Aura, line) on the venue"}
              </p>
            </div>
            <div className="chat-chips">
              {chat.mode === "world" && (
                <span className={`chat-chip ${seedErr ? "err" : "seed"}`} data-testid="chat-seed-chip">
                  SEED {summary !== null ? `· through ${summary.lastBlock.toLocaleString()}` : "· …"}
                  {seedErr ? " · seed error" : ""}
                </span>
              )}
              <span
                className={`chat-chip ${tailErr ? "err" : tail ? (tail.truncated ? "trunc" : "live") : ""}`}
                data-testid="chat-live-chip"
              >
                {tailBusy && !tail ? "LIVE · reading…" : tailErr ? "LIVE · unavailable" : tail && tail.truncated ? "LIVE · truncated" : tail ? "LIVE" : "LIVE · idle"}
              </span>
              {chat.mode === "world" && (
                <button
                  className={`chat-chip chat-chip-btn${sync.running ? "" : " paused"}`}
                  onClick={() => (sync.running ? kickSync() : void setSyncRunning(true))}
                  title={
                    sync.running
                      ? `the global sync engine — caught up through block ${sync.chat.cursor.toLocaleString()}; click to sync now`
                      : "the global sync engine is PAUSED — click to resume (the header DATA chip pauses it again)"
                  }
                  data-testid="chat-sync-chip"
                >
                  {sync.running
                    ? sync.chat.cursor > 0
                      ? `SYNC → ${sync.chat.cursor.toLocaleString()}`
                      : "SYNC · …"
                    : "SYNC · PAUSED"}
                </button>
              )}
              <span className="chat-layout-toggle" data-testid="chat-layout">
                <button
                  className={display.layout === "irc" ? "chat-chip chat-chip-btn on" : "chat-chip chat-chip-btn"}
                  onClick={() => display.setLayout("irc")}
                  title="compact IRC style — the terminal idiom"
                  data-testid="chat-layout-irc"
                >
                  IRC
                </button>
                <button
                  className={display.layout === "rich" ? "chat-chip chat-chip-btn on" : "chat-chip chat-chip-btn"}
                  onClick={() => display.setLayout("rich")}
                  title="chat-app style — sigil pfps, bubbles, UTC timestamps"
                  data-testid="chat-layout-rich"
                >
                  RICH
                </button>
              </span>
              <button className="btn" disabled={tailBusy} onClick={() => void refreshTail()} data-testid="chat-refresh">
                refresh
              </button>
            </div>

            {/* the native search row (browser find-in-page cannot see paged content) */}
            <div className="chat-search" data-testid="chat-search">
              <input
                className="venue-search mono"
                type="search"
                placeholder="search the archive — text or handle"
                spellCheck={false}
                ref={searchInput}
                onInput={scheduleSearch}
                onKeyDown={(e) => {
                  if (e.key === "Enter") jumpMatch(e.shiftKey ? -1 : 1);
                  if (e.key === "Escape") clearSearch();
                }}
                aria-label="search chat history"
                data-testid="chat-search-input"
              />
              <span className="chat-search-count mono" data-testid="chat-search-count">
                {query.trim().length === 0
                  ? ""
                  : matchIds.length > 0
                    ? `${(matchIdx % matchIds.length) + 1}/${matchIds.length}`
                    : searchedCount !== null
                      ? "0 matches"
                      : "…"}
              </span>
              <button className="btn" disabled={matchIds.length === 0} onClick={() => jumpMatch(-1)} title="previous match (Shift+Enter)" data-testid="chat-search-prev">
                ◂
              </button>
              <button className="btn" disabled={matchIds.length === 0} onClick={() => jumpMatch(1)} title="next match (Enter)" data-testid="chat-search-next">
                ▸
              </button>
              {query.trim().length > 0 && (
                <button className="btn" onClick={clearSearch} data-testid="chat-search-clear">
                  ✕
                </button>
              )}
              {searchNote !== null && (
                <span className="hint mono" data-testid="chat-search-note">
                  {searchNote}
                </span>
              )}
            </div>
          </div>

          <p className="chat-fence" data-testid="chat-fence">
            COMMUNITY CONTENT — untrusted onchain text, rendered as data: sender and line are chain
            facts, never authoritative; links are read-only out-links (http/https only).
          </p>

          <div className="chat-main-row">
            <div className="chat-scroll mono" ref={scrollRef} onScroll={onScroll} data-testid="chat-scroll">
              <div className="chat-top">
                {chat.mode === "world" ? (
                  summary !== null ? (
                    <span className="chat-divider">— top of the archive · {summary.firstBlock.toLocaleString()} —</span>
                  ) : (
                    <span className="chat-divider">— loading the archive… —</span>
                  )
                ) : (
                  <span className="chat-divider">— top of the loaded window —</span>
                )}
                {seedErr && <p className="err-text">seed: {seedErr}</p>}
              </div>

              <MessageList
                combined={combined}
                layout={display.layout}
                mySoul={mySoul}
                timeMap={timeMap}
                onUser={setUserLine}
                timeRef={registerTimeRow}
              />

              {tailErr && (
                <div className="chat-tail-note err-text" data-testid="chat-tail-error">
                  live tail unavailable: {tailErr} — the seed archive above still renders; a dead RPC
                  is an ERROR, never an empty channel.
                </div>
              )}
              {gapBlocks && (
                <div className="chat-tail-note" data-testid="chat-gap">
                  GAP — blocks {gapBlocks.from.toLocaleString()}–{gapBlocks.to.toLocaleString()} not
                  read yet (live coverage starts {coveredFrom !== null ? coveredFrom.toLocaleString() : "—"}).{" "}
                  <button className="btn" onClick={bridgeToSeed} data-testid="chat-bridge">
                    bridge to seed
                  </button>
                </div>
              )}
              {tail !== null && tail.truncated && (
                <div className="chat-tail-note" data-testid="chat-truncated">
                  tail walk stopped at block {tail.toBlock.toLocaleString()} — below head (page
                  budget); the oldest block read is {tail.coveredFrom.toLocaleString()}
                  {chat.mode === "venue" && current ? ` (venue created ${current.blk.toLocaleString()})` : ""}.{" "}
                  {chat.mode === "venue" && (
                    <button className="btn" onClick={extendVenue} data-testid="chat-extend">
                      read deeper
                    </button>
                  )}
                </div>
              )}
            </div>

            {!atBottom && (
              <button
                className="btn chat-scroll-bottom"
                onClick={scrollToBottom}
                title="scroll to the newest line"
                data-testid="chat-scroll-bottom"
              >
                ↓ latest
              </button>
            )}

            {userLine !== null && (
              <ChatUserPane line={userLine} rpcUrl={chain.url} onClose={() => setUserLine(null)} />
            )}
          </div>

          <div className="chat-foot" data-testid="chat-foot">
            <ChatComposer
              snapshot={snapshot}
              venue={current}
              mode={chat.mode}
              rpcUrl={chain.url}
              onSent={onComposerSent}
            />
            {chat.mode === "venue" && (
              <p className="hint">
                the plain QING.Chat path (no bounty) stays in the venue panel —{" "}
                <button className="btn" onClick={onGoMap} data-testid="chat-goto-map">
                  open MAP → venue actions
                </button>
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
