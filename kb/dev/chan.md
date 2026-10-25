# CHAN — "Dysnomia Chan" — the YUE directory + player-consent escrow

> Wave 4 · 2025-05-30 08:08 UTC · deployed `[chain]` · at cap · active this month `[chain]`

## In player terms

| | |
|---|---|
| **The bank's front desk AND its compliance department** | CHAN keeps the directory (which wallet owns which YUE account) and, separately, the consent ledger: YOU choose which contracts may touch your account, via `OptIn(contract, allow)`. |
| **Nothing moves without two yeses** | A contract holding your account can only act if (a) you opted it in AND (b) it is itself trusted by the system (a CHAN owner). Player consent + system membership, both required, both onchain. |
| **Withdrawals ride through here** | Your YUE's vault exits (and its 1-unit drip) only execute when CHAN calls them — YUE trusts exactly one address. The consent design means "which tools may move my funds" is your choice, recorded forever. |
| **Where to find anyone's account** | `Chan.Yan(wallet)` — public view, one read. |

## 1. Identity

| | |
|---|---|
| Address | `0xe250bf9729076B14A8399794B61C72d0F4AeFcd8` |
| Creation | block 23,599,003 — 2025-05-30 08:08 UTC (tx `0x92beaae002d97106d815c4587e74549866f08017d45e8d48e900fe95e1a1b5e1`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | Dysnomia Chan / CHAN `[chain]` |
| Supply / cap | 86,623 / 86,623 — **at cap** `[chain]` |

## 2. Role

Two jobs. (i) The **YUE directory**: `Yan: origin → YUE` maps every player
wallet to their account/vault token (SEI writes it; `TransferYue` re-keys it,
origin-gated). (ii) The **player-consent escrow**: `OptIn(contract, allow)`
grants a contract the right to `YueWithdraw` / `YueMintToOrigin` /
`YueForceTransfer` that player's YUE holdings — an allowance system at the
account layer. CHAN is the only caller YUE trusts (`OnlyChan` checks inside
YUE), making it the custodian of record for the vault layer.

## 3. Dependencies

- Holds `Xie` (wired into the ladder for ReactYue).
- Called by: SEI (AddYue), CHOA/CHEON (ReactYue/YueMintToOrigin), the
  undeployed VITUS/H2O/WAR/WORLD designs (addOwner at their constructions —
  the world layer planned to route escrow through here).
- CHEON and CHOA constructors both add themselves as CHAN owners.

## 4. State

`Xie`, `Yan` (public mapping), `_optInList` (yue → contract → bool).

## 5. Functions

<!-- fntable: CHAN @ domain/sky/01_chan.sol -->
<!-- fntable-begin: CHAN @ domain/sky/01_chan.sol -->
Function table extracted mechanically from `domain/sky/01_chan.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address XieAddress)` | deployer | meter | — | — |
| `AddYue(address Origin, address Yue)` | owners | meter | — | `AlreadyAdded` |
| `TransferYue(address Yue, address NewOrigin)` | public | meter | — | `AlreadyAdded`, `NotOrigin` |
| `ReactYue(YUEINTERFACE Yue, address Qing) returns (uint256 Charge)` | owners | — | — | — |
| `OptIn(address Contract, bool Allow)` | public | meter | NewSpenderContractOptIn | — |
| `OptedIn(YUEINTERFACE Yue, address Contract) returns (bool)` | public | — | — | — |
| `YueWithdraw(YUEINTERFACE Yue, address Asset, address To, uint256 Amount)` | owners | meter | — | `PlayerMustOptIn` |
| `YueMintToOrigin(YUEINTERFACE Yue)` | owners | meter | — | — |
| `YueForceTransfer(YUEINTERFACE Yue, address From, address To, uint256 Amount)` | owners | meter | — | `PlayerMustOptIn` |

Events declared: `NewSpenderContractOptIn(address Origin, address Yue, address Contract, bool Allow)`

Errors declared: `AlreadyAdded(address Origin, address Yue, address New)` · `NotOrigin(address YueOrigin, address Requestor)` · `PlayerMustOptIn(address Player, address Yue, address Contract)`
<!-- fntable-end -->

Effects: `AddYue` — owners-gated, one YUE per origin (`AlreadyAdded`).
`TransferYue` — the CURRENT origin (tx.origin must be YUE.Origin) re-keys the
directory + calls `Yue.ChangeOrigin`. `ReactYue` — owners-gated pass-through
to `Yue.React` (returns the venue Charge). `OptIn` — public, emits
`NewSpenderContractOptIn`. `YueWithdraw`/`YueForceTransfer` — owners-gated AND
player-opt-in-gated (`PlayerMustOptIn`); `YueMintToOrigin` — owners-gated
(no opt-in needed for the 1-unit self-mint path).

## 6. Integration notes

- Discovering a player's YUE: `Chan.Yan(wallet)` — public view.
- The consent model: the PLAYER opts the CONTRACT in; the contract then must
  ALSO be a CHAN owner (system-side) — two-sided gating by design.
- `YueForceTransfer` currently has no live target: YUE's ForceTransfer body
  is commented out in source `[src: yue.sol:122-128]` — the CHAN-side
  wrapper exists, the YUE-side enforcement does not (a deliberate disable).

## 7. Provenance

- [src] `domain/sky/01_chan.sol`.
- [chain] perimeter; liveness (active 2026-09).
