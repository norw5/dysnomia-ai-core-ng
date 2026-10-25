# QING — "Mysterious Qing" — the venue token (factory-child TYPE)

> Type doc: 917 live instances `[chain]`, children of [MAP](./map.md).
> A QING is a chat room + admission economy wrapped around ANY ERC-20.

## In player terms

| | |
|---|---|
| **A room with a door policy** | Each QING is a chat room named after the token it wraps ("<asset> QING"). Getting in (`Join`) means passing the door: be staff, hold ≥25 CROWS, hold a stake of the wrapped asset (total supply ÷ divisor — the divisor is tunable, default 32), own the wrapped contract, be guest-listed (24 hours), or pay the cover charge in the wrapped asset. |
| **Chat that knows who you are** | Venue messages (`Chat`) carry username + soul + aura, so archives are self-identifying. Talking follows the same door rules — no admission, no voice. |
| **The staff run the room** | Bouncers set cover, divisor, staff list, guest list; rates on the venue's desk can only rise (capped). It is a mini-club-management simulator, onchain. |
| **A birth-lottery you can't see** | At creation, one draw decides whether the room's accumulated cover charges can EVER be cashed out (GWAT flag). Most rooms drew "locked" — their escrow is a permanent exhibit; a few drew "free" and their owners can `Withdraw`. |
| **Rooms hold money** | Covers and desk trades accumulate in the QING itself — a locked room's balance is visible forever, extractable never. |

## 1. Identity

| | |
|---|---|
| Type | `Type() == "QING"` (base) · `SubType() == "RosenfeldQing"` (subclass) |
| Factory | [MAP](./map.md) `0xD3a7A95012Edd46Ea115c693B74c5e524b3DdA75` — one QING per asset, ever |
| Census | 917 live (22,813,947 → 27,565,448), incl. venues around FED `0x1d177cb9efeea49a8b97ab1c72785a3a37abc9ff` and pWBTC `0x2260fac5e5542a773aa44fbcfedf7c193bc2c599` `[chain]`. **Liveness (trailing-year Transfer-block scan): 816 of 917 venues show nothing beyond creation-era blocks; ~101 had real usage; 17–23 alive in the last 30 days — Phobos alone carries ~35% of all venue activity** |
| First instance | "Zürich QING" (`qZů`) `0xb0ba7d36b7f0505879179ece7401f24eb653c6e1` — block 22,819,500, supply 542 / cap 58,364, owners include Maria #2 + deployer `[chain]`; "Phobos" in the dev-published constellation list; RING's `Phobos` hard-reference |
| Sources | `domain/dan/03_qing.sol`, `domain/dan/03c_rosenfeld_qing.sol` |

## 2. Role

The venue layer: each QING is a DYSNOMIA token named after its wrapped asset
("<asset> QING", symbol "q<sym>"), carrying venue chat (`Chat` emits
`LogEvent(Username, Soul, Aura, line)`), a bouncer economy (staff list, ≥25
CROWS `0x203e366A1821570b2f84Ff5ae8B3BdeB48Dc4fa1`, asset-stake ≥
totalSupply÷BouncerDivisor, or asset-contract ownership), an optional cover
charge in the wrapped asset, 1-day guest passes, and — decided at creation by
lottery — whether its accumulated escrow can EVER be withdrawn (`GWAT`
immutable flag). The community's visible venue map (FED venue, pWBTC venue,
917 total) is this type.

## 3. Dependencies

