# QI — "DYSNOMIA Qi" — energy = Eris holdings ÷ entropy

> Wave 3 (soeng I) · 2025-03-24 17:11 UTC · deployed `[chain]` · at cap (the
> busiest contract of the whole family)

## In player terms

| | |
|---|---|
| **Your "energy level", derived not earned** | Your qi is a division the world performs on you: holdings of the Eris channel token ÷ your personal entropy. You cannot buy it directly — you change it by holding kernel-channel tokens and by living (entropy grows as you act, which DILUTES your qi — an active life makes you "cooler", statistically). |
| **Venues have it too** | Every QING has a qi: the venue's Eris holdings over the venue's entropy. Crowd a room with activity and its qi drifts. |
| **Reading a person changes them** | The per-soul variant is not a view call — looking someone up stirs their entropy as a side effect. In this world, taking someone's pulse is an interaction. |
| **The most-used organ past the hub** | Its cap (98,253 — the family's highest) is saturated `[chain]` — everything above it in the stack composes through here. |

## 1. Identity

| | |
|---|---|
| Address | `0x4d9Ce396BE95dbc5F71808c38107eB7422FD9a03` |
| Creation | block 23,033,185 — 2025-03-24 17:11 UTC (tx `0x6a5d4daa0cbbf95acd6389bdff4534f291d57292d3c418f15483427f57d5c7e2`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | DYSNOMIA Qi / QI `[chain]` |
| Supply / cap | 98,253 / 98,253 — **at cap**; highest cap in the family and it saturated `[chain]` |

## 2. Role

Bottom of the derived-physics ladder (气 — vital energy):
`ReactSoul(soul) = Eris.balanceOf(user.Phi) ÷ user.Entropy` (a person's qi =
their holdings of the YANG channel token over their personal entropy) and
`ReactWaat(waat) = Eris.balanceOf(qing) ÷ qing.Entropy` (a venue's qi).
Constructed against the Zürich QING as its `Zuo` anchor; hard-wires **Eris**
(YANG's SHIO) as its reference channel — the "constellation" tokens are the
ladder's physics constants.

## 3. Dependencies

- `Zuo` = the Zürich QING `0xb0ba7d36b7f0505879179ece7401f24eb653c6e1`;
  walks `Zuo.Cho()…` for users.
- Called by MAI (`ReactWaat` inside XIA), and heavily by third-party
  contract-internal readers (the 24–56M Random()/month grinder traffic
  documented for MATH touches this family — call-origin attribution is the
  open question).

## 4. State

`Zuo` (anchor QING), `Eris` (the SHIO). Both public.

## 5. Functions

<!-- fntable: QI @ domain/soeng/01_qi.sol -->
<!-- fntable-begin: QI @ domain/soeng/01_qi.sol -->
Function table extracted mechanically from `domain/soeng/01_qi.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address ZuoQingAddress)` | deployer | meter | — | — |
| `ReactSoul(uint64 Soul) returns (uint256 Qi)` | public | meter | — | — |
| `ReactWaat(uint256 Waat) returns (uint256 Qi)` | public | — | — | — |
<!-- fntable-end -->

Effects: `ReactSoul` — NON-VIEW: `GetUserBySoul` re-Recalls the user
(mutating their entropy!) before the division; every call meters.
`ReactWaat` — pure view over the venue's Eris balance and entropy.
Division by an entropy of 0 would revert ( Solidity div-by-zero) — not
observed as a practical issue since entropy advances on first use.

## 6. Integration notes

- The soul variant has SIDE EFFECTS (entropy advance on the target user +
  gas) — do not batch it like a view; use the Waat variant for venue reads.
- High-entropy users have LOW qi by construction (entropy dilutes stats —
  acting changes your derived numbers).

## 7. Provenance

- [src] `domain/soeng/01_qi.sol`.
- [chain] perimeter (98,253 = cap).
