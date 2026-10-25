export type ViewId =
  | "deck"
  | "map"
  | "chat"
  | "identity"
  | "market"
  | "directory"
  | "studio"
  | "learn"
  | "settings";

export interface RailItem {
  id: ViewId;
  group: string;
  label: string;
  note: string;
}

export const RAIL: RailItem[] = [
  { id: "deck", group: "//agent", label: "DECK", note: "the agent workspace" },
  { id: "map", group: "//world", label: "MAP", note: "venue atlas + panels" },
  { id: "chat", group: "//social", label: "CHAT", note: "world + venue channels" },
  { id: "identity", group: "//identity", label: "IDENTITY", note: "LAU · YUE · ladder" },
  { id: "market", group: "//trade", label: "MARKET", note: "power tokens · assets · pairs" },
  { id: "directory", group: "//directory", label: "DIRECTORY", note: "LAU/YUE/QING/SHIO browse" },
  { id: "studio", group: "//eng", label: "STUDIO", note: "raw contract interaction" },
  { id: "learn", group: "//learn", label: "LEARN", note: "the definitive guide" },
  { id: "settings", group: "//system", label: "SETTINGS", note: "rpc · data i/o · agent" },
];

/**
 * MODULE // DYSNOMIA — the predecessor's horizontal module tab bar
 * (chrome parity, session-42): the //group labels survive as tiny tab
 * prefixes on desktop and vanish on compact, where the bar docks to the
 * bottom (same behavior, same testids as the old left rail).
 */
export function NavRail({ active, onSelect }: { active: ViewId; onSelect: (v: ViewId) => void }) {
  return (
    <nav className="modtabs" data-testid="rail" aria-label="module views">
      <span className="module-label">MODULE&nbsp;//&nbsp;DYSNOMIA</span>
      <span className="sep">|</span>
      {RAIL.map((item) => (
        <span key={item.id} className="rail-item-wrap">
          <button
            className={item.id === active ? "modtab active" : "modtab"}
            onClick={() => onSelect(item.id)}
            data-testid={`rail-${item.id}`}
            title={item.note}
          >
            <span className="tab-group">{item.group}</span>
            {item.label}
          </button>
        </span>
      ))}
    </nav>
  );
}
