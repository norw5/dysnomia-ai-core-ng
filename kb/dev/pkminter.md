# PKMinter — the treasury-bridge PKI experiment

> Wave 7 · 2026-05-30 04:50 UTC · deployed `[chain]` — the literal bridge
> between Dysnomia and the treasury system, ~10 months after the kernel

## In player terms

| | |
|---|---|
| **Mint a token that needs signatures to be born** | `New(...)` deploys a child token whose first unit only mints after N public keys you chose have each ECDSA-signed your nonce. A birth certificate countersigned by a key set — the N-party endorsement shape. |
| **Your LAU is the parent** | The child's `Parent` is YOUR account token (looked up via CHO), not any treasury asset. The bridge is vocabulary and wiring, not parenthood. |
| **The honest small print** | Nothing forces the keys to belong to other people — you can self-sign with fresh keys. The mechanism is PKI plumbing; an endorsement means only as much as its keys mean outside the contract. |
| **A museum of the treasury dialect** | The file hardcodes all five treasury minters by name and lets children query V3 for token ownership — one contract citing both worlds, which is why we call it THE bridge. |
| **One demo exists** | A 40-of-40 signer "PKI Tester" minted in the constructor; no user children observed yet `[chain]`. |

## 1. Identity

| | |
|---|---|
| Address | `0x9f4E1471e614747A9a56A33eb0338671ebA1dE2B` |
| Creation | block 26,657,637 — 2026-05-30 04:50 UTC (tx `0x377235ecdcb5b40177de83bb5ef7b16d184762a2f13c8186420621264c7b1f1c`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Token | none — plain contract (not a DYSNOMIA token itself) |
| Demo child | "PKI Tester" / ㊵ — a 40-of-40 ECDSA demo minted in the constructor `[src]/[chain]` |

## 2. Role

A public-key-infrastructure mint factory whose TT children speak BOTH
dialects: treasury (`_hu` permission ladder, `ho()` inbox, `FuckOff`
reverts for strangers, `TTDATA`-echoing fallback) and Dysnomia (Parent = the
creator's LAU, admission through CHO.VerifyUserTokenPermissions, `_mathlib` =
MATH). It hardcodes all five treasury minters as named constants and
delegates `GetTreasuryTokenOwner` to V3 IndexMinter when a token is not its
own — a literal cross-system dependency graph in one file.

## 3. Dependencies

- Hardcoded `[src]`: TreasuryMinter (V1) `0xC7bDAc3e6Bb5eC37041A11328723e9927cCf430B`,
  FederalMinter (V2) `0xc15c5F699Daf5e1135732139f05D2c05b3EF4354`,
  BureauMinter (BUREAU root) `0x0b92aD7eD0da6c44Bf71B3FCEe668D1670000Ff5`,
  IndexMinter (V3) `0x0c4F73328dFCECfbecf235C9F78A4494a7EC5ddC`,
  PersonalMinter (V4) `0x394c3D5990cEfC7Be36B82FDB07a7251ACe61cc7`,
  mathlib MATH `0xB680F0cc810317933F234f67EB6A9E923407f05D`.
- Calls CHO (GetUserTokenAddress / VerifyUserTokenPermissions) — creating a
  TT requires a registered LAU; deploys [TT](./pk-tt.md) children.

## 4. State

`Cho`, `MRPK` (the constructor's demo TT), `TreasuryTokens: token → owner`.

## 5. Functions

<!-- fntable: PKMinter @ domain/dan/pkminter.sol -->
<!-- fntable-begin: PKMinter @ domain/dan/pkminter.sol -->
Function table extracted mechanically from `domain/dan/pkminter.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address ChoAddress)` | deployer | — | — | — |
| `GetStandardTokenParent(address ctx) returns (address)` | public | — | — | — |
| `GetTreasuryTokenOwner(address ctx) returns (address)` | public | — | — | — |
| `Transfer(address ctx, address newOwner)` | public | — | — | — |
| `New(string memory Name, string memory Symbol, uint8 Complexity, address[] memory Signers, bytes32 Nonce, bytes[] memory Signatures) returns (address)` | public | — | — | — |
<!-- fntable-end -->

Effects: `New(Name, Symbol, Complexity, Signers, Nonce, Signatures)` —
deploys a TT; the TT constructor checks CHO admission, requires
`Signers.length == Complexity`, ecrecover-verifies every signature against
the nonce (single-use), and only then mints the first unit to the creator;
`TreasuryTokens[new] = tx.origin`. **The Sybil answer:** the signer set is creator-supplied — you can generate N fresh
keys and self-sign. The mechanism is PKI plumbing, not proof-of-other-people;
a token's meaning lives in whether its REGISTERED keys are meaningful outside
the contract.** `GetStandardTokenParent` walks the LAU-Parent chain while
tokens stay in the registry. `GetTreasuryTokenOwner` — registry hit, else
delegates to V3 IndexMinter. `Transfer(ctx, newOwner)` — tx.origin-gated
re-registration.

## 6. Integration notes

- Creating a TT requires: a registered LAU (CHO), N signer pubkeys, and one
  ECDSA signature per key over the chosen nonce — all self-producible.
- The demo instance pins a 40-key set with matching signatures in the
  constructor source — a frozen exhibit of the intended "N-party endorsement"
  shape.
- The TT's Parent is the LAU, NOT a treasury token — the treasury linkage is
  the minter-constant set + the V3 owner-delegation, not the parent chain.

## 7. Provenance

- [src] `domain/dan/pkminter.sol`.
- [chain] perimeter; `verify_selectors.json` (TreasuryMinter…Cho selectors
  all present onchain).
