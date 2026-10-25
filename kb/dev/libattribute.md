# LibAttribute — "CHATLOG LibAttribute" — string attributes + address aliases

> Wave 1 · 2024-08-23 00:50 UTC · deployed `[chain]`

## In player terms

| | |
|---|---|
| **Your display name's storage** | The "Username" your chat lines are stamped with (max 12 characters) is stored here, keyed by your soul. VOID and LAU are the front counters; this is the filing cabinet. |
| **Profile fields, schema-controlled** | Attributes are name → string with a system-set max length. Only the schema is managed centrally; the values are per-soul and yours. |
| **Address aliases** | A second per-soul namespace maps addresses to short strings (≤32 chars) — the "grades". Useful for pinning labels like favorite venues to your identity. |
| **Reads are owner-gated** | Even the getters require the MultiOwnable pass — indexers get usernames more cheaply from chat LogEvents, which carry them verbatim. |

## 1. Identity

| | |
|---|---|
| Address | `0x529e3e15da19c7c828f9cce13c53f7031a30ec7c` |
| Creation | block 21,220,714 — 2024-08-23 00:50 UTC (tx `0xeb08f1d070f5dfbf8e19f6201d94f80760480d89142d1fb1fca7a0369ba08b68`) |
| Deployer | `0x0474606332105A1d389Cb9` (full: `0x0474606332105A1dA6FC8EF7De2470551D389Cb9`) |
| Name / symbol | CHATLOG LibAttribute / LibAttribute `[chain]` |
| Supply / cap | 18,912 / 32,458 — liquid `[chain]` |
| Library name | `libattribute` (self-registered on VOID at construction) |

## 2. Role

The string-key/value store behind user identity dressing: attributes
(`_attributes` name → max length; `Username` capped at 12 chars, seeded
`TestAttribute` at 140) and per-soul address aliases (`_userGrades`:
soul → address → string, ≤32 chars — "grades" in the source). VOID and LAU
expose thin wrappers; nothing user-facing writes here directly.

## 3. Dependencies

Constructed with the VOID address; owned by VOID (`addOwner(VoidAddress)`).
Called by VOID (`Set`/`Get`/`Alias`), LAU (via VOID wrappers). Note `Get` and
the Alias readers are `onlyOwners` — they pass because VOID/LAU are owners and
tx.origin delegation carries the EOA.

## 4. State

`Void`, `_attributes`, `_userAttributes` (soul → name → string),
`_userGrades` (soul → address → string).

## 5. Functions

<!-- fntable: ATTRIBUTE @ lib/attribute.sol -->
<!-- fntable-begin: ATTRIBUTE @ lib/attribute.sol -->
Function table extracted mechanically from `lib/attribute.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address VoidAddress)` | deployer | meter | — | — |
| `addAttribute(string memory name, uint8 maxLength)` | owners | meter | — | — |
| `removeAttribute(string memory name)` | owners | meter | — | — |
| `Set(uint64 Soul, string memory name, string memory value)` | owners | meter | — | `MaximumLength` |
| `Get(uint64 Soul, string memory name) returns (string memory _a)` | owners | — | — | `AttributeNotFound` |
| `Alias(uint64 Soul, address name, string memory value)` | owners | meter | — | `MaximumLength` |
| `Alias(uint64 Soul, address name) returns (string memory _a)` | owners | — | — | `AliasNotFound` |
| `Alias(uint64 Soul, Bao memory entity, string memory value)` | owners | meter | — | `MaximumLength` |
| `Alias(uint64 Soul, Bao memory entity) returns (string memory _a)` | owners | — | — | `AliasNotFound` |

Errors declared: `MaximumLength(string value, uint256 length, uint8 maxLength)` · `AttributeNotFound(string name)` · `AliasNotFound(address name)`
<!-- fntable-end -->

Effects: `addAttribute`/`removeAttribute` manage the schema (max length 0 =
unusable); `Set` enforces the length cap (`MaximumLength`); `Get` reverts
`AttributeNotFound` on empty (missing) values — a deliberate
"no silent default" choice; the two `Alias` writer overloads cap values at 32
chars, the readers revert `AliasNotFound`.

## 6. Integration notes

- Reading a user's display name: `VOID.GetAttribute` from the user's own
  session context, or compute soul → `LibAttribute.Get` (owner-gated!); for
  indexers, the Username is more cheaply scraped from chat LogEvents, which
  carry it verbatim.
- The constructor mints 1 unit to `tx.origin` directly (a small origin-mint
  variant unique among the libs).

## 7. Provenance

- [src] `lib/attribute.sol` (contract `ATTRIBUTE`).
- [chain] perimeter.
