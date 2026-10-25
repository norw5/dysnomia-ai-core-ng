import { makeClient } from "@/chain/client";
import { fmtAmt } from "@/chain/identity";
import { simLayerActive } from "@/chain/simMode";
import { decodeGwatSpawned, encodeGwatSpawn, encodeWorldCode, readGwatForbidden, worldAbi } from "@/chain/worldLayer";
import { decodeNewQing } from "@/chain/venueDeed";
import { decodeDecryptPlain, decodeEncryptIndex, encodeDecryptString, encodeEncryptString, readSoulId } from "@/chain/encryptDesk";
import type { GateRequest } from "@/chain/txGate";
import type { AgentTool } from "@/agent/tools";
import { capOutput, dryrunGateSummary, outcomeSummary, requireSendFlag, resolveVenue, str } from "@/agent/toolShared";

/**
 * The SIM-scoped agent tools (session 59, IA-PLAN §8 arc part 2): thin act
 * tools over the FORK-VERIFIED never-deployed-layer semantics (harness set 3
 * — the s9 loop proof for Code/Gwat, the s11/12 round-trip pins for ENCRYPT).
 *
 * GATING: the catalog advertises them ONLY in sim mode
 * (`toolCatalog(chat, simToolsEnabled)`); outside it they are unknown tools
 * (plans referencing them die at the schema fence). The execute path checks
 * `simLayerActive` first and lets `simAddr` throw structurally — never a
 * fallback. SIM-layer sends classify unknown-contract (extra ack) — intended.
 *
 * HONESTY STORIES riding the results (the session-58 findings):
 * - Code's "Latitude" is Compliment's FIRST word (the swapped convention);
 * - Charge==0 is a silent no-op; a crediting claim needs the full venue/
 *   caller stack and an AGED caller (fresh callers see honest zeros);
 * - the GWAT spawn needs a prior claim on the parent (the cauda), the
 *   parent ≥777 own supply (the rate cap), and each attempt is a fresh
 *   draw (retry on SpawningFailure);
 * - the ENCRYPT index is deterministic (preview == committed) and the only
 *   handle — it travels offchain with the key.
 */

function simGateNote(): string {
  return "SIM fixture — the gate classifies it unknown-contract (extra ack, intended; a future live deployment would carry NEW addresses)";
}

