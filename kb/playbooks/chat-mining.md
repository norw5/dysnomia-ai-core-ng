# Playbook: chat-mining economics (CHOA.Chat)

> Operator playbook (session-65). Checked against kb/deployed-semantics.md
> §3 — including the NAME TRAP the old playbooks got wrong: **chat pays
> CHOA, never "MAI"** (`uint256 Mai` is a variable name; the token that
> moves is CHOA from CHOA's own balance).

## The one-line economics

`CHOA.Chat(Qing, msg)` posts one venue line AND settles into your YUE: it
routes through the venue's FULL door rules (QING.Chat admission — see the
guest-list playbook), advances your venue bars (ReactYue), and pays
`min(MAI.React(soul, waat), 1e18)` — up to **1 CHOA per call** — from
CHOA's OWN balance into your YUE, but **only while CHOA's buffer is
non-empty** (`balanceOf(CHOA) >= Mai`). Contract-funded, never caller-paid.

Your cost: GAS only (plus the metered supply-side mint of 1 CHOA to CHOA
itself — a supply fact, not a caller cost). Prerequisites: a REGISTERED LAU,
Username set, a YUE open, and venue admission.

## Volume, not length

The bounty is capped at 1 CHOA per CALL — twenty short messages earn up to
twenty; one long message earns one. Frequency over length (the in-app fence
caps lines at 280 chars anyway). Each call is metered and permanent: the
line is public onchain content forever — mine with lines worth keeping.

## Buffer honesty (check before looping)

While CHOA's buffer is empty, Chat still works but pays NOTHING — the
transfer leg silently skips. Before a mining loop, read CHOA's own balance
(`read_contract CHO balanceOf <CHOA address>`); a thin buffer means the
economics are gas-out-only. Never promise the operator income the buffer
cannot fund.

## Discipline

- Every send goes through THE gate; DRYRUN first, then `send=true`.
- `send_world_chat` is opt-in (§7.4) and off by default — it is the only
  chat-mining surface; respect the operator's toggle.
- No spray: repeated identical lines are permanent public noise. Vary the
  content or don't send it.

## The DSS self-snipe (AVAILABLE — session-66)

The DSS (Dysnomia Self-Snipe) is an OPERATOR-DEPLOYED bundler, NOT
perimeter: `chatAndSnipe(text)` posts your world line ("<Username> …"
onto the world/main SHIO — the LAU.Chat path) AND self-purchases the
minted LAU unit for exactly 1 Ⓐ in the SAME tx — no front-run window.
The as-shipped community gist is broken (it binds address(0); kb §DSS);
the app ships the ONE-LINE-FIXED bytecode and deploys it through THE
gate (IDENTITY → the LAU emission desk; a creation tx — its own risk
class). The app remembers the address from the creation receipt (the
contract has no getter — deployed-elsewhere reads as not deployed).

Routes once deployed: the desk console, the CHAT composer's
"WORLD + DSS" leg, and the agent's `dss_snipe` (§7.4-fenced, OFF by
default). Plain world lines without a snipe exist too (LAU.Chat — the
composer's WORLD leg) but leave the minted unit in the purchasable pool.

The snipe's Ⓐ ALLOWANCE is once-per-snipe (exact 1e18, spent by the
purchase): while it is short, `send=true` issues TWO gate sends (the
exact-1 Ⓐ APPROVE first, then the snipe), and the RAW snipe DRYRUN
REVERTS (the Purchase inside pulls 1 Ⓐ via transferFrom) — that revert
is EXPECTED, not a broken bundler; the agent tool's DRYRUN previews the
two-leg path (session-69; fork-pinned set-2 s7/s8).

## The emission pool (collect without chatting)

Every owner action on your LAU meters 1 unit into its OWN balance — and
that pool is PUBLICLY PURCHASABLE at 1 Ⓐ/unit by anyone (LAU feeds Yuan
×10 and the soeng ladder: uncollected emission is power someone else can
buy). You do NOT need to chat to mint: `LAU.mintToCap()` mints silently
(no world line — repeat per unit), and ONE
`LAU.Purchase(AFFECTION, N×1e18)` collects N units for N Ⓐ. The manual
desk (IDENTITY) exposes exactly this: silent mint + batch collect, with
the front-run honesty note.
