# MAP — "Dysnomia Map" — the QING factory + coordinate grid

> Wave 2 · 2025-02-26 23:08 UTC · deployed `[chain]` · liquid budget · venue
> creation still happening (newest QING 2026-09-17 `[chain]`)

## In player terms

| | |
|---|---|
| **Wrap any token, get a venue** | `New(anyERC20)` — no approval, no payment, just gas — deploys a chat room around that token: the "FED QING" is the room wrapped around the treasury's FED, the "pWBTC QING" around forked WBTC. If a room for that asset exists, it is THE room: one per asset, ever, planet-wide. |
| **Where it lands is a dice roll** | The venue's map position comes from CHO's coordinate lottery fed through HECKE's grid — you choose the asset, the world chooses the address. Tile collisions revert the whole create (gas spent, no venue). |
| **Token owners can veto** | A token's owner can `Forbid` it in advance — no venue may wrap it. (And anyone holding the WITHOUT ban token makes the read-path report a token as forbidden.) |
| **Still an open factory** | 917 venues and counting; treasury-side actors are among the most prolific creators `[chain]`. |
| **One leak to know about** | > ng-correction (session-51 fork-verified): this row originally claimed a reverted create leaves its drawn coordinate "claimed in CHO forever — a permanent scar". False: the draw and its `Qu` claim ride the SAME transaction, so a late-reverting New (rename decode, tile collision) rolls the claim back with the tx, and the next create re-draws the same De on a quiet system. A failed create costs its gas and leaves nothing behind. |

## 1. Identity

