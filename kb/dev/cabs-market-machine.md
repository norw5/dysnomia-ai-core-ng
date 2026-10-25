# CABSMarketMachine — "CABS Market Machine" — Z-Machine-settled escrow — **NOT DEPLOYED**

> **NOT DEPLOYED** — complete in source; no code onchain `[chain]`. CABS =
> 1970s-flavored "Computerized Accounting/Business System".

## 1. Identity

| | |
|---|---|
| Source | `domain/sky/CABSMarketMachine.sol` (contract `CABSMarketMachine`, "CABS Market Machine"/"CABSMM") |
| Onchain | absent `[chain]` |
| Uses the v2 loophole | constructed with `xiaoAddress == 0` → bypasses the lottery, mints flat 1,111,111,111 to the deployer `[src: 01_dysnomia_v2.sol constructor]` |

## 2. Role

An escrow market settled by **Z-Machine object properties**: stage tokens
against a game-state condition (`IZMachine.getObjectProperty(objId, propId,
player)` — the Z-machine is Infocom's Z-code VM, Zork), settle when the
condition matches (10% "reflection/diyat" fee to tx.origin), refund on
timeout ("wave reflection"). Double-entry `CABSAccounts` (1100 volume /
1200 escrow / 2200 fees) and `poke(addr, val)` writes into a "Folklore CPU"
at Z-machine register addresses 57344+ (0xE000 — the Z-machine reserved
region).

## 3. Dependencies

Bound at construction to a Folklore CPU address and a Z-machine address
(`setBoundAddresses` rebinds). Consumes any DYSNOMIA token as the reward
token.

## 4. State

`CABSAccounts`, `activeTrades` (EscrowTrade register), `nextTradeId`,
`folkloreCPUAddress`, `zmachineAddress`.

## 5. Functions

<!-- fntable: CABSMarketMachine @ domain/sky/CABSMarketMachine.sol -->
<!-- fntable-begin: CABSMarketMachine @ domain/sky/CABSMarketMachine.sol -->
Function table extracted mechanically from `domain/sky/CABSMarketMachine.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address folklore, address zmachine, address xiaoAddress)` | deployer | — | — | — |
| `setBoundAddresses(address folklore, address zmachine)` | owners | — | — | — |
| `stageEscrow(address recipient, address rewardToken, uint256 amount, uint256 zObjId, uint256 zPropId, uint256 targetValue, uint256 timeoutBlocks) returns (uint256 tradeId)` | public (external) | — | EscrowStaged | `require` |
| `evaluateAndSettle(uint256 tradeId) returns (bool)` | public (external) | — | EscrowSettled | `require` |
| `refundEscrow(uint256 tradeId)` | public (external) | — | EscrowRefunded | `require` |

Events declared: `CABSAccountUpdated(uint256 indexed account, uint256 oldBalance, uint256 newBalance)` · `EscrowStaged(uint256 indexed tradeId, address indexed depositor, uint256 amount)` · `EscrowSettled(uint256 indexed tradeId, address indexed recipient, uint256 amount, uint256 refundAmount)` · `EscrowRefunded(uint256 indexed tradeId, address indexed depositor, uint256 amount)`
<!-- fntable-end -->

Effects: `stageEscrow` — require-positive + transferFrom into the vault +
double-entry bookkeeping + Folklore pokes (57344=CTRL DEPOSIT, 57347=VAL).
`evaluateAndSettle` — Z-machine condition check; on match: 10% diyat fee,
payout, bookkeeping, CTRL COMMIT poke. `refundEscrow` — timeout-gated
refund, CTRL REFUND poke. All external (not DYSNOMIA-gated) with plain
string `require`s.

## 6. Integration notes

- Reference-only. The Folklore CPU and Z-machine contracts are not in the
  tree — the machine presupposes the excluded off-chain project's onchain
  artifacts (an adjacent open question).

## 7. Provenance

- [src] `domain/sky/CABSMarketMachine.sol`.
- [chain] absence probes.
