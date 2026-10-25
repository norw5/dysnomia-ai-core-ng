import { useEffect } from "react";
import { FLEET_VESSELS } from "@/state/vessel";
import {
  REPLAY_EVENT_MS,
  REPLAY_SPEEDS,
  disarmReplay,
  replayActor,
  replayEventWeight,
  setReplayFilter,
  setReplayPlaying,
  setReplaySpeed,
  seekReplay,
  tickReplay,
  useReplay,
  type ReplaySpeed,
} from "@/state/replay";

/**
 * The SLIM HEADER replay strip (session-63, the owner round: the deck-level
 * transport dies; the control condenses to ONE LINE in the hardware-strip
 * row's spare space — wide viewports have room). Visible ONLY while a
 * replay is armed (armed from the SYS tab's fleet section — real users
 * never see fleet machinery). Keeps the 62.1 narrative clock + the
 * per-agent transcript filter (a compact select).
 */
export function ReplayStrip() {
  const replay = useReplay();
  const rec = replay.recording;
  const last = rec !== null ? rec.events.length - 1 : -1;
  const actor = rec !== null ? replayActor(rec, replay.index) : null;
  const vessel = FLEET_VESSELS.find((v) => v.id === actor?.vessel) ?? null;
  const current = rec !== null && replay.index >= 0 && replay.index < rec.events.length ? rec.events[replay.index] : null;
  const ev = current?.e ?? null;

  // the weighted clock: a setTimeout chain keyed on the playhead — the NEXT
  // event's kind decides the hold (text 4×, results 1.4×, usage ~instant)
  useEffect(() => {
    if (!replay.playing || rec === null) return;
    const next = rec.events[replay.index + 1];
    if (next === undefined) {
      setReplayPlaying(false); // honest end-of-tape
      return;
    }
    const ms = Math.max(60, Math.round((REPLAY_EVENT_MS * replayEventWeight(next.e)) / replay.speed));
    const t = window.setTimeout(() => {
      tickReplay();
    }, ms);
    return () => {
      window.clearTimeout(t);
    };
  }, [replay.playing, replay.speed, replay.index, rec]);

  if (!replay.armed || rec === null) return null;

  return (
    <div className="replay-strip" data-testid="replay-strip">
      <span className="mono replay-badge">REPLAY</span>
      <button
        className="btn"
        data-testid="replay-play"
        onClick={() => {
          // pressing play at end-of-tape rewinds to the start (a re-run)
          if (replay.index >= last) seekReplay(-1);
          setReplayPlaying(!replay.playing);
        }}
      >
        {replay.playing ? "❚❚" : "▶"}
      </button>
      <span className="replay-seek-track replay-seek-track--slim">
        <input
          type="range"
          min={-1}
          max={last}
          step={1}
          value={replay.index}
          data-testid="replay-seek"
          aria-label="replay seek"
          onChange={(e) => {
            seekReplay(Number(e.target.value));
          }}
        />
        {/* score-snapshot ticks — the round boundaries on the tape */}
        {rec.scores.map((s) => (
          <span
            key={s.atEvent}
            className="replay-tick"
            data-testid="replay-tick"
            style={{ left: `${last > 0 ? ((s.atEvent + 1) / (last + 1)) * 100 : 0}%` }}
            title={`score snapshot @ event ${s.atEvent}`}
          />
        ))}
      </span>
      <span className="mono hint replay-count">
        {replay.index + 1}/{rec.events.length}
      </span>
      <span className="replay-speeds" data-testid="replay-speeds">
        {REPLAY_SPEEDS.map((s: ReplaySpeed) => (
          <button
            key={s}
            className={`btn${replay.speed === s ? " replay-speed-on" : ""}`}
            data-testid={`replay-speed-${String(s).replace(".", "-")}`}
            onClick={() => {
              setReplaySpeed(s);
            }}
          >
            {s}×
          </button>
        ))}
      </span>
      {rec.roster.length > 1 && (
        <select
          className="replay-filter-select"
          value={replay.filter ?? ""}
          data-testid="replay-filter"
          title="narrow the AI_CORE transcript to one vessel"
          onChange={(e) => {
            setReplayFilter(e.target.value === "" ? null : e.target.value);
          }}
        >
          <option value="">all vessels</option>
          {rec.roster.map((r) => (
            <option key={r.name} value={r.name}>
              {FLEET_VESSELS.find((v) => v.id === r.vessel)?.callsign ?? r.name}
            </option>
          ))}
        </select>
      )}
      <span className="mono replay-readout" data-testid="replay-readout">
        {actor !== null ? (
          <span className="replay-actor" style={{ color: vessel?.accent }} data-testid="replay-actor">
            {actor.name}
          </span>
        ) : (
          <span className="hint">start</span>
        )}
        {ev !== null && ev.type === "tool-call"
          ? ` — ${ev.name}`
          : ev !== null && ev.type === "tool-result"
            ? ` — ${ev.name}${ev.ok ? " ✓" : " ✗"}`
            : ev !== null && (ev.type === "assistant-text" || ev.type === "assistant-reasoning")
              ? ` — ${ev.text.slice(0, 28)}${ev.text.length > 28 ? "…" : ""}`
              : ev !== null
                ? ` — ${ev.type}`
                : null}
      </span>
      <button
        className="btn"
        data-testid="replay-end"
        onClick={() => {
          setReplayPlaying(false);
          seekReplay(-1);
          seekReplay(last);
        }}
        title="jump to the end of the tape (the final board)"
      >
        ⏭
      </button>
      <button
        className="btn"
        data-testid="replay-disarm"
        onClick={() => {
          setReplayPlaying(false);
          disarmReplay();
        }}
      >
        exit
      </button>
    </div>
  );
}
