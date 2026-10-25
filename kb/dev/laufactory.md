# LAUFactory — user-account deployment gateway

> Wave 1 · 2024-08-23 00:51 UTC · deployed `[chain]` · the world's front door

## In player terms

| | |
|---|---|
| **The single official signup** | `New("handle", "SYM")` from your wallet is the whole onboarding: one transaction, gas only. Behind it the LAU constructor enters you through the entire kernel spine — channel, keys, soul, session — before handing you the keys. |
| **18,660 people have walked in** | First account four blocks after the factory itself (the dev, naturally); newest arrivals the week of the 2026-09 census `[chain]`. The door has been open for two years and still is. |
| **No permission, no invite** | Anyone, any time — this is a public entry point, deliberately kept boring and stateless. |
| **Then use your LAU** | After signup you never need this factory again; your LAU (and later your YUE) is your interface to the world. |

## 1. Identity

| | |
|---|---|
| Address | `0xbA6CcD38992839aEE20D5bF9125b1d94190b091C` |
| Creation | block 21,220,719 — 2024-08-23 00:51 UTC (tx `0x468ad070ac9d6ec5a99edd869acec9222e24d2a215eff7c797a0ff836b4b7b0e`) — the last contract of wave 1 |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Token | none — plain contract |
| Children | **18,660 LAUs** (first: block 21,220,723, four blocks later; newest 2026-09-17 at census) `[chain]` |

## 2. Role

`New(name, symbol)` is how a person joins the world: deploys a [LAU](./lau.md)
(which enters VOID → births the user's crypto identity), then hands ownership
to `msg.sender` + `tx.origin` and renounces itself. The factory holds VOID
ownership from construction — the spine's outermost permanent holder.

## 3. Dependencies

Constructor takes the VOID address and adds itself as a VOID owner. Deploys
LAU. Called by anyone — this is the system's public entry point. Active
2026-09-17 `[chain]`.

## 4. State

`Void` (public getter).

## 5. Functions

<!-- fntable: LAUFactory @ 11c_laufactory.sol -->
<!-- fntable-begin: LAUFactory @ 11c_laufactory.sol -->
Function table extracted mechanically from `11c_laufactory.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address VOIDAddress)` | deployer | — | — | — |
| `New(string memory name, string memory symbol) returns (LAU Mu)` | public | — | — | — |
<!-- fntable-end -->

Effects: `New` = deploy LAU(name, symbol, Void) → `addOwner(msg.sender)` +
`addOwner(tx.origin)` → `renounceOwnership(address(this))` → return.

## 6. Integration notes

- The one-call onboarding path: `LAUFactory.New("handle", "SYM")` from an EOA
  (bring gas); the LAU's own token self-mints through its meter as you use it.
- Census method: internal-creates index (type == create) — see.

## 7. Provenance

- [src] `11c_laufactory.sol`.
- [chain] perimeter; `factory_children.json`; liveness 2026-09-17.
