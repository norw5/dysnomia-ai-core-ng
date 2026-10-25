# YI — "CHATLOG Yi" — the factory gateway root

> Wave 1 · 2024-08-23 00:45 UTC · deployed `[chain]` · at cap

## 1. Identity

| | |
|---|---|
| Address | `0x4757438723055f14a1af5c9651c2e37730f41a9e` |
| Creation | block 21,220,685 — 2024-08-23 00:45 UTC (tx `0xc461d59fbbfe495b45e0ef96443cb3e605b44452f585b71d5d94785c7f30b8d5`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | CHATLOG Yi / YI `[chain]` |
| Supply / cap | 55,772 / 55,772 — **at cap** `[chain]` (snapshot block 27,584,967) |
| `Xiao()` | MATH `0xB680F0cc810317933F234f67EB6A9E923407f05D` |

## In player terms

| | |
|---|---|
| **The system's workshop** | Every SHA and SHIO that will ever exist — all ~25k keypair objects across every user — was deployed through YI's two gateway functions. YI is where raw crypto-objects get made. |
| **The first entity directory** | `Nu` maps addresses to their entity records (Bao). Later layers added richer directories, but this is the original. |
| **Home of a physics constant** | YI's own channel (Fornax, born in its constructor) becomes a modulus in the wave-3/4 "leak" statistics — the oldest object in the world stays load-bearing. |
| **You never call it** | The gateways are owner-gated and the spine holds the keys; user creation reaches YI three layers up (LAU → VOID → SIU → ZHENG → YI). |

## 2. Role

The root of the registry spine and the system's original factory gateway: YI
holds `Psi` (its own SHIO — the (Fornax) channel, created inside YI's
constructor), the `Nu: address → Bao` entity map, and the owners-only gateways
`Beta` (make a SHA) and `Kappa` (make a SHIO) that everything the system later
creates flows through. Layers above (ZHENG→…→VOID) each take ownership of YI
as they boot.

## 3. Dependencies

- Constructor: creates "Shio Rod"/"SROD" + "Shio Cone"/"SCONE" SHAs via
  [SHAFactory](./shafactory.md), then `Psi` via [SHIOFactory](./shiofactory.md)
  — same-block birth of the (Fornax) Shio `0xF6C50fFE7efbDeE63A92E52A4D5E9afF7fb4A4D7` —
  Generates and Magnetizes it.
- Called by ZHENG (Beta/Kappa/Bing/React), ZHOU (its constructor spins Psi-era
  channels), and by XIE's constructor (`…Eta().Psi()` — XIE's Fornax IS YI's
  Psi SHIO).

## 4. State

`Psi` (own SHIO), `Nu` (address → Bao registry mirror), `Xi` (own soul index),
`Ring`, the two factory-interface handles.

## 5. Functions

<!-- fntable: YI @ 04_yi.sol -->
<!-- fntable-begin: YI @ 04_yi.sol -->
Function table extracted mechanically from `04_yi.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address _shaFactory, address _shioFactory, address MathLib)` | deployer | — | — | — |
| `Augment()` | internal | meter | — | — |
| `Beta(string calldata Name, string calldata Symbol) returns (SHA)` | owners | meter | — | — |
| `Kappa(SHA Rod, SHA Cone) returns (SHIO)` | owners | meter | — | — |
| `Bing(Bao memory _b)` | owners | meter | — | — |
| `Bang(address _a) returns (Bao memory)` | public | — | — | — |
| `Ionize()` | private | meter | — | — |
| `React(Bao memory Gamma, uint64 Pi) returns (Bao memory)` | public | meter | — | — |
<!-- fntable-end -->

Effects: `Beta`/`Kappa` are thin owners-gated wrappers over the factories
(plus `addOwner(msg.sender)` on the product). `Bing` stores a Bao in `Nu` and
logs "Added to Yi.Nu" on the entity's SHIO. `React(Bao, Pi)` advances a Bao's
(Omicron, Omega) through its SHIO and returns it (memory struct — callers must
persist). Private `Ionize` = Psi.Isomerize + Isolate.

## 6. Integration notes

- The gateway functions expect the MultiOwnable caller to already be an owner
  (ZHENG holds the keys today; raw EOAs other than the deployer are not in the
  set).
- `Bang(address)` is a plain view of `Nu` — anonymous-safe.
- XIE hard-wires YI's Psi as "Fornax" — the constellation naming is the
  ownership chain made visible (see [xie.md](./xie.md)).

## 7. Provenance

- [src] `04_yi.sol`.
- [chain] perimeter; last activity 2026-08-29 `[chain]`.
