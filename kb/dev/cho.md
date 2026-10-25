# CHO — "Dysnomia Cho" — the hub

> Wave 2 · 2025-02-26 22:51 UTC · deployed `[chain]` · at cap · in daily use
> two years on (last tx landed the day of our census `[chain]`)

## In player terms

| | |
|---|---|
| **The bouncer everyone trusts** | Before a venue or game action lets you in, it asks CHO to vouch for you: CHO verifies your LAU (and that you hold no ban token), then keeps a delegate record so the whole stack recognizes you. One `Enter`, recognized everywhere. |
| **Your personal entropy** | CHO tracks a per-user "entropy" number that every action stirs. It is not a score you farm directly — it is the denominator the world's statistics divide by, so living actively here makes your derived numbers change. |
| **The map dice** | Where new venues land is drawn from CHO's `Luo()` — a lottery over a huge constant. New QING coordinates are fate, not choice. |
| **The phone book** | ~90 system aliases (written once, at boot, by a throwaway loader): "source" = the treasury-side deployer key, reserve assets, community tokens, the dev's own account. Read it with `Addresses(alias)`. |
| **Alive daily** | Two years on, transactions still land here most days `[chain]` — this is the living center of the world, not a relic. |

## 1. Identity

| | |
|---|---|
| Address | `0xB6be11F0A788014C1F68C92F8D6CcC1AbF78F2aB` |
| Creation | block 22,813,850 — 2025-02-26 22:51:35 UTC (tx `0xe3fe43fcee57607a18c72694a8ce8c9f397c7eec832c60f93062f3b7cfa30b98`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | Dysnomia Cho / CHO `[chain]` |
| Supply / cap | 26,995 / 26,995 — **at cap** `[chain]` |
| Own SHIO | `0x2060040d1084b1770362004355153594e4461f8` (its user channel; "Tethys" in the dev-published constellation list) `[chain, On() decode]` |
| Cross-link | treasury-side Basilica `0xae488a2b6fe8fe922019c1442c60f9dec0282894` whitelists CHO as its only minter target (2025-06-24) — the motive an open question |

## 2. Role

The wave-2 centerpiece: CHO enters the world like a user (constructor runs the
same Enter path any LAU would), then takes ownership of VOID's whole spine
and `addOwner(tx.origin)` — the hub absorbs the kernel. Five jobs:

1. **Session hub.** `Delegates: address → User{Soul, Bao, Username,
   Entropy}` plus the reverse `DelegateAddresses: Soul → address`. When a
   QING.Join or CHOA.Play needs "who is this and are they allowed?", they
   enter/look the caller up here rather than each keeping user lists.
2. **Entropy machine.** `React`/`Recall`/`ReactUser` push the system state
   and each user's personal state one step along the shared
   ReactionsLib orbit. Every venue entry, chat, and ladder read mixes a bit
   more motion into the numbers the statistics later divide by.
   Beat-study precision: the chain head is CHO's own
   `Entropy` storage, advanced by `Recall` — which the **stateful
   `GetUser()` getter calls on every metered path** (several times per
   Beat) — so the global head ratchets on *anyone's* ordinary reads, and
   previews (eth_call) are pure while commits always move the world. Also
   note the `GetUser` quirk: `Recall(Alpha)` receives the uninitialized
   local, so the per-user Entropy update is a pure function of the global
   head.
3. **Coordinate-lottery source.** `Luo()` draws and claims a never-repeated
   coordinate from an orbit over the constant `Gua`; MAP multiplies it into
   every new QING's position (see the `Qu` claim map + the gas-unbounded
   retry loop under Effects).
4. **System address book.** `Addresses: alias → address`, ~90 entries
   written once by the one-shot [setaddresses](./alias-dir.md) — Maria #2
   as "source", the treasury corpus as named citizens, the ban tokens, the
   dev's LAU. Append-only (`AddSystemAddress`).
5. **Runtime privilege injector.** `AddContractOwner` lets owners grant
   MultiOwnable membership on any contract — the wave-2+ equivalent of an
   admin key, used sparingly and all onchain.

## 3. Dependencies

- Owns: VOID and (through it) the entire wave-1 spine; mutual ownership with
  MAP and every QING.
- Calls: ReactionsLib (via `Reactor()`), LibAttribute/LAU (VerifyUserToken
  path), ZHENG (GetRodByIdx), MATH (`Xiao`).
- Called by: MAP.New (Luo), QING (Join/Chat/Withdraw permission checks),
  CHOA/SEI/NYM/undeployed WORLD (Enter/ReactUser), Basilica (mint target).

