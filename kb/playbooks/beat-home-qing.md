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
  Omicron = Fornax(LAU) ÷ your live Entropy, Omega = Fornax(the venue) ÷
  the venue's Entropy. On your home QING BOTH sides are yours to grow:
  park Fornax at your LAU (it is also a hard gate leg), and the venue's
  own Fornax balance raises Omega.
- **Tethys (= CHO itself)** — Dione = Tethys(QING) ÷ Entropy (zi.sol:37).
  CHO parked at your venue counts.
- **Yuan modulus** — ZI/PANG divide by Yuan: `1×wallet + 10×LAU + 40×YUE`.
  Holdings parked in the YUE count 40× — never move rewards to the wallet
  for power reasons.
- **The Eta TOKEN SEED — the real gate (session-82 correction)** — a
  fresh LAU can Beat today; "age/lineage" was a misreading of the token
  balances. The four legs:
  - **Fomalhaute = the WorldChatSHIO (`0x7aE7…`) AT THE LAU** —
    nonzero (≥ 2 wei) makes the `XIA.Charge` modExp modulus nonzero, so
    a zero MAI exponent yields 1 → `Chao`/`Charge1` nonzero.
  - **Fornax (`0xF6C5…`) AT THE LAU** — feeds `XIE.Power`'s Omicron;
    it must clear the live `Entropy` divisor.
  - **CHO (Tethys)** — hold enough that `Yuan` ≥ 2 (wallet counts 1×,
    LAU 10×, YUE 40×).
  - **Phobos (the first QING)** — hold enough that `Yuan(Phobos)` ≥ 2
    (same 1/10/40 weights).
  Remove any one leg and `Eta` returns zero Iota or zero Chao; Beat
  panics 0x12 (`Charge = … / Iota1` or `Yeo = Yeo / Chao`). The target
  venue's Yuan is NOT a revert gate — a seeded caller can Beat a venue
  it holds none of and gets `(0,0,0,0)` outputs, so Beat your home QING
  or an established venue according to the output you want. The live
  proof: a 21-minute-old LAU bought 0.0015 of each and landed a
  successful Beat (`0x081247c8…`); the cited wallet now previews
  `Beat(Phobos)` as `(14, 0, ~6.1e14, ~1.06e15)`. Check `get_venue`'s
  Eta-readiness before budgeting; if `beatReady` is false, name the
  missing seed legs (or say the wallet has no YUE at all) instead of
  claiming the account is too young.

## Amounts + acquisition honesty

- **Acquisition is now an in-app DEX leg (session-83)**: `swap_pls_for_token`
  turns native PLS into any ERC-20 through PulseX V2 (router
  `0x165C…`, WPLS `0xA107…`) via THE gate. It is EXACT-OUTPUT
  (`swapETHForExactTokens`): ask for exactly the amount, the router refunds
  unused PLS, and the send carries quote × (1 + 100 bps) as the value cap.
  The native route has **NO approve leg**. The seed recipe (four swaps;
  then Beat in the NEXT run — the default per-run send cap is 4):
  1. `swap_pls_for_token({token:"FOMALHAUTE", amountOutWei:"2", recipient:"lau"})`
  2. `swap_pls_for_token({token:"FORNAX", amountOutWei:"1000000000000000", recipient:"lau"})`
  3. `swap_pls_for_token({token:"CHO", amountOutWei:"2", recipient:"wallet"})`
  4. `swap_pls_for_token({token:"PHOBOS", amountOutWei:"2", recipient:"wallet"})`
  The Fornax leg is a STARTING point, not a guarantee: the live per-soul
  `Entropy` divisor can demand more, so preview `run_beat` after the four
  legs and retry a larger Fornax exact-output (`2e15`, `8e15`, … — a
  geometric ramp) on a zero Iota; with the default 4-send cap the retry is
  a new run. The pools are thin; the tool refuses a
  quote above its price-impact guard (`maxImpactBps`, default 5%) and
  honors `maxPls`. At the session-83 pin the four buys cost ~674 PLS of
  Fornax + dust for the rest (quotes move; always quote fresh). Figures
  stay WPLS-anchored; never pseudo-USD.
- **No static Fornax ceiling on the deployed third revision** (session-82.1):
  the old `Max_Fornax = Xia.Charge(Phobos) × LAU.Entropy` ceiling is the
  April/source formula. A controlled fork sweep (Fornax 1e15..1e22 with the
  four-token seed) kept `Eta.Chao = 1`; Beat succeeded at every level except
  a 1e19 state where `Iota` zeroed consistently (`Panic(0x12)` — a modExp/entropy draw,
  not a cap). Preview every send and retry a zero draw; do not buy "up to a
  formula ceiling" or stop below one. Figures stay WPLS-anchored; never
  pseudo-USD.
- **Exact floors (fork-pinned, session-82.1)**:
  - `Fomalhaute` at the LAU: **2 wei** (1 wei → `Chao=0` → `Yeo/Chao`
    panics; the old ">=1 wei" is off by one).
  - `CHO` / `Phobos` Yuan: **≥2** — 1 wei in the WALLET gives `Yuan=1` and
    fails; 1 wei at the LAU counts 10, at the YUE 40.
  - `Fornax` at the LAU: above the live `Entropy` draw; 1e15 worked, a
    1e19 state zeroed Iota consistently on the same fork — preview/retry.
  - The target QING's Yuan is **not a revert gate**: zero target holdings
    succeed with `(0,0,0,0)`; the venue's own Tethys/Entropy sets Dione.
- **Dione is the venue's own Tethys/Entropy** — target a venue with a
  nonzero CHO balance; only the QING owner can `Withdraw`, so NEVER send
  CHO to an unowned QING (the old guides' donation trap is real). A
  successful Beat with `Dione=0` is a no-map-output success.
- **Phobos is the universal accumulator** — every Beat forces a
  `Yue.React(Phobos)`, so its Hypobar grows with network activity. Targeting
  Phobos can give the largest territory but is volatile and its underlying
  asset is thin/expensive; the home QING is the stable alternative.
- **Modulus-trap heuristic** (community lore): flat whole-token Yuan
  balances can zero `modExp` outputs on some draws; odd/fractional amounts
  and previews reduce the surprise. The old "10%" figure is not a measured
  law — our 1e19 flat Fornax state zeroed Iota while 1e20/1e22 succeeded.
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