- Constructor wires CHO (`Cho`), the wrapped `Asset`, and `Map = msg.sender`;
  staff-seeds `tx.origin`; default `BouncerDivisor = 32` ("Based On Holding
  25 CROWS" `[src comment]`); takes entropy from `Cho.React`.
- Called by: users (Join/Chat/Admitted), CHO.VerifyUserTokenPermissions (via
  Join/Chat), CHOA.Chat (venue chat + bounty), YUE.GetAssetRate walks the
  QING-on-QING derivative chain (`Asset()` of a GWAT QING is another QING).

## 4. State

`Cho`, `Asset`, `Map`, `Waat` (coordinate), `Entropy`, `BouncerDivisor`,
`CoverCharge`, `NoCROWS`, `_staff`, `_list` (guest list with 1-day windows),
`GWAT` (immutable; `true` — escrow locked forever — unless
`Luo % 476733977057179 == 0` at creation: a 1-in-Meridians[0]-ish lottery).

## 5. Functions

### QING (base)

<!-- fntable: QING @ domain/dan/03_qing.sol -->
<!-- fntable-begin: QING @ domain/dan/03_qing.sol -->
Function table extracted mechanically from `domain/dan/03_qing.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(uint256 Luo, address Integrative, address ChoAddress)` | deployer | meter | — | — |
| `AddMarketRate(address Contract, uint256 Rate)` | owners | — | — | `MarketRateCanOnlyBeIncreased`, `TokenMaximumRate` |
| `GetQing(uint256 QingWaat) returns (QINGINTERFACE)` | public | — | — | — |
| `Withdraw(address what, uint256 amount)` | owners | — | Withdrawal | `assert` |
| `AllowCROWS(bool _b)` | owners | — | — | — |
| `setBouncerDivisor(uint16 _d)` | bouncers | — | — | — |
| `setCoverCharge(uint256 _c)` | bouncers | — | — | — |
| `setStaff(address _a, bool active)` | bouncers | — | — | — |
| `setGuestlist(address _a)` | bouncers | — | — | — |
| `removeGuest(address _a)` | bouncers | — | — | — |
| `bouncer(address cBouncer) returns (bool)` | public | — | — | — |
| `_checkBouncer()` | internal | — | — | `BouncerUnauthorized` |
| `Join(address UserToken)` | public | meter | — | `CoverChargeUnauthorized` |
| `Admitted(address UserToken) returns (bool)` | public | — | — | — |
| `Chat(LAU UserToken, string memory MSG)` | public | meter | LogEvent | `Forbidden`, `NotAdmitted`, `PayCover` |

Events declared: `Withdrawal(uint64 Soul, uint64 Aura, address Token, uint256 amount)` · `LogEvent(string Username, uint64 Soul, uint64 Aura, string LogLine)`

Errors declared: `MarketRateCanOnlyBeIncreased(address Contract, uint256 CurrentRate)` · `TokenMaximumRate(address Contract, uint256 MaximumRate)` · `BouncerUnauthorized(address origin, address account, address what)` · `AlreadyJoined(address UserToken)` · `CoverChargeUnauthorized(address AssetAddress, uint256 Amount)` · `PayCover(address Asset, uint256 CoverCharge)` · `Forbidden(address Asset)` · `NotAdmitted(uint64 Soul)`
<!-- fntable-end -->

### RosenfeldQing (decorative physics subclass)

<!-- fntable: RosenfeldQing @ domain/dan/03c_rosenfeld_qing.sol -->
<!-- fntable-begin: RosenfeldQing @ domain/dan/03c_rosenfeld_qing.sol -->
Function table extracted mechanically from `domain/dan/03c_rosenfeld_qing.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(uint256 Luo, address Integrative, address ChoAddress)` | deployer | — | — | — |
| `RosenfeldTensor() returns (uint256 StressX, uint256 StressY)` | public | — | — | — |
| `SoengStresses(address xia, address xie, address zi, address pang) returns ( uint256 xiaCharge, uint256 xieOmega, uint256 ziIota, uint256 pangPush )` | public | — | — | — |
| `SymmetrizeCurrents(uint256 canonicalCurrent, uint256 spinIota, uint256 spinEta) returns (uint256 symmetricCurrent)` | public | — | — | — |
| `SymmetrizeAllSoeng(address xia, address xie, address zi, address pang) returns ( uint256 symXia, uint256 symXie, uint256 symZi, uint256 symPang )` | public | — | — | — |
<!-- fntable-end -->

Effects: `bouncer(x)` — the four-way door pass: staff ∨ (≥25 CROWS unless
NoCROWS) ∨ (asset balance ≥ asset.totalSupply ÷ BouncerDivisor) ∨ (asset
MultiOwnable membership if the asset has an owner face).
`_checkBouncer` checks tx.origin, msg.sender AND the tx.origin's LAU
(three-way pass).

**Who passes which gate (practical map)** `[src:
03_qing.sol:32,44-47,59-90; map.sol:82-87]`: after creation the venue's
`onlyOwners` set is CHO + the wrapped asset's owner (MAP adds it when the
asset exposes `owner()`), plus anyone appended later by [DO](./do.md).Take;
its `onlyBouncers` set is the staff list — **seeded with the creator**
(`_staff[tx.origin] = true` in the constructor) — plus the four-way door
pass above (CROWS / asset stake / asset-contract owner). Practical
consequence: the venue CREATOR can set cover, staff, guest list and divisor
from block one without touching ownership, but cannot touch the owners'
surface (`AddMarketRate`, `Withdraw`, `AllowCROWS`) unless CHO added them,
the asset owner is them, or they Took the venue.

`Join(UserToken)` — the admission flow `[src: 03_qing.sol]`: (1) verify the
LAU through CHO (`VerifyUserTokenPermissions` — the WITHOUT-ban check lives
there); (2) take the cover charge — a transferFrom of the wrapped asset that
needs the caller's allowance set ABOVE the cover (`CoverChargeUnauthorized`
otherwise) — unless the address is guest-listed; (3) grant the 1-day admit
window; (4) if the caller has no CHO delegate yet, enter them (auto-register
with the hub on first venue contact). `Admitted(UserToken)` reads the window
back. `Chat(LAU, MSG)` — refuses if MAP forbids the asset (`Forbidden`),
verifies the LAU, requires an unexpired admission (`NotAdmitted`) or payment
(`PayCover`), then emits the 4-arg `LogEvent`. `Withdraw` — owners-gated,
**asserts !GWAT** (locked venues can never withdraw), pays out + `Withdrawal`
event. `AddMarketRate` — rate can only increase, capped at priced-asset
totalSupply ÷ 777. Rosenfeld additions are pure-view tensor farce over
`(Waat, Entropy, planck=6626)` + staticcall probes of the soeng ladder.

## 6. Integration notes

- Reading venue chat: LogEvents on the QING address (note the 4-arg shape —
  Username string first — DIFFERENT from SHIO's 3-arg LogEvent; decode
  accordingly).
- Admission for a fresh wallet: hold ≥25 CROWS, or ≥ totalSupply÷divisor of
  the wrapped asset, or get staffed/guest-listed, or pay cover.
- GWAT flag check before any UI promises withdrawals: `GWAT()` is public —
  most venues are permanently locked (creation lottery).
- Assets can opt out pre-emptively: their owner calls `MAP.Forbid`.

## 7. Provenance

- [src] `domain/dan/03_qing.sol`,
  `03c_rosenfeld_qing.sol`.
- [chain] NewQing scan (917); Zürich instance probes (perimeter).
