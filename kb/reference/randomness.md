# Randomness — the two deterministic engines

> The consolidated reference for everything random in the Atropa
> ecosystem. Both engines are **deterministic by design** — there is no
> onchain entropy anywhere in the corpus — and that design choice has
> consequences this page states plainly.

## Engine 1 — the MATH/RNG orbit (treasury side)

Every treasury token's `_mintingKey`, the Keys Of Ong game, and a
de-facto public RNG oracle all run on one mechanism
([shared-infra reference](../reference/shared-infra.md)):

- `MATH.Random()` → `RNG.Generate()` is a **pure `modExp64` orbit** over
  MotzkinPrime `953467954114363`, seeded by hardcoded constructor
  constants — zero onchain entropy `[src: MATH_atropaMath.sol, rng.sol]`.
- Given the call count, outputs are **predictable**; and because the
  state is one global counter, **any caller advances everyone** — one
  step per call, steerable by anyone `[src]`.
- In treasury TTs the drawn key is **inert** (no function consumes it in
  a security-relevant way `[src]`).
- As a public oracle it is heavily used: third-party contracts grind
  24–56M `Random()` calls per month into 2026 `[chain]`; the Keys Of Ong
  prediction game (`Dong(uint64)` award-mints) is the flagship consumer —
  two specialists account for 96.6% of 7,730 recorded wins `[chain]`, which is exactly what a predictable orbit permits.
- Random-derived economic flows exist: cDc's permissionless `Mint()` pays
  `(Random()%4000)×10^15`-style amounts into fixed wallet slots `[src]`.

## Engine 2 — the CHO kernel chain (Dysnomia side)

The live gameplay randomness is *stateful*, not pure
([the ladder](../../guide/the-ladder.md)):

- CHO's global `Entropy` head advances on `Recall` — which the stateful
  `GetUser()` getter calls on every metered path, several times per
  action `[src: 01_cho.sol]`. Anyone's committed call moves everyone's
  next outputs; `eth_call` previews are pure `[fork-verified]`.
- `META.Beat` decomposes exactly onto storage reads (`Dione =
  CHO.bal(venue) // Entropy` — 33/33 nonzero venues verified `[chain]`),
  and its outputs feed territory-expansion parameters.
- **Preview-grindability is quantified**: stepping the head with cheap
  transactions and previewing for free yields a favorable draw in a
  measurable fraction of steps (~29% ≥ 1e11 `Yeo` at the test venue)
  `[chain: measured grind experiment]`.

The two engines are coupled only through usage patterns, not state: MATH
sits behind both (Dysnomia's caps and keys draw from the same orbit
`[src]`), but the kernel chain's entropy lives in CHO storage.

## Consumers at a glance

| consumer | engine | use | consequence |
|---|---|---|---|
| treasury TT `_mintingKey` | MATH orbit | constructor-drawn key | inert `[src]` |
| Keys Of Ong `Dong` | MATH orbit | award-mint on key guess | winnable by prediction specialists `[chain]` |
| third-party grinder contracts | MATH orbit | free-ish RNG oracle | 24–56M calls/month `[chain]` |
| cDc / 正 mint routing | MATH orbit | Random-derived payout sizes | cosmetic `[src]` |
| Dysnomia caps (`maxSupply`) | MATH orbit | constructor lottery | lifetime budgets, fixed at birth `[src]` |
| soeng ladder reads / Beat | kernel chain | derived physics + tile params | preview-grindable `[chain]` |

## Prior audits, reconciled

A pre-existing audit pair (owner-delivered, predating this knowledge base)
analyzed the randomness surfaces and concluded "no gameplay randomness".
Scoped to what it actually examined — the never-deployed **VMREQ**
contract's constructor lottery and gates — it is correct: the lottery is
inert at cap, the surfaces it checked are onlyOwners, and its Soul-
collision gas math holds. At system level it missed the two live engines
above: MATH as a public oracle, and the CHO kernel chain as the live
gameplay randomness. One threat-model correction carries over: the
user-facing Soul surface is `VOID.Enter(string,string)`
(`10_void.sol:132-137`), not the onlyOwners `SIU.Miu`.

The developer's own standing reaction policy (owner-delivered record,
`[ext]`): a continuous prover watches the Kong game's `Dong(uint64)`
emissions (selector `0xbce3821f`; benchmark win at block 26,125,925) — a
new win beyond that benchmark is treated as a PRNG-compromise signal,
triggering quarantine and a local-VM re-seed. The onchain MATH has no
admin keys, so a re-seed is only ever possible on the VM side `[ext]`.

## Bottom line

Nothing in either ecosystem draws secret randomness. Where that matters
(Keys Of Ong, Beat-derived territory parameters), it is a known, measured,
and — in the dev's own recorded policy — actively monitored property of
the design, not an undiscovered flaw.
