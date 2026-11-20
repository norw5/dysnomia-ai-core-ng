# The ladder — derived physics and the tile oracle

Between the venues and the (undeployed) world layer sits the strangest
and most characteristic piece of Dysnomia: a ladder of tokens, named after
Chinese-medicine concepts, that compute *derived quantities* over users and
venues — and pay themselves one unit per read `[src: domain/soeng/*.sol]`.

## The soeng chain

Every rung is a public, stateful function — reading it mints it. The
formulas, in construction order `[src]`:

| rung | computes | in plain terms |
|---|---|---|
| **QI** (气) | `Eris.balanceOf(user) ÷ user.Entropy` | energy — your constellation-channel holdings over your entropy |
| **MAI** (脈) | `qing.balanceOf(user) ÷ user.Entropy` | pulse — your venue holdings over your entropy |
| **XIA** (夏) | `modExp(QI_venue, MAI_user, Fomalhaute.balanceOf(user))` | charge — a modular exponentiation over both |
| **XIE** (泄) | `(Charge, Fornax(user)/Entropy, Fornax(qing)/Entropy)` | the leak — charge plus two Fornax ratios |
| **ZI** (子) | `Iota = modExp(Omicron, Charge, CHOA.Yuan(CHO))` | spin — against the hub's purchasing power |
| **PANG** (碰) | two modExps against `Yuan(qing)` moduli | collision push |

Note what is hardwired in: QI divides by **Eris**, XIA's modulus is
**Fomalhaute**, XIE reads **Fornax**, ZI's modulus is the **CHO hub
itself** `[src]` — the wave-1 constellation channels are the physics
constants of the world, exactly as the treasury reserves are the constants
of the minters.

## The account/oracle loop

The ladder feeds two consumers:

- **RING** ("Dysnomia Ring") — `Eta()` mixes `Yue.React` at Phobos (the
  first venue, the fixed reaction reference `[src: 03_ring.sol]`) with
  PANG's push and records a per-player `Moments[soul]`.
- **META** ("Dysnomia Meta") — `Beat(waat) → (Dione, Charge, Deimos, Yeo)`
  is the **tile-parameter oracle**: combine RING + PANG, then
  `Deimos = modExp(Dione, Phoebe, Yuan(qing))` and `Yeo = Yeo / Chao`
  (the deployed division; `Yeo` comes out Chao-scaled large) `[src:
  06_meta.sol; fork-verified]`. Per the source, these are
  **territory-expansion inputs**: `Yeo` bounds the tile radius each QING's
  placement is checked against in the undeployed WORLD layer; `Charge` and
  `Deimos` feed tile value and creator credits.

**Beat readiness is a token seed, not a waiting period** (session-82
correction): `Eta` reads live balances, not a stored age. A fresh account
can Beat as soon as its LAU holds `Fomalhaute` (the WorldChatSHIO) and
`Fornax`, and its wallet/LAU/YUE holds `CHO` and `Phobos` for the Yuan
weights. Remove any one of those legs and `Beat` panics `0x12` (the Eta
shape depends on which leg is missing — `(14,0,0,0)` all-absent,
`(14,1,0,0)` no Fomalhaute, `(14,0,1,1)` no Fornax/CHO/Phobos); with
the seed it lands immediately (the target venue's own Yuan shapes the
output, not the revert). A wallet with no YUE at all is the only true
pre-Beat identity floor — `Eta` reverts until the vault exists.

**Exact seed floors (fork-pinned, session-82.1)**: `Fomalhaute` at the LAU
needs **2 wei** (1 wei zeroes the modulus); `CHO`/`Phobos` Yuan must be
**≥ 2** (1 wei in the wallet fails; 1 wei at the LAU counts 10, at the YUE
40); `Fornax` must clear the live `Entropy` draw (preview and retry). The
old "Fornax Goldilocks ceiling" is the April/source formula — the deployed
third revision showed no static cap in a controlled Fornax sweep, so use
previews rather than a formula ceiling.

**Buying the seed (session-83)**: the terminal's agent can now acquire
these tokens through PulseX V2 (`swap_pls_for_token` — router `0x165C…`,
WPLS `0xA107…`). It is an exact-output swap: ask for exactly 2 wei of
Fomalhaute / CHO / Phobos or 1e15 wei of Fornax (0.001), and the router
refunds the unused PLS; the native route needs no token approval. Send
Fomalhaute and Fornax to the **LAU**; CHO/Phobos in the wallet is enough
for the 2-wei Yuan floor. The Fornax level is a starting point — the live
per-soul `Entropy` divisor varies, so preview a Beat and retry a larger
buy on a zero Iota. The seed pools are thin: the tool quotes first and
refuses a price impact above its guard (5% by default), and every swap
still passes THE gate (an approval card in wallet modes A/B). At the
session-83 pin the four buys cost roughly 674 PLS of Fornax plus dust for
the other three; quotes move, so always quote fresh.

Every rung is metered like all system contracts — one self-mint per call
against a lottery budget. At the research census the whole ladder sat
**at cap**: the call counters froze exactly at their constructor-lottery
budgets (QI ≈ 91.8k calls, CHOA ≈ 42.1k, MAI ≈ 26.4k, XIE ≈ 20.8k, PANG
≈ 15.4k, ZI ≈ 13.2k, XIA ≈ 5.6k `[chain: meter census]`) —
usage was heavy, and when the budgets ran out the reads kept working and
the meters stopped. The hub's generated table carries the live numbers.

## The rolling-state engine

The core finding of the crypto-layer study, worth knowing before you touch the ladder: the
system's randomness is a **shared deterministic chain**, and the ladder
reads it *statefully*. CHO's global `Entropy` head advances inside the
ordinary `GetUser()` path several times per action — so anyone's committed
call moves everyone's next outputs, while `eth_call` previews are pure
`[src: 01_cho.sol, fork-verified]`. Consequences:

- **Beat outputs are decomposable and reproducible** — each component
  traces to a specific storage read (33/33 nonzero venues verified
  onchain `[chain]`).
- **Previews are grindable** — a patient caller can step the global head
  with cheap transactions and preview for free until a favorable
  (Charge, Yeo) draw appears; measured at one venue, ~29% of grind steps
  produced a Yeo ≥ 1e11 `[chain: measured grind experiment]`.

The full mechanics of the shared orbit — and how the same design choice
makes the treasury-side MATH/RNG pair predictable — are consolidated on
the [randomness reference](/knowledge/reference/randomness/) page.
