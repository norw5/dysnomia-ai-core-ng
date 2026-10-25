# WAR — "Dysnomia War" — spawn coordinates + the water loop — **NOT DEPLOYED**

> **NOT DEPLOYED** — complete in source; no candidate ever produced code
> `[chain]` (would have required WORLD to exist first).

## 1. Identity

| | |
|---|---|
| Source | `domain/dan/04_war.sol` (contract `WAR`, "Dysnomia War"/"WAR") |
| Onchain | absent `[chain]` |

## 2. Role

The resource-spawn layer: `Faa(caude, position)` computes a spawn-Waat from
RING.Eta (`modExp(Phoebe, Charge, Meridians[89])`) against WORLD.Tail
royalty state — and if the draw beats the per-position carbon ledger, mints
H2O "water" to the CURRENT game YUE and tracks CO2. Photosynthesis-flavored
resource loop: water in, carbon counted. GWAT (user venues) would consume
`War.Faa` for its spawn coordinates.

## 3. Dependencies

Constructed with the WORLD address; takes CHAN ownership (`World.Cheon().
Sei().Chan().addOwner(address(this))` — needs the spine). Deploys its own
[H2O](./h2o.md). Called by [GWAT](./gwat.md).Gwat.
> ng-correction (session-58 fork + source, harness set 3): the verbatim WAR
is **UNDEPLOYABLE** for the same reason as WORLD — `new H2O(address(this))`
makes H2O's constructor call back into the parent-under-construction
(`DYSNOMIA(WarAddress).Xiao()` and `War.World()…`), which has no code yet;
the creation reverts bare. The harness `war-fixed` fixture takes the math
address as a parameter and relocates the H2O-side addOwner to WAR's
constructor. Also note `Faa`'s draw only exists once a cauda entry exists —
verbatim WORLD never writes one (world.md ng-correction), so Faa returns 0
unconditionally as written.

## 4. State

`World`, `Water` (H2O), `CO2`, `_taan` (caude → position → carbon ledger).

## 5. Functions

<!-- fntable: WAR @ domain/dan/04_war.sol -->
<!-- fntable-begin: WAR @ domain/dan/04_war.sol -->
Function table extracted mechanically from `domain/dan/04_war.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address WorldAddress)` | deployer | — | — | — |
| `Faa(address Caude, uint256 Position) returns (uint256 Waat)` | public | — | — | — |
<!-- fntable-end -->

Effects: `Faa` — returns 0 early if Tail(position) has no Buzz; otherwise the
modExp draw, the H2O mint to the game YUE, and `CO2 += Chao` on success.

Designed loop in plain terms `[src]`: Faa is a **high-score contest per
(caude, position)** — every call posts a Waat draw against the private
monotone record `_taan[caude][position]`; beating the record mints H2O
(Iota-sized) and bumps the global `CO2` counter by Chao; a losing or tying
call pays only gas and changes nothing (CO2 is public and never decreases —
the one system-wide cumulative-activity ledger; no contract reads it, making
it a pure externality counter as designed). Re-battling the same slot means
beating your own best.

## 6. Integration notes

- Reference-only; see [world.md](./world.md) for the boot-dependency chain.

## 7. Provenance

- [src] `domain/dan/04_war.sol`.
- [chain] absence probes.
