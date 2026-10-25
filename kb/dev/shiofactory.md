# SHIOFactory — SHIO deployment gateway

> Wave 1 · 2024-08-23 00:45 UTC · deployed `[chain]`

## In player terms

| | |
|---|---|
| **Where channels are welded** | Takes two existing SHA halves and deploys the SHIO that binds them — 12,460 channels made this way `[chain]`, one per kernel entity and one per user. |
| **The channel outranks its parts** | Uniquely among the factories, it grants the new SHIO ownership of BOTH input SHAs — the whole controls its halves by design. |
| **Same census trap as its sibling** | External tx list quiet; internal creates flow continuously with onboarding. Count children from internal-create indexes, not activity. |

## 1. Identity

| | |
|---|---|
| Address | `0x5063D2A97960DDE8dc5E3e5A69aAa379C6301F1C` |
| Creation | block 21,220,681 — 2024-08-23 00:45 UTC (tx `0xa0752c151fcb2b6680014b400ac8182a046454b727d3a9d098a1ebd9174f1c6c`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Token | none — plain contract |
| Runtime | 14,214 bytes, keccak `0x25d062f57ea34d9d474840f8fd4ba52e5b91a919ca4d0b1c933d3e7125bb7f9d` `[chain]` |
| Children | **12,460 SHIO channels** (21,220,685 → 25,124,753) `[chain]` |

## 2. Role

Deploys [SHIO](./shio.md) channels from two existing SHA addresses and —
uniquely among the factories — also grants the new SHIO **ownership of both
input SHAs** (the channel controls its endpoints).

## 3. Dependencies

Deploys SHIO; called by YI's constructor (the kernel's three channels), by
`YI.Kappa` (owners-only gateway), and by `ZHENG.Mau` (user creation — every
user channel is an internal create through this factory). Last EXTERNAL call
(direct tx) 2026-02-02 `[chain]`; internal creates continued through the
12,460-child window (external tx lists do not show them — census gotcha).

## 4. State

None — stateless factory.

## 5. Functions

<!-- fntable: SHIOFactory @ 03c_shiofactory.sol -->
<!-- fntable-begin: SHIOFactory @ 03c_shiofactory.sol -->
Function table extracted mechanically from `03c_shiofactory.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor()` | deployer | — | — | — |
| `New(address Rod, address Cone, address MathLib) returns (SHIO Zeta)` | public | — | — | — |
<!-- fntable-end -->

Effects: `New(Rod, Cone, MathLib)` deploys the SHIO, adds `msg.sender` +
`tx.origin` as owners, renounces the factory, then `SHA(Rod).addOwner(shio)`
and `SHA(Cone).addOwner(shio)`.

## 6. Integration notes

- Census gotcha `[chain]`: the internal-transactions list of this factory
  includes non-create CALLs — filter `type == "create"` before counting
  children.
- The SHIO constructor names the channel "CHATLOG Shio"/"SHIO" regardless of
  context; instance identity is address-only.

## 7. Provenance

- [src] `03c_shiofactory.sol`.
- [chain] perimeter; (12,460);
  liveness 2026-02-02T21:47:05Z.
