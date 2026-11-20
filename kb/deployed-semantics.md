# Deployed-Semantics KB — Dysnomia Terminal ng

> The distilled, normative knowledge base for the reimplementation. Everything here is
> **deployed-system semantics** — the April-direction runtimes actually live on
> PulseChain — unless explicitly marked otherwise. Provenance: `[src]` = the recovered
> source tree (`contracts/` in this package), `[chain]` = onchain-verified during the
> Atropa-terminal research sessions, `[ext]` = external/unverified. This file is the
> SOURCE for the agent's core rules and the app's inline education; if a claim is not
> in here (or in the guide/), the app should not assert it.

## 1. The address table (perimeter, all `[chain]`)

| Contract | Address | Notes |
|---|---|---|
| VOID | 0x965B0d74591bF30327075A247C47dBf487dCff08 | account-vault entry; `Enter(string,string)` mints the LAU; `Chat(string)` writes to the world channel |
| LAUFactory | 0xbA6CcD38992839aEE20D5bF9125b1d94190b091C | `New(string,string)` |
| SHIOFactory | 0x5063D2A97960DDE8dc5E3e5A69aAa379C6301F1C | chat channels |
| HECKE | 0x29A924D9B0233026B9844f2aFeB202F1791D7593 | meridian transform `Compliment(uint256)` |
| MAP | 0xD3a7A95012Edd46Ea115c693B74c5e524b3DdA75 | venue factory `New(address)` (QINGs) |
| CHO | 0xB6be11F0A788014C1F68C92F8D6CcC1AbF78F2aB | the hub / address book; ALSO the "Tethys" SHIO of ZI `[chain]` |
| CHAN | 0xe250bf9729076B14A8399794B61C72d0F4AeFcd8 | wallet→YUE registry (Yan), consent escrow |
| CHOA | 0x0f5a352fd4cA4850c2099C15B3600ff085B66197 | play/chat token; `Play`, `Chat` |
| CHEON | 0x3d23084cA3F40465553797b5138CFC456E61FB5D | `Su(address)` influence settle |
| RING | 0x1574c84Ec7fA78fC6C749e1d242dbde163675e72 | `Eta()` rhythm oracle read |
| META | 0xE77Bdae31b2219e032178d88504Cc0170a5b9B97 | `Beat(uint256)` — the heartbeat |
| SEI | 0x3dC54d46e030C42979f33C9992348a990acb6067 | YUE factory `Start(...)` |
| QI | 0x4d9Ce396BE95dbc5F71808c38107eB7422FD9a03 | `Zuo()` = Phobos; `Eris()` |
| MAI | 0xc48B0a4E79eF302c8Eb5be71F562d08fB8E6A3d8 | |
| XIA | 0x7f4a4DD4a6f233d2D82BE38b2F9fc0Fef46f25FA | Fomalhaute constant |
| XIE | 0x4Df51741F2926525A21bF63E4769bA70633D2792 | Fornax constant |
| ZI | 0xCbAdd3C3957Bd9D6C036863CB053FEccf3D53338 | Tethys constant = CHO |
| PANG | 0xEe25Ccd41671F3B67d660cf6532085586aec8457 | |
| DO (deed) | 0x98dBd5E4F78e53884C77573407727C3779ca3bad | `Take(address)` venue-claim deed layer |
| World-chat SHIO | 0x7aE73C498A308247BE73688c09c96B3fd06dDB84 | ZHOU's SHIO ("Fomalhaute" label) — carries `LogEvent` world chat `[chain]` |
| Phobos QING | 0xb0Ba7D36B7F0505879179ecE7401F24eB653c6E1 | first QING; RING's fixed reaction reference |
| Fornax SHIO | 0xF6C50fFE7efbDeE63A92E52A4D5E9afF7fb4A4D7 | YI's Psi |
| Eris SHIO | 0xE843765114992e18061498aeD708537cE9d924FA | YANG's |
| Kernel SHIOs | YI 0x4757438723055f14A1Af5C9651C2E37730F41A9E · ZHENG 0x24E62C39e34d7fE2B7dF1162e1344eB6eb3b3e15 · ZHOU 0x5cC318d0c01FeD5942B5ED2F53dB07727d36E261 · YAU 0x7e91d862A346659DaEEd93726e733C8C1347a225 · YANG 0xB702b3ec6d9De1011BE963EFe30A28b6dDFbe011 · SIU 0x43136735603D4060f226C279613A4dD97146937c | `CHATLOG <name>` onchain |
| AFFECTION Ⓐ | 0x24F0154C1dCe548AdF15da2098Fdd8B8A3B8151D | the cross-system currency |
| CROWS | 0x203e366A1821570b2f84Ff5ae8B3BdeB48Dc4fa1 | the 25-CROWS bouncer threshold token — holding ≥ 25 passes every venue door (unless NoCROWS). READ-ONLY knowledge entry: a live gate we render, never a send destination |
| WITHOUT | 0x173216Ed67eBF3E6767D86e8b3Ff32e0d64437bF | the ban token — `CHO.VerifyUserTokenPermissions` asserts you hold ZERO; holders are refused everywhere. READ-ONLY knowledge entry: a live gate we render, never a send destination |
| MATH | 0xB680F0cc810317933F234f67EB6A9E923407f05D | shared `Random()` (deterministic orbit — see §5) |

