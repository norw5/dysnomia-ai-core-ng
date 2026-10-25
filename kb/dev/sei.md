# SEI — "Dysnomia Sei" — the YUE starter

> Wave 5 · 2025-06-13 01:00 UTC · deployed `[chain]` · at cap

## In player terms

| | |
|---|---|
| **"Open an account"** | `Start(yourLAU, name, symbol)` is the one call: it registers you with the hub (if needed), mints your personal account token (YUE), and lists it in the directory. Already have one? Same call renames it — free, forever. |
| **93 accounts and counting** | The census that once said 6 was wrong — receipt-scans find 93 YUEs, newest 2026-09 `[chain]`. A small-town bank, but open and still signing people up. |
| **Your handle to everything account-layer** | `Chi()` returns your (account, identity) pair — the standard preamble for CHOA play, CHEON settles, and anything that pays you. |

## 1. Identity

| | |
|---|---|
| Address | `0x3dC54d46e030C42979f33C9992348a990acb6067` |
| Creation | block 23,713,503 — 2025-06-13 01:00 UTC (tx `0x96ce9bf6cf2f29685cd34136cd875363391a7229bc94ab2bf3ebebd52bb6a1b3`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | Dysnomia Sei / SEI `[chain]` |
| Supply / cap | 20,452 / 20,452 — **at cap** `[chain]` |
| Children | **93 YUEs** (erratum v2 — see below) `[chain]` |

## 2. Role

The personal-account front desk: `Start(yourLAU, name, symbol)` enters you
into CHO (if needed) and mints you a [YUE](./yue.md) account/vault token — or,
if you already have one, renames it. `Chi()` returns `(your YUE, your LAU)`.
Everything in the account layer (CHOA bounties, CHEON settles, planned VITUS
royalties) keys off SEI's directory via CHAN.

## 3. Dependencies

- Owns CHAN + CHO (constructor). Called by CHEON/CHOA (via `Sei.Chi()`),
  GWAT/undeployed designs (`Sei.Chi()` for the game YUE).
- Deploys YUE per Start call.

## 4. State

`Chan` — public.

## 5. Functions

<!-- fntable: SEI @ domain/tang/01_sei.sol -->
<!-- fntable-begin: SEI @ domain/tang/01_sei.sol -->
Function table extracted mechanically from `domain/tang/01_sei.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address ChanAddress)` | deployer | meter | — | — |
| `Chi() returns (YUE Yue, LAU UserToken)` | public | — | — | `NotStarted` |
| `Start(address LauToken, string calldata YueName, string calldata YueSymbol) returns (YUE Yue, LAU UserToken)` | public | meter | — | — |

Errors declared: `NotStarted(address)`
<!-- fntable-end -->

Effects: `Chi()` — view; reverts `NotStarted` if no YUE for tx.origin.
`Start` — if no YUE: CHO.Enter(LAU) + `new YUE(name, symbol, Chan)` + CHAN
ownership + `Chan.AddYue`; else rename. Returns the pair. Meters.

## 6. Integration notes

- **Census erratum v2 `[chain]`**: blockscout's internal-create attribution
  saw only 6 YUEs; a receipt-scan over all 282 SEI txs + `Type()=="YUE"`
  verification finds **93** (newest 2026-09). If you count children, trust
  receipts, not the internal-creates index — the YUEs are created inside
  Start's frame and attribution misses them.
- YUE names are player-chosen at Start; renames are free forever after.

## 7. Provenance

- [src] `domain/tang/01_sei.sol`.
- [chain] `yue_addresses.json` + `sei_tx_zero_mints.json` (93, erratum v2).
