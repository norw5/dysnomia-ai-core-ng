# ZI — "Dysnomia Zi" — spin against purchasing power

> Wave 5 · 2025-06-14 02:19 UTC · deployed `[chain]` · at cap

## In player terms

| | |
|---|---|
| **Spin against your net worth** | ZI re-runs the whole diagnostic chain, then does modular exponentiation against purchasing power — CHO's own holdings counted through the 1:10:40 wallet weighting. The result (Iota) is a "spin": a number that mixes who you are, where you are, and what you're worth. |
| **The integer that feeds the recorder** | RING reads ZI's spin to stamp your "moment" — the ladder's output becomes a per-player memory onchain. |
| **Naming trap** | ZI's `Tethys` variable is the CHO contract itself — distinct from the owner's constellation label "Tethys" (a SHIO address). Two "Cho"s, two "Tethys"es; keep addresses pinned. |

## 1. Identity

| | |
|---|---|
| Address | `0xCbAdd3C3957Bd9D6C036863CB053FEccf3D53338` |
| Creation | block 23,722,497 — 2025-06-14 02:19 UTC (tx `0x881f42f98cfff6eb23f4a59be1ce66fab42905eeac1efed226c5a6008454ac2c`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | Dysnomia Zi / ZI `[chain]` |
| Supply / cap | 14,569 / 14,569 — **at cap** `[chain]` |

## 2. Role

子 (seed/son): `Spin(waat) → (Iota, Omicron, Omega, Eta)` — recomputes XIE's
Power, then two modExps against `CHOA.Yuan(CHO)` (purchasing power of CHO
itself as the modulus — "spin against purchasing power"), plus
`Omega = CHO.balanceOf(user's rod) ÷ user.Entropy` and
`Eta = CHO.balanceOf(qing) ÷ qing.Entropy()` — the VENUE quotient (the same
shape as META's Dione). > ng-correction (session-49 corpus audit): this line
originally read "Eta = CHO.balanceOf(user) ÷ user.Entropy" — a hand-written
error; the mechanical table above was always right, and
`contracts/src/domain/soeng/05_zi.sol:36-37` pins `Omega` as the user-rod
quotient and `Eta` as the venue quotient. Its `Tethys` reference IS the CHO
contract (the dev-published list's "Tethys" label for the CHO channel).

## 3. Dependencies

Holds `Choa` + `Tethys` (= CHO, walked out via `Choa.Sei().Chan().Xie().
Xia().Mai().Qi().Zuo().Cho()` at construction). Called by PANG.Push, RING
(via PANG).

## 4. State

`Choa`, `Tethys` — public.

## 5. Functions

<!-- fntable: ZI @ domain/soeng/05_zi.sol -->
<!-- fntable-begin: ZI @ domain/soeng/05_zi.sol -->
Function table extracted mechanically from `domain/soeng/05_zi.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address ChoaAddress)` | deployer | meter | — | — |
| `Spin(uint256 QingWaat) returns (uint256 Iota, uint256 Omicron, uint256 Omega, uint256 Eta)` | public | meter | — | — |
<!-- fntable-end -->

Effects: `Spin` — full ladder recompute + 2 modExps + 2 quotient reads; one
meter tick. Requires the caller to have a CHO session (GetUser).

## 6. Integration notes

- `Yuan(currency)` (on CHOA) is what the spins normalize against — see
  [choa.md](./choa.md).
- Spin returns overwrote Omicron/Omega with post-modExp values — callers that
  want XIE's raw pair should read XIE directly.

## 7. Provenance

- [src] `domain/soeng/05_zi.sol`.
- [chain] perimeter.
