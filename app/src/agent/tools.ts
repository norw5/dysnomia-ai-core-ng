import {
  decodeFunctionResult,
  encodeFunctionData,
  type AbiFunction,
  type Address,
} from "viem";
import { addr } from "@config/addresses";
import { loadAbi } from "@/chain/abiLoad";
import { makeClient } from "@/chain/client";
import { affectionApproveData, AFFECTION_UNIT, dssChatAndSnipeData } from "@/chain/dssDesk";
import { FACTS } from "@/chain/facts";
import { fmtAmt, readWalletLau, readWalletYue, usernameError, type PlayerSnapshot } from "@/chain/identity";
import { loadEntityProfile } from "@/chain/entityProfile";
import { loadVenueState, readEtaSlots, isEtaNoLineageError } from "@/chain/venueState";
import { decodeNewQing, encodeTake, liveVenueRow, readCreatePrecheck } from "@/chain/venueDeed";
import { loadRenderRows } from "@/state/atlas";
import { currentVenue, setCurrentVenue } from "@/state/venueStore";
import { chatChannelMode } from "@/state/chatChannel";
import { captureCreatedLau, decodeNewPreview, pendingLau, setPendingLau } from "@/state/pendingLau";
import { homeVenue, setHomeVenue } from "@/state/homeVenue";
import { qingForAsset, searchVenueCensus } from "@/state/atlas";
import type { Journal } from "@/chain/journal";
import type { GateEnvelope, GateOutcome, GateRequest } from "@/chain/txGate";
import { sanitizeNoteText, NOTE_CAP } from "@/chain/runs";
import { NEXT_GOAL_CAP, NEXT_GOALS_MAX, sanitizeNextGoals } from "@/agent/fullAuto";
import type { ToolSpec } from "@/agent/openrouter";
import { explainTopic, searchKb } from "@/agent/knowledge";
import {
  ADDRESS_RE,
  capOutput,
  dryrunGateSummary,
  launderAddress,
  outcomeSummary,
  pickFn,
  requireSendFlag,
  resolveVenue,
  str,
} from "@/agent/toolShared";
import { DASHBOARD_TOOLS } from "@/agent/dashboardTools";
import { DESK_TOOLS } from "@/agent/deskTools";
import { MOVE_TOOLS } from "@/agent/moveTools";
import { SIM_TOOLS as SIM_TOOLS_LIST } from "@/agent/simTools";
import { PLAN_TOOLS } from "@/agent/planTools";

/** deep bigint→string for tool results (JSON.stringify throws on bare
 * bigints — a scalar `balanceOf` return used to error the whole read) */
export function stringifyBigints(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(stringifyBigints);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, stringifyBigints(x)]));
  }
  return v;
}

/**
 * The agent tool catalog (IA-PLAN §7.3): read/knowledge/act tools over the
 * SAME readers the manual views use (identity/venueState/entityProfile), and
 * every send through THE tx gate — `ctx.gateSend` wraps GateContext.send, so
 * approvals/policy/yolo semantics are identical to manual buttons. Act tools
 * are DRYRUN-first: `send` defaults to false (simulate only). The chat-post
 * tool is schema-fenced and advertised ONLY when the opt-in flag is on
 * (§7.4 — OFF by default).
 */

/** observed budget pinned by the venue panel (kb §3 [chain]) — same numbers, one source */
export const BEAT_GAS_MEDIAN = 1_916_016n;
export const BEAT_GAS_LIMIT = 3_000_000n;

export interface AgentToolContext {
  rpcUrl: string;
  account: Address | null;
  snapshot: PlayerSnapshot | null;
  journal: Journal;
  walletMode: "A" | "B" | "C";
  /** the §7.4 opt-in — when false the chat tool is not even advertised */
  chatToolsEnabled: boolean;
  gateDryRun(request: GateRequest): Promise<GateEnvelope>;
  gateSend(request: GateRequest): Promise<GateOutcome | { status: "no-signer" }>;
  refreshSnapshot(): void;
  /**
   * §7.10 agent-authored lessons (session-54): the per-RUN note collector
   * the journal_note tool writes into; the store attaches the collected
   * note to the run record when the run completes (pending operator ack).
   * Local memory only — never touches the gate.
   */
  takeNote(text: string): void;
  /**
   * Session-74 THE STRATEGY LAYER: the per-RUN next-goals collector the
   * next_goals tool writes into — the store's full-auto seam attaches the
   * collected menu to the cycle's ledger row and feeds the next kickoff
   * (advisory data, ack-free by the owner round). OPTIONAL: absent (the
   * headless runner's drive ctx, non-full-auto hosts) means the tool
   * honestly refuses — the menu only lands between full-auto cycles.
   */
  takeNextGoals?: ((goals: string[]) => void) | null;
  /**
   * The §8 SIM-layer gate (session-59): when false (the default outside a
   * loopback local fork), the SIM tools are not even advertised — they have no
   * live addresses, and a plan referencing them dies at the schema fence.
   */
  simToolsEnabled: boolean;
  /**
   * The §7.4 chat CADENCE GOVERNOR (session-65, FULL-AUTO): when the store
   * provides it, send_chat / send_world_chat MUST pass it (with their send
   * intent) before building a request — it refuses when the mode's cadence
   * discipline says "too soon" (min-interval between chat SENDS, no spray).
   * Absent/null = no governor (the non-full-auto modes stay task-driven,
   * prompt-disciplined).
   */
  chatGate?: ((send: boolean) => { ok: true } | { ok: false; error: string }) | null;
  /**
   * The per-agent tool allowlist (session-62, the flagship's capability
   * asymmetry): a DRIVER concern — the headless runner's drive plan carries
   * each roster agent's tool subset and the ctx honors it at BOTH seams
   * (the advertised specs + the execute guard). Absent/null = the full
   * catalog (the app never sets it; the catalog itself is untouched).
   */
  toolAllowlist?: ReadonlySet<string> | null;
  /**
   * The player's deployed DSS address (session-66, state/dssStore.ts —
   * captured at the creating receipt; the contract has NO getter). Null =
   * no bundler captured → dss_snipe refuses honestly (deploy first via
   * the IDENTITY emission desk).
   */
  dss?: Address | null;
}

export interface AgentTool {
  name: string;
  risk: "read" | "knowledge" | "act";
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: AgentToolContext): Promise<Record<string, unknown>>;
}

// ---------- read tools ----------

const getState: AgentTool = {
  name: "get_state",
  risk: "read",
  description:
    "Your deterministic per-turn player state (already injected as PLAYER_STATE; call this only after sends/blocks changed something and you need a fresh read). Returns addresses, onboarding flags, balances (PLS / AFFECTION / CHOA across wallet/LAU/YUE), CHOA Yuan, wallet mode.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute(_args, ctx) {
    if (ctx.snapshot === null) {
      ctx.refreshSnapshot();
      // 65.1 law (UNREADABLE ≠ ABSENT, sharpened session-69): a NULL
      // snapshot with an ACCOUNT bound is the loading/unreadable window —
      // never the "no wallet" refusal (a full-auto engage racing the first
      // identity read once closed a whole cycle over this)
      return {
        error:
          ctx.account === null
            ? "no snapshot — connect an account (SETTINGS → wallet) first"
            : "snapshot still loading (or its read failed) — the account IS connected; call get_state again in a moment",
      };
    }
    const s = ctx.snapshot;
    // session-73: the home QING resolves from the CENSUS too (the NewQing
    // walk's asset index) — pre-app accounts (aged transfers) read their
    // home venue here instead of a blind "null" (the full-auto video's gap)
    const capturedHome = homeVenue(ctx.account);
    let homeQing: string | null = capturedHome?.venue ?? null;
    let homeQingSource: "captured" | "census" | null = capturedHome !== null ? "captured" : null;
    if (homeQing === null && s.lau !== null) {
      const found = await qingForAsset(s.lau).catch(() => null);
      if (found !== null) {
        homeQing = found.a;
        homeQingSource = "census";
      }
    }
    return capOutput({
      account: s.account,
      lau: s.lau,
      yue: s.yue,
      username: s.username,
      lauSymbol: s.lauSymbol,
      yueName: s.yueName,
      pls: { wallet: fmtAmt(s.balances.pls.wallet), lau: fmtAmt(s.balances.pls.lau), yue: fmtAmt(s.balances.pls.yue) },
      affection: { wallet: fmtAmt(s.balances.affection.wallet), lau: fmtAmt(s.balances.affection.lau), yue: fmtAmt(s.balances.affection.yue) },
      choa: { wallet: fmtAmt(s.balances.choa.wallet), lau: fmtAmt(s.balances.choa.lau), yue: fmtAmt(s.balances.choa.yue) },
      yuanChoa: fmtAmt(s.yuanChoa),
      block: s.blockNumber !== null ? s.blockNumber.toString() : null,
      walletMode: ctx.walletMode,
      currentVenue: currentVenue()?.a ?? null,
      homeVenue: homeQing,
      homeVenueSource: homeQingSource,
      dss: ctx.dss ?? null,
      chatChannel: chatChannelMode(),
      fetchedAt: new Date(s.fetchedAt).toISOString(),
    });
  },
};