const worldCode: AgentTool = {
  name: "world_code",
  risk: "act",
  description:
    'SIM-ONLY (advertised only on a loopback local fork): WORLD.Code(lat, lon, venue) — the composed coordinate claim on the never-deployed world layer: settles the venue (CHEON.Su), beats (META.Beat), adds the tile mass and mints VITUS royalties to your YUE. lat/lon are INTEGERS in Code\'s SWAPPED convention (its "Latitude" is HECKE.Compliment\'s FIRST word — get the anchor from get_venue\'s seed rows or the venue panel). Bounded by Yeo around the venue\'s anchor (OutOfRange beyond); a claim with Charge 0 lands "successful" as a SILENT NO-OP; the VITUS credit needs an aged caller (the Eta floor — fresh callers get honest zeros). send=false (default) = DRYRUN only.',
  parameters: {
    type: "object",
    properties: {
      lat: { type: "string", description: "Latitude slot — an INTEGER in Code's convention (Compliment's FIRST word)" },
      lon: { type: "string", description: "Longitude slot — an INTEGER (Compliment's SECOND word)" },
      address: { type: "string", description: "venue address; omit for the app's current venue" },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate" },
    },
    required: ["lat", "lon"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (!simLayerActive(ctx.rpcUrl)) return { error: "world_code is SIM-only — the layer has no live addresses (SETTINGS → RPC: a loopback local fork)" };
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    const venue = await resolveVenue(args["address"]);
    if (venue === null) return { error: "no venue — pass an address or select one in the app first" };
    let lat: bigint;
    let lon: bigint;
    try {
      lat = BigInt(str(args["lat"] ?? "").trim());
      lon = BigInt(str(args["lon"] ?? "").trim());
    } catch {
      return { error: "lat/lon must be integers (Code's swapped convention — Compliment's first word goes in lat)" };
    }
    const preview = {
      venue: venue.address,
      coords: `lat ${lat.toString()} / lon ${lon.toString()} (Code's SWAPPED convention)`,
      notes: [
        "the bounds box (Yeo) grows with your Moments — beyond it the call reverts OutOfRange",
        "Charge 0 lands successful as a silent no-op (venue-Eris-weighted; the credit needs the full prereq stack + an aged caller)",
        simGateNote(),
      ],
    };
    const request: GateRequest = {
      to: (await import("@/chain/simMode")).simAddr("WORLD", ctx.rpcUrl),
      data: await encodeWorldCode(lat, lon, venue.address),
      account: ctx.account,
      abi: await worldAbi(),
      meta: { source: "agent", label: `agent SIM world claim ${venue.address}` },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      return capOutput({ mode: "DRYRUN", ...preview, ...dryrunGateSummary(env) });
    }
    const out = await ctx.gateSend(request);
    return capOutput({ mode: "SEND", ...preview, ...outcomeSummary(out), ...(out.status === "sent" ? { refresh: "get_venue re-reads the tile block" } : {}) });
  },
};

const spawnGwat: AgentTool = {
  name: "spawn_gwat",
  risk: "act",
  description:
    'SIM-ONLY: GWAT.Gwat(parent, lin) — fork the parent venue into YOUR own sub-venue ("<you>\'s <asset> GWAT"; the full spawn mint lands at your wallet). PREREQUISITES (fork-proven): a prior world_code claim on the parent (the cauda the draw rides), the parent\'s supply ≥ 777 own tokens (the spawn registers a 1e18 rate against the parent — the AddMarketRate cap), your YUE + Username, the wrapped asset not MAP-forbidden, and no existing GWAT for your (parent, YUE) pair — YourGwatAlreadyExists carries your existing GWAT\'s address. Each attempt is a FRESH draw: SpawningFailure (0-mod or tile taken) means RETRY. lin = the cauda position (default 1, the first creator slot). send=false (default) = DRYRUN only.',
  parameters: {
    type: "object",
    properties: {
      address: { type: "string", description: "parent venue address; omit for the app's current venue" },
      lin: { type: "string", description: "cauda position the draw rides (default 1 — the first creator slot)" },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate" },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (!simLayerActive(ctx.rpcUrl)) return { error: "spawn_gwat is SIM-only — the layer has no live addresses (SETTINGS → RPC: a loopback local fork)" };
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    const venue = await resolveVenue(args["address"]);
    if (venue === null) return { error: "no venue — pass an address or select one in the app first" };
    let lin = 1n;
    try {
      const raw = str(args["lin"] ?? "").trim();
      if (raw.length > 0) {
        lin = BigInt(raw);
        if (lin <= 0n) return { error: "lin must be ≥ 1 (the cauda position)" };
      }
    } catch {
      return { error: 'lin must be an integer ≥ 1 (default "1")' };
    }
    const client = makeClient(ctx.rpcUrl);

    // the eligibility reads (live, one anonymous batch + the MAP veto view)
    const notes: string[] = [simGateNote(), "each attempt is a fresh draw — SpawningFailure means RETRY"];
    let eligibility: Record<string, unknown> = {};
    try {
      const [supply, asset] = await Promise.all([
        client.readContract({ address: venue.address, abi: [{ type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }], functionName: "totalSupply" }) as Promise<bigint>,
        client.readContract({ address: venue.address, abi: [{ type: "function", name: "Asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }], functionName: "Asset" }) as Promise<`0x${string}`>,
      ]);
      const veto = asset === "0x0000000000000000000000000000000000000000" ? null : await readGwatForbidden(client, asset);
      eligibility = {
        parentSupply: fmtAmt(supply),
        rateCapReady: supply >= 777n * 10n ** 18n,
        ...(veto !== null ? { assetForbidden: veto } : {}),
      };
      if (supply < 777n * 10n ** 18n) notes.push("parent supply below the 777-token floor — the spawn's rate registration reverts TokenMaximumRate");
      if (veto === true) notes.push("the wrapped asset is MAP-forbidden — ForbiddenToken");
    } catch {
      notes.push("eligibility reads failed — the DRYRUN decides");
    }
    const preview = { venue: venue.address, lin: lin.toString(), eligibility, notes };

    const enc = await encodeGwatSpawn(venue.address, lin, ctx.rpcUrl);
    const request: GateRequest = {
      to: enc.to as `0x${string}`,
      data: enc.data,
      account: ctx.account,
      abi: enc.abi,
      meta: { source: "agent", label: `agent SIM gwat spawn ${venue.address}` },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      const spawned = env.sim?.ok && env.sim.result !== null ? decodeGwatSpawned(env.sim.result) : null;
      return capOutput({
        mode: "DRYRUN",
        ...preview,
        ...(spawned !== null ? { previewSpawned: spawned } : {}),
        ...dryrunGateSummary(env),
        ...(env.sim?.error?.decoded?.includes("YourGwatAlreadyExists")
          ? { hint: "the error's second word IS your existing GWAT's address (there is no getter)" }
          : {}),
      });
    }
    const out = await ctx.gateSend(request);
    // the receipt proves the spawn: NewQing(spawned, parent, Luo) — word1 is
    // the PARENT (the guard); args not indexed, data words
    let spawned: { qing: `0x${string}`; waat: bigint } | null = null;
    if (out.status === "sent" && out.receipt !== null) {
      const facts = decodeNewQing(out.receipt.logs);
      if (facts !== null && facts.asset.toLowerCase() === venue.address.toLowerCase()) {
        spawned = { qing: facts.qing as `0x${string}`, waat: facts.waat };
      }
    }
    return capOutput({
      mode: "SEND",
      ...preview,
      ...(spawned !== null
        ? {
            spawned: spawned.qing,
            drawnWaat: spawned.waat.toString(),
            refresh: "the spawned venue wraps the parent — select it in the app to manage it",
          }
        : {}),
      ...outcomeSummary(out),
    });
  },
};

const encryptNote: AgentTool = {
  name: "encrypt_note",
  risk: "act",
  description:
    "SIM-ONLY: ENCRYPT.Encrypt(from, to, key, note) — seal a note to a counterparty soul with the two-party stream cipher. from = YOUR soul (read live from your LAU's Saat[1]); to = their uint64 soul id; the returned INDEX is deterministic (DRYRUN preview == committed) and the ONLY handle — it travels to the counterparty offchain with the key (they decrypt as the To side; entries expire in 10 days). The party gate keys on your SHIO ownership (the wallet that created your LAU passes). NOT confidentiality — a public orbit; it is permissioning + ephemerality. send=false (default) = DRYRUN only.",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "the counterparty's uint64 soul id" },
      key: { type: "string", description: "the shared key (travels offchain with the index)" },
      message: { type: "string", description: "the note (plain text)" },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate" },
    },
    required: ["to", "key", "message"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (!simLayerActive(ctx.rpcUrl)) return { error: "encrypt_note is SIM-only — the layer has no live addresses (SETTINGS → RPC: a loopback local fork)" };
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    const lau = ctx.snapshot?.lau ?? null;
    if (lau === null) return { error: "you need a LAU first — create_lau (your soul is its Saat[1])" };
    let to: bigint;
    try {
      to = BigInt(str(args["to"] ?? "").trim());
      if (to < 0n) throw new Error("neg");
    } catch {
      return { error: "to must be the counterparty's uint64 soul id" };
    }
    const key = str(args["key"] ?? "");
    const message = str(args["message"] ?? "");
    if (key.length === 0) return { error: "key is required" };
    if (message.trim().length === 0) return { error: "empty message" };
    if (message.length > 280) return { error: `message ${message.length} chars > 280 (schema fence)` };

    const client = makeClient(ctx.rpcUrl);
    const mySoul = await readSoulId(client, lau);
    if (mySoul === null) return { error: "your soul read failed (LAU.Saat(1)) — is this a fork with the live layer?" };
    const preview = {
      from: mySoul.toString(),
      toSoul: to.toString(),
      notes: [
        "the index is DETERMINISTIC — the DRYRUN preview IS the committed index",
        "the index + key travel to the counterparty offchain; they decrypt as the To side",
        "entries expire in 10 days; the desk has NO enumeration getter",
        "a string-Encrypt meters +4 units to the fixture (the overload chain) — the call-counter law",
        simGateNote(),
      ],
    };
    const enc = await encodeEncryptString(mySoul, to, key, message, ctx.rpcUrl);
    const request: GateRequest = {
      to: enc.to as `0x${string}`,
      data: enc.data,
      account: ctx.account,
      abi: enc.abi,
      meta: { source: "agent", label: `agent SIM encrypt note → soul ${to.toString()}` },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      const index = env.sim?.ok && env.sim.result !== null ? decodeEncryptIndex(env.sim.result) : null;
      return capOutput({ mode: "DRYRUN", ...preview, ...(index !== null ? { index: index.toString() } : {}), ...dryrunGateSummary(env) });
    }
    const out = await ctx.gateSend(request);
    // the index is deterministic: re-derive it via a pure preview AFTER the
    // send (creating a second entry would double-send — never do that).
    // NB: the SEND result stays LEAN (no notes — they rode the DRYRUN): the
    // fleet score reads status/index from RECORDED results, and the mint
    // chain's movements are bulky enough to trip the tool-output cap
    let index: bigint | null = null;
    try {
      const env = await ctx.gateDryRun({ ...request, meta: { source: "agent", label: "index re-derivation (deterministic preview)" } });
      if (env.sim?.ok && env.sim.result !== null) index = decodeEncryptIndex(env.sim.result);
    } catch {
      index = null;
    }
    return capOutput({
      mode: "SEND",
      from: preview.from,
      toSoul: preview.toSoul,
      ...(index !== null ? { index: index.toString(), handoff: `give the counterparty (from ${preview.from}, to ${preview.toSoul}, index ${index.toString()}, the key)` } : {}),
      ...outcomeSummary(out),
    });
  },
};

/**
 * decrypt_note (session 61, the multi-agent arc's first-contact leg): the
 * cipher READ side. YOU are the TO party — your soul is read live from your
 * LAU's Saat[1]; `from` is the counterparty's soul (the encrypt_note sender).
 *
 * Fork-pinned semantics riding the result (harness set 3 s_enc/s_exp + the
 * session-61 fork finding):
 * - the DRYRUN preview IS the exact plaintext (the deterministic orbit — a
 *   pure eth_call that changes nothing);
 * - the SEND is a METERED WRITE (a call-counter advance — this tool SENDS
 *   through the gate even though it "reads") and the entry SURVIVES it:
 *   deletion keys on EXPIRY, not on read (encrypt.sol:121 deletes only
 *   `Expiry < block.timestamp` entries — the 59 "delete-after-read" pin is
 *   the EXPIRED-entry case; a live note re-decrypts for its whole 10 days);
 * - the party gate keys on the TO side (your wallet must have created your
 *   LAU — SHIO owners map): decrypting a note addressed to someone else
 *   reverts NotParty;
 * - the index is NOT pair-bound: a swapped pair you own the TO side of
 *   answers XOR GARBAGE, not a revert.
 */
const decryptNote: AgentTool = {
  name: "decrypt_note",
  risk: "act",
  description:
    "SIM-ONLY: ENCRYPT.Decrypt(from, to, index, key) — open a sealed note as its TO party. from = the SENDER's uint64 soul id (travels with the handoff); you are the to side (your soul reads live from your LAU's Saat[1]). send=false (default) = DRYRUN only — the preview IS the exact plaintext (deterministic orbit; the eth_call changes nothing). send=true = the read through the gate: a METERED call-counter write, and the entry SURVIVES (deletion keys on expiry, not on read — a live note re-decrypts for its 10 days). The party gate keys on the TO side — decrypting someone else's note reverts NotParty. A wrong key or index answers garbage, not a revert. No widget (owner round, session-61): the result lives in the transcript + gate journal.",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "the sender's uint64 soul id (from the encrypt_note handoff)" },
      index: { type: "string", description: "the note's keystream index (from the handoff — no enumeration getter exists)" },
      key: { type: "string", description: "the shared key (travels offchain with the index)" },
      send: { type: "boolean", description: "false/default = DRYRUN only (exact plaintext preview); true = the read through the gate (metered)" },
    },
    required: ["from", "index", "key"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (!simLayerActive(ctx.rpcUrl)) return { error: "decrypt_note is SIM-only — the layer has no live addresses (SETTINGS → RPC: a loopback local fork)" };
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    const lau = ctx.snapshot?.lau ?? null;
    if (lau === null) return { error: "you need a LAU first — your soul is its Saat[1] and you must be the note's TO party" };
    let from: bigint;
    let index: bigint;
    try {
      from = BigInt(str(args["from"] ?? "").trim());
      index = BigInt(str(args["index"] ?? "").trim());
      if (from < 0n || index < 0n) throw new Error("neg");
    } catch {
      return { error: "from and index must be uint64 soul id / keystream index (decimal strings)" };
    }
    const key = str(args["key"] ?? "");
    if (key.length === 0) return { error: "key is required" };

    const client = makeClient(ctx.rpcUrl);
    const mySoul = await readSoulId(client, lau);
    if (mySoul === null) return { error: "your soul read failed (LAU.Saat(1)) — is this a fork with the live layer?" };
    const preview = {
      from: from.toString(),
      toSoul: mySoul.toString(),
      index: index.toString(),
      notes: [
        "YOU are the TO party — the gate reverts NotParty for anyone else",
        "the entry SURVIVES a committed read: deletion keys on expiry (10 days), not on read",
        "a wrong key/index answers XOR garbage (the index is not pair-bound) — not a revert",
        simGateNote(),
      ],
    };
    const enc = await encodeDecryptString(from, mySoul, index, key, ctx.rpcUrl);
    const request: GateRequest = {
      to: enc.to as `0x${string}`,
      data: enc.data,
      account: ctx.account,
      abi: enc.abi,
      meta: { source: "agent", label: `agent SIM decrypt note ← soul ${from.toString()} @ ${index.toString()}` },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      const plain = env.sim?.ok && env.sim.result !== null ? decodeDecryptPlain(env.sim.result) : null;
      return capOutput({
        mode: "DRYRUN",
        ...preview,
        ...(plain !== null
          ? plain.text !== null
            ? { plaintext: plain.text, previewHonesty: "EXACT — the deterministic orbit makes the preview the committed plaintext" }
            : { plaintextBytes: plain.byteLength, previewHonesty: `${plain.byteLength} bytes answered but not utf-8 (garbage or wrong key)` }
          : {}),
        ...dryrunGateSummary(env),
      });
    }
    const out = await ctx.gateSend(request);
    // the fork-honest post-send proof (a pure re-preview, never a second
    // send): a LIVE entry re-decrypts to the SAME plaintext — the entry
    // only deletes on an EXPIRED read (the session-61 finding)
    let reReadable: boolean | null = null;
    try {
      const env = await ctx.gateDryRun({ ...request, meta: { source: "agent", label: "post-send re-read proof (pure preview)" } });
      if (env.sim?.ok === true && env.sim.result !== null) {
        const again = decodeDecryptPlain(env.sim.result);
        reReadable = again.byteLength > 0;
      }
    } catch {
      reReadable = null;
    }
    return capOutput({
      mode: "SEND",
      from: preview.from,
      toSoul: preview.toSoul,
      index: preview.index,
      ...(reReadable === true
        ? { entrySurvives: true, note: "the entry survives the committed read — deletion keys on expiry (10 days), not on read" }
        : {}),
      ...outcomeSummary(out),
    });
  },
};

export const SIM_TOOLS: AgentTool[] = [worldCode, spawnGwat, encryptNote, decryptNote];
