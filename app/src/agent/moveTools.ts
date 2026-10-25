import { encodeFunctionData, type Abi, type Address } from "viem";
import { addr } from "@config/addresses";
import { FACTS } from "@/chain/facts";
import { classify } from "@/chain/policy";
import { loadAbi } from "@/chain/abiLoad";
import { makeClient } from "@/chain/client";
import { fmtAmt } from "@/chain/identity";
import { loadErc20Hold } from "@/chain/moveReads";
import { parseAmountToDecimals } from "@/chain/deskMath";
import type { GateRequest } from "@/chain/txGate";
import type { AgentTool } from "@/agent/tools";
import { capOutput, dryrunGateSummary, launderAddress, outcomeSummary, pickFn, requireSendFlag, str } from "@/agent/toolShared";

/**
 * The wallet-custody agent tools (session-56 — the LAU/YUE move story,
 * owner round at the open):
 *
 *   move_tokens  wallet-level ERC-20 transfer (any token, any destination)
 *                + a native PLS mode (plain value tx) — the owner call.
 *   sweep_lau    LAU.Withdraw(what, amount) — the agent mirror of the
 *                manual IDENTITY pocket sweep (session-53).
 *
 * THE MOVE STORY (verified against 11_lau.sol / domain/yue.sol, kb §4):
 * LAU.Withdraw pays MSG.SENDER — no destination arg exists (blast radius:
 * your own wallet); it is UNMETERED (no _mintToCap — fork-pinned s13-era).
 * YUE.Withdraw(what, to, amount) is onlyOwners AND msg.sender == Chan
 * (OnlyChan) AND OnlyGameTokens — the vault is CUSTODIAL, moved only by the
 * CHAN escrow; it is NOT a player path and gets no tool. Funding either
 * account is a plain transfer TO its address (the YUE pots the exchange
 * desk pays from are stocked exactly that way — fork-pinned s12).
 *
 * Both tools are SINGLE-LEG: a transfer needs no allowance, so there is no
 * approve leg ever (the session-55 auto-approve pattern does not apply).
 * The top-level `status` is the one leg's outcome — the plan runner's
 * send-stop reads it directly. No deck widget maps to either tool (the
 * onboarding-tool precedent); results point at get_state/get_lau instead.
 */

const erc20TransferAbi = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

/** exposed for the selector regression test (never for direct calls) */
export const _erc20TransferAbi = erc20TransferAbi;

/** presentation-only display for non-18-dec tokens (deskMath stays the parse home) */
function fmtScaled(v: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const int = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac.length > 0 ? `${int}.${frac}` : `${int}`;
}

/**
 * The SAME classification the gate will produce (zero drift — policy.classify
 * is the gate's own function): renders the honesty story BEFORE any send.
 */
function transferClassNote(token: Address): string {
  const data = encodeFunctionData({ abi: erc20TransferAbi as unknown as Abi, functionName: "transfer", args: [token, 0n] });
  const cls = classify({ to: token, data, value: 0n, facts: FACTS });
  if (cls.risk === "standard") return `perimeter token — the gate classifies transfer standard (facts row exists)`;
  if (cls.risk === "unknown-method") return `gate classifies this transfer unknown-method (Ⓐ's facts interface covers only mint/burn — the DEPLOYED token does transfer; the desk legs rely on its transferFrom) — extra ack, never a denial`;
  return `gate classifies the destination unknown-contract (venue/LAU/YUE instances and third-party tokens live outside the perimeter facts) — extra ack, denial only if unknown destinations are disabled in SETTINGS`;
}

function maxOrAmount(raw: unknown, decimals: number, max: bigint | null): { ok: true; amount: bigint; isMax: boolean } | { ok: false; error: string } {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : "";
  if (text.trim().toLowerCase() === "max") {
    if (max === null) return { ok: false, error: "balance unreadable — cannot resolve \"max\"; pass an explicit amount" };
    if (max <= 0n) return { ok: false, error: "balance is zero — nothing to move" };
    return { ok: true, amount: max, isMax: true };
  }
  const amount = parseAmountToDecimals(text, decimals);
  if (amount === null) return { ok: false, error: `amount must be a decimal number of whole tokens (e.g. "1.5") or "max" — got "${str(raw)}"` };
  if (amount <= 0n) return { ok: false, error: "amount must be > 0" };
  return { ok: true, amount, isMax: false };
}

