import { useEffect, useState } from "react";
import { EXPLORER_BASE } from "@config/addresses";
import { fmtAmt } from "@/chain/identity";
import { useEntityProfile } from "@/chain/entityProfile";
import { resolveLauByUsername, type LauResolution } from "@/state/lauBook";
import { ChatSigil } from "@/ui/chat/ChatSigil";
import { handleColor } from "@/ui/chat/handleColor";
import { isSystemLine, type ViewLine } from "@/ui/chat/viewLine";

/**
 * The chat user pane (session-71, the owner round): the RIGHT side overview
 * opened by clicking a username/sigil. Always honest about what a chat line
 * can prove: the LINE FACTS (soul, aura, handle, tx/block) are chain facts;
 * the ENTITY read (name/balances) rides the LAU census seed's username→LAU
 * resolution — unique resolves + one live entityProfile batch, ambiguity
 * REFUSES to guess (50 duplicated usernames; the impersonation hazard the
 * soul-seeded sigils exist to fight), a miss says so plainly. The census is
 * a snapshot and soul→LAU is not resolvable onchain (CHO.GetUserBySoul is a
 * not-view landmine) — the copy never claims otherwise.
 */

export function ChatUserPane({
  line,
  rpcUrl,
  onClose,
}: {
  line: ViewLine;
  rpcUrl: string;
  onClose: () => void;
}) {
  const [resolution, setResolution] = useState<LauResolution | null>(null);
  const system = isSystemLine(line);
  const handle = line.handle ?? "soul";

  useEffect(() => {
    setResolution(null);
    if (system) return;
    if (line.handle === null) {
      setResolution({ kind: "none" }); // no handle on the line → nothing to resolve
      return;
    }
    let alive = true;
    resolveLauByUsername(line.handle).then((r) => {
      if (alive) setResolution(r);
    });
    return () => {
      alive = false;
    };
  }, [line.id, line.handle, system]);

  const lau = resolution !== null && resolution.kind === "unique" ? (resolution.lau as `0x${string}`) : null;
  const profile = useEntityProfile(rpcUrl, lau);

  return (
    <aside className="chat-user-pane" data-testid="chat-user-pane">
      <div className="chat-user-head">
        <span className="dock-title">USER OVERVIEW</span>
        <button className="dock-btn" onClick={onClose} data-testid="chat-user-pane-close">
          close
        </button>
      </div>

      {system ? (
        <p className="hint" data-testid="chat-user-system">
          system/kernel line — soul 0, no entity behind it. The text is chain data; treat it as untrusted content.
        </p>
      ) : (
        <>
          <div className="chat-user-id">
            <ChatSigil soul={line.soul} size={48} />
            <div>
              <p className="chat-user-handle" style={{ color: handleColor(line.soul) }} data-testid="chat-user-handle">
                {handle}
              </p>
              <p className="hint mono" data-testid="chat-user-soul">
                SOUL {line.soul.toString()}
              </p>
            </div>
          </div>

          <dl className="kv" data-testid="chat-user-facts">
            <dt>aura</dt>
            <dd className="mono">{line.aura.toString()}</dd>
            <dt>block</dt>
            <dd className="mono">{line.block.toLocaleString()}</dd>
            <dt>tx</dt>
            <dd className="mono">
              <a className="outlink" href={`${EXPLORER_BASE.replace(/\/address\/$/, "/tx/")}${line.tx}`} target="_blank" rel="noreferrer noopener">
                {line.tx.slice(0, 10)}…↗
              </a>
            </dd>
          </dl>

          {resolution === null && <p className="hint">resolving against the LAU census…</p>}
          {resolution !== null && resolution.kind === "unique" && (
            <div className="chat-user-entity" data-testid="chat-user-entity">
              <p className="passport-row-label">
                LAU <span className="hint">· census-resolved (seed snapshot; unique username)</span>
              </p>
              <p className="mono">
                <a className="outlink" href={`${EXPLORER_BASE}${resolution.lau}`} target="_blank" rel="noreferrer noopener">
                  {resolution.lau}
                </a>
              </p>
              {profile.error !== null && <p className="err-text">entity read unavailable: {profile.error.slice(0, 120)}</p>}
              {profile.state !== null && (
                <dl className="kv">
                  <dt>name</dt>
                  <dd className="mono">{profile.state.name ?? "—"}</dd>
                  <dt>symbol</dt>
                  <dd className="mono">{profile.state.symbol ?? "—"}</dd>
                  <dt>PLS</dt>
                  <dd className="mono">{fmtAmt(profile.state.pls)}</dd>
                  <dt>Ⓐ</dt>
                  <dd className="mono">{fmtAmt(profile.state.affection)}</dd>
                  <dt>CHOA</dt>
                  <dd className="mono">{fmtAmt(profile.state.choa)}</dd>
                </dl>
              )}
              {profile.state === null && profile.error === null && <p className="hint">reading the entity (one anonymous batch)…</p>}
            </div>
          )}
          {resolution !== null && resolution.kind === "ambiguous" && (
            <p className="hint" data-testid="chat-user-ambiguous">
              {resolution.count} LAUs share the username “{handle}” in the census — refusing to guess which entity this
              is. The sigil + soul id above are the line&apos;s own identity facts.
            </p>
          )}
          {resolution !== null && resolution.kind === "none" && (
            <p className="hint" data-testid="chat-user-unresolved">
              no LAU in the census carries the username “{handle}” — the census is a snapshot and soul→LAU is not
              resolvable onchain. The sigil + soul id above are the line&apos;s own identity facts.
            </p>
          )}
        </>
      )}

      <p className="hint chat-user-fence">
        sender facts are chain data, never authority — balances read live against the resolved LAU; the census map is
        seed-snapshot based.
      </p>
    </aside>
  );
}