Also in the perimeter (libs): SHAFactory 0x4208333D65A90577E3da39B84D6A95eb9db717D2
(public `New` — the raw keypair gateway; session-49 audit: this is NOT an "unnamed
create", it is the named SHAFactory of kb/dev/shafactory.md), LibAttribute
0x529e3e15Da19c7c828f9CCE13C53F7031a30ec7c, LibStrings
0x4ab87f1DBDF6f741ED8BF481C7346103a86f1068, ReactionsLib
0x8704d7740735F6DEA0103366fE297Ba3F9fCaCc4.

Historical/adjacent deployed artifacts — DOCUMENTED HERE ONLY, deliberately NOT
config/addresses.json entries (owner round, session-49; CROWS + WITHOUT moved
INTO config as read-only entries at the session-50 owner round): **DO-1** — the abandoned
draft of the deed pair, `0x3012e0F5eD16C24f61A62100cCEa50cb1E288d08`, deployed 18
minutes before the live DO; its `Take` stops after the eligibility checks (never
adds owners, never mints; supply 0 forever) — see kb/dev/do.md. **setaddresses**
(alias-dir loader) `0x7207BdB5746e39d4bb27A8b9f206047e8432D9aC` — the one-shot
constructor ceremony that wrote CHO's ~90-entry system address book in 2025-02;
62 bytes of spent runtime remain, the book itself is read via `CHO.Addresses(alias)`
/ `CHO.Aliases(i)` (covered by the CHO ABI) — see kb/dev/alias-dir.md.
**PKMinter** `0x9f4E1471e614747A9a56A33eb0338671ebA1dE2B` (wave 7, 2026-05-30) +
its single demo child TT ("PKI Tester") — the treasury-bridge PKI experiment;
deployed and interactable but OUT of this app's scope per IA-PLAN §1 non-goals
(treasury views dropped) — see kb/dev/pkminter.md + kb/dev/pk-tt.md.

Non-perimeter read infra (NOT a Dysnomia contract — batching only, never a send
destination): **Multicall3** lives at the canonical deployment
0xcA11bde05977b3631167028862bE2a173976CA11 on PulseChain `[chain, session-41
eth_getCode probe]`; panel loads batch `aggregate3` through it (IA-PLAN §9),
anonymous reads only.

**Never-deployed layer** (complete in source, ZERO deployment; frontends built only for
SIM mode): WORLD, WAR, H2O, VITUS, GWAT, ENCRYPT, NYM, VMREQ, Registry-as-product.
**NYM cannot run against the live CHO** even on a fork without shims: interface drift
(`CYUN()`/`Log(uint64,uint64,string)`/`OperatorSendMSG(string)` absent on deployed CHO)
`[chain]`.

## 2. The two-source-revision fact (CRITICAL for Beat tooling)

The repo's final tree is NOT the deployed state for two contracts:

- **Deployed `META.Beat` runs `Yeo = Yeo / Chao`** (April direction) — fork-verified
  A/B, session-31 technique `[chain]`. The final tree's `Yeo = Chao / Yeo` was NEVER
  deployed.
- **Deployed `RING.Eta` is a third revision** — neither the April nor the final-tree
  formula reproduces its outputs (`(14, 7973995094115691, 50653, 69343957)` reference
  sample; Charge = 50653×1369 exactly).
- **The old "Fornax Goldilocks ceiling" is SOURCE/APRIL-only, not a deployed
  cap** `[chain, session-82.1 controlled sweep — supersedes the session-31
  inference]`: the old `docs/strategy/` guides derive
  `Max_Fornax = Xia.Charge(Phobos) × LAU.Entropy` from the April
  `Chao /= Omicron` normalization. On a fresh fork LAU/YUE seeded with the
  four-token legs (Fomalhaute=2 wei, CHO/Phobos=1 wei at the LAU), Fornax
  from 1e15 through 1e22 left `Eta.Chao = 1` at every step; `Beat` succeeded
  at every level except a `Fornax=1e19` state where `Iota` zeroed consistently
  (`Panic(0x12)` — a modExp/entropy zero draw, not a balance cap). The old
  "higher Fornax → larger Yeo" direction was not observed either (Yeo
  6→6→4→1 across 1e15/1e18/1e20/1e22 on that fork; the shared Entropy head
  and the venue state dominate). Keep the old guide as a SOURCE-version
  strategy model; do not encode a deployed ceiling, and never tell an agent
  to stop buying Fornax at a formula cap. The operative rule is: preview
  every send and retry a zero-Iota draw.

Consequence for this codebase: the old ceiling warning is historical/source
context; deployed Beat outputs are entropy-driven, so previews (not formula
caps) govern acquisition and retries.

## 3. Core formulas (deployed semantics, `[src]` unless noted)

- **Yuan** (CHOA): `Yuan(token) = balanceOf(wallet) + 10 × balanceOf(LAU) +
  40 × balanceOf(YUE)` — `02_choa.sol:28-33`.
- **Chat costs — the full model** (every chat call costs GAS only; no caller token
  payment anywhere):
  - Each chat mints 1 unit of the receiving contract's own token TO THE CONTRACT
    (`_mintToCap()` → `_mint(address(this), 1e18)`): LAU.Chat mints 1 LAU to the
    LAU, QING.Chat mints 1 QING to the venue (`03_qing.sol:146-156`), CHOA.Chat
    mints 1 CHOA to CHOA (`02_choa.sol:42-53`). Informational, not a caller cost.
  - **LAU.Chat IS the world-channel write path** `[src, session-66 fork-pinned
    set-2 s14]`: `LAU.Chat(text)` (owners — tx.origin passes) routes
    `VOID.Chat → Log("ZHOU", "<Username> " + text)` onto the world/main SHIO
    LogEvent stream. No YUE needed (unlike CHOA.Chat).
  - **The LAU emission pool — anyone can buy your units** `[session-66
    fork-pinned set-2 s14]`: every owner action on a LAU (Chat, Username-set,
    Alias-set, `mintToCap()`) meters 1 unit into the LAU's own balance; that
    pool is purchasable by ANYONE at 1 Ⓐ/unit (`Purchase` is public+permissionless;
    the AFFECTION rate 1:1 is posted in the DYSNOMIA ctor) — the front-run
    window on your identity token (LAU feeds Yuan ×10 + the soeng ladder).
    `mintToCap()` is the SILENT mint (no world line — batch self-mint never
    spams chat); ONE `Purchase(AFFECTION, N×1e18)` collects N units for N Ⓐ.
  - **Collecting the minted LAU costs 1 Ⓐ per token** (the DSS self-snipe
    `chatAndSnipe` path; plain-chat fallback below 1 Ⓐ).
  - `CHOA.Chat(address Qing, string MSG)`: additionally transfers up to **1 CHOA
    from CHOA's OWN balance into your YUE** (contract-funded reward-to-vault, only
    while CHOA's buffer is non-empty — `if(balanceOf(address(this)) >= Mai)`;
    `uint256 Mai` is a NAME TRAP, it moves CHOA, not MAI; routed
    `Chan.ReactYue → Yue.React(Qing)`). Never write "chat pays MAI" — and never
    "the chatter pays the CHOA" either.
  - **QING chat CoverCharge**: venue-configured, charged in the venue's Asset when
    set and the chatter isn't guest-listed (`PayCover` revert) — preview pre-send.
