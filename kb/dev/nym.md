# Nym — "Champion" — the acronym game — **NOT DEPLOYED**

> **NOT DEPLOYED** — complete in source (old-era folder); no code onchain
> `[chain]`. AND incompatible with the deployed CHO revision (below).

## 1. Identity

| | |
|---|---|
| Source | `domain/old/nym.sol` (contract `Nym`, name "Champion" / "NYM") |
| Onchain | absent `[chain]` |
| Cap | hand-set `maxSupply = 11111111111111111111` (11.111111111 tokens) — NOT a constructor lottery, one of the few hand-set caps in the family `[src]` |

## 2. Role

A full on-chain party game: timed rounds, a generated 2–6-letter acronym
(via LibStrings.RandomAcronym), players submit expansions + vote, 100 NYM to
the winner (split on ties), 5 per submission, 1 for voting; idle non-voters
(2 rounds) get kicked. The constructor embeds the entire game description as
a string — the contract is its own manual.

## 3. Dependencies

Constructed with CHO (claims a `Luo()` coordinate + CHO ownership); uses the
CHOINTERFACE surface including **`Cho.CYUN()`** (LibStrings accessor),
`Cho.Shio()`, `Cho.Omicron()`, `Cho.Reactor()`, `Cho.React(uint64)` — a
RICHER interface than the deployed CHO.

**Interface-drift finding `[chain, 2026-09-21]`**: the deployed CHO
`0xB6be11F0A788014C1F68C92F8D6CcC1AbF78F2aB` **reverts** on `CYUN()`,
`Log(uint64,uint64,string)` and `OperatorSendMSG(string)`. NYM as written —
whose Chat path calls `Cho.CYUN()` on every message — could not run against
the live CHO. Either NYM predates a CHO revision that had these selectors,
or the interface was written against a planned surface that never shipped.
(Live CHO getters verified present: `Gua()`, `Void()`, `On()`, `Entropy()`,
`Reactor()`.)

## 4. State

`Cho`, `Waat` (its venue coordinate claim), round state (`RoundNumber`,
`AcronymCount`, `Acronyms`, `LastUserVote`, `_users`, `_players`, `Active`,
`Acronym`, `RoundStartTime`), `Prize` (100), `RoundMinutes` (10),
`MinPlayers` (5), `MaxAcronymLength` (6).

## 5. Functions

<!-- fntable: Nym @ domain/old/nym.sol -->
<!-- fntable-begin: Nym @ domain/old/nym.sol -->
Function table extracted mechanically from `domain/old/nym.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address ChoAddress)` | deployer | — | — | — |
| `SetDescription(string memory _d)` | owners | — | — | — |
| `SetMaxAcronymLength(uint8 _m)` | owners | — | — | — |
| `SetRoundMinutes(uint8 _m)` | owners | — | — | — |
| `SetMinPlayers(uint8 _m)` | owners | — | — | — |
| `ActivePlayers() returns (uint256)` | public | — | — | — |
| `GetPlayerBySoul(uint64 Soul) returns (User memory)` | owners | — | — | — |
| `Join(address UserToken)` | public | — | JoinedUser | — |
| `Leave()` | public | — | — | — |
| `_removeUserBySoul(uint64 Soul)` | internal | — | — | — |
| `Kick(uint64 _soul)` | owners | — | KickedUser | — |
| `Start()` | owners | — | — | `NotPlaying` |
| `NewRound()` | internal | — | InactiveUser | — |
| `Vote(uint16 Id)` | public | — | — | `assert` |
| `EndRound()` | internal | — | Winner | — |
| `GetAcronym(uint16 idx) returns (ACRONYM memory)` | public | — | — | — |
| `Submit(User memory Alpha, string memory Beta)` | internal | — | AcronymSubmission | — |
| `NewAcronym()` | internal | — | NewRoundAcronym | — |
| `Chat(string memory chatline)` | public | — | — | — |
| `Log(uint64 Soul, uint64 Aura, string memory LogLine)` | internal | — | LogEvent | — |
| `OperatorSendMSG(string memory chatline)` | owners | — | — | — |
| `ReactPlayer(uint64 Soul, uint64 Theta) returns (uint64 Omicron, uint64 Omega)` | public | — | — | `NotPlaying` |

Events declared: `JoinedUser(uint64 Soul, string Username)` · `KickedUser(uint64 OperatorSoul, string OperatorUsername, uint64 UserSoul, string Username)` · `InactiveUser(uint64 UserSoul, string Username)` · `Winner(uint64 Soul, string Username, string Phrase, uint16 Prize)` · `AcronymSubmission(uint64 Soul, string Username, uint16 Id, string Phrase)` · `NewRoundAcronym(string Acronym)` · `LogEvent(uint256 Waat, uint64 Soul, uint64 Aura, string LogLine)`

Errors declared: `NotPlaying(uint64 Soul)`
<!-- fntable-end -->

Effects: `Join(UserToken)` — enters via CHO, registers, and starts a round
at MinPlayers. `Vote(id)` — 1 NYM per round voted, advances entropies,
ends the round on timeout. `Submit` (internal, via `Chat` when the line
matches the acronym!) — up to 5 NYM per player per round. `EndRound` —
tallies, splits the prize among tied winners, emits `Winner`. `NewRound` —
kicks 2-round-idle players (`InactiveUser`), regenerates the acronym.
`Kick` — owners-gated removal with chat log. `Chat(line)` — the game input
surface: acronym-matching lines become submissions, others become venue
chat. NOTE: `ReactToTalk(User memory)` results are DISCARDED here (call by
value, no reassignment) — a latent bug in the undeployed design `[src:
lib/reactions_core.sol ReactToTalk + nym.sol Chat]`.

## 6. Integration notes

- Reference-only (undeployed + incompatible). The submit-through-chat trick
  (the game lives inside the chat surface) is the interesting design pattern.

## 7. Provenance

- [src] `domain/old/nym.sol`,
  `lib/reactions_core.sol`, `lib/stringlib.sol`.
- [chain] CHO selector probes.
