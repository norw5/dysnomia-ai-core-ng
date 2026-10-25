# H2O — 水 — the water resource — **NOT DEPLOYED**

> **NOT DEPLOYED** — complete in source; uncapped by design
> (`maxSupply = 0` after construction); no code onchain `[chain]`.

## 1. Identity

| | |
|---|---|
| Source | `domain/assets/h2o.sol` (contract `H2O`, name 水 / "H2O") |
| Onchain | absent `[chain]` |
| Anchor | seeds 1:1 with "Call" `0xD4FD96BA83d3E6FF1A0Baa44c32Def94e641D97c` totalSupply ("Call" is a CHO alias, 𐌎) `[src]` |

## 2. Role

The water token of the planned resource loop: constructor mints itself the
full Call-token supply (1:1 anchor) and registers the rate; [WAR](./war.md)
mints it to the game YUE on successful spawn draws. Per-holder cap
`Meridians[13]` (= 1,086,601,290,109,041,273,389,339,023,771,359,131 — a
HECKE constant repurposed as a limit); overflow first spills to WORLD (up to
`Meridians[20]`), then burns.

## 3. Dependencies

Constructed by WAR; takes CHAN ownership through the WORLD chain; reads
HECKE via `War.World().Map().Map()`.

## 4. State

`War` — public. (Cap machinery via the DYSNOMIA v2 `maxSupply = 0` path.)

## 5. Functions

<!-- fntable: H2O @ domain/assets/h2o.sol -->
<!-- fntable-begin: H2O @ domain/assets/h2o.sol -->
Function table extracted mechanically from `domain/assets/h2o.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address WarAddress)` | deployer | meter | — | — |
| `Balance() returns (uint256)` | public | — | — | — |
| `Mint(address To, uint256 Amount)` | owners | — | — | — |
<!-- fntable-end -->

Effects: `Balance()` — the current game YUE's water. `Mint(to, amount)` —
owners-gated (WAR), with the two-tier overflow rule above (spill to WORLD →
burn).

## 6. Integration notes

- Reference-only.

## 7. Provenance

- [src] `domain/assets/h2o.sol`.
- [chain] absence probes.
