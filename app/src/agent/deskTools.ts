import { encodeFunctionData, type Abi, type Address } from "viem";
import { addr } from "@config/addresses";
import { loadAbi } from "@/chain/abiLoad";
import { makeClient } from "@/chain/client";
import { fmtAmt } from "@/chain/identity";
import { loadVenueState } from "@/chain/venueState";
import { loadVenuePurchaseLeg, loadVenueRedeemLeg, loadYueDesk } from "@/chain/yueDesk";
import { parseAmount, purchaseCost } from "@/chain/deskMath";
import type { GateRequest } from "@/chain/txGate";
import type { AgentTool } from "@/agent/tools";
import { capOutput, dryrunGateSummary, outcomeSummary, pickFn, requireSendFlag, resolveVenue, str } from "@/agent/toolShared";

/**
 * The MARKET desk agent tools (session-55 — the recorded B4 "agent tool
 * later, after the Redeem leg" decision; the manual surfaces landed
 * session-48/52). Four verbs mirroring the two manual desks:
 *
 *   purchase_affection  QING.Purchase(AFFECTION, amount) on the venue
 *   redeem_affection    QING.Redeem(AFFECTION, amount) on the venue
 *   exchange_hong       YUE.Hong(asset, venue, amount) — buy venue tokens
 *   exchange_hung       YUE.Hung(venue, asset, amount) — redeem them
 *
 * OWNER DECISIONS (session-55 open): (1) TWO exchange tools — no
 * one-letter-diff direction arg for the model to flip; each description
 * carries its own spend/receive direction. (2) AUTO-APPROVE-WEN-SHORT —
 * when the spend-side allowance is short, one send=true call issues TWO
 * gate sends: the exact-amount APPROVE first (its own label + approval
 * card), then the main leg; the quirk knowledge (spender = the venue / THE
 * VENUE ITSELF on redeem / your YUE on the exchange) stays in code, never
 * in model context. If the approve leg does not land "sent", the main leg
 * is skipped and reported.
 *
 * Fork-pinned truths inherited verbatim (harness set-2 s12, pin
 * 27,674,000): the vault is the counterparty on BOTH exchange legs (payout
 * draws on the VAULT'S OWN inventory — `venue.balanceOf(yue)` /
 * `asset.balanceOf(yue)`, never the venue escrow); the direct pair's
 * GetAssetRate == the posted rate exactly (the 777-mod attenuation divides
 * a ZERO accumulator on hop one); a 0 rate = no route
 * (ExchangeRateNotFound on use); the base Purchase/Redeem pay from the
 * VENUE'S Ⓐ escrow (thin-escrow honesty rides the results). The L2
 * per-run tx cap (default 4) counts each send attempt — a two-leg call
 * says so in its result.
 */

const erc20ApproveAbi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

/** exposed for the selector regression test (never for direct calls) */
export const _erc20ApproveAbi = erc20ApproveAbi;

type Leg = { leg: string } & Record<string, unknown>;

/** resolve + validate the decimal amount arg (wei; > 0) */
function amountArg(args: Record<string, unknown>): { ok: true; amount: bigint } | { ok: false; error: string } {
  const raw = args["amount"];
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : "";
  const amount = parseAmount(text);
  if (amount === null) return { ok: false, error: `amount must be a decimal number of whole tokens (e.g. "1.5") — got "${str(raw)}"` };
  if (amount <= 0n) return { ok: false, error: "amount must be > 0" };
  return { ok: true, amount };
}

/**
 * The auto-approve send path: APPROVE first when the allowance is short
 * (exact-amount — never infinite), then the main leg. Each send is its own
 * gate request (own approval card in wallet mode A/B); the per-run L2 cap
 * applies per ATTEMPT, so a two-leg call says so in the result.
 */
