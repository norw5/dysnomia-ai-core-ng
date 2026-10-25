/**
 * Gate-level settings that are NOT policy caps (session-65, the yolo
 * relaxation): the mode-C BREADTH toggle — auto-ack unknown-CONTRACT sends
 * in yolo mode (destination-based) while unknown-METHOD and privileged
 * gates keep asking. Policy (value/session/day caps, unknown-destination
 * DENIAL when disabled) still binds everywhere; this never bypasses a
 * denial, only the per-tx extra-ack for the destination class.
 */

const KEY = "dys.gate.v1";

export interface GateSettings {
  modeCBreadth: boolean;
}

export const DEFAULT_GATE_SETTINGS: GateSettings = {
  modeCBreadth: false,
};

export function loadGateSettings(): GateSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_GATE_SETTINGS;
    const s = JSON.parse(raw) as Partial<GateSettings>;
    return { modeCBreadth: s.modeCBreadth === true };
  } catch {
    return DEFAULT_GATE_SETTINGS;
  }
}

export function saveGateSettings(settings: GateSettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}
