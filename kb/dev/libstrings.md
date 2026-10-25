# LibStrings — "DYSNOMIA LibStrings" — string utilities library

> Wave 2 · 2025-02-25 20:09 UTC · deployed `[chain]` · essentially unused

## In player terms

| | |
|---|---|
| **A toolbox that arrived early for a party that never came** | Registered itself as the "strings" library in the wave-2 boot… and has been called by no one since (supply 1 — its own constructor tick `[chain]`). It was built to serve the undelivered acronym game. |
| **What it would have done** | Palindrome checks, reversals, random acronyms, case-insensitive compares — the raw material for word games that were designed but never shipped (see the NOT-DEPLOYED [NYM](./nym.md)). |
| **Usable anyway** | Pure string helpers are free to call for any contract that wants them; the toolkit simply has no customers in the deployed system. |

## 1. Identity

| | |
|---|---|
| Address | `0x4ab87f1DBDF6f741ED8BF481C7346103a86f1068` |
| Creation | block 22,804,467 — 2025-02-25 20:09 UTC (tx `0xef457cf72895d1d1ab9b50ec5178e0fe08e0b543c44a18558a35c2a943ad552a`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | DYSNOMIA LibStrings / LibStrings `[chain]` |
| Supply / cap | 1 / 45,114 — the constructor's single tick; nobody has called it since `[chain]` |
| Library name | `strings` |

## 2. Role

A general-purpose string/byte toolkit: palindromes, reversal, acronym
generation/checking, case-insensitive compare, decimal formatting (`String`),
hex formatting. Built to serve the acronym game (see the undeployed
[NYM](./nym.md), which calls this surface as `Cho.CYUN()`); on the live system
it registered and then went quiet.

## 3. Dependencies

Constructed with VOID (adds VOID + tx.origin as owners, registers as
"strings"). `RandomAcronym` draws from `Xiao.Random()`.

## 4. State

None beyond the DYSNOMIA base (all functions pure except `RandomAcronym`).

## 5. Functions

<!-- fntable: STRINGLIB @ lib/stringlib.sol -->
<!-- fntable-begin: STRINGLIB @ lib/stringlib.sol -->
Function table extracted mechanically from `lib/stringlib.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address VoidAddress)` | deployer | meter | — | — |
| `CheckPalindrome(string memory S) returns (bool)` | public | — | — | — |
| `CheckPalindrome(bytes memory S) returns (bool)` | public | — | — | — |
| `Reverse(string memory S) returns (string memory Reversed)` | public | — | — | — |
| `Reverse(bytes memory S) returns (bytes memory Reversed)` | public | — | — | — |
| `RandomAcronym(uint8 MaxLength) returns (bytes memory Acronym)` | public | meter | — | `MinimumLength3` |
| `CaseInsensitiveCompare(bytes1 A, bytes1 B) returns (bool)` | public | — | — | — |
| `CheckAcronym(string memory _A, string memory _B) returns (bool)` | public | — | — | — |
| `CheckAcronym(bytes memory _acronym, string memory _Beta) returns (bool)` | public | — | — | — |
| `log10(uint256 value) returns (uint256)` | public | — | — | — |
| `String(uint256 value) returns (string memory buffer)` | public | — | — | — |
| `Hex(address account) returns (string memory)` | public | — | — | — |
| `Hex(uint256 value) returns (string memory)` | public | — | — | — |
| `Hex(bytes32 value) returns (string memory)` | public | — | — | — |
| `Hex(bytes memory data) returns (string memory)` | public | — | — | — |

Errors declared: `MinimumLength3()`
<!-- fntable-end -->

Effects: `RandomAcronym(MaxLength)` — length 2 + Random()%(Max−2) letters;
reverts `MinimumLength3` below 3. `CheckAcronym(acronym, phrase)` —
case-insensitive first-letter-of-words matcher. `String/Hex/log10` mirror the
base v1 helpers as pure functions.

## 6. Integration notes

- Interface drift finding `[chain, 2026-09-21]`: the deployed CHO **reverts**
  on `CYUN()` — the accessor NYM's interface expects. NYM as written cannot
  run against the live CHO revision (see [nym.md](./nym.md)).
- Usable today by any contract as a pure string library; nothing in the
  deployed set calls it.

## 7. Provenance

- [src] `lib/stringlib.sol` (contract `STRINGLIB`).
- [chain] perimeter; CHO `CYUN()` revert probe.
