# Playbook: guest-list rotation (the 1-day pass, honestly)

> Operator playbook (session-65). Checked against the deployed source
> (`03_qing.sol` Join/Admitted/Chat, verbatim) — the old community playbook's
> "re-Join at the 23-hour mark to refresh" is IMPOSSIBLE on the deployed
> system; this file carries the real rotation.

## How the pass actually works (deployed semantics)

- `Join(LAU)` pays the CoverCharge ONLY when your pass is expired
  (`_list[lau] < block.timestamp`), then grants a **1-day window**. The
  charge is a `transferFrom` in the VENUE's wrapped asset — your allowance
  must exceed the cover BEFORE the Join (`CoverChargeUnauthorized`
  otherwise); the exact-amount approve first is the standard prerequisite.
- **A Join while the pass is still live is a near-NO-OP**: it skips the
  charge AND does NOT extend the window (`if (_list < now) _list = now +
  1 days` — a live pass is left untouched). Gas spent, meter ticked,
  nothing gained. `AlreadyJoined` is dead code — declared, never reverted:
  Join never refuses for being already joined.
- `QING.Chat` NEVER pays the cover itself: with a cover set, chatting on an
  expired pass reverts (`NotAdmitted` / `PayCover`). Access = a live pass.
- `CHOA.Chat` routes through the same door — the rotation applies to
  chat-mining too.
- Zero-cover venues (`CoverCharge == 0`) skip all of this — admission is
  always true.

## The honest rotation

1. Let the pass EXPIRE (24h from the Join), then re-Join: you pay the cover
   again and receive a fresh 1-day window. Refreshing early is wasted gas.
2. Plan the visit inside one window: Join → chat / settle / beat → leave.
   Don't leave value-earning activity straddling the expiry.
3. Staff never pays: bouncers pass the door free (the four-way door pass) —
   and your HOME QING staffed you at creation, so your own venue never
   charges you cover.
4. Before the Join: read the cover (`get_venue` → coverCharge), check your
   venue-asset balance ≥ cover, and DRYRUN the Join — the bouncer cascade
   and allowance gate reveal honestly in the preview.

## Standing notes

- Previews are pure; the committed call re-runs every gate. State plainly
  which state the operator is in (DRYRUN vs sent).
- Positive framing: a cover is a venue's door policy, not a fee schedule.
