# ZHOU — "CHATLOG Zhou" — the global chat target

> Wave 1 · 2024-08-23 00:47 UTC · deployed `[chain]` · at cap

## In player terms

| | |
|---|---|
| **The main room lives here** | Global chat — what you send through your LAU's `Chat` — lands as a message on ZHOU's own channel (Fomalhaute). That channel's log IS the world's town square: 8,082 messages archived so far `[chain]`. |
| **Watch it, don't call it** | Users never interact with ZHOU directly; VOID routes every `Chat` line here deterministically. To read the main room, pull LogEvents off the Fomalhaute channel address. |
| **Its channel doubles as a stat modulus** | Wave-3 statistics use your Fomalhaute balance as a modulus — holding the main room's channel token literally shapes your derived numbers. |
| **Anyone can nudge it** | `React` is public and unmetered-by-permission: anyone may advance ZHOU's orbit one step. The design reads this as public weather, not trespass. |

## 1. Identity

| | |
|---|---|
| Address | `0x5cc318d0c01fed5942b5ed2f53db07727d36e261` |
| Creation | block 21,220,693 — 2024-08-23 00:47 UTC (tx `0xccd00419c90a1b7cbcf39436d3adb55cfbd779a07469fa4b06e4ad5f3c539656`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | CHATLOG Zhou / ZHOU `[chain]` |
| Supply / cap | 37,636 / 37,636 — **at cap** `[chain]` |
| Own channel | (Fomalhaute) Shio `0x7aE73C498A308247BE73688c09c96B3fd06dDB84` — created in this constructor, same block/tx `[chain]` |

## 2. Role

The layer the world TALKS through: ZHOU installs its own rod ("Zheng
Rod"/"ZROD" + "Yi Shio Cone"/"ZCONE" — the (Fomalhaute) SHIO) into the ZHENG
registry, and `React(iota)` spins it. VOID's global `Chat` writes
`"<username> line"` messages onto ZHOU's SHIO — the main room. The
Fomalhaute channel holds 8,082 LogEvents `[chain]` — the kernel's chat
archive.

## 3. Dependencies

- Owns ZHENG and YI (constructor adds itself to both); its rod SHAs come via
  `Alpha`/YI.Beta.
- Called by VOID (`Log("ZHOU", …)` path — hard-routed via `_kecNames`),
  YAU/YANG constructors (React spins), XIA (Fomalhaute = ZHOU's channel as
  its modulus source), ReactionsLib (`ReactFomalhaute`).

## 4. State

`Upsilon` (ZHENG), `Xi` (ZHOU's own soul index — VOID uses it to find the
chat target), `Monopole`.

## 5. Functions

<!-- fntable: ZHOU @ 06_zhou.sol -->
<!-- fntable-begin: ZHOU @ 06_zhou.sol -->
Function table extracted mechanically from `06_zhou.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address ZhengContract)` | deployer | — | — | — |
| `Augment(Bao memory Theta)` | internal | meter | — | — |
| `Alpha(string memory Name, string memory Symbol) returns (SHA Epsilon)` | owners | meter | — | — |
| `React(uint64 Iota) returns (Bao memory)` | public | meter | — | — |
<!-- fntable-end -->

Effects: `Alpha(name, symbol)` = YI.Beta + owner grants (the SHA factory
wrapper used at boot); `React(iota)` fetches its own Bao from ZHENG and
advances it through YI.React — public, un-gated, metered.

## 6. Integration notes

- The chat history of the main room = LogEvents on
  `0x7aE73C498A308247BE73688c09c96B3fd06dDB84` (no indexed args).
- ZHOU.React is public — anyone advances ZHOU's orbit; entropy semantics
  treat this as public weather.

## 7. Provenance

- [src] `06_zhou.sol`.
- [chain] perimeter; activity scan (8,082 Fomalhaute LogEvents).
