# YUE — the per-player account/vault token (factory-child TYPE)

> Type doc: 93 live instances `[chain]`, children of [SEI](./sei.md). A YUE is
> the player's account and vault — with a built-in exchange desk — NOT a
> "game currency" (a deliberate reframing).

## In player terms

| | |
|---|---|
| **Your personal bank, as a token** | One YUE per wallet, minted at `SEI.Start`. Earnings land here (chat bounties, settles, planned royalties); it is the account everything in the venue layer pays into. |
| **Your money, your consent** | The vault only moves on the custodian's call (CHAN), and only for contracts you opted in. `MintToOrigin` drips single units of the account token itself out to your wallet — your account's own usage counter, delivered home. |
| **A built-in exchange desk** | `Hong`/`Hung` buy/redeem venue-family assets through chained posted rates with a deliberate 777-flavored attenuation — rates get worse the deeper the chain. Always `GetAssetRate` first; a 0 rate means "no route". > ng-correction (session-52 fork, harness set-2 s12): the VAULT is the counterparty on both legs — every transfer inside `Hong`/`Hung` is called BY the YUE, so payouts come from the vault's OWN inventory (the venue's escrow is never the counterparty here, unlike the base Purchase/Redeem on the venue itself). On the DIRECT pair (a venue and its own wrapped asset) the walk returns the POSTED rate unchanged — the 777-mod attenuation divides a ZERO accumulator on hop one and can only bite on chained QING-on-QING routes. |
| **Your venue memory** | Per-QING bars (Hypobar/Epibar) accumulate every action you take at every venue — a lifelong attendance record written by the world, not by you. |
| **Withdrawal filter** | The vault only releases assets that expose a mint interface (`OnlyGameTokens`) — this desk was built for the family's own tokens, not arbitrary ERC-20s. > ng-correction (session-58 fork, harness set-3 step 10): the filter is broken in the deployed code for EVERY asset, family tokens included — `hasMint` staticcalls the selector of the string `"Mint(address, uint256)"` WITH A SPACE (`0x7a2dd71a`, not the real `0x0f6798a5`), which no contract answers, so `OnlyGameTokens` always fires and `Withdraw`/`YueWithdraw` are dead code chain-wide (recorded normatively in kb/deployed-semantics.md). |

## 1. Identity

| | |
|---|---|
| Type | `Type() == "YUE"` |
| Factory | [SEI](./sei.md) `0x3dC54d46e030C42979f33C9992348a990acb6067`.Start — one per wallet |
| Census | **93** (23,713,503 → 27,565,448; newest 2026-09) `[chain]` — erratum v2 (receipt-scan method; blockscout internal-creates saw only 6) |
| Custodian | [CHAN](./chan.md) — the only address YUE trusts for Withdraw/MintToOrigin |
| Source | `domain/yue.sol` |

## 2. Role

