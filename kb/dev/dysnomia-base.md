# DYSNOMIA (base contract) + MultiOwnable — the inherited face of every family token

> Not deployed itself (abstract) — this is the shared base every Dysnomia token
> inherits; its functions are live on every contract in this folder. Two
> revisions exist in-tree: v1 (`01_dysnomia.sol`, wave-1 contracts) and v2
> (`01_dysnomia_v2.sol`, wave-2+ contracts).

## In player terms

| | |
|---|---|
| **Using anything = minting it** | Nearly every action on a family contract mints exactly 1 more unit of that contract's own token. A token's supply is therefore its lifetime usage counter — a QING with 500 supply has been used 500 times. |
| **Everything has a lifetime budget** | At construction each contract rolls `Random() % 111111` — that draw is its cap, fixed forever. When supply reaches it the contract keeps working normally; it just stops minting itself. 20 of 28 capped contracts have already saturated `[chain]` — a "completed" object, not a broken one. |
| **Every token is also a swap desk** | `Purchase`/`Redeem` let you buy or sell the token at a fixed internal rate against a registered asset (AFFECTION at 1:1 in the base, venue-set rates on QINGs). No pool, no oracle — a posted price list. |
| **Ownership travels with you** | The owner model passes if EITHER the calling wallet or the contract it calls through is in the owner set. Practically: if you own something, any tool you use onchain acts with your authority — delegation is the default, not a grant you configure. |
| **Renaming is cosmetic and permanent-ish** | Owners can `Rename` a token's name/symbol at any time; the address is the only stable identity. |

## 1. Identity

| | |
|---|---|
| Kind | `abstract contract DYSNOMIA is MultiOwnable` — ERC-20 + self-meter + exchange desk |
| Revisions | v1 `01_dysnomia.sol` (used by SHA/SHIO/YI…VOID wave 1) · v2 `01_dysnomia_v2.sol` (ReactionsLib/CHO/MAP/QING/soeng/sky/tang/world layer) |
| Deployed instances | every token-shaped contract in [README.md](./README.md) (ng link fix, session-49; origin path was repo-absolute); not deployable standalone |
| `Xiao()` | on every deployed instance = shared MATH `0xB680F0cc810317933F234f67EB6A9E923407f05D` `[chain]` |

## 2. Role

The family template: an ERC-20 whose supply is a **call counter**. Nearly every
non-view function ends in `_mintToCap()` — mint exactly 1 unit to the contract
itself if `totalSupply < maxSupply`. `maxSupply` is drawn at construction:
`Xiao.Random() % 111111` — a lifetime lottery. A contract at cap keeps working;
it just stops paying its own meter. The base also carries the family's fixed-rate
exchange desk (`Purchase`/`Redeem` against internal `_marketRates`, seeded with
AFFECTION `0x24F0154C1dCe548AdF15da2098Fdd8B8A3B8151D` at 1:1) and the
`MultiOwnable` authority model.

Differences v1 → v2 `[src]`:

- v1 constructor mints a random origin slice (`Random() % maxSupply / 10`) to
  `tx.origin` and seeds the AFFECTION rate; v2 leaves origin mints and rate
  seeding to subclasses (they repeat the same pattern explicitly).
- v2 allows `mathContract == 0`: then it mints a flat `1,111,111,111` and sets
  no `Xiao` (used by CABSMarketMachine; H2O/VITUS afterwards hand-set
  `maxSupply = 0` = **uncapped**).
- v2 adds `_addLibraryOwner(VOID, name)` — add the named VOID library as an
  owner (privilege wiring helper).

`MultiOwnable` (`lib/multiownable.sol`): a set-of-owners model. `_checkOwner`
passes if **either `msg.sender` or `tx.origin`** is in the set — so an EOA owner
implicitly authorizes ANY contract it calls (agent-model authority; delegation
by tx.origin is systemic). Quirk: `owner()` (no args) returns `address(this)`;
the membership check is `owner(address)`.

## 3. Dependencies

- Calls `Xiao` (the MATH token) for `Random()`/`modExp64` — the shared
  deterministic orbit (KB 05; predictable, steerable, never load-bearing for
  secrecy).
- Inherited by everything in this folder; nothing outside the family calls the
  base directly.

## 4. State

