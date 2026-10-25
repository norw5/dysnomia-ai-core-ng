# Playbook: beat the home QING (targets, amounts, PLS budgeting)

> Operator playbook (session-65). Checked against kb/deployed-semantics.md —
> where the old community playbooks disagree with the deployed system, THIS
> file follows the deployed system. Positive framing: Beat is
> territory-expansion inputs.

## What the home QING is

MAP.New(your LAU) wraps your own account token into a fresh venue. One QING
per asset EVER, planet-wide — and your LAU is uniquely yours, so the venue is
uniquely yours, forever. It is a ONE-WAY claim: gas-only, no undo, the world
assigns the coordinates (a CHO.Luo lottery draw through HECKE — unpredictable
before the create), and the GWAT escrow lottery draws at creation (most
venues lock permanently — read `GWAT()` after). You are auto-STAFFED from
block one (cover/divisor/staff/guest-list powers) but NOT an owner; the deed
(DO.Take) is eligible on your home QING because the venue wraps your own
account token — Take it to gain the owners' surface.

## What Beat reads (the honest target list)

- **Fornax (YI's Psi, the FornaxSHIO channel)** — `XIE.Power` quotients:
  Omicron = Fornax(you) ÷ your Entropy, Omega = Fornax(the venue) ÷ the
  venue's Entropy. On your home QING BOTH sides are yours to grow: hold
  Fornax yourself, and the venue's own Fornax balance raises Omega.
- **Tethys (= CHO itself)** — Dione = Tethys(QING) ÷ Entropy (zi.sol:37).
  CHO parked at your venue counts.
- **Yuan modulus** — ZI/PANG divide by Yuan: `1×wallet + 10×LAU + 40×YUE`.
  Holdings parked in the YUE count 40× — never move rewards to the wallet
  for power reasons.
- **Caller lineage, NOT holdings** — the Beat floor is CALLER state: fresh
  callers get Eta (14,0,0,0) and Beat panics 0x12 at ANY funding level.
  No token purchase fixes this, and neither does rebalancing between
  wallet/LAU/YUE (the 1/10/40 Yuan weights shape OUTPUT size only; a
  zero-Yuan caller Beats fine). Aged callers (months of vault-advancing
  activity) Beat fine with Yeo rounding to 0 early. A fresh caller
  CANNOT be aged on demand — it is per-Soul history, the historical
  aging path (CHOA.Chat while the buffer was non-empty) is dead while
  the buffer is empty, and the fork-harness recipe is impersonating an
  aged EOA (the app never fakes lineage). Check `get_venue`'s
  Eta-readiness before budgeting anything — if `beatReady` is false,
  say so plainly and skip the doomed send.

## Amounts + acquisition honesty

- The **Fornax Goldilocks ceiling is REAL** on the deployed system (kb §2) —
  an agent that buys Fornax past the ceiling WILL revert. Acquire
  conservatively, in steps, preview-first; there is no sanctioned in-app
  Fornax market, so acquisition is an open-market (DEX) act outside this
  app's surfaces. Figures stay WPLS-anchored; never pseudo-USD.
- The whole oracle ladder is AT CAP (metered call counters) — at-cap
  contracts KEEP WORKING; only the self-mint stopped. Never gate a Beat on
  "contract at cap".
- Fresh QINGs carry NO Ⓐ market rate (`MarketRateNotFound` until an owner
  runs AddMarketRate — on your home QING, that owner-step is yours to
  request once you hold the deed).

## PLS budgeting

- Beat gas: median **1,916,016**, p90 1,933,099, all-observed max 2,315,227
  (a FAILED tx) — the 3M limit is right but not generous (kb §3). Budget
  **~2M gas per committed Beat** at the live RPC's gas price, and treat a
  Beat near the p90 as a signal to pause, not to retry blind.
- Settle (CHEON.Su) at the venues you visit — it is the close of a visit
  and pays a MAI-capped bounty (house money, ≤ 1) into your YUE.
- Previews are PURE: the shared Entropy head advances on committed calls
  only — DRYRUN verifies the failure class, never the final numbers. Plan
  sends from a fresh DRYRUN each time.

## The loop, end to end

1. `get_state` + `get_venue` (home QING): confirm YUE open, Eta readiness,
   and the venue's live state.
2. DRYRUN the Beat (`run_beat` without send) — the honest revert-class read.
3. Send through the gate (`send=true`); confirm what changed onchain.
4. Settle the visit (`settle_venue`), journal the lesson (`journal_note`).
