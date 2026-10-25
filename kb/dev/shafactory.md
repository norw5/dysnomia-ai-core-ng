# SHAFactory — SHA deployment gateway

> Wave 1 · 2024-08-23 00:44 UTC · deployed `[chain]`

## In player terms

| | |
|---|---|
| **The very first contract of the world** | Boot minute one. Every keypair object ever made — kernel's and yours — passed through this one function. |
| **Invisible to users** | You will never call it; the kernel's gateway (YI.Beta) calls it internally during onboarding and system construction. Its external tx list looks dead while internal creates continue — a census trap, not a shutdown. |
| **No token, no fees** | A plain stateless deployer that hands each new SHA to its requester and forgets it. |

## 1. Identity

| | |
|---|---|
| Address | `0x4208333D65A90577E3da39B84D6A95eb9db717D2` |
| Creation | block 21,220,676 — 2024-08-23 00:44 UTC (tx `0xd9f5b899ce9d2f99e852c6fb88d8c67abc89c953bcca6176c895a5403b3594cf`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Token | none — a plain contract, not a DYSNOMIA token (no name/supply) |
| Runtime | 13,152 bytes, keccak `0x2e9aed3b5542af199082c8aec2e8c9f6482838fcc4aeaf31a9392a848f787a00` `[chain]` |

## 2. Role

The first contract of the kernel: deploys [SHA](./sha.md) keypair objects and
hands them to the caller. Not token-shaped — the factory pattern here is
ownership plumbing, not minting.

## 3. Dependencies

Deploys SHA (imports `02_sha.sol`). Called by YI's constructor and by
`YI.Beta` (the system's owners-only SHA gateway — so every user SHA pair is
an internal create THROUGH this factory). Last EXTERNAL call (a direct tx to
the factory) 2026-02-02 `[chain]`; internal creates continue with user
onboarding (they do not appear in the factory's external tx list — census
gotcha).

## 4. State

None beyond code — stateless factory.

## 5. Functions

<!-- fntable: SHAFactory @ 02c_shafactory.sol -->
<!-- fntable-begin: SHAFactory @ 02c_shafactory.sol -->
Function table extracted mechanically from `02c_shafactory.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor()` | deployer | — | — | — |
| `New(string memory name, string memory symbol, address MathLib) returns (SHA Eta)` | public | — | — | — |
<!-- fntable-end -->

Effects: `New(name, symbol, MathLib)` deploys a SHA, adds `msg.sender` AND
`tx.origin` as owners, renounces the factory's own constructor ownership, and
returns the SHA. Every deployed SHA therefore belongs to its requester.

## 6. Integration notes

- Direct use is effectively closed: `New` is public but the meaningful entry
  today is `LAUFactory.New` (which builds the full SHA pair + SHIO via the
  kernel) — raw SHAs are only interesting to protocol tinkerers.
- The `MathLib` argument is always the MATH token
  `0xB680F0cc810317933F234f67EB6A9E923407f05D` in every live path `[chain]`.

## 7. Provenance

- [src] `02c_shafactory.sol`.
- [chain] perimeter (`creation_block`, code hash); liveness (2026-02-02T21:45:55Z).
