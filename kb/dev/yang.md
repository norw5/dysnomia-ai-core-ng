# YANG — "CHATLOG Yang" — the Tai triple + public coordinates

> Wave 1 · 2024-08-23 00:48 UTC · deployed `[chain]` · budget still liquid

## In player terms

| | |
|---|---|
| **The constitution, written once** | YANG has no public functions because its whole job finished in its constructor: it built the `Tai` triple of channels — two inherited (Bang from YAU, Le from ZHOU) and one its own (Lai, the Eris channel). |
| **Your birth certificate cites it** | Every new user's identity triple starts with `YANG.Pole(2)` — a fixed public coordinate YANG published at boot. Everyone born since carries the same kernel fingerprint in slot 0. |
| **Its channel is the busiest object in the world** | Eris (supply 99,279, at cap `[chain]`) is the token the wave-3 "qi" statistic divides by — the most economically load-bearing channel of the three. |
| **Quiet by design** | Like YAU, nothing routes here at runtime; it is a monument the rest of the system reads. |

## 1. Identity

| | |
|---|---|
| Address | `0xb702b3ec6d9de1011be963efe30a28b6ddfbe011` |
| Creation | block 21,220,699 — 2024-08-23 00:48 UTC (tx `0xf9ba776b97a532fe9015b44fef92db4d75c91110c378d1fef691a44da9592a14`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | CHATLOG Yang / YANG `[chain]` |
| Supply / cap | 92 / 4,932 — **liquid** (the least-used kernel organ) `[chain]` |
| Own channel | (Eris) Shio `0xE843765114992e18061498aeD708537cE9d924FA` — created in this constructor, same block/tx `[chain]` |

## 2. Role

Builds the `Tai` triple — `Bang` (from YAU.React), `Le` (from ZHOU.React),
`Lai` (its own "Yang Rod"/"MROD" + "Yang Cone"/"MCONE" pair = the (Eris)
SHIO) — Generates, Magnetizes and Installs `Lai`, then publishes `Pole[3]`
(the three coordinates SIU later hands to every new user as `Saat[0]`). The
ReactionsLib "ReactTo{Bang,Lai,Le}" family mixes exactly these three channels.

## 3. Dependencies

Owns YAU→ZHOU→ZHENG→YI (constructor adds itself down the whole chain). Called
by SIU (Pole(2)), ReactionsLib (ReactToBang/Lai/Le + ReactEris via Lai's soul
index), QI (Eris = the channel registered under Lai's soul).

## 4. State

`Mu` (YAU), `Rho` (the Tai triple — public getter), `Pole[3]` (public).

## 5. Functions

<!-- fntable: YANG @ 08_yang.sol -->
<!-- fntable-begin: YANG @ 08_yang.sol -->
Function table extracted mechanically from `08_yang.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address YauAddress)` | deployer | — | — | — |
| `Augment()` | internal | meter | — | — |
<!-- fntable-end -->

YANG has no public functions beyond inherited ones — everything happens in the
constructor (the triple build) and the auto-getters `Mu()`, `Rho()`, `Pole(uint256)`.

## 6. Integration notes

- `Pole(2)` is the system constant SIU copies into every user's Saat[0].
- The Eris channel (supply 99,279, at cap — the busiest kernel channel) is
  reachable via `Rho().Lai`.

## 7. Provenance

- [src] `08_yang.sol`.
- [chain] perimeter; last activity 2026-02-10.
