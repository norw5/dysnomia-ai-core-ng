# DO / 搞 — the venue-claim deeds ("Take a QING") — decompiled + classified

> Wave 6 · 2025-06-27 · deployed `[chain]` · classified from
> heimdall decompiles + receipt decode (source still not recovered — the
> classification stands, the source gap stays open)

## In player terms

| | |
|---|---|
| **Claim co-ownership of a venue** | `Take(qing)` makes YOU an owner of that QING — a real MultiOwnable owner, with everything ownership carries (renames, settings, the msg.sender-or-tx.origin gates). It is a one-time-per-venue claim, keyed on the WRAPPED ASSET (see the correction below). |
| **The gate is the wrapped asset** | > ng-correction (session-51 fork + bytecode audit): this table originally claimed a "permissionless for any registered player" land grab. The fork + DO-2 disassembly show the eligibility keys on the QING's wrapped ASSET, not on registration alone: eligible when the venue wraps your own user token (`Asset() == CHO.GetUserTokenAddress(tx.origin)`), when you pass `owner(tx.origin)` on the wrapped asset, or — for assets exposing `Creator()` — when `asset.Creator() == tx.origin`. |
| **Ineligible = silent no-op** | An ineligible Take does NOT revert: it lands "successful" and does nothing (gas spent). Same for a second Take on a taken venue — the per-QING flag makes it the same silent no-op. An asset answering NEITHER `owner(address)` nor `Creator()` makes Take itself revert (raw, empty revert data — the probe's revert bubbles). Verify deeds by the venue owner probe flipping, never by tx status. |
| **The deed is the mint** | On success exactly 1 DO mints — not to you, to YOUR user token (the account contract). The DO balance of an account = the venues its owner claimed. |
| **DO-1 is the abandoned draft** | Deployed 18 minutes before DO-2 with the same name and a check-only `Take` that never acts (no owner-add, no flag, no mint — supply still 0). DO-2 is the finished version. |

## 1. Identity

| | DO-1 (draft) | DO-2 (live) |
|---|---|---|
| Address | `0x3012e0F5eD16C24f61A62100cCEa50cb1E288d08` | `0x98dBd5E4F78e53884C77573407727C3779ca3bad` |
| Creation | block 23,833,823 — 2025-06-27 03:39 UTC (tx `0xac29e04b35d8c354f90a83f10da288338dc8f252245b64c969bec87c614725c9`) | block 23,833,935 — 2025-06-27 03:57 UTC (tx `0x5fe9a001110f0e7e5d53419646d50f59235cb740f79c9e7bb89b760df124cb2c`) |
| Name / symbol | DO / 搞 `[chain]` | DO / 搞 `[chain]` |
| Supply | 0 (never used) `[chain]` | 54 = one per successful Take `[chain]` |
| Face | DYSNOMIA base + EIP-2612 (`permit`, `nonces`, `DOMAIN_SEPARATOR`, `eip712Domain`) + `burn`/`burnFrom` | same |

Both deployed by `0x0474606332105A1dA6FC8EF7De2470551D389Cb9`, 18 minutes
apart; the recovered tree has no DO source — classification below is from
heimdall decompiles + decoded receipts, all `[chain]`.

## 2. Role

The wave-6 **venue-claim deed layer**: `Take(QING)` — for a caller with an
ownership stake in the venue's WRAPPED ASSET (own user token wrapped, or an
`owner(address)`/`Creator()` stake on the asset; > ng-correction, session-51
fork + disassembly — the original text here claimed "any registered player")
— adds the caller's EOA as an **owner of the venue** via
`CHO.AddContractOwner(qing, caller)`
(selector `0x7fac92c1`; the QING itself emits `OwnershipUpdate(caller)`),
flips a per-QING taken-once flag, and mints exactly 1 DO to the caller's
**user token** (`CHO.GetUserTokenAddress(tx.origin)` — selector
`0xe80c28bf`; the call sequence is `qing.Asset()` →
`CHO.GetUserTokenAddress(origin)` → `CHO.has(asset,"Creator()")` → the
asset probe, fork-traced). Ineligible takes are silent no-ops; assets
answering neither probe revert raw. A `Minters(address)` allowlist view
exists (mapping-backed) but is **unpopulated** — false for every probed
address including the deployer and all 34 takers; it gates nothing observed
and looks like dead code or an unused reservation.

