import { describe, expect, it } from "vitest";
import index from "@abi/index.json";
import { FACTS } from "@/chain/facts";
import { PERIMETER } from "@config/addresses";

/**
 * The generated contract-facts artifact must stay consistent with its sources:
 * perimeter addresses, abi/index.json selectors + mutability, and the known
 * deployed-semantics pins (kb §3). Regenerate: python3 tools/dys_facts_json.py
 */
describe("contract-facts.json (generated — never hand-edit)", () => {
  it("every facts entry lives at a perimeter address", () => {
    const addrs = new Set(Object.values(PERIMETER).map((a) => a.toLowerCase()));
    for (const c of FACTS.contracts) {
      if (!addrs.has(c.address.toLowerCase())) throw new Error(`${c.name} not in perimeter`);
    }
  });

  it("every addressed abi/index.json contract is covered by an entry (own or alias)", () => {
    const idx = index as Record<string, { address: string | null; selectors: Record<string, { name: string; types: string; mutability: string }> }>;
    const factsBySource = new Map(FACTS.contracts.map((c) => [c.sourceContract, c]));
    for (const [name, entry] of Object.entries(idx)) {
      if (!entry.address) continue;
      if (!factsBySource.has(name)) throw new Error(`index-live ${name} has no facts entry`);
    }
  });

  it("selectors + mutability match abi/index.json exactly", () => {
    const idx = index as Record<string, { selectors: Record<string, { name: string; types: string; mutability: string }> }>;
    for (const c of FACTS.contracts) {
      const selectors = idx[c.sourceContract]!.selectors;
      for (const [sig, fn] of Object.entries(c.functions)) {
        const info = selectors[fn.selector];
        if (!info) throw new Error(`${c.name}.${sig}: selector ${fn.selector} missing from index`);
        if (info.mutability !== fn.mutability)
          throw new Error(`${c.name}.${sig}: mutability ${fn.mutability} != index ${info.mutability}`);
      }
    }
  });

  it("CHOA.Chat(address,string) carries the deployed-semantics pins", () => {
    const choa = FACTS.byAddress["0x0f5a352fd4ca4850c2099c15b3600ff085b66197"]!;
    const chat = choa.contract.functions["Chat(address,string)"]!;
    expect(chat.selector).toEqual("0xb340a780");
    expect(chat.mutability).toEqual("nonpayable");
    expect(chat.gate).toEqual("public");
    expect(chat.metered).toEqual(true);
  });

  it("fn_tables-covered contracts mark factsCovered; instance aliases reuse template facts", () => {
    const phobos = FACTS.contracts.find((c) => c.name === "PhobosQING")!;
    expect(phobos.sourceContract).toEqual("QING");
    expect(phobos.functions["Chat(address,string)"]!.gate).toEqual("public");
    expect(phobos.functions["setStaff(address,bool)"]!.gate).toEqual("bouncers");
    const world = FACTS.contracts.find((c) => c.name === "WorldChatSHIO")!;
    expect(world.functions["Log(uint64,uint64,string)"]!.gate).toEqual("owners");
  });
});
