> Pulled verbatim from the origin research repo (`atropa-terminal/kb-v2/dysnomia/dev/`,
> session-48 owner round) — the compiled per-contract dev reference this package
> was ALWAYS meant to ship. Provenance tags `[src]/[chain]/[ext]/[irc]` carry over;
> internal links rewritten to repo-relative paths. These docs are RESEARCH
> REFERENCE — normative deployed facts for this app remain kb/deployed-semantics.md
> (the dev docs describe the source tree including the never-deployed layer).
> ng session-49 link fixes: the origin's `../08-glossary.md` and
> `../04-data-layer.md` do not exist in this package — the glossary now points at
> our guide's glossary; the data-layer reference stays as origin-corpus prose.

# Dysnomia — per-contract dev reference

> One doc per contract (~36 named scopes; identical
> instances share type docs), schema per doc: **Identity · Role ·
> Dependencies · State · Function table · Integration notes · Provenance**.
> Function tables are EXTRACTED MECHANICALLY from the recovered sources.
> Signatures are never hand-transcribed; narrative is hand-written on top.

Standing rules: positive framing (a fully on-chain social OS — chat-world
shell — with a partially-staged, MUD-inspired world layer; Second Life-style
social virtual world over "game"); Q-3 identity discipline; full addresses;
`[src]/[chain]/[ext]/[irc]` provenance. Onchain snapshot: block 27,584,967
(2026-09-19) unless noted.

**Prose pass**: every deployed-contract doc carries an **"In
player terms"** block near the top — plain-language rows for what a user
actually does with / experiences from the contract, our own words from our
own `[src]/[chain]` understanding (the undeployed set keeps its designed-loop
paragraphs instead). The shared vocabulary lives in
[../../guide/glossary.md](../../guide/glossary.md) (ng link fix, session-49;
origin: `../08-glossary.md`).

## The wiring at a glance

Five panels, one per concern. Legend for every arrow used:

```
A ──owns──> B    A is a MultiOwnable owner of B (authority; passes on
                 msg.sender OR tx.origin — see dysnomia-base.md)
A ──makes──> B   A deployed B (factory call or constructor internal create)
A ──calls──> B   runtime call path (steady-state dependency)
```

### 1 · Wave 1 — the kernel spine (boot order 2024-08-23, ~7 minutes end to end)

Each layer takes ownership of the layers below it as it boots; the deployer
EOA `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` remains an owner everywhere
via constructor `tx.origin` adds — so authority flows down AND out.

```
   SHAFactory ──makes──> SHA  (keypair objects, by the thousand)
   SHIOFactory ──makes──> SHIO (channels; each SHIO owns its two SHAs)
        │                        │
        │   YI.Beta / YI.Kappa ──┘   the system's factory gateways
        ▼                    ▼
        YI ────makes────────> (Fornax) SHIO = YI.Psi
        ▲ │
        │ owns
   ZHENG─┘ │   soul registry Sigma: uint64 Soul → Bao; Mau() = the
        ▲   │   one-call user factory (creates SHA pair + SHIO + slot)
        │   │
     ZHOU ──┘   the global chat target; (Fomalhaute) SHIO = its rod
        ▲
        │
      YAU       boot relay; feeds YANG's Bang leg
        ▲
        │
     YANG       Tai{Bang, Le, Lai}; (Eris) SHIO = Lai; Pole[3] are the
        ▲       public coordinates SIU copies into every user's Saat[0]
        │
      SIU       Miu() = the user gate; Aura() = address mod MotzkinPrime
        ▲
        │
      VOID      sessions; Chat(); the library loader (see panel 3)
        ▲                   ▲
        │ owns              │ registers as libraries
  LibAttribute ────────────┤  ("libattribute")
        ▲                   │
   LAUFactory ──owns────────┘
        │
        └──makes──> LAU  (the user-account token — ×18,660 live)
```

### 2 · The user journey (what actually happens when you join and talk)

```
 joining:
   EOA ──> LAUFactory.New("handle","SYM")
             │
             └─makes─> LAU ──> VOID.Enter(name,symbol)
                                   │
                                   └─calls─> SIU.Miu ──calls─> ZHENG.Mau
                                                              │
                          SHAFactory <──makes── YI.Beta <──────┤
                          SHIOFactory <──makes── YI.Kappa <────┤
                                                              ▼
                          user SHA pair + SHIO ──install──> ZHENG.Sigma[soul]
                          (soul = Random(); aura = address mod p; the user's
                           LAU + wallet own their SHIO, system owns the rod)

 chatting (the main room):
   LAU.Chat(line) ──calls──> VOID.Chat
        │                       │ requires a session + Username attribute
        │                       ▼
        │                 ZHOU's SHIO (Fomalhaute) .Log(soul, aura,
        │                                    "<Username> line")
        ▼                                   │
   meters on the way                      emits LogEvent  ← the chat archive
```

