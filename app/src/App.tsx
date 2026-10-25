import { useEffect, useMemo, useState } from "react";
import { JournalBus } from "@/chain/journal";
import { GateProvider, useGate } from "@/chain/GateContext";
import { useChainState } from "@/chain/useChainState";
import { usePlayerSnapshot } from "@/chain/identity";
import { WalletProvider, useWallet } from "@/wallet/WalletContext";
import { AppShell } from "@/ui/layout/AppShell";
import { AgentPane } from "@/ui/AgentPane";
import { LogsPanel } from "@/ui/LogsPanel";
import { ApprovalCard } from "@/ui/ApprovalCard";
import { PlaceholderView } from "@/ui/views/PlaceholderView";
import { SettingsView } from "@/ui/views/SettingsView";
import { StudioView } from "@/ui/views/StudioView";
import { IdentityView } from "@/ui/views/IdentityView";
import { MapView } from "@/ui/views/MapView";
import { DirectoryView } from "@/ui/views/DirectoryView";
import { ChatView } from "@/ui/ChatView";
import { MarketView } from "@/ui/views/MarketView";
import { LearnView } from "@/ui/views/LearnView";
import { VenueSidebar } from "@/ui/VenueSidebar";
import { DeckView } from "@/ui/deck/DeckView";
import { AgentProvider } from "@/agent/store";
import { ensureFirstRunSeed, setDeckRefusalSink, wireDeckToRunEvents } from "@/state/deckStore";
import { clearPendingLau } from "@/state/pendingLau";
import { subscribeLearn } from "@/state/learnLink";
import { ensureSyncEngine } from "@/chain/sync";
import type { ViewId } from "@/ui/NavRail";
import { useLayout } from "@/ui/layout/SplitGutter";
import { applyVessel } from "@/state/vessel";

export function App() {
  const journal = useMemo(() => new JournalBus(), []);
  const chain = useChainState();
  useEffect(() => {
    void journal.loadRecent();
  }, [journal]);

  return (
    <WalletProvider rpcUrl={chain.url} journal={journal}>
      <GateProvider rpcUrl={chain.url} journal={journal}>
        <Shell chrome={chain} journal={journal} />
      </GateProvider>
    </WalletProvider>
  );
}

