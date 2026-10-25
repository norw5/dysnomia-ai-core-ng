# META — "Dysnomia Meta" — the tile oracle (territory-expansion inputs)

> Wave 5 · 2025-06-16 21:20 UTC · deployed `[chain]` · budget liquid · active this month `[chain]`

## In player terms

| | |
|---|---|
| **The territory oracle** | `Beat(venue)` is the single richest live read in the world: your recorded moment (RING) plus the full ladder push (PANG), folded into four tile numbers — Dione, Charge, Deimos, Yeo. Designed as the input to territory expansion around venues. |
| **Yeo — the expansion range** | One output bounds how far a venue's tile influence could stretch (the undeployed WORLD layer checked placements against it). The deployed contract computes it as push-Yeo ÷ Chao — the Chao-scaled LARGE value (fork-verified); our recovered source's inverted division is a post-deploy edit — repo archaeology dated it to exactly ONE commit, `f9f284988` (2026-06-16, a year after deployment); no committed revision reproduces the deployed body. |
| **Why it ran without a world** | Even with WORLD never deployed, Beat works and is public — 318 onchain calls by 33 players June 2025 → September 2026, plus all the off-chain simulation. The oracle is live; its biggest consumer isn't. |
| **Costs a step of your account** | Beat is not a view — your YUE bars advance every call. |

## 1. Identity

| | |
|---|---|
| Address | `0xE77Bdae31b2219e032178d88504Cc0170a5b9B97` |
| Creation | block 23,746,306 — 2025-06-16 21:20 UTC (tx `0x93b2d93955a1e3bf956332c9467445515a07618410cfd68312e649a606261e42`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | Dysnomia Meta / META `[chain]` |
| Supply / cap | 937 / 90,767 — liquid (nearly fresh) `[chain]` |

## 2. Role

The tile-parameter oracle: `Beat(waat) → (Dione, Charge, Deimos, Yeo)` —
combines RING.Eta with PANG.Push, then
`Deimos = modExp(Dione, Phoebe, Yuan(qing))` and `Yeo = Chao ÷ Yeo_from_PANG`.
Purpose per source and owner recollection (they agree):
**territory-expansion inputs** — `Yeo` is the expansion-range limiter the
undeployed WORLD.Code bounds each QING's tile placement against
(± Yeo latitude/longitude around the venue's anchor), and Charge/Deimos feed
tile value / creator credits. Martian moons (Dione is Saturnian, Deimos
Martian — the astronomy cast mixes) as the output names. Third parties were
actively probing/optimizing Beat — **318 onchain calls by 33 callers, June
2025 → September 2026** `[chain]`, heaviest at the cheaper ladder legs
(PANG logged 15,389 metered Push calls before hitting its cap) — and the
recovered community docs' strategy pages (`[ext]`, the recovered community
strategy pages) read like the public shadow of exactly that
optimization material.

## 3. Dependencies

Holds `Ring` (→ PANG ladder). Called by the undeployed WORLD.Code; live
callers are players/tools/experiments.

## 4. State

`Ring` — public.

## 5. Functions

<!-- fntable: META @ domain/tang/03_meta.sol -->
<!-- fntable-begin: META @ domain/tang/03_meta.sol -->
Function table extracted mechanically from `domain/tang/03_meta.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address RingAddress)` | deployer | meter | — | — |
| `Beat(uint256 QingWaat) returns (uint256 Dione, uint256 Charge, uint256 Deimos, uint256 Yeo)` | public | — | — | — |
<!-- fntable-end -->

Effects: `Beat` — one RING.Eta + one PANG.Push + two modExps + one division;
note the overwrite quirk: `Charge = Charge_ring × Charge_push ÷ Iota_ring`.
Meter once. Requires the caller to hold a YUE (RING.Eta path).

**Source-version note — the Yeo direction is RESOLVED: deployed runs
`Yeo = Yeo / Chao`**: the recovered community docs (`[ext]`,
snapshot 2026-04-20) hash an older `03_meta.sol` whose inlined `Beat` body
ends `Yeo = Yeo / Chao`; our recovered copy reads `Yeo = Chao / Yeo`. solc
compile-verification showed neither variant compiles
byte-identical to the deployed runtime (both −855 B — a third, smaller
revision is live), so the fork behavioral A/B settled it: with each variant
swapped over the live storage (`anvil_setCode`, same tx.origin),
`Beat(Phobos.Waat)` on the deployed code returns
`(14, 82215108, 623859330300023, 168603625573)`; the April build reproduces
all four exactly, our recovered build yields Yeo = 0 (`Chao / Yeo` floors to
zero — Chao is tiny next to push-Yeo). So for the Yeo line the community
strategy pages describe the LIVE math.

A second independent consumer corroborates the direction
(`[ext]`, the owner's own playbooks): the owner's revised Beat guide (the
playbooks2/ revision, mid-2026) teaches `Yeo = Chao / Yeo` with "no upper
ceiling for Fornax" — the final-tree direction — while his earlier
`strategy/` set teaches the deployed direction including the Fornax
Goldilocks ceiling that only exists under it. His project consumed the
post-deploy repo state (the same late revision our recovery carries, dated
to the single commit `f9f284988`) after first working from the
deployed behavior — the same conclusion from a second direction.

## 6. Integration notes

- Beat is the single most informative live read of the whole oracle stack —
  and it is NOT a view (YUE bars advance).
- `Yeo` on the deployed contract is the Chao-scaled LARGE value
  (push-Yeo ÷ Chao), NOT the small tile-radius our source's direction
  produces (that floors to 0 in practice). WORLD's bounds-checks treat Yeo
  as a radius — with the deployed direction the magnitude story is the
  Chao-divided one; our integration note's single-digit radius expectation
  applied only to the post-deploy repo revision.
- The rest of deployed META (outside Beat's Yeo line) is still a third
  revision (−855 B vs both snapshots) — other smaller differences may exist
  beyond the Yeo operand order.
- **The clean-room crypto-layer study**:
  Dione is pure per-venue storage (33/33 verified vs direct reads); Charge
  and Yeo are seeded by the global kernel chain (`CHO.Entropy` advances
  inside every call via the stateful `GetUser`/`Recall` getters) — Beat
  outputs are **preview-grindable** (free eth_call previews + cheap public
  chain-advance txs; measured ~12-orders Yeo scatter across 24 grind
  steps). NB `Beat` is NOT metered — META's supply says nothing about
  call volume; the real census is **318 Beat txs / 33 callers, June 2025 →
  September 2026**.

## 7. Provenance

- [src] `domain/tang/03_meta.sol`,
  `domain/world.sol` (the consumer).
- [chain] perimeter; (territory reading confirmed);
  solc compile-verification + fork behavioral A/B.
