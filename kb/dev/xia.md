# XIA — "Dysnomia Xia" — charge = modExp(qi, pulse, Fomalhaute-balance)

> Wave 3 (soeng I) · 2025-03-25 14:57 UTC · deployed `[chain]` · at cap

## In player terms

| | |
|---|---|
| **Where two readings combine** | Charge = venue-qi raised to the power of your pulse, under a modulus made of your Fomalhaute (main-room channel) holdings. Three inputs — the room's energy, your stake, your kernel footprint — folded into one number by one modular exponentiation. |
| **No Fomalhaute, no charge** | The modulus is your own balance of the main room's channel token. Zero holdings → degenerate math → charge 0. Holding the town-square token is a prerequisite for mattering in the venue statistics. |
| **A hidden budget note** | The smallest cap in the family (6,140) and long saturated `[chain]` — but saturation only stops the self-mint; the composition keeps working. |

## 1. Identity

| | |
|---|---|
| Address | `0x7f4a4DD4a6f233d2D82BE38b2F9fc0Fef46f25FA` |
| Creation | block 23,040,923 — 2025-03-25 14:57 UTC (tx `0x5ef3f2cd95bbb24438d5eec625a051fcf3a1ae82d9dc2ebc004a4974a82f7b15`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | Dysnomia Xia / XIA `[chain]` |
| Supply / cap | 6,140 / 6,140 — **at cap** (smallest cap of the family) `[chain]` |

## 2. Role

夏 (dynasty / summer): the composition layer —
`Charge(waat) = modExp(QI_venue, MAI_user, Fomalhaute.balanceOf(user))` —
venue-qi exponentiated by user-pulse under a modulus made of the user's
holdings of the ZHOU channel token. Chinese-medicine reading: the diagnostic
chain turns take-pulse into a charge.

## 3. Dependencies

Holds `Mai` (→ QI chain). `Fomalhaute` = ZHOU's SHIO
`0x7aE73C498A308247BE73688c09c96B3fd06dDB84` hard-wired at construction via
the spine walk. Called by XIE.Power.

## 4. State

`Mai`, `Fomalhaute` — both public.

## 5. Functions

<!-- fntable: XIA @ domain/soeng/03_xia.sol -->
<!-- fntable-begin: XIA @ domain/soeng/03_xia.sol -->
Function table extracted mechanically from `domain/soeng/03_xia.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address MaiAddress)` | deployer | meter | — | — |
| `Charge(uint256 QingWaat) returns (uint256)` | public | meter | — | — |
<!-- fntable-end -->

Effects: `Charge(waat)` — takes the CURRENT user (`GetUser` — non-view,
advances entropy), computes the three inputs live, one modExp. Note the
modulus is the user's Fomalhaute balance — a zero balance makes modExp
degenerate (0 modulus ⇒ precompile returns 0 ⇒ Charge 0).

## 6. Integration notes

- Requires a CHO session (`GetUser` reverts `UserNotEntered` otherwise).
- Charge is the upstream of XIE.Power's first return — caching it saves a
  full chain of entropy-advancing calls.

## 7. Provenance

- [src] `domain/soeng/03_xia.sol`.
- [chain] perimeter (creation tx `0x5ef3f2cd95bbb24438d5eec625a051fcf3a1ae82d9dc2ebc004a4974a82f7b15`).
