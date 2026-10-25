# harness/ — the anvil fork harness (session 39, HARNESS.md §1–§4)

Headless Python suites driving a shanghai-pinned PulseChain fork through the full
onboarding chain, asserting STATE DELTAS (never log presence), plus the app-side
mock-provider UI harness under `../app/e2e/`.

## Run

```
python3 harness/anvil_flows.py                # set 1: managed fork, starts anvil, runs, stops
python3 harness/anvil_flows_set2.py           # set 2: Beat floors + DSS + approval gates + deed/create (s10/11) + the YUE desk (s12) + identity/labels/book (s13)
python3 harness/anvil_flows_set3.py           # set 3 (session 58): the never-deployed world layer — verbatim creation-revert pins, the fixed stack, the Code→Faa→GWAT loop proof, the SIM overlay
python3 harness/anvil_flows.py --keep         # leave the fork up on :8545
python3 harness/anvil_flows.py --rpc http://127.0.0.1:8545   # target an existing fork
python3 harness/anvil_flows.py --fork-block <N> --fork-url <RPC>
```

### The manual testing kit (`manual_fork.py`, session-63 close)

One command sets up a pinned fork ON :8545 with a FUNDED wallet — anvil's own
dev accounts only hold ~10k PLS (dust at PLS prices), so the kit funds a
fresh (or `--key`-chosen) wallet to 1,000,000 PLS by default:

```
python3 harness/manual_fork.py                # fork + funded wallet, holds until Ctrl-C
python3 harness/manual_fork.py --onboard      # + the set-1 entry chain (LAU/Username/YUE/Play)
python3 harness/manual_fork.py --onboard --venue   # + a MockAsset venue (MAP.New + Join)
python3 harness/manual_fork.py --sim          # + the never-deployed layer AT the overlay
python3 harness/manual_fork.py --leave        # exit leaving anvil running (kill by PID later)
python3 harness/manual_fork.py --rpc http://127.0.0.1:8545   # attach (still funds/deploys)
```

