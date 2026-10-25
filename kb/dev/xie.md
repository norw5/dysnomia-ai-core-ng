# XIE — "Dysnomia Xie" — leak: charge + Fornax overflows

> Wave 4 (soeng II) · 2025-05-28 18:16 UTC · deployed `[chain]` · at cap

## In player terms

| | |
|---|---|
| **The standard readout** | `Power(venue)` is the tuple everything above the ladder consumes: your Charge there, plus two quotients of the kernel's oldest channel (Fornax): your holdings over your entropy, and the venue's holdings over its entropy. One call = the venue's vital signs through your lens. |
| **The accumulator behind your account** | Every CHOA chat and CHEON settle pushes Power's Fornax quotients into your YUE's per-venue bars — this is the machinery that "remembers" your venue presence. |
| **The diagnostic chain, complete** | QI (energy) → MAI (pulse) → XIA (charge) → XIE (leak). A Chinese-medicine reading of a person-in-a-place, executed as chained modular arithmetic. |
| **One call, one ladder of gas** | Power recomputes the whole chain beneath it — batch readers should call once and reuse. |

## 1. Identity

| | |
|---|---|
| Address | `0x4Df51741F2926525A21bF63E4769bA70633D2792` |
| Creation | block 23,585,994 — 2025-05-28 18:16 UTC (tx `0xba40f912e848365522d2ded2cac4c7f93cf25c3c318f5d2eedc7ec34c553780b`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | Dysnomia Xie / XIE `[chain]` |
| Supply / cap | 20,930 / 20,930 — **at cap** `[chain]` |
| Wave note | the failed create `0x50d70a4eC6F50368213BF6cA3287363edd84BA43` (block 23,585,947) sits 47 blocks BEFORE XIE — an empty-code attempt minutes earlier `[chain]` |

## 2. Role

泄 (leak/overflow): `Power(waat) → (Charge, Omicron, Omega)` — XIA's charge
plus two Fornax quotients: `Omicron = Fornax.balanceOf(user) ÷ user.Entropy`
and `Omega = Fornax.balanceOf(qing) ÷ qing.Entropy`. **Fornax = YI's own Psi
SHIO** (hard-wired via `…Eta().Psi()`), so the leak reads the kernel's oldest
channel. XIE's outputs are the per-QING bars YUE accumulates (Hypobar/
Epibar += Omega/Omicron) — every CHOA/CHEON action lands here.

## 3. Dependencies

Holds `Xia` (→ MAI → QI chain) + `Fornax`. Called by CHAN.ReactYue →
YUE.React (per-QING bars), ZI.Spin, PANG.Push.

## 4. State

`Xia`, `Fornax` — public.

## 5. Functions

<!-- fntable: XIE @ domain/soeng/04_xie.sol -->
<!-- fntable-begin: XIE @ domain/soeng/04_xie.sol -->
Function table extracted mechanically from `domain/soeng/04_xie.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address XiaAddress)` | deployer | meter | — | — |
| `Power(uint256 QingWaat) returns (uint256 Charge, uint256 Omicron, uint256 Omega)` | public | meter | — | — |
<!-- fntable-end -->

Effects: `Power` — one call composes the whole ladder beneath it (XIA.Charge
+ MAI.React inside) and meters once. Non-view (advances the current user).

## 6. Integration notes

- The (Charge, Omicron, Omega) triple is the standard "venue physics" tuple
  everything above consumes — batch readers should call Power once and reuse.
- Requires a CHO session for the user half.

## 7. Provenance

- [src] `domain/soeng/04_xie.sol`.
- [chain] perimeter; failed-create note (deployer forensics).
