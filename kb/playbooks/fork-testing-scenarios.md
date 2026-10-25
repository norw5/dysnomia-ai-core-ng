# Playbook: fork testing scenarios — the FRESH vs AGED split

> Operator playbook (session-65.6). The Beat caller-lineage lock
> (docs/BEAT-NEW-PLAYER-LOCK.md) splits every fork scenario into two
> actor classes. `manual_fork.py` prepares either or BOTH on one fork:
> `--onboard` (a fresh key you hold, fully onboarded) and `--aged
> [--aged-beat]` (a proven-aged wallet, impersonated — see the note on
> signing below).

## The split in one line

A FRESH account can do everything except Beat (and anything downstream
of caller lineage); an AGED account can do everything except the
onboarding flow (it is already onboarded — its identity predates you).

## FRESH-account scenarios (the key is yours — the app + agent drive)

- **The onboarding chain**: LAU → Username → YUE → register (the
  four-step plan; the preference contract makes it zero-question) — then
  the optional home QING (MAP.New on your LAU), the deed (DO.Take —
  verify by the owner-pass flip, never tx status), and the first settle.
- **Your own venue economy**: after the deed you OWN the home venue —
  set a cover charge, run AddMarketRate, then the whole Ⓐ desk
  (purchase/redeem) and the YUE exchange (Hong/Hung) work against YOUR
  venue with real previews. This is the richest fresh-account loop.
- **Guest-list rotation**: set a cover on your venue, Join, watch the
  1-day pass, expire-then-re-Join (the honest rotation — a live pass
  does NOT extend).
- **Chat**: venue lines at your own (or any admitted) venue — gas-only;
  the CHOA bounty leg pays 0 for fresh souls (fork-proven — see the
  corridor experiment).
- **Custody + surveys**: move_tokens/sweep_lau, get_venue/get_lau/
  read_contract surveys, the atlas, DEED DRYRUNs on foreign venues
  (silent-no-op honesty), vault tours.
- **The SIM layer** (`--sim`): ENCRYPT notes (fresh LAU creators pass
  the party gates — cipher round-trips fully workable), GWAT spawns
  (the fork registers the CHO-owner gate), WORLD tiles/Code DRYRUNs.
- **What is BLOCKED on fresh**: META.Beat (panic 0x12 — caller
  lineage, unfixable by funding), chat-mining income (bounty = 0 for
  fresh souls), anything gated on aged lineage.

## AGED-account scenarios (impersonated — see the signing note)

- **META.Beat — the flagship**: DRYRUN previews + committed sends with
  REAL outputs (the aged Beat lands at ~1.9M gas, right at the
  chain-wide median). `--aged-beat` proves it at fork setup.
- **The power game**: Beat output shaping via the constellation
  (Fornax both sides, Tethys=CHO at the venue, the 1/10/40 Yuan
  weighting — holdings parked in the YUE count 40×), settle loops at
  established venues with real bars, chat-mining with nonzero (if
  dust-scale) MAI receipts while a buffer exists.
- **Everything in the fresh list EXCEPT onboarding**: the aged wallet
  already has its LAU/YUE/Username; joins, settles, desks, moves, the
  SIM layer all apply.
- **What is BLOCKED on aged**: the onboarding flow (nothing to
  onboard), and nothing else known.

## The signing note — SUPERSEDED by --aged-transfer

The aged wallets are REAL chain wallets — nobody holds their keys.
`--aged` impersonates them (harness flows + `--aged-beat` work; the app
cannot sign as them). BUT the system has its OWN account-transfer path
(fork-proven, session-65.6): **`--aged-transfer` hands a FORK COPY of a
proven aged account to the wallet key you hold** — `LAU.addOwner(you)` +
`CHAN.TransferYue(yue, you)` + `CHO.Enter(lau)` + a YUE token top-up
(the ZeroHoldings gate). The wallet then reads AGED Eta slots and Beats
through the app + THE gate with a key you imported. Fork-only
simulation — the real owner's chain is untouched. On LIVE, the same
4-step recipe is how one player genuinely hands their aged account to
another wallet (a MOVE, not a copy: TransferYue clears the old
resolver).

## The one-fork recipe

```
python3 harness/manual_fork.py --aged-transfer --sim --leave
```

gives: a funded wallet key that IS an aged account (Beat-able through
the app!) + the full SIM layer at the overlay. Add `--onboard` on a
SECOND run/fork for the fresh-account scenario class (the flags are
mutually exclusive — the transfer needs a YUE-less wallet).
