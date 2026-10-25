# ZHENG — "CHATLOG Zheng" — the soul registry + user factory

> Wave 1 · 2024-08-23 00:46 UTC · deployed `[chain]` · at cap

## In player terms

| | |
|---|---|
| **The census office** | Every entity that exists — every user, every kernel organ — occupies one numbered slot (`Sigma: soul id → record`). No slot, no existence: "being someone" in this world means having a ZHENG slot. |
| **One call births you** | `Mau` is the one-call user factory: it creates your two SHA halves, your channel, runs the key agreement, and installs everything under your fresh soul id. The whole journey from wallet to person is a single internal call chain ending here. |
| **Slots are first-come, permanently yours** | `InstallRod`/`InstallCone` refuse taken soul slots — an entity record can never be overwritten, only created once. |
| **Reading the registry costs gas** | The record getter mints (it is non-view) — the registry is a living contract, not a database you query for free. |

## 1. Identity

| | |
|---|---|
| Address | `0x24e62c39e34d7fe2b7df1162e1344eb6eb3b3e15` |
| Creation | block 21,220,689 — 2024-08-23 00:46 UTC (tx `0x37b501436e00d9fcfa5d3a5be8deb211024df07b8bfadb48975e971d1e3ef573`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | CHATLOG Zheng / ZHENG `[chain]` |
| Supply / cap | 43,762 / 43,762 — **at cap** `[chain]` |
| `Xiao()` | MATH `0xB680F0cc810317933F234f67EB6A9E923407f05D` |

## 2. Role

The **soul registry**: `Sigma: uint64 → Bao` maps every soul id to its entity
record (the `Bao` — account, SHAs, channel, entropy pair; struct in
`include/bao.sol`). `InstallRod`/`InstallCone` write registry slots (refusing
taken ones); `Mau` is the one-call user factory used by the whole system
(`LAUFactory.New` reaches it through SIU.Miu → ZHENG.Mau). Every user of the
world exists because ZHENG wrote a slot here.

## 3. Dependencies

- Holds/owns YI (constructor `Eta.addOwner(address(this))`); YI's factories do
  its deployments.
- Called by: ZHOU/YAU/YANG (rod installs), SIU.Miu → Mau (every user),
  VOID.GetBySoul → GetRodByIdx (every session read), QI/XIE/ZI constructors
  (channel lookups by soul index).

## 4. State

`Eta` (YI), `Sigma` (uint64 → Bao — THE registry). Note `GetRodByIdx` is
non-view (it meters!) — reading the registry through it costs gas and mints.

## 5. Functions

<!-- fntable: ZHENG @ 05_zheng.sol -->
<!-- fntable-begin: ZHENG @ 05_zheng.sol -->
Function table extracted mechanically from `05_zheng.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address YiContract)` | deployer | — | — | — |
| `Augment()` | internal | meter | — | — |
| `GetRodByIdx(uint64 _theta) returns (Bao memory)` | public | meter | — | — |
| `InstallRod(uint64 Theta, Bao memory Beta, uint64 Monopole) returns (Bao memory)` | owners | meter | — | `SigmaAlreadyInstalled` |
| `InstallCone(uint64 Theta, Bao memory Beta, uint64 Monopole) returns (Bao memory)` | owners | meter | — | `SigmaAlreadyInstalled` |
| `Mau(string memory name, string memory symbol, uint64 Xi, uint64 Rho, uint64 Upsilon) returns (Bao memory On)` | owners | meter | — | — |
| `Iodize(SHIO Shio)` | public | meter | — | — |

Errors declared: `SigmaAlreadyInstalled(address Phi)`
<!-- fntable-end -->

Effects: `InstallRod`/`InstallCone` refuse taken slots
(`SigmaAlreadyInstalled`), Bing the Bao into YI.Nu, advance it via YI.React,
store it, log "Rod/Cone Installed In Zheng Sigma" on the entity's SHIO, and
register market rates for the entity's contracts. `Mau(name, symbol, Xi, Rho,
Upsilon)` creates "<name> Rod"+"<sym>ROD" and "<name> Siu Cone"+"<sym>VCONE"
SHAs via YI.Beta, the SHIO via YI.Kappa, Generates, Iodizes, Magnetizes and
InstallCone's the result — one call births a user. `Iodize` = Isomerize +
Isolate on a SHIO.

## 6. Integration notes

- Frontends resolve a wallet to its Bao via VOID (which routes here); direct
  `GetRodByIdx` is fine but remember it is a stateful call (meter).
- `Mau` is owners-only — user creation actually flows through SIU.Miu, which
  passes because the spine owns ZHENG.
- Soul 0 is the null slot (VOID checks `_activeUsers[msg.sender] == 0` upstream).

## 7. Provenance

- [src] `05_zheng.sol`, `include/bao.sol`.
- [chain] perimeter; last activity 2026-09-03.