- **QING chat**: `QING.Chat(LAU UserToken, string MSG)` — selector
  `0xb340a780`. VOID world chat routes `Log("ZHOU", …)` onto the world-chat SHIO's
  `LogEvent(uint64 Soul, uint64 Aura, string LogLine)`.
- **Beat minimums**: `Omicron = Fornax(LAU)/Entropy` (xie.sol:33), `Dione =
  Tethys(QING)/Entropy` (zi.sol:37), the CHO/Phobos Yuan moduli must be
  nonzero (≥2; session-82), `PANG.Push` uses `QING.Entropy()` exponent
  (pang.sol:30). Hypobar/Epibar equations at
  `yue.sol:141-142`; the **777 floor**: rate 10.0 ⇒ Mod 1000 (`yue.sol:78-79`).
- **Yuan 1:10:40** weights above; `CHOA.Yuan(CHO)` weighting used by ZI.Spin.
- **Gas**: Beat median 1,916,016 gas (p90 1,933,099 over successes; all-318 max
  2,315,227 = a FAILED tx) `[chain]` — the 3M limit is right but not generous.
- **Beat works; the gate is the Eta TOKEN SEED, not age or "lineage"**
  `[chain, session-82 — supersedes the session-40/65 lineage reading]`:
  the deployed third-revision `RING.Eta()` returns `(14, 0, 0, 0)` for a
  fresh wallet only while the caller's LAU/YUE/wallet hold none of the
  gate tokens. The four values are COMPUTED from live token balances
  (the `Moments[soul] = Iota` write is a monument, not an input). The two
  integer-division sites in `META.Beat` are
  `Charge = Charge1 * Charge / Iota1` and (deployed direction)
  `Yeo = Yeo / Chao`; `Iota1 == 0` or `Chao == 0` is the `Panic(0x12)`.
  Fork-pinned on a fresh LAU/YUE at block 28,100,378, the four legs are:
    1. **`Fomalhaute` = the WorldChatSHIO (`0x7aE7…`) AT THE LAU** —
       nonzero (≥ 2 wei; a modulus of 1 returns 0) makes the
       `XIA.Charge` modExp modulus nonzero, so a zero MAI exponent
       yields `1` (`modExp(x, 0, m) = 1` for `m ≥ 2`) → `Chao` and
       `Charge1` nonzero. Remove it: Eta = `(14, <Iota>, 0, 0)` and
       `Yeo / Chao` panics.
    2. **`Fornax` (`0xF6C5…`) AT THE LAU** — feeds `XIE.Power`'s
       Omicron (the live `Entropy` divisor); too little → `Iota1 = 0`
       → the `Charge` division panics. Remove it: Eta =
       `(14, 0, 1, 1)`.
    3. **`CHO` (Tethys) holdings** — the ZI/PANG `Yuan` modulus must be
       ≥ 2 (`Yuan` = wallet + 10×LAU + 40×YUE). Remove it: Eta =
       `(14, 0, 1, 1)` → panic.
    4. **`Phobos` (the first QING) holdings** — the PANG
       `Yuan(Phobos)` modulus must be ≥ 2 (same 1/10/40 weights).
       Remove it: Eta = `(14, 0, 1, 1)` → panic.
  The TARGET venue's Yuan is NOT a revert gate (a seeded caller Beats a
  zero-held venue successfully with `(0,0,0,0)` outputs); it only scales
  the outputs. `Yue.React`'s onlyOwners gate is not a player blocker:
  the deployed Eta reaches the reactor through `CHAN.ReactYue` (CHAN is a
  YUE owner), never a direct player call; the player only needs to hold
  their own YUE token (`ZeroHoldings`).
  The CHOA bounty buffer never enters the Eta math.
  **Live proof** `[chain, 2026-11-19]`: tx `0x081247c8…` — a LAU created
  21 minutes earlier bought 0.0015 each of WorldChatSHIO + Fornax (sent
  TO THE LAU) and CHO + Phobos (kept in the wallet), then landed a
  successful `Beat` (status 1, 1,967,304 gas). Its own fresh venue's
  pre-block simulation returns `(0,0,0,0)` (zero target Yuan; Beat's
  outputs are not in the receipt); the same wallet now previews
  `Beat(Phobos)` as `(14, 0, ~6.1e14, ~1.06e15)`. The old "aged"
  wallets are simply token-seeded LAUs — their transfer histories show
  the seed (e.g. 0xebd4… cycles buy → transfer-to-LAU → Beat →
  recover). The session-65.5 corridor experiment failed for this
  reason: 12 `CHOA.Chat` calls never seed the four token legs; the
  buffer refill was irrelevant. **The receipt is the proof (session-84)**
  `[chain]`: a committed Beat's success signal is the transaction RECEIPT
  status (and the ~1.9M gas envelope), NOT the venue's live entropy/supply
  — Beat does not move those. Public RPCs can lag their receipt index
  after the tx is mined; a receipt timeout is not a failed Beat (tx
  `0x787cdc…cc139` landed at block 28,105,481 / 1,916,004 gas while the
  selected RPC's receipt read timed out). The app waits 180s with
  read-only public-RPC receipt fallbacks and `tx_status` resolves a hash
  later. **The floor BELOW the gate remains
  real** `[chain, session-43]`: a caller with NO YUE makes `Eta()`
  itself revert `0x12efd467(sender)` ("open your YUE first"). A wallet
  that holds ZERO of its own YUE tokens makes `Yue.React` revert
  `ZeroHoldings` (`0x98aaa293`) — the vault must hold at least 1 wei
  (the constructor mint covers a normal player; the aged-transfer recipe
  tops it up). The gate
  is per-CALLER (its LAU/YUE/wallet), not per-venue: a seeded caller
  can Beat any venue; an unseeded one panics everywhere. Readiness is a
  PREVIEW, not a promise: `Eta` is non-view and draws the shared
  entropy, so a borderline seed can still land zero on a given call
  (the UI's `beatReady` = BOTH Beat divisors, Iota and Chao, nonzero). Fork recipe for a
  repeatable Beat: seed a fresh LAU with `~1e18` Fomalhaute + Fornax
  and hold `~1e18` CHO + Phobos (the cited live wallet used `1.5e15`
  and worked; the Fornax leg must clear the live entropy draw). The
  earlier "double Yuan floor" retraction was about the TARGET venue's
  Yuan (correct: not a revert gate); the Eta-side CHO/Phobos Yuan
  moduli ARE gates, and a caller with both at zero does not Beat. The
  "wedged Beat" retraction stands (Beat emits no META-address events —
  a log-scan blind spot, never a wedge).
- **The old strategy guides' exact floors, re-pinned (session-82.1)**:
  - **Fomalhaute at the LAU: 2 wei** — 1 wei makes the `XIA.Charge`
    modulus 1, `modExp` returns 0, `Chao=0`, and `Yeo/Chao` panics. The
    old guide's "≥1 wei" is off by one.
  - **CHO / Phobos Yuan: ≥2** — 1 wei in the WALLET gives `Yuan=1`,
    `modExp` returns 0 and `Iota=0` → Panic; 1 wei at the LAU counts 10
    and 1 wei at the YUE counts 40 (both work).
  - **Fornax at the LAU: above the live Entropy draw** — `1e15` worked
    in the cited wallet; a `1e19` state zeroed Iota consistently in the fork sweep
    (preview/retry; no static cap, see §2).
  - **The target QING's Yuan is NOT a revert gate** — zero target
    holdings Beat successfully with `(0,0,0,0)`; it only scales Deimos /
    the output. The old "your QING asset ≥1 wei" is an OUTPUT rule, not
    a gate.
  - **Dione = the target QING's Tethys/Entropy** — a venue with a nonzero
    own CHO balance gives a nonzero Dione; only the QING owner can
    `Withdraw`, so NEVER send CHO to an unowned QING (the old guides'
    donation trap is real). `Dione=0` means a successful tx with no
    territory output.
  - **Phobos is the universal accumulator** — every Beat forces a
    `Yue.React(Phobos)`; its Hypobar grows with network activity, so
    targeting Phobos can give the largest territory but is volatile and
    its underlying asset is thin/expensive. The home QING is the stable
    alternative; other QINGs are parasitic-snipe targets.
- **Acquiring the seed — the PulseX V2 route (session-83)** `[chain]`: the
  four legs are ordinary ERC-20s with WPLS pairs on PulseX V2. The router
  is `0x165C3410fC91EF562C50559f7d2289fEbed552d9` (Router02),
  `factory()` = `0x29eA7545DEf87022BAdc76323F373EA1e707C523`, and
  `WPLS()` = `0xA1077a294dDE1B09bB078844df40758a5D0f9a27` (all verified
  on-chain at the live head + the 27,674,000 fork, and named in the
  official PulseX docs). The app's `swap_pls_for_token` uses the NATIVE
  exact-output route (`swapETHForExactTokens`, selector `0xfb3bdb41`;
  `getAmountsIn` `0x1f00ca74`): the PLS is wrapped inside the router, so
  there is NO approve leg anywhere, and the router refunds unused native
  value (fork-verified: a 2,000-PLS send on a ~674-PLS quote left ~732
  PLS including gas). The ask is exact: 2 wei Fomalhaute, 2 wei CHO,
  2 wei Phobos, and 1e15 wei Fornax (0.001) as the STARTING Fornax
  level — the live per-soul `Entropy` divisor can demand more; preview
  `Eta` and retry with a larger exact-output (a geometric ramp is the
  honest discipline; there is no static ceiling). At the 27,674,000 pin
  the quotes for those four amounts were `754,507 wei` / `95,768 wei` /
  `15,264,994 wei` PLS and `674.300772701668684784 PLS` — a ~674-PLS
  token bill plus gas; quotes move with every swap. **The pools are
  thin** (Fornax ~33.96 tokens, Phobos ~0.91 tokens of depth at the
  pin): the tool enforces a reserve-ratio price-impact guard
  (`maxImpactBps`, default 500 = 5%) and an optional `maxPls` ceiling
  before THE gate, and the router is an external unknown-contract send
  (approval card in modes A/B; PLS value caps bind). Recipients:
  Fomalhaute/Fornax must land AT THE LAU; CHO/Phobos can sit in the
  wallet at ≥ 2 wei (1×) or deeper at the LAU (10×)/YUE (40×). The four
  swaps fill the default per-run send cap (4) — Beat in the next run or
  raise the L2 knob.
- **Aged accounts are TRANSFERABLE by design** `[chain, session-65.6
  fork-proven; mechanism corrected session-82]`: the Beat gate rides the
  caller's LAU (its token seed), NOT the YUE reactor state — the YUE is
  needed only for the "does a vault exist" `NotStarted` check and the
  40× Yuan weight. Keep the aged LAU (with its Fomalhaute/Fornax
  balances) and remap the wallet to it, and the gate follows.
  `CHAN.TransferYue(yue, newOrigin)` — public, gated only on
  `_chi.Origin() == tx.origin` and the new origin being YUE-less —
  moves BOTH the `Yan` resolver and the YUE's Origin,
  clearing the old wallet's mapping (a MOVE, not a copy). The complete
  handover: `LAU.addOwner(new)` → `CHAN.TransferYue(yue, new)` →
  `new: CHO.Enter(lau)` (Enter gates on `UserLau.owner(tx.origin)`) →
  `YUE.transfer(new, ≥1 wei)` (`Yue.React`'s `ZeroHoldings(tx.origin)`
  gate — the wallet must hold its own YUE token). Fork-verified
  end-to-end: the receiving wallet reads the aged LAU's token-seeded
  Eta slots and lands a successful Beat (~1.9M gas). The manual kit implements it as
  `manual_fork.py --aged-transfer` (a FORK COPY onto a key you hold —
  the real owner untouched).
- **Venue-token acquisition** `[chain, session-40]`: fresh QINGs (v2 base)
  carry NO market rates — `Purchase(AFFECTION,·)` reverts MarketRateNotFound
  until an owner runs `AddMarketRate(AFFECTION, 1e18)`; Phobos has NO rates at
  all (its 457-token buffer is rate-blocked). Only CHO owns a fresh venue
  (MAP.New adds CHO, not the creator); ownership routes through
  `CHO.AddContractOwner(qing, player)` (the same move DO.Take automates) or
  owner `Withdraw`.
- **DSS** (`DysnomiaSelfSnipe`): `chatAndSnipe` with the 1-Ⓐ floor fallback to plain
  LAU.Chat below 1 Ⓐ `[src: etc/DysnomiaSelfSnipe.sol]` — **but the as-shipped gist
  is broken** `[src, session-40 fork-verified]`: `ILAU LAUContract = ILAU(LAUAddress)`
  binds address(0) at declaration (before the constructor sets `LAUAddress`), so
  `chatAndSnipe`/`chat` revert calling 0x0; `setLAU` never rebinds it either. The
  one-line fix (bind in the constructor) validates the documented semantics —
  chat mints 1 LAU to the LAU, 1 Ⓐ buys it, the owner receives it (harness
  fixtures `dss` (as-shipped) + `dss-fixed` (patched) pin both behaviors).
  **Session-66**: the app ships the FIXED bytecode (`app/src/data/
  dss_fixed.creation.hex` — verbatim fixture copy) behind a DEPLOY desk through
  THE gate — a NEW gate surface: creation txs (`to: null`) classify risk
  `deploy` (unknown tier; modes A/B card; mode C + the breadth toggle
  auto-acks — the owner's session-66 call; `allowUnknownDestinations: false`
  denies). The DSS binds YOUR LAU at construction (the ctor arg), the deployer
  is the owner (`onlyOwner`; the LAU's onlyOwners passes via tx.origin), and
  the app captures the deployed address from the creation receipt (CREATE1 —
  prediction == receipt.contractAddress, fork-pinned; the contract has NO
  getter). **Session-82.1**: a DSS deployed by another frontend/wallet can be
  adopted after a STRUCTURAL validation — the shipped runtime
  (`app/src/data/dss_fixed.runtime.hex`, verbatim fixture copy) must match
  `getCode` byte-for-byte, storage slot 0 (ownerAddress) must be the active
  account, and slot 1 (LAUAddress) must be the active LAU. The same check
  runs after an in-app deploy; the import is stored with source "import"
  (state/dssStore). Routes: the manual desk (IDENTITY, deploy OR adopt), the
  CHAT composer's WORLD/WORLD+DSS legs, the agent's `dss_setup` (deploy
  through THE gate or adopt an address — always advertised; it is setup, not
  a chat post) and `dss_snipe` (§7.4-fenced with the chat family + the
  FULL-AUTO cadence governor). The exact-amount Ⓐ APPROVE (spender = the DSS)
  rides first when short — once-only per approve (s8).
- **YUE custody exits are dead code** `[src, session-58 fork-verified against a live
  YUE]`: `YUE.Withdraw`/`Chan.YueWithdraw` gate on `hasMint(what)`, but the deployed
  `hasMint` staticcalls the selector of the string `"Mint(address, uint256)"` — WITH
  a space — `0x7a2dd71a`, which no contract answers (the real selector is
  `0x0f6798a5`). The probe therefore reverts for EVERY asset and `OnlyGameTokens`
  fires always: vault-held tokens have NO sanctioned exit path as deployed
  (`MintToOrigin` only drips YUE units). Fork-pinned by harness set-3 step 10
  (VITUS royalties); the SIM frontend renders the royalty exit honestly
  unavailable.

## 4. Gates (what blocks an action) — from `abi/index.json` + fn_tables

- LAU actions require a user entry + Username set (`NoUserEntry`/`NoUserName` reverts).
- YUE = one per wallet, auto-created on first `CHOA.Play()`; first `SEI.Start` per EOA
  creates (`01_sei.sol:34-47`); renames via the base `Rename` (owners-gated — the
  player path is recalling `SEI.Start(lau, name, symbol)`, which renames an existing
  YUE, `01_sei.sol:44-46`; session-49 audit: an earlier "renames via `Bar`" here was
  WRONG — `YUE.Bar(qing)` is the per-QING venue-bars view).
- YUE vault withdrawals require **Chan.OptIn by the YUE owner** (consent escrow).
- QING admission: bouncer cascade + `BouncerDivisor` + the 25-CROW-equivalent
  auto-bouncer threshold; `CoverCharge`; guest list (1-day); `NoCROWS` overrides.
  The venue CREATOR is auto-staffed (`_staff[tx.origin]` at construction — full
  bouncer powers from block one) but is NOT an owner unless CHO added them, the
  wrapped asset's owner is them, or they Took the deed.
- QING escrow lock: the immutable `GWAT` flag is set at creation by lottery
  (`Luo % 476733977057179 == 0` draws the withdrawable minority); `Withdraw`
  asserts `!GWAT` — a locked venue's accumulated covers/desk balances are
  permanently on-display, never extractable (session-49 audit addition; the
  bouncer/management surface `setCoverCharge`/`setStaff`/`setGuestlist`/
  `setBouncerDivisor` is bouncer-gated, `AllowCROWS`/`AddMarketRate` (rate can
  only increase, capped at priced-asset totalSupply ÷ 777)/`Withdraw` owners-gated).
- DO.Take: once per venue, ever. The gate keys on the WRAPPED ASSET, not
  the venue (session-51 fork + DO-2 disassembly): eligible when the venue
  wraps your own user token, when you pass `owner(tx.origin)` on the wrapped
  asset, or (assets exposing `Creator()`) when `asset.Creator() == tx.origin`.
  An INELIGIBLE take is a silent no-op (status 1, nothing happens, gas
  spent); an asset answering neither probe makes Take revert raw; a second
  take on a taken venue is the same silent no-op (no getter for the flag —
  verify deeds by the venue owner probe flipping). 54 takes ever `[chain]`.
- `Purchase(address,uint256)` (`0x2499a533`) buys ladder tokens/assets WITH AFFECTION
  — live on CHOA/CHEON/QI/PANG/VOID `[chain]` — the cross-system economic bridge.
- **The base Redeem leg** `Redeem(address,uint256)` (`0x222838db`, session-52
  fork-pinned, harness set-2 s12): PUBLIC (no owner gate); pulls `a` of the called
  token itself from the caller with the allowance spender == **the called contract
  itself** (the base Redeem does `DYSNOMIA(address(this)).transferFrom` — the
  prerequisite is a venue-token allowance TO the venue, not an Ⓐ allowance), then
  pays `a × rate / 1e18` of the rated asset out of the called contract's escrow of
  it (a venue's Ⓐ escrow holds only what Purchases deposited — a thin escrow makes
  Redeem revert insufficient-balance rather than paying).
- **The YUE exchange desk** — `YUE.Hong/Hung/GetAssetRate` (session-52 fork-pinned,
  harness set-2 s12): the vault is the counterparty on BOTH legs — every transfer
  inside Hong/Hung is called BY the YUE, so payouts come from the VAULT'S OWN
  inventory (`Hong(spend, qing, amt)` pulls `amt×rate/1e18` of the wrapped asset
  into the vault and pays venue tokens the vault already holds; `Hung(qing,
  receive, amt)` is the inverse). The venue's escrow is never the counterparty
  here. `GetAssetRate(qing, asset)` is the honest composed read: 0 = no route
  (`ExchangeRateNotFound` on use — a fresh venue carries no posted rate for its
  own asset); the DIRECT pair returns the POSTED rate unchanged (the 777-mod
  attenuation divides a zero accumulator on hop one — it only bites on chained
  QING-on-QING routes, which additionally require unlock-lottery venues to walk);
  a non-ancestor asset reverts `InvalidPair`. The spend legs need exact approvals
  to the YUE; a missing approval reverts `DysnomiaInsufficientAllowance` (the
  base transferFrom reverts internally — yue.sol's "Need Approved" require-strings
  are unreachable on the DYSNOMIA base).
- Venue creation: `MAP.New(address Integrative)` — a late-reverting New
  (e.g. the rename decode, or the tile-collision assert) rolls back the
  WHOLE tx including CHO's `Qu` claim and the entropy draw (session-51
  fork-verified: `Qu(de) == 0` after a forced late revert, and the retry
  re-draws and re-claims the SAME De — `waat == de × Meridians[0]`); the
  earlier "burns CHO's Qu claim forever" cross-contract-leak claim here is
  RETRACTED. The real cost of a failed create is the gas; the
  988-creates-vs-917-live delta is simply failed creates.
- Asset→QING resolution (session-73, fork-verified): MAP exposes NO
  asset→QING view, and `has(asset,"…")`/`hasOwner(asset)` are generic
  CAPABILITY probes (staticcall-success booleans on the asset —
  `has(LAU,"Qing")==false` does NOT mean no QING exists). The ONE onchain
  oracle is the `New` revert itself: `QingAlreadyExists(address Token,
  address Qing)` (map.sol:70) carries the EXISTING QING's address as its
  second arg. Client-side, the NewQing event walk (every emission carries
  `(Qing, Integrative, Waat)`) is the index — the app ships it as the
  venue census's per-row `asset` (session-73 regen; state/atlas.ts
  `qingForAsset`).

## 5. Randomness + preview honesty (the s32 findings, `[chain]`/`[src]`)

- The system's randomness = a **shared deterministic kernel chain**: `CHO.Recall`
  advances the GLOBAL `Entropy` head; it runs inside the stateful `GetUser()` getter
  several times per Beat. Committed calls move everyone's next outputs.
- **`eth_call` previews are PURE** (do not advance the head); any interleaved caller
  changes the committed result. A DRYRUN verifies the floor/div0 class of failures,
  NOT the final numbers. Every preview UI must say exactly this. Preview-grinding
  (stake + one-cheap-step txs + free previews) is a real strategy — the UI must not
  claim a preview is "the result".
- The **entire oracle ladder is AT CAP** (metered calls at census: QI 91,769 /
  CHOA 42,096 / MAI 26,373 / XIE 20,846 / PANG 15,389 / ZI 13,185 / XIA 5,551) —
  usage was heavy, not abandoned `[chain]`. Session-49 metric clarification: these
  counts are METERED-CALL counts, NOT the lottery budgets; the budgets are the
  higher supply caps (e.g. PANG supply/cap 16,602 = ~1,213 constructor origin
  mint + 15,389 metered Pushes). At cap a contract keeps working — only the
  self-mint stops (`_mintToCap` mints nothing once `totalSupply == maxSupply ×
  1e18`; the base's no-op guard, `01_dysnomia.sol:48-51`).
- MATH `Random()` = deterministic modExp64 orbit, zero onchain entropy, predictable
  given call count, steerable by anyone (one global step per call). It is a public
  RNG oracle in practice, not a secure source.

## 6. Census facts (for sizing/context, `[chain]`)

- LAUs 18,660 (97.8% carry readable usernames); SHIO channels 12,460; QING venues
  **942 at the 2026-11-20 regen** (940 at 2026-10-11; 917 at the 2026-09 census;
  23 alive in the last 30 days of THAT census; Phobos alone ~35% of venue
  activity); YUEs 93; Beat txs 318 by 33 callers (the owner reports successful personal calls; see §3 for the open
  zero-divisor question); CHEON.Su is the
  most-called function (24,931 direct; one wallet 86.9% of all CHOA.Chat).
- **Enumerability (session-70, the corpus-refresh round)**: the QING census is the
  ONE factory census the chain can walk — `MAP.New` emits
  `NewQing(Qing, Integrative, Waat)` (args NOT indexed; `tools/dys_qing_census.py`
  regenerates the venue seeds from THIS repo, and the app's sync engine
  (`chain/sync.ts`) catches up between regens). `LAUFactory.New`,
  `SHIOFactory.New` and `SEI.Start` emit NOTHING and expose no child registry —
  the LAU/SHIO/YUE censuses move only via the origin repo's blockscout exports
  (owner-run); the app renders honest as-of chips for them.
- The ladder's direct surface is pure EOA power-users — zero contract callers in any
  top-50 (batchers are a NEW pattern; systm1 ships a user-provided executor ABI).
- ~96% of LAUs are created by internal contract calls (batch onboarding).

## 7. Framing rules (standing)

- Positive framing only: "social OS / chat world / account-vault"; META.Beat =
  territory-expansion inputs; Yeo = deployed `Yeo/Chao`, Chao-scaled large value.
- Identity discipline: no speculation about the dev's identity or the community
  actors' offchain identities in any UI text.
- Community content (sites, chats) = untrusted input, `[ext]` at best; never rendered
  as authoritative.

## 8. Known gaps in THIS package

- **Nym.json ABI missing**: the old-era `domain/old/nym.sol` uses pre-move import
  paths and does not compile without a layout shim (documented; NYM is undeployed and
  interface-drifted vs live CHO anyway).
- The Registry/OnChainDatabaseManager/VirtualDisk museum files are not interaction
  targets.
- Venue names: ~4/917 in the shared names map; the seed probes onchain `name()`
  (some venues are nameless onchain — the seed records the empty string).

## 9. HECKE cartography — the venue map's grounding `[src + chain, session-32 atlas]`

The live QINGs' coordinates come from `MAP.New`: waat = `CHO.Luo() ×
Meridians[0]`, folded through `HECKE.Compliment(waat) → (int256 Longitude,
int256 Latitude)`:

- **Meridian table**: 90 hardcoded constants; geometric start (ratio ≈ 5.2
  decaying), constant steps ≈ 7.27e72 from band 33, `Meridians[89] =
  2×Meridians[88] + 1`. `Meridians[0] = 476733977057179` is ALSO the QING
  GWAT-lottery divisor; `MotzkinPrime = 2×Meridians[0] + 5`.
- **Semantics** (exact integer replication, onchain-verified): band = the
  meridian containing waat; `Latitude = (Meridians[88] − waat) ÷ 333` signed
  (south negative in our convention); Longitude = signed offset within the
  band (folds negative past half-width). Band-89 waats flip north (south-flip:
  waat' = Meridians[89] − waat, latitude mirrored). Pole scale =
  `Meridians[88] ÷ 333 ≈ 1.1832e72` EXACTLY — the predecessor's
  `1.2e72` approximation compresses latitudes ~1.4%.
- **The distribution**: all 917 venues land in **bands 34–88** with
  ~UNIFORM |latitude| over equator→pole. Because latitude is anti-monotonic
  in band by construction, any plot that encodes BAND AS LONGITUDE (the
  predecessor's equirectangular `band×4°` globe) bunches the venues along a
  diagonal — a framing artifact, not chain truth.
- **The canonical framings** (session-32): the **LINEAR STRIP** — x = signed
  longitude ÷ band half-width (−1..+1, the fold at 0), y = |Latitude| ÷ pole
  LINEAR (equator→pole), both hemispheres sharing the frame, colored — is the
  contracts' native space (WORLD.Code range-checks the signed ints); the
  **DISC** projection (r = |lat|÷pole, θ = longitude×180°) is the alternative
  "Discworld" reading. Log/polar-framings distort density. The app's MAP
  canonical mode maps lon = fold-fraction×180°, lat = ±|lat|÷pole×90° —
  the disc unrolled onto the globe; the legacy equirectangular framing stays
  available as a toggle, labeled as framing (both render the same seed).
- Cartography gotcha: the projection is **anisotropic** (hyperbolic band
  widths — "3 tiles apart" at different latitudes are very different
  Waat-distances); scatter plots in band-index space mislead.