async function sendWithApprove(
  ctx: Parameters<AgentTool["execute"]>[1],
  approve: { token: Address; spender: Address; need: bigint; label: string } | null,
  main: { request: GateRequest; label: string }
): Promise<{ legs: Leg[]; sent: boolean; status: string }> {
  if (ctx.account === null) return { legs: [{ leg: "preflight", status: "no-signer", error: "no account active" }], sent: false, status: "no-signer" };
  const legs: Leg[] = [];
  if (approve !== null) {
    const req: GateRequest = {
      to: approve.token,
      data: encodeFunctionData({ abi: erc20ApproveAbi as unknown as Abi, functionName: "approve", args: [approve.spender, approve.need] }),
      account: ctx.account,
      meta: { source: "agent", label: approve.label },
    };
    legs.push({ leg: "approve-allowance", token: approve.token, spender: approve.spender, exactAmount: approve.need.toString(), ...outcomeSummary(await ctx.gateSend(req)) });
    if (legs[0]!.status !== "sent") {
      // the top-level status mirrors the last attempted leg — the plan
      // runner's "send ≠ sent is a stop" reads THIS (session-55)
      return { legs, sent: false, status: String(legs[0]!.status) };
    }
  }
  const mainOut = await ctx.gateSend(main.request);
  legs.push({ leg: main.label, ...outcomeSummary(mainOut) });
  return { legs, sent: mainOut.status === "sent", status: mainOut.status };
}

function txBudgetNote(legs: Leg[]): string {
  return legs.length > 1
    ? `this call sent ${legs.length} txs — each counts against the per-run agent tx cap (SETTINGS → Agent)`
    : "this call sent 1 tx — it counts against the per-run agent tx cap (SETTINGS → Agent)";
}

// ---------------- the Ⓐ desk (Purchase / Redeem on the venue) ----------------