`__name`/`__symbol` (Rename-able by owners), `_balances`/`_allowances`/
`_totalSupply` (standard ERC-20 bookkeeping), `Xiao` (mathlib), `maxSupply`
(the lottery budget), `_marketRates` (asset → rate for the exchange desk).
v1 adds log/format helpers (`String(uint)`, `Hex(...)`); v2 drops them (they
moved into LibStrings).

## 5. Functions

### v1 — `01_dysnomia.sol`

<!-- fntable: DYSNOMIA @ 01_dysnomia.sol -->
<!-- fntable-begin: DYSNOMIA @ 01_dysnomia.sol -->
Function table extracted mechanically from `01_dysnomia.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(string memory name_, string memory symbol_, address mathContract)` | deployer | — | — | — |
| `Rename(string memory newName, string memory newSymbol)` | owners | — | — | — |
| `mintToCap()` | owners | meter | — | — |
| `_mintToCap()` | internal | — | — | — |
| `AddMarketRate(address _a, uint256 _r)` | internal | — | — | — |
| `GetMarketRate(address _a) returns (uint256)` | public | — | — | — |
| `Purchase(address _t, uint256 _a)` | public | — | — | `MarketRateNotFound`, `require` |
| `Redeem(address _t, uint256 _a)` | public | — | — | `MarketRateNotFound`, `require` |
| `name() returns (string memory)` | public | — | — | — |
| `symbol() returns (string memory)` | public | — | — | — |
| `decimals() returns (uint8)` | public | — | — | — |
| `totalSupply() returns (uint256)` | public | — | — | — |
| `balanceOf(address account) returns (uint256)` | public | — | — | — |
| `transfer(address to, uint256 value) returns (bool)` | public | — | — | — |
| `allowance(address owner, address spender) returns (uint256)` | public | — | — | — |
| `approve(address spender, uint256 value) returns (bool)` | public | — | — | — |
| `transferFrom(address from, address to, uint256 value) returns (bool)` | public | — | — | — |
| `_transfer(address from, address to, uint256 value)` | internal | — | — | — |
| `_update(address from, address to, uint256 value)` | internal | — | Transfer | `DysnomiaInsufficientBalance` |
| `_mint(address account, uint256 value)` | internal | — | — | — |
| `_approve(address owner, address spender, uint256 value)` | internal | — | — | — |
| `_approve(address owner, address spender, uint256 value, bool emitEvent)` | internal | — | Approval | — |
| `_spendAllowance(address owner, address spender, uint256 value)` | internal | — | — | `DysnomiaInsufficientAllowance` |
| `log10(uint256 value) returns (uint256)` | internal | — | — | — |
| `String(uint256 value) returns (string memory buffer)` | internal | — | — | — |
| `Hex(address account) returns (string memory)` | internal | — | — | — |
| `Hex(uint256 value) returns (string memory)` | internal | — | — | — |
| `Hex(bytes32 value) returns (string memory)` | internal | — | — | — |
| `Hex(bytes memory data) returns (string memory)` | internal | — | — | — |

Events declared: `Transfer(address indexed from, address indexed to, uint256 value)` · `Approval(address indexed owner, address indexed spender, uint256 value)`

Errors declared: `MarketRateNotFound(address asset)` · `DysnomiaInsufficientBalance(address origin, address sender, address from, address to, address what, uint256 balance, uint256 needed)` · `DysnomiaInsufficientAllowance(address origin, address sender, address owner, address spender, address what, uint256 allowance, uint256 needed)`
<!-- fntable-end -->

### v2 — `01_dysnomia_v2.sol`

