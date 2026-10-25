import { openLearn } from "@/state/learnLink";

/**
 * The contextual `?` affordance (IA-PLAN §6 form 2, session-53): a small
 * chip next to a panel header that deep-links into the LEARN guide — the
 * relevant file (and section anchor) opens in the guide index. Pure UI: no
 * gate, no chain, same corpus the agent searches.
 */
export function LearnHint({ file, anchor, label }: { file: string; anchor?: string; label?: string }) {
  return (
    <button
      className="learn-hint"
      title={`learn more — guide/${file}${anchor !== undefined ? `#${anchor}` : ""}`}
      aria-label={`open guide/${file} in LEARN`}
      onClick={() => openLearn(anchor !== undefined ? { file, anchor } : { file })}
      data-testid={`learn-hint-${file.replace(/\.md$/, "")}`}
    >
      {label ?? "?"}
    </button>
  );
}
