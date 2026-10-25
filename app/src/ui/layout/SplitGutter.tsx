import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

/**
 * Draggable split gutter (DESIGN.md "Layout mechanics"): pointer-drag on fine
 * pointers, arrow keys for keyboard users. Renders nothing on coarse/narrow
 * layouts (the shell collapses to a single column there).
 */
export function SplitGutter({
  onResize,
  label,
  inverted = false,
}: {
  onResize: (deltaPx: number) => void;
  label: string;
  /** right-side gutters grow leftwards when dragged right */
  inverted?: boolean;
}) {
  const last = useRef<number | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      last.current = e.clientX;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    []
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (last.current === null) return;
      const dx = e.clientX - last.current;
      last.current = e.clientX;
      if (dx !== 0) onResize(inverted ? -dx : dx);
    },
    [onResize, inverted]
  );

  const end = useCallback(() => {
    last.current = null;
  }, []);

  return (
    <div
      className="gutter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onResize(0)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 96 : 24;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onResize(inverted ? step : -step);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onResize(inverted ? -step : step);
        }
      }}
      data-testid={`gutter-${label}`}
    />
  );
}

export interface LayoutState {
  sidebar: number;
  dock: number;
  dockOpen: boolean;
  logs: number;
  logsOpen: boolean;
}

const LAYOUT_KEY = "dys.layout.v1";
export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 480;
export const DOCK_MIN = 280;
export const DOCK_MAX = 720;
export const LOGS_MIN = 220;
export const LOGS_MAX = 480;

const DEFAULT_LAYOUT: LayoutState = { sidebar: 0, dock: 420, dockOpen: true, logs: 300, logsOpen: false };

export function useLayout(): {
  layout: LayoutState;
  setLayout: (patch: Partial<LayoutState>) => void;
  isCompact: boolean;
} {
  const [layout, setLayoutState] = useState<LayoutState>(() => {
    try {
      const raw = window.localStorage.getItem(LAYOUT_KEY);
      if (raw) {
        const v = JSON.parse(raw) as Partial<LayoutState>;
        return {
          sidebar: clamp(v.sidebar ?? 0, 0, SIDEBAR_MAX),
          dock: clamp(v.dock ?? 420, DOCK_MIN, DOCK_MAX),
          dockOpen: v.dockOpen ?? true,
          logs: clamp(v.logs ?? 300, LOGS_MIN, LOGS_MAX),
          logsOpen: v.logsOpen ?? false,
        };
      }
    } catch {
      /* storage unavailable */
    }
    return DEFAULT_LAYOUT;
  });
  const [isCompact, setIsCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 760px), (pointer: coarse)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px), (pointer: coarse)");
    const fn = (e: MediaQueryListEvent) => setIsCompact(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  const setLayout = useCallback((patch: Partial<LayoutState>) => {
    setLayoutState((prev) => {
      const next: LayoutState = {
        sidebar: clamp(patch.sidebar !== undefined ? patch.sidebar : prev.sidebar, 0, SIDEBAR_MAX),
        dock: clamp(patch.dock !== undefined ? patch.dock : prev.dock, DOCK_MIN, DOCK_MAX),
        dockOpen: patch.dockOpen !== undefined ? patch.dockOpen : prev.dockOpen,
        logs: clamp(patch.logs !== undefined ? patch.logs : prev.logs, LOGS_MIN, LOGS_MAX),
        logsOpen: patch.logsOpen !== undefined ? patch.logsOpen : prev.logsOpen,
      };
      try {
        window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  return { layout, setLayout, isCompact };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