Why it matters: a QING owner crosses the msg.sender-or-tx.origin gates of
the venue's owner functions (rename, settings) — DO was the system's
asset-stakeholder claim moment. The early burst (54 takes, mostly June
2025) read as playbook-following agents/players wrapping and claiming their
own tokens.

Operational context `[ext]` (the owner's own playbooks): the operator's
agent onboarding procedures list `Take()` as a standard step for every new
venue owner — the 54 takes / 34 takers read as playbook-following
agents/players, not spontaneous discovery.

## 3. Dependencies

- The target QING: `Asset()` (the gate's key input), the wrapped asset's
  `owner(address)` / `Creator()` (the actual eligibility probes — on the
  ASSET, not the venue; > ng-correction, session-51).
- CHO `0xB6be11F0A788014C1F68C92F8D6CcC1AbF78F2aB` (immutable, embedded):
  `GetUserTokenAddress`, `has(address,string)`, `AddContractOwner`.
- No other system legs — DO is a thin deed layer, not part of the oracle
  stack.

## 4. State

Decoded from the decompile: `_balances/_allowances/_totalSupply` (ERC20),
`name/symbol`, EIP-2612 `nonces`+domain, `map_g` = Minters allowlist
(unpopulated), `map_e` = per-QING taken flags (bit 0), the CHO immutable.
54 flags set = 54 takes.

## 5. Functions

No recovered source — no mechanical table (the fn-table tool needs source;
if one surfaces, regenerate). Verified onchain `[chain]`:

| selector | signature (from heimdall/resolution) | notes |
|---|---|---|
| `0x8f26e8d5` | `Take(address qing)` | the claim; DO-1's variant stops after the eligibility checks. > ng-correction (session-51 fork + disassembly): the checks key on the WRAPPED asset — `Asset() == GetUserTokenAddress(origin)` ∨ `asset.owner(origin)` ∨ (assets exposing it) `asset.Creator() == origin`; ineligible = silent no-op, second take on a taken venue = silent no-op, asset answering neither probe = raw revert |
| `0x991f0459` | `Minters(address) → bool` | unpopulated allowlist view |
| `0x06fdde03` / `0x95d89b41` | `name()` / `symbol()` | "DO" / 搞 |
| `0x70a08231` / `0xa9059cbb` / `0x23b872dd` / `0x095ea7b3` / `0xdd62ed3e` | ERC-20 face | |
| `0xd505accf` / `0x7ecebe00` / `0x3644e515` / `0x84b0196e` | `permit` / `nonces` / `DOMAIN_SEPARATOR` / `eip712Domain` | EIP-2612 |
| `0x42966c68` / `0x79cc6790` | `burn(uint256)` / `burnFrom(address,uint256)` | |

## 6. Integration notes

- The 54 takes: 34 distinct takers, each QING taken at most once; first takes within minutes of
  deploy, the newest at block 27,565,452 — the deed window stays open for
  the remaining 863 untaken venues (for callers with an asset stake), but nobody has bothered since 2026.
- Notable takers include treasury-side and community actors
  (`0x771a6f6e…` the helpers builder, `0xce28607b…` the cDc fixed slot);
  top taker `0xb900a201…` ×6.
- > ng-correction (session-51 fork-verified): `Take` does NOT require the
  caller to own their user token as a hard gate — the mint TARGET is
  `CHO.GetUserTokenAddress(tx.origin)` and the eligibility is the wrapped-
  asset stake above; the old "same eligibility family as CHOA.Play
  admission" line here was wrong.

## 7. Provenance

- [chain] heimdall decompiles both;
  54 Take receipts decoded (caller/qing/mint-recipient/OwnershipUpdate);
  CHO selector resolution (`GetUserTokenAddress` = `0xe80c28bf` answered
  live; `AddContractOwner` = `0x7fac92c1` matches our recovered CHO source).
- Classification answered onchain; the source gap stays open.