const purchaseAffection: AgentTool = {
  name: "purchase_affection",
  risk: "act",
  description:
    'QING.Purchase(AFFECTION, amount) — buy the venue\'s token with Ⓐ at the venue\'s posted rate (cost = amount × rate / 1e18, pulled from your WALLET via transferFrom). When your Ⓐ allowance to the venue is short, send=true issues TWO gate sends: the exact-amount Ⓐ APPROVE first, then the Purchase — each gets its own approval card in wallet mode A/B. Fresh venues carry no Ⓐ rate (MarketRateNotFound). send=false (default) = DRYRUN + full preview only.',
  parameters: {
    type: "object",
    properties: {
      address: { type: "string", description: "venue address; omit for the app's current venue" },
      amount: { type: "string", description: 'decimal amount of the venue token to buy, e.g. "1.5"' },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate (approve leg first when short)" },
    },
    required: ["amount"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    const venue = await resolveVenue(args["address"]);
    if (venue === null) return { error: "no venue — pass an address or select one first" };
    const amt = amountArg(args);
    if (!amt.ok) return { error: amt.error };
    const client = makeClient(ctx.rpcUrl);
    let rate: bigint | null = null;
    let rateKnown = false;
    let readErrors: string[] = [];
    try {
      const state = await loadVenueState(client, venue.address, ctx.account, { lau: ctx.snapshot?.lau ?? null, yue: ctx.snapshot?.yue ?? null });
      rate = state.marketRateAffection;
      rateKnown = state.marketRateKnown;
      readErrors = state.errors;
    } catch (e) {
      return { error: `venue reads failed — ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!rateKnown || rate === null) {
      return {
        error: "no Ⓐ market rate on this venue — Purchase(AFFECTION, ·) reverts MarketRateNotFound until an owner runs AddMarketRate (fresh venues carry none; Phobos's rate is a KNOWN 0)",
        venue: venue.address,
      };
    }
    const cost = purchaseCost(amt.amount, rate);
    let allowance: bigint | null = null;
    try {
      allowance = (await loadVenuePurchaseLeg(client, venue.address, ctx.account)).affectionAllowance;
    } catch {
      allowance = null; // unreadable = treat as short (the manual button does the same)
    }
    const walletAffection = ctx.snapshot?.balances.affection.wallet ?? null;
    const preview = {
      venue: venue.address,
      amount: fmtAmt(amt.amount),
      rate: `${fmtAmt(rate)} Ⓐ / 1.0 venue token`,
      cost: `${fmtAmt(cost)} Ⓐ (pulled from your wallet via transferFrom)`,
      walletAffection: walletAffection !== null ? fmtAmt(walletAffection) : null,
      allowanceToVenue: allowance !== null ? fmtAmt(allowance) : "unreadable — treated as short",
      needsApprove: allowance === null || allowance < cost,
      warnings: [
        ...(walletAffection !== null && walletAffection < cost ? [`wallet Ⓐ (${fmtAmt(walletAffection)}) is below the cost (${fmtAmt(cost)}) — the DRYRUN will revert DysnomiaInsufficientBalance`] : []),
        ...readErrors,
      ],
    };
    const qing = await loadAbi("QING.json");
    const request: GateRequest = {
      to: venue.address,
      data: encodeFunctionData({ abi: [pickFn(qing, "Purchase", 2)], functionName: "Purchase", args: [addr("AFFECTION"), amt.amount] }),
      account: ctx.account,
      abi: qing,
      meta: { source: "agent", label: `agent Purchase Ⓐ → ${venue.address}` },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      return capOutput({ mode: "DRYRUN", ...preview, ...dryrunGateSummary(env) });
    }
    const { legs, sent, status } = await sendWithApprove(
      ctx,
      preview.needsApprove ? { token: addr("AFFECTION"), spender: venue.address, need: cost, label: `agent approve Ⓐ ${fmtAmt(cost)} → ${venue.address}` } : null,
      { request, label: "purchase" }
    );
    return capOutput({
      mode: "SEND",
      status,
      ...preview,
      legs,
      ...(legs.some((l) => l.leg === "approve-allowance") ? { budgetNote: txBudgetNote(legs) } : {}),
      ...(sent ? { refresh: "call get_state / get_venue to see the new balances" } : { note: "a leg did not send — see legs above; nothing beyond it was attempted" }),
    });
  },
};

const redeemAffection: AgentTool = {
  name: "redeem_affection",
  risk: "act",
  description:
    "QING.Redeem(AFFECTION, amount) — the reverse bridge: hand back venue tokens, receive amount × rate / 1e18 Ⓐ from the VENUE'S Ⓐ escrow (it only holds what Purchases deposited — a thin escrow reverts rather than paying). The prerequisite is a quirk: the venue-token allowance's spender is THE VENUE ITSELF; when short, send=true issues the exact-amount SELF-APPROVE first, then the Redeem (two gate sends, each its own approval card). send=false (default) = DRYRUN + full preview only.",
  parameters: {
    type: "object",
    properties: {
      address: { type: "string", description: "venue address; omit for the app's current venue" },
      amount: { type: "string", description: 'decimal amount of the venue token to redeem, e.g. "1.5"' },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate (self-approve leg first when short)" },
    },
    required: ["amount"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    const venue = await resolveVenue(args["address"]);
    if (venue === null) return { error: "no venue — pass an address or select one first" };
    const amt = amountArg(args);
    if (!amt.ok) return { error: amt.error };
    const client = makeClient(ctx.rpcUrl);
    let rate: bigint | null = null;
    let rateKnown = false;
    try {
      const state = await loadVenueState(client, venue.address, ctx.account);
      rate = state.marketRateAffection;
      rateKnown = state.marketRateKnown;
    } catch (e) {
      return { error: `venue reads failed — ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!rateKnown || rate === null) {
      return { error: "no Ⓐ market rate on this venue — Redeem(AFFECTION, ·) reverts MarketRateNotFound until an owner runs AddMarketRate", venue: venue.address };
    }
    const payout = purchaseCost(amt.amount, rate);
    let leg: Awaited<ReturnType<typeof loadVenueRedeemLeg>> | null = null;
    try {
      leg = await loadVenueRedeemLeg(client, venue.address, ctx.account);
    } catch {
      leg = null; // escrow/allowance reads degraded — the tool proceeds honest-null
    }
    const escrow = leg?.affectionEscrow ?? null;
    const selfAllowance = leg?.selfAllowance ?? null;
    const myQing = leg?.myQing ?? null;
    const preview = {
      venue: venue.address,
      amount: fmtAmt(amt.amount),
      payout: `${fmtAmt(payout)} Ⓐ (paid from the VENUE'S Ⓐ escrow)`,
      yourVenueTokens: myQing !== null ? fmtAmt(myQing) : "unreadable",
      venueEscrow: escrow !== null ? fmtAmt(escrow) : "unreadable",
      selfAllowanceToVenue: selfAllowance !== null ? fmtAmt(selfAllowance) : "unreadable — treated as short (the spender quirk: the VENUE ITSELF)",
      needsSelfApprove: selfAllowance === null || selfAllowance < amt.amount,
      warnings: [
        ...(escrow !== null && escrow < payout ? [`THIN ESCROW: the venue's Ⓐ escrow (${fmtAmt(escrow)}) is below this payout (${fmtAmt(payout)}) — Redeem reverts insufficient-balance rather than paying`] : []),
        ...(myQing !== null && myQing < amt.amount ? [`you hold less (${fmtAmt(myQing)}) than the redeem amount (${fmtAmt(amt.amount)})`] : []),
        ...(leg?.errors ?? []),
      ],
    };
    const qing = await loadAbi("QING.json");
    const request: GateRequest = {
      to: venue.address,
      data: encodeFunctionData({ abi: [pickFn(qing, "Redeem", 2)], functionName: "Redeem", args: [addr("AFFECTION"), amt.amount] }),
      account: ctx.account,
      abi: qing,
      meta: { source: "agent", label: `agent Redeem Ⓐ ← ${venue.address}` },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      return capOutput({ mode: "DRYRUN", ...preview, ...dryrunGateSummary(env) });
    }
    const { legs, sent, status } = await sendWithApprove(
      ctx,
      preview.needsSelfApprove ? { token: venue.address, spender: venue.address, need: amt.amount, label: `agent self-approve venue tokens → the venue itself (${venue.address})` } : null,
      { request, label: "redeem" }
    );
    return capOutput({
      mode: "SEND",
      status,
      ...preview,
      legs,
      ...(legs.some((l) => l.leg === "approve-allowance") ? { budgetNote: txBudgetNote(legs) } : {}),
      ...(sent ? { refresh: "call get_state / get_venue to see the new balances" } : { note: "a leg did not send — see legs above; nothing beyond it was attempted" }),
    });
  },
};

// ---------------- the YUE exchange desk (Hong / Hung) ----------------

interface ExchangeCommon {
  yue: Address;
  venue: Address;
  asset: Address;
  amount: bigint;
  rate: bigint;
}

/** the shared exchange preview + honesty story (the fork-pinned s12 truths) */
function exchangePreview(kind: "hong" | "hung", c: ExchangeCommon, legs: { spendBalance: bigint | null; spendAllowance: bigint | null; payoutPot: bigint | null; pairValid: boolean | null }): Record<string, unknown> {
  const cost = purchaseCost(c.amount, c.rate);
  const spendNeed = kind === "hong" ? cost : c.amount;
  const payoutAmount = kind === "hong" ? c.amount : cost;
  return {
    venue: c.venue,
    yue: c.yue,
    wrappedAsset: c.asset,
    amount: fmtAmt(c.amount),
    rate: `${fmtAmt(c.rate)} asset / 1.0 venue token (GetAssetRate — on the DIRECT pair this is the posted rate exactly)`,
    ...(kind === "hong"
      ? { youPay: `${fmtAmt(cost)} of the wrapped asset (pulled from your wallet)`, youReceive: `${fmtAmt(c.amount)} of the venue token` }
      : { youPay: `${fmtAmt(c.amount)} of the venue token (pulled from your wallet)`, youReceive: `${fmtAmt(cost)} of the wrapped asset` }),
    yourSpendBalance: legs.spendBalance !== null ? fmtAmt(legs.spendBalance) : "unreadable",
    allowanceToYue: legs.spendAllowance !== null ? fmtAmt(legs.spendAllowance) : "unreadable — treated as short",
    needsApprove: legs.spendAllowance === null || legs.spendAllowance < spendNeed,
    warnings: [
      ...(legs.spendBalance !== null && legs.spendBalance < spendNeed
        ? [`wallet short of the ${kind === "hong" ? "wrapped asset" : "venue token"} leg (${fmtAmt(legs.spendBalance)} < ${fmtAmt(spendNeed)}) — the desk pulls it via transferFrom`]
        : []),
      ...(legs.payoutPot !== null && legs.payoutPot < payoutAmount
        ? [`THIN POT: your vault holds only ${fmtAmt(legs.payoutPot)} of the payout side — BOTH desk legs pay from the VAULT'S OWN inventory (fork-pinned), so it must already hold ${fmtAmt(payoutAmount)}`]
        : []),
      ...(legs.pairValid === false ? ["the IsValidAsset pair check fails — Hong/Hung revert InvalidPair for this pair"] : []),
    ],
    counterparty: "the vault is the counterparty: it keeps what you pay in and pays out of its OWN holdings — the venue's self-escrow is never touched",
  };
}

/** the shared exchange execution (resolve → rate walk → DRYRUN/SEND) */
async function executeExchange(
  kind: "hong" | "hung",
  args: Record<string, unknown>,
  ctx: Parameters<AgentTool["execute"]>[1]
): Promise<Record<string, unknown>> {
  if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
  const yue = ctx.snapshot?.yue ?? null;
  if (yue == null) return { error: "the exchange desk lives ON your YUE — start_yue first (same prerequisite as settle)" };
  const venue = await resolveVenue(args["address"]);
  if (venue === null) return { error: "no venue — pass an address or select one first" };
  const amt = amountArg(args);
  if (!amt.ok) return { error: amt.error };
  const client = makeClient(ctx.rpcUrl);
  let asset: Address | null = null;
  try {
    const state = await loadVenueState(client, venue.address, ctx.account, { lau: ctx.snapshot?.lau ?? null, yue });
    asset = state.asset;
  } catch (e) {
    return { error: `venue reads failed — ${e instanceof Error ? e.message : String(e)}` };
  }
  if (asset === null) return { error: `the venue's wrapped-asset read failed for ${venue.address} — cannot walk the pair` };
  let desk: Awaited<ReturnType<typeof loadYueDesk>> | null = null;
  try {
    desk = await loadYueDesk(client, yue, venue.address, asset, ctx.account);
  } catch (e) {
    return { error: `desk reads failed — ${e instanceof Error ? e.message : String(e)}` };
  }
  const rate = desk.rate;
  if (rate === null) return { error: "the GetAssetRate walk read failed — retry or read_contract YUE.GetAssetRate", venue: venue.address };
  if (rate === 0n) {
    return {
      error: "GetAssetRate walked 0 — NO ROUTE. This venue carries no posted rate for its own wrapped asset; Hong/Hung revert ExchangeRateNotFound until an owner posts AddMarketRate(asset, ·)",
      venue: venue.address,
      pairValid: desk.pairValid,
    };
  }
  const c: ExchangeCommon = { yue, venue: venue.address, asset, amount: amt.amount, rate };
  const preview = exchangePreview(kind, c, {
    spendBalance: kind === "hong" ? desk.myAsset : desk.myQing,
    spendAllowance: kind === "hong" ? desk.assetAllowance : desk.qingAllowance,
    payoutPot: kind === "hong" ? desk.yueQingPot : desk.yueAssetPot,
    pairValid: desk.pairValid,
  });
  const yueAbi = await loadAbi("YUE.json");
  const request: GateRequest =
    kind === "hong"
      ? {
          to: yue,
          data: encodeFunctionData({ abi: [pickFn(yueAbi, "Hong", 3)], functionName: "Hong", args: [asset, venue.address, amt.amount] }),
          account: ctx.account,
          abi: yueAbi,
          meta: { source: "agent", label: `agent Hong ${venue.address}` },
        }
      : {
          to: yue,
          data: encodeFunctionData({ abi: [pickFn(yueAbi, "Hung", 3)], functionName: "Hung", args: [venue.address, asset, amt.amount] }),
          account: ctx.account,
          abi: yueAbi,
          meta: { source: "agent", label: `agent Hung ${venue.address}` },
        };
  if (!requireSendFlag(args)) {
    const env = await ctx.gateDryRun(request);
    return capOutput({
      mode: "DRYRUN",
      ...preview,
      ...dryrunGateSummary(env),
      rateWalk:
        "GetAssetRate walks venue → asset via Asset(); cheap posted rates (rate/1e16 < 777) attenuate chained pricing, and a hop with no rate kills the route — on the DIRECT pair it returns the posted rate unchanged",
    });
  }
  const spendNeed = kind === "hong" ? purchaseCost(amt.amount, rate) : amt.amount;
  const spendToken = kind === "hong" ? asset : venue.address;
  const { legs, sent, status } = await sendWithApprove(
    ctx,
    (preview.needsApprove as boolean)
      ? { token: spendToken, spender: yue, need: spendNeed, label: `agent approve ${kind === "hong" ? "wrapped asset" : "venue token"} → your YUE` }
      : null,
    { request, label: kind === "hong" ? "hong" : "hung" }
  );
  return capOutput({
    mode: "SEND",
    status,
    ...preview,
    legs,
    ...(legs.some((l) => l.leg === "approve-allowance") ? { budgetNote: txBudgetNote(legs) } : {}),
    ...(sent ? { refresh: "call get_state / get_venue to see the new balances" } : { note: "a leg did not send — see legs above; nothing beyond it was attempted" }),
  });
}

const exchangeHong: AgentTool = {
  name: "exchange_hong",
  risk: "act",
  description:
    "YUE.Hong(asset, venue, amount) — BUY venue tokens with the venue's wrapped asset, THROUGH YOUR VAULT at the composed GetAssetRate walk (you pay amount × rate / 1e18 of the wrapped asset). The vault is the counterparty: it pays the venue tokens out of ITS OWN inventory (fork-pinned) — if the vault does not already hold them, the buy fails. When your wrapped-asset allowance to the YUE is short, send=true issues the exact-amount APPROVE first, then the Hong (two gate sends, each its own approval card). A 0 rate = no route (ExchangeRateNotFound). send=false (default) = DRYRUN + full preview only.",
  parameters: {
    type: "object",
    properties: {
      address: { type: "string", description: "venue address; omit for the app's current venue" },
      amount: { type: "string", description: 'decimal amount of the venue token to buy, e.g. "1.5"' },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate (approve leg first when short)" },
    },
    required: ["amount"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    return executeExchange("hong", args, ctx);
  },
};

const exchangeHung: AgentTool = {
  name: "exchange_hung",
  risk: "act",
  description:
    "YUE.Hung(venue, asset, amount) — REDEEM venue tokens back into the venue's wrapped asset, THROUGH YOUR VAULT at the composed GetAssetRate walk (you hand back `amount` venue tokens, receive amount × rate / 1e18 of the wrapped asset). The vault is the counterparty: it pays the wrapped asset out of ITS OWN inventory (fork-pinned) — if the vault does not already hold enough, the redeem fails. When your venue-token allowance to the YUE is short, send=true issues the exact-amount APPROVE first, then the Hung (two gate sends, each its own approval card). A 0 rate = no route (ExchangeRateNotFound). send=false (default) = DRYRUN + full preview only.",
  parameters: {
    type: "object",
    properties: {
      address: { type: "string", description: "venue address; omit for the app's current venue" },
      amount: { type: "string", description: 'decimal amount of the venue token to redeem, e.g. "1.5"' },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate (approve leg first when short)" },
    },
    required: ["amount"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    return executeExchange("hung", args, ctx);
  },
};

export const DESK_TOOLS: AgentTool[] = [purchaseAffection, redeemAffection, exchangeHong, exchangeHung];
