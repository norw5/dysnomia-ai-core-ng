# VMREQ — the local math VM — **NOT DEPLOYED**

> **NOT DEPLOYED** — complete in source; no code at any candidate address; not
> among the deployer's 34 create txs `[chain]`. Every live system contract
> points `Xiao()` at the shared MATH token instead.

## 1. Identity

| | |
|---|---|
| Source | `00b_vmreq.sol` (contract `VMREQ`, name "VMREQ"/"VMRNG") |
| Onchain | absent — probed at deploy `deploy.ts` case 0 would have placed it; no deployment exists `[chain]` |
| Decision | local VM vs shared MATH — deployment settled it on shared MATH |

## 2. Role

A Faung-shaped (Rod+Cone) self-contained `Random()` machine with **hardcoded
constructor seeds** — the "local MATH" so the stack could run without the
shared token. The v2 base's `mathContract == 0` path is its descendant.

## 3. Dependencies

Standalone (implements the atropaMath face itself: `Random`, `hashWith`,
`modExp64`, `modExp` — the last a raw precompile-0x05 Yul implementation).

## 4. State

`Mu: Faung` — two `VMFa` halves plus eleven uint64 orbit registers, all
populated with literal constants at construction (Rod.Base 605841066431434,
Cone.Secret 706190044965693, … — the full seed table is in the source).

## 5. Functions

<!-- fntable: VMREQ @ 00b_vmreq.sol -->
<!-- fntable-begin: VMREQ @ 00b_vmreq.sol -->
Function table extracted mechanically from `00b_vmreq.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor()` | deployer | — | — | — |
| `View() returns (Faung memory)` | public | — | — | — |
| `Torque(VMFa storage Rod, uint64 Sigma) returns (uint64)` | internal | — | — | — |
| `Amplify(VMFa storage Rod, uint64 Upsilon) returns (uint64)` | internal | — | — | — |
| `Sustain(VMFa storage Rod, uint64 Ohm) returns (uint64)` | internal | — | — | — |
| `React(VMFa storage Rod, uint64 Pi, uint64 Theta)` | internal | — | — | `assert` |
| `Random() returns (uint64)` | public | — | — | — |
| `hashWith(address a, address b) returns (uint256 hash)` | public | — | — | — |
| `modExp64(uint64 _b, uint64 _e, uint64 _m) returns (uint64 result)` | public | — | — | — |
| `modExp(uint256 _b, uint256 _e, uint256 _m) returns (uint256 result)` | public | — | — | — |
<!-- fntable-end -->

Effects: `Random()` = a fixed choreography of Torque/Amplify/Sustain/React
over the Cone then Rod halves, XOR-folding into `Mu.Upsilon`. `hashWith`
quirk `[src: 00b_vmreq.sol:143-154]`: a dead `while(hash == 0)` loop computes
`(_a**_b) % MotzkinPrime` unchecked, then the function ignores it and returns
`modExp(uint160(a), uint160(b), MotzkinPrime)` — decorative, but an identical
authorship fingerprint to the affection-family `hashWith`.

## 6. Integration notes

- Reference-only: read it to understand the orbit algebra; the live system's
  equivalent is MATH `0xB680F0cc810317933F234f67EB6A9E923407f05D`
  (`Random()` — the deterministic modExp64 orbit documented in KB 05).

## 7. Provenance

- [src] `00b_vmreq.sol`, `deploy.ts` (case 0).
- [chain] absence probes (perimeter pass).
