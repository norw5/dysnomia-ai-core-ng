import { EXPLORER_TX, KNOWN_MAINNET_RPC } from "@config/addresses";
import { makeClient } from "@/chain/client";
import { isLocalForkRpc, normalizeRpcUrl, rpcHost } from "@/chain/rpc";
import { toReceiptLike } from "@/chain/receipt";
import { extractMovements, type ReceiptLike } from "@/chain/txGate";
import type { AgentTool } from "@/agent/tools";
import { capOutput, str } from "@/agent/toolShared";

/**
 * tx_status (session-84 — the owner's Beat report). A read-only resolver for
 * a BROADCAST transaction hash. The 12s receipt timeout made a successful
 * Beat (`0x787cdc…cc139`, block 28,105,481) look unconfirmed; the agent then
 * tried `read_contract` on the hash (the wrong probe) and stopped. This tool
 * is the correct probe: it checks the selected RPC and the known public
 * fallbacks READ-ONLY (never on a loopback fork) for a receipt, then for the
 * transaction itself, and reports:
 *
 *   confirmed            receipt success (block/gas/movements/source)
 *   reverted             receipt status 0 — the tx mined but failed
 *   pending              tx seen in the mempool, no block yet
 *   mined-receipt-missing tx IS mined but this RPC's receipt index lags
 *   unknown              no RPC returned a receipt or the tx
 *
 * It never sends; it cannot double-spend. The prompt law: after a send with
 * `status: sent` + `receiptError` (or confirmation "unconfirmed"), call
 * tx_status BEFORE claiming failure or retrying.
 */

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

function shortErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}

function movementSummary(receipt: ReceiptLike): Array<Record<string, string>> {
  return extractMovements(receipt)
    .slice(0, 8)
    .map((m) => ({ token: m.token, from: m.from, to: m.to, amount: m.amount.toString() }));
}

const txStatus: AgentTool = {
  name: "tx_status",
  risk: "read",
  description:
    'Confirm a BROADCAST transaction by hash (read-only): checks the selected RPC + the known public fallback RPCs and returns status "confirmed" (receipt success: block/gas/movements/source), "reverted", "pending" (mempool), "mined-receipt-missing" (mined but the RPC receipt index lags), or "unknown". USE THIS after any send whose result carries status "sent" + receiptError / confirmation "unconfirmed" — a broadcast transaction is NOT a failed one — before claiming failure or retrying. It never sends; a loopback anvil fork checks only the fork. Includes the explorer tx link.',
  parameters: {
    type: "object",
    properties: {
      hash: { type: "string", description: "the 0x… 32-byte transaction hash to confirm" },
    },
    required: ["hash"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const hash = str(args["hash"] ?? "").trim();
    if (!TX_HASH_RE.test(hash)) return { error: "hash must be a 0x… 32-byte transaction hash (0x + 64 hex)" };
    const txHash = hash as `0x${string}`;

    const selected = { label: "selected RPC", client: makeClient(ctx.rpcUrl) };
    const fallbacks = isLocalForkRpc(ctx.rpcUrl)
      ? []
      : KNOWN_MAINNET_RPC.filter((u) => normalizeRpcUrl(u) !== normalizeRpcUrl(ctx.rpcUrl)).map((u) => ({
          label: rpcHost(u),
          client: makeClient(u),
        }));
    const sources = [selected, ...fallbacks];
    const errors: string[] = [];
    const explorer = `${EXPLORER_TX}${txHash}`;

    // 1) any receipt wins — status success/reverted is final
    for (const s of sources) {
      try {
        const r = await s.client.getTransactionReceipt({ hash: txHash });
        if (r) {
          const like = toReceiptLike(r, s.label);
          return capOutput({
            status: r.status === "success" ? "confirmed" : "reverted",
            txHash,
            blockNumber: r.blockNumber.toString(),
            gasUsed: r.gasUsed.toString(),
            from: r.from,
            to: r.to,
            contractAddress: r.contractAddress ?? null,
            source: s.label,
            explorer,
            movements: movementSummary(like),
          });
        }
      } catch (e) {
        errors.push(`${s.label}: ${shortErr(e)}`);
      }
    }

    // 2) no receipt — is the tx at least visible? (pending vs mined/index-lag)
    for (const s of sources) {
      try {
        const t = await s.client.getTransaction({ hash: txHash });
        if (t) {
          if (t.blockNumber !== null) {
            return capOutput({
              status: "mined-receipt-missing",
              txHash,
              blockNumber: t.blockNumber.toString(),
              from: t.from,
              to: t.to,
              source: s.label,
              explorer,
              note: "the transaction IS mined; this RPC's receipt index is lagging. Do NOT retry — check the explorer or retry tx_status in a moment.",
            });
          }
          return capOutput({
            status: "pending",
            txHash,
            from: t.from,
            to: t.to,
            source: s.label,
            explorer,
            note: "the transaction is broadcast but not mined yet; wait and call tx_status again — do NOT retry the send.",
          });
        }
      } catch (e) {
        errors.push(`${s.label} tx: ${shortErr(e)}`);
      }
    }

    return capOutput({
      status: "unknown",
      txHash,
      explorer,
      errors: errors.slice(0, 4),
      note: "no RPC returned a receipt or the transaction — the hash may be wrong or the tx has not propagated. Check the explorer before doing anything.",
    });
  },
};

export const TX_TOOLS: AgentTool[] = [txStatus];
