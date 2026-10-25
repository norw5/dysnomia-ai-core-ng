# MAI — "Dysnomia MAI" — pulse = venue holdings ÷ entropy

> Wave 3 (soeng I) · 2025-03-24 20:49 UTC · deployed `[chain]` · at cap

## In player terms

| | |
|---|---|
| **Your stake in a room, expressed as a number** | MAI(soul, venue) = how much of that venue's token you hold, over your entropy. Hold a slice of the FED QING's wrapped asset and the FED venue sees a pulse when you walk in. |
| **The bounty currency** | Chat-to-mine (CHOA) and settle (CHEON) both pay a bounty computed from your MAI — capped at 1 MAI per message/action. Holding venue tokens while chatting is the way the world pays attention to you. |
| **Again: taking the pulse moves it** | The read is an interaction (entropy advance + meter) — there are no free observations. |

## 1. Identity

| | |
|---|---|
| Address | `0xc48B0a4E79eF302c8Eb5be71F562d08fB8E6A3d8` |
| Creation | block 23,034,482 — 2025-03-24 20:49 UTC (tx `0x959b7dce66d070075a8a041a24127782f43398bbb4d64f432c19b5fcd86542fb`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | Dysnomia MAI / MAI `[chain]` |
| Supply / cap | 26,563 / 26,563 — **at cap** `[chain]` |

## 2. Role

脈 — the pulse/meridian layer (the HECKE meridians pun lives next door):
`React(soul, waat) = qing.balanceOf(user.Phi) ÷ user.Entropy` — how much of a
venue the user holds over their entropy. XIA composes MAI into Charge; CHOA's
chat-to-mine pays min(MAI(soul, waat), 1e18) MAI→CHOA into player YUEs; CHEON
repeats the same payout shape.

## 3. Dependencies

Holds `Qi` (public). Called by XIA (`Mai.React` inside Charge), CHOA.Chat,
CHEON.Su. Walks the CHO spine for users/venues.

## 4. State

`Qi` only.

## 5. Functions

<!-- fntable: MAI @ domain/soeng/02_mai.sol -->
<!-- fntable-begin: MAI @ domain/soeng/02_mai.sol -->
Function table extracted mechanically from `domain/soeng/02_mai.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address QiAddress)` | deployer | meter | — | — |
| `React(uint64 Soul, uint256 QingWaat) returns (uint256 Mai)` | public | meter | — | — |
<!-- fntable-end -->

Effects: `React` is non-view (advances the target user's entropy via
GetUserBySoul + meters) — the "pulse-taking" is an interaction, not a read.
Note where its output lands `[src: 02_mai.sol:25 +
02_choa.sol:48-51]`: `_mintToCap` mints to MAI itself, and the bounty
consumers (CHOA.Chat, CHEON.Su) use the RETURN VALUE only as an amount —
the tokens they pay into player YUEs are their own (CHOA from its
balance). No MAI is ever transferred to a player by the bounty path.

## 6. Integration notes

- The bounty family (CHOA/CHEON) caps payouts at 1 MAI per action — MAI's
  absolute values only matter proportionally.

## 7. Provenance

- [src] `domain/soeng/02_mai.sol`.
- [chain] perimeter.
