import { useEffect, useMemo, useState } from "react";
import { loadDevDocs, loadGuideDocs, glossary, type GuideDoc } from "@/state/guide";
import { GuideBlocks } from "@/ui/guideRender";
import { learnLinkSeq, learnLinkTarget, subscribeLearn, type LearnSource } from "@/state/learnLink";

/**
 * LEARN (IA-PLAN §6, session-48): the 8-file definitive guide rendered
 * terminal-style through the SAME verbatim files the agent's `search_kb`
 * chunks (agent/knowledge.ts's glob — one source, zero divergence), plus
 * the glossary as the dotted-underline dictionary (terms underline
 * everywhere in this view; hover carries the meaning). Session-53: the
 * contextual `?` explainers elsewhere deep-link INTO this index —
 * openLearn(file, anchor) opens the file and scrolls to the heading slug.
 *
 * Session-78: a second SOURCE — DEV REFERENCE, the 50-file kb/dev
 * engineering corpus (the same `devFiles()` glob the agent chunks). The
 * Studio's `ENGINEERING DOCS ↗` link opens a contract's doc here
 * (`openLearn({source:"dev", file})`); guide links behave exactly as before.
 */

const SOURCE_LABEL: Record<LearnSource, string> = { guide: "guide", dev: "kb/dev" };

export function LearnView() {
  const [guideDocs, setGuideDocs] = useState<GuideDoc[] | null>(null);
  const [devDocs, setDevDocs] = useState<GuideDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<LearnSource>("guide");
  const [open, setOpen] = useState<string>("README.md");
  const [linkSeq, setLinkSeq] = useState(learnLinkSeq());

  useEffect(() => {
    try {
      setGuideDocs(loadGuideDocs());
      setDevDocs(loadDevDocs());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // the deep-link channel: a published target opens its file (+ source) here
  useEffect(() => subscribeLearn(() => setLinkSeq(learnLinkSeq())), []);
  useEffect(() => {
    const t = learnLinkTarget();
    if (t !== null) {
      setSource(t.source ?? "guide");
      setOpen(t.file);
    }
  }, [linkSeq]);

  const terms = useMemo(() => glossary(), []);
  const docs = source === "guide" ? guideDocs : devDocs;
  const active = docs?.find((d) => d.file === open) ?? docs?.[0] ?? null;
  const anchor = learnLinkTarget()?.anchor;

  // session-79: the 50-row dev index gets a name/title filter (the guide's
  // 8 rows do not need one). The filter never changes the OPEN document.
  const [devQuery, setDevQuery] = useState("");
  const visibleDocs = useMemo(() => {
    if (docs === null) return null;
    if (source !== "dev") return docs;
    const q = devQuery.trim().toLowerCase();
    if (q.length === 0) return docs;
    return docs.filter((d) => d.file.toLowerCase().includes(q) || d.title.toLowerCase().includes(q));
  }, [docs, source, devQuery]);

  const switchSource = (next: LearnSource) => {
    setSource(next);
    setOpen("README.md");
  };

  // scroll the linked section into view once the doc is rendered
  useEffect(() => {
    if (anchor === undefined || active === null) return;
    const el = document.getElementById(anchor);
    if (el !== null) el.scrollIntoView({ block: "start" });
  }, [anchor, active, linkSeq]);

  return (
    <section className="view learn view-center" data-testid="view-learn">
      <h1>//learn LEARN — the definitive guide</h1>
      <p className="hint" data-testid="learn-note">
        {source === "guide"
          ? "the same 8 files the AI core searches — manual and natural-language education share one verbatim corpus (they cannot diverge). dotted-underlined terms carry the glossary meaning on hover."
          : "the same 50 kb/dev engineering files the AI core's search_kb cites — verbatim per-contract reference (identity, dependencies, state, mechanically extracted function tables, integration notes). the Studio opens these from a contract's header."}
      </p>
      {error && <p className="err-text">{error}</p>}
      {(source === "guide" ? guideDocs : devDocs) === null && !error && (
        <p className="hint">loading the corpus…</p>
      )}

      <div className="learn-sources" role="group" aria-label="corpus source">
        <button
          className={source === "guide" ? "learn-source active" : "learn-source"}
          onClick={() => switchSource("guide")}
          data-testid="learn-source-guide"
          aria-pressed={source === "guide"}
        >
          GUIDE · {guideDocs?.length ?? 8}
        </button>
        <button
          className={source === "dev" ? "learn-source active" : "learn-source"}
          onClick={() => switchSource("dev")}
          data-testid="learn-source-dev"
          aria-pressed={source === "dev"}
        >
          DEV REFERENCE · {devDocs?.length ?? 50}
        </button>
      </div>

      {docs !== null && (
        <div className="learn-body">
          <nav className="learn-index panel" aria-label="corpus files" data-testid="learn-index">
            <h2>{source === "guide" ? "corpus" : "engineering reference"}</h2>
            {source === "dev" && (
              <p className="hint" data-testid="learn-dev-note">
                {docs.length} verbatim files · the engineering layer behind every deployed contract.
                contracts with no file (AFFECTION, MATH, …) are named honestly in the Studio.
              </p>
            )}
            {source === "dev" && (
              <input
                className="mono learn-filter"
                value={devQuery}
                placeholder="filter files — name / title"
                aria-label="filter engineering docs"
                spellCheck={false}
                onChange={(e) => setDevQuery(e.target.value)}
                data-testid="learn-dev-filter"
              />
            )}
            <ul data-testid={`learn-${source}-list`}>
              {visibleDocs?.map((d) => (
                <li key={d.file}>
                  <button
                    className={active !== null && active.file === d.file ? "learn-file active" : "learn-file"}
                    onClick={() => setOpen(d.file)}
                    data-testid={
                      source === "guide"
                        ? `learn-file-${d.file.replace(/\.md$/, "")}`
                        : `learn-dev-file-${d.file.replace(/\.md$/, "")}`
                    }
                  >
                    <span className="learn-file-name mono">{d.file}</span>
                    <span className="learn-file-title">{d.title}</span>
                  </button>
                </li>
              ))}
            </ul>
            {source === "dev" && visibleDocs !== null && visibleDocs.length === 0 && (
              <p className="hint" data-testid="learn-dev-empty">
                no engineering docs match “{devQuery.trim()}”
              </p>
            )}
            {source === "guide" && (
              <>
                <h2>glossary</h2>
                <p className="hint">
                  {terms.length} terms — dotted-underline pass active in every guide page below.
                </p>
              </>
            )}
          </nav>
          <div className="learn-doc panel" data-testid="learn-doc">
            {active !== null ? (
              <>
                <h2 className="mono learn-doc-file" data-testid="learn-doc-file">
                  {SOURCE_LABEL[source]}/{active.file}
                </h2>
                <div
                  className="learn-doc-body"
                  data-testid={
                    source === "guide"
                      ? `learn-doc-${active.file.replace(/\.md$/, "")}`
                      : `learn-dev-doc-${active.file.replace(/\.md$/, "")}`
                  }
                >
                  <GuideBlocks md={active.raw} />
                </div>
              </>
            ) : (
              <p className="hint">no document selected.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
