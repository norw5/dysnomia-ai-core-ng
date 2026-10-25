# GWAT — 骨 — user-spawned sub-venues — **NOT DEPLOYED**

> **NOT DEPLOYED** — complete in source; no code onchain `[chain]`. 骨 =
> "bone" (Cantonese GWAT — the dev writes Cantonese romanizations).

## 1. Identity

| | |
|---|---|
| Source | `domain/soeng/07_gwat.sol` (contract `GWAT`, name 骨 / "GWAT") |
| Onchain | absent `[chain]` — note: the name collision with QING's `GWAT` bool (the withdrawability flag) is deliberate wordplay: the flag marks venues whose escrow behaves like a GWAT (locked) |

## 2. Role

The player-venue layer: `Gwat(parentQing, lin)` forks a parent QING into the
CALLER's own venue inside the current game — one per (parent QING, player
YUE) — named `"<user>'s <asset> GWAT"`, symbol `骨<sym>`. The spawn Waat
comes from [WAR](./war.md).Faa (must not be ≡ 0 mod the map offset and must be
tile-free); the spawner receives the GWAT's full `maxSupply` (owner of their
house) and sets its market rate against the parent. GWATs chain: a GWAT's
`Asset()` is the parent QING — which is exactly the derivative chain
[YUE](./yue.md).GetAssetRate walks with its 777-mod attenuation.

## 3. Dependencies

Constructed with the WAR address; needs WORLD+WAR live (the whole undeployed
stack); mints plain QINGs (base type) as its venue bodies.

## 4. State

`War`, `_qings` (parent → yue → gwat), `_waats`, its own `_map` grid
(separate from MAP's — GWAT venues get their own collision space via
`War.World().Map().Map().Compliment`).

## 5. Functions

<!-- fntable: GWAT @ domain/soeng/07_gwat.sol -->
<!-- fntable-begin: GWAT @ domain/soeng/07_gwat.sol -->
Function table extracted mechanically from `domain/soeng/07_gwat.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address WarAddress)` | deployer | — | — | — |
| `addToMap(uint256 Waat, address Qing)` | internal | — | — | `assert` |
| `GetMapGwat(int256 Latitude, int256 Longitude) returns (QINGINTERFACE)` | public | — | — | — |
| `Gwat(address Qing, uint256 Lin) returns (QING Mu)` | public | — | NewQing | `YourGwatAlreadyExists`, `ForbiddenToken`, `SpawningFailure`, `assert` |

Events declared: `NewQing(address Qing, address Integrative, uint256 Waat)`

Errors declared: `YourGwatAlreadyExists(address Token, address Qing)` · `ForbiddenToken(address which)` · `SpawningFailure(uint256 Lin)`
<!-- fntable-end -->

Effects: `Gwat(qing, lin)` — asserts the parent is really on MAP; refuses
duplicates (`YourGwatAlreadyExists`) and forbidden assets; draws
`Luo = War.Faa(qing, lin)` (`SpawningFailure` on 0-mod or tile clash);
deploys the QING body; renames to the user's venue name; cross-owns with
CHO; `_mint(msg.sender, maxSupply)` (the house belongs to the player);
registers the parent market rate; emits `NewQing`.
> ng-correction (session-58 fork, harness set 3): the spawn's rate
registration hits the QING rate cap — `Mu.AddMarketRate(parent, 1e18)`
requires `parent.totalSupply() / 777 ≥ 1e18`, i.e. the parent venue must
hold ≥ 777 of its own tokens (`TokenMaximumRate 0xf4ccbd00`, fork-pinned);
freshly created venues fail this. The spawner's GWAT balance is the spawn
mint PLUS GWAT's own constructor originMint when the spawner is also the
deployer's tx.origin. The whole chain additionally requires a WORLD that
writes the cauda (world.md ng-correction) — on the verbatim source this
function is unreachable past `SpawningFailure`.
> ng-correction (session-62 fork, the flagship runner): **the spawn is
> CHO-owner-gated** — `Gwat`'s internal `Cho().addOwner(Mu)` (07_gwat.sol:52)
> rides MultiOwnable._checkOwner, which passes only when `tx.origin` OR
> `msg.sender` is a CHO owner; GWAT's ctor never registers itself (unlike
> WAR/H2O). Verbatim, ONLY CHO owners can spawn — set-3's proof silently
> rode mariarahel (CHO's ctor `addOwner(tx.origin)`); a fresh soul's
> attempt reverts `OwnableUnauthorizedAccount(tx.origin, GWAT, CHO)
> 0x0be6bab5`. The harness completes the fixture's registration per-fork
> (`CHO.addOwner(GWAT)` — the flagship's harbormaster step) so fresh souls
> can play the game. Also fork-found: a draw that dies at the gate's DRYRUN
> consumes nothing — an identical retry re-draws the SAME failure; any
> mined block (e.g. one harbormaster tx) refreshes the draw.

## 6. Integration notes

- Reference-only; see [world.md](./world.md)/[war.md](./war.md) for the boot
  chain. The YUE exchange desk already handles GWAT-shaped assets — the
  account layer shipped prepared for this.

## 7. Provenance

- [src] `domain/soeng/07_gwat.sol`.
- [chain] absence probes.
