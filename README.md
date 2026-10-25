# Dysnomia Terminal NG

A client-only frontend and AI agent for **Dysnomia**, the on-chain social OS /
chat world on **PulseChain (chain id 369)**.

Dysnomia has no backend: every identity, venue, message, and balance is an
ERC-20 or a log on PulseChain. This app reads that world directly with `viem`,
renders it through a CRT-terminal interface, and lets an embedded agent explore
and act on it. There is no server, no database, and no telemetry.

## What it does

- **`//agent DECK`** — the default landing surface: a live agent workspace with
  a task graph, venue/map bays, onboarding, a plan checklist, and a chat
  monitor. The agent can read the chain, propose plans, and send transactions
  through the same gate as the UI.
- **CHAT** — the VOID world channel (full seeded archive + live tail) and
  per-venue QING channels, with IRC/RICH layouts, soul-seeded sigils, UTC
  block times, native search, and a right-side line/user pane.
- **MAP** — the HECKE coordinate atlas with the canonical fold-fraction
  framing, live non-seed markers, venue HUD, and the deed/create affordances.
- **IDENTITY** — LAU/YUE passports, the guided entry chain, the recorded
  moment, the DSS self-snipe desk, and the SIM cipher/resource panels.
- **MARKET** — power-token and asset views, the Ⓐ purchase/redeem desk, and
  the YUE Hong/Hung exchange console.
- **DIRECTORY** — LAU, QING, SHIO, YUE, and CHO address-book censuses.
- **STUDIO** — a raw contract console over the canonical ABIs. Every
  state-changing call is simulated first and sent through the transaction
  gate.
- **LEARN** — the player guide and the per-contract engineering reference.

## Requirements

- Node.js 20+ and npm (tested on Node 22)
- A modern browser with EIP-1193/EIP-6963 wallet support for wallet mode A
- Optional: [Foundry](https://book.getfoundry.sh/) (`anvil`) for the local
  fork / SIM path

## Quick start

```bash
cd app
npm install
npm run dev
```

The app starts on `http://localhost:5173` against the default live PulseChain
RPC. No key or account is required to browse.

### Wallet modes

- **A — injected wallet**: EIP-6963 discovery (MetaMask, Rabby, Frame, …).
- **B — local key**: in memory, or passphrase-encrypted in IndexedDB
  (AES-GCM + PBKDF2).
- **C — yolo**: mode B without a per-action approval card, still bounded by
  the policy gate and explicit opt-in.

Every send passes **THE gate**: policy check → DRYRUN (`eth_call` + gas
estimate) → approval resolution → send → receipt decode → journal. There is
no bypass path.

### AI agent

Open **SETTINGS → Agent** and enter an OpenRouter API key (BYOK), or use
`app/.env` for local development:

```dotenv
OPENROUTER_API_KEY=sk-or-...
```

The key is read server-side by the dev server only; it is never a `VITE_`
variable, never inlined into a build, and never written to the journal. Runtime
BYOK keys stay on the device. The default model is `deepseek/deepseek-v4.1-flash`;
any compatible OpenRouter model can be selected. Agent chat/world-write tools
are **off by default** and gated separately.

## Local fork / SIM layer

The live perimeter is forked from PulseChain; the never-deployed layer
(WORLD, VITUS, WAR, H₂O, GWAT, ENCRYPT) can be deployed by the app on a
**local anvil fork**:

```bash
~/.foundry/bin/anvil \
  --fork-url https://rpc.pulsechain.com \
  --hardfork shanghai \
  --fork-block-number 27674000 \
  --port 8545
```

Then point the app at it (SETTINGS → custom RPC, or
`?rpc=http://127.0.0.1:8545` in dev) and open **SETTINGS → SIM BOOTSTRAP**:

1. the preflight checks loopback, chain id 369, anvil, and the forked
   perimeter;
2. **deploy** sends the four pinned creations (`ENCRYPT`, `WORLDFIXED`,
   `WARFIXED`, `GWAT`) through THE gate as the anvil-impersonated **live
   system deployer** — the constructors' owner gates on the forked VOID/CHAN
   require it, and it is **not your wallet**;
3. the actual receipt addresses are written to a runtime overlay and verified
   (VOID library registration, CHAN owners, 1:1 supplies, rates, caps);
4. a separate **fork-only player** can be funded (default 2,000,000 PLS,
   editable) into the connected wallet or a fresh mode-B key.

SIM is strictly loopback-only: a custom real RPC is always **LIVE**, never
SIM. Fork balances and keys are worthless off the fork. No `anvil_*` call is
ever made against a remote RPC.

`npm run build` produces the live-only UI; `npm run build:public` enables the
SIM entry points in the production bundle (the loopback predicate still keeps
every real endpoint LIVE).

## Build & test

```bash
cd app
npm run typecheck
npm run test        # vitest
npm run e2e         # playwright (starts its own dev server)
npm run build
```

First-time Playwright setup: `npx playwright install chromium`. Fork-only e2e
rows self-skip unless an anvil fork is answering on `127.0.0.1:8545`; run them
solo with `--workers 1` against a held fork. Serve `app/dist/` with any static
host after a build.

## Repository layout

| Path | Contents |
|---|---|
| `app/` | React 19 + TypeScript + Vite + viem frontend, the agent, and the tests |
| `config/` | The perimeter address single-source (`addresses.json` / `addresses.ts`) |
| `abi/` | Canonical per-contract ABIs + selector index, generated from the pinned solc build |
| `kb/` | The agent's knowledge base: deployed semantics, contract facts, per-contract dev references |
| `guide/` | The player-facing definitive guide (agent corpus + LEARN) |
| `data/` | Seed data: venues, LAUs, SHIO/YUE censuses, the world-chat archive, the atlas |
| `contracts/` | The recovered Dysnomia source tree (reference + fixture compilation input) |
| `harness/` | Optional anvil fork harness, fixture builders, and runner (Python/Node) |
| `tools/` | Regeneration scripts for the generated ABIs, facts, seeds, render data, and SIM bundle |

Generated artifacts are never hand-edited: `abi/`, `kb/contract-facts.md`,
`app/src/data/contract-facts.json`, the venue render seed, and the shipped SIM
layer bytecode are all produced by the scripts in `tools/`.

### Seed data

- **940** venues (QING) with onchain names/symbols and exact s32 HECKE coordinates
- **18,660** LAU identities with usernames
- **12,363** SHIO channels and **93** YUE vaults (frozen censuses)
- **8,083** world-chat LogEvents, chunked for static hosting

The app's global sync engine catches up new QING venues and world-chat lines
from the live chain between seed refreshes. Census seeds are explicit
snapshots, never presented as live truth.

## Privacy

- No backend, no analytics, no telemetry.
- The only outbound calls are the configured PulseChain RPC and the user's
  own authorised OpenRouter requests.
- Transaction exports write local files; nothing is uploaded.
- `.env` files are gitignored; `app/.env.example` documents the dev key slot.
- Never commit a private key. The anvil test key used by the harness and
  fork-only examples is a public development key and is worthless on the live
  chain.
