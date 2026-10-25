# LAU — the user-account token (factory-child TYPE)

> Type doc: 18,660 live instances `[chain]`, all children of
> [LAUFactory](./laufactory.md). A LAU is "you" inside the world.

## In player terms

| | |
|---|---|
| **Your account IS a token** | Joining = deploying a personal ERC-20 named after yourself (you pick name + symbol at the door). Your supply counts your own lifetime activity — the dev's account has "used himself" 5,977 times `[chain]`. |
| **Your chat handle** | `LAU.Chat("hi")` is the everyday main-room message. The LAU owns your channel, so it can write; your raw wallet cannot. |
| **Your profile card** | Username, aliases, session reset (`Void`, double-confirmed) — the self-service identity controls all live on the LAU. |
| **Your pocket** | Anything the LAU happens to hold (bounties, gifts, mistakes) can be swept out with `Withdraw` — it is your own custody, one hop deep. |
| **How the world sees you** | Venues read admission off your LAU; CHOA registers it; PKMinter tokens name it as their parent. It is the object other contracts mean when they say "user". |

## 1. Identity

| | |
|---|---|
| Type | `Type() == "LAU"` |
| Factory | [LAUFactory](./laufactory.md) `0xbA6CcD38992839aEE20D5bF9125b1d94190b091C` |
| Census | **18,660** created 21,220,723 → 27,581,933 — still being created the week of the 2026-09-19 census `[chain]` |
| Reference instance | the dev's account: `0xD32c39fEE49391c7952d1b30b15921b0D3b42E69` — name "mariarahel", symbol 倫, supply 5,977 (lifetime call count) `[chain]`; alias "mariarahel" in CHO's address book; diyat-tax recipient of RandomGenerator |
| Source | `11_lau.sol` |

## 2. Role

The wallet-inside-the-world: creating a LAU enters the user into VOID (which
births their SHA pair + SHIO through the spine), takes shared ownership of
the user's SHIO and rod, and then serves as their face — chat, username,
aliases, session reset, and a `Withdraw` for anything it holds. First account
ever: "mariarahel" four blocks after the factory itself `[chain]`.

## 3. Dependencies

- Constructor calls `VOID.Enter(name, symbol)` (full user creation), then
  `On.Shio.addOwner(address(this))` + rod ownership.
- Called by its owner EOA (chat etc. via tx.origin-OR-msg.sender), by QING
  (`Join`/`Chat` read Saat/Username off it), by CHOA (`Play`/`Chat`), by
  PKMinter's TT (Parent reference).

## 4. State

`Eta` (VOID), `Saat` (uint64[3] — the id triple), `On` (the user's Bao),
`CurrentArea`. The triple's full semantics (set once at birth by
[siu.md](./siu.md).Miu): `Saat[0]` = the Pole state at identity generation,
`Saat[1]` = the Soul (a fresh Random() draw), `Saat[2]` = the Aura
(`uint64(uint160(tx.origin)) % MotzkinPrime` — the wallet fingerprint)
`[src: 09_siu.sol:31-35]`.

## 5. Functions

<!-- fntable: LAU @ 11_lau.sol -->
<!-- fntable-begin: LAU @ 11_lau.sol -->
Function table extracted mechanically from `11_lau.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(string memory name, string memory symbol, address VoidAddress)` | deployer | meter | — | — |
| `Withdraw(address what, uint256 amount)` | owners | — | — | — |
| `Void(bool really1, bool really2)` | owners | meter | — | — |
| `Leave()` | owners | — | — | — |
| `Username() returns (string memory)` | public | — | — | — |
| `Username(string memory newUsername)` | owners | meter | — | — |
| `Chat(string memory chatline)` | owners | meter | — | — |
| `Alias(address name, string memory value)` | owners | meter | — | — |
| `Alias(address name) returns (string memory)` | owners | — | — | — |
| `Alias(Bao memory Theta, string memory value)` | owners | meter | — | — |
| `Alias(Bao memory Theta) returns (string memory)` | owners | — | — | — |
<!-- fntable-end -->

Effects: `Withdraw(what, amount)` — owners-gated transfer-out of any token it
holds + a log line (source comment: "Potentially System OR User Function But
Currently System Will Not Have Any Ownership" — i.e. user-only in practice).
`Void(really1, really2)` — double-confirmed session reset (re-Enter + log);
`Leave()` clears `CurrentArea`; `Username` get/set; `Chat(line)` delegates to
VOID.Chat; `Alias` overloads for address/Bao keys.

## 6. Integration notes

- LAU-formation caveat (owner review round): LAUs created through
  non-standard routes may not be recognized by frontends — the census counts
  factory children; a "fully-formed/registered" subset metric is queued
  (an open question).
- A LAU's `Saat(1)` is the Soul; `On()` returns the full Bao (public getter) —
  the cheapest identity probe for indexers.
- SelfSnipe (`etc/DysnomiaSelfSnipe.sol`) is a community helper (not a system
  contract) that chains `LAU.Chat` + `LAU.Purchase(AFFECTION, 1e18)` in one
  tx — header comment credits `as-helios`.

## 7. Provenance

- [src] `11_lau.sol`; `etc/DysnomiaSelfSnipe.sol`.
- [chain] `factory_children.json` (18,660); perimeter (mariarahel LAU).
