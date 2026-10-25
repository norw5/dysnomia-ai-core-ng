# SHA — the cryptographic particle (factory-child TYPE)

> Type doc: all SHAs are children of [SHAFactory](./shafactory.md) or of the
> kernel constructors. Every kernel SHIO is made of two SHAs.

## In player terms

| | |
|---|---|
| **You never touch these directly** | SHAs are born inside your onboarding (your channel's Rod + Cone) and inside the kernel boot. Everything you do runs through your LAU, your SHIO, or CHO. |
| **Half of your channel's crypto** | Your SHIO is a verified two-party channel made of exactly two SHAs. The SHA is where the channel's arithmetic state lives and evolves. |
| **A personality, not a secret** | Each SHA carries a 13-field "Fa" state that gets seeded once and then only advances — like a character sheet that fills in as the channel is used. Anyone can read the whole sheet (`View()`): this is commitment and co-evolution machinery, not privacy. |
| **It ages** | Every state transition mints 1 unit of the SHA's own token until its cap — the object literally counts its own history. |

## 1. Identity

| | |
|---|---|
| Type | `Type() == "SHA"` — not itself on the perimeter; factory children only |
| Factory | [SHAFactory](./shafactory.md) `0x4208333D65A90577E3da39B84D6A95eb9db717D2` |
| Census | SHAs are created inside SHIO creation (one Rod + one Cone per channel); no standalone SHA census was run (12,460 SHIOs ⇒ ≥ ~25k SHAs) `[chain, derived]` |
| Source | `02_sha.sol`, state struct `Fa` in `include/fa.sol` |

## 2. Role

A SHA is a **keypair object** in the affection-family dialect: `Fa` state
(13 `uint64` fields — `Base, Secret, Signal, Channel, Contour, Pole, Identity,
Foundation, Element, Coordinate, Charge, Chin, Monopole`) plus a public
`Dynamo`. `Secret` is the private exponent, `Channel = Base^Signal mod
MotzkinPrime` the public key (`Tune`), `React` a Diffie-Hellman-style exchange
with a peer-supplied modulus. The Greek-letter vocabulary matches the
AFFECTION ecosystem's VM exactly (same authorship signature).

**Security posture**: the "keys" are
not secret — `View()` returns the whole `Fa` including `Secret`, and the field
is tiny (MotzkinPrime ≈ 2^49.8; discrete logs are laptop-scale). What the
mechanism provides is permissioning (owners-only transitions), co-evolution
commitment (state advances only by actually performing calls), and — via
ENCRYPT — ephemerality. Not confidentiality.

## 3. Dependencies

- `Xiao` (MATH) for every `modExp64` and `Random()`.
- Owned by: its creator (`msg.sender`/`tx.origin` via the factory), the SHIO it
  belongs to (SHIOFactory adds the SHIO as owner of both SHAs), and the
  registry spine (YI/ZHENG add themselves during kernel boot).
- Callers: SHIO (Generate/Magnetize/React/Isomerize/Isolate), ZHENG.Mau, CHO
  entropy flows via ReactionsLib.

## 4. State

The `Fa` struct is the entire personality: seeded at construction
(`Seed`: Base/Secret/Signal ← `Random()`), tuned (`Channel`), then evolved by
the owner-gated transitions below. `Dynamo` is the side-channel value
`Magnetize` cross-checks.

## 5. Functions

<!-- fntable: SHA @ 02_sha.sol -->
<!-- fntable-begin: SHA @ 02_sha.sol -->
Function table extracted mechanically from `02_sha.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(string memory name, string memory symbol, address MathLib)` | deployer | — | — | — |
| `Augment()` | internal | meter | — | — |
| `View() returns (Fa memory)` | public | — | — | — |
| `Seed()` | private | meter | — | — |
| `Tune()` | private | meter | — | — |
| `Fuse(uint64 _rho, uint64 Upsilon, uint64 Ohm)` | owners | meter | — | — |
| `Avail(uint64 Xi)` | owners | meter | — | — |
| `Form(uint64 Chi)` | owners | meter | — | — |
| `Polarize()` | owners | meter | — | — |
| `Conjugate(uint64 Chi)` | owners | meter | — | — |
| `Conify(uint64 _Beta)` | owners | meter | — | — |
| `Saturate(uint64 _Beta, uint64 Epsilon, uint64 Theta)` | owners | meter | — | — |
| `Bond()` | owners | meter | — | — |
| `Adduct(uint64 _Phi) returns (uint64)` | public | meter | — | — |
| `React(uint64 Pi, uint64 Theta) returns (uint64, uint64)` | public | meter | — | `ReactionZeroError` |

Errors declared: `ReactionZeroError(uint64 Eta, uint64 Kappa)`
<!-- fntable-end -->

Effects: `Fuse` overwrites the triple (Base, Secret, Signal); `Avail(Xi)` sets
`Contour = Xi^Secret`; `Form(Chi)` re-bases (`Base = Chi^Secret`, re-Tune);
`Polarize` sets `Pole = Base^Secret`; `Conjugate(Chi)` sets `Coordinate`;
`Conify(β)` sets `Identity` + `Foundation`; `Saturate` derives the working set
(`Charge, Chin, Element, Dynamo, Monopole`) from `Identity`; `Bond` recomputes
`Dynamo` against `Element` and clears `Pole`; public `Adduct(Φ)` returns
`Φ^Signal mod Element`; public `React(Pi, Θ)` returns
`(Pi^Channel mod Θ, Pi^Θ mod Channel)` — the shared heartbeat — reverting
`ReactionZeroError` if either side lands on 0.

## 6. Integration notes

- Read `View()` for full state (anonymous-safe, it is a view).
- To establish a channel between two SHAs, use SHIO, not raw SHA calls — the
  protocol ordering (Avail→Form→Polarize→Conjugate→Conify→Saturate) lives in
  SHIO.Generate.
- Owner-gated transitions pass for any contract an owner EOA calls
  (tx.origin-OR-msg.sender — see [dysnomia-base](./dysnomia-base.md)).
- Every mutation mints 1 unit of the SHA's own token (meter) until its
  constructor-lottery cap.

## 7. Provenance

- [src] `02_sha.sol`, `include/fa.sol`.
- [chain] SHIO census 12,460;
  kernel SHAs created inside wave-1 constructors (perimeter).
