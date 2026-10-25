import raw from "@/data/contract-facts.json";

/**
 * The generated per-contract interaction facts (selector/mutability/gate/meter/
 * reverts). Regenerate with `python3 tools/dys_facts_json.py` — never hand-edit.
 */

export interface FnFacts {
  selector: `0x${string}`;
  mutability: "view" | "pure" | "nonpayable" | "payable";
  gate: string | null;
  metered: boolean;
  reverts: string[];
}

export interface ContractEntry {
  name: string;
  sourceContract: string;
  file: string | null;
  address: `0x${string}`;
  abiFile: string;
  factsCovered: boolean;
  functions: Record<string, FnFacts>;
}

export interface ContractFacts {
  generated: string;
  contracts: ContractEntry[];
  byAddress: Record<string, { name: string; contract: ContractEntry; bySelector: Record<string, string> }>;
}

function build(): ContractFacts {
  const doc = raw as unknown as {
    $generated: string;
    contracts: Record<string, Omit<ContractEntry, "name">>;
  };
  const contracts: ContractEntry[] = [];
  const byAddress: ContractFacts["byAddress"] = {};
  for (const [name, c] of Object.entries(doc.contracts)) {
    const entry: ContractEntry = { ...c, name };
    const bySelector: Record<string, string> = {};
    for (const [sig, fn] of Object.entries(entry.functions)) bySelector[fn.selector] = sig;
    byAddress[entry.address.toLowerCase()] = { name, contract: entry, bySelector };
    contracts.push(entry);
  }
  contracts.sort((a, b) => a.name.localeCompare(b.name));
  return { generated: doc.$generated, contracts, byAddress };
}

export const FACTS: ContractFacts = build();
