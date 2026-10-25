# CHOA — "Dysnomia Chao" — play + chat-to-mine + purchasing power

> Wave 5 · 2025-06-13 20:26 UTC · deployed `[chain]` · at cap · active this month `[chain]`

## In player terms

| | |
|---|---|
| **Play = show up** | `Play(yourLAU)` registers your account for the venue layer (creating the YUE on first contact if SEI hasn't). The gentlest possible onboarding: one call, you're a player. |
| **Chat-to-mine** | `Chat(venue, msg)` sends a real venue message (full door rules apply) AND pays you: your stake-derived bounty lands in your account, your venue bars advance, the house meter ticks. Talking IS the mining. |
| **Your weighted worth** | `Yuan(token)` prices any wallet as `1×wallet + 10×LAU + 40×YUE` — identity and account count for more than raw cash. This is the modulus the whole spin ladder turns against. |
| **One message, eight meters** | A single CHOA chat advances the usage counters of eight contracts at once — the densest action in the system, and the worked example of how interlocked this world is. |

## 1. Identity

| | |
|---|---|
| Address | `0x0f5a352fd4cA4850c2099C15B3600ff085B66197` |
| Creation | block 23,720,409 — 2025-06-13 20:26 UTC (tx `0x9f744451e19f12d25ae6ec2931710eb9a5b44d256f42ea83d3af7cb6a1249d3e`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | Dysnomia Chao / CHOA `[chain]` (the onchain name really is "Chao") |
| Supply / cap | 46,329 / 46,329 — **at cap** `[chain]` |

## 2. Role

The play/chat surface of the account layer: `Play(lau)` enters + registers
the player's YUE; **`Chat(qing, msg)` is chat-to-mine** — venue chat through
the QING's admission rules + `ReactYue` (advance) + a bounty of
`min(MAI(soul, waat), 1e18)` MAI→CHOA paid from CHOA's own balance into the
player's YUE. `Yuan(currency)` is the purchasing-power modulus the physics
ladder spins against: `bal(tx.origin) + 10×bal(LAU) + 40×bal(YUE)` — a
player's weighted wallet.

## 3. Dependencies

Holds `Sei`; owns CHAN. Called by ZI/Tethys wiring (Yuan), players (Play/
Chat). Reads QING.Chat (admission + LogEvent) and the MAI ladder.

## 4. State

`Sei`, `_players` (soul → YUE registration).

## 5. Functions

<!-- fntable: CHOA @ domain/sky/02_choa.sol -->
<!-- fntable-begin: CHOA @ domain/sky/02_choa.sol -->
Function table extracted mechanically from `domain/sky/02_choa.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address SeiAddress)` | deployer | meter | — | — |
| `Yuan(address Currency) returns (uint256 Bae)` | public | — | — | — |
| `Play(address UserTokenAddress) returns (YUEINTERFACE Chi, LAU UserToken)` | public | meter | — | — |
| `Chat(address Qing, string memory MSG) returns (uint256 Charge)` | public | meter | — | — |
<!-- fntable-end -->

Effects: `Yuan` — view; the 1:10:40 weighting. `Play` — Enter + Chi +
first-time YueMintToOrigin + registration; metered. `Chat` — QING.Chat then
ReactYue then the MAI bounty transfer (only while CHOA's balance lasts);
returns the venue Charge. Chat failing the venue's admission reverts inside
QING.Chat (its own error set).

Bounty token identity, precisely `[src: 02_choa.sol:48-51 +
02_mai.sol:24-25]`: the AMOUNT is computed by `MAI.React` (capped at 1e18),
but the TOKEN delivered into the player's YUE is **CHOA itself**, paid from
CHOA's own balance (`_transfer(address(this), address(Yue), Mai)`). The
`MAI.React` leg mints its MAI to MAI's own address — no MAI ever moves to
the player. "Chat pays MAI" is therefore loose shorthand: chat pays
**MAI-priced CHOA**.

## 6. Integration notes

- Chat requires: a YUE (Sei.Chi), CHO entry (auto via Play), and the QING's
  admission rules (see [qing.md](./qing.md)).
- A chat line through CHOA advances ~8 call-counters at once (QING + CHAN +
  YUE + XIE + XIA + MAI + QI + CHOA) — the interplay doc's worked example
  (05-interplay §2).
- The ZI "Tethys" variable resolves to CHO (not CHOA) — the two "Cho"s are
  distinct contracts; keep addresses straight.

## 7. Provenance

- [src] `domain/sky/02_choa.sol`.
- [chain] perimeter; liveness (active 2026-09).