<!-- fntable: DYSNOMIA @ 01_dysnomia_v2.sol -->
<!-- fntable-begin: DYSNOMIA @ 01_dysnomia_v2.sol -->
Function table extracted mechanically from `01_dysnomia_v2.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(string memory name_, string memory symbol_, address mathContract)` | deployer | — | — | — |
| `_addLibraryOwner(VOID Void, string memory what)` | internal | — | — | — |
| `Rename(string memory newName, string memory newSymbol)` | owners | — | — | — |
| `mintToCap()` | owners | meter | — | — |
| `_mintToCap()` | internal | — | — | — |
| `_addMarketRate(address _a, uint256 _r)` | internal | — | — | — |
| `GetMarketRate(address _a) returns (uint256)` | public | — | — | — |
| `Purchase(address _t, uint256 _a)` | public | — | — | `MarketRateNotFound`, `require` |
| `Redeem(address _t, uint256 _a)` | public | — | — | `MarketRateNotFound`, `require` |
| `name() returns (string memory)` | public | — | — | — |
| `symbol() returns (string memory)` | public | — | — | — |
| `decimals() returns (uint8)` | public | — | — | — |
| `totalSupply() returns (uint256)` | public | — | — | — |
| `balanceOf(address account) returns (uint256)` | public | — | — | — |
| `transfer(address to, uint256 value) returns (bool)` | public | — | — | — |
| `allowance(address owner, address spender) returns (uint256)` | public | — | — | — |
| `approve(address spender, uint256 value) returns (bool)` | public | — | — | — |
| `transferFrom(address from, address to, uint256 value) returns (bool)` | public | — | — | — |
| `_transfer(address from, address to, uint256 value)` | internal | — | — | — |
| `_update(address from, address to, uint256 value)` | internal | — | Transfer | `DysnomiaInsufficientBalance` |
| `_mint(address account, uint256 value)` | internal | — | — | — |
| `_approve(address owner, address spender, uint256 value)` | internal | — | — | — |
| `_approve(address owner, address spender, uint256 value, bool emitEvent)` | internal | — | Approval | — |
| `_spendAllowance(address owner, address spender, uint256 value)` | internal | — | — | `DysnomiaInsufficientAllowance` |

Events declared: `Transfer(address indexed from, address indexed to, uint256 value)` · `Approval(address indexed owner, address indexed spender, uint256 value)`

Errors declared: `MarketRateNotFound(address asset)` · `DysnomiaInsufficientBalance(address origin, address sender, address from, address to, address what, uint256 balance, uint256 needed)` · `DysnomiaInsufficientAllowance(address origin, address sender, address owner, address spender, address what, uint256 allowance, uint256 needed)`
<!-- fntable-end -->

### `MultiOwnable` — `lib/multiownable.sol`

<!-- fntable: MultiOwnable @ lib/multiownable.sol -->
<!-- fntable-begin: MultiOwnable @ lib/multiownable.sol -->
Function table extracted mechanically from `lib/multiownable.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address initialOwner)` | deployer | — | — | `OwnableInvalidOwner` |
| `owner() returns (address)` | public (external) | — | — | — |
| `owner(address cOwner) returns (bool)` | public | — | — | — |
| `_checkOwner()` | internal | — | — | `OwnableUnauthorizedAccount` |
| `renounceOwnership(address toRemove)` | owners | — | — | — |
| `addOwner(address newOwner)` | owners | — | — | `OwnableInvalidOwner` |
| `_changeOwnership(address cOwner, bool cState)` | internal | — | OwnershipUpdate | — |

Events declared: `OwnershipUpdate(address indexed newOwner, bool indexed state)`

Errors declared: `OwnableUnauthorizedAccount(address origin, address account, address what)` · `OwnableInvalidOwner(address origin, address owner, address what)`
<!-- fntable-end -->

Effects worth naming:

- `mintToCap()` — public owners-gated manual tick of the meter (most flows call
  the internal `_mintToCap()` themselves).
- `Purchase(asset, amount)` — pull `amount × rate` of `asset` from the caller
  (needs allowance), send `amount` of self. `Redeem` is the inverse. Both revert
  `MarketRateNotFound` for unregistered assets and use `require` with a
  concatenated "Need Approved <name>" string on transfer failure.
- Insufficient balance/allowance reverts carry `tx.origin, msg.sender, from, to,
  address(this), balance, needed` — forensically rich failures
  (`DysnomiaInsufficientBalance`, `DysnomiaInsufficientAllowance`).

## 6. Integration notes

- Any client: the ERC-20 face plus `GetMarketRate(asset)` are anonymous-safe
  reads. Do not assume `owner()` means ownership — use `owner(address)`.
- Writers: expect `onlyOwners` to pass for contracts called by an owner EOA;
  expect `_mintToCap` to make "view-ish" state reads cost gas when a contract
  implements them non-view (e.g. ZHENG.GetRodByIdx mints!).
- At-cap behavior: functions continue to succeed; only the self-mint stops.
  Supply == maxSupply × 1e18 is the exact saturation signature
  (20/28 capped contracts sit there `[chain]`).

## 7. Provenance

- [src] `01_dysnomia.sol`, `01_dysnomia_v2.sol`,
  `lib/multiownable.sol`.
- [chain] `Xiao()` probes on every deployed system contract; cap/supply snapshot block 27,584,967
  (2026-09-19).
