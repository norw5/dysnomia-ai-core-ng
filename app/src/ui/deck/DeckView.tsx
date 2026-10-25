import { useEffect } from "react";
import { useAgent } from "@/agent/store";
import {
  KIND_CLASS,
  SLOT_CLASS,
  SLOT_IDS,
  WIDGET_KINDS,
  lockSlot,
  promoteLedgerIfComplete,
  resetDeckToDefault,
  slotSurface,
  useDeck,
  type DeckSlot,
  type SlotId,
  type WidgetKind,
} from "@/state/deckStore";
import { WidgetBody } from "@/ui/deck/widgets";
import { IdentityPane } from "@/ui/deck/IdentityPane";
import type { PlayerSnapshot } from "@/chain/identity";
import type { ChainState } from "@/chain/useChainState";
import type { WalletApi } from "@/wallet/WalletContext";

/**
 * The DECK (IA-PLAN §7.11; the session-63 SLOT REDESIGN): the agent's
 * WORKSPACE and the default landing surface — a SEMI-FIXED instrument
 * panel. Column 1 = the identity CHROME (never widget slots); columns 2+3
 * = four typed bays (short top / tall bottom each). Every bay carries a
 * PICKER (only fitting kinds) + a LOCK toggle + clear; the agent routes
 * surfaces per the deckStore routing table; the onboarding bay promotes
 * to the yuan ledger GENTLY once the chain completes.
 */
