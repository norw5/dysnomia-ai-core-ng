import { memo, useEffect, useRef, useState } from "react";
import { encodeFunctionData, type Abi, type AbiFunction, type Address } from "viem";
import { EXPLORER_BASE, addr } from "@config/addresses";
import { loadAbi } from "@/chain/abiLoad";
import { makeClient } from "@/chain/client";
import {
  affectionApproveData,
  AFFECTION_UNIT,
  dssChatAndSnipeData,
  lauChatData,
} from "@/chain/dssDesk";
import { useGateAction } from "@/chain/useGateAction";
import { useAgent } from "@/agent/store";
import { useWallet } from "@/wallet/WalletContext";
import { useDss } from "@/state/dssStore";
import { ApprovalCard } from "@/ui/ApprovalCard";
import type { PlayerSnapshot } from "@/chain/identity";
import type { GateEnvelope, GateOutcome } from "@/chain/txGate";

/**
 * The CHAT composer (session-71.1, the owner's review round): ONE line —
 * input + counter + the DSS arm + DRY + SEND. The TARGET is the channel
 * being VIEWED (regular chat-app semantics — the route dropdown is dead,
 * it could disagree with the view):
 *
 *  - viewing a venue → CHOA.Chat(Qing, MSG): venue chat that pays (gas
 *    only; mints 1 QING supply-side; while CHOA's buffer is non-empty up
 *    to 1 CHOA moves from CHOA's OWN balance into your YUE —
 *    contract-funded, never caller-paid, never "MAI"). Requires YUE.
 *
 *  - viewing THE VOID → your LAU.Chat(MSG): posts "<Username> MSG" onto
 *    the world SHIO AND meters 1 unit of the LAU into its
 *    publicly-purchasable pool (anyone can buy it at 1 Ⓐ — collect it on
 *    IDENTITY or accept the window). Needs Username; no YUE.
 *
 *  - the ARM checkbox (world only, needs a captured DSS): the same world
 *    line through chatAndSnipe — pulls exactly 1 Ⓐ and self-purchases the
 *    minted unit ATOMICALLY (no front-run window). Short Ⓐ allowance →
 *    the exact-1e18 APPROVE rides first (two gate sends).
 *
 * The cost-model copy lives in tooltips + the one target line — the old
 * three-paragraph explainer is gone. §7.4 opt-in gates the whole surface;
 * every send rides THE gate (DRYRUN-first).
 */

export const CHAT_MESSAGE_MAX = 280;

function pickFn(abi: Abi, name: string, inputCount: number): AbiFunction {
  const hits = abi.filter((e): e is AbiFunction => e.type === "function" && e.name === name && e.inputs.length === inputCount);
  if (hits.length === 0) throw new Error(`ABI fragment not found: ${name}/${inputCount}`);
  return hits[0]!;
}

export function messageFenceError(message: string): string | null {
  if (message.trim().length === 0) return "empty message";
  if (message.length > CHAT_MESSAGE_MAX) return `${message.length} chars > ${CHAT_MESSAGE_MAX} (the §7.4 fence)`;
  return null;
}

/** the plain-language remedy for a policy denial (71.4): the raw reasons are
 *  accurate but not teachable — the owner hit "unknown destinations are
 *  disabled" with zero hint what to do about a DSS snipe */
export function denialRemedy(reasons: string[]): string | null {
  const joined = reasons.join("; ");
  if (/unknown destinations|not in the perimeter|deployment disabled/i.test(joined)) {
    return "the target is outside the perimeter — allow unknown destinations + mode-C breadth in SETTINGS (or switch to wallet mode A/B for the approval card)";
  }
  if (/cap/i.test(joined)) return "a policy cap binds this send — the caps live in SETTINGS";
  return null;
}

