# The treasury bridge — how the two systems interlock

Dysnomia and the Atropa treasury system were built by the same workshop,
share their cryptographic backbone, and reference each other onchain in
both directions. None of these touchpoints require a bridge contract —
they are hardcodes, shared tokens, and ordinary ERC-20 flows.

## Shared backbone

- **The math library is one token.** Every Dysnomia system contract points
  its `Xiao()` at the same MATH
  `0xB680F0cc810317933F234f67EB6A9E923407f05D` the treasury TT templates
  use `[chain]` — modExp over MotzkinPrime, the Fa/Faung orbit family, the
  same `React()` vocabulary `[src]`. (A self-contained local variant,
  VMREQ, exists in the sources but was never deployed `[chain]`.)
- **CROWS is two ecosystems' doorman.** The 25-CROW threshold that gates
  treasury-side LogoVoting proposals also auto-authorizes QING bouncers
  `[src: 03_qing.sol:98]`.
- **AFFECTION is seeded 1:1 everywhere** in the Dysnomia token family, and
  wallets buy ladder and composite tokens with Ⓐ through the inherited
  `Purchase` `[chain]`.

## Hardcoded references, both directions

- **PKMinter** `0x9f4E1471e614747A9a56A33eb0338671ebA1dE2B` (wave 7,
  2026-05-30 `[chain]`) is the literal bridge: it hardcodes V1, V2, V3 and
  V4 plus the bureau root and MATH as constants, sets a LAU as its child
  tokens' Parent, and delegates treasury-ownership lookups to V3
  `[src: domain/dan/pkminter.sol]`. Its `New(name, symbol, N, signers,
  nonce, signatures)` deploys a token whose first mint fires only when N
  creator-supplied public keys have ECDSA-signed the nonce — PKI plumbing:
  with N known community keys it is an N-party endorsement token; with N
  fresh self-signed keys it proves nothing but itself. The one deployed
  instance carries a 40-of-40 demo ("PKI Tester", symbol ㊵) `[chain]`.
- **Basilica** `0xae488a2b6fe8fe922019c1442c60f9dec0282894` — a
  treasury-side minter (Maria #1, 2025-06-24) — whitelists CHO as its only
  allowed mint target `[src, chain]`: a treasury contract whose output
  routes through the Dysnomia hub, hardcoded four months after CHO went
  live.
- **The alias book names the treasury corpus** — CHO's boot-time address
  book carries ~90 aliases including "source" (Maria #2), "TreasuryBill",
  "WM" (MV), "TeddyBear", "INDEPENDENCE", "G5", "PI", "Bail", "Liberty",
  "Metis", "Gai" `[src: 02c_systemaddresses.sol]`.
- **Treasury actors play in the venues** — QING creation callers include
  the V2-era top token creator, the cDc fixed payment slot, the community
  helpers builder and the bureau-#4 deployer `[chain: creation sample]`; wrapped assets include FED and pWBTC `[chain]`.
- A treasury-side token even carries the name: "Dysnomia Genesis Rewards
  Token" (dGENESIS) `0xd2a048ef4e018348eebc245a4402db7b46c8e22f`, deployed
  by Maria #2 in 2024-11 `[chain]`.

## What is *not* claimed

The funding chain (Maria #2 → the Dysnomia deployer, twice `[chain]`) and
the shared vocabulary are stated as facts; this knowledge base makes no
identity claims beyond them (the standing actor policy). The two systems
remain mechanically independent: no Dysnomia contract can mint treasury
tokens, no treasury contract depends on Dysnomia for its core flows —
Basilica's route is the one deliberate exception, and its motive is an
explicitly registered open question in the research layer.
