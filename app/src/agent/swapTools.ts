import { isAddress, type Abi, type Address } from "viem";
import { classify } from "@/chain/policy";
import { FACTS } from "@/chain/facts";
import { makeClient } from "@/chain/client";
import { fmtAmt, readWalletLau, readWalletYue } from "@/chain/identity";
import { parseAmount, parseAmountToDecimals } from "@/chain/deskMath";
import {
  encodeSwapEthForExactTokens,
  erc20SwapMetaAbi,
  isCho,
  isFomalhaute,
  isFornax,
  isPhobos,
  isSeedShio,
  loadSwapQuote,
  maxInputWithSlippage,
  resolveSwapToken,
  swapDeadline,
  swapRouterAbi,
  SWAP_ROUTER,
  SWAP_WPLS,
  type SwapQuote,
} from "@/chain/swap";
import { pendingLau } from "@/state/pendingLau";
import type { GateOutcome, GateRequest } from "@/chain/txGate";
import type { AgentTool } from "@/agent/tools";
import { capOutput, envelopeSummary, outcomeSummary, requireSendFlag, str } from "@/agent/toolShared";

/**
 * swap_pls_for_token (session-83 — the owner's DEX acquisition round).
 *
 * The Beat gate is a four-token Eta seed (kb §3); the agent could already
 * MOVE tokens it held, but not ACQUIRE them. This tool turns native PLS into
 * any ERC-20 through PulseX V2, through THE gate:
 *
 *   - EXACT-OUTPUT only (`swapETHForExactTokens`): "buy exactly N wei of the
 *     token, never pay more than the cap". This is the honest seed ask — the
 *     floors are exact wei amounts (Fomalhaute 2 wei, CHO/Phobos ≥2), and the
 *     router REFUNDS unused native value (fork-verified: a 2,000-PLS send on a
 *     ~674-PLS quote left ~732 PLS including gas).
 *   - NATIVE-VALUE route: the router wraps the PLS itself, so there is NO
 *     approve leg and no MaxUint allowance anywhere.
 *   - PRICE-IMPACT GUARD (`maxImpactBps`, default 500 = 5%) + an exact
 *     `maxPls` ceiling. The four seed pools are thin (Fornax ~33 tokens,
 *     Phobos ~1 token at the pin); a large exact-output target is refused
 *     before the gate.
 *   - Recipient semantics are EXPLICIT: `wallet` (default), `lau`, `yue`, or
 *     a 0x… address. Fomalhaute/Fornax only count for the Beat AT THE LAU —
 *     the result warns when they are sent anywhere else.
 *
 * The router is EXTERNAL infrastructure, so the gate classifies it
 * unknown-contract (the mode-C breadth toggle may auto-ack in yolo; modes
 * A/B card it; the PLS value caps still bind). No deck widget maps to this
 * tool — the results point at get_state / move_tokens / run_beat.
 */

const DEFAULT_SLIPPAGE_BPS = 100;
const DEFAULT_MAX_IMPACT_BPS = 500;
const DEFAULT_DEADLINE_SEC = 1200;

interface RecipientRef {
  kind: "wallet" | "lau" | "yue" | "address";
  address: Address;
}

function recipientKind(raw: unknown): { kind: RecipientRef["kind"]; custom: Address | null } | { error: string } {
  const text = typeof raw === "string" ? raw.trim() : "";
  const lower = text.toLowerCase();
  if (text.length === 0 || lower === "wallet" || lower === "self") return { kind: "wallet", custom: null };
  if (lower === "lau") return { kind: "lau", custom: null };
  if (lower === "yue") return { kind: "yue", custom: null };
  if (isAddress(text, { strict: false })) return { kind: "address", custom: text as Address };
  return { error: `recipient must be "wallet" | "lau" | "yue" | a 0x… address — got "${text}"` };
}

function intArg(raw: unknown, fallback: number, min: number, max: number): { value: number } | { error: string } {
  if (raw === undefined || raw === null || raw === "") return { value: fallback };
  const n = typeof raw === "number" ? raw : Number(str(raw).trim());
  if (!Number.isInteger(n) || n < min || n > max) return { error: `must be an integer in [${min}, ${max}] — got "${str(raw)}"` };
  return { value: n };
}

