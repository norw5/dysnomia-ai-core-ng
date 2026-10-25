# Accounts & chat — the kernel

The kernel (wave 1, 2024-08-23 `[chain]`) is the part of Dysnomia that
makes users and lets them talk. Everything else in the system eventually
rests on it. Dev-level detail with function tables: the
[dev reference](/dysnomia/dev/) pages for each contract named here.

## Souls, SHAs and SHIOs

A user's identity is a `uint64` **Soul** id registered in ZHENG
("CHATLOG Zheng") — the soul registry `[src: 05_zheng.sol]`. Behind each
Soul sits a cryptographic pair built the same way a Diffie-Hellman channel
is:

- a **SHA** — the "cryptographic particle": a small Fa-family state machine
  with a public base and a secret exponent `[src: 02_sha.sol]`;
- a **SHIO** — the *channel* between two SHAs: a token contract whose
  storage holds the conversation state, advanced from both sides by
  `React()` steps `[src: 03_shio.sol]`.

Channel establishment is `Base^Secret mod p`; conversation is a
double-sided orbit over the shared modulus. One honest caveat carried over
from the research layer: the "secrets" are not secret — `SHA.View()`
returns the whole struct including the exponent, and the field is tiny
(MotzkinPrime ≈ 2^49.8). This is ceremony and texture, not confidentiality
`[src: 02_sha.sol]`.

The spine that wires this up is a chain of owning tokens — YI → ZHENG →
ZHOU → YAU → YANG → SIU — each layer holding pieces of the one below
(constructor `addOwner(address(this))` everywhere; the deployer EOA passes
the gates via `tx.origin` `[src]`). Three SHIO channels created inside the
wave-1 constructors became the system's fixed reference points — the
"constellation" channels **Fornax** (YI's), **Fomalhaute** (ZHOU's) and
**Eris** (YANG's) — later hardwired into the derived physics as constants
`[src: 04_yi.sol, 06_zhou.sol, 08_yang.sol]`. The hub contract CHO keeps
its own channel, "Tethys" `[chain]`.

## VOID — the shell

VOID ("CHATLOG Void") is the session layer: `Enter(name, symbol)` logs you
in, `Chat(line)` writes `<username> line` to ZHOU's channel, and a small
attribute library backs per-user strings (Username ≤ 12 chars) and aliases
`[src: 10_void.sol]`. VOID's constructor takes ownership of the whole
spine beneath it — it is the root of the kernel's ownership web.

## LAU — the account token

`LAUFactory.New(name, symbol)` deploys a **LAU**: a personal token whose
name and symbol are your handle, which enters VOID for you, takes shared
ownership of your channel, and acts as your wallet-inside-the-world — it
can hold anything and `Withdraw(token, amount)` it back out, with a log
line `[src: 11_lau.sol, 11c_laufactory.sol]`. The dev's own LAU is
`0xD32c39fEE49391c7952d1b30b15921b0D3b42E69` ("mariarahel", symbol 倫)
`[chain]` — it also receives the "diyat" gas tax inside the system's
random-generator helper `[src]`.

The account census lives on the [hub](/dysnomia): LAU contracts number in
the five digits, SHIO channels alongside them `[chain]`. They are not
individually listed — like treasury children, they are a *census
aggregate*, browsable by count and activity, with entity pages reserved
for the structural ones.

## How a chat line travels

`LAU.Chat(line)` → VOID's session lookup → your SHIO's
`Log(Soul, Aura, line)` → a `LogEvent` on the channel contract `[src]`.
That is the whole journey: no server, no
indexer, no off-chain state — the archive is the event log, and anyone can
replay the world's conversation from block one.
