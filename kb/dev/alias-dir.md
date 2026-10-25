# setaddresses — the alias directory loader (constructor-only)

> Wave 2 · 2025-02-26 22:53 UTC · deployed `[chain]` · one-shot, self-minimal

## In player terms

| | |
|---|---|
| **A two-minute ceremony, a permanent directory** | This contract existed to run ~90 `AddSystemAddress` calls in its own constructor — naming the treasury's deployer key "source", listing reserve assets and community tokens as citizens, registering the ban tokens — and then fall silent forever (62 bytes of runtime remain). |
| **Why it matters to you** | Those aliases are how the world's own tooling refers to outside contracts. Want to know which address the system considers "TreasuryBill" or "CROWS"? This is where that mapping was frozen. |
| **Read the result on CHO** | The loader is spent; the book it wrote lives on CHO (`Addresses(alias)` / `Aliases(i)`) — the canonical alias↔address list for indexers. |
| **One ghost entry** | A commented-out "FA" line in the source is the only alias prepared but never written `[src]`. |

## 1. Identity

| | |
|---|---|
| Address | `0x7207BdB5746e39d4bb27A8b9f206047e8432D9aC` |
| Creation | block 22,813,861 — 2025-02-26 22:53 UTC (tx `0xaf238e91b7c78784664808ccada587c26211c95b538814365022bad53861ca5a`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Runtime | 62 bytes — constructor-only pattern (no code beyond the dispatcher stub after construction) `[chain]` |
| Token | none |

## 2. Role

A throwaway loader whose constructor writes CHO's **system address book** —
~90 `AddSystemAddress` calls making the Atropa corpus and community tokens
first-class named citizens of the world — and then does nothing forever.
Reading the book today = `CHO.Addresses(alias)` / `CHO.Aliases(i)`.

## 3. Dependencies

Constructed with the CHO address; called `Cho.AddSystemAddress` ~90×.

## 4. State

None (not even storage — everything landed in CHO).

## 5. Functions

<!-- fntable: setaddresses @ domain/dan/02c_systemaddresses.sol -->
<!-- fntable-begin: setaddresses @ domain/dan/02c_systemaddresses.sol -->
Function table extracted mechanically from `domain/dan/02c_systemaddresses.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address ChoAddress)` | deployer | — | — | — |
<!-- fntable-end -->

A constructor and nothing else. Notable entries written `[src]`:
"dead" `0x000000000000000000000000000000000000dEaD`, **"source" = Maria #2
`0x7a20189B297343CF26d8548764b04891f37F3414`**, "trebizond"
`0x903030f7e2d6489F38B0f4F96F9b371ec7960F78`, the forked stables by their
Ethereum addresses (dai/usdc/usdt), the reserve set (WM = MV
`0xA1BEe1daE9Af77dAC73aA0459eD63b4D93fC6d29`, TreasuryBill, TeddyBear),
INDEPENDENCE/G5/PI, CROWS, Liberty, Metis, Gai, NoNukes, WenTi, BFF,
SECURITY, LEPROSY, KPOP, ACAB, BillBurr, "libAtropaMath" (MATH), "AFFECTION",
"WITHOUT"/"RESTRAININGORDER" (the ban tokens), "Call"
`0xD4FD96BA83d3E6FF1A0Baa44c32Def94e641D97c`, and "mariarahel" (the dev's
LAU). Full list: `02c_systemaddresses.sol`.

## 6. Integration notes

- Pure historical artifact — the write path is spent; the read path lives on
  CHO. Useful as the canonical alias↔address mapping for indexers.
- The commented-out "FA" line (`// Cho.AddSystemAddress("FA", …)`) is the only
  alias that was prepared but not written `[src]`.

## 7. Provenance

- [src] `domain/dan/02c_systemaddresses.sol`.
- [chain] creation tx (above); 62-byte runtime (perimeter note).