export function DeckView({
  chain,
  snapshot,
  snapshotError,
  wallet,
  onGoView,
}: {
  chain: ChainState;
  snapshot: PlayerSnapshot | null;
  snapshotError: string | null;
  wallet: WalletApi;
  onGoView: (v: "map" | "chat" | "identity" | "settings") => void;
}) {
  const agent = useAgent();
  const { slots } = useDeck();
  const onboarded =
    wallet.account !== null && snapshot !== null && snapshot.lau !== null && snapshot.username !== null && snapshot.yue !== null;
  const filled = SLOT_IDS.filter((id) => slots[id].kind !== null);

  // the GENTLE swap: onboarding → yuan_ledger when the chain completes —
  // only when the SEEDED onboarding widget still holds col2-top
  useEffect(() => {
    if (onboarded) promoteLedgerIfComplete();
  }, [onboarded, snapshot?.fetchedAt]);

  return (
    <section className="view deck" data-testid="view-deck">
      <h1>
        //agent DECK — the agent workspace{" "}
        <span className="hint">
          {filled.length > 0
            ? `${filled.length}/${SLOT_IDS.length} bays · ${agent.busy ? "agent working…" : "idle"}`
            : agent.busy
              ? "agent working…"
              : ""}
        </span>{" "}
        <button className="btn" onClick={() => resetDeckToDefault()} data-testid="deck-reset" title="restore the default bay composition">
          reset
        </button>
      </h1>

      <div className="deck-layout">
        <IdentityPane rpcUrl={chain.url} snapshot={snapshot} snapshotError={snapshotError} wallet={wallet} onGoSettings={() => onGoView("settings")} />

        <div className="deck-main">
          {filled.length === 0 && (
            <div className="panel deck-empty" data-testid="deck-empty">
              {agent.keySource === null ? (
                <>
                  <p>
                    <span className="err-text">agent offline</span> — no API key configured. the deck is the agent's
                    workspace; without a core it stays dark.
                  </p>
                  <p className="hint">
                    bring it up: SETTINGS → Agent → the BYOK field (or app/.env on dev runs). meanwhile the manual views
                    cover everything — every action still runs through the one transaction gate.
                  </p>
                  <div className="studio-actions">
                    <button className="btn" onClick={() => onGoView("settings")} data-testid="deck-empty-settings">
                      SETTINGS → Agent
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>deck standing by — the agent core is live ({agent.keySource === "dev-env" ? "DEV.ENV" : "BYOK"} · {agent.settings.model}).</p>
                  <p className="hint">
                    surfaces route into the bays as the agent works (venue reads, profiles, beat previews, KB excerpts,
                    the run checklist) — or pick one per bay above.
                  </p>
                </>
              )}
              <p className="hint">
                manual views:{" "}
                <button className="btn" onClick={() => onGoView("map")} data-testid="deck-empty-map">
                  MAP
                </button>{" "}
                <button className="btn" onClick={() => onGoView("chat")} data-testid="deck-empty-chat">
                  CHAT
                </button>{" "}
                <button className="btn" onClick={() => onGoView("identity")} data-testid="deck-empty-identity">
                  IDENTITY
                </button>
              </p>
            </div>
          )}

          <div className="deck-grid" data-testid="deck-grid">
            {SLOT_IDS.map((id) => (
              <Bay
                key={id}
                id={id}
                slot={slots[id]}
                chain={chain}
                snapshot={snapshot}
                wallet={wallet}
                onboarded={onboarded}
                onGoView={onGoView}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Bay({
  id,
  slot,
  chain,
  snapshot,
  wallet,
  onboarded,
  onGoView,
}: {
  id: SlotId;
  slot: DeckSlot;
  chain: ChainState;
  snapshot: PlayerSnapshot | null;
  wallet: WalletApi;
  onboarded: boolean;
  onGoView: (v: "map" | "chat" | "identity" | "settings") => void;
}) {
  const [col, row] = id.split("-") as ["col2" | "col3", "top" | "bottom"];
  const label = `${col}·${row}`;
  const kind = slot.kind;
  const originNote = kind === null ? "" : slot.origin === "agent" ? " · agent" : slot.origin === "auto" ? " · auto" : slot.origin === "seed" ? " · default" : " · manual";
  const pickerKinds = (WIDGET_KINDS as WidgetKind[]).filter(
    (k) => (SLOT_CLASS[id] === "tall" || KIND_CLASS[k] === "short") && !(k === "onboarding" && onboarded)
  );
  return (
    <section
      className={`bay bay--${SLOT_CLASS[id]}${slot.locked ? " locked" : ""}${kind === null ? " empty" : ""}`}
      data-testid="deck-widget"
      data-kind={kind ?? "empty"}
      data-slot={id}
    >
      <header className="bay-head">
        <span className="mono bay-label">
          {label} <span className="hint">· {SLOT_CLASS[id]}</span>
        </span>
        <select
          className="bay-picker"
          value={kind ?? ""}
          onChange={(e) => slotSurface(id, (e.target.value === "" ? null : e.target.value) as WidgetKind | null)}
          data-testid="deck-bay-picker"
          title="pick this bay's surface (fitting kinds only)"
        >
          <option value="">(empty)</option>
          {pickerKinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        {kind !== null && <span className="hint bay-origin">{originNote}</span>}
        <span className="bay-actions">
          <button
            className="btn"
            onClick={() => lockSlot(id, !slot.locked)}
            data-testid="deck-bay-lock"
            title={slot.locked ? "unlock — routing may write this bay again" : "lock — freeze this bay (routing never writes it)"}
          >
            {slot.locked ? "UNLOCK" : "LOCK"}
          </button>
          {kind !== null && (
            <button
              className="btn"
              onClick={() => slotSurface(id, null)}
              data-testid="deck-bay-clear"
              title="empty this bay"
            >
              ✕
            </button>
          )}
        </span>
      </header>
      {/* overflow lives INSIDE the bay — the deck itself fits the screen */}
      <div className="bay-body">
        {kind !== null ? (
          <WidgetBody widget={{ kind, props: slot.props }} chain={chain} snapshot={snapshot} wallet={wallet} onGoView={onGoView} />
        ) : (
          <p className="hint bay-empty-note">empty bay — pick a surface or let the agent route one here.</p>
        )}
      </div>
    </section>
  );
}
