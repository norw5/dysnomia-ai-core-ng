# Dysnomia — overview

Dysnomia is a **fully on-chain social operating system** — accounts, chat
channels, venues, an internal economy, and a partially-shipped world layer —
implemented as a web of about thirty system contracts plus tens of
thousands of factory-spawned child tokens on PulseChain. It was built by
the same hand as the Atropa treasury system: its deployer wallet
`0x0474606332105A1dA6FC8EF7De2470551D389Cb9` was funded directly by Maria
#2 `0x7a20189B297343CF26d8548764b04891f37F3414` (300,000 PLS at block
21,220,651, tx
`0xc9ed1cac0fe5f65a2c36d159fc4c0b2f5d7364e632c44fc61c811a4edabb1194`,
then 100,000,000 PLS at block 23,043,490 `[chain]`), and every system
contract carries the shared MATH token as its math library `[chain]`.

The kernel booted on **2024-08-23** — four months *before* treasury V1.
Where the treasury system is ordered accountancy (bills, reserves,
bureaus), Dysnomia is the other half of the same workshop: a self-organizing
chat world with its own law — bouncers, bans, cover charges, and
cryptography used as physics. Its name is the daughter of Eris in Greek
myth; the naming systems inside are systematic and layered, and are decoded
in the [glossary](/dysnomia/guide/glossary).

The dev's own one-line description (2024-12-25): *"a distributed network
cross between a shell account and a mud with tokenized assets and
packages"* `[irc: atropa_logged line 21114]`.

## The three design pillars

1. **Everything is a token, and usage mints supply.** Every system contract
   is an ERC-20 whose working functions mint exactly one unit *to the
   contract itself* per call `[src: 01_dysnomia*.sol]`. A contract's
   `totalSupply()` is literally a **call counter**. Each contract is born
   with `maxSupply = Random() % 111111` — a lottery-drawn lifetime budget
   `[src]`. When the budget is exhausted the contract keeps working but
   stops paying its own meter: the infrastructure is a set of pre-paid
   machines, and most of the heavy machinery has already run dry
   (see [the hub](/dysnomia)'s cap column `[chain]`).
2. **Cryptography as physics.** The system runs on the same backbone as the
   treasury and AFFECTION ecosystems — MATH
   `0xB680F0cc810317933F234f67EB6A9E923407f05D` as the shared `Xiao`
   library, `modExp` over MotzkinPrime `953467954114363`, Fa/Faung-style
   orbits advanced by `React()` calls. Entities hold evolving numeric state
   ("entropy") that every action stirs; the derived quantities the world
   computes divide by it.
3. **Chat is the substrate.** The kernel contracts are literally named
   "CHATLOG Yi", "CHATLOG Void" and so on `[chain]`. Messages are events
   (`LogEvent(Soul, Aura, LogLine)`); the chat archive *is* the event log.

## What users actually do

1. **Get an account** — `LAUFactory.New(name, symbol)` mints a personal
   LAU contract (your handle as a token). Under the hood the system creates
   a cryptographic channel pair for you and installs it in the soul
   registry under a random `uint64` Soul id.
2. **Chat** — through your LAU or a venue. Every line is an event on a
   channel contract; the world's conversation is readable by anyone.
3. **Enter venues** — a QING is a chat room plus micro-economy wrapped
   around *any* ERC-20. Bouncer rules, cover charges and guest passes
   apply; 917 venues exist `[chain]`.
4. **Wrap a token into a venue** — `MAP.New(asset)` places a new QING on
   the coordinate map at a position drawn from the hub's coordinate
   lottery.
5. **Open a personal account** — a YUE vault token receives your earnings,
   guards withdrawals behind an opt-in escrow, and carries a built-in
   exchange desk.
6. **Trade** — every token in the family carries `Purchase`/`Redeem` at
   internally-tracked rates, and AFFECTION is seeded 1:1 everywhere
   `[src]`, so value moves between the ecosystems through the ordinary
   token machinery.

The layers each get a page: [accounts & chat](/dysnomia/guide/accounts-and-chat),
[venues](/dysnomia/guide/venues), [the economy](/dysnomia/guide/economy),
[the ladder](/dysnomia/guide/the-ladder).

## The seven waves

All deployments came from the one deployer wallet, in seven waves over two
years — kernel (2024-08), CHO era (2025-02), soeng I (2025-03), soeng II
(2025-05), accounts + tile oracle (2025-06), DO deeds (2025-06), and the
treasury bridge PKMinter (2026-05) `[chain]`. The block-exact wave table
with every contract is on the [hub](/dysnomia). A complete world layer —
coordinate tiles, resources, user-spawned venues — is written in the
recovered sources but was **never deployed** (two failed creates, no live
code `[chain]`); what did deploy are its prerequisites: the vaults and the
tile oracle.

## Scope note

This portal documents the treasury system as its deepest tier and Dysnomia
as a first-class neighbor. AFFECTION™ mechanics stay canonical in the
[separate AFFECTION portal](https://affection-terminal.vercel.app/); the
infrastructure all three share (MATH/RNG and the math family) is canonical
here — see [shared infrastructure](/knowledge/reference/shared-infra/) and
the [randomness reference](/knowledge/reference/randomness/).
