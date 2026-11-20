# Playbook: fork testing scenarios — the FRESH vs AGED split

> Operator playbook (session-65.6; corrected session-82). The old
> "Beat caller-lineage lock" framing is dead: a fresh account CAN Beat
> once its LAU carries the four-token Eta seed. `manual_fork.py`
> prepares either actor class on one fork: `--onboard` (a fresh key you
> hold, fully onboarded) and `--aged [--aged-beat]` (a proven aged
> wallet, impersonated — see the signing note below).

## The split in one line

A FRESH account can do everything, including Beat, once its LAU is
seeded with `WorldChatSHIO` + `Fornax` and its wallet holds `CHO` +
`Phobos`; an AGED account already has that seed at its LAU (that is why
it Beats). The two classes differ by token prep, not by time.

## FRESH-account scenarios (the key is yours — the app + agent drive)

- **The onboarding chain**: LAU → Username → YUE → register (the
  four-step plan; the preference contract makes it zero-question) — then
  the optional home QING (MAP.New on your LAU), the deed (DO.Take —
  verify by the owner-pass flip, never tx status), and the first settle.
- **The fresh Beat** (session-82): after onboarding, send a little
  `WorldChatSHIO` and `FornaxSHIO` TO THE LAU and hold a little `CHO` +
  `Phobos` (wallet is fine). `RING.Eta()` flips from `(14,0,0,0)` to a
  nonzero shape and `META.Beat` lands (~1.9M gas). The target venue's
  own Yuan is not a revert gate — a fresh home QING Beats with
  `(0,0,0,0)` outputs; Phobos gives real output if you want it.
  There is no age wait and no CHOA-buffer dependency.
- **Your own venue economy**: after the deed you OWN the home venue —
  set a cover charge, run AddMarketRate, then the whole Ⓐ desk
  (purchase/redeem) and the YUE exchange (Hong/Hung) work against YOUR
  venue with real previews. This is the richest fresh-account loop.
- **Guest-list rotation**: set a cover on your venue, Join, watch the
  1-day pass, expire-then-re-Join (the honest rotation — a live pass
  does NOT extend).
- **Chat**: venue lines at your own (or any admitted) venue — gas-only;
  the CHOA bounty leg pays 0 for fresh souls (fork-proven — see the
  corridor experiment). Chat does not seed the Beat legs.
- **Custody + surveys**: move_tokens/sweep_lau, get_venue/get_lau/
  read_contract surveys, the atlas, DEED DRYRUNs on foreign venues
  (silent-no-op honesty), vault tours.
- **The SIM layer** (`--sim`): ENCRYPT notes (fresh LAU creators pass
  the party gates — cipher round-trips fully workable), GWAT spawns
  (the fork registers the CHO-owner gate), WORLD tiles/Code DRYRUNs.
- **What is BLOCKED on fresh**: only the no-YUE `Eta` revert (open the
  YUE first), chat-mining income while CHOA's buffer is empty, and
  anything that genuinely needs the four-token seed before you acquire
  it. "Too young to Beat" is not a blocker.

## AGED-account scenarios (impersonated — see the signing note)

- **META.Beat — the flagship**: DRYRUN previews + committed sends with
  REAL outputs (the aged Beat lands at ~1.9M gas, right at the
  chain-wide median). `--aged-beat` proves it at fork setup. The reason
  it works is the LAU's existing token seed, not a stored age counter.
- **The power game**: Beat output shaping via the constellation
  (Fornax both sides, Tethys=CHO at the venue, the 1/10/40 Yuan
  weighting — holdings parked in the YUE count 40×), settle loops at
  established venues with real bars, chat-mining with nonzero (if
  dust-scale) MAI receipts while a buffer exists.
- **Everything in the fresh list EXCEPT onboarding**: the aged wallet
  already has its LAU/YUE/Username; joins, settles, desks, moves, the
  SIM layer, and the seeded Beat all apply.
- **What is BLOCKED on aged**: the onboarding flow (nothing to
  onboard), and nothing else known.

## The signing note — SUPERSEDED by --aged-transfer

The aged wallets are REAL chain wallets — nobody holds their keys.
`--aged` impersonates them (harness flows + `--aged-beat` work; the app
cannot sign as them). BUT the system has its OWN account-transfer path
(fork-proven, session-65.6): **`--aged-transfer` hands a FORK COPY of a
proven aged account to the wallet key you hold** — `LAU.addOwner(you)` +
`CHAN.TransferYue(yue, you)` + `CHO.Enter(lau)` + a YUE token top-up
(the ZeroHoldings gate). The wallet then reads the aged LAU's
token-seeded Eta slots and Beats through the app + THE gate with a key
you imported. Fork-only simulation — the real owner's chain is
untouched. On LIVE, the same 4-step recipe is how one player genuinely
hands their aged account to another wallet (a MOVE, not a copy:
TransferYue clears the old resolver) — the gate follows the LAU, which
still holds the token seed.

## The one-fork recipe

```
python3 harness/manual_fork.py --aged-transfer --sim --leave
```

gives: a funded wallet key that IS an aged account (Beat-able through
the app!) + the full SIM layer at the overlay. Add `--onboard` on a
SECOND run/fork for the fresh-account scenario class (the flags are
mutually exclusive — the transfer needs a YUE-less wallet).

For a fresh-account Beat, `--onboard` gives you the LAU/YUE; the seed
itself is four ordinary ERC-20 transfers (the playbook above). The
harness does not automate the seed yet — use the holders on the fork or
transfer from a dev account, exactly as the live proof did.