const getVenue: AgentTool = {
  name: "get_venue",
  risk: "read",
  description:
    "Live state of a venue (QING). One anonymous batch: Waat, Asset, Entropy, totalSupply, CoverCharge, BouncerDivisor, the AFFECTION market rate (absent = fresh venue, MarketRateNotFound), admission + venue-token balance for the active account, your per-venue attendance bars (YUE.Bar — Hypobar/Epibar, needs your YUE), the management gates (GWAT escrow lock, NoCROWS, your bouncer/owner passes), plus seed facts (HECKE band/coords) and your Eta-readiness (simulated RING.Eta from the account — three states: no-vault-lineage revert / fresh (14,0,0,0) / aged nonzero).",
  parameters: {
    type: "object",
    properties: {
      address: { type: "string", description: "venue (QING) address; omit to use the app's current venue selection" },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const venue = await resolveVenue(args["address"]);
    if (venue === null) return { error: "no venue — pass an address or select one in the app (MAP/sidebar) first" };
    const client = makeClient(ctx.rpcUrl);
    const state = await loadVenueState(client, venue.address, ctx.account, {
      lau: ctx.snapshot?.lau ?? null,
      yue: ctx.snapshot?.yue ?? null,
    });
    let seed: Record<string, unknown> | null = null;
    try {
      const rows = await loadRenderRows();
      const row = rows.find((r) => r.a.toLowerCase() === venue.address.toLowerCase());
      if (row) seed = { name: row.n, symbol: row.s, band: row.band, lon: row.lon, lat: row.lat, createdBlock: row.blk, waat: row.w, firstQing: row.sys };
    } catch {
      seed = null;
    }
    let eta: Record<string, unknown> | null = null;
    if (ctx.account !== null) {
      try {
        const slots = await readEtaSlots(client, ctx.account);
        const ready = slots[1] !== 0n || slots[2] !== 0n || slots[3] !== 0n;
        eta = { slots: slots.map((x) => x.toString()), beatReady: ready, note: ready ? "aged lineage — Beat can run (Yeo rounds to 0 early)" : "fresh-caller shape — Beat will panic 0x12 at ANY funding level; caller state, not holdings" };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        eta = isEtaNoLineageError(msg)
          ? { beatReady: false, note: "no vault lineage — open your YUE first (SEI.Start); the simulated Eta() reverts 0x12efd467" }
          : { beatReady: null, error: msg };
      }
    }
    return capOutput({
      venue: venue.address,
      seed,
      live: {
        waat: state.waat?.toString() ?? null,
        asset: state.asset,
        entropy: state.entropy?.toString() ?? null,
        totalSupply: state.totalSupply !== null ? fmtAmt(state.totalSupply) : null,
        coverCharge: state.coverCharge !== null ? fmtAmt(state.coverCharge) : null,
        bouncerDivisor: state.bouncerDivisor?.toString() ?? null,
        marketRateAffection: state.marketRateAffection !== null ? fmtAmt(state.marketRateAffection) : null,
        marketRateKnown: state.marketRateKnown,
        admitted: state.admitted,
        myVenueTokenBalance: state.myBalance !== null ? fmtAmt(state.myBalance) : null,
        myAttendance: state.myHypobar !== null ? { hypobar: state.myHypobar.toString(), epibar: state.myEpibar?.toString() ?? null } : null,
        management: {
          gwatEscrowLocked: state.gwat,
          noCrows: state.noCrows,
          yourBouncerPass: state.myBouncer,
          yourOwnerPass: state.myOwner,
        },
        deed: {
          assetIsYourAccountToken: state.assetIsUserToken,
          yourStakeInWrappedAsset: state.assetOwnerPass,
          note: "DO.Take keys on the wrapped asset; an ineligible Take is a silent no-op (successful tx, nothing happens)",
        },
        readErrors: state.errors,
        block: state.blockNumber?.toString() ?? null,
      },
      eta,
    });
  },
};

const searchVenuesTool: AgentTool = {
  name: "search_venues",
  risk: "read",
  description:
    "Search the venue census (the QING atlas): the 940+ MAP.NewQing-derived venues — name/symbol/address substring or an exact band number — plus the sync engine's live catch-up rows. Each row carries the address, name, symbol, band, creation block, and the WRAPPED ASSET (the NewQing Integrative — a venue whose asset is your own LAU is YOUR home QING). Use this to pick venues to visit/Beat/settle at instead of guessing addresses; follow up with get_venue for live state or focus_map to place it on the atlas. Empty query lists the census head.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "case-insensitive substring of name/symbol/address, or an exact band number (e.g. 'phobos', 'SIRIN', '84')" },
      limit: { type: "number", description: "max rows (default 10, cap 40 — the tool output cap truncates fat result sets; narrow the query instead)" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(args) {
    const q = str(args["query"] ?? "").trim();
    const limit = typeof args["limit"] === "number" ? Math.max(1, Math.min(40, Math.floor(args["limit"]))) : 10;
    const { rows, total } = await searchVenueCensus(q, limit);
    return capOutput({
      query: q,
      total,
      rows: rows.map((r) => ({ a: r.a, n: r.n, s: r.s, band: r.band, blk: r.blk, asset: r.asset ?? null, live: r.live })),
      note: "addresses are ready for get_venue/focus_map/join_venue; `live` rows were caught by the sync engine after the seed's floor",
    });
  },
};

const getLau: AgentTool = {
  name: "get_lau",
  risk: "read",
  description: "Read-only entity profile of any address (typically a LAU or YUE): PLS / AFFECTION / CHOA balances of the contract itself plus name/symbol/Username (Username reverts while unset — null is the honest unset).",
  parameters: {
    type: "object",
    properties: { address: { type: "string", description: "the entity contract address" } },
    required: ["address"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const a = str(args["address"] ?? "");
    if (!ADDRESS_RE.test(a)) return { error: "invalid address" };
    const client = makeClient(ctx.rpcUrl);
    const p = await loadEntityProfile(client, a as Address);
    return capOutput({
      entity: p.entity,
      name: p.name,
      symbol: p.symbol,
      username: p.username,
      pls: fmtAmt(p.pls),
      affection: fmtAmt(p.affection),
      choa: fmtAmt(p.choa),
      block: p.blockNumber?.toString() ?? null,
    });
  },
};

/** the lazy instance-family union cache (QING + LAU + YUE view surfaces) */
let readContractUnionCache: AbiFunction[] | null = null;

/** `name(type,type)` forms of an abi's view/pure functions — discovery */
function viewSignatures(abi: Awaited<ReturnType<typeof loadAbi>>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of abi) {
    if (e.type !== "function" || (e.stateMutability !== "view" && e.stateMutability !== "pure")) continue;
    const frag = e as AbiFunction;
    const sig = `${frag.name}(${frag.inputs.map((i) => i.type).join(",")})`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(sig);
  }
  return out;
}

const readContract: AgentTool = {
  name: "read_contract",
  risk: "read",
  description:
    "Anonymous eth_call of a VIEW or PURE function on a perimeter contract or a deployed instance. `contract` = perimeter name (e.g. CHO, CHOA, RING, HECKE, MAP, SEI, VOID) or an address; arbitrary addresses are read with the UNION of the shipped instance-family view surfaces (QING venues, LAU identity tokens, YUE vaults — all DYSNOMIA-base instances), so name/symbol/totalSupply/balanceOf/owner(address) etc. resolve without knowing the family; a function the family lacks reverts honestly. UNSURE OF A FUNCTION NAME OR SHAPE? call with `function` omitted — one cheap call lists every view/pure SIGNATURE on the target; never guess a name blind. A miss lists the signatures too. TRAP: MAP.has(asset,\"…\")/hasOwner(asset) are generic CAPABILITY probes (does the asset answer that selector) — NOT registry lookups; to find WHICH QING wraps an asset use search_venues (rows carry the asset) or the create_venue DRYRUN's decoded QingAlreadyExists(Token, Qing). Dead RPC surfaces as an error, never as a zero result.",
  parameters: {
    type: "object",
    properties: {
      contract: { type: "string", description: "perimeter name or contract address" },
      function: { type: "string", description: "function name — e.g. Yuan or GetQing. OMIT it (or pass '?') to LIST the contract's view/pure functions with their signatures first (the cheap discovery call — never guess a name blind)" },
      args: { type: "array", description: "positional arguments (address/string/number as JSON; bigint-likes as decimal strings)", items: {} },
    },
    required: ["contract"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const name = str(args["contract"] ?? "").trim();
    const fnName = str(args["function"] ?? "").trim();
    const rawArgs = Array.isArray(args["args"]) ? (args["args"] as unknown[]) : [];
    if (name.length === 0) return { error: "contract is required (perimeter name or address; omit `function` to list its views)" };

    // the instance-family union (session-69.2): the video-2 diagnosis loop
    // guessed families wrong (totalSupply on a LAU failed "not found in
    // QING.json") — read arbitrary addresses with ALL the shipped views
    let instanceUnionCache: AbiFunction[] | null = readContractUnionCache;
    let target: Address;
    let abi: Awaited<ReturnType<typeof loadAbi>>;
    if (ADDRESS_RE.test(name)) {
      target = name as Address;
      const known = FACTS.byAddress[target.toLowerCase()];
      if (known) abi = await loadAbi(known.contract.abiFile);
      else {
        if (instanceUnionCache === null) {
          const files = await Promise.all(["QING.json", "LAU.json", "YUE.json"].map((f) => loadAbi(f)));
          const seen = new Set<string>();
          instanceUnionCache = [];
          for (const file of files) {
            for (const e of file) {
              if (e.type !== "function" || (e.stateMutability !== "view" && e.stateMutability !== "pure")) continue;
              const frag = e as AbiFunction;
              const key = `${frag.name}(${frag.inputs.map((i) => i.type).join(",")})`;
              if (seen.has(key)) continue;
              seen.add(key);
              instanceUnionCache.push(frag);
            }
          }
          readContractUnionCache = instanceUnionCache;
        }
        abi = instanceUnionCache;
      }
    } else {
      const upper = name.toUpperCase();
      const entry = FACTS.contracts.find((c) => c.name.toUpperCase() === upper);
      if (!entry) return { error: `unknown perimeter contract: ${name} (see the perimeter table in SETTINGS)` };
      target = entry.address;
      abi = await loadAbi(entry.abiFile);
    }
    // DISCOVERY (69.4, the owner's ask: never guess blind): `function`
    // omitted or "?" lists the callable surface with exact signatures
    if (fnName === "" || fnName === "?" || fnName === "list") {
      const views = viewSignatures(abi);
      const nonViews = new Set(
        abi.filter((e): e is AbiFunction => e.type === "function" && e.stateMutability !== "view" && e.stateMutability !== "pure").map((f) => f.name)
      );
      return capOutput({
        contract: name,
        address: target,
        viewCount: views.length,
        views,
        note:
          nonViews.size > 0
            ? `${nonViews.size} non-view function name(s) exist (gate-only — not readable here); call a listed signature with its args to read`
            : "call a listed signature with its args to read",
      });
    }
    const frags = abi.filter((e): e is AbiFunction => e.type === "function" && e.name === fnName);
    if (frags.length === 0) {
      // session-69.2: teach the available views — one miss, one correction
      // (the video-2 loop guessed GetMapQing/Forbid before finding GetQing/Forbidden);
      // 69.4: signatures, not bare names (the model was still guessing shapes)
      const views = viewSignatures(abi).slice(0, 44);
      return {
        error: `${fnName} not found on ${name} (${target}) — view/pure signatures: ${views.join(", ")}; call again with \`function\` omitted to list them all`,
      };
    }
    const exact = frags.find((f) => f.inputs.length === rawArgs.length);
    // the mutability guard fires FIRST — a non-view guess is never helped
    const viewFrags = frags.filter((f) => f.stateMutability === "view" || f.stateMutability === "pure");
    if (viewFrags.length === 0) {
      return {
        error: `${fnName}(${frags[0]!.inputs.map((i) => i.type).join(", ")}) is ${frags[0]!.stateMutability} — only view/pure reads are allowed on this tool; act tools go through the gate. If you want a related READ (e.g. ownership), call with \`function\` omitted to list ${name}'s views`,
      };
    }
    if (exact === undefined && viewFrags.length === 1 && viewFrags[0]!.inputs.length !== rawArgs.length) {
      // session-69.2: a wrong-arity guess used to fall into viem's cryptic
      // "Cannot convert undefined to a BigInt" (the video-2 GetMapQing(asset)
      // case — the real sig is GetMapQing(int256,int256)); teach the shape
      return {
        error: `${fnName} expects (${viewFrags[0]!.inputs.map((i) => i.type).join(", ")}) — ${rawArgs.length} arg(s) given; check the signature and retry`,
      };
    }
    const frag = exact ?? viewFrags[0]!;
    const encodedArgs = frag.inputs.map((input, i) => {
      const v = rawArgs[i];
      if (input.type === "address" && typeof v === "string") return v as Address;
      if (input.type === "uint256" || input.type === "uint64" || input.type === "int256") {
        if (typeof v === "number") return BigInt(v);
        if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
      }
      return v;
    });
    const client = makeClient(ctx.rpcUrl);
    const data = encodeFunctionData({ abi: [frag], functionName: fnName, args: encodedArgs });
    const raw = await client.call({ to: target, data });
    const retData = typeof raw === "string" ? (raw as `0x${string}`) : ((raw as { data: `0x${string}` }).data);
    const decoded = decodeFunctionResult({ abi: [frag], functionName: fnName, data: retData });
    // session-73 fix: stringify bigints at EVERY level — a scalar bigint
    // (balanceOf!) used to reach JSON.stringify and error the whole read
    // ("unserializable BigInt" — the full-auto video's Fornax gap)
    const pretty = stringifyBigints(decoded);
    return capOutput({ contract: name, address: target, function: fnName, result: pretty as unknown as Record<string, unknown> });
  },
};

// ---------- knowledge tools ----------

const searchKbTool: AgentTool = {
  name: "search_kb",
  risk: "knowledge",
  description:
    "Search the definitive guide (8 files), the deployed-semantics KB, the per-contract DEV REFERENCE (50 files — identity/role/state/function tables/integration notes, incl. the never-deployed layer), the cross-system reference (randomness), the OPERATOR PLAYBOOKS (kb/playbooks — beat-the-home-QING targets/amounts/PLS budgeting, chat-mining economics, guest-list rotation), and the per-contract fact catalogue (fn_tables-derived). Use this before asserting anything contract-specific; cite file + section.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "natural-language query, e.g. 'beat gas budget', 'bouncer cascade', 'Yuan weights'" },
      k: { type: "number", description: "max hits (default 4)" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(args) {
    const q = str(args["query"] ?? "");
    const k = typeof args["k"] === "number" ? Math.max(1, Math.min(8, Math.floor(args["k"]))) : 4;
    const hits = searchKb(q, k);
    // excerpts tightened so 4 hits stay comfortably inside the output cap
    return capOutput({
      query: q,
      hits: hits.map((h) => ({ source: h.source, file: h.file, section: h.title, score: h.score, excerpt: h.excerpt.slice(0, 360) })),
    });
  },
};

const explainTool: AgentTool = {
  name: "explain",
  risk: "knowledge",
  description: "Link the education layer's guide sections for a topic (player-facing guide only — same files the LEARN corpus ships).",
  parameters: {
    type: "object",
    properties: { topic: { type: "string", description: "e.g. 'venues', 'the ladder', 'bridge'" } },
    required: ["topic"],
    additionalProperties: false,
  },
  async execute(args) {
    const topic = str(args["topic"] ?? "");
    const hits = explainTopic(topic, 3);
    return capOutput({ topic, sections: hits.map((h) => ({ file: `guide/${h.file}`, section: h.title, excerpt: h.excerpt.slice(0, 360) })) });
  },
};

/**
 * §7.10 agent-authored lessons (session-54, owner round — the four-axis
 * decision: mid-run tool / per-run note field / review-before-inject with
 * persisted-ack / always advertised). The note is DATA, never a
 * directive: size-capped, control-stripped, ONE per run (a later call
 * replaces), and PENDING until the operator acks it in SYS — an un-acked
 * note never reaches a prompt. Local IDB only: the gate is not involved.
 */
const journalNoteTool: AgentTool = {
  name: "journal_note",
  risk: "knowledge",
  description: `Record ONE durable lesson from this run into the local journal (§7.10) — what a FUTURE session should know about this operator or the system. Data, never directives (write what you learned, not instructions); max ${NOTE_CAP} chars (longer is capped); one note per run — a later call replaces the earlier. The operator reviews it in AI_CORE → SYS before it ever enters a future session's memory.`,
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: `the lesson — a single observation, data not directives (≤ ${NOTE_CAP} chars)` },
    },
    required: ["text"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const clean = sanitizeNoteText(str(args["text"] ?? ""));
    if (clean === null) return { error: "empty note — nothing journal-worthy to record" };
    ctx.takeNote(clean);
    return { ok: true, recorded: clean, review: "pending operator ack in AI_CORE → SYS — un-acked notes are never injected" };
  },
};

/**
 * Session-74 THE STRATEGY LAYER — the structured NEXT-GOALS MENU (the owner
 * round: ack-free advisory data; the operator OBJECTIVE is the trust
 * boundary). The agent closes each FULL-AUTO cycle by recording 1-5
 * one-line candidate goals; the next cycle's kickoff (or the strategist
 * layer) consumes the menu. Sanitized + capped exactly like everything that
 * rides a prompt; local memory only — the gate is not involved. Outside a
 * collector context (no full-auto loop to feed) the tool refuses honestly.
 */
const nextGoalsTool: AgentTool = {
  name: "next_goals",
  risk: "knowledge",
  description: `Record the structured NEXT-GOALS MENU that closes a FULL-AUTO cycle — ${NEXT_GOALS_MAX} one-line candidate goals for the NEXT cycle, most promising first (data, never directives; ≤ ${NEXT_GOAL_CAP} chars each; a later call in the same cycle replaces). The next cycle's kickoff — or the strategist layer, when enabled — consumes this menu as advisory data. Call it as you close each FULL-AUTO cycle; skip it outside the loop (there is nothing to feed).`,
  parameters: {
    type: "object",
    properties: {
      goals: {
        type: "array",
        items: { type: "string" },
        description: `1-${NEXT_GOALS_MAX} one-line goals, most promising first`,
      },
    },
    required: ["goals"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const goals = sanitizeNextGoals(args["goals"]);
    if (goals.length === 0) return { error: `no usable goals — pass 1-${NEXT_GOALS_MAX} non-empty one-line goal strings` };
    if (ctx.takeNextGoals === null || ctx.takeNextGoals === undefined) {
      return { error: "no menu collector in this context — the next-goals menu lands only between FULL-AUTO cycles (outside the loop there is nothing to feed)" };
    }
    ctx.takeNextGoals(goals);
    return { ok: true, recorded: goals, note: "the next cycle's kickoff (or the strategist layer) consumes this menu as advisory data" };
  },
};

// ---------- act tools (through THE gate; DRYRUN-first) ----------
// the outcome/envelope summaries + the arg helpers live in toolShared.ts
// (session-55) so the desk tools render gate results identically.

/**
 * The onboarding chain's LAU resolution (session-64): the registered LAU
 * when discovery has landed, else the receipt-carried pending LAU — the
 * chain (Username → YUE → register) works pre-registration. World-facing
 * gates that genuinely key on registration (the chat paths) keep the
 * snapshot-only resolution below.
 */
function resolveActLau(ctx: AgentToolContext): Address | null {
  return ctx.snapshot?.lau ?? pendingLau(ctx.account)?.lau ?? null;
}

/** the belt-and-braces snapshot refresh after a SENT outcome (session-64) */
async function gateSendRefreshing(ctx: AgentToolContext, request: GateRequest): Promise<GateOutcome | { status: "no-signer" }> {
  const out = await ctx.gateSend(request);
  if (out.status === "sent") ctx.refreshSnapshot();
  return out;
}

/**
 * Mid-plan staleness guard (session-64.1, the owner's run finding): the
 * plan runner executes its whole checklist with ONE ctx — the snapshot on
 * it is FROZEN at approval time, so a step chained after a send (start_yue
 * → register) still sees the pre-send world and refuses on facts that are
 * already onchain. Guards that chain sends therefore resolve the discovery
 * LIVE (one anonymous batch: CHO.GetUserTokenAddress + CHAN.Yan) whenever
 * the snapshot lacks the fact — a snapshot that HAS it is never stale-ahead.
 *
 * Session-65.1 hardening (the owner's second run finding): the two legs are
 * settled INDEPENDENTLY (allSettled) and each leg reports READABILITY —
 * UNREADABLE ≠ ABSENT. A leg that fails (a transient RPC blip mid-plan)
 * must never be swallowed into a confident "you have no YUE/LAU" refusal;
 * the guards below proceed to the gate DRYRUN (the arbiter — it decodes the
 * real revert class) instead. A leg that READS null is the honest refusal.
 */
export interface LiveLauYue {
  lau: Address | null;
  yue: Address | null;
  /** false = that leg's read FAILED (unreadable — absence NOT proven) */
  lauReadable: boolean;
  yueReadable: boolean;
}

export async function resolveLiveLauYue(ctx: AgentToolContext): Promise<LiveLauYue> {
  if (ctx.account === null) return { lau: null, yue: null, lauReadable: false, yueReadable: false };
  const client = makeClient(ctx.rpcUrl);
  const [lauR, yueR] = await Promise.allSettled([readWalletLau(client, ctx.account), readWalletYue(client, ctx.account)]);
  return {
    lau: lauR.status === "fulfilled" ? lauR.value : null,
    yue: yueR.status === "fulfilled" ? yueR.value : null,
    lauReadable: lauR.status === "fulfilled",
    yueReadable: yueR.status === "fulfilled",
  };
}

const joinVenue: AgentTool = {
  name: "join_venue",
  risk: "act",
  description:
    "QING.Join(LAU) — register at a venue through the bouncer cascade (BouncerDivisor, auto-bouncer threshold; 1-day guest list / NoCROWS live at the contract). Needs your LAU. send=false (default) = DRYRUN only; send=true goes through the gate (approval card in wallet mode A/B).",
  parameters: {
    type: "object",
    properties: {
      address: { type: "string", description: "venue address; omit for the app's current venue" },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate" },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    // world-facing: the venue layer keys on the REGISTERED LAU (CHO.Enter);
    // mid-plan truth (64.1): a step after register sees the stale snapshot.
    // 65.1: an UNREADABLE live leg falls back to the pending LAU (the same
    // token when registration did land) and lets the DRYRUN arbitrate —
    // unreadable ≠ absent; only a leg that READS null refuses.
    let lau = ctx.snapshot?.lau ?? null;
    if (lau === null) {
      const live = await resolveLiveLauYue(ctx);
      if (live.lau !== null) lau = live.lau;
      else if (!live.lauReadable) lau = pendingLau(ctx.account)?.lau ?? null;
    }
    if (lau === null) return { error: pendingLau(ctx.account) !== null ? "join needs your REGISTERED LAU — finish onboarding with register (CHOA.Play) first" : "you need a LAU first — create_lau, then join" };
    const venue = await resolveVenue(args["address"]);
    if (venue === null) return { error: "no venue — pass an address or select one first" };
    const qing = await loadAbi("QING.json");
    const request: GateRequest = {
      to: venue.address,
      data: encodeFunctionData({ abi: [pickFn(qing, "Join", 1)], functionName: "Join", args: [lau] }),
      account: ctx.account,
      abi: qing,
      meta: { source: "agent", label: `agent join ${venue.address}` },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      return { mode: "DRYRUN", venue: venue.address, ...dryrunGateSummary(env) };
    }
    return { mode: "SEND", venue: venue.address, ...outcomeSummary(await gateSendRefreshing(ctx, request)) };
  },
};

const runBeat: AgentTool = {
  name: "run_beat",
  risk: "act",
  description: `META.Beat(Waat) — the world heartbeat: converts Fornax balance + venue state into output. CEILING-AWARE: the deployed Fornax Goldilocks ceiling exists; Beat gas median ${BEAT_GAS_MEDIAN.toString()} with a ${BEAT_GAS_LIMIT.toString()} limit that is right but not generous; fresh Eta callers panic 0x12 at any funding level. send=false (default) = DRYRUN only (pure preview — the shared Entropy head means committed results differ); send=true goes through the gate.`,
  parameters: {
    type: "object",
    properties: {
      waat: { type: "string", description: "decimal waat; omit for the current venue's waat" },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate" },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    let waat: bigint | null = null;
    if (typeof args["waat"] === "string" && /^\d+$/.test(args["waat"])) waat = BigInt(args["waat"]);
    if (waat === null) {
      const venue = await resolveVenue(null);
      if (venue === null) return { error: "no waat given and no current venue — pass waat or select a venue" };
      const client = makeClient(ctx.rpcUrl);
      const state = await loadVenueState(client, venue.address, ctx.account);
      if (state.waat === null) return { error: `live waat read failed for ${venue.address}` };
      waat = state.waat;
    }
    const metaAbi = await loadAbi("META.json");
    const request: GateRequest = {
      to: addr("META"),
      data: encodeFunctionData({ abi: [pickFn(metaAbi, "Beat", 1)], functionName: "Beat", args: [waat] }),
      account: ctx.account,
      abi: metaAbi,
      meta: { source: "agent", label: `agent Beat waat ${waat.toString()}` },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      return { mode: "DRYRUN", waat: waat.toString(), ...dryrunGateSummary(env) };
    }
    return { mode: "SEND", waat: waat.toString(), ...outcomeSummary(await gateSendRefreshing(ctx, request)) };
  },
};

/**
 * CHEON.Su(venue) — the settle verb (session-50 venue depth, IA-REEVAL-49
 * B1.1): advances the caller's YUE bars at the venue (ReactYue), pays the
 * MAI-capped bounty (≤ 1) from CHEON's own balance into the YUE, drips 1
 * unit of the account token home, returns the refreshed (Charge, Hypobar,
 * Epibar). The ecosystem's most-called function. Needs a YUE (NotStarted
 * otherwise). The DRYRUN decodes the returned bars — a pure preview.
 */
const settleVenue: AgentTool = {
  name: "settle_venue",
  risk: "act",
  description:
    "CHEON.Su(venue) — the settle verb, the ecosystem's most-called function: advance your YUE's attendance bars at the venue, draw the MAI-capped bounty (up to 1, house money while it lasts) into your YUE, drip 1 unit of your account token home, and return the refreshed (Charge, Hypobar, Epibar). Needs your YUE. send=false (default) = DRYRUN only (the previewed bars are pure — the shared Entropy head makes committed results differ); send=true goes through the gate.",
  parameters: {
    type: "object",
    properties: {
      address: { type: "string", description: "venue address; omit for the app's current venue" },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate" },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    if (ctx.snapshot?.yue == null) {
      // mid-plan truth (64.1): a plan step after start_yue sees the stale
      // snapshot. 65.1: UNREADABLE ≠ absent — a failed YUE leg falls through
      // to the DRYRUN (the arbiter); only a leg that READS null refuses.
      const live = await resolveLiveLauYue(ctx);
      if (live.yue == null && live.yueReadable) return { error: "settle needs your YUE (Sei.Chi reverts NotStarted without one) — start_yue first" };
    }
    const venue = await resolveVenue(args["address"]);
    if (venue === null) return { error: "no venue — pass an address or select one first" };
    const cheon = await loadAbi("CHEON.json");
    const request: GateRequest = {
      to: addr("CHEON"),
      data: encodeFunctionData({ abi: [pickFn(cheon, "Su", 1)], functionName: "Su", args: [venue.address] }),
      account: ctx.account,
      abi: cheon,
      meta: { source: "agent", label: `agent settle ${venue.address}` },
    };
    const summarize = (env: GateEnvelope): Record<string, unknown> => {
      const base = dryrunGateSummary(env);
      if (env.sim?.ok === true && env.sim.result !== null) {
        try {
          const decoded = decodeFunctionResult({ abi: [pickFn(cheon, "Su", 1)], functionName: "Su", data: env.sim.result }) as unknown as [
            bigint,
            bigint,
            bigint,
          ];
          if (decoded.every((v) => typeof v === "bigint")) {
            base["previewBars"] = { charge: decoded[0]!.toString(), hypobar: decoded[1]!.toString(), epibar: decoded[2]!.toString() };
          }
        } catch {
          /* decode failure is informational only */
        }
      }
      return base;
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      return { mode: "DRYRUN", venue: venue.address, ...summarize(env) };
    }
    return { mode: "SEND", venue: venue.address, ...outcomeSummary(await gateSendRefreshing(ctx, request)) };
  },
};

/**
 * DO.Take(venue) — the deed (session-51, IA-REEVAL-49 B1.4): a
 * once-per-venue-EVER claim that adds the caller's EOA as a QING owner
 * (via CHO.AddContractOwner) and mints 1 DO to the caller's user token.
 * Fork+disassembly-verified gate (session-51): the check keys on the
 * WRAPPED ASSET (asset == userToken ∨ asset.owner(origin) ∨, for assets
 * exposing Creator(), asset.Creator() == origin); an ineligible Take is a
 * SILENT NO-OP (status 1, nothing happens) and an asset answering neither
 * probe reverts raw — DO has no recovered source (hand-pinned fragment,
 * selector 0x8f26e8d5), so sends classify unknown-contract (extra ack).
 */
const takeVenue: AgentTool = {
  name: "take_venue",
  risk: "act",
  description:
    "DO.Take(venue) — the deed: a once-per-venue-EVER claim that adds your EOA as a QING owner (renames, settings, the owners' drawer) and mints 1 DO to your user token. The gate keys on the WRAPPED ASSET, not the venue: you may Take when the venue wraps your own account token, or you hold an owner (or Creator) stake in the wrapped asset. An ineligible Take is a SILENT NO-OP — the tx lands successful, nothing happens, gas is spent — so a green DRYRUN is not a deed proof; verify via get_venue's yourOwnerPass flipping. Assets answering neither owner(address) nor Creator() make Take revert raw. DO has no recovered source: the gate classifies the send unknown-contract with an extra ack. send=false (default) = DRYRUN only; send=true goes through the gate.",
  parameters: {
    type: "object",
    properties: {
      address: { type: "string", description: "venue address; omit for the app's current venue" },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate" },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    const venue = await resolveVenue(args["address"]);
    if (venue === null) return { error: "no venue — pass an address or select one first" };
    let eligibility = "asset stake unreadable — an ineligible Take is a SILENT NO-OP (successful tx, nothing happens, gas spent)";
    try {
      const stake = await loadVenueState(makeClient(ctx.rpcUrl), venue.address, ctx.account, {
        lau: ctx.snapshot?.lau ?? null,
        yue: ctx.snapshot?.yue ?? null,
      });
      eligibility = stake.assetIsUserToken
        ? "the venue wraps your account token — eligible"
        : stake.assetOwnerPass === null
          ? "the wrapped asset does not answer owner(address) — Take reverts raw"
          : stake.assetOwnerPass
            ? "you pass owner(address) on the wrapped asset — eligible"
            : "no owner stake in the wrapped asset — an ineligible Take is a SILENT NO-OP (successful tx, nothing happens, gas spent)";
    } catch {
      /* the DRYRUN below still covers the revert class */
    }
    const request: GateRequest = {
      to: addr("DO"),
      data: encodeTake(venue.address),
      account: ctx.account,
      meta: { source: "agent", label: `agent take the deed ${venue.address}` },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      return { mode: "DRYRUN", venue: venue.address, eligibility, ...dryrunGateSummary(env) };
    }
    const out = await gateSendRefreshing(ctx, request);
    const base = outcomeSummary(out);
    base["eligibility"] = eligibility;
    if (out.status === "sent") {
      base["verify"] = "re-run get_venue — yourOwnerPass flipping to true is the proof the deed landed (tx status alone is NOT)";
    }
    return { mode: "SEND", venue: venue.address, ...base };
  },
};

/**
 * MAP.New(asset) — venue creation (session-51, IA-REEVAL-49 B1.8 — the
 * §7.3 create_venue gap closed). One QING per asset ever; no approval, gas
 * only. The Forbidden pre-check reads WITH the account (the WITHOUT ban leg
 * is tx.origin-keyed). NewQing's args are NOT indexed — the post-send decode
 * reads the receipt's data words for (Qing, asset, Waat).
 */
const createVenue: AgentTool = {
  name: "create_venue",
  risk: "act",
  description:
    "MAP.New(asset) — wrap any ERC-20 into a fresh QING venue: no approval, gas only, ONE venue per asset ever planet-wide. If the asset already has its QING the DRYRUN reverts QingAlreadyExists(Token, Qing) — the decoded second arg IS the existing venue's address (the chain's only asset→QING oracle); do not send in that case. The asset's owner can veto in advance (MAP.Forbid — pre-checked with you as tx.origin). The world assigns the coordinates (a CHO.Luo lottery draw through HECKE, unpredictable pre-create); a tile collision reverts the whole create with gas spent — always DRYRUN first, never spray-create. You are auto-STAFFED (bouncer powers) but NOT an owner, and the venue carries no AFFECTION rate until an owner adds one. Wrapping YOUR OWN LAU claims your HOME QING — uniquely yours forever (the LAU is unique and one venue per asset ever), it unlocks the deed (the venue wraps your own account token) and is the natural Beat target; a one-way planet-wide claim. send=false (default) = DRYRUN only; send=true goes through the gate and decodes the new venue's address + waat from the receipt.",
  parameters: {
    type: "object",
    properties: {
      asset: { type: "string", description: "the ERC-20 address to wrap" },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate" },
    },
    required: ["asset"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    const asset = launderAddress(args["asset"]);
    if (asset === null) return { error: "asset must be a 0x… address (the ERC-20 to wrap)" };
    const map = await loadAbi("MAP.json");
    const request: GateRequest = {
      to: addr("MAP"),
      data: encodeFunctionData({ abi: [pickFn(map, "New", 1)], functionName: "New", args: [asset] }),
      account: ctx.account,
      abi: map,
      meta: { source: "agent", label: `agent create venue for ${asset}` },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      let forbidden: boolean | null = null;
      try {
        forbidden = (await readCreatePrecheck(makeClient(ctx.rpcUrl), asset, ctx.account)).forbidden;
      } catch {
        forbidden = null;
      }
      const out: Record<string, unknown> = { mode: "DRYRUN", asset, forbiddenPrecheck: forbidden, ...dryrunGateSummary(env) };
      // session-73: the revert DECODES now — QingAlreadyExists(Token, Qing)
      // carries the EXISTING QING's address as its second arg (the chain's
      // only asset→QING oracle; map.sol:70)
      const decoded = env.sim?.error?.decoded ?? null;
      const qae = decoded !== null && decoded.startsWith("QingAlreadyExists(") ? decoded.match(/0x[0-9a-fA-F]{40}/g) : null;
      if (qae !== null && qae.length >= 2) {
        out["existingVenue"] = qae[1]!.toLowerCase();
        out["note"] = "this asset ALREADY has its one QING (one per asset ever) — the decoded revert hands you the existing venue; do not send";
      }
      return capOutput(out);
    }
    const out = await gateSendRefreshing(ctx, request);
    const base = outcomeSummary(out);
    if (out.status === "sent" && out.receipt !== null) {
      const created = decodeNewQing(out.receipt.logs);
      if (created !== null) {
        base["venue"] = created.qing;
        base["newWaat"] = created.waat.toString();
        base["note"] = "created — you are auto-staffed (bouncer powers), not an owner; no AFFECTION rate until an owner adds one";
        // session-69.2 (the owner's video round): a landed create becomes
        // the app's CURRENT venue (the manual card's set-as-current,
        // agent-side) — a follow-up join/settle in the same plan resolves
        // it without an explicit address (the video-1 join_venue wart)
        try {
          setCurrentVenue(
            await liveVenueRow(makeClient(ctx.rpcUrl), created.qing as Address, out.receipt.blockNumber !== null ? Number(out.receipt.blockNumber) : 0)
          );
          base["selected"] = true;
        } catch {
          /* a dead post-send read must not fail the landed send */
        }
        // the home-QING capture (session-65): the wrapped asset IS the
        // account's LAU (registered or pending — the app carries either)
        const mine = resolveActLau(ctx);
        if (mine !== null && created.asset.toLowerCase() === mine.toLowerCase()) {
          setHomeVenue(ctx.account, { venue: created.qing, asset: created.asset, waat: created.waat.toString(), txHash: out.txHash });
          base["homeVenue"] = true;
          base["note"] =
            "your HOME QING is claimed — uniquely yours forever (one venue per asset ever, and the LAU is yours alone); the deed (DO.Take) is eligible here and the venue is your natural Beat target";
        }
      }
    }
    return { mode: "SEND", asset, ...base };
  },
};

const createLau: AgentTool = {
  name: "create_lau",
  risk: "act",
  description:
    "LAUFactory.New(name, symbol) — create your LAU (the account token that carries your name; it can hold tokens and pay them back out). First onboarding step; the app carries the created LAU as PENDING (pre-registration) until the register step lands. send=false (default) = DRYRUN only (the preview decodes the predicted address).",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "token name (your account name onchain)" },
      symbol: { type: "string", description: "token symbol" },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate" },
    },
    required: ["name", "symbol"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    if (ctx.snapshot?.lau != null) return { error: "this wallet already has a LAU — one per wallet via the factory path" };
    if (pendingLau(ctx.account) !== null) return { error: "this wallet already has a PENDING LAU (created, not yet registered) — continue the chain with set_username / start_yue / register instead of creating a second one" };
    const name = str(args["name"] ?? "").trim();
    const symbol = str(args["symbol"] ?? "").trim();
    if (name.length === 0 || symbol.length === 0) return { error: "name and symbol are required" };
    const abi = await loadAbi("LAUFactory.json");
    const request: GateRequest = {
      to: addr("LAUFactory"),
      data: encodeFunctionData({ abi: [pickFn(abi, "New", 2)], functionName: "New", args: [name, symbol] }),
      account: ctx.account,
      abi,
      meta: { source: "agent", label: "agent create LAU" },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      const predicted = env.sim?.ok ? decodeNewPreview(env.sim.result) : null;
      return { mode: "DRYRUN", ...(predicted !== null ? { predictedLau: predicted } : {}), ...dryrunGateSummary(env) };
    }
    const out = await gateSendRefreshing(ctx, request);
    const base = outcomeSummary(out);
    if (out.status === "sent") {
      const created = captureCreatedLau(out, addr("LAUFactory"));
      if (created !== null) {
        setPendingLau(ctx.account, created, out.txHash);
        base["lau"] = created;
        base["pendingRegistration"] = true;
        base["note"] = "LAU created and carried as PENDING — the wallet→LAU discovery the app reads is written only by register (CHOA.Play); continue with set_username, then start_yue, then register";
      } else {
        base["note"] = "sent, but the created LAU could not be captured from the receipt — find it in the explorer before continuing (set_username/start_yue need the address)";
      }
    }
    return { mode: "SEND", ...base };
  },
};

const setUsername: AgentTool = {
  name: "set_username",
  risk: "act",
  description:
    "LAU.Username(string) — set the name the world sees on your chat lines. Cap is 12 BYTES onchain (MaximumLength revert — enforced here before any send). Must be set before SEI.Start and any chat path.",
  parameters: {
    type: "object",
    properties: {
      username: { type: "string", description: "the username (≤ 12 bytes)" },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate" },
    },
    required: ["username"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    const lau = resolveActLau(ctx);
    if (lau === null) return { error: "you need a LAU first — create_lau" };
    const username = str(args["username"] ?? "");
    const err = usernameError(username);
    if (err !== null) return { error: `username invalid: ${err}` };
    const lauAbi = await loadAbi("LAU.json");
    const request: GateRequest = {
      to: lau,
      data: encodeFunctionData({ abi: [pickFn(lauAbi, "Username", 1)], functionName: "Username", args: [username] }),
      account: ctx.account,
      abi: lauAbi,
      meta: { source: "agent", label: "agent set Username" },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      const base = dryrunGateSummary(env);
      if (ctx.snapshot?.lau == null) base["note"] = `operating on your PENDING (pre-registration) LAU — registration lands with register (CHOA.Play). ${base["note"] ?? ""}`.trim();
      return { mode: "DRYRUN", ...base };
    }
    return { mode: "SEND", ...outcomeSummary(await gateSendRefreshing(ctx, request)) };
  },
};

const startYue: AgentTool = {
  name: "start_yue",
  risk: "act",
  description:
    "SEI.Start(LAU, name, symbol) — open your YUE (the account-vault that holds what the world pays you). One per wallet; calling Start again only renames. Needs Username set first (the gate reverts otherwise). Works on your PENDING (pre-registration) LAU — registration lands with register (CHOA.Play). send=false (default) = DRYRUN only.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "vault token name" },
      symbol: { type: "string", description: "vault token symbol" },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate" },
    },
    required: ["name", "symbol"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    const lau = resolveActLau(ctx);
    if (lau === null) return { error: "you need a LAU first — create_lau" };
    if (ctx.snapshot?.lau != null && ctx.snapshot?.username == null) {
      // the registered path: the snapshot's Username read is trustworthy
      // (pre-registration it would read null even after set_username
      // committed — there the DRYRUN reveals the onchain gate honestly)
      return { error: "Username must be set before SEI.Start (onchain gate) — set_username first" };
    }
    const name = str(args["name"] ?? "").trim();
    const symbol = str(args["symbol"] ?? "").trim();
    if (name.length === 0 || symbol.length === 0) return { error: "name and symbol are required" };
    const sei = await loadAbi("SEI.json");
    const request: GateRequest = {
      to: addr("SEI"),
      data: encodeFunctionData({ abi: [pickFn(sei, "Start", 3)], functionName: "Start", args: [lau, name, symbol] }),
      account: ctx.account,
      abi: sei,
      meta: { source: "agent", label: "agent start YUE" },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      const base = dryrunGateSummary(env);
      if (ctx.snapshot?.lau == null) base["note"] = `operating on your PENDING (pre-registration) LAU — registration lands with register (CHOA.Play). ${base["note"] ?? ""}`.trim();
      return { mode: "DRYRUN", ...base };
    }
    return { mode: "SEND", ...outcomeSummary(await gateSendRefreshing(ctx, request)) };
  },
};

/**
 * The world registrar (session-64 — the closed-cycle exit, 62.1 fork
 * finding): CHOA.Play(LAU) → Cho().Enter writes the wallet→LAU mapping the
 * app's discovery reads (`snapshot.lau` = CHO.GetUserTokenAddress), plus the
 * first-time YueMintToOrigin. Play requires Username AND a YUE onchain
 * (AttributeNotFound 0x94c60c4a / 0x12efd467) — the YUE leg is
 * snapshot-readable, the Username leg on a PENDING LAU is not, so the
 * DRYRUN reveals it honestly.
 */
const registerTool: AgentTool = {
  name: "register",
  risk: "act",
  description:
    "CHOA.Play(LAU) — the world registrar, the LAST onboarding step: writes the wallet→LAU mapping the whole app discovers you by (Cho().Enter via CHOA.Play) and pays the first-Play YUE mint to origin. Needs Username set AND a YUE open (real onchain gates — the DRYRUN decodes the revert otherwise). Until it lands, the app carries your LAU as PENDING (pre-registration). send=false (default) = DRYRUN only.",
  parameters: {
    type: "object",
    properties: {
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate" },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    if (ctx.snapshot?.lau != null) return { ok: true, registered: true, noop: true, lau: ctx.snapshot.lau, note: "already registered — the wallet→LAU discovery resolves (CHO.GetUserTokenAddress); nothing to send" };
    // mid-plan truth (64.1 + the 65.1 hardening): the snapshot may predate
    // this run's own sends, and the live legs may FAIL independently —
    // UNREADABLE ≠ ABSENT. Only a READ-null YUE (with no snapshot truth)
    // refuses; a failed leg falls through and the gate DRYRUN is the
    // arbiter (it decodes AttributeNotFound / 0x12efd467 honestly).
    const live = await resolveLiveLauYue(ctx);
    if (live.lau !== null) return { ok: true, registered: true, noop: true, lau: live.lau, note: "already registered — the wallet→LAU discovery resolves (CHO.GetUserTokenAddress; SEI.Start's Enter already wrote it); nothing to send" };
    const lau = pendingLau(ctx.account)?.lau ?? null;
    if (lau === null) return { error: "you need a LAU first — create_lau, then set_username + start_yue, then register" };
    const yue = ctx.snapshot?.yue ?? live.yue;
    if (yue == null && live.yueReadable) {
      return { error: "register needs your YUE open first (Play reverts 0x12efd467 without one) — start_yue first" };
    }
    const choa = await loadAbi("CHOA.json");
    const request: GateRequest = {
      to: addr("CHOA"),
      data: encodeFunctionData({ abi: [pickFn(choa, "Play", 1)], functionName: "Play", args: [lau] }),
      account: ctx.account,
      abi: choa,
      meta: { source: "agent", label: "agent register (CHOA.Play)" },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      const base = dryrunGateSummary(env);
      if (env.sim?.ok !== true && env.sim?.error?.decoded == null && env.sim?.error != null) {
        base["note"] = "the DRYRUN reverted raw — on a PENDING LAU the Username leg is invisible to the snapshot; an unset Username answers AttributeNotFound (set_username first)";
      }
      return { mode: "DRYRUN", lau, ...base };
    }
    const out = await gateSendRefreshing(ctx, request);
    const base = outcomeSummary(out);
    if (out.status === "sent") {
      base["note"] = "registration sent — once the receipt lands, the wallet→LAU discovery flips (the pending carriage clears) and get_state answers your LAU";
    }
    return { mode: "SEND", lau, ...base };
  },
};

/** §7.4: schema-fenced chat posting — advertised ONLY behind the opt-in flag */
const sendChat: AgentTool = {
  name: "send_chat",
  risk: "act",
  description:
    "QING.Chat(LAU, string) — post one public, permanent line to a venue channel. Costs GAS only; the call mints 1 QING to the venue itself (informational); a venue CoverCharge in its Asset applies unless guest-listed. The message becomes public onchain content. send=true required to actually send (DRYRUN first otherwise).",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "the chat line (max 280 chars)" },
      address: { type: "string", description: "venue address; omit for the app's current venue" },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate" },
    },
    required: ["message"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (!ctx.chatToolsEnabled) return { error: "chat tools are disabled (SETTINGS → Agent — the §7.4 opt-in)" };
    // the FULL-AUTO cadence governor (session-65): min-interval between
    // chat SENDS, no spray — refuses when the mode's discipline says wait
    if (ctx.chatGate) {
      const g = ctx.chatGate(requireSendFlag(args));
      if (!g.ok) return { error: g.error };
    }
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    // world-facing: chat lines carry the REGISTERED identity
    const lau = ctx.snapshot?.lau ?? null;
    if (lau === null) return { error: pendingLau(ctx.account) !== null ? "chat paths need your REGISTERED LAU — finish onboarding with register (CHOA.Play) first" : "you need a LAU first — create_lau" };
    if (ctx.snapshot?.username == null) return { error: "chat paths need your Username set first" };
    const message = str(args["message"] ?? "");
    if (message.trim().length === 0) return { error: "empty message" };
    if (message.length > 280) return { error: `message ${message.length} chars > 280 (schema fence)` };
    const venue = await resolveVenue(args["address"]);
    if (venue === null) return { error: "no venue — pass an address or select one first" };
    const qing = await loadAbi("QING.json");
    const request: GateRequest = {
      to: venue.address,
      data: encodeFunctionData({ abi: [pickFn(qing, "Chat", 2)], functionName: "Chat", args: [lau, message] }),
      account: ctx.account,
      abi: qing,
      meta: { source: "agent", label: `agent chat → ${venue.address}` },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      return { mode: "DRYRUN", venue: venue.address, ...dryrunGateSummary(env) };
    }
    return { mode: "SEND", venue: venue.address, ...outcomeSummary(await gateSendRefreshing(ctx, request)) };
  },
};

/**
 * §7.4 world composer (session-48): CHOA.Chat(Qing, string) — venue chat
 * that pays. Same opt-in + 280-char schema fence as send_chat; the CHOA
 * transfer is contract-funded into the caller's YUE (needs a YUE — SEI.Chi
 * reverts NotStarted without one). Cost model informational, never
 * caller-paid, and never "MAI" (kb §3).
 */
const sendWorldChat: AgentTool = {
  name: "send_world_chat",
  risk: "act",
  description:
    "CHOA.Chat(Qing, string) — the chat-and-mine path: posts one public line to a VENUE channel (despite the tool's name it is NOT the world/main SHIO channel — that channel is VOID-written and read-only in this app) AND settles into your YUE. Costs GAS only; mints 1 QING to the venue (supply-side); while CHOA's buffer is non-empty, up to 1 CHOA moves from CHOA's OWN balance into your YUE — contract-funded, never caller-paid. Needs your YUE (reverts NotStarted without one). send=true required to actually send.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "the chat line (max 280 chars)" },
      address: { type: "string", description: "venue address; omit for the app's current venue" },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate" },
    },
    required: ["message"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (!ctx.chatToolsEnabled) return { error: "chat tools are disabled (SETTINGS → Agent — the §7.4 opt-in)" };
    // the FULL-AUTO cadence governor (session-65) — same seam as send_chat
    if (ctx.chatGate) {
      const g = ctx.chatGate(requireSendFlag(args));
      if (!g.ok) return { error: g.error };
    }
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    // world-facing: chat lines carry the REGISTERED identity
    const lau = ctx.snapshot?.lau ?? null;
    if (lau === null) return { error: pendingLau(ctx.account) !== null ? "chat paths need your REGISTERED LAU — finish onboarding with register (CHOA.Play) first" : "you need a LAU first — create_lau" };
    if (ctx.snapshot?.username == null) return { error: "chat paths need your Username set first" };
    if (ctx.snapshot?.yue == null) return { error: "CHOA.Chat resolves your YUE first (Sei.Chi reverts NotStarted without one) — start_yue before chatting" };
    const message = str(args["message"] ?? "");
    if (message.trim().length === 0) return { error: "empty message" };
    if (message.length > 280) return { error: `message ${message.length} chars > 280 (schema fence)` };
    const venue = await resolveVenue(args["address"]);
    if (venue === null) return { error: "no venue — pass an address or select one first" };
    const choa = await loadAbi("CHOA.json");
    const request: GateRequest = {
      to: addr("CHOA"),
      data: encodeFunctionData({ abi: [pickFn(choa, "Chat", 2)], functionName: "Chat", args: [venue.address, message] }),
      account: ctx.account,
      abi: choa,
      meta: { source: "agent", label: `agent world chat → ${venue.address}` },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      return { mode: "DRYRUN", venue: venue.address, ...dryrunGateSummary(env) };
    }
    return { mode: "SEND", venue: venue.address, ...outcomeSummary(await gateSendRefreshing(ctx, request)) };
  },
};

/**
 * dss_snipe (session-66, §7.4-fenced): the WORLD-channel write path
 * through the player's deployed self-snipe bundler — DSS.chatAndSnipe
 * posts "<Username> message" onto the world SHIO (LAU.Chat inside) AND
 * atomically self-purchases the minted LAU unit for exactly 1 Ⓐ (no
 * front-run window). Short Ⓐ allowance → the exact-1e18 APPROVE rides
 * first (two gate sends). Fork-pinned semantics: harness set-2 s7/s8/s14.
 */
const dssSnipe: AgentTool = {
  name: "dss_snipe",
  risk: "act",
  description:
    "DSS.chatAndSnipe(string) — the TRUE world-channel write path (through YOUR deployed self-snipe bundler): posts one public, permanent line '<Username> …' onto the world/main SHIO (what send_world_chat does NOT do — that tool posts to a VENUE channel) AND mints 1 unit of your LAU which the bundler self-purchases for exactly 1 Ⓐ and forwards to you, atomically — no front-run window on your emission. Costs GAS + 1 Ⓐ. When your Ⓐ allowance to the bundler is short, send=true issues TWO gate sends: the exact-1 Ⓐ APPROVE first, then the snipe — and the DRYRUN previews that two-leg path (the raw snipe preview reverts until the approve lands — EXPECTED, not a broken bundler). Needs your REGISTERED LAU + Username + a captured DSS (deploy it on IDENTITY — the emission desk). send=true required to actually send.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "the world line (max 280 chars; carries your Username prefix)" },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate (approve leg first when short)" },
    },
    required: ["message"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (!ctx.chatToolsEnabled) return { error: "chat tools are disabled (SETTINGS → Agent — the §7.4 opt-in)" };
    // the FULL-AUTO cadence governor — same seam as the chat-post tools
    if (ctx.chatGate) {
      const g = ctx.chatGate(requireSendFlag(args));
      if (!g.ok) return { error: g.error };
    }
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    const lau = ctx.snapshot?.lau ?? null;
    if (lau === null) return { error: pendingLau(ctx.account) !== null ? "world lines need your REGISTERED LAU — finish onboarding with register (CHOA.Play) first" : "you need a LAU first — create_lau" };
    if (ctx.snapshot?.username == null) return { error: "world lines carry your Username — set it first" };
    const dss = ctx.dss ?? null;
    if (dss === null)
      return { error: "no DSS captured — deploy the self-snipe bundler first (IDENTITY → the LAU emission desk; the app remembers the address from the creation receipt — the contract has no getter)" };
    const message = str(args["message"] ?? "");
    if (message.trim().length === 0) return { error: "empty message" };
    if (message.length > 280) return { error: `message ${message.length} chars > 280 (schema fence)` };
    const request: GateRequest = {
      to: dss,
      data: dssChatAndSnipeData(message),
      account: ctx.account,
      meta: { source: "agent", label: `agent dss_snipe → world (${dss})` },
    };
    // the Ⓐ allowance to the bundler: unreadable = treated as short (the
    // exact-1e18 approve is idempotent-safe) — shared by DRYRUN + SEND
    const account = ctx.account; // narrowed above; closures re-widen ctx.account
    const readAllowance = async (): Promise<bigint | null> => {
      try {
        const client = makeClient(ctx.rpcUrl);
        return (await client.readContract({
          address: addr("AFFECTION"),
          abi: [
            {
              type: "function",
              name: "allowance",
              stateMutability: "view",
              inputs: [
                { name: "o", type: "address" },
                { name: "s", type: "address" },
              ],
              outputs: [{ type: "uint256" }],
            },
          ],
          functionName: "allowance",
          args: [account, dss],
        })) as bigint;
      } catch {
        return null;
      }
    };
    if (!requireSendFlag(args)) {
      const allowance = await readAllowance();
      if (allowance === null || allowance < AFFECTION_UNIT) {
        // session-69: the RAW snipe preview reverts while the allowance is
        // short (the Purchase inside pulls 1 Ⓐ via transferFrom) — preview
        // the REAL two-leg send path instead so the preview never reads as
        // a broken bundler (fork-pinned set-2 s7)
        const approveEnv = await ctx.gateDryRun({
          to: addr("AFFECTION"),
          data: affectionApproveData(dss, AFFECTION_UNIT),
          account: ctx.account,
          meta: { source: "agent", label: `agent approve Ⓐ 1 → ${dss} (exact)` },
        });
        const snipeEnv = await ctx.gateDryRun(request);
        return {
          mode: "DRYRUN",
          dss,
          allowance: "short (the raw snipe preview below reverts until the approve lands — a preview cannot include leg 1's state change)",
          legs: [
            { leg: "approve-allowance (leg 1 of the send)", ...dryrunGateSummary(approveEnv) },
            { leg: "chatAndSnipe (leg 2 of the send)", ...dryrunGateSummary(snipeEnv) },
          ],
          note: "send=true issues TWO gate sends: the exact-1e18 Ⓐ APPROVE first, then the snipe — leg 2's revert here is EXPECTED, not a broken bundler (fork-pinned set-2 s7/s8)",
        };
      }
      const env = await ctx.gateDryRun(request);
      return {
        mode: "DRYRUN",
        dss,
        ...dryrunGateSummary(env),
        note: "the line posts to the world SHIO AND 1 Ⓐ self-purchases the minted LAU unit in the same tx",
      };
    }
    const allowance = await readAllowance();
    if (allowance === null || allowance < AFFECTION_UNIT) {
      const approveOut = await gateSendRefreshing(ctx, {
        to: addr("AFFECTION"),
        data: affectionApproveData(dss, AFFECTION_UNIT),
        account: ctx.account,
        meta: { source: "agent", label: `agent approve Ⓐ 1 → ${dss} (exact)` },
      });
      const approveSummary = outcomeSummary(approveOut);
      if (approveOut.status !== "sent") {
        return { mode: "SEND", status: "approve leg did not land — nothing beyond it was attempted", legs: [{ leg: "approve-allowance", ...approveSummary }] };
      }
      const snipeOut = await gateSendRefreshing(ctx, request);
      return {
        mode: "SEND",
        dss,
        status: snipeOut.status,
        legs: [{ leg: "approve-allowance", ...approveSummary }, { leg: "chatAndSnipe", ...outcomeSummary(snipeOut) }],
        ...(snipeOut.status === "sent"
          ? { refresh: "call get_state to see the LAU/Ⓐ deltas" }
          : { note: "the approve landed but the snipe did not — see legs above" }),
      };
    }
    return { mode: "SEND", dss, ...outcomeSummary(await gateSendRefreshing(ctx, request)) };
  },
};

const ALL_TOOLS: AgentTool[] = [
  getState,
  getVenue,
  searchVenuesTool,
  getLau,
  readContract,
  searchKbTool,
  explainTool,
  // §7.10 agent-authored lessons — always advertised (owner round,
  // session-54): it writes local memory only, cannot send, cannot ingest;
  // the operator-ack review gate is the trust boundary
  journalNoteTool,
  // session-74 THE STRATEGY LAYER — the structured next-goals menu closing
  // each FULL-AUTO cycle; always advertised (local memory only, no gate),
  // ack-free by the owner round (the operator OBJECTIVE is the boundary);
  // fenced OUT of plan steps (planTools)
  nextGoalsTool,
  joinVenue,
  runBeat,
  settleVenue,
  takeVenue,
  createVenue,
  createLau,
  setUsername,
  startYue,
  // the world registrar (session-64): closes the onboarding cycle —
  // CHOA.Play writes the wallet→LAU mapping the app's discovery reads
  registerTool,
  // the MARKET desk family (session-55, the recorded B4 "agent tool later"
  // round): purchase/redeem on the venue's Ⓐ rate + the YUE Hong/Hung
  // exchange pair — owner decisions: two exchange tools (no direction arg)
  // and auto-approve-when-short (one call may issue TWO gate sends, each
  // its own approval card; the quirk knowledge stays in code)
  ...DESK_TOOLS,
  // the wallet-custody family (session-56, the LAU/YUE move story): the
  // generic wallet transfer (+ native PLS mode) and the LAU pocket sweep —
  // single-leg sends, no approve pattern applies
  ...MOVE_TOOLS,
  // the SIM-scoped family (session-59, §8 arc part 2): world_code /
  // spawn_gwat / encrypt_note over the fork-verified never-deployed layer —
  // advertised ONLY in sim mode (SIM_TOOLS gate below)
  ...SIM_TOOLS_LIST,
  sendChat,
  sendWorldChat,
  // the DSS self-snipe leg (session-66): the world-channel write path
  // through the player's deployed bundler — §7.4-fenced with the family
  dssSnipe,
  // the §7.11 dashboard family — always advertised, pure UI side-effects
  ...DASHBOARD_TOOLS,
  // the L1 plan family (§7.8/§7.11.4) — propose/read, execution is human-gated
  ...PLAN_TOOLS,
];

/** all chat-post tools ride the same §7.4 opt-in (the DSS snipe writes a public world line) */
const CHAT_TOOLS = new Set(["send_chat", "send_world_chat", "dss_snipe"]);

/** the §8 SIM-layer family (session-59 + the 61 cipher read leg): never-deployed contracts — no live addresses */
export const SIM_TOOLS = new Set(["world_code", "spawn_gwat", "encrypt_note", "decrypt_note"]);

export function toolCatalog(chatToolsEnabled: boolean, simToolsEnabled = false): AgentTool[] {
  return ALL_TOOLS.filter((t) => (!CHAT_TOOLS.has(t.name) || chatToolsEnabled) && (!SIM_TOOLS.has(t.name) || simToolsEnabled));
}

export function toolByName(name: string): AgentTool | null {
  return ALL_TOOLS.find((t) => t.name === name) ?? null;
}

/** the wire-format tool specs advertised to the model */
export function toolSpecs(chatToolsEnabled: boolean, simToolsEnabled = false, allowlist: ReadonlySet<string> | null = null): ToolSpec[] {
  return toolCatalog(chatToolsEnabled, simToolsEnabled)
    .filter((t) => allowlist === null || allowlist.has(t.name))
    .map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
}

/** exposed for the venue-render test parity: same numbers the panel pins */
export function addressArg(args: Record<string, unknown>): Address | null {
  return launderAddress(args["address"]);
}

// re-exported so existing importers keep working post-extraction (session-55)
export { capOutput, TOOL_OUTPUT_CAP } from "@/agent/toolShared";
