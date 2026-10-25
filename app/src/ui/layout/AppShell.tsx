import type { ReactNode } from "react";
import { NavRail, type ViewId } from "@/ui/NavRail";
import { HardwareStrip, MainHeader } from "@/ui/layout/HeaderStack";
import { SplitGutter, type LayoutState } from "@/ui/layout/SplitGutter";
import type { ChainState } from "@/chain/useChainState";
import type { WalletApi } from "@/wallet/WalletContext";
import type { PlayerSnapshot } from "@/chain/identity";

/**
 * The predecessor's shell (chrome parity, session-42): hardware strip →
 * ATROPA-999 header → MODULE tab bar, then the pane grid — [QING sidebar]
 * content [AI_CORE pane] [SYSTEM_LOGS pane] with draggable gutters on fine
 * pointers. Compact: single column, tabs dock to the bottom, agent + logs
 * share the bottom sheet.
 */
export function AppShell({
  view,
  onSelect,
  chain,
  wallet,
  snapshot,
  sidebar,
  children,
  dock,
  logs,
  sheet,
  layout,
  isCompact,
  onLayout,
  onCompactToggle,
}: {
  view: ViewId;
  onSelect: (v: ViewId) => void;
  chain: ChainState;
  wallet: WalletApi;
  snapshot: PlayerSnapshot | null;
  /** optional left sidebar pane (the unified QING sidebar) */
  sidebar?: ReactNode;
  children: ReactNode;
  /** right AI core pane (desktop) */
  dock: ReactNode;
  /** right system logs pane (desktop) */
  logs: ReactNode;
  /** mobile sheet content (agent + logs) */
  sheet: ReactNode;
  layout: LayoutState;
  isCompact: boolean;
  onLayout: (patch: Partial<LayoutState>) => void;
  /** compact: the header toggles route into the bottom sheet instead */
  onCompactToggle?: (tab: "agent" | "logs") => void;
}) {
  const dockVisible = !isCompact && layout.dockOpen;
  const logsVisible = !isCompact && layout.logsOpen;
  const sidebarVisible = !isCompact && layout.sidebar >= 220 && sidebar !== undefined;

  const columns = [
    sidebarVisible ? `${Math.round(layout.sidebar)}px` : null,
    sidebarVisible ? "6px" : null,
    "minmax(0, 1fr)",
    dockVisible ? "6px" : null,
    dockVisible ? `${Math.round(layout.dock)}px` : null,
    logsVisible ? "6px" : null,
    logsVisible ? `${Math.round(layout.logs)}px` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="app">
      <HardwareStrip chain={chain} />
      <MainHeader
        chain={chain}
        wallet={wallet}
        snapshot={snapshot}
        agentOpen={layout.dockOpen}
        logsOpen={layout.logsOpen}
        onToggleAgent={() =>
          isCompact && onCompactToggle ? onCompactToggle("agent") : onLayout({ dockOpen: !layout.dockOpen })
        }
        onToggleLogs={() =>
          isCompact && onCompactToggle ? onCompactToggle("logs") : onLayout({ logsOpen: !layout.logsOpen })
        }
        onConnect={onSelect.bind(null, "settings")}
      />
      <NavRail active={view} onSelect={onSelect} />
      <div className="main" data-testid="main-grid" style={{ gridTemplateColumns: columns.join(" ") }}>
        {sidebarVisible && <aside className="sidebar-pane">{sidebar}</aside>}
        {sidebarVisible && (
          <SplitGutter label="sidebar" onResize={(dx) => onLayout({ sidebar: layout.sidebar + dx })} />
        )}
        <main className="content">{children}</main>
        {dockVisible && (
          <SplitGutter label="dock" inverted onResize={(dx) => onLayout({ dock: layout.dock + dx })} />
        )}
        {dockVisible && <section className="dock">{dock}</section>}
        {logsVisible && (
          <SplitGutter label="logs" inverted onResize={(dx) => onLayout({ logs: layout.logs + dx })} />
        )}
        {logsVisible && logs}
      </div>
      {isCompact && <div className="sheet-host">{sheet}</div>}
    </div>
  );
}