function fmtRaw(v: bigint, decimals: number | null): string {
  return decimals === null ? `${v.toString()} base units (decimals unreadable)` : `${fmtAmt(v, decimals, 8)} (${v.toString()} base units)`;
}

function seedWarnings(token: Address, amountOutWei: bigint, recipient: RecipientRef["kind"]): string[] {
  const out: string[] = [];
  if (isFomalhaute(token)) {
    if (amountOutWei < 2n) out.push("BELOW THE FOMALHAUTE FLOOR: 2 wei is the deployed minimum — 1 wei zeroes the XIA.Charge modulus and Beat panics 0x12");
    if (recipient !== "lau") out.push("Fomalhaute only counts for the Beat AT THE LAU — this swap sends it to the " + recipient + "; use recipient \"lau\" or follow with move_tokens");
  }
  if (isFornax(token)) {
    if (recipient !== "lau") out.push("Fornax only counts for the Beat AT THE LAU — this swap sends it to the " + recipient + "; use recipient \"lau\" or follow with move_tokens");
    if (amountOutWei < 1_000_000_000_000_000n)
      out.push("1e15 wei is the smallest level with a cited live Beat success; Fornax must clear the live Entropy draw — preview run_beat and buy more if Eta.Iota is zero (no static ceiling exists)");
    else out.push("Fornax must clear the live Entropy draw — preview run_beat; if Eta.Iota is zero the draw moved, buy more and preview again (no static ceiling exists)");
  }
  if (isCho(token) || isPhobos(token)) {
    const label = isCho(token) ? "CHO" : "Phobos";
    if (amountOutWei < 2n) out.push(`BELOW THE ${label.toUpperCase()} YUAN FLOOR: Yuan must be ≥ 2 — 1 wei in the wallet gives Yuan=1 and Beat panics 0x12`);
    out.push(`${label} Yuan weights: wallet 1×, LAU 10×, YUE 40× — a wallet holding works at ≥ 2 wei; deeper parking raises the modulus`);
  }
  if (isSeedShio(token) && recipient === "lau") out.push("SHIO leg lands AT THE LAU — exactly where the Eta seed reads it");
  return out;
}

function nextStep(token: Address, recipient: RecipientRef["kind"]): string {
  if (isSeedShio(token)) {
    return recipient === "lau"
      ? "this SHIO leg is in place; acquire the other seed legs, then preview run_beat (DRYRUN)"
      : `move_tokens this SHIO to your LAU (recipient "lau" on the next swap, or move_tokens), then preview run_beat`;
  }
  if (isCho(token) || isPhobos(token)) {
    return "the Yuan leg is in place at ≥ 2 wei — acquire the other seed legs, then preview run_beat (DRYRUN)";
  }
  return "call get_state to see the fresh balance; for the Beat seed prefer Fomalhaute/Fornax to the LAU and CHO/Phobos to the wallet";
}

function receivedFrom(outcome: GateOutcome | { status: "no-signer" }, token: Address, recipient: Address): bigint | null {
  if (outcome.status !== "sent" || outcome.receipt === null) return null;
  const t = token.toLowerCase();
  const r = recipient.toLowerCase();
  let found = false;
  let sum = 0n;
  for (const m of outcome.movements) {
    if (m.token.toLowerCase() === t && m.to.toLowerCase() === r) {
      found = true;
      sum += m.amount;
    }
  }
  return found ? sum : null;
}