| | |
|---|---|
| Address | `0xD3a7A95012Edd46Ea115c693B74c5e524b3DdA75` |
| Creation | block 22,813,947 — 2025-02-26 23:08 UTC (tx `0xa4eae3006c1ac451bcfb9b66ed87fa8e7ed2305a93da9daa2a1801c2830abc3a`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | Dysnomia Map / MAP `[chain]` |
| Supply / cap | 9,136 / 93,659 — liquid `[chain]` |
| Children | 988 creates → **917 live QINGs** (delta = failed/reverted creates) `[chain]` |

## 2. Role

The venue layer's factory: `New(asset)` wraps ANY ERC-20 into a
[QING](./qing.md) — one per asset, ever — placed at a coordinate derived from
`CHO.Luo() × Offset` (Offset = `Meridians[0]`) through the [HECKE](./hecke.md)
transform. MAP also keeps the three venue indexes (asset → QING, Waat → QING,
(lat,lon) → QING — the last asserted collision-free) and the per-asset
forbid list.

## 3. Dependencies

- Constructor wires CHO + HECKE; adds itself as owner of CHO and VOID.
- Called by: anyone for `New`/`Forbid` (QING creators include the treasury
  actors — 0x6e8e8007… ×68, cDc slot 0xce28607b… ×22, helpers builder ×7
  `[chain]`); QING constructor calls back (`Map = MAPINTERFACE(msg.sender)`).

## 4. State

`Cho`, `Map` (HECKE), `Offset` (= Meridians[0] = 476733977057179 `[chain]`),
`_qings` (asset → QING), `_waats` (Waat → QING), `_forbidden` (asset → bool),
`_map` (lat → lon → QING).

## 5. Functions

<!-- fntable: MAP @ domain/map.sol -->
<!-- fntable-begin: MAP @ domain/map.sol -->
Function table extracted mechanically from `domain/map.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address ChoAddress, address HeckeAddress)` | deployer | — | — | — |
| `addToMap(uint256 Waat, address Qing)` | internal | — | — | `assert` |
| `GetMapQing(int256 Latitude, int256 Longitude) returns (QINGINTERFACE)` | public | — | — | — |
| `hasOwner(address _contract) returns (bool does)` | public | — | — | — |
| `has(address _contract, string memory what) returns (bool does)` | public | — | — | — |
| `Forbidden(address Asset) returns (bool)` | public | — | — | — |
| `Forbid(address Token, bool Disallow)` | public | — | — | `NotOwner` |
| `GetQing(uint256 Waat) returns (QING)` | public | — | — | — |
| `New(address Integrative) returns (QING Mu)` | public | — | NewQing | `QingAlreadyExists`, `ForbiddenToken`, `DerivativeQing` |

Events declared: `NewQing(address Qing, address Integrative, uint256 Waat)`

Errors declared: `NotOwner(address what, address who)` · `QingAlreadyExists(address Token, address Qing)` · `DerivativeQing(address Integrative, uint256 Waat)` · `ForbiddenToken(address which)`
<!-- fntable-end -->

Effects: `New(Integrative)` — the venue-creation pipeline, in order
`[src: domain/map.sol]`:

1. Rejects duplicates (`QingAlreadyExists`), assets forbidden by their own
   side (`ForbiddenToken`) and anything that is itself a QING
   (`DerivativeQing` — detected by exposing `Waat()`; no venues-on-venues).
2. Draws the placement: `Luo = Cho.Luo() × Offset` (Offset = `Meridians[0]`
   — one draw per venue ever, claimed in CHO's `Qu` map).
3. Deploys the QING; if the wrapped asset has `owner()`, the asset owner
   joins the new venue's owner set.
4. Renames it `"<asset> QING"` / `"q<symbol>"`; cross-owns with CHO.
5. Registers all three indexes — asset → QING, Waat → QING, and the tile via
   `addToMap`, which **asserts the (lat,lon) tile is free** (the late-revert
   collision site; see the leak note below).
6. Sets the QING's own market rate 1:1 and emits
   `NewQing(Qing, Integrative, Waat)` — **args NOT indexed** (decode from
   data words `[chain]`).

`Forbid(Token, Disallow)` — permitted to the asset's classic owner
(`owner()` == msg.sender) or a MultiOwnable owner (`NotOwner` otherwise);
note `Forbidden(view)` returns true for ANY caller holding WITHOUT — the ban
token doubles as a global venue-asset veto on the read path.

Ownership note for creators `[src: map.sol:80-87 + 03_qing.sol:30-32]`: a
new QING's owners are CHO, the wrapped asset's owner (when the asset has
`owner()`), and later DO.Take adders — NOT the creator. The creator is
auto-staffed instead (`_staff[tx.origin]`), which covers every bouncer
function (cover charge, staff, guest list, divisor). See the gate map in
[qing.md](./qing.md) §5.

## 6. Integration notes

- Wrapping a token: approve nothing — `New` needs only gas; the QING's
  admission economics come from its own bouncer settings.
- One-QING-per-asset is global and permanent; a reverted `New` (e.g. tile
  collision in `addToMap`) rolls back MAP AND CHO's side together — the `De`
  drawn by `Cho.Luo()` does NOT stay claimed (> ng-correction, session-51
  fork-verified: `Qu(de) == 0` after a forced late revert and the retry
  re-claims the same De; the original text here asserted a permanent
  cross-contract leak, which EVM revert semantics rule out). The
  988-creates-vs-917-live delta is failed creates, not scarred coordinates.
- Tile collisions assert — with HECKE's anisotropy, dense regions make some
  `New` calls revert after paying the lottery gas.
- > ng-correction (session-73, fork-verified): `has(contract, what)` and
  `hasOwner(contract)` are generic CAPABILITY probes — staticcall-success
  booleans asking "does the target answer this selector" — NOT registry
  lookups. `has(myLAU,"Qing") == false` does NOT mean no QING exists
  (the live full-auto video's confusion), and `hasOwner(myLAU) == true`
  only means the LAU answers `owner(address)`. The ONE onchain asset→QING
  oracle is the `QingAlreadyExists(address Token, address Qing)` revert
  itself (map.sol:70): attempt `New` and the decoded second arg IS the
  existing QING's address. Client-side, the venue census (the NewQing walk
  — every event carries `(Qing, Integrative, Waat)`) is the index the app
  ships (state/atlas.ts `qingForAsset`, session-73).

## 7. Provenance

- [src] `domain/map.sol`.
- [chain] NewQing log scan (917, 22,813,947 → 27,565,448);
  `qing_callers_sample.json`; perimeter.