Then `cd app && npm run dev` and open
`http://localhost:5173/?rpc=http://127.0.0.1:8545`; import the printed key
via SETTINGS → wallet → mode B. `--sim` deploys ENCRYPT + the fixed
WORLD/WAR pair + GWAT AT their `config/sim_addresses.json` addresses (the
runner's nonce-search deploys — the app and the runner see ONE layer) and
asserts the overlay equality + the Vitus/H2O children + VOID's ENCRYPT
registration. Verified in-box: the full `--sim --onboard --venue` run is
green in ~35s, forksmoke passes against the kept fork, and a wallet-mode-B
import renders the live identity column.

Requires: `pycryptodome`, `eth-account`, `eth-utils`, `eth-rlp` (present in this
box's python 3.14 env), foundry's anvil at `~/.foundry/bin/anvil`.

Run logs land in `harness/runs/run_<UTC>.json` (fork pin, per-step asserts, gas);
anvil stdout goes to `harness/runs/anvil.log`. The port-8545 squatter check runs
before every managed start (kill by PID, never `pkill -f anvil`).

## Fork pin policy

Pin a few thousand blocks below the LAGGARD of the three known RPC heads
(HARNESS.md §1). Session-41 measured heads aligned at 27,679,642 → pin
**27,674,000** (`DEFAULT_FORK_BLOCK`, overridable via `--fork-block` or
`DYS_FORK_BLOCK`; session-39/40 ran 27,666,000). Record the pin in every run
log; re-pin when the suite starts racing live traffic.

## Session-41 additions

- **`e2e/forksmoke.spec.ts`** (app): optional live-fork UI smoke — starts the
  pinned fork manually (`~/.foundry/bin/anvil --fork-url
  https://rpc.pulsechain.com --hardfork shanghai --fork-block-number 27674000
  --port 8545`), drives the IDENTITY view through the mock wallet (which
  forwards reads to the fork): Multicall3 PLS balance, discovery zeros, and the
  CREATE1-predicted LAU address. Self-skips when no fork answers on 8545. The
  full-identity variant (LAU+Username+YUE created on the fork via the Actor
  classes, then discovered by the UI) was run ad-hoc this session — both paths
  green; consider promoting it into the spec later.
- **Perimeter checksum fix**: 8 kb/config addresses carried wrong EIP-55 casing
  (VOID, LAUFactory, SHAFactory, ZHENG, ZHOU, LibAttribute, LibStrings,
  ReactionsLib) — the underlying hex was always right; the app's first viem
  send to LAUFactory surfaced it (`Address must match its checksum
  counterpart`). Both files fixed + `tools/dys_facts_json.py` regenerated.

## The flow (11 steps, all state-delta asserts)

| # | Step | Key deltas asserted |
|---|---|---|
| 0 | fork preflight | chain id 369 |
| 1 | `LAUFactory.New(name,sym)` | create1 precompute == eth_call preview; code at LAU; name/symbol; `owner(player)`; supply ≥ 1 unit |
| 2 | `LAU.Username(string)` | view REVERTS while unset (`AttributeNotFound`); reads back after |
| 3 | `SEI.Start(lau,name,sym)` | precompute == preview; `Chan.Yan(player)` 0→YUE; `YUE.Origin`; CHO entry `GetUserTokenAddress==lau` |
| 4 | `CHOA.Play(lau)` | CHOA at cap (mint no-op, `totalSupply == maxSupply*1e18`); first Play pays +1 YUE to origin |
| 5 | `MAP.New(mock asset)` | precompute == preview; `Waat`/`Asset`/rename; `MAP.GetQing(waat)`; HECKE `Compliment(waat)` → `GetMapQing(lat,lon)` roundtrip; player is staff-bouncer |
| 6 | `QING.Join(lau)` | QING supply +1e18 |
| 7 | `QING.Chat(lau,msg)` | supply +1e18; LogEvent decodes username+line |
| 8 | `CHOA.Chat(qing,msg)` | QING +1e18; CHOA stays at cap; CHOA→YUE reward delta recorded (buffer-dependent, informational) |
| 9 | **selector regression** | `(address,string)`=0xb340a780 pinned vs index; `(string)`=0x21516fc4 differs; eth_call AND tx with the stale form revert; supply unchanged |
| 10 | invariants | player VOID balance 0 (`VerifyUserTokenPermissions`); chain id; Yan + CHO entry intact |

Every call is encoded via `Canon.data()`, which asserts the computed keccak
selector against `abi/index.json` before sending — the s34 canonicalization
lesson encoded structurally. Addresses come only from `config/addresses.json`.

Gas observed at pin 27,666,000: New LAU 10.92M · SEI.Start 2.86M · CHOA.Play
424k · MAP.New 3.02M · CHOA.Chat 708k.

## Flow set 2 (sessions 40+50+51+52+53, 14 steps — `anvil_flows_set2.py`)

| # | Step | Key asserts |
|---|---|---|
| 0 | preflight + selector pins | chain 369; hand-encoded ERC-20 selectors (Ⓐ is IAlchemicalGold in the index — burn/mint only) |
| 1 | onboarding-lite | LAU → Username → YUE → Play (sets user Entropy) |
| 2 | venue | MockAsset + MAP.New (fresh QING + Waat); stores the asset for s12 |
| 3 | whale funding | Ⓐ + Fornax→LAU + CHO→wallet/LAU from probed whales (deployer EOA is the originMint whale: Ⓐ 345k, Fornax 304) |
| 4 | Ⓐ-bridge mechanics | QING.Purchase(AFFECTION) reverts MarketRateNotFound; CHO.AddContractOwner→AddMarketRate→Purchase→transfer-to-LAU gives Yuan(qing)=11e18; unfunded Beat panic shown too (the s5 fresh-caller floor, funding-independent) |
| 5 | Beat DRYRUN pin | the probe caller panics 0x12 at META's own SECOND division (the `Yeo` line; `Charge1*Charge/Iota1` passes — depth-1 trace); PANG.Push layer works; reproducible at pins 24M/25M/27.66M on fresh + established venues |
| 6 | Beat tx | reverts (status 0) with gas 1.93M — inside the census envelope (median 1,916,016) |
| 7 | DSS | as-shipped gist byte-pin + its init-order bug (chatAndSnipe reverts at 0x0); DSSFixed (one-line patch) byte-pin + exact-amount approve (never MaxUint) + snipe deltas (LAU +1, Ⓐ -1) |
| 8 | approval gates + fallback | spent-allowance snipe reverts; unapproved Purchase reverts; plain-chat fallback mints 1 LAU, costs no Ⓐ |
| 9 | **CHEON.Su settle (session-50)** | the settle verb works for the onboarded caller (status 1 ×2); the pure DRYRUN's decoded (Charge, Hypobar, Epibar) EQUALS the post-send YUE.Bar (Su returns the post state; quiet fork — no interleaving callers); bars advance monotonically across settles (observed epi 0→14,231,926→15,758,184, hyp stayed 0 — Omicron-only for this caller); CHEON is at cap so the meter is a guarded no-op (supply unchanged, kb §5) |
| 10 | **DO.Take deed (session-51)** | the gate keys on the WRAPPED ASSET (fork+disassembly): Take on a MockAsset venue (answers neither `owner(address)` nor `Creator()`) REVERTS raw; a venue wrapping the player's own LAU is the eligible branch — owner(player) flips false→true, exactly 1e18 DO mints to the USER TOKEN (the LAU), supply +1e18; a second Take lands status 1 as a SILENT NO-OP (no re-mint, no supply move) |
| 11 | **MAP.New late-revert + Qu-claim (session-51)** | EvilAsset (name()/symbol() staticcall-succeed with EMPTY returndata) forces New's rename decode to revert AFTER the CHO.Luo() draw; `CHO.Qu(de0) == 0x0` after the reverted New (the claim ROLLS BACK with the tx — the kb "permanent Qu scar" claim retracted); the retry (fresh good asset, quiet fork) re-draws and re-claims the SAME De — `waat3 == de0 × Meridians[0]`, `Qu(de0) == MAP`, GetQing index whole |
| 12 | **YUE Hong/Hung desk + Ⓐ Redeem leg (session-52)** | GetAssetRate == 0 before a posted rate and Hong reverts `ExchangeRateNotFound` (0x464460b9); non-ancestor spend asset reverts `InvalidPair` (0xd9a764d9); after AddMarketRate(asset, 1e18) the DIRECT pair's GetAssetRate == the POSTED rate EXACTLY (the 777-mod attenuation divides a ZERO accumulator on hop one — chained routes only); **the funding story fork-corrected: BOTH legs pay from the VAULT'S OWN inventory** (Hong: asset player→YUE in, qing YUE→player out — the venue's self-escrow UNTOUCHED; Hung: qing player→YUE in, asset YUE→player out); unapproved Hung reverts (the base transferFrom reverts internally — yue.sol's "Need Approved" requires are UNREACHABLE); the base `QING.Redeem(AFFECTION, 1e18)` is PUBLIC, needs a venue-token allowance with spender == THE VENUE ITSELF, and pays 1e18 Ⓐ from the venue's Ⓐ escrow (what s4's Purchase deposited) — the exact Purchase reverse |
| 13 | **identity enrichment + pocket sweep + label semantics + the CHO book walk (session-53)** | `On().Phi == address(On().Shio)` (the Bao's entity key IS the channel — 05_zheng.sol Mau); `Saat[2] == SIU.Aura()` simulated from the creating wallet (the fingerprint pin); `LAU.Withdraw` moves the pocket out unmetered (LAU supply unchanged); **VOID's session table is MSG.SENDER-keyed** — the entry is written by `Enter` called from the LAU constructor, so the session lives AT THE LAU (labels read/write through the LAU: its onlyOwners wrapper passes tx.origin and delegates with msg.sender=LAU); the `Alias(address)` VIEW has NO session gate (an unentered sender reads the soul-0 grades → `AliasNotFound`, NOT NoUserEntry — that error lives only on the WRITE); unset label reverts `AliasNotFound` (the failure IS the answer); the CHO book walk: 103 live entries at the pin (kb/dev's "~90" is census drift), all resolvable, fits the app's 160 probe bound |

Session-50 gotcha encoded in step 9: the Eta fresh-caller floor does NOT apply
to Su — Su's chain is ReactYue (XIE.Power) + MAI.React + YueMintToOrigin, no
RING.Eta division; the floors that DO matter are the YUE itself (Sei.Chi →
NotStarted) and Yue.React's ZeroHoldings (the caller must hold their own YUE
tokens — the SEI.Start origin mint to tx.origin covers it).

Session-51 gotchas encoded in steps 10/11: (a) DO.Take's eligibility probes
run on the WRAPPED ASSET — `qing.Asset()` → `CHO.GetUserTokenAddress(origin)`
→ `CHO.has(asset,"Creator()")` → `asset.owner(origin)`; a plain-ERC20 asset
without `owner(address)`/`Creator()` makes Take REVERT with the callee's
EMPTY revert data (it bubbles — deceptively like a generic failure), while
an asset that answers `owner(address)` with false makes Take a SILENT NO-OP
(status 1, nothing happens, gas spent — a green DRYRUN/estimate proves
NOTHING about deed eligibility). (b) The Qu-claim leak story: EVM revert
semantics roll back `CHO.Luo()`'s claim with the tx — verified by previewing
the next De via pure `eth_call` (Luo is owners-gated: read it `from` MAP),
forcing the late revert, then reading `Qu(de0)`; the quiet-fork retry
re-draws the SAME De because the entropy advance rolled back too.

Session-52 gotchas encoded in step 12: (a) the YUE desk funding story — every
transfer inside `Hong`/`Hung` is called BY the YUE, so `transfer` moves the
YUE's OWN balance: the first draft assumed the venue's self-escrow pays the
Hong leg and the FORK REFUTED IT (`DysnomiaInsufficientBalance` names
`from == the YUE, what == the venue` when the vault's pot is empty) — the
vault is the counterparty on BOTH legs, and the venue's escrow only matters
for the BASE Purchase/Redeem called ON the venue. (b) The base Redeem's
prerequisite is a venue-token allowance whose spender is THE VENUE ADDRESS
(`DYSNOMIA(address(this)).transferFrom`) — not an Ⓐ allowance. (c) A venue
with no posted rate for its OWN wrapped asset gives GetAssetRate 0 →
`ExchangeRateNotFound`; the Ⓐ rate (GetMarketRate(AFFECTION)) and the asset
rate are DIFFERENT rows of the same map.

Session-53 gotchas encoded in step 13: (a) VOID's `_activeUsers` session
table is keyed by **msg.sender**, and the entry is written by `Enter` — which
the LAU constructor calls — so the session lives AT THE LAU CONTRACT, never
at the wallet. Any VOID attribute/alias read must be simulated `from` the
LAU (or go through the LAU's onlyOwners wrapper, which passes tx.origin and
delegates with msg.sender=LAU); the harness wallet (anvil key #0, a
historical chain address) even carries its OWN session on the fork — a
wallet-sender probe can pass for reasons that have nothing to do with the
player's LAU. (b) The `Alias(address)` VIEW has no session gate of its own:
it passes `_activeUsers[msg.sender]` (zero for unentered senders) straight
to the lib, so unentered reads hit the SOUL-0 grade store and revert
`AliasNotFound` — `NoUserEntry` fires only on the WRITE overloads. (c) The
CHO book walk found **103** entries at the pin — kb/dev/cho.md's "~90" is
census drift (the A3 record-only class), and the app's fixed 160 probe
bound still holds with margin.

## Flow set 3 (session 58 + 59, 15 steps — `anvil_flows_set3.py`, port 8546)

| # | Step | Key asserts |
|---|---|---|
| 0 | preflight | chain 369; `sync_sources.py` manifest verify + the ten fixture pins present |
| 1 | player + venue | LAU→Username→YUE→Play-lite + MockAsset venue + **venue funding**: Eris (the Charge base) AND CHO (the Dione numerator) from the deployer |
| 2 | the aged caller | fresh-player Eta floor pinned `(14,0,0,0)`; mariarahel (the deployer EOA) has nonzero slots + YUE + LAU; **Phi-Fomalhaute funding** (the XIA.Charge modulus reads Fomalhaute AT the caller's channel key, not the wallet); the Ⓐ bridge onto the venue (AddContractOwner→rate→approve→Purchase→LAU) so the caller's venue-token Yuan > 0 |
| 3 | verbatim creation-revert pins | verbatim WORLD + WAR creations REVERT BARE (the under-construction ctor callback — the wave-5 failure); ENCRYPT deploys clean (VOID is live) + byte-pinned |
| 4 | the fixed stack | WORLDFIXED→WARFIXED→verbatim GWAT (byte-pinned); VITUS/H2O deployed inside |
| 5 | WORLD wiring | getters == config; lottery cap < 111111; 4 rates; VITUS seeded 1:1 with the LIVE MV totalSupply; CHAN ownership |
| 6 | WAR wiring | H2O seeded 1:1 with the LIVE Call totalSupply; CO₂==0; both CHAN ownerships (incl. the relocated H2O one) |
| 7 | ENCRYPT registration | `VOID.GetLibraryAddress("encrypt") == deployed` |
| 8 | spawn-gate honesty | pre-claim Faa==0 (CO₂/H₂O unchanged) + Gwat reverts SpawningFailure — the errors the SIM frontend renders |
| 9 | the loop proof | Code at the anchor (SWAPPED coords — Code's "Latitude" is Compliment's first word) → Buzz credit + VITUS to the caller's YUE + **Tail>0 (the cauda fix)** + the OutOfRange pin (a far tile — Yeo GROWS with Moments); Faa draw + CO₂/H₂O advance; venue pumped past the **777-token rate cap** (`AddMarketRate` caps at totalSupply/777 — TokenMaximumRate 0xf4ccbd00); GWAT spawn + "<user>'s <asset> GWAT" rename + full-supply ownership (+ ctor originMint ≤ cap/10) + CHO cross-ownership + the GWAT tile map |
| 10 | the VITUS exit pin | OptIn lands; **the exit is DEAD**: `YUE.hasMint` staticcalls the spaced selector `"Mint(address, uint256)"` (0x7a2dd71a) that nothing answers → Withdraw reverts OnlyGameTokens for EVERY asset — recorded normatively in kb §4 |
| 11 | **ENCRYPT two-party round trip (session-59)** | alice→bob Encrypt/Decrypt round-trips EXACTLY (the keystream is a DETERMINISTIC modexp orbit — preview index == committed, Decrypt preview == plaintext); one string-Encrypt meters +4 units (string → bytes → Crypt + hashKey each `_mintToCap`); the party gates read the SHIO owners MAP — a third EOA encrypting AS alice and ALICE decrypting her own note both revert NotParty (Encrypt keys FROM-side, Decrypt TO-side; SHIOFactory adds tx.origin at birth — that's who passes); **the index is NOT pair-bound**: a swapped-pair decrypt from a TO-owner answers XOR GARBAGE, not a revert |
| 12 | **ENCRYPT expiry + Prune (session-59)** | past 10 days the expired entry decrypts ONCE more (delete-after-read) then answers empty; **Prune's wrong-key-domain defect**: it iterates `_encryptions[ARRAY POSITION]` while entries live at KEYSTREAM indexes — live AND expired entries stay decryptable post-Prune (it mangles only the private enumeration) |
| 13 | SIM overlay | the six layer addresses == config/sim_addresses.json (written on first run; deterministic CREATE1 from the deployer at the pin) |
| 14 | invariants | everything still deployed; the failed verbatim create left no code |

Session-58 gotchas (set 3 + the fixture build):

- **forge build spins** in this box (first run 90s, later runs 98% CPU
  forever, SIGTERM-immune). `fixtures/world-layer/build.py` drives the svm
  solc binary DIRECTLY (`~/.local/share/svm/0.8.21/solc-0.8.21`) with the
  pinned flags; the suite never compiles (the manifest + pins are the drift
  guards). After any tree change: `sync_sources.py --resync --sync` then
  `build.py`.
- **solc is SIGTERM-immune** mid-optimization — always wrap builds in
  `timeout -s KILL`.
- **The verbatim layer is undeployable** (the ctor callback class — three
  separate instances: VITUS→WORLD.Xiao()/World.Cheon(), H2O→WAR.Xiao()/
  War.World(), and WORLD's own `Vitus.Mint(address(this),1)` whose overflow
  check reads World.Map()). The `// FIX:`-marked fixtures pass live
  addresses as ctor params instead.
- **A fresh caller cannot be aged on demand**: 6×CHEON.Su + CHOA.Play +
  funding the caller's Phi with Fomalhaute/Fornax all leave Eta at
  (14,0,0,0) — the accumulators are per-Soul HISTORY. The recipe is
  impersonating an aged live player (mariarahel = the deployer EOA, Eta
  (14, 2.67e15, 50653, 50653)); Yuan/charge prerequisites are fundable,
  lineage is not.
- **A crediting Code needs the FULL stack**: venue Eris (Charge base) +
  venue CHO (Dione) + caller's Phi-Fomalhaute (the modExp modulus) +
  caller's venue-token Yuan (the Deimos weight — the Ⓐ bridge onto the
  venue, tokens parked in the LAU for the 10× weight) + aged lineage.
  Charge==0 ⇒ silent no-op (status 1, nothing happens).
- **anvil default key #0 / historical wallets carry their OWN VOID
  sessions** (the s13 warning, now also observed for ladder lineage) —
  always probe from the account you mean.

Session-59 gotchas (set-3 steps 11–12, the ENCRYPT pins):

- **`toFunctionSelector`-class gotcha (test-side)**: passing an ABI ARRAY
  computes a garbage selector (it stringifies the array) — always pass the
  single FRAGMENT. Found in the simTools selector pin test.
- **Object.assign flattens getters** (the s56 lesson, rediscovered): the
  fake-ctx dry-run counter must be a READER FUNCTION, not a getter.
- The ENCRYPT party gates read the SHIO owners MAP (view `owner(address)`)
  — SHIOFactory.New adds TX.ORIGIN to every SHIO, so the wallet that
  created the LAU passes; the modifier's tx.origin leg is irrelevant. The
  aged caller is NOT needed for ENCRYPT flows (no ladder lineage).
- The ENCRYPT keystream is DETERMINISTIC (SHA.React is pure modexp over the
  per-SHA Channel constant): DRYRUN preview index == committed index, and
  the Decrypt preview == the exact plaintext. The only divergent state is
  entry deletion (expiry).
- **Prune's wrong key domain**: `_encryptions` is keyed by KEYSTREAM INDEX
  (the returned uint64) but Prune iterates ARRAY POSITIONS — it removes
  nothing real; live and expired entries stay decryptable.

## The multi-agent runner (session 60 skeleton → 61 FIRST CONTACT — `agent_runner.py`, port 8547)

The headless 2-agent ENCRYPT round-trip, green **12/12 at the pin**: one
managed fork → N fresh burner agents onboarded through THE SET-1 ORDER →
the ENCRYPT fixture deployed AT the overlay address (the layer has no code
at the pin — the runner SEARCHES the deployer nonce whose CREATE1 ==
`config/sim_addresses.json` from the pin nonce, `anvil_setNonce` +
impersonated byte-pinned deploy; found nonce 722) → two DRIVE ROUNDS
through the headless TS runner (`harness/runner/entry.mjs`, built by
`cd app && npm run runner:build` — the SAME graph/tools/gate the app
uses; the approval card answered by the RECORDED policy block, never a
bypass; the model SCRIPTED at the fetch boundary for determinism, live
runs use the env key) → the §7.4 fence assert (the venue LogEvent tail
sees B's open hail; NO cipher plaintext ever hits a chat channel) → the
four-pillar fleet score (node `score` mode composes through
`app/src/chain/fleetScore.ts` — the ONE math — python asserts). Outputs
in `runs/first_contact_<ts>/`: the RECORDING (the 62 replay input), the
fleet manifest, the score rows.

Fork findings paid this session (all asserted in the run):

- **Decrypt does NOT consume live entries** — deletion keys on EXPIRY, not
  on read (`encrypt.sol:121`); a live note re-decrypts to the exact
  plaintext for its whole 10-day life. The 59 "delete-after-read" pin is
  the EXPIRED case (still correct — don't generalize it).
- **One string-Decrypt meters +4 units** (string→bytes→Crypt+hashKey, the
  same quadruple chain as Encrypt).
- **Cipher-tool SEND results must stay LEAN**: the DYSNOMIA mint fan-out
  (~14 royalty receivers per call) makes `movements` bulky enough to trip
  the 2560-char tool cap, truncating `status`/`index` out of RECORDED
  results — and the fleet score reads those. Notes ride the DRYRUN; leg
  fields go FIRST in the SEND object; `legField` (TS) / `rfield` (python)
  read either the structured shape or the truncated head's prefix.

The session-60 skeleton finding still stands: the `Username` attribute
carries a **12-byte cap** (`addAttribute("Username", 12)` in
`contracts/src/lib/attribute.sol`; `MaximumLength(string,uint256,uint8)` =
`0xf14029c2` reverts past it) — a 16-char handle fails onboarding;
`agent-NN` fits.

The session-60 skeleton (fleet spawn + manifest, `--agents N` without
`--first-contact`) remains the plain onboarding path; the manifest carries
the roster (address/LAU/YUE/vessel/ephemeral key — local-fork burners
only), the L2 policy knobs mirrored, and the 62 wiring notes (harbormaster
NPC-seeding for the territorial game, the observer channel).


## THE FLAGSHIP (session 62) — `agent_runner.py --flagship`, port 8547

The decided demo, green **13/13 at the pin**: the fixed 4-vessel roster —
VITRUV-3/ARCHITECT + KESTREL-7/TRADER (the cipher coalition) vs
MERIDIAN-5/DIPLOMAT + PARALLAX-2/SCIENTIST (the solos) — with asymmetric
personas + per-agent TOOL SUBSETS (the drive plan's roster row `tools`
array; the ctx allowlist binds at the advertised specs AND the execute
seam — the catalog untouched). The run: the whole fixed stack deployed AT
THE OVERLAY addresses (per-contract CREATE1 nonce searches anchored at the
pin nonce — the SIM tools resolve everything through `simAddr`) → the NPC
parent venue (mock asset, Eris+CHO, the CHO ownership bridge + Ⓐ market
rate, the ≥777 pump) → NPC AGING (the aged-caller prereq stack + THE
CAUDA claim opening the Faa/Gwat gate; PARALLAX's deed stage wrapping the
agent's own LAU; KESTREL's Ⓐ seed + exact-amount approve) → THREE scored
rounds (contact / the game / endgame) with a score snapshot composed onto
the recording after EVERY drive invocation (the final snapshot = the
frozen board) → the §7.4 fence + the frozen four-pillar asserts (the
coalition 2 two-way diplomatic points each; VITRUV's GWAT; PARALLAX's
deed + received settle/attendance; honest zeros) + per-agent token meters
from the usage events.

The intercept game (the owner round: orchestrator-fed intel): between
rounds the orchestrator scans the anchor venue's LogEvent tail and feeds
the solos CLEARLY-LABELED untrusted intel; the fence assert proves the
cipher plaintexts never appear on-chain.

Fork findings paid this session (all asserted in the run; HARNESS.md §7
carries the details):

- **The GWAT spawn is CHO-owner-gated** — `Cho().addOwner(Mu)`
  (07_gwat.sol:52) + `MultiOwnable._checkOwner`: verbatim only CHO owners
  (tx.origin) can spawn; GWAT's ctor never registers itself. The
  harbormaster completes the registration per-fork (`CHO.addOwner(GWAT)`)
  so fresh souls can play. kb/dev/gwat.md carries the marked correction.
- **A draw that dies at the DRYRUN consumes nothing** — identical retries
  redraw the SAME failure; a mined block refreshes the draw (the
  harbormaster's own Gwat attempt between retries).
- **The pin's gas price ≈ 5e14 wei** — NPC actors need agent-scale
  funding (50k+ PLS) or even a mock deploy goes insufficient-funds.
- **The headless approve-on-Ⓐ leg classifies unknown-method** (the 56
  law) which the recorded policy ALWAYS refuses — desk prerequisites ride
  the priming; the purchase lands single-leg.

### The grid capture (the share artifact — 62.1 rework)

```bash
python3 harness/agent_runner.py --flagship --keep       # or --solo-demo --keep
node harness/grid_capture.mjs --recording harness/runs/<run>/recording.json \
     --manifest  harness/runs/<run>/fleet_manifest.json \
     [--rpc http://127.0.0.1:8547] [--seconds 150] [--speed 1] [--width 1600] [--height 1000]
# → harness/runs/grid_<ts>/grid.mp4 (2×2) — or solo.mp4 when the recording's roster is ONE agent
```

One observer per RECORDING ROSTER VESSEL (`?rpc=<fork> ?vessel=<id>`),
each importing its roster agent's LOCAL-FORK key (wallet mode B — the
identity pane + snapshot widget render that agent's live onchain state),
seeding a MINIMAL deck (the pinned scoreboard), loading the recording,
arming the replay with the PER-AGENT transcript filter, and playing at
the narrative clock (1× default). The dev server is spawned when
`--dev-url` (default http://127.0.0.1:5173) is not answering; a dead
fork still captures — the scoreboard falls back to the recording's own
snapshots honestly.

The in-app replay flagship (the same recording): load on the deck's
`fleet_score` widget → `replay` arms the deck-level transport (seek +
play/pause + ½/1/2/4× + the spine readout + per-agent filter chips) —
backward seeks clear the auto fold and re-feed the prefix; the AI_CORE
pane renders the REPLAYED conversation (vessel-colored turn markers,
tool cards, the ▸ plan strips) while replay is armed; the scoreboard
renders snapshots AS OF the playhead.

### The solo verification demo (62.1) — `agent_runner.py --solo-demo`

The demo-machinery gate (the owner round: verify ONE agent before
re-recording the grid), green **5/5 at the pin**: ONE burner wallet,
funds only — the scripted model drives `get_state → create_lau`; the
REGISTRAR (orchestrator sends from the agent's own key, the exact set-1
order) completes Username + SEI.Start + CHOA.Play; then the agent reads
its landed identity, surveys the anchor, and speaks once in the open.
**The finding (HARNESS.md §7):** LAU registration is Play-gated
(`CHOA.Play` → `Cho().Enter`, choa.sol:35) and Play itself needs
Username AND a YUE — no tool-only onboarding path exists; the app's
guided chain has the same closed cycle (POLISH-BACKLOG).

### The demo videos (session 69) — `demo_capture.mjs`

```bash
node harness/demo_capture.mjs --take both        # or --take guided | --take fullauto
# → harness/runs/demo69_<take>_<ts>/{video.mp4, transcript.txt, source.webm}
```

Records the two owner-called demo videos LIVE from the headless browser
(playwright `recordVideo`, 1920×1200, default amber, the default model,
CORE stream only — no replay machinery). The script spawns
`manual_fork.py` ITSELF per take (`-u` — python block-buffers piped
stdout; own process group; SIGINT stops anvil through the python parent;
fresh fork per take). The `guided` take (video 1): bare fork, mode C +
breadth + §7.4 opt-in, the onboarding widget's SPECIFIED handoff, then
one explicit prompt per beat (home QING → settle → focus_map → the DSS
deploy + `dss_snipe` → journal_note); Ⓐ is primed via the forksmoke whale
impersonation. The `fullauto` take (video 2): `--aged-transfer` fork,
caps armed via SETTINGS (backstop 4 · session cap 1M · raised per-run
budget), FULL-AUTO + a whisper steering cycle 1 to the Beat at Phobos,
the wall-clock net clicking the CLEAN DISENGAGE button (never STOP). The
approval-card auto-confirmer (~1.2s SEEN) + the plan auto-approver
(~1.6s) run for the whole take. `video.saveAs` after `ctx.close()` (a
plain `path()` races the flush) then ffmpeg webm→mp4. Live takes are
nondeterministic — re-run the take; a failed take usually means a PRODUCT
gap (69's two: the two-leg dss_snipe DRYRUN + the get_state
snapshot-window lie), fix the app, not the script.

## Gotchas paid this session (add to your instincts)

- **`encode()` returns BARE hex** — `sel + encode(...)[2:]` silently corrupts
  calldata (shifts every word 2 nibbles); the failure surfaces as weird
  empty-data reverts two steps later. Hand-encoding = `sel + encode(...)`.
- **Beat: fresh-caller floor (RESOLVED with owner-provided txs)**: Beat WORKS —
  three successful txs replay green at their blocks and at the pin, including
  on a zero-history fresh venue. Fresh harness callers panic 0x12 because the
  deployed third-revision `RING.Eta()` returns `(14,0,0,0)` for them (Eta is
  NON-VIEW in the tree: `Chao = Yue.React(Phobos)` — a caller-vault reactor
  step + per-Soul Moments accumulator); Beat divides by an Eta slot. Aged
  callers get nonzero slots → success, Yeo rounds to 0 early ("Yeo is always
  0 on your first Beat" — owner lore, now mechanistically explained). Fork
  recipe: impersonate an aged caller for Beat flows. RETRACTED earlier
  session-40 claims: "wedged" (rested on a log-scan blind to successful Beats
  — they emit no META-address events) and the "double Yuan floor" (a
  zero-Yuan caller Beats fine with all-zero outputs).
- **Yuan floors are NOT revert gates**: an aged caller beating a venue whose
  tokens they hold zero of succeeds (all-zero outputs). Yuan weights still
  matter for output magnitudes, not for reverting.
- **Fresh QINGs have NO market rates** (v2 base constructor adds none) — the Ⓐ
  bridge needs an owner's AddMarketRate(AFFECTION, 1e18) first. Phobos has no
  rates AT ALL (its 457-token buffer is unpurchasable). Only CHO owns a fresh
  venue (MAP.New adds CHO, not the creator) — route via
  CHO.AddContractOwner (fork-legal via deployer impersonation; that's the
  admin move that rated live venues).
- **The as-shipped DSS gist is broken**: `ILAU LAUContract = ILAU(LAUAddress)`
  binds 0x0 at declaration (initializers run before the constructor body);
  chatAndSnipe/chat revert calling 0x0. Fix = bind in the constructor. Both
  fixtures byte-pin (dss = as-shipped, dss-fixed = patched) and the flow
  asserts BOTH behaviors.
- **RING.Eta is tx.origin-sensitive**: with no `from` it reverts a custom
  error (0x12efd467); always call it from a player. Its output reproduces the
  kb §2 third-revision sample (14, 7973995094115691, 50653, 69343957).
- **anvil default tracing**: `debug_traceCall` works (structLogs) but rejects
  `tracer`/extra fields — pass an empty opts object; zero-divisor DIVs inside
  modExp internals are benign (EVM DIV returns 0); the Panic origin is where
  `0x4e487b71` is first PUSHED.
- maxSupply is whole-token units vs wei totalSupply (session-39 lesson) still
  bites in new flows — scale by 1e18 before comparing.

## Session-43 additions

- Ad-hoc fork probe validated the venue-panel read path against REAL venues
  (Ozymandias + Phobos) at the pin: Waat round-trips the render seed exactly;
  Entropy/supply/BouncerDivisor decode; aged v1-era venues carry a KNOWN Ⓐ
  market rate of 0 (rate-0 is a real state, distinct from the fresh-venue
  MarketRateNotFound revert).
- **Eta no-lineage floor**: a caller with NO vault at all makes the
  simulated `RING.Eta()` revert `0x12efd467(sender)` — BELOW the (14,0,0,0)
  fresh state. Three readiness states now (no-vault revert → fresh zeros →
  aged nonzero); kb §3 amended; the venue panel renders all three.
- **Old QingMap −2° south-flip quirk**: the predecessor's flipped-row
  fraction formula (`(posInBand/bandWidth)*2−1`) shifts all 468 south venues
  half a band versus the s32 atlas; `tools/dys_venue_render.py` ships the
  atlas convention (`longitude/band_half_width` for BOTH flip states,
  verified 917/917).
- **aggregate3 return shape on this fork**: the observed eth_call return had
  NO leading blockNumber word (elements-only array). viem's multicall
  decoded it fine in the app; hand-rolled decoders (the ad-hoc probe) must
  check, not assume the canonical shape.
- Hand-ABI-encoding aggregate3 in python: the `(address,bool,bytes)[]`
  elements are DYNAMIC — each needs an offset word to its tuple body; and
  inside each result tuple the `bytes` offset is relative to the TUPLE
  start. (The probe's first two encoders got both wrong — kept here as the
  instinct entry.)
- **Impersonated `eth_sendTransaction` can gas-starve (session-70)**: an
  anvil impersonation send WITHOUT an explicit `gas` may mine a tx with a
  tiny default (~24k) that reverts with EMPTY data — cheap staticcalls
  (MAP's `has()` Waat probes) fit, the first real CALL (`Cho.Luo()` draw)
  does not. Looks exactly like a contract gate; it is OOG. Always set
  `gas` explicitly on impersonated sends (the forksmoke session-70 row
  pins the pattern with `gas: 0x300000`).
- **Fork venues replay LIVE addresses (session-70)**: a venue's address
  derives from MAP's CREATE nonce, so the Nth `MAP.New` on a pinned fork
  lands at the live chain's Nth venue address until the fork out-creates
  the live chain's post-pin slots. With the venue seed regenerated to live
  head, the first post-pin fork creates are seed-covered (the app's dedupe
  correctly drops them); a beyond-live-nonce create is the honest
  catch-up test (forksmoke session-70 creates two to get past the two
  live post-pin slots).

## Gotchas from session 39

- **`maxSupply` is whole-token units, `totalSupply` is wei** — comparing them
  directly false-fails; scale by 1e18.
- **The ladder is AT CAP**: `_mintToCap()` on CHOA (and every capped token)
  mints nothing. Assert at-cap (supply == cap) instead of phantom +1 deltas.
- **Unset Username REVERTS** (`AttributeNotFound(string)`, deployed
  LibAttribute) — not an empty string. `CHO.Enter` (hence `SEI.Start`,
  `CHOA.Play`, `QING.Join`) reads Username and fails while unset → Username must
  precede Start in onboarding (matches kb §4 gates).
- **Username max length 12** (`addAttribute("Username", 12)` →
  `MaximumLength(string,uint256,uint8)` revert).
- **Fork `eth_gasPrice` ≈ 6.5e15 wei** (~6.5k gwei) — a 3M-gas tx costs ~20 PLS
  of gas alone; fund burners with ≥1M PLS on forks.
- eth-account requires **checksummed** `to`; viem/cast accept lowercase —
  mixed tooling, normalize at the boundary.
- solc-linked bytecode hex from forge output may carry a `0x` prefix — strip
  before re-prefixing (double `0x0x…` is an invalid hex string error).

## Fixtures

`fixtures/world-layer/` (session 58) — the never-deployed layer compile:
`sync_sources.py` copies `contracts/src` (NYM excluded — pre-move imports +
live-CHO incompatibility) behind a sha256 manifest, `build.py` compiles the
six verbatim contracts + the `world_fixed`/`war_fixed` pair with the DIRECT
svm solc at the pinned config, `pins/*.hex` carry creation+runtime bytes
(the suite byte-asserts every deployed runtime), and `src/domain/
world_fixed.sol` + `src/domain/dan/war_fixed.sol` hold the `// FIX:`-marked
variants (the ctor-callback class + the one-line cauda write). The
fixture-root `addresses.sol` pins the five constants the tree references
(AFFECTION/CROWS/WITHOUT from config; WMContract/CallContract from kb/dev).

`fixtures/MockAsset.sol` + `foundry.toml` — the minimal integrative ERC-20
deployed by set-1 step 5 / set-2 step 2 (has name/symbol so `MAP.New` renames
the QING; has NO `Waat()`/`owner()` so the guarded branches skip; unknown
selectors revert, which `MAP.has()` probing requires).
`mock_asset.{creation,runtime}.hex` are the compiled artifacts (solc 0.8.21,
shanghai, opt 200 — the pinned config): regenerate with `forge build` inside
`fixtures/`. The suites assert the deployed runtime matches
`mock_asset.runtime.hex` byte-for-byte.

`fixtures/evil-asset/` — `EvilAsset.sol` (own `foundry.toml`, same pinned
solc config): `name()`/`symbol()` SUCCEED as staticcalls but return EMPTY
returndata (`assembly { return(0,0) }`), so `MAP.has()` probing sees them
while New's high-level rename decode reverts — the forced LATE revert
(after the CHO.Luo draw) for set-2 step 11. `evil_asset.{creation,runtime}.hex`
pin the artifacts; the runtime is byte-asserted.

`fixtures/dss/` — the as-shipped `contracts/src/etc/DysnomiaSelfSnipe.sol`
(solidity ^0.8.2) with a fixture-local `addresses.sol` (only
`AFFECTIONContract`, pinned to config/addresses.json — the repo tree does not
ship `contracts/addresses.sol`). `dss.{creation,runtime}.hex` pin the
as-shipped bytecode, including its init-order bug (see gotchas).

`fixtures/dss-fixed/` — the same contract with the one-line fix
(`LAUContract = ILAU(UserToken)` in the constructor). `dss_fixed.*.hex` pin
the patched bytecode that validates the documented chatAndSnipe semantics.

Deploying mocks on a FORK is harness-only convenience — the live chain is
untouched (deployed-semantics rule), and the flows assert system state, not
mock internals.

## UI typing probe (session-77; UI-only, no fork)

`node harness/ui_probe.mjs [--url http://127.0.0.1:5173] [--rpc <url>]` —
the reproducible version of the session-77 owner-lag probe. It opens the
real app (the dev server must already be running; `cd app && npm run dev`),
enables the §7.4 chat composer inside the probe context only, waits for the
render-all corpus, then drives CDP key events with `autoRepeat` while a
Long Task observer + rAF loop records the main thread. It reports the
agent input, the chat composer in IRC + RICH, and the native search. Use
`--rpc http://127.0.0.1:8545` (or any dead URL) to isolate typing from
live background work; RICH runs can still include the bounded timestamp
batches (~50ms) while the corpus warms — compare same-machine settled
runs, not absolutes. The session-77 baseline is in docs/SESSION-LOG.md.

## UI review screenshots (session-78; UI-only, no fork)

`node harness/ui78_shots.mjs --tag before|after [--url ...]` — the
before/after evidence tool for the UI rounds. It opens the app on the dead
RPC, cycles every module at 1920×1200, 1600×1000 and 430×900, and writes
the view screenshots plus full-element STUDIO and MAP-stage captures to
`harness/runs/ui78_evidence_20261025_<tag>/` (gitignored). It also clicks
LEARN's `learn-source-dev` when present and captures the dev reference.
The session-78 evidence is in `docs/SESSION-LOG.md`; use `--url` when the
dev server is not on 5173.