function Shell({ chrome, journal }: { chrome: ReturnType<typeof useChainState>; journal: JournalBus }) {
  // §7.11: the DECK is the default landing surface — the agent's workspace
  const [view, setView] = useState<ViewId>("deck");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState<"agent" | "logs">("agent");
  const gate = useGate();
  const wallet = useWallet();
  const { layout, setLayout, isCompact } = useLayout();

  // the §7.6 player-state snapshot, lifted app-global: the header's SOUL/
  // CREDITS read it, IDENTITY renders it, and the agent deck injects it
  // per-turn (snapshot supersedes historical state reads)
  const player = usePlayerSnapshot(chrome.url, wallet.account);

  // session-64 (the owner's manual-fork ask): committed txs refresh the
  // player state immediately — the journal's gate.receipt (success) covers
  // manual + agent + plan sends globally; the 12s quiet tick stays
  useEffect(() => {
    return journal.subscribe((e) => {
      if (e.kind === "gate.receipt" && e.detail?.status === "success") player.refresh();
    });
  }, [journal, player.refresh]);

  // session-64: when the wallet→LAU discovery resolves (CHO.GetUserTokenAddress),
  // the receipt-carried pending LAU clears — the snapshot is truth
  useEffect(() => {
    if (wallet.account !== null && player.snapshot?.lau != null) clearPendingLau(wallet.account);
  }, [wallet.account, player.snapshot?.lau]);

  // §7.11 auto-surfacing: the deck store subscribes to the RunEvent stream
  // (tool results emit their preferred widget)
  useEffect(() => wireDeckToRunEvents(), []);

  // session-60: apply the fleet vessel (sim/demo-scoped accent + callsign)
  // to the document root — re-resolved whenever the RPC changes
  useEffect(() => {
    applyVessel(chrome.url);
  }, [chrome.url]);

  // §7.11 composition (session-57): fresh storage seeds the default slot
  // map — the deck's front door is a composition, not an empty grid. Any
  // existing deck (even an emptied one) is left alone.
  useEffect(() => {
    ensureFirstRunSeed();
  }, []);

  // session-70: the GLOBAL sync engine — chat backfill + the QING census
  // catch-up (IDB-persisted cursors; the header DATA control pauses it).
  // Sim/fork RPCs default it to PAUSED (explicit resume — no background
  // re-walks behind a pin); live RPCs auto-sync.
  useEffect(() => {
    ensureSyncEngine(chrome.url, { simDefaultPaused: chrome.sim });
  }, [chrome.url, chrome.sim]);

  // session-63 routing honesty: refused surfaces journal into SYSTEM_LOGS
  // (the deck store never imports the gate — the sink bridges it)
  useEffect(() => {
    setDeckRefusalSink((line, detail) => {
      journal.emit("agent.deck", line, detail);
    });
    return () => {
      setDeckRefusalSink(null);
    };
  }, [journal]);

  // §6 form 2 (session-53): a contextual `?` deep-link switches the app to
  // LEARN; the view itself consumes the file/anchor target
  useEffect(() => subscribeLearn(() => setView((v) => (v === "learn" ? v : "learn"))), []);

  const selectView = (v: ViewId) => {
    setView(v);
    // the unified QING sidebar opens with its consumers (MAP / CHAT channels
    // / the MARKET asset picker) unless the user has deliberately sized it;
    // persisted sizes win either way
    if ((v === "map" || v === "chat" || v === "market") && !isCompact && layout.sidebar === 0) setLayout({ sidebar: 320 });
  };

  const openSheet = (tab: "agent" | "logs") => {
    setSheetTab(tab);
    setSheetOpen(true);
  };

  return (
    <AgentProvider journal={journal} rpcUrl={chrome.url} snapshot={player.snapshot} refreshSnapshot={player.refresh}>
      <div className="root">
      <AppShell
        view={view}
        onSelect={selectView}
        chain={chrome}
        wallet={wallet}
        snapshot={player.snapshot}
        layout={layout}
        isCompact={isCompact}
        onLayout={setLayout}
        onCompactToggle={openSheet}
        sidebar={
          view === "map" ? (
            <VenueSidebar />
          ) : view === "chat" ? (
            <VenueSidebar mode="channels" />
          ) : view === "market" ? (
            <VenueSidebar />
          ) : undefined
        }
        dock={<AgentPane rpcUrl={chrome.url} />}
        logs={<LogsPanel journal={journal} />}
        sheet={
          <div className={`sheet ${sheetOpen ? "open" : ""}`} data-testid="agent-sheet">
            <header className="sheet-head">
              <nav className="dock-tabs">
                <button
                  className={sheetTab === "agent" ? "dock-tab active" : "dock-tab"}
                  onClick={() => setSheetTab("agent")}
                  data-testid="sheet-tab-agent"
                >
                  AI_CORE
                </button>
                <button
                  className={sheetTab === "logs" ? "dock-tab active" : "dock-tab"}
                  onClick={() => setSheetTab("logs")}
                  data-testid="sheet-tab-logs"
                >
                  LOGS
                </button>
              </nav>
              <button className="dock-btn" onClick={() => setSheetOpen(false)} data-testid="sheet-close">
                close
              </button>
            </header>
            {sheetTab === "agent" ? <AgentPane rpcUrl={chrome.url} /> : <LogsPanel journal={journal} />}
          </div>
        }
      >
        {view === "deck" ? (
          <DeckView
            chain={chrome}
            snapshot={player.snapshot}
            snapshotError={player.error}
            wallet={wallet}
            onGoView={(v) => selectView(v)}
          />
        ) : view === "settings" ? (
          <SettingsView chain={chrome} />
        ) : view === "studio" ? (
          <StudioView />
        ) : view === "identity" ? (
          <IdentityView
            chain={chrome}
            snapshot={player.snapshot}
            loading={player.loading}
            snapshotError={player.error}
            refresh={player.refresh}
          />
        ) : view === "map" ? (
          <MapView
            layout={layout}
            isCompact={isCompact}
            onLayout={setLayout}
            chain={chrome}
            snapshot={player.snapshot}
          />
        ) : view === "chat" ? (
          <ChatView
            chain={chrome}
            snapshot={player.snapshot}
            layout={layout}
            isCompact={isCompact}
            onLayout={setLayout}
            onGoMap={() => selectView("map")}
          />
        ) : view === "market" ? (
          <MarketView chain={chrome} snapshot={player.snapshot} isCompact={isCompact} />
        ) : view === "learn" ? (
          <LearnView />
        ) : view === "directory" ? (
          <DirectoryView chain={chrome} />
        ) : (
          <PlaceholderView id={view} />
        )}
      </AppShell>

      {gate.pendingApproval && (
        <ApprovalCard
          envelope={gate.pendingApproval}
          mode={wallet.mode}
          onResolve={(accept) => gate.resolveApproval(accept)}
        />
      )}
      </div>
    </AgentProvider>
  );
}
