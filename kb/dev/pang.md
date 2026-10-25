# PANG — "Dysnomia Pang" — collision push

> Wave 5 · 2025-06-15 00:53 UTC · deployed `[chain]` · at cap

## In player terms

| | |
|---|---|
| **The top of the ladder** | PANG.Push runs the full diagnostic chain twice over (XIE's read + ZI's spin) and then "pushes" both results through two more modular exponentiations against the venue's purchasing power. Collision, as a number. |
| **The heaviest read in the world** | One Push costs roughly two full ladders of nested calls — the world's most expensive single question you can ask about a venue. RING and META both ask it, so every oracle tick pays this gas. |
| **Why bother** | Push's five outputs are the raw material of the tile oracle (META.Beat) — the numbers that would have decided where territory could expand. Even with the world layer undeployed, the oracle machinery runs and is probeable by anyone. |

## 1. Identity

| | |
|---|---|
| Address | `0xEe25Ccd41671F3B67d660cf6532085586aec8457` |
| Creation | block 23,730,519 — 2025-06-15 00:53 UTC (tx `0x49e9166a65ff97efaa30bcf5c6135a06051129d2a68b9ccbf995a67c764b4e1`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | Dysnomia Pang / PANG `[chain]` |
| Supply / cap | 16,602 / 16,602 — **at cap** `[chain]` |
| Wave note | the failed WORLD-shaped create `0x853C1be1D2bBEC817b9043608fEbb20a223CdCEf` (block 23,730,303) sits 216 blocks BEFORE PANG — the world-layer deploy attempt that never produced code `[chain]` |

## 2. Role

碰 (collide): `Push(waat) → (Iota, Omicron, Eta, Omega, Charge)` — the
composition apex of the soeng ladder: XIE.Power + ZI.Spin, then
`Omicron = modExp(Omicron, Charge, Yuan(qing))` and
`Iota = modExp(Iota, qing.Entropy, Yuan(qing))` — two "pushes" against the
venue's purchasing-power modulus. RING.Eta and META.Beat consume Push
directly; the undeployed WORLD would have consumed it via those.

## 3. Dependencies

Holds `Zi` (full chain beneath). Called by RING.Eta, META.Beat (via
`Ring.Pang()`).

## 4. State

`Zi` — public.

## 5. Functions

<!-- fntable: PANG @ domain/soeng/06_pang.sol -->
<!-- fntable-begin: PANG @ domain/soeng/06_pang.sol -->
Function table extracted mechanically from `domain/soeng/06_pang.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address ZiAddress)` | deployer | meter | — | — |
| `Push(uint256 QingWaat) returns (uint256 Iota, uint256 Omicron, uint256 Eta, uint256 Omega, uint256 Charge)` | public | meter | — | — |
<!-- fntable-end -->

Effects: `Push` — the heaviest single read path in the system (XIE + ZI both
recompute the whole ladder); meters once. Requires a CHO session.

## 6. Integration notes

- Callers interested in only one output still pay the full ladder gas —
  budget accordingly (~two ladders' worth of external calls).
- Output-order quirk: returns `(Iota, Omicron, Eta, Omega, Charge)` — META
  destructures as `(Yeo, Omicron, Dione, Omega, Charge)`; keep the positional
  mapping straight when integrating.

## 7. Provenance

- [src] `domain/soeng/06_pang.sol`.
- [chain] perimeter.
