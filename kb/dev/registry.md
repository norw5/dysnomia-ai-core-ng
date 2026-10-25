# Registry — the typed key-value store — **NOT DEPLOYED**

> **NOT DEPLOYED** — complete in source; nothing in the recovered tree
> imports it and no deployment exists onchain `[chain]`. Documented because
> the recovered community docs cover it and the fn-table layer
> tables it; it is part of the dev's general-purpose kit, not the live
> system.

## 1. Identity

| | |
|---|---|
| Source | `lib/registry.sol` (contract `Registry is MultiOwnable`) |
| Onchain | absent — no create among the deployer's 34; probed nothing; nothing references it `[chain]` |
| Solidity | ^0.8.21, SPDX "Sharia" |

## 2. Role

A generic **typed key-value registry**: one bytes→bytes store behind a wall
of overloaded accessors — keys and values can each be `bytes`, `string`,
`uint64`, `uint256`, or `address` (every combination encoded to bytes; the
conversion helpers `Uint64ToBytes`/`Uint256ToBytes`/`AddressToBytes` are
public). Writes are owners-gated, reads public, and the `_keys` array makes
the store enumerable. Insert is **write-once**: `Register` only acts when
the key is not yet inserted (`if(!_inserted[key])` — a re-Register with a
different value silently does nothing, there is no update path); `Remove`
is a proper swap-and-pop (reindexes the tail key), after which the key can
be re-registered.

## 3. Dependencies

`MultiOwnable` only (`lib/multiownable.sol`) — no DYSNOMIA base, no meter,
no Xiao: this is the rare tree contract that is NOT a token.

## 4. State

`_values: bytes → bytes`, `_inserted: bytes → bool`, `_indexOf: bytes →
uint256`, `_keys: bytes[]` — all private; the public surface is the
accessor wall.

## 5. Functions

<!-- fntable: Registry @ lib/registry.sol -->
<!-- fntable-begin: Registry @ lib/registry.sol -->
Function table extracted mechanically from `lib/registry.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor()` | deployer | — | — | — |
| `Get(bytes memory key) returns (bytes memory)` | public | — | — | — |
| `Get(uint256 idx) returns (bytes memory)` | public | — | — | — |
| `Inserted(bytes memory what) returns (bool)` | public | — | — | — |
| `Inserted(string memory what) returns (bool)` | public | — | — | — |
| `Uint64ToBytes(uint64 what) returns (bytes memory _w)` | public | — | — | — |
| `Inserted(uint64 what) returns (bool)` | public | — | — | — |
| `Uint256ToBytes(uint256 what) returns (bytes memory _w)` | public | — | — | — |
| `Inserted(uint256 what) returns (bool)` | public | — | — | — |
| `AddressToBytes(address what) returns (bytes memory _w)` | public | — | — | — |
| `Inserted(address what) returns (bool)` | public | — | — | — |
| `Count() returns (uint256)` | public | — | — | — |
| `GetHashByIndex(uint256 index) returns (bytes memory)` | public | — | — | — |
| `Register(bytes memory key, bytes memory value)` | owners | — | — | — |
| `Register(string memory _key, bytes memory value)` | owners | — | — | — |
| `Register(string memory _key, string memory value)` | owners | — | — | — |
| `Register(string memory _key, uint64 value)` | owners | — | — | — |
| `Register(string memory _key, uint256 value)` | owners | — | — | — |
| `Register(string memory _key, address value)` | owners | — | — | — |
| `Register(uint64 _key, bytes memory value)` | owners | — | — | — |
| `Register(uint64 _key, string memory value)` | owners | — | — | — |
| `Register(uint64 _key, uint64 value)` | owners | — | — | — |
| `Register(uint64 _key, uint256 value)` | owners | — | — | — |
| `Register(uint64 _key, address value)` | owners | — | — | — |
| `Register(uint256 _key, bytes memory value)` | owners | — | — | — |
| `Register(uint256 _key, string memory value)` | owners | — | — | — |
| `Register(uint256 _key, uint64 value)` | owners | — | — | — |
| `Register(uint256 _key, uint256 value)` | owners | — | — | — |
| `Register(uint256 _key, address value)` | owners | — | — | — |
| `Register(address _key, bytes memory value)` | owners | — | — | — |
| `Register(address _key, string memory value)` | owners | — | — | — |
| `Register(address _key, uint64 value)` | owners | — | — | — |
| `Register(address _key, uint256 value)` | owners | — | — | — |
| `Register(address _key, address value)` | owners | — | — | — |
| `Remove(bytes memory key)` | owners | — | — | — |
| `Remove(string memory _key)` | owners | — | — | — |
| `Remove(uint64 _key)` | owners | — | — | — |
| `Remove(uint256 _key)` | owners | — | — | — |
| `Remove(address _key)` | owners | — | — | — |
<!-- fntable-end -->

## 6. Integration notes

- Reference-only. No system contract calls it; had it shipped, it would have
  been the natural home for name→address or parameter bookkeeping outside
  CHO's alias book (which serves the live system that role via
  `Addresses(string → address)`).
- The overload wall is the trap for integrators: five `Get`-shaped and
  thirteen `Register`-shaped selectors exist; call the overload matching
  your key's actual type or you silently read/write a different slot.

## 7. Provenance

- [src] `lib/registry.sol`.
- [chain] absence (nothing in the perimeter; no references onchain).
- [ext] the recovered community docs carry a technical page for it
  (community-doc comparison).
