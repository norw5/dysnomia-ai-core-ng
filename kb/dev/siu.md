# SIU — "CHATLOG Siu" — the user gate

> Wave 1 · 2024-08-23 00:48 UTC · deployed `[chain]` · at cap

## In player terms

| | |
|---|---|
| **The turnstile you passed at signup** | Every one of the 18,660 accounts `[chain]` was born through SIU's single factory call — your wallet hit LAUFactory, and somewhere under the hood this contract stamped your identity. |
| **Your aura is your address** | `Aura() = your wallet address mod MotzkinPrime` — a small number derived from your public key. Two things follow from the same source: who you pay from, and the "vibe" the world reads off you. |
| **Your three numbers** | SIU assembles every user's identity triple: slot 0 = the shared kernel coordinate (everyone's identical), slot 1 = a fresh random Soul drawn at birth (yours alone, forever), slot 2 = your aura. |
| **One deliberate hands-off** | At birth SIU renounces the system's ownership of your Cone SHA — one half of your channel belongs to you alone from the first block. |

## 1. Identity

| | |
|---|---|
| Address | `0x43136735603d4060f226c279613a4dd97146937c` |
| Creation | block 21,220,702 — 2024-08-23 00:48 UTC (tx `0x2f48e5e3cefed1f71ae8d08d44bb77a7b19b1546b22fcc05545b7df2102e0ab0`) |
| Deployer | `0x0474606332105A1dA6FC8EF7De2470551D389Cb9` |
| Name / symbol | CHATLOG Siu / SIU `[chain]` |
| Supply / cap | 8,292 / 8,292 — **at cap** `[chain]` |

## 2. Role

The single function that matters: `Miu(name, symbol)` creates a USER — it
calls ZHENG.Mau with `Saat = [YANG.Pole(2), Xiao.Random(), Aura()]`, then
renounces `tx.origin` ownership of the user's Cone SHA and registers the cone
at market. `Aura() = uint64(uint160(tx.origin)) % MotzkinPrime` — **your
address IS your aura**; the middle slot is a fresh Random() draw (your Soul).
Every LAU ever created (18,660 `[chain]`) was born through this gate via
VOID.Enter → SIU.Miu.

## 3. Dependencies

Owns the entire YANG→…→YI chain (constructor adds itself down the spine).
Called by VOID.Enter (user creation), VOID.Enter() (session re-entry reads
Pole via Nu). SIU's own entropy contributions feed every user's Saat[2].

## 4. State

`Psi` (YANG) only.

## 5. Functions

<!-- fntable: SIU @ 09_siu.sol -->
<!-- fntable-begin: SIU @ 09_siu.sol -->
Function table extracted mechanically from `09_siu.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor(address YangAddress)` | deployer | — | — | — |
| `Augment()` | internal | meter | — | — |
| `Aura() returns (uint64)` | public | — | — | — |
| `Miu(string memory name, string memory symbol) returns (uint64[3] memory Saat, Bao memory On)` | owners | meter | — | — |
<!-- fntable-end -->

Effects: `Aura()` — public view, no meter (pure function of the caller).
`Miu` — the user factory described above; the renounce step means the system
never owns the user's Cone (a deliberate privacy/authority boundary).

## 6. Integration notes

- Do not call Miu directly unless you are the spine; use LAUFactory.New (it
  wires VOID sessions + LAU ownership correctly).
- At-cap note: SIU's meter is exhausted, but Miu passes through ZHENG.Mau —
  and ZHENG is also at cap; user creation still works because cap only stops
  the self-mint, never the logic. New LAUs were still being created the week
  of the census `[chain]`.

## 7. Provenance

- [src] `09_siu.sol`.
- [chain] perimeter; LAU census 18,660 (`factory_children.json`).
