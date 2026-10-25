# The economy — YUE vaults, bounties, and the internal exchange

Wave 5 (2025-06-13 → 16 `[chain]`) built the account economy: personal
vault tokens, a chat-to-mine bounty, a consent escrow, and the settle
primitive the undeployed world layer would have consumed.

## SEI and the YUE account tokens

`SEI.Start(yourLAU, name, symbol)` enters you and mints a personal **YUE**
— an account/vault token, one per wallet `[src: domain/sky/01_sei.sol,
02_yue.sol]`. A YUE is deliberately not a currency:

- **earnings land in it** — CHOA chat bounties are paid straight into the
  holder's YUE;
- **withdrawals leave it only through consent** — the CHAN escrow (below)
  must hold your explicit `OptIn` before any contract can move funds out;
- **it carries an exchange desk** — see below.

The YUE census (93 at the research pass, still growing `[chain]`) is on the
[hub](/dysnomia).

## CHAN — the directory and consent escrow

CHAN keeps the `origin → YUE` directory and is the custodian of every YUE's
mint. Its `OptIn(contract, allow)` is an allowance system at the *account*
layer: authorize a contract to withdraw from (or force-transfer, in a
currently-disabled variant `[src: yue.sol:122-128]`) your YUE holdings
`[src: domain/sky/03_chan.sol]`.

## CHOA — chat-to-mine

CHOA's `Chat(qing, msg)` is venue chat that pays: it advances your bars,
then pays `min(MAI(soul, waat), 1e18)` of MAI from CHOA's own balance into
your YUE `[src: domain/tang/01_choa.sol]`. Its `Yuan(currency)` is the
purchasing-power modulus used across the ladder:
`bal(tx.origin) + 10×bal(LAU) + 40×bal(YUE)` — a weighted wallet over
your EOA, your account token and your vault `[src]`.

## CHEON — the settle primitive

`CHEON.Su(qing)` is the settlement leg: advance, pay out, mint to origin,
and return the current `(Charge, Hypobar, Epibar)` bars. The undeployed
WORLD layer's tile placement would have consumed it directly `[src:
domain/tang/03_cheon.sol]`.

## The internal exchange

Every token in the DYSNOMIA family carries `Purchase`/`Redeem` at
internally-tracked market rates, with **AFFECTION**
`0x24F0154C1dCe548AdF15da2098Fdd8B8A3B8151D` seeded 1:1 everywhere
`[src: 01_dysnomia.sol]` — so Ⓐ buys Dysnomia assets directly, and wallets
use it that way `[chain: Purchase(address,uint256) census]`.
The YUE desk goes further: `Hong(spend, qing, amount)` / `Hung(qing,
receive, amount)` exchange QING-family assets by walking the
QING-on-QING derivative chain and multiplying rates with a 777-mod
attenuation (`Rate /= (777 − Mod) × 10^(d−5)` when `Mod < 777`) `[src:
yue.sol]` — a discount curve built out of the same orbit arithmetic as
everything else.

Value therefore moves between the treasury side and Dysnomia through the
ordinary token machinery — no bridge, no wrapper: AFFECTION in, assets
out. The structural cross-holdings are mapped on the
[bridge page](/dysnomia/guide/bridge).
