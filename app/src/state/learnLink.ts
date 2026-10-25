/**
 * The LEARN deep-link channel (session-53, Part D item 5 — IA-PLAN §6 form
 * 2): contextual `?` affordances anywhere in the app jump into the guide.
 * A tiny module store (the venueStore pattern — module state + listener
 * set): `openLearn(file, anchor?)` publishes the target; App subscribes to
 * switch the view, LearnView subscribes to open the file and scroll to the
 * section anchor. One corpus, one index: the file names are the SAME
 * `guide/*.md` names `state/guide.ts` serves from agent/knowledge.ts's
 * glob.
 *
 * Session-78: the target gained an optional SOURCE — `guide` (default, so
 * every existing `openLearn({file})` call is untouched) or `dev` (the
 * kb/dev engineering reference; the Studio's `ENGINEERING DOCS ↗` link).
 */

export type LearnSource = "guide" | "dev";

export interface LearnTarget {
  /** a guide file name, e.g. "venues.md" (or a kb/dev/<file> when source="dev") */
  file: string;
  /** optional heading anchor (anchorSlug of the heading text) */
  anchor?: string;
  /** which LEARN corpus the file belongs to — omitted = "guide" */
  source?: LearnSource;
}

let seq = 0;
let target: LearnTarget | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  seq++;
  for (const l of listeners) l();
}

export function learnLinkTarget(): LearnTarget | null {
  return target;
}

/** the change counter — lets subscribers re-run on repeated same-file links */
export function learnLinkSeq(): number {
  return seq;
}

export function openLearn(t: LearnTarget): void {
  target = t;
  emit();
}

export function clearLearnTarget(): void {
  target = null;
  emit();
}

export function subscribeLearn(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * The anchor slug for a markdown heading: lowercase, non-alphanumerics
 * collapsed to single dashes ("DO — venue-claim deeds" →
 * "do-venue-claim-deeds"). Must match the `id` guideRender puts on heading
 * blocks exactly — both call this one function.
 */
export function anchorSlug(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