Earnings land in it (CHOA bounties, CHEON settles, planned VITUS royalties);
withdrawals happen ONLY through the CHAN escrow with the player's opt-in;
`Hong`/`Hung` is its exchange desk (buy/redeem QING-family assets through
chained market rates with the 777-mod attenuation); `React(qing)` advances
per-QING bars (Hypobar/Epibar += XIE's Omega/Omicron) — holders only
(`balanceOf(tx.origin) > 0`).

## 3. Dependencies

- Constructor takes CHAN; `Origin = tx.origin` (the player).
- Called by CHAN (custody), CHEON/CHOA (payouts + React), RING.Eta (React on
  the Zürich QING = "Phobos"), the undeployed WORLD/WAR/VITUS/H2O designs.

## 4. State

`Chan`, `Origin`, `Hypobar`/`Epibar` (per-QING accumulated bars; read via
`Bar(qing)`).

## 5. Functions

<!-- fntable: YUE @ domain/yue.sol -->
<!-- fntable-begin: YUE @ domain/yue.sol -->
Function table extracted mechanically from `domain/yue.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(string memory name, string memory symbol, address ChanAddress)` | deployer | — | — | — |
| `hasMint(address _contract) returns (bool does)` | public | — | — | — |
| `ChangeOrigin(address NewOrigin)` | owners | — | — | — |
| `IsValidAsset(address GwatAsset, address Integrative) returns (bool)` | public | — | — | — |
| `Hong(address SpendAsset, address QingAsset, uint256 PurchaseAmount)` | public | — | — | `InvalidPair`, `ExchangeRateNotFound`, `require` |
| `Hung(address QingAsset, address ReceiveAsset, uint256 RedeemAmount)` | public | — | — | `InvalidPair`, `ExchangeRateNotFound`, `require` |
| `GetAssetRate(address GwatAsset, address Integrative) returns (uint256 Rate)` | public | — | — | — |
| `Withdraw(address what, address To, uint256 amount)` | owners | — | — | `OnlyChan`, `OnlyGameTokens` |
| `MintToOrigin()` | owners | meter | — | `OnlyChan` |
| `Bar(address Qing) returns (uint256 Hypogram, uint256 Epigram)` | public | — | — | — |
| `React(address Qing) returns (uint256 Charge)` | owners | — | — | `ZeroHoldings` |

Errors declared: `InvalidPair(address SpendAsset, address ReceiveAsset)` · `ExchangeRateNotFound(address SpendAsset, address ReceiveAsset)` · `OnlyGameTokens(address what)` · `OnlyChan(address Sender, address Chan)` · `ZeroHoldings(address Who)`
<!-- fntable-end -->

Effects: `IsValidAsset(gwatAsset, integrative)` — walks the QING-on-QING
derivative chain (a GWAT's `Asset()` is its parent QING) checking the
ancestor set. `GetAssetRate` — the pricing walk `[src: yue.sol:69-92]`: start
at the outer venue and hop inward via `Asset()`; at each hop read the venue's
posted rate for its parent and multiply it into the accumulator; whenever a
posted rate is "cheap" — its hundredths-of-percent form
(`rate ÷ 1e16`) under 777, i.e. under 7.77 — DIVIDE the accumulator by
`(777 − Mod) × 10^13`, a penalty that grows the further under 777 the rate
sits (a hard clamp bounds the accumulator above 1e18 between hops). Net
effect: chained exchange pricing is deliberately lossy — every hop through a
cheap-rated venue makes the composite rate worse, and a hop with no posted
rate kills the route outright (returns 0 ⇒ `ExchangeRateNotFound` on use).
`Hong(spend, qing, amount)` / `Hung(qing, receive, amount)` — exchange with
approval (`require "Need Approved …"` on failure).
> ng-correction (session-52 fork, harness set-2 s12): the `"Need Approved"`
> require-strings are UNREACHABLE on the DYSNOMIA base — its `transferFrom`
> reverts `DysnomiaInsufficientAllowance` internally before ever returning
> false, so a missing approval surfaces as that custom error, never as the
> require string. Also fork-pinned: both payout legs draw on the VAULT'S OWN
> inventory (`from == the YUE` in the `DysnomiaInsufficientBalance` revert
> when a pot is empty), and the direct pair's `GetAssetRate` equals the
> posted rate exactly. `Withdraw` — CHAN-only AND
the asset must expose `Mint(address,uint256)` (`OnlyGameTokens` — the vault
refuses arbitrary tokens). `MintToOrigin` — CHAN-only; mints 1 unit to
itself if under cap and forwards it to the player. `React(qing)` —
owners-gated + `ZeroHoldings` if tx.origin holds none of the YUE. The
`ForceTransfer` body is commented out `[src: yue.sol:122-128]` — disabled.

## 6. Integration notes

- "Open an account" = `SEI.Start(LAU, name, symbol)`; read `(YUE, LAU)` via
  `SEI.Chi()`.
- Exchange pricing: always `GetAssetRate` first — rates walk chains and can
  return 0 (`ExchangeRateNotFound` on use).
- The 93-vs-6 census lesson generalizes: factory children created inside a
  parent call frame need receipt-scans to count.

## 7. Provenance

- [src] `domain/yue.sol`.
- [chain] `yue_addresses.json` (93).
