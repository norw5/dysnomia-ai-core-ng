import { isLocalForkRpc } from "@/chain/rpc";
import {
  resolveSimLayerAddress,
  simLayerConfig,
  SIM_LAYER_NAMES,
  type SimLayerConfig,
  type SimLayerName,
} from "@/state/simOverlay";
import type { Address } from "viem";

/**
 * The SIM overlay seam (IA-PLAN §8, session 58). The never-deployed layer
 * (WORLD/WAR/H2O/VITUS/GWAT/ENCRYPT) has NO live addresses — they come from
 * the runtime overlay (`state/simOverlay.ts`, session-81) or the harness
 * set-3 FIXTURE (`config/sim_addresses.json`) as the static fallback.
 *
 * Visibility law (owner round, runtime-composite + session-81 tightening):
 * SIM surfaces render only when
 *   (DEV ∨ VITE_ENABLE_SIM_MODE=1) ∧ the active RPC is a LOOPBACK local fork.
 * A custom real RPC — including the user's own node — is LIVE, never SIM
 * (SIM PREDICATE LAW). Production builds without the flag never resolve a
 * layer address; the LIVE perimeter (`config/addresses.ts` `addr()`)
 * structurally cannot serve these names.
 *
 * Standing §8 law: a future LIVE deployment of this layer would carry NEW
 * addresses — we wire, never assume. The WORLD/VITUS/WAR/H2O entries are the
 * fixture-FIXED variants (the verbatim WORLD/WAR are undeployable — their
 * asset constructors call back into the parent under construction, the failed
 * wave-5 create); GWAT/ENCRYPT are verbatim.
 */

export { SIM_LAYER_NAMES, simLayerConfig };
export type { SimLayerConfig, SimLayerName };

/** build-flag gate: SIM entry points compile in, but never resolve, when off */
export const simEntryEnabled: boolean = import.meta.env.DEV || import.meta.env.VITE_ENABLE_SIM_MODE === "1";

/** is the SIM layer's surface active for this RPC? (loopback local fork only) */
export function simLayerActive(rpcUrl: string): boolean {
  return simEntryEnabled && isLocalForkRpc(rpcUrl);
}

/**
 * Resolve a layer address — ONLY in SIM mode. Throws otherwise (structural:
 * a live-mode resolution is a bug, never a fallback). Runtime overlay first,
 * harness fixture second.
 */
export function simAddr(name: SimLayerName, rpcUrl: string): Address {
  if (!simLayerActive(rpcUrl)) {
    throw new Error(`SIM layer address ${name} resolved outside sim mode`);
  }
  const a = resolveSimLayerAddress(name, rpcUrl);
  if (!a) throw new Error(`SIM overlay missing: ${name}`);
  return a;
}