function OutcomeLine({ outcome, yolo }: { outcome: GateOutcome; yolo: boolean }) {
  if (outcome.status === "denied")
    return (
      <span className="err-text" title={outcome.reasons.join("; ")}>
        DENIED by policy: {outcome.reasons.join("; ")}
        {denialRemedy(outcome.reasons) !== null && ` — ${denialRemedy(outcome.reasons)}`}
      </span>
    );
  if (outcome.status === "sim-failed")
    return (
      <span className="err-text" title="the DRYRUN (eth_call) reverted — previews are pure; the real state may differ. for an armed snipe the usual cause is insufficient Ⓐ balance (the bundler purchases 1 Ⓐ from YOUR balance)">
        blocked: DRYRUN reverted{yolo ? " — yolo has no override card (details in SYSTEM_LOGS)" : " — override needs the explicit card ack"}
      </span>
    );
  if (outcome.status === "aborted") return <span className="err-text">aborted: {outcome.reason}</span>;
  return (
    <>
      <span className="ok-text">sent</span>
      <a
        className="outlink mono"
        href={`${EXPLORER_BASE.replace(/\/address\/$/, "/tx/")}${outcome.txHash}`}
        target="_blank"
        rel="noreferrer noopener"
        title={`tx ${outcome.txHash} · gas ${outcome.receipt?.gasUsed.toString() ?? "…"} — the full receipt lives in SYSTEM_LOGS`}
      >
        {outcome.txHash.slice(0, 10)}…↗
      </a>
    </>
  );
}

/**
 * The subtle outcome toast (71.2): one absolutely-positioned line above the
 * composer row — successes FADE (the receipt is in SYSTEM_LOGS for the
 * detail; the explorer link rides the hover), failures stay until the next
 * action. NEVER shifts the layout.
 */
