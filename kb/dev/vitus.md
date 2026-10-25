# VITUS — "Dysnomia Creators" — the royalty token — **NOT DEPLOYED**

> **NOT DEPLOYED** — complete in source; no code onchain `[chain]`. St.
> Vitus — patron saint of actors and dancers.

## 1. Identity

| | |
|---|---|
| Source | `domain/assets/vitus.sol` (contract `VITUS`, "Dysnomia Creators"/"VITUS") |
| Onchain | absent `[chain]` |
| Anchor | seeds 1:1 with MV ("WMContract") `0xA1BEe1daE9Af77dAC73aA0459eD63b4D93fC6d29` totalSupply `[src]` |

## 2. Role

The creators' royalty token of the planned world: WORLD mints it to player
YUEs inside `Code` (the Dione output), royalties flow WORLD→YUE through the
CHAN escrow, withdrawals happen only via `Withdraw` → CHAN.YueWithdraw with
the player's standing opt-in. Same two-tier overflow rule as H2O
(`Meridians[13]` per-holder, spill to WORLD up to `Meridians[20]`, then
burn).

## 3. Dependencies

Deployed by WORLD's constructor (which also takes an initial unit); CHAN
custody via the WORLD chain; HECKE constants for the caps.

## 4. State

`World` — public; uncapped (`maxSupply = 0`).

## 5. Functions

<!-- fntable: VITUS @ domain/assets/vitus.sol -->
<!-- fntable-begin: VITUS @ domain/assets/vitus.sol -->
Function table extracted mechanically from `domain/assets/vitus.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address WorldAddress)` | deployer | meter | — | — |
| `Withdraw(uint256 Amount)` | public | — | — | — |
| `Balance() returns (uint256)` | public | — | — | — |
| `Mint(address To, uint256 Amount)` | owners | — | — | — |
<!-- fntable-end -->

Effects: `Withdraw(amount)` — routes through the CHAN escrow to msg.sender
(the player's opt-in must already allow VITUS). `Balance()` — the game YUE's
holdings. `Mint(to, amount)` — owners-gated (WORLD) + overflow rule.

## 6. Integration notes

- Reference-only. The MV 1:1 anchor means a boot would have minted ~2.01B
  VITUS at 2025-era supply — the royalty pool sized against the treasury's
  reserve asset.

## 7. Provenance

- [src] `domain/assets/vitus.sol`.
- [chain] absence probes; MV supply from the KB (mv_supply_curve).
