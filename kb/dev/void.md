# VOID — "CHATLOG Void" — the session shell + library loader

> Wave 1 · 2024-08-23 00:49 UTC · deployed `[chain]` · at cap

## In player terms

| | |
|---|---|
| **The login layer** | You do not "log in" with a password — your wallet holding a session is the login. VOID keeps the session table (`_activeUsers`), and `Enter` is open-session/first-session logic. Your LAU wraps it: you call LAU things, VOID does the bookkeeping. |
| **The chat post office** | `Chat(line)` stamps your username on the line and routes it to the main room (ZHOU's channel). No session or no username → revert. All chat roads lead through VOID. |
| **The system's plugboard** | Named capability libraries ("libattribute", "corereactions", "strings") register themselves here at deployment; anything that wants a library asks VOID for it by name. |
| **The original owner of everything** | At boot VOID took ownership of the entire spine below it — until CHO arrived six months later and took ownership of VOID. Authority in this world is a chain of custody you can trace onchain. |
| **Watch out** | `Chat` is public but useless without a session — a raw EOA that never joined reverts `NoUserEntry`. Go through your LAU. |

## 1. Identity

| | |
|---|---|
| Address | `0x965b0d74591bf30327075a247c47dbf487dcff08` |
| Creation | block 21,220,706 — 2024-08-23 00:49 UTC (tx `0x83edd47ea795a3db9740d335b7b57252e8ba75bd06e0e9fa9af1baf58c5b7b42`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | CHATLOG Void / VOID `[chain]` |
| Supply / cap | 80,373 / 80,373 — **at cap** `[chain]` |
| Chat activity | last VOID `Chat` 2026-09-11 `[chain]` |

## 2. Role

The login/session layer over SIU and the kernel's user-facing face. VOID
keeps `_activeUsers: address → uint64 Soul` (the session table); `Enter(name,
symbol)` creates a user (via SIU.Miu) or re-opens a session; `Chat(line)`
requires a session + a Username attribute and writes `"<Username> line"` to
ZHOU's SHIO (the main room). VOID is also the **library loader**:
`AddLibrary(name, addr)` is how LibAttribute ("libattribute"), ReactionsLib
("corereactions"), LibStrings ("strings") and — in design — ENCRYPT
("encrypt") register themselves. The constructor takes ownership of the
ENTIRE spine below it plus the Bang/Lai channels: VOID is the root of the
wave-1 ownership web (until CHO takes over in wave 2).

## 3. Dependencies

- Calls: SIU.Miu, ZHENG.GetRodByIdx (GetBySoul), the ZHOU + YANG channels
  (Log routing), LibAttribute for attributes/aliases.
- Called by: LAU (Enter/Chat/attributes), LAUFactory (ownership),
  LibAttribute/ReactionsLib/LibStrings constructors (AddLibrary), CHO (takes
  ownership over VOID in wave 2), MAP (`Cho.Void().addOwner`).

## 4. State

`Nu` (SIU), `_activeUsers`, `_kecNames` (the "ZHOU"/"YANG" log-route table),
`_libraries` (name → address).

## 5. Functions

<!-- fntable: VOID @ 10_void.sol -->
<!-- fntable-begin: VOID @ 10_void.sol -->
Function table extracted mechanically from `10_void.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address SiuAddress)` | deployer | — | — | — |
| `Augment()` | internal | meter | — | — |
| `GetLibraryAddress(string memory name) returns (address)` | public | — | — | — |
| `AddLibrary(string memory name, address _a)` | owners | meter | — | — |
| `Log(string memory LogLine)` | public | meter | — | — |
| `Log(uint64 Sigma, string memory LogLine)` | owners | meter | — | — |
| `Log(address Sigma, string memory LogLine)` | owners | meter | — | — |
| `Log(string memory Xi, string memory LogLine)` | internal | meter | — | `InvalidLogXi` |
| `Chat(string memory chatline)` | public | meter | — | `NoUserEntry`, `NoUserName` |
| `SetAttribute(string memory name, string memory value)` | public | meter | — | `NoUserEntry` |
| `GetAttribute(string memory name) returns (string memory)` | public | — | — | — |
| `Alias(address name, string memory value)` | public | meter | — | `NoUserEntry` |
| `Alias(address name) returns (string memory)` | public | — | — | — |
| `Alias(Bao memory Theta, string memory value)` | public | meter | — | `NoUserEntry` |
| `Alias(Bao memory Theta) returns (string memory)` | public | — | — | — |
| `GetBySoul(uint64 Sigma) returns (Bao memory On)` | internal | — | — | — |
| `Enter() returns (uint64[3] memory Saat, Bao memory On)` | public | meter | — | `NoUserEntry`, `NotShioOwner` |
| `Enter(string memory name, string memory symbol) returns (uint64[3] memory Saat, Bao memory On)` | public | meter | — | `UserAlreadyCreated`, `NotShioOwner` |

Errors declared: `InvalidLogXi(string Xi)` · `NoUserEntry(address User)` · `NoUserName(address User)` · `NotShioOwner(address Shio, address Requestor)` · `UserAlreadyCreated(address User)`
<!-- fntable-end -->

Effects: `Log(line)` — public, unmetered? no: metered — logs to the caller's
own SHIO with `Nu.Aura()`. The `Log(string Xi, …)` overload is internal and
routes by name to ZHOU's or YANG's channel (`InvalidLogXi` otherwise) — this
is what Chat uses. `Enter()` (no args) re-enters an existing session and
checks the caller owns their SHIO (`NotShioOwner`); `Enter(name, symbol)`
refuses existing users (`UserAlreadyCreated`), births through SIU.Miu, adds
the caller as owner of their SHIO, and stores the session.
`SetAttribute`/`GetAttribute`/`Alias` delegate to the "libattribute" library
with the caller's Soul; `GetAttribute` is the only unmetered one (view).

## 6. Integration notes

- Chat = `VOID.Chat` from the LAU (the LAU is in the SHIO's owner set; a raw
  EOA that never entered has no session and reverts `NoUserEntry`).
- Anonymous reads: `GetLibraryAddress(name)` is the way to find the live
  library set (libattribute/corereactions/strings).
- The private `Log(Xi, …)` routing means VOID.Chat targets ZHOU's channel
  deterministically; frontends listening for main-room chat watch the
  Fomalhaute SHIO address.

## 7. Provenance

- [src] `10_void.sol`.
- [chain] perimeter; last Chat 2026-09-11 (`last_activity.json`).