### 3 · Wave 2 — the CHO era (2025-02): hub, map, venues

```
   ReactionsLib ("corereactions") ─┐
   LibStrings    ("strings") ──────┼──register on──> VOID
   LibAttribute  ("libattribute") ─┘

   CHO ──owns──> the entire wave-1 spine (VOID down)
    │  │
    │  └──calls──> ReactionsLib     the entropy orbit: React / Recall /
    │                                ReactUser advance per-user + system state
    │
    ├──< alias-dir (one-shot)       wrote ~90 aliases into CHO's address book:
    │                                "source" = Maria #2, the treasury corpus,
    │                                "mariarahel", ban tokens WITHOUT/…
    │
    │            HECKE             Waat ↔ (lat,lon) meridian transform
    │              ▲               (deployer-created; standalone — everyone
    │              │                reads its constant table)
    ▼              │
   MAP ──New(asset)──makes──> QING (×917 live venues; ONE per ERC-20, ever)
    │  │   coordinate = CHO.Luo() × HECKE.Meridians[0]; tile via
    │  │   HECKE.Compliment (MAP owns CHO + VOID; MAP calls HECKE)
    │  │
    └── QING ◄──mutual ownership──► CHO      venue = chat room + bouncer
         Join(LAU): WITHOUT-ban check | cover charge | 1-day guest list
         Chat(LAU,msg): emits LogEvent(Username, Soul, aura, msg)
         bouncer: staff | ≥25 CROWS | asset stake | asset-owner
         GWAT flag: creation lottery — most venues' escrow is locked forever
```

### 4 · Waves 3–5 — the physics ladder + the account layer (2025-03 → 06)

Construction chain — each contract is built against the one to its left
(SEI additionally takes ownership of CHAN + CHO, CHEON of CHO + CHAN, CHOA
of CHAN; the ladder contracts proper carry only deployer-EOA ownership +
market-rate wiring):

```
 Zürich QING ─> QI ─> MAI ─> XIA ─> XIE ─> CHAN ─> SEI ─> { CHEON, CHOA }
 ("Phobos")                                                    │
                                    ZI ─> PANG ─> RING ─> META │
                                    ▲                          │
                                    └──constructed against─────┘

 physics constants (hardwired):   derived quantities:
   QI   = Eris.balance ÷ entropy     XIA  = modExp(QI, MAI, Fomalhaute)
   MAI  = venue.holdings ÷ entropy   XIE  = (Charge, Omicron, Omega) via Fornax
   (Eris = YANG's SHIO;              ZI/PANG = spins vs CHOA.Yuan (purchasing
    Fomalhaute = ZHOU's;              power = wallet + 10×LAU + 40×YUE)
    Fornax = YI's Psi)               META.Beat = the tile oracle → territory

 accounts:
   EOA ──SEI.Start(LAU)──> YUE (×93 account/vault tokens, one per wallet)
                           │  registered in CHAN.Yan (the directory)
   CHOA.Chat(qing,msg) ───┤  chat-to-mine: QING.Chat + advance YUE bars
        │                 │  + MAI bounty from CHOA's own balance → YUE
        └──> CHAN.ReactYue ──> YUE.React ──> XIE.Power
   CHEON.Su(qing) = the settle primitive (advance + payout + drip)
   custody: ONLY CHAN (with the player's OptIn) may Withdraw/MintToOrigin a YUE
```

### 5 · The undeployed world layer ★ and the treasury bridge

```
 ★WORLD(cheon, meta, map) ──makes──> ★VITUS (seeds 1:1 with MV)
   │   Code(lat,lon,qing): CHEON.Su + META.Beat (Yeo bounds the tile radius)
   │                          + tile mass + VITUS minted to the player's YUE
   └─> ★WAR(world) ──makes──> ★H2O (seeds 1:1 with "Call")
            └─> ★GWAT(war)   user-spawned sub-venues ("…'s <asset> GWAT")

 treasury bridge (deployed, 2026-05-30):
   PKMinter ──makes──> TT   (Parent = the creator's LAU; treasury vocabulary:
    │                      _hu ladder, ho() inbox, FuckOff, TTDATA fallback)
    │  hardcodes V1 TbillMinter, V2 FederalMinter, V3 IndexMinter,
    │  V4 PersonalMinter, BUREAU root + MATH as the mathlib;
    │  GetTreasuryTokenOwner falls back to V3 for non-PKMinter tokens
    ▼
   CHO <──only mint target── Basilica (treasury side, Maria #1, 2025-06-24)

 funding + naming: Maria #2 ──300k PLS──> deployer EOA (25 blocks before
 boot; +100M PLS 2025-03); CHO's address book aliases her as "source";
 the dev's in-world account is the mariarahel LAU (diyat tax recipient).
```

