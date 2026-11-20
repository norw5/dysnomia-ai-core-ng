import { useCallback, useEffect, useState } from "react";
import { makeClient } from "@/chain/client";
import { encodeDssDeploy, predictDssAddress, resolveDssDeployment, validateDss } from "@/chain/dssDesk";
import { useGateAction } from "@/chain/useGateAction";
import { setDss, useDss } from "@/state/dssStore";
import type { Address } from "viem";
import { useWallet } from "@/wallet/WalletContext";

/**
 * The DSS deploy flow (session-66), shared by the identity column's
 * compact affordance and the full desk panel: predicted CREATE1 address
 * (informational — true iff this is your next included tx) → DRYRUN →
 * THE gate → capture from the creation receipt's contractAddress.
 * A DSS deployed elsewhere is not lost: the desk's import path validates
 * it (fixed runtime + owner + LAU binding) and stores it with source
 * "import" (session-82.1).
 *
 * The request is a DEPLOYMENT send (to: null + the fixed creation
 * bytecode) — risk class "deploy"; modes A/B card, mode C + breadth
 * auto-acks (the session-66 owner round).
 */
export function useDssDeploy(rpcUrl: string, lau: Address | null): {
  action: ReturnType<typeof useGateAction>;
  predicted: Address | null;
  predictionError: string | null;
  deploy: () => Promise<void>;
  dss: ReturnType<typeof useDss>;
} {
  const wallet = useWallet();
  const account = (wallet.account ?? null) as Address | null;
  const action = useGateAction();
  const dss = useDss(account);
  const [predicted, setPredicted] = useState<Address | null>(null);
  const [predictionError, setPredictionError] = useState<string | null>(null);

  useEffect(() => {
    setPredicted(null);
    setPredictionError(null);
    if (account === null || dss !== null) return;
    let alive = true;
    const client = makeClient(rpcUrl);
    predictDssAddress(client, account)
      .then((a) => {
        if (alive) setPredicted(a);
      })
      .catch((e: unknown) => {
        if (alive) setPredictionError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [rpcUrl, account, dss]);

  useEffect(() => {
    const out = action.outcome;
    if (out?.status !== "sent" || account === null || lau === null) return;
    let alive = true;
    const client = makeClient(rpcUrl);
    void resolveDssDeployment(client, predicted, out.receipt?.contractAddress ?? null, {
      validate: async (a) => (await validateDss(client, a, account, lau)).ok,
    }).then((r) => {
      if (!alive || r.address === null) return;
      setDss(account, { dss: r.address, lau, txHash: out.txHash, source: "deploy" });
    });
    return () => {
      alive = false;
    };
  }, [action.outcome, account, lau, predicted, rpcUrl]);

  const deploy = useCallback(async (): Promise<void> => {
    if (account === null || lau === null || dss !== null) return;
    await action.begin({
      to: null,
      data: encodeDssDeploy(lau),
      account,
      meta: { source: "manual", label: "DSS deploy (the fixed self-snipe bundler)" },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, lau, dss, action.begin]);

  return { action, predicted, predictionError, deploy, dss };
}
