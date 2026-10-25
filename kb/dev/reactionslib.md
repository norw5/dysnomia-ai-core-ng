# ReactionsLib — "DYSNOMIA ReactionsLib" — the orbit primitives, centralized

> Wave 2 · 2025-02-25 18:55 UTC · deployed `[chain]` · at cap

## In player terms

| | |
|---|---|
| **The world's clockwork room** | Everything you do that "stirs entropy" — entering a venue, chatting, spinning the statistics — bottoms out in these functions. This library is the single set of gears every later contract turns. |
| **One-step orbits** | Each function advances a channel or entity exactly one step along the shared modular-exponent orbit. Motion here is what makes your personal entropy number drift over time. |
| **Named after the sky** | The three kernel channels (Eris, Fomalhaute, Fornax) each have a dedicated spinner here — hard-wired soul indexes, not lookups. The "constellation" wiring is literal: these functions know the stars by their registry slots. |
| **Self-tested at boot** | The constructor ran a full orbit drill and asserted health numbers above a threshold — deployment would have failed on a sick kernel. It passed, and the world booted. |
| **Reach it through CHO** | `CHO.Reactor()` resolves here — the supported doorway for tools. |

## 1. Identity

| | |
|---|---|
| Address | `0x8704d7740735F6DEA0103366fE297Ba3F9fCaCc4` |
| Creation | block 22,804,034 — 2025-02-25 18:55 UTC (tx `0xd8145071fde58e465422a8011aa128e1d85baf90490de072b24618d50d22a78b`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | DYSNOMIA ReactionsLib / ReactionsLib `[chain]` |
| Supply / cap | 71,736 / 71,736 — **at cap** `[chain]` |
| Library name | `corereactions` (self-registered) · `Reactor()` on CHO resolves here `[chain]` |

## 2. Role

Wave 2's first contract and the foundation of everything after it: enters the
world as a user (its own SHIO), self-registers as the "corereactions"
library, and centralizes the orbit primitives the CHO-era stack uses —
single-sided SHIO steps (`ReactShioRod/Cone`), the XOR-mixed variants over
YANG's Tai triple (`ReactTo{Bang,Lai,Le,New}`), the three constellation
channel spinners (`React{Eris,Fomalhaute,Fornax}`), talk-mode (`ReactToTalk`)
and the personal-entropy extractor `Entropy(bao) = modExp64(cone.Chin,
rod.Chin, MotzkinPrime)`. Its constructor runs a full orbit self-test and
asserts `BLACK/BRIGHTNESS/HUE/WHITE > 1551` — health checks on the kernel's
liveness (they pass ⇒ the spine was in a good state at wave-2 boot).

## 3. Dependencies

- Reads the whole spine through `Void.Nu().Psi()…` chains (YANG's Rho triple,
  ZHOU's channel, YI's Psi).
- Called by CHO (`Reactor().ReactShioRod/ReactToLai/ReactShioCone…` — the
  entropy machine) and by the undeployed NYM design.

## 4. State

`Void`, `Cho` (set later via `RegisterChoForTalk` — CHOA-era wiring), plus
the six constructor-computed orbit registers (BLACK, HYUN, SHUTTER,
BRIGHTNESS, HUE, WHITE).

## 5. Functions

<!-- fntable: COREREACTIONSLIB @ lib/reactions_core.sol -->
<!-- fntable-begin: COREREACTIONSLIB @ lib/reactions_core.sol -->
Function table extracted mechanically from `lib/reactions_core.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address VoidAddress)` | deployer | meter | — | `assert` |
| `RegisterChoForTalk(address ChoAddress)` | owners | — | — | — |
| `Entropy(Bao memory On) returns (uint64)` | public | meter | — | — |
| `Initialize(Bao memory On) returns (uint64, uint64)` | public | — | — | — |
| `ReactToTalk(User memory Alpha) returns (uint64, uint64)` | public | meter | — | — |
| `React(Bao memory On, uint64 Omicron, uint64 Omega) returns (uint64, uint64)` | public | — | — | — |
| `ReactToBang(Bao memory On, uint64 Omicron, uint64 Omega) returns (uint64, uint64)` | public | — | — | — |
| `ReactToLai(Bao memory On, uint64 Omicron, uint64 Omega) returns (uint64, uint64)` | public | — | — | — |
| `ReactToLe(Bao memory On, uint64 Omicron, uint64 Omega) returns (uint64, uint64)` | public | — | — | — |
| `ReactToNew(Bao memory On, uint64[3] memory Saat) returns (uint64, uint64)` | public | — | — | — |
| `OperatorReact(Bao memory On, uint64 Omega) returns (uint64, uint64)` | public | — | — | — |
| `ReactBang(uint64 Eta) returns (uint64, uint64)` | public | — | — | — |
| `ReactLai(uint64 Gamma) returns (uint64, uint64)` | public | — | — | — |
| `ReactLe(uint64 Delta) returns (uint64, uint64)` | public | — | — | — |
| `ReactEris(uint64 Iota) returns (uint64, uint64)` | public | — | — | — |
| `ReactFomalhaute(uint64 Mu) returns (uint64, uint64)` | public | — | — | — |
| `ReactFornax(uint64 Rho) returns (uint64, uint64)` | public | — | — | — |
| `ReactShioRod(SHIO Beta, uint64 Theta) returns (uint64, uint64)` | public | meter | — | — |
| `ReactShioCone(SHIO Beta, uint64 Theta) returns (uint64, uint64)` | public | meter | — | — |
<!-- fntable-end -->

Effects: every public function meters. `ReactToTalk(User memory)` takes its
struct **by value** — computed entropy does not persist unless the caller
reassigns (NYM.Chat neglects to; see [nym.md](./nym.md)). `ReactShioRod/Cone`
are the two bread-and-butter single-sided steps everything reduces to.

## 6. Integration notes

- Reach it via `CHO.Reactor()` (public view `[chain]`); anonymous-safe.
- The constellation spinners hard-code the soul indexes of YANG.Lai (Eris),
  ZHOU (Fomalhaute) and YI.Psi (Fornax) — the "physics constants" wiring.

## 7. Provenance

- [src] `lib/reactions_core.sol` (contract
  `COREREACTIONSLIB`).
- [chain] perimeter; `CHO.Reactor()` probe resolves this address.