## The shared base

| doc | contract(s) |
|---|---|
| [dysnomia-base.md](./dysnomia-base.md) | DYSNOMIA v1/v2 + MultiOwnable — the inherited face of every family token (call-counter supply, constructor-lottery cap, Purchase/Redeem, tx.origin-OR-msg.sender authority) |

## Wave 1 — the kernel (2024-08-23)

| doc | address | one-liner |
|---|---|---|
| [shafactory.md](./shafactory.md) | `0x4208333D65A90577E3da39B84D6A95eb9db717D2` | SHA deployment gateway |
| [shiofactory.md](./shiofactory.md) | `0x5063D2A97960DDE8dc5E3e5A69aAa379C6301F1C` | SHIO channel gateway (12,460 children) |
| [sha.md](./sha.md) | (type) | the cryptographic particle — keypair object |
| [shio.md](./shio.md) | (type + 3 kernel instances) | the verified two-SHA channel; LogEvent = the chat primitive |
| [yi.md](./yi.md) | `0x4757438723055f14a1af5c9651c2e37730f41a9e` | CHATLOG Yi — factory-gateway root (Fornax born here) |
| [zheng.md](./zheng.md) | `0x24e62c39e34d7fe2b7df1162e1344eb6eb3b3e15` | the soul registry + user factory (Mau) |
| [zhou.md](./zhou.md) | `0x5cc318d0c01fed5942b5ed2f53db07727d36e261` | the global chat target (Fomalhaute born here) |
| [yau.md](./yau.md) | `0x7e91d862a346659daeed93726e733c8c1347a225` | first spine relay |
| [yang.md](./yang.md) | `0xb702b3ec6d9de1011be963efe30a28b6ddfbe011` | the Tai triple + public coordinates (Eris born here) |
| [siu.md](./siu.md) | `0x43136735603d4060f226c279613a4dd97146937c` | the user gate — Aura() = your address mod p |
| [void.md](./void.md) | `0x965b0d74591bf30327075a247c47dbf487dcff08` | the session shell + library loader; Chat |
| [libattribute.md](./libattribute.md) | `0x529e3e15da19c7c828f9cce13c53f7031a30ec7c` | string attributes + aliases ("libattribute") |
| [registry.md](./registry.md) | — **NOT DEPLOYED** | the typed key-value store — unreferenced in-tree, never shipped |
| [lau.md](./lau.md) | (type; 18,660 live) | the user-account token |
| [laufactory.md](./laufactory.md) | `0xbA6CcD38992839aEE20D5bF9125b1d94190b091C` | the world's front door |
| [vmreq.md](./vmreq.md) | — **NOT DEPLOYED** | the local math VM that never shipped |

## Wave 2 — the CHO era (2025-02-25 → 02-27)

| doc | address | one-liner |
|---|---|---|
| [reactionslib.md](./reactionslib.md) | `0x8704d7740735F6DEA0103366fE297Ba3F9fCaCc4` | the orbit primitives, centralized ("corereactions") |
| [libstrings.md](./libstrings.md) | `0x4ab87f1DBDF6f741ED8BF481C7346103a86f1068` | string toolkit ("strings") — registered, unused |
| [cho.md](./cho.md) | `0xB6be11F0A788014C1F68C92F8D6CcC1AbF78F2aB` | the hub — sessions, entropy, Luo lottery, address book |
| [alias-dir.md](./alias-dir.md) | `0x7207BdB5746e39d4bb27A8b9f206047e8432D9aC` | the one-shot ~90-alias loader |
| [hecke.md](./hecke.md) | `0x29A924D9B0233026B9844f2aFeB202F1791D7593` | the meridian coordinate transform |
| [map.md](./map.md) | `0xD3a7A95012Edd46Ea115c693B74c5e524b3DdA75` | QING factory + coordinate grid |
| [qing.md](./qing.md) | (type; 917 live) | the venue token — bouncer economy, GWAT lottery |

## Waves 3–5 — the soeng ladder + accounts + tile oracle (2025-03 → 06)