const moveTokens: AgentTool = {
  name: "move_tokens",
  risk: "act",
  description:
    'Wallet-level ERC-20 transfer (or native PLS send): move tokens OUT of your wallet to any address. token = "PLS" or an ERC-20 address (Ⓐ, CHOA, a QING venue token, your LAU…); to = any address. Meaningful destinations: your LAU (stocks its pocket — sweep back with sweep_lau) and your YUE (stocks the vault pots the exchange desk pays from); paying another player is a plain transfer too. Plain transfer semantics — NO approval, a single tx, amount in whole tokens or "max" (your full balance). Gate honesty: instance/third-party tokens classify unknown-contract (extra ack); Ⓐ classifies unknown-method (its facts interface covers only mint/burn — the deployed token transfers fine); PLS sends are policy value-capped. send=false (default) = DRYRUN + preview only.',
  parameters: {
    type: "object",
    properties: {
      token: { type: "string", description: '"PLS" or the ERC-20 contract address' },
      to: { type: "string", description: "destination address (any)" },
      amount: { type: "string", description: 'decimal whole tokens, e.g. "1.5", or "max" for your full balance' },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate" },
    },
    required: ["token", "to", "amount"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    const to = launderAddress(args["to"]);
    if (to === null) return { error: "to must be a 0x… address" };
    const tokenArg = str(args["token"] ?? "").trim();
    if (tokenArg.length === 0) return { error: 'token is required: "PLS" or an ERC-20 address' };

    // ---- native PLS mode: a plain value tx, empty calldata ----
    if (tokenArg.toLowerCase() === "pls") {
      const client = makeClient(ctx.rpcUrl);
      let walletPls: bigint | null = null;
      try {
        walletPls = await client.getBalance({ address: ctx.account });
      } catch {
        walletPls = null;
      }
      const amt = maxOrAmount(args["amount"], 18, walletPls);
      if (!amt.ok) return { error: amt.error };
      const preview = {
        token: "PLS (native)",
        to,
        amount: `${fmtAmt(amt.amount)} PLS${amt.isMax ? " (max — your full balance)" : ""}`,
        walletPls: walletPls !== null ? fmtAmt(walletPls) : "unreadable",
        notes: [
          "native value send — the gate's PLS value caps (per-tx/session/day) bind; the approval card carries the destination",
          ...(amt.isMax ? ["MAX leaves nothing for gas — the send will fail node-side unless you shave a little off"] : []),
          ...(walletPls !== null && walletPls < amt.amount ? [`wallet PLS (${fmtAmt(walletPls)}) is below the amount — the DRYRUN/node rejects insufficient-funds`] : []),
        ],
      };
      const request: GateRequest = {
        to,
        data: "0x",
        value: amt.amount,
        account: ctx.account,
        meta: { source: "agent", label: `agent move ${fmtAmt(amt.amount)} PLS → ${to}` },
      };
      if (!requireSendFlag(args)) {
        const env = await ctx.gateDryRun(request);
        return capOutput({ mode: "DRYRUN", ...preview, ...dryrunGateSummary(env) });
      }
      const out = await ctx.gateSend(request);
      return capOutput({ mode: "SEND", ...preview, ...outcomeSummary(out), ...(out.status === "sent" ? { refresh: "call get_state to see the fresh balances" } : {}) });
    }

    // ---- ERC-20 mode: token.transfer(to, amount) from the wallet ----
    const token = launderAddress(tokenArg);
    if (token === null) return { error: 'token must be "PLS" or a 0x… ERC-20 address' };
    const client = makeClient(ctx.rpcUrl);
    let hold: Awaited<ReturnType<typeof loadErc20Hold>> | null = null;
    try {
      hold = await loadErc20Hold(client, token, ctx.account);
    } catch (e) {
      return { error: `token reads failed — ${e instanceof Error ? e.message : String(e)}` };
    }
    const decimals = hold.decimals ?? 18;
    const amt = maxOrAmount(args["amount"], decimals, hold.balance);
    if (!amt.ok) return { error: amt.error };
    const warnings = [
      ...(hold.balance !== null && hold.balance < amt.amount ? [`wallet holds less (${fmtScaled(hold.balance, decimals)}) than the amount (${fmtScaled(amt.amount, decimals)}) — the DRYRUN reverts DysnomiaInsufficientBalance`] : []),
      ...(hold.decimals === null ? ["decimals() unreadable — assumed 18 (the family standard); third-party tokens may differ"] : []),
      ...hold.errors,
      ...(to.toLowerCase() === token.toLowerCase() ? ["destination is the TOKEN CONTRACT ITSELF — tokens sent there are usually unrecoverable"] : []),
      ...(to.toLowerCase() === ctx.account!.toLowerCase() ? ["destination is YOUR OWN wallet — a no-op economically, gas spent"] : []),
    ];
    const preview = {
      token,
      tokenLabel: hold.symbol !== null ? `${hold.symbol}${hold.name !== null ? ` (${hold.name})` : ""}` : "symbol unreadable",
      to,
      amount: `${fmtScaled(amt.amount, decimals)}${amt.isMax ? " (max — your full balance)" : ""}`,
      rawBaseUnits: amt.amount.toString(),
      decimals,
      walletBalance: hold.balance !== null ? fmtScaled(hold.balance, decimals) : "unreadable",
      gateClass: transferClassNote(token),
      warnings,
    };
    const request: GateRequest = {
      to: token,
      data: encodeFunctionData({ abi: erc20TransferAbi as unknown as Abi, functionName: "transfer", args: [to, amt.amount] }),
      account: ctx.account,
      meta: { source: "agent", label: `agent move ${fmtScaled(amt.amount, decimals)} → ${to}` },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      return capOutput({ mode: "DRYRUN", ...preview, ...dryrunGateSummary(env) });
    }
    const out = await ctx.gateSend(request);
    return capOutput({ mode: "SEND", ...preview, ...outcomeSummary(out), ...(out.status === "sent" ? { refresh: "call get_state to see the fresh balances" } : {}) });
  },
};

const sweepLau: AgentTool = {
  name: "sweep_lau",
  risk: "act",
  description:
    'LAU.Withdraw(what, amount) — sweep tokens your LAU holds (bounties, gifts, mistakes) back out to YOUR wallet. The contract pays msg.sender: there is NO destination arg — the payout address is fixed to the caller (tiny blast radius). Unmetered (no supply mint). token = "AFFECTION" | "CHOA" or an ERC-20 address; amount in whole tokens or "max". The YUE counterpart (YUE.Withdraw) is CHAN-custodian-only — NOT a player path; the vault moves only through the exchange desk or direct transfers to its address. send=false (default) = DRYRUN + preview only.',
  parameters: {
    type: "object",
    properties: {
      token: { type: "string", description: '"AFFECTION" | "CHOA" or the ERC-20 contract address' },
      amount: { type: "string", description: 'decimal whole tokens, e.g. "1.5", or "max" for the LAU\'s full holding' },
      send: { type: "boolean", description: "false/default = DRYRUN only; true = send through the gate" },
    },
    required: ["token", "amount"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.account === null) return { error: "no account — SETTINGS → wallet" };
    const lau = ctx.snapshot?.lau ?? null;
    if (lau === null) return { error: "you need a LAU first — create_lau (the pocket lives on it)" };
    const tokenArg = str(args["token"] ?? "").trim();
    const upper = tokenArg.toUpperCase();
    const token: Address | null = upper === "AFFECTION" || upper === "CHOA" ? (addr(upper) as Address) : launderAddress(tokenArg);
    if (token === null) return { error: 'token must be "AFFECTION" | "CHOA" or a 0x… ERC-20 address' };
    const named = upper === "AFFECTION" || upper === "CHOA";
    const client = makeClient(ctx.rpcUrl);
    let hold: Awaited<ReturnType<typeof loadErc20Hold>> | null = null;
    try {
      hold = await loadErc20Hold(client, token, lau);
    } catch (e) {
      return { error: `token reads failed — ${e instanceof Error ? e.message : String(e)}` };
    }
    const decimals = hold.decimals ?? 18;
    const amt = maxOrAmount(args["amount"], decimals, hold.balance);
    if (!amt.ok) return { error: amt.error };
    const preview = {
      lau,
      token,
      tokenLabel: hold.symbol !== null ? hold.symbol : named ? upper : "symbol unreadable",
      amount: `${fmtScaled(amt.amount, decimals)}${amt.isMax ? " (max — the LAU's full holding)" : ""}`,
      rawBaseUnits: amt.amount.toString(),
      decimals,
      lauHolds: hold.balance !== null ? fmtScaled(hold.balance, decimals) : "unreadable",
      pays: "YOUR WALLET — LAU.Withdraw pays msg.sender; no destination arg exists (11_lau.sol)",
      metered: false,
      gateClass: "LAU instances send as unknown-contract (factory child, no perimeter facts) — extra ack, intended",
      warnings: [
        ...(hold.balance !== null && hold.balance < amt.amount ? [`the LAU holds less (${fmtScaled(hold.balance, decimals)}) than the amount — the DRYRUN reverts DysnomiaInsufficientBalance`] : []),
        ...(!named && hold.decimals === null ? ["decimals() unreadable — assumed 18 (the family standard)"] : []),
        ...hold.errors,
      ],
    };
    const lauAbi = await loadAbi("LAU.json");
    const request: GateRequest = {
      to: lau,
      data: encodeFunctionData({ abi: [pickFn(lauAbi, "Withdraw", 2)], functionName: "Withdraw", args: [token, amt.amount] }),
      account: ctx.account,
      abi: lauAbi,
      meta: { source: "agent", label: `agent sweep LAU pocket ${preview.tokenLabel}` },
    };
    if (!requireSendFlag(args)) {
      const env = await ctx.gateDryRun(request);
      return capOutput({ mode: "DRYRUN", ...preview, ...dryrunGateSummary(env) });
    }
    const out = await ctx.gateSend(request);
    return capOutput({ mode: "SEND", ...preview, ...outcomeSummary(out), ...(out.status === "sent" ? { refresh: "call get_state / get_lau to see the fresh balances" } : {}) });
  },
};

export const MOVE_TOOLS: AgentTool[] = [moveTokens, sweepLau];
