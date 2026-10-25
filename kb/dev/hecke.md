# HECKE — "Dysnomia Hecke" — the meridian coordinate transform

> Wave 2 · 2025-02-26 23:01 UTC · deployed `[chain]` · at cap

## In player terms

| | |
|---|---|
| **The world's projection screen** | Venues live on a one-dimensional number line (the Waat). HECKE is the fixed math that folds that line onto a globe: given a venue's Waat it tells you the (latitude, longitude) tile it sits on — and back. The venue map you picture in your head is HECKE's arithmetic. |
| **It makes the world lopsided on purpose** | The 90 meridian bands shrink hyperbolically toward the poles — the far north is squeezed, equatorial bands are wide. Two venues "3 tiles apart" at different latitudes are very different distances apart in Waat-space. Scatter-plotters beware: the projection is deliberately anisotropic. |
| **Its first constant is a key elsewhere** | `Meridians[0] = 476733977057179` is not only the grid's origin multiplier — it is also the divisor in the QING creation lottery that decides whether a venue's escrow is ever withdrawable, and the crypto modulus is `2× it + 5`. One design, three roles. |
| **Free to read** | Pure views, no meter, no session — the cartographer's best friend. |

## 1. Identity

| | |
|---|---|
| Address | `0x29A924D9B0233026B9844f2aFeB202F1791D7593` |
| Creation | block 22,813,908 — 2025-02-26 23:01 UTC (tx `0xb420fb112f194e48bc21fa74f37003f2477aca18bb77a38385374fbc5a86c7de`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | Dysnomia Hecke / HECKE `[chain]` |
| Supply / cap | 51,560 / 51,560 — **at cap**, and the constructor pre-paid the WHOLE budget to itself (`_mint(address(this), maxSupply * 1e18)`) `[src]/[chain]` |

## 2. Role

The world's projection function: 90 hardcoded `Meridians` that fold the
number line into a globe. `Compliment(Waat) → (Longitude, Latitude)` maps any
Waat coordinate to a tile; `GetWaat(Latitude)` inverts. MAP multiplies
`CHO.Luo() × Meridians[0]` to place QINGs, then uses `Compliment` to grid
them. The array starts geometric (ratio ≈ 5.2, decaying) and flattens from
band 33 into constant steps of
`7274503475445672082679299018887362119730550465600968639836233812051516785`
(≈ 7.27e72; −1 on every third band 36, 39, …, 87) before the final jump —
`Meridians[89] = 2×Meridians[88] + 1` exactly; hyperbolic meridian bands
shrinking toward the pole; `Meridians[0] = 476733977057179` doubles as the
QING GWAT withdrawability divisor, and `MotzkinPrime = 2×476733977057179 + 5`
— the coordinate origin and the crypto modulus are factors of the same design
(verified `[chain]`). The full-917 atlas replication: every live venue lands in
bands 34–88 with ~uniform latitude over ±pole (atlas replication over all 917).

## 3. Dependencies

Constructed with the CHO address (for `Xiao` + market rates only). Called by
MAP (`Compliment`, `Meridians(0)`), and by the undeployed WORLD/H2O/VITUS
designs (`Meridians(13)`, `Meridians(20)`, `Meridians(89)`).

## 4. State

`Meridians` — `uint256[90]` public constant table (full values in the source
and verified onchain `[chain]`; first 476733977057179, last
788007780075465850682698395781331007488376212737722608030423588863419947711).

## 5. Functions

<!-- fntable: Hecke @ lib/heckemeridians.sol -->
<!-- fntable-begin: Hecke @ lib/heckemeridians.sol -->
Function table extracted mechanically from `lib/heckemeridians.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address ChoAddress)` | deployer | — | — | — |
| `Compliment(uint256 Waat) returns (int256 Longitude, int256 Latitude)` | public | — | — | `assert` |
| `GetWaat(int256 Latitude) returns (uint256 Waat)` | public | — | — | — |
| `GetMeridian(uint256 Waat) returns (uint256 Meridian)` | public | — | — | — |
<!-- fntable-end -->

Effects: `Compliment` — meridian index = the band containing Waat
(`GetMeridian`); latitude = distance below `Meridians[88]` ÷ 333 (south
negative; the far-north band flips to measure downward); longitude wraps ±
within the band (west negative). `assert(Waat <= Meridians[89])` bounds the
domain. `GetWaat` inverts the latitude mapping (± 333 scale).

## 6. Integration notes

- Pure view functions — anonymous-safe, no meter (supply is at cap anyway,
  and pre-paid).
- Cartography gotcha: the projection is **anisotropic** (community mapping
  attempts and the dev's own notes agree);
  naive lat/lon scatter plots of the 917 QINGs will look clumped, not
  uniform. The meridian widths shrink hyperbolically — tile "area" is wildly
  non-uniform in Waat-space.
- `GetMeridian` linear-scans 90 entries — fine for view calls.

## 7. Provenance

- [src] `lib/heckemeridians.sol`.
- [chain] `Meridians(0)`/`Meridians(89)` probes; perimeter.