| doc | address | one-liner |
|---|---|---|
| [qi.md](./qi.md) | `0x4d9Ce396BE95dbc5F71808c38107eB7422FD9a03` | energy = Eris holdings ÷ entropy |
| [mai.md](./mai.md) | `0xc48B0a4E79eF302c8Eb5be71F562d08fB8E6A3d8` | pulse = venue holdings ÷ entropy |
| [xia.md](./xia.md) | `0x7f4a4DD4a6f233d2D82BE38b2F9fc0Fef46f25FA` | charge = modExp(qi, pulse, Fomalhaute) |
| [xie.md](./xie.md) | `0x4Df51741F2926525A21bF63E4769bA70633D2792` | leak — the (Charge, Omicron, Omega) triple |
| [chan.md](./chan.md) | `0xe250bf9729076B14A8399794B61C72d0F4AeFcd8` | YUE directory + player-consent escrow |
| [sei.md](./sei.md) | `0x3dC54d46e030C42979f33C9992348a990acb6067` | the YUE starter (93 children, erratum v2) |
| [yue.md](./yue.md) | (type; 93 live) | per-player account/vault + exchange desk |
| [cheon.md](./cheon.md) | `0x3d23084cA3F40465553797b5138CFC456E61FB5D` | the settle primitive |
| [choa.md](./choa.md) | `0x0f5a352fd4cA4850c2099C15B3600ff085B66197` | play + chat-to-mine + Yuan purchasing power |
| [zi.md](./zi.md) | `0xCbAdd3C3957Bd9D6C036863CB053FEccf3D53338` | spin against purchasing power |
| [pang.md](./pang.md) | `0xEe25Ccd41671F3B67d660cf6532085586aec8457` | collision push — the ladder apex |
| [ring.md](./ring.md) | `0x1574c84Ec7fA78fC6C749e1d242dbde163675e72` | moment recorder (Phobos = Zürich QING) |
| [meta.md](./meta.md) | `0xE77Bdae31b2219e032178d88504Cc0170a5b9B97` | the tile oracle — territory-expansion inputs |

## Waves 6–7 — DO + the bridge (2025-06 / 2026-05)

| doc | address | one-liner |
|---|---|---|
| [do.md](./do.md) | `0x3012e0F5eD16C24f61A62100cCEa50cb1E288d08` + `0x98dBd5E4F78e53884C77573407727C3779ca3bad` | the 搞 pair — source not in tree |
| [pkminter.md](./pkminter.md) | `0x9f4E1471e614747A9a56A33eb0338671ebA1dE2B` | the treasury-bridge PKI experiment |
| [pk-tt.md](./pk-tt.md) | (type; 1 demo live) | the PKI-endorsed treasury-dialect token |

## The undeployed world layer — complete in source, never shipped

| doc | role |
|---|---|
| [world.md](./world.md) | coordinate tiles + creator royalties (VITUS mints) — the failed wave-5 create |
| [war.md](./war.md) | spawn coordinates + the water/CO2 loop |
| [h2o.md](./h2o.md) | 水 — the water resource (1:1 with "Call") |
| [vitus.md](./vitus.md) | the creators' royalty token (1:1 with MV) |
| [gwat.md](./gwat.md) | 骨 — user-spawned sub-venues |

## The undeployed fringe

| doc | role |
|---|---|
| [encrypt.md](./encrypt.md) | the React-orbit stream cipher (10-day ephemerality) |
| [nym.md](./nym.md) | the acronym game "Champion" — incompatible with the deployed CHO (interface drift, probed onchain) |
| [cabs-market-machine.md](./cabs-market-machine.md) | Z-Machine-settled escrow + Folklore CPU |
| [db-manager.md](./db-manager.md) | the Mirage-Concepts relational engine + alchemy game |

Further fringe WITHOUT per-contract docs (see the origin corpus's data-layer
page, `../04-data-layer.md` — origin-only, not shipped in this package):
VirtualDisk (256-byte block
device), GasContract.yul (minimal-Yul ERC-20 study), RandomGenerator
(precomputed orbit + diyat gas tax), SolidityCreate2Factory (standard
CREATE2), ABILookupToken ("CL9" lookup, `execute_dc`/`run_command` hints —
an undeployed museum piece), std/ ALGOL 61 museum, strategies/ toy-language programs,
`domain/data/` 411 voxel-asset JSONs, `etc/DysnomiaSelfSnipe.sol`
(community snippet), lib/BesselSolver + lib/registry + lib/yai.sol.old.

## The function tables

Every `<!-- fntable -->` table is generated mechanically from the recovered
sources — signatures are never hand-transcribed. The generation tooling
does not ship with this portal.