## 4. State

`Void`, own `Saat/On/Entropy`, `Delegates` + `DelegateAddresses`, `Addresses`
+ `Aliases`, `Qu: uint256 → address` (the coordinate claim map), constant
`Gua = 1652929763764148448182513644633101239607891671119935657884642`
(verified live `[chain]`).

## 5. Functions

<!-- fntable: CHO @ domain/dan/01_cho.sol -->
<!-- fntable-begin: CHO @ domain/dan/01_cho.sol -->
Function table extracted mechanically from `domain/dan/01_cho.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address VoidAddress)` | deployer | meter | — | — |
| `AddContractOwner(address Contract, address Owner)` | owners | — | — | — |
| `has(address _contract, string memory what) returns (bool does)` | public | — | — | — |
| `AddSystemAddress(string memory Alias, address Address)` | owners | — | — | `SystemAddress` |
| `AddLibraryOwner(string memory what)` | owners | — | — | — |
| `Reactor() returns (LIBCOREREACTIONS)` | public | — | — | — |
| `Luo() returns (uint256 De)` | owners | meter | — | — |
| `VerifyUserTokenPermissions(address UserToken)` | public | — | — | `InvalidUserToken`, `assert` |
| `Enter(address UserToken) returns (User memory)` | public | meter | — | `InvalidOwnership` |
| `Recall(User memory Alpha) returns (uint64 UserEntropy)` | public | — | — | — |
| `GetUser() returns (User memory Alpha)` | public | — | — | `UserNotEntered` |
| `GetUserSoul() returns (uint64)` | public | — | — | `UserNotEntered` |
| `React(uint64 Eta) returns (uint64, uint64)` | public | meter | — | — |
| `ReactUser(uint64 Soul, uint64 Epsilon) returns (uint64 Omicron)` | public | meter | — | `SoulNotEntered` |
| `GetUserBySoul(uint64 Soul) returns (User memory Alpha)` | public | — | — | `UserNotEntered` |
| `GetAddressBySoul(uint64 soul) returns (address UserAddress)` | public | — | — | `SoulNotEntered` |
| `GetUserTokenAddress(address wallet) returns (address UserToken)` | public | — | — | — |

Errors declared: `SystemAddress(address Address, string Alias)` · `InvalidUserToken(address Asset)` · `InvalidOwnership(address UserToken, address User)` · `UserNotEntered(address User)` · `SoulNotEntered(uint64 Soul)` · `InvalidUser()`
<!-- fntable-end -->

Effects: `Luo()` loops `React` until `De = modExp(Omega, Omicron, Gua)` is
nonzero and unclaimed, then `Qu[De] = msg.sender` — a gas-unbounded lottery
loop. `VerifyUserTokenPermissions` asserts the caller holds zero WITHOUT
`0x173216Ed67eBF3E6767D86e8b3Ff32e0d64437bF` and that the LAU owns its SHIO
+ rod (`InvalidUserToken`). `Enter(UserToken)` wires the delegate and computes
fresh entropy (`Recall`). `GetUser`/`GetUserBySoul` re-Recall (they mutate
entropy — non-view!). `ReactUser(soul, eps)` advances a specific user's orbit
through their cone. `has(contract, sig)` — raw staticcall duck-typing probe.

Interface drift `[chain]`: the CHOINTERFACE used by MAP/QING/WORLD
matches deployed CHO, but the newer interface copy (used by old-era NYM)
declares `CYUN()`, `Log(uint64,uint64,string)` and `OperatorSendMSG(string)` —
all three **revert** on the live CHO. Live getters verified: `Gua()`, `Void()`,
`On()`, `Entropy()`, `Reactor()`.

## 6. Integration notes

- Entry flow for any venue/tool: user calls `CHO.Enter(their LAU)` (or a
  QING/CHOA does it for them); WITHOUT-balance holders are refused everywhere
  (token-based ban).
- Anonymous reads: `GetAddressBySoul`, `GetUserTokenAddress`, `Addresses(alias)`
  are view; `GetUser*` are NOT (they advance entropy + meter).
- `Luo()` is owners-gated (MAP calls it as an owner); each call's gas is
  unbounded — integrators should never expose it to unfiltered input.
- The address book is append-only via `AddSystemAddress` (duplicate alias
  reverts `SystemAddress`).

## 7. Provenance

- [src] `domain/dan/01_cho.sol`,
  `domain/dan/interfaces/01b_chointerface.sol`.
- [chain] perimeter; `Gua()`/`On()`/`CYUN()` probes (sessions 27–28);
  last_activity (tx the census day).
