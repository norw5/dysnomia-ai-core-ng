# SHIO — the channel between two SHAs (factory-child TYPE + the three kernel instances)

> Type doc + the three kernel-born instances ("constellation" channels). User
> channels are children of [SHIOFactory](./shiofactory.md).

## In player terms

| | |
|---|---|
| **Your channel is your private room's wiring** | When you join, the system births you a SHIO — a verified channel between your two SHA "halves". Chat and identity flow through it; you never call it directly, your LAU does. |
| **The world's bulletin board** | Every chat message anywhere is a `LogEvent` emitted on some SHIO. The main room's archive (8,082 messages and counting `[chain]`) is just logs on one kernel channel. |
| **Three channels are load-bearing physics** | The kernel's own three channels — Fornax, Fomalhaute, Eris — are not decorative: the later "soeng" statistics divide by holdings of them and use them as moduli. Holding kernel-channel tokens changes your derived numbers. |
| **Anyone can spin a channel — that's weather** | `React` is public: any passerby can advance any channel's orbit one step. The system treats this as background motion, not an attack — entropy advances because the world moves. |
| **One caveat for readers** | `LogEvent` has no indexed parameters — indexers must decode the data payload, not topics. |

## 1. Identity

| instance | address | created | supply / cap [chain] |
|---|---|---|---|
| (Fornax) Shio — YI's `Psi` | `0xF6C50fFE7efbDeE63A92E52A4D5E9afF7fb4A4D7` | block 21,220,685 (inside YI's constructor, tx `0xc461d59fbbfe495b45e0ef96443cb3e605b44452f585b71d5d94785c7f30b8d5`) | 50,977 / 50,977 (cap) |
| (Fomalhaute) Shio — ZHOU's rod | `0x7aE73C498A308247BE73688c09c96B3fd06dDB84` | block 21,220,693 (inside ZHOU's constructor, tx `0xccd00419c90a1b7cbcf39436d3adb55cfbd779a07469fa4b06e4ad5f3c539656`) | 25,933 / 25,933 (cap) |
| (Eris) Shio — YANG's `Lai` | `0xE843765114992e18061498aeD708537cE9d924FA` | block 21,220,699 (inside YANG's constructor, tx `0xf9ba776b97a532fe9015b44fef92db4d75c91110c378d1fef691a44da9592a14`) | 99,279 / 99,279 (cap) |

All three: onchain name/symbol "CHATLOG Shio"/"SHIO", identical runtime
(`code_keccak 0x6c6eb69d…bccf4` on all three `[chain]`), deployer-owned,
`Xiao()` = MATH. Factory children: **12,460 SHIOs** via SHIOFactory
(21,220,685 → 25,124,753) `[chain]`.

## 2. Role

A SHIO is a **verified two-party channel** — itself a token ("CHATLOG Shio") —
wrapping a `Rod` SHA and a `Cone` SHA (`struct Shao {SHA Rod; SHA Cone; uint64
Barn;}`). `Generate` runs the mutual-DH protocol on both sides; `Magnetize`
verifies symmetry (three inequality reverts) and derives the shared secret
`Barn` plus `Monopole`; `React(Pi)` is the double-sided orbital step that
everything else in the system reuses; and `Log(Soul, Aura, line)` emits
`LogEvent` — **the chat primitive**: the entire chat archive of the world is
LogEvents on SHIOs.

## 3. Dependencies

- Owns/calls: its two SHAs (the factory grants the SHIO ownership of both).
- Called by: YI (`React` on registry Baos), ZHENG (`Mau`/`InstallRod`/
  `InstallCone` log through it), VOID (chat writes to ZHOU's SHIO), CHO
  (entropy via ReactionsLib), ENCRYPT (undeployed stream cipher).
- The three kernel instances are the system's physics constants: QI divides by
  Eris balances, XIA uses Fomalhaute as modulus source, XIE uses Fornax
  (see the soeng ladder docs).

## 4. State

`Rho` (the Shao pair + Barn), `Manifold`, `Monopole` (the XOR mask React
applies). The LogEvent stream is the channel's message history.

## 5. Functions

<!-- fntable: SHIO @ 03_shio.sol -->
<!-- fntable-begin: SHIO @ 03_shio.sol -->
Function table extracted mechanically from `03_shio.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address RodAddress, address ConeAddress, address MathLib)` | deployer | — | — | — |
| `Augment()` | internal | meter | — | — |
| `Log(uint64 Soul, uint64 Aura, string memory LogLine)` | owners | — | LogEvent | — |
| `Rod() returns (SHA)` | public | — | — | — |
| `Cone() returns (SHA)` | public | — | — | — |
| `ConductorGenerate(uint64 Xi)` | private | meter | — | — |
| `Generate(uint64 Xi, uint64 Alpha, uint64 Beta)` | owners | meter | — | — |
| `Isomerize()` | owners | meter | — | — |
| `Isolate()` | owners | meter | — | — |
| `Magnetize() returns (uint64)` | owners | meter | — | `ManifoldInequality`, `RingInequality`, `BarnInequality` |
| `React(uint64 Pi) returns (uint64, uint64)` | public | meter | — | `ReactionInequalityError`, `ReactionZeroError` |

Events declared: `LogEvent(uint64 Soul, uint64 Aura, string LogLine)`

Errors declared: `ManifoldInequality(uint64 Manifold)` · `RingInequality(uint64 Ring)` · `BarnInequality(uint64 Barn)` · `ReactionZeroError(uint64 Eta, uint64 Kappa)` · `ReactionInequalityError(uint64 Eta, uint64 Kappa)`
<!-- fntable-end -->

Effects: `Generate(Xi, Alpha, Beta)` = `ConductorGenerate(Xi)` (both sides
Avail(Xi), Form(peer.Contour), Polarize) then cross-Conjugate, Cone.Conify,
both sides Saturate — a mutual key agreement. `Magnetize` computes
`Manifold = Rod.Adduct(Cone.Dynamo)` and requires Cone.Adduct(Rod.Dynamo) to
agree (`ManifoldInequality`), then verifies Ring symmetry (`RingInequality`)
before setting `Barn` (`BarnInequality`); `Monopole` = Rod.Chin^Cone.Chin mod
MotzkinPrime. `React(Pi)` XORs Pi with Monopole, Reacts BOTH SHAs against the
other's Channel, requires mirror results (`ReactionInequalityError`) and
nonzero (`ReactionZeroError`). `Isomerize`/`Isolate` bond the Rod/Cone side
respectively. `Log` is a bare owners-gated emit.

## 6. Integration notes

- Reading chat = `eth_getLogs` for `LogEvent` on the SHIO address (args are
  indexed? — no: `LogEvent(uint64 Soul, uint64 Aura, string LogLine)` has NO
  indexed parameters; decode from data `[chain]`).
- Kernel-channel volumes `[chain]`: Fomalhaute 8,082 LogEvents (VOID.Chat's
  target), Eris 2, Fornax 0; user/venue channels not individually scanned.
- Writing chat goes through VOID/QING/LAU, never SHIO.Log directly (you will
  not be in the owner set; ownership is granted to the caller's own contracts
  at user creation).
- `React` is public and un-gated — anyone can advance a channel's orbit (the
  system treats this as weather, not trespass).

## 7. Provenance

- [src] `03_shio.sol`.
- [chain], `factory_children.json`,
  `activity.json` (LogEvent scan 21.2M→tip).
