# TT (PKMinter child) — the PKI-endorsed treasury-dialect token (factory-child TYPE)

> Type doc: children of [PKMinter](./pkminter.md). One live instance ("PKI
> Tester" ㊵) minted in PKMinter's constructor `[chain]`.

## In player terms

| | |
|---|---|
| **Strangers get one word: no** | Everything interesting reverts `FuckOff(address you)` unless you hold permission in the token's internal ladder. The only open door is `ha()` — self-service level 1, enough to leave yourself notes. |
| **A permission ladder, not shares** | `_hu` levels 0–255, granted strictly downward (you can never appoint your own boss). Level gates: 1 writes to your own inbox, 5 writes to others and unlocks the fallback, 10+ may attach value. |
| **The inbox is a message queue** | `ho(counterparty, value)` appends to a per-relationship data inbox — the treasury family's "ho" pattern, where tokens double as communication endpoints. |
| **Tiny by design** | The birth unit is 18 wei (denomination-sized — see Effects below), so the demo token is an exhibit, not a currency. |
| **Not a treasury V2 TT** | The claim/publish economy did NOT come along: the `_hu/ho/FuckOff` vocabulary was borrowed, the claim machinery was not. |

## 1. Identity

| | |
|---|---|
| Type | `Type()` inherited family face; Parent = the creator's LAU |
| Factory | [PKMinter](./pkminter.md) `0x9f4E1471e614747A9a56A33eb0338671ebA1dE2B` |
| Reference instance | the constructor demo: "PKI Tester" / ㊵, 40-of-40 signer set with embedded signatures `[src]` |
| Census | no factory-children census beyond the demo (no user TTs ever observed) `[chain]` |
| Source | `domain/dan/pkminter.sol` (contract `TT` at the bottom of the file) |

## 2. Role

A DYSNOMIA-family token whose FIRST unit mints only when the creator-supplied
public keys have all ECDSA-signed the chosen nonce (single-use) — an
N-party-endorsement birth certificate — combined with the treasury TT
vocabulary: `_hu` permission ladder (255 for the creator), `ho()` permissioned
data inbox, `FuckOff` reverts for strangers, `TTDATA`-echoing fallback,
owner-sweepable `withdraw`.

## 3. Dependencies

- `PKIMinter` (immutable parent registry — msg.sender at construction) and
  `Cho` (immutable).
- `Parent` = `Cho.GetUserTokenAddress(tx.origin)` at construction (the
  creator's LAU), `Creator = tx.origin`.
- `_mathlib` hardcoded = MATH.

## 4. State

`PKIMinter`, `Cho`, `Parent` (LAU), `Creator`, `Mint` (the birth amount),
`_hu` (address → permission 0–255), `_ho` (origin → counterparty → uint256[]
inbox), `PublicKeys[]`, `Complexity`, `UsedNonces`.

## 5. Functions

<!-- fntable: TT @ domain/dan/pkminter.sol -->
<!-- fntable-begin: TT @ domain/dan/pkminter.sol -->
Function table extracted mechanically from `domain/dan/pkminter.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(string memory Name, string memory Symbol, uint8 _Complexity, address ChoAddress, address[] memory Signers, bytes32 Nonce, bytes[] memory Signatures)` | deployer | — | — | `assert` |
| `ValidateSignatures(bytes32 nonce, bytes[] memory signatures) returns (bool)` | public | — | — | — |
| `ha()` | public | — | — | — |
| `ho(address cx, uint256 value) returns (uint256 length)` | public | — | — | `FuckOff` |
| `withdraw(address token, uint256 value)` | public | — | — | `FuckOff` |
| `hu(address h, uint8 allow)` | public | — | — | `FuckOff` |
| `fallback(bytes calldata data) returns (bytes memory)` | public (external) | — | TTDATA | `FuckOff` |
| `receive()` | public (external) | — | — | `FuckOff` |

Events declared: `TTDATA(bytes)`

Errors declared: `FuckOff(address you)`
<!-- fntable-end -->

Effects: `ValidateSignatures` — length check, nonce-reuse check, 65-byte
sig unpack (assembly r/s/v), `ecrecover(nonce) == PublicKeys[i]` for all i;
burns the nonce and mints 1 unit to tx.origin on success. Constructor quirk:
`_mint(tx.origin, 1 * decimals())` = **18 wei**, not 1e18 — the birth unit
is denomination-sized, matching `Mint = 1 * decimals()`. `ha()` — self-grant
`_hu[msg.sender] = 1`. `ho(cx, value)` — inbox append: needs `_hu ≥ 1` for
self-writes, `≥ 5` for third parties (`FuckOff`), `> 10` for value-bearing
appends; returns list length. `withdraw(token, value)` — only the
PKMinter-registered owner. `hu(h, allow)` — grant permissions strictly
downward (caller's own level must exceed both target's and the new level).
`fallback` — `_hu[msg.sender] ≥ 5` or `FuckOff`; echoes calldata as
`TTDATA(bytes)` (the V2-TT fallback-echo family trait). `receive` — same
gate for plain PLS.

## 6. Integration notes

- Interacting as a stranger: expect `FuckOff(address you)` from everything
  except `ha()` (self-grant level 1 — enough for self-inbox writes only).
- The endorsement semantics are external to the contract (see the Sybil note
  in [pkminter.md](./pkminter.md)) — read `PublicKeys(i)` to judge a token's
  signer set.
- No publish/claim surface: this TT is NOT a treasury V2 TT — the `_hu/ho/
  FuckOff` vocabulary is borrowed, the claim economy is not.

## 7. Provenance

- [src] `domain/dan/pkminter.sol`.
- [chain] demo instance via PKMinter constructor (`verify_selectors`).