const swapPlsForToken: AgentTool = {
  name: "swap_pls_for_token",
  risk: "act",
  description:
    'Buy any ERC-20 with native PLS on PulseX V2 (router 0x165C… — external infra, verified on-chain). The acquisition leg for the Beat seed: Fomalhaute (WorldChatSHIO) 2 wei → recipient "lau"; Fornax (FornaxSHIO) 1e15 wei (0.001) or more → recipient "lau"; CHO 2 wei and Phobos 2 wei → recipient "wallet" (Yuan ≥2; wallet 1×, LAU 10×, YUE 40×). Give exactly one of amountOutWei (base units — use for the 2-wei floors, e.g. "2") or amountOut (whole tokens, e.g. "0.001"). EXACT-OUTPUT: you receive exactly the amount; the router refunds unused PLS, so the send carries quote × (1 + slippageBps) as msg.value and never more than maxPls (optional ceiling). Price-impact guard maxImpactBps (default 500 = 5%) refuses thin-pool quotes BEFORE the gate — the seed pools are thin. NO approve leg (native value route). send=false (default) = free DRYRUN quote. Four seed swaps fill the default per-run send cap (4) — buy in one run, Beat (and any Fornax retry) in the next, or raise the L2 knob. The router classifies unknown-contract (extra ack / mode-C breadth); PLS value caps bind.',
  parameters: {
    type: "object",
    properties: {
      token: { type: "string", description: 'FOMALHAUTE | FORNAX | CHO | PHOBOS | AFFECTION | CHOA | a 0x… ERC-20 address' },
      amountOutWei: { type: "string", description: 'exact base units out, e.g. "2" for the seed floors or "1000000000000000" for 0.001 Fornax' },
      amountOut: { type: "string", description: 'whole-token amount out, e.g. "0.001" (needs a readable decimals(); mutually exclusive with amountOutWei)' },
      maxPls: { type: "string", description: "optional PLS ceiling (whole PLS); the tool refuses when quote × (1 + slippage) exceeds it" },
      slippageBps: { type: "integer", description: `max-input headroom over the quote, default ${DEFAULT_SLIPPAGE_BPS} (1%); 0..2000` },
      maxImpactBps: { type: "integer", description: `price-impact guard, default ${DEFAULT_MAX_IMPACT_BPS} (5%); refuse above it; 0..10000` },
      recipient: { type: "string", description: '"wallet" (default) | "lau" | "yue" | a 0x… address — Fomalhaute/Fornax MUST be "lau" for the Beat' },
      deadlineSec: { type: "integer", description: `send deadline window in seconds, default ${DEFAULT_DEADLINE_SEC} (20 min); 60..7200` },
      send: { type: "boolean", description: "false/default = DRYRUN quote only; true = send through the gate" },
    },
    required: ["token"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };

    const ref = resolveSwapToken(str(args["token"] ?? ""));
    if (ref === null) return { error: 'token must be FOMALHAUTE | FORNAX | CHO | PHOBOS | AFFECTION | CHOA or a 0x… ERC-20 address' };
    if (ref.token.toLowerCase() === SWAP_ROUTER.toLowerCase()) return { error: "token is the router itself — not an ERC-20" };
    if (ref.token.toLowerCase() === SWAP_WPLS.toLowerCase()) return { error: "cannot swap PLS for WPLS — WPLS is the wrapped native route token itself" };

    const weiArg = typeof args["amountOutWei"] === "string" ? args["amountOutWei"].trim() : typeof args["amountOutWei"] === "number" ? String(args["amountOutWei"]) : "";
    const wholeArg = typeof args["amountOut"] === "string" ? args["amountOut"].trim() : typeof args["amountOut"] === "number" ? String(args["amountOut"]) : "";
    if (weiArg.length > 0 && wholeArg.length > 0) return { error: "give exactly one of amountOutWei or amountOut — not both" };
    if (weiArg.length === 0 && wholeArg.length === 0) return { error: 'amountOutWei or amountOut is required (the 2-wei floors use amountOutWei: "2")' };

    const slip = intArg(args["slippageBps"], DEFAULT_SLIPPAGE_BPS, 0, 2000);
    if ("error" in slip) return { error: `slippageBps ${slip.error}` };
    const impact = intArg(args["maxImpactBps"], DEFAULT_MAX_IMPACT_BPS, 0, 10000);
    if ("error" in impact) return { error: `maxImpactBps ${impact.error}` };
    const dl = intArg(args["deadlineSec"], DEFAULT_DEADLINE_SEC, 60, 7200);
    if ("error" in dl) return { error: `deadlineSec ${dl.error}` };

    let maxPls: bigint | null = null;
    const maxRaw = typeof args["maxPls"] === "string" ? args["maxPls"].trim() : typeof args["maxPls"] === "number" ? String(args["maxPls"]) : "";
    if (maxRaw.length > 0) {
      maxPls = parseAmount(maxRaw);
      if (maxPls === null || maxPls <= 0n) return { error: `maxPls must be a positive decimal PLS amount — got "${maxRaw}"` };
    }

    const rk = recipientKind(args["recipient"]);
    if ("error" in rk) return rk;

    const client = makeClient(ctx.rpcUrl);

    // exact-output amount: base units pass straight through; whole tokens need
    // the live decimals (never assume 18 for a value-bearing purchase)
    let amountOutWei: bigint;
    if (weiArg.length > 0) {
      if (!/^\d+$/.test(weiArg)) return { error: `amountOutWei must be a base-unit integer string — got "${weiArg}"` };
      amountOutWei = BigInt(weiArg);
      if (amountOutWei <= 0n) return { error: "amountOutWei must be > 0" };
    } else {
      let decimals: number | null = null;
      try {
        decimals = (await client.readContract({
          address: ref.token,
          abi: erc20SwapMetaAbi,
          functionName: "decimals",
        })) as number;
      } catch {
        decimals = null;
      }
      if (decimals === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 77) {
        return { error: `decimals() unreadable for ${ref.label} — pass amountOutWei (base units) instead of a whole-token amount` };
      }
      const parsed = parseAmountToDecimals(wholeArg, decimals);
      if (parsed === null || parsed <= 0n) return { error: `amountOut must be a positive decimal whole-token amount with at most ${decimals} fractional digits — got "${wholeArg}"` };
      amountOutWei = parsed;
    }

    // resolve the recipient LIVE (the snapshot can be one run behind a fresh
    // create/Play; pendingLau carries the created LAU through that window)
    let recipient: RecipientRef;
    if (rk.kind === "wallet") {
      recipient = { kind: "wallet", address: ctx.account };
    } else if (rk.kind === "address") {
      if (rk.custom === null) return { error: "recipient address is unreadable" };
      recipient = { kind: "address", address: rk.custom };
    } else if (rk.kind === "lau") {
      let lau = ctx.snapshot?.lau ?? pendingLau(ctx.account)?.lau ?? null;
      if (lau === null) lau = await readWalletLau(client, ctx.account).catch(() => null);
      if (lau === null) return { error: "you need a LAU first — create_lau, then swap to recipient \"lau\"" };
      recipient = { kind: "lau", address: lau };
    } else {
      let yue = ctx.snapshot?.yue ?? null;
      if (yue === null) yue = await readWalletYue(client, ctx.account).catch(() => null);
      if (yue === null) return { error: "no YUE resolved — start_yue first, or send to \"wallet\"/\"lau\"" };
      recipient = { kind: "yue", address: yue };
    }

    let quote: SwapQuote;
    try {
      quote = await loadSwapQuote(client, ref, amountOutWei);
    } catch (e) {
      return { error: `swap reads failed — ${e instanceof Error ? e.message : String(e)}` };
    }

    if (quote.priceImpactBps === null) {
      return { error: `cannot compute the price impact for ${ref.label} (unusable reserves) — refusing an unguarded swap` };
    }
    if (quote.priceImpactBps > impact.value) {
      return {
        error: `price impact ${quote.priceImpactBps} bps exceeds maxImpactBps ${impact.value} bps — the ${ref.label} pool is thin for this size. Lower amountOut or raise maxImpactBps deliberately.`,
        quote: {
          amountOutWei: quote.amountOutWei.toString(),
          amountInWei: quote.amountInWei.toString(),
          priceImpactBps: quote.priceImpactBps,
          reserves: { wpls: quote.reserveInWei.toString(), token: quote.reserveOutWei.toString() },
          pair: quote.pair,
        },
      };
    }

    const cap = maxInputWithSlippage(quote.amountInWei, slip.value);
    if (maxPls !== null && cap > maxPls) {
      return {
        error: `computed max input ${fmtAmt(cap)} PLS (quote + ${slip.value} bps) exceeds maxPls ${fmtAmt(maxPls)} — raise maxPls or lower amountOut`,
        quote: {
          amountOutWei: quote.amountOutWei.toString(),
          quotedPlsWei: quote.amountInWei.toString(),
          maxInputPlsWei: cap.toString(),
        },
      };
    }

    const walletPls = await client.getBalance({ address: ctx.account }).catch(() => null);
    const deadline = swapDeadline(Math.floor(Date.now() / 1000), dl.value);
    const data = encodeSwapEthForExactTokens({ amountOutWei, token: ref.token, recipient: recipient.address, deadline });
    const cls = classify({ to: SWAP_ROUTER, data, value: cap, facts: FACTS });

    const warnings = [
      ...(walletPls !== null && walletPls < cap ? [`wallet PLS (${fmtAmt(walletPls)}) is below the max input (${fmtAmt(cap)}) — the DRYRUN/node rejects insufficient funds`] : []),
      ...(quote.errors.length > 0 ? quote.errors : []),
      ...(quote.decimals === null ? ["decimals() unreadable — display assumes 18; amountOutWei is authoritative"] : []),
      ...(quote.priceImpactBps > 100 ? [`thin-pool quote: ${quote.priceImpactBps} bps over the reserve-ratio spot (includes the pool fee)`] : []),
      ...(slip.value === 0 ? ["slippageBps 0 means the max input is the exact quote — any reserve move before mining reverts; retry with headroom"] : []),
    ];

    const preview = {
      token: ref.token,
      tokenLabel: quote.symbol !== null ? `${ref.label} · symbol ${quote.symbol}` : ref.label,
      amountOutWei: amountOutWei.toString(),
      amountOut: fmtRaw(amountOutWei, quote.decimals),
      recipient: { kind: recipient.kind, address: recipient.address },
      pair: quote.pair,
      route: "PulseX V2 · native PLS → WPLS → " + ref.label + " (one hop, native value)",
      quotedPlsWei: quote.amountInWei.toString(),
      quotedPls: `${fmtAmt(quote.amountInWei, 18, 6)} PLS`,
      maxInputPlsWei: cap.toString(),
      maxInputPls: `${fmtAmt(cap, 18, 6)} PLS (quote + ${slip.value} bps; the router refunds unused PLS; gas is extra)`,
      ...(maxPls !== null ? { callerCapPls: `${fmtAmt(maxPls, 18, 6)} PLS (honored: computed cap is ≤ it)` } : {}),
      slippageBps: slip.value,
      priceImpactBps: quote.priceImpactBps,
      reserves: { wplsWei: quote.reserveInWei.toString(), tokenWei: quote.reserveOutWei.toString() },
      walletPls: walletPls !== null ? fmtAmt(walletPls, 18, 6) : "unreadable",
      deadlineUtc: new Date(Number(deadline) * 1000).toISOString(),
      quoteBlock: quote.blockNumber?.toString() ?? "unreadable",
      gateClass: cls.risk === "unknown-contract" ? "unknown-contract (the PulseX router is external infra) — the approval card carries an extra ack in modes A/B; mode-C breadth may auto-ack; PLS value caps bind; the seed swap is ONE send (no approve leg)" : `gate class ${cls.risk}`,
      warnings: warnings.length > 0 ? warnings : undefined,
      seed: seedWarnings(ref.token, amountOutWei, recipient.kind),
      next: nextStep(ref.token, recipient.kind),
    };

    const request: GateRequest = {
      to: SWAP_ROUTER,
      data,
      value: cap,
      account: ctx.account,
      abi: swapRouterAbi as unknown as Abi,
      meta: { source: "agent", label: `agent swap ${fmtAmt(amountOutWei, quote.decimals ?? 18, 8)} ${ref.label} → ${recipient.kind}` },
    };

    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      return capOutput({ mode: "DRYRUN", ...preview, ...envelopeSummary(env) });
    }

    const out = await ctx.gateSend(request);
    const summary = outcomeSummary(out);
    const { status, ...rest } = summary;
    const received = receivedFrom(out, ref.token, recipient.address);
    return capOutput({
      mode: "SEND",
      status,
      ...preview,
      receivedWei: received !== null ? received.toString() : null,
      received: received !== null ? fmtRaw(received, quote.decimals) : "unreadable (no matching Transfer log — call get_state)",
      ...rest,
      ...(out.status === "sent" ? { refresh: "call get_state to see the fresh balances; then preview run_beat (DRYRUN)" } : {}),
    });
  },
};

export const SWAP_TOOLS: AgentTool[] = [swapPlsForToken];