function ComposerToast({
  outcome,
  sim,
  error,
  nonce,
  yolo,
}: {
  outcome: GateOutcome | null;
  sim: GateEnvelope | null;
  error: string | null;
  /** bumped per DRY/SEND so repeated actions re-toast */
  nonce: number;
  yolo: boolean;
}) {
  const [fading, setFading] = useState(false);
  const ok = outcome !== null ? outcome.status === "sent" : error === null && sim !== null && sim.sim !== null ? sim.sim.ok : null;

  useEffect(() => {
    setFading(false);
    if (ok === true) {
      const t = window.setTimeout(() => setFading(true), 9_000);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  if (ok === null) return null;
  return (
    <div
      className={`composer-toast${ok ? " ok" : " err"}${fading ? " fade" : ""}`}
      data-testid="composer-outcome"
      title={ok ? undefined : "click to dismiss — details in SYSTEM_LOGS"}
      onClick={() => setFading(true)}
    >
      {outcome !== null ? (
        <OutcomeLine outcome={outcome} yolo={yolo} />
      ) : error !== null ? (
        <span className="err-text">{error.slice(0, 120)}</span>
      ) : sim !== null && sim.sim !== null ? (
        sim.sim.ok ? (
          <span className="ok-text mono">DRYRUN ok · gas ~{sim.sim.gas?.toString() ?? "?"} · preview is pure</span>
        ) : (
          <span className="err-text mono">
            DRYRUN revert{sim.sim.error?.decoded ? `: ${sim.sim.error.decoded}` : ""} — preview is pure; the override needs the card
          </span>
        )
      ) : null}
    </div>
  );
}

export const ChatComposer = memo(function ChatComposer({
  snapshot,
  venue,
  mode,
  rpcUrl,
  onSent,
}: {
  snapshot: PlayerSnapshot | null;
  /** the viewed venue (venue mode = the channel being read; null = none) */
  venue: { a: string; n: string; s: string } | null;
  mode: "world" | "venue";
  /** for the Ⓐ-allowance read on the armed DSS route */
  rpcUrl: string;
  onSent: () => void;
}) {
  const agent = useAgent();
  const wallet = useWallet();
  const action = useGateAction();
  const account = (wallet.account ?? null) as Address | null;
  const enabled = agent.settings.chatToolsEnabled;
  const dssRecord = useDss(account);
  const dss = dssRecord?.dss ?? null;

  const [choaAbi, setChoaAbi] = useState<Abi | null>(null);
  /**
   * The text lives in a REF, not state (71.3, the owner's key-hold freeze):
   * a controlled textarea re-rendered the composer per keystroke (~16ms avg
   * + 200ms spikes in dev React) — at key-repeat cadence (~30ms) the event
   * queue avalanched into a multi-second freeze. The DOM textarea is the
   * source of truth; only the COUNTER rides a debounced state update.
   */
  const text = useRef("");
  const [len, setLen] = useState(0);
  const lenTimer = useRef<number | null>(null);
  const [probe, setProbe] = useState<GateEnvelope | null>(null);
  /** bumped per DRY/SEND — re-toasts repeated actions */
  const [toastNonce, setToastNonce] = useState(0);
  const [dssArmed, setDssArmed] = useState(false);
  const [snipeAllowance, setSnipeAllowance] = useState<bigint | null>(null);
  const chained = useRef<(() => void) | null>(null);
  /** the last sent text — restored when a send fails (71.2 clear-on-send) */
  const lastText = useRef("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const syncLen = (value: string) => {
    if (lenTimer.current !== null) window.clearTimeout(lenTimer.current);
    lenTimer.current = window.setTimeout(() => setLen(value.length), 120);
  };
  const setTextVal = (value: string) => {
    text.current = value;
    const el = inputRef.current;
    if (el !== null && el.value !== value) el.value = value;
    syncLen(value);
  };
  useEffect(() => () => {
    if (lenTimer.current !== null) window.clearTimeout(lenTimer.current);
  }, []);

  // auto-grow (71.2): one line, expands with content up to a cap, then
  // scrolls internally — Enter sends, Shift+Enter breaks the line
  // (auto-grow is CSS `field-sizing: content` — no per-keystroke layout work)

  useEffect(() => {
    setChoaAbi(null);
    loadAbi("CHOA.json")
      .then(setChoaAbi)
      .catch(() => setChoaAbi(null));
  }, []);

  // disarm when leaving the world channel (the arm is a world-route tool)
  useEffect(() => {
    if (mode !== "world") setDssArmed(false);
  }, [mode]);

  const snipe = mode === "world" && dssArmed && dss !== null;

  // the armed DSS route's Ⓐ allowance (unreadable = treated as short — the
  // deskTools precedent); re-read while armed
  useEffect(() => {
    if (!snipe || account === null || dss === null) {
      setSnipeAllowance(null);
      return;
    }
    let alive = true;
    const client = makeClient(rpcUrl);
    const erc20 = [
      { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
    ] as const;
    void client
      .readContract({ address: addr("AFFECTION"), abi: erc20, functionName: "allowance", args: [account, dss] })
      .then((a) => {
        if (alive) setSnipeAllowance(a);
      })
      .catch(() => {
        if (alive) setSnipeAllowance(null);
      });
    return () => {
      alive = false;
    };
  }, [rpcUrl, snipe, account, dss]);

  useEffect(() => {
    if (action.outcome?.status === "sent") {
      const next = chained.current;
      chained.current = null;
      if (next) next();
      else onSent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.outcome]);

  // a failed send RESTORES the text (never lose the user's words); only
  // restores when the box is still empty — mid-send retyping wins
  useEffect(() => {
    const failed = action.outcome !== null || action.error !== null;
    if (!failed) return;
    const okSent = action.outcome?.status === "sent";
    if (!okSent && text.current.length === 0 && lastText.current.length > 0) {
      setTextVal(lastText.current);
      lastText.current = "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.outcome, action.error]);

  if (!enabled) {
    return (
      <p className="hint" data-testid="composer-disabled">
        the composer is OFF — posting rides the §7.4 chat opt-in (SETTINGS → Agent → chat tools),
        OFF by default. each chat call costs GAS only.
      </p>
    );
  }

  const lau = (snapshot?.lau ?? null) as Address | null;
  const yue = snapshot?.yue ?? null;
  const usernameSet = snapshot?.username != null;
  const fence = messageFenceError(text.current);
  const venueAddr = (venue?.a ?? null) as Address | null;
  const snipeShort = dss !== null && (snipeAllowance === null || snipeAllowance < AFFECTION_UNIT);

  const request = (): | { to: Address; data: `0x${string}`; meta: { source: "manual"; label: string } } | null => {
    if (account === null || text.current.trim().length === 0) return null;
    if (mode === "venue") {
      if (!choaAbi || !venueAddr || !lau) return null;
      return {
        to: addr("CHOA"),
        data: encodeFunctionData({ abi: [pickFn(choaAbi, "Chat", 2)], functionName: "Chat", args: [venueAddr, text.current] }),
        meta: { source: "manual" as const, label: `CHAT composer → ${venue?.n || venueAddr}` },
      };
    }
    if (snipe) {
      if (dss === null) return null;
      return {
        to: dss,
        data: dssChatAndSnipeData(text.current),
        meta: { source: "manual" as const, label: "CHAT composer → WORLD + self-snipe (DSS)" },
      };
    }
    if (!lau) return null;
    return {
      to: lau,
      data: lauChatData(text.current),
      meta: { source: "manual" as const, label: "CHAT composer → WORLD (your LAU)" },
    };
  };

  const dryRun = async () => {
    const req = request();
    if (!req || !account || messageFenceError(text.current) !== null) return;
    setToastNonce((n) => n + 1);
    setProbe(null);
    setProbe(await action.probe({ ...req, account }));
  };

  const send = async () => {
    const req = request();
    // the fence is re-read LIVE: the SEND button's disabled state rides the
    // 120ms counter debounce, so a paste-then-click must still refuse
    if (!req || !account || messageFenceError(text.current) !== null) return;
    lastText.current = text.current;
    setToastNonce((n) => n + 1);
    setTextVal(""); // clear optimistically — a failed send restores it
    if (snipe && snipeShort && dss !== null) {
      // the auto-approve-when-short pattern: exact 1e18 Ⓐ APPROVE
      // (spender = the DSS) first, then the snipe — two gate sends
      chained.current = () =>
        void action.begin({
          ...req,
          account,
        });
      await action.begin({
        to: addr("AFFECTION"),
        data: affectionApproveData(dss, AFFECTION_UNIT),
        account,
        meta: { source: "manual", label: "composer approve Ⓐ → your DSS (exact 1)" },
      });
      return;
    }
    await action.begin({ ...req, account });
  };

  const routeBlocked = mode === "venue" ? venueAddr === null || !choaAbi : false;
  const gateBlocked = action.busy || account === null || lau === null || !usernameSet || routeBlocked || (mode === "venue" && !yue);
  const baseDisabled = gateBlocked || fence !== null;
  /** the LIVE gate for immediate paths (Enter): the fence must read the ref
   *  NOW — renders lag the uncontrolled textarea by the debounced counter */
  const canSendNow = (): boolean => !gateBlocked && messageFenceError(text.current) === null;

  const routeName = mode === "venue" ? "CHOA.Chat" : snipe ? "chatAndSnipe" : "LAU.Chat";

  return (
    <div className="world-composer" data-testid="world-composer">
      <p className="hint chat-composer-target" data-testid="composer-route">
        →{" "}
        {mode === "venue" ? (
          <>
            <span className="mono chat-composer-name">{venue && venue.n.length > 0 ? venue.n : venueAddr ?? "no venue"}</span>{" "}
            <span className="mono dim">CHOA.Chat</span>{" "}
            <span
              className="dim"
              title="venue chat that pays: GAS only; mints 1 venue token supply-side; while CHOA's buffer is non-empty, up to 1 CHOA moves from CHOA's OWN balance into your YUE — contract-funded, never caller-paid (never 'MAI')."
            >
              ⓘ
            </span>
          </>
        ) : (
          <>
            <span className="mono chat-composer-name">THE VOID — world</span>{" "}
            <span className="mono dim">{snipe ? "chatAndSnipe via your DSS" : "LAU.Chat (your LAU)"}</span>{" "}
            <span
              className="dim"
              title={snipe ? "the atomic route: the line posts AND exactly 1 Ⓐ buys the minted unit back to you in one tx — no front-run window." : "posts '<Username> …' onto the world SHIO and meters 1 unit of your LAU into its publicly-purchasable pool — anyone can buy it at 1 Ⓐ; collect on IDENTITY or accept the window."}
            >
              ⓘ
            </span>
          </>
        )}
      </p>
      <div className="chat-composer-row" data-testid="composer-row">
        <textarea
          ref={inputRef}
          className="mono chat-composer-input"
          aria-label="chat message"
          spellCheck={false}
          rows={1}
          placeholder={mode === "venue" ? `say something to ${venue && venue.n.length > 0 ? venue.n : "the venue"}` : "say something to the world"}
          defaultValue=""
          onChange={(e) => {
            text.current = e.target.value;
            syncLen(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSendNow()) void send();
            }
          }}
          data-testid="composer-input"
        />
        <span className={`hint mono ${fence && len > CHAT_MESSAGE_MAX ? "err-text" : ""}`} data-testid="composer-count">
          {len}/{CHAT_MESSAGE_MAX}
        </span>
        {mode === "world" && (
          <label
            className={`chat-arm${dss === null ? " off" : ""}`}
            data-testid="composer-arm-label"
            title={
              dss === null
                ? "no DSS captured — deploy the self-snipe bundler on IDENTITY (the emission desk) first"
                : snipeShort
                  ? "armed: the line self-purchases its minted LAU unit atomically for exactly 1 Ⓐ FROM YOUR BALANCE (allowance short — the exact-1 approve rides first: two sends). the DSS is outside the perimeter: yolo needs unknown-destinations + breadth ON in SETTINGS, or a carded wallet mode"
                  : "armed: the line self-purchases its minted LAU unit atomically for exactly 1 Ⓐ FROM YOUR BALANCE (no front-run window). the DSS is outside the perimeter: yolo needs unknown-destinations + breadth ON in SETTINGS, or a carded wallet mode"
            }
          >
            <input
              type="checkbox"
              checked={snipe}
              disabled={dss === null}
              onChange={(e) => setDssArmed(e.target.checked)}
              data-testid="composer-arm"
            />
            via DSS
          </label>
        )}
        <button className="btn" disabled={baseDisabled} onClick={() => void dryRun()} data-testid="composer-dryrun">
          DRY
        </button>
        <button
          className="btn btn-primary"
          disabled={baseDisabled}
          onClick={() => void send()}
          title={`${routeName} ${wallet.mode === "A" ? "— wallet prompts" : wallet.mode === "C" ? "— yolo: policy only" : "— approval card"}`}
          data-testid="composer-send"
        >
          SEND
        </button>
      </div>
      {mode === "venue" && venue === null && (
        <p className="hint">no venue in view — pick a channel in the list.</p>
      )}
      {account && !lau && <p className="hint">you need a LAU first (IDENTITY → create).</p>}
      {account && lau && !usernameSet && <p className="hint">chat paths need your Username set first (IDENTITY).</p>}
      {account && mode === "venue" && !yue && (
        <p className="hint" data-testid="composer-no-yue">
          CHOA.Chat resolves your vault first — open your YUE (SEI.Start) or the call reverts
          NotStarted.
        </p>
      )}
      {/* the subtle outcome line — floats above the row, never shifts layout;
          the full receipts live in SYSTEM_LOGS (71.2) */}
      <ComposerToast outcome={action.outcome} sim={probe} error={action.error} nonce={toastNonce} yolo={wallet.yolo} />
      {action.envelope && (
        <ApprovalCard
          envelope={action.envelope}
          mode={wallet.mode}
          busy={action.busy}
          onResolve={(accept, allowSimFailure) => {
            if (!accept) {
              action.reject();
              return;
            }
            void action.confirm(allowSimFailure);
          }}
        />
      )}
    </div>
  );
});
