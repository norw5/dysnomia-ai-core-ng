# The Dysnomia guide

> The public-facing guide to Dysnomia — the fully on-chain social operating
> system that shares its cryptographic backbone with the Atropa treasury
> system. Written for a reader meeting the system for the first time;
> statements carry the knowledge base's provenance tags (`[src]` recovered
> source, `[chain]` onchain query, `[irc]` dev-channel record, `[ext]`
> external/unverified).

## What lives where

- **This guide** (`/dysnomia/guide/…`) — the distilled, definitive
  explanation: what the system is, how each layer works, how it connects to
  the treasury side. Start with the [overview](/dysnomia/guide/overview).
- **The hub** ([/dysnomia](/dysnomia)) — generated state: the seven
  deployment waves, every system contract with its entity page, and the
  census aggregates (accounts, channels, venues, activity).
- **Entity pages** (`/dysnomia/contracts/{address}`) — generated data views
  per contract and structural token: identity, deployment, supply/cap,
  liveness, links into the guide and the dev reference.
- **The dev reference** (`/dysnomia/dev/…`) — the per-contract engineering
  documentation, shipped from the project's research layer largely as-is:
  identity tables, mechanical function tables, integration notes. denser
  than the guide, and the place to check a selector or a gate condition.

## Reading order

1. [overview](overview) — what Dysnomia is, in one page
2. [accounts & chat](accounts-and-chat) — users, Souls, channels, the chat
   substrate
3. [venues](venues) — the hub, the map, QING venues, bouncers and bans
4. [the economy](economy) — YUE account tokens, bounties, escrow, the
   internal exchange
5. [the ladder](the-ladder) — the derived "physics" chain and the tile
   oracle
6. [the treasury bridge](bridge) — how Dysnomia and the treasury system
   interlock
7. [glossary](glossary) — the vocabulary, decoded

The random-number backbone shared by both systems has its own reference
page: [/knowledge/reference/randomness](/knowledge/reference/randomness/).
