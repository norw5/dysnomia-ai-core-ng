# Venues — the hub, the map, and the QINGs

Wave 2 (2025-02-25 → 27 `[chain]`) turned the kernel into a place: a hub
contract, a coordinate transform, and a factory that wraps *any* ERC-20
into a venue.

## CHO — the hub

CHO ("Dysnomia Cho" `0xB6be11F0A788014C1F68C92F8D6CcC1AbF78F2aB`) entered
the world like a user — its constructor runs the same Enter path any LAU
would — then took ownership of VOID's whole spine and added the deployer as
an owner: the hub absorbed the kernel `[src: domain/dan/01_cho.sol]`. Five
jobs:

1. **Session hub** — the delegate record `address → User{Soul, Bao,
   Username, Entropy}` that every venue and game action consults instead
   of keeping its own user lists.
2. **Entropy machine** — every entry, chat and ladder read stirs the
   shared orbit; the derived statistics later divide by your entropy
   (see [the ladder](/dysnomia/guide/the-ladder)).
3. **Coordinate lottery** — `Luo()` draws never-repeating coordinates from
   an orbit over a fixed constant; every new venue's map position comes
   from it. Where venues land is fate, not choice.
4. **System address book** — ~90 aliases written once at boot by a
   one-shot loader: the treasury corpus as named citizens ("source",
   "TreasuryBill", "AFFECTION", "WM" …), the ban tokens, the dev's own
   account `[src: domain/dan/02c_systemaddresses.sol]`.
5. **Runtime privilege injector** — `AddContractOwner` grants MultiOwnable
   membership on any contract; used sparingly, and all onchain.

## MAP + HECKE — venues on a coordinate map

`MAP.New(asset)` creates a **QING** (清) — a chat room + micro-economy
wrapped around the asset, one per asset ever `[src: domain/map.sol]`. The
QING's map position is `CHO.Luo() × Offset` pushed through the **HECKE
meridian transform** — a table of 90 band widths over the constant
`Meridians[0] = 476733977057179` (note: `2 × 476733977057179 + 5 =
MotzkinPrime` — the map's geometry and the crypto's modulus are the same
numbers `[src: lib/heckemeridians.sol]`). The implemented topology is a
stack of folded strips: narrow near the pole, constant-width near the
equator, with a mirrored second hemisphere; venues fill it uniformly
`[chain: full-atlas replication]`.

Entering a QING means passing its **bouncer** — any one of: being on the
staff list, holding ≥25 CROWS `0x203e366A1821570b2f84Ff5ae8B3BdeB48Dc4fa1`
(the same token that gates treasury-side LogoVoting proposals — one
reputation token, two ecosystems' doors `[src]`), holding
≥ totalSupply/BouncerDivisor of the wrapped asset, or owning the asset
contract. Optional cover charge in the wrapped asset; 1-day guest passes
`[src: domain/dan/03_qing.sol]`.

Two **ban tokens** gate the whole layer at the hub: any balance of WITHOUT
`0x173216Ed67eBF3E6767D86e8b3Ff32e0d64437bF` or RESTRAININGORDER
`0xEf2125f5d1f7A3d68038F27e681258d13a73E718` blocks CHO entry and MAP chat
`[src: 01_cho.sol:90, map.sol:55]`.

Wrapped assets include the treasury side's own FED
`0x1D177CB9EfEEa49A8B97ab1C72785a3A37ABc9Ff` and forked pWBTC
`0x2260fac5e5542a773aa44fbcfedf7c193bc2c599` `[chain]` — the venue layer
is where the two ecosystems' actors meet.

## The venue census

Nine hundred seventeen venues exist, spanning 2025-02 to the census block,
with a long tail of new arrivals into 2026 `[chain]`. Activity is heavily
concentrated: the first venue — **Phobos**, the Zürich QING
`0xb0ba7d36b7f0505879179ece7401f24eb653c6e1` — alone carries about a third
of all venue events, and a few dozen venues carry almost all the rest
`[chain: 365-day liveness scan]`. The hub's generated tables carry the
counts and the current leaders.

## DO — venue-claim deeds

Wave 6 deployed two small "DO" (搞) tokens. The live one, DO-2
`0x98dBd5E4F78e53884C77573407727C3779ca3bad`, is a **deed layer**:
`Take(qing)` adds the caller as an owner of the venue's QING contract
through CHO's privilege injector, flips a per-venue taken-once flag, and
mints one DO to the caller's user token `[chain: 54 takes decoded]`. Its source is not in the recovered tree (decompiled); DO-1
`0x3012e0F5eD16C24f61A62100cCEa50cb1E288d08` is a supply-zero draft
`[chain]`.

## The undeployed world layer

A full game layer — WORLD coordinate tiles consuming the tile oracle,
WAR high-score mechanics with a CO2 counter, H2O/VITUS anchored resources,
and GWAT user-spawned sub-venues — is complete in the recovered sources
and **was never deployed**: two failed create transactions in wave 5 and
no live code at any candidate `[chain]`. What shipped ahead of it are
exactly its prerequisites: the YUE vaults, the settle primitive, and the
tile oracle (next page).
