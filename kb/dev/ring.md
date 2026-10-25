# RING — "Dysnomia Ring" — the moment recorder

> Wave 5 · 2025-06-16 05:10 UTC · deployed `[chain]` · budget liquid · active this month `[chain]`

## In player terms

| | |
|---|---|
| **Your moment, recorded** | Call `Eta()` and the world takes your YUE's accumulated stance at the FIRST venue ever created (the Zürich QING — "Phobos"), mixes it with a full ladder push, and writes one number into `Moments[your soul]`. A tiny per-player monument, refreshed each call. |
| **The oracle's metronome** | META.Beat calls Eta as its opening step — RING is where the tile oracle's heartbeat gets its phase. |
| **Requires skin** | No YUE held, no moment (`ZeroHoldings`). The recorder only knows players with an account. |
| **Version caveat** | The deployed Eta is a THIRD revision — neither our source nor the community April snapshot reproduces its behavior (fork-verified); only the Moments write is common to all versions. |

## 1. Identity

| | |
|---|---|
| Address | `0x1574c84Ec7fA78fC6C749e1d242dbde163675e72` |
| Creation | block 23,740,595 — 2025-06-16 05:10 UTC (tx `0x71f08f531fc1be32a9f38f5949ab39e4502fc5e9813c9b6e54acad0296e9075c`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | Dysnomia Ring / RING `[chain]` |
| Supply / cap | 3,670 / 56,866 — liquid `[chain]` |
| `Phobos` | the Zürich QING `0xb0ba7d36b7f0505879179ece7401f24eb653c6e1` — hard-wired at construction `[src]`; live-read confirmed `[chain]`: `RING.Phobos()` == `QI.Zuo()` == the first-ever QING — the dev-published list "(Phobos) qZu" — resolved onchain |

## 2. Role

The first of the tang tile-oracle pair: `Eta() → (Phoebe, Iota, Chao,
Charge)` mixes the caller's YUE-react on the Zürich QING ("Phobos") with
PANG's push — one shared orbital step — and records `Moments[soul] = Iota`,
a per-player "moment". META.Beat consumes Eta's outputs as its Phoebe/Chao
inputs; the undeployed WAR.Faa would have spun it for spawn coordinates.
Saturnian moons as function-local names (Phoebe/Phobos — fear guarding the
first gate).

## 3. Dependencies

Holds `Pang` (full ladder beneath) + `Phobos`. Called by META.Beat
(`Ring.Eta()`), the undeployed WAR.

## 4. State

`Pang`, `Phobos`, `Moments` (public soul → Iota).

## 5. Functions

<!-- fntable: RING @ domain/sky/03_ring.sol -->
<!-- fntable-begin: RING @ domain/sky/03_ring.sol -->
Function table extracted mechanically from `domain/sky/03_ring.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address PangAddress)` | deployer | meter | — | — |
| `Eta() returns (uint256 Phoebe, uint256 Iota, uint256 Chao, uint256 Charge)` | public | — | — | — |
<!-- fntable-end -->

Effects: `Eta` — `Chao = Yue.React(Phobos)` (requires the caller to hold
their YUE — `ZeroHoldings` from YUE otherwise), then `Pang.Push(Phobos.
Waat())`; stores the moment. Requires a CHO session + YUE.

**Source-version note — the deployed Eta is a THIRD version**:
repo archaeology dated the drift mechanically (the dev's git history): the repo held
the April lines (`Chao /= Omicron; Charge /= Omega; Iota *= Iota`) from
Oct 2024 until ONE post-deploy commit — `f9f284988`, 2026-06-16 — removed
them; the deployed runtime (Jun 2025) predates that edit by a year, and NO
committed revision matches the deployed Eta's +390/+364 B body. The
recovered community docs (`[ext]` — snapshot
2026-04-20, source-derived from the same repo) hash an OLDER `03_ring.sol`
than our recovered copy, and its inlined `Eta` body differs: their April
version normalized `Chao /= Omicron` and `Charge /= Omega` after the Push
and squared the returned `Iota = Iota * Iota`; our version keeps only the
React, the Push, and the Moments write. solc compile-verification +
a fork behavioral A/B show the deployed RING (Jun 2025,
predating both snapshots) matches NEITHER: it is +390/+364 B larger than
ours/April, and while the deployed `Eta()` returns
`(Phoebe=14, Iota=7973995094115691, Chao=50653, Charge=69343957)` against
live storage, BOTH compiled variants revert inside their code path with
the owner-gate error `0x0be6bab5` — identified from the recovered source as
`OwnableUnauthorizedAccount(address,address,address)`, declared in our own
`lib/multiownable.sol:7` (the first decoded
word is `tx.origin` = the caller); what no source of ours explains is WHICH
gate fires on the swapped variants' Eta path while the deployed Eta sails
through. Deployed-output arithmetic matches neither formula either (Iota is
neither the raw Push value nor its square; Charge = 50653 × 1369 exactly).
Treat Eta's output semantics as deployed-only knowledge; the Moments WRITE
is common to all versions.

## 6. Integration notes

- `Moments(soul)` is a cheap public view of the last recorded moment per
  player.
- Eta's Phoebe output is what META exponentiates Dione against (Deimos) —
  see [meta.md](./meta.md).

## 7. Provenance

- [src] `domain/sky/03_ring.sol`.
- [chain] perimeter; solc compile-verification + fork behavioral A/B.
