# CHEON — "Dysnomia Cheon" — the settle primitive

> Wave 5 · 2025-06-13 20:20 UTC · deployed `[chain]` · at cap

## In player terms

| | |
|---|---|
| **The "close out the night" button** | `Su(venue)` settles you at a room in one call: advance your account's venue bars, pay you a small bounty from the house's own MAI (while it lasts, max 1), drip one unit of your account token home, and hand you the refreshed vital signs. **It is the ecosystem's most-called function** — 24,069 direct calls by 64 wallets `[chain]` (call-origin census). |
| **The designed heartbeat of the world layer** | The undeployed WORLD's tile actions would have called Su as their settle step — the machinery shipped, its biggest customer didn't. Live usage is direct calls and CHOA-era flows. |
| **Needs an account** | No YUE, no settle (`NotStarted` from SEI.Chi). |

## 1. Identity

| | |
|---|---|
| Address | `0x3d23084cA3F40465553797b5138CFC456E61FB5D` |
| Creation | block 23,720,373 — 2025-06-13 20:20 UTC (tx `0xb80259c5e88ff28b8b9803e2ece6e3d4b561495ea9f9f7717245830fd07e35de`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | Dysnomia Cheon / CHEON `[chain]` |
| Supply / cap | 91,700 / 91,700 — **at cap** `[chain]` |

## 2. Role

天 (heaven): `Su(qing)` is the **settle primitive** — ReactYue (advance the
player's YUE bars through XIE.Power), pay the player a MAI bounty
(`min(MAI(soul, waat), 1e18)` from CHEON's own balance into the YUE), call
`YueMintToOrigin` (the YUE's 1-unit drip to the player), and return the
`(Charge, Hypobar, Epibar)` bars. The undeployed WORLD.Code consumes Su
directly; live usage flows through CHOA-era actions and direct calls.

## 3. Dependencies

- Holds `Sei`; adds itself to CHO + CHAN at construction.
- Called by WORLD (undeployed) and by players/tools settling venues.

## 4. State

`Sei` — public.

## 5. Functions

<!-- fntable: CHEON @ domain/tang/02_cheon.sol -->
<!-- fntable-begin: CHEON @ domain/tang/02_cheon.sol -->
Function table extracted mechanically from `domain/tang/02_cheon.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address SeiAddress)` | deployer | meter | — | — |
| `Su(address Qing) returns (uint256 Charge, uint256 Hypobar, uint256 Epibar)` | public | meter | — | — |
<!-- fntable-end -->

Effects: `Su` — the four-step settle (ReactYue → MAI payout → YueMintToOrigin
→ bars); meter once. Bounties are house money: paid only while CHEON's own
MAI balance lasts.

## 6. Integration notes

- Su requires the caller to have a YUE (Sei.Chi reverts `NotStarted`
  otherwise).
- The bounty cap is 1 MAI per settle — the same shape CHOA.Chat pays.

## 7. Provenance

- [src] `domain/tang/02_cheon.sol`.
- [chain] perimeter.
