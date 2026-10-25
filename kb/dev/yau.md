# YAU — "CHATLOG Yau" — first spine relay

> Wave 1 · 2024-08-23 00:47 UTC · deployed `[chain]` · budget still liquid

## In player terms

| | |
|---|---|
| **Pure plumbing** | YAU does nothing user-facing. It exists so the boot sequence has one more link: it spins ZHOU's channel once, registers its own entity, and then waits — YANG consumes its orbit step when building the system's public coordinates. |
| **A cheap window into the spine** | Its `Theta()` getter returns a whole entity record in one call — a favorite anonymous probe for anyone watching kernel state. |
| **Nearly virgin** | Supply 92 against a 4,932 cap `[chain]` — the least-touched organ of the kernel, mostly quiet since boot. |

## 1. Identity

| | |
|---|---|
| Address | `0x7e91d862a346659daeed93726e733c8c1347a225` |
| Creation | block 21,220,696 — 2024-08-23 00:47 UTC (tx `0xa97735f38b3d16c9fff088324bb7b18d9969a6a8c299bcd6fde3721f77e04d39`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | CHATLOG Yau / YAU `[chain]` |
| Supply / cap | 4,453 / 92,074 — **liquid** `[chain]` |
| `Xiao()` | MATH `0xB680F0cc810317933F234f67EB6A9E923407f05D` |

## 2. Role

The first relay above ZHOU: YAU's constructor spins ZHOU's rod
(`Tau.React(Random())`), installs its own rod under a fresh soul, and keeps a
`Monopole[2]` pair — YANG then consumes `YAU.React()` to build the Bang leg of
its Tai triple. YAU itself does little else: it exists to be a link.

## 3. Dependencies

Owns ZHOU + ZHENG + YI (constructor). Called by YANG's constructor
(`Mu.React()`), which also takes ownership of the whole YAU chain.

## 4. State

`Tau` (ZHOU), `Theta` (YAU's own Bao — public!), `Monopole[2]`.

## 5. Functions

<!-- fntable: YAU @ 07_yau.sol -->
<!-- fntable-begin: YAU @ 07_yau.sol -->
Function table extracted mechanically from `07_yau.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address ZhouAddress)` | deployer | — | — | — |
| `Augment()` | internal | meter | — | — |
| `React() returns (Bao memory)` | owners | meter | — | — |
<!-- fntable-end -->

Effects: `React()` — **owners-only** (unlike ZHOU.React) — advances Theta
through YI.React and folds the result into its own Omega.

## 6. Integration notes

- `Theta` is a public getter returning the full Bao — a cheap anonymous probe
  of the spine's state.
- Nothing user-facing routes through YAU today; it is boot scaffolding for
  YANG.

## 7. Provenance

- [src] `07_yau.sol`.
- [chain] perimeter; last activity 2026-06-27.
