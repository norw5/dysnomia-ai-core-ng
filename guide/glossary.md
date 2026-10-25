# Glossary — the Dysnomia vocabulary

The names come from three interleaved systems: Greek (Eris/Dysnomia, the
moons of Saturn and Mars), Chinese dynastic and medical vocabulary, and
1960s computer-science terms. This table decodes what each term *means in
this system*; addresses are full-length on the entity pages and the
[hub](/dysnomia).

| term | meaning here |
|---|---|
| **Soul** | the `uint64` identity id every user is registered under in ZHENG |
| **SHA** | the cryptographic particle — a Fa-family state machine (base + exponent) a user or contract holds |
| **SHIO** | the channel between two SHAs; a token contract holding the conversation state |
| **LAU** (雷/倫) | the per-user account token; your handle as an ERC-20 |
| **VOID** | the shell/session layer over the kernel |
| **YI / ZHENG / ZHOU / YAU / YANG / SIU** | the wave-1 registry spine, each a token owning pieces of the layer below; ZHENG is the soul registry, SIU the user gate |
| **Bao** (包) | the universal entity record — account, channel, keys and current entropy pair `[src: include/bao.sol]` |
| **entropy** | the evolving numeric state every user and venue carries; the denominator of the derived statistics |
| **CHO** | the wave-2 hub: sessions, entropy, the coordinate lottery, the alias book, the privilege injector |
| **QING** (清) | a venue — chat room + micro-economy wrapped around any ERC-20 |
| **MAP / HECKE** | the venue factory and the meridian coordinate transform |
| **Phobos** | the first QING (the "Zürich QING"); the ladder's fixed reaction reference |
| **Fornax / Fomalhaute / Eris** | the three constellation SHIO channels created in the wave-1 constructors; the ladder's physics constants |
| **Tethys** | CHO's own SHIO channel — which *is* the CHO hub contract address, a label collision to remember |
| **Waat** | a venue's raw coordinate value on the meridian transform |
| **YUE** | the per-player vault/account token; earnings land in it, withdrawals need CHAN escrow consent |
| **CHAN** | the YUE directory + the consent (OptIn) escrow |
| **CHOA** (抄) | chat-to-mine: venue chat that pays a MAI bounty into your YUE |
| **CHEON** (天) | the settle primitive returning the current bars |
| **soeng / sky / tang** | the source-directory families: the physics ladder / the account layer / the settle layer |
| **QI / MAI / XIA / XIE / ZI / PANG** | the ladder rungs — energy, pulse, charge, leak, spin, push (Chinese-medicine concepts) |
| **RING / META** | the ladder's consumers: the moment recorder and the tile-parameter oracle |
| **Beat** | `META.Beat(waat)` — the oracle read returning (Dione, Charge, Deimos, Yeo), the territory-expansion inputs |
| **Yeo** | the tile-radius parameter Beat returns (deployed `Yeo/Chao` division — comes out Chao-scaled large) |
| **Yuan** | the purchasing-power modulus: `bal + 10×LAU + 40×YUE` |
| **DO** (搞) | the venue-claim deed layer (`Take(qing)` adds you as a QING owner) |
| **diyat** | the gas tax inside the random-generator helper, paid to the dev's LAU |
| **cap / meter** | a contract's lottery-drawn lifetime self-mint budget (`Random() % 111111`); at cap it keeps working, stops paying itself |
| **WITHOUT / RESTRAININGORDER** | the two ban tokens — any balance blocks hub entry and venue chat |
| **GWAT** (骨) | user-spawned sub-venues — designed, never deployed |
| **PKMinter** | the wave-7 bridge factory hardcoding the treasury minters; N-of-N ECDSA-signed first mints |
| **Xiao** | the shared math library slot — the MATH token on every system contract `[chain]` |
| **MotzkinPrime** | `953467954114363`, the field everything computes over; `2 × Meridians[0] + 5` — map geometry and crypto share it |

Undeployed-layer terms (WORLD, WAR, H2O, VITUS, ENCRYPT, NYM, VMREQ,
CABS, the database layer) are documented with their designed loops in the
[dev reference](/dysnomia/dev/) — each carries a NOT DEPLOYED banner
there.
