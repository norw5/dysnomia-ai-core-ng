import { useEffect, useMemo, useRef, useState } from "react";
import {
  displayMass,
  linearPos,
  nodePhase,
  type RenderRow,
} from "@/state/atlas";
import { useVessel } from "@/state/vessel";

/**
 * The MAP atlas canvas (session-43): the predecessor QingMap RENDER ported
 * 1:1 in behavior — meridian-band grid warped by a node-mass gravity field,
 * 3D tilt/orbit + 2D modes, camera pan/zoom with lerp smoothing, hover pick
 * with the leader-line readout, dashed selection ring — fed by the s32-exact
 * render seed and bound to the app-global venue store.
 * Differences from the old file are deliberate: pointer events (mouse +
 * touch), a cached gravity lattice (the old code re-summed 917 nodes per
 * grid point per frame), the pinned token palette (amber/cyan — purple
 * stays reserved for the AI core pane), and deterministic node phases.
 *
 * Session-48: the CANONICAL framing (kb §9, the session-32 atlas finding) is
 * the DEFAULT — lon = fold-fraction×180°, lat = ±|lat|/pole×90° (the disc
 * unrolled onto the globe; uniform fill, both hemispheres colored). The
 * predecessor's HECKE equirectangular framing (band-as-longitude) stays as a
 * labeled toggle: it bunches the venues along a diagonal because latitude is
 * anti-monotonic in band by construction — a framing artifact, not chain
 * truth.
 */

type Coord = "CANON" | "HECKE" | "LINEAR";

interface CamNode {
  addr: string;
  label: string;
  sys: boolean;
  mass: number;
  phase: number;
  x: number;
  y: number;
  row: RenderRow;
}

const GRAV_KEY = "dys.gravity.v1";
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const LAT_STEP = 4; // lattice resolution (degrees)
const LON_STEP = 4;
const LAT_COLS = Math.floor(360 / LON_STEP) + 1; // lon -180..180
const LAT_ROWS = Math.floor(180 / LAT_STEP) + 1; // lat -90..90

/** hex → `r,g,b` for canvas rgba() strings (the vessel accent; amber default) */
function accentRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "255, 176, 0";
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** the gravity field: lattice for grid warp + exact per-node Z (the old getZ) */
function buildField(nodes: CamNode[], gravityStrength: number, proj3d: boolean) {
  const lattice = new Float32Array(LAT_COLS * LAT_ROWS);
  const z = new Map<string, number>();
  if (proj3d) {
    for (let r = 0; r < LAT_ROWS; r++) {
      const lat = -90 + r * LAT_STEP;
      for (let c = 0; c < LAT_COLS; c++) {
        const lon = -180 + c * LON_STEP;
        let sum = 0;
        for (const n of nodes) {
          const dx = lon - n.x;
          const dy = lat - n.y;
          sum -= (n.mass * gravityStrength) / (1 + (dx * dx + dy * dy) * 0.05);
        }
        lattice[r * LAT_COLS + c] = sum;
      }
    }
    for (const n of nodes) {
      let zv = 0;
      for (const m of nodes) {
        const dx = n.x - m.x;
        const dy = n.y - m.y;
        zv -= (m.mass * gravityStrength) / (1 + (dx * dx + dy * dy) * 0.05);
      }
      z.set(n.addr, zv);
    }
  }
  return { lattice, z };
}

export function AtlasCanvas({
  rows,
  selectedAddr,
  onSelect,
  compact = false,
}: {
  rows: RenderRow[];
  selectedAddr: string | null;
  onSelect: (row: RenderRow) => void;
  /**
   * COMPACT (session-60): the deck widget variant — fills its wrap (no MAP
   * page clamp) with a trimmed control set (coord cycles through one button,
   * no gravity slider, no help/hint chrome). Full controls stay on MAP.
   */
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [coord, setCoord] = useState<Coord>("CANON");
  const [proj3d, setProj3d] = useState(true);
  // session-60: orbit lock + a rounder gravity are the DEFAULTS — a stored
  // dys.gravity.v1 pref still wins (only the default changes)
  const [orbitLock, setOrbitLock] = useState(true);
  const [hoverAddr, setHoverAddr] = useState<string | null>(null);
  const [gravity, setGravity] = useState<number>(() => {
    // NB: Number(null) is 0 and 0 is a VALID gravity — the fresh-storage case
    // must be distinguished from a stored 0 or the default never applies (the
    // latent bug the session-60 default assertion caught)
    const raw = window.localStorage.getItem(GRAV_KEY);
    const saved = raw !== null ? Number(raw) : NaN;
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.35;
  });
  // session-60: the meridians + system-node highlights follow the fleet
  // vessel accent (amber by law; sim/demo override re-tints the render)
  const vessel = useVessel();
  const accent = accentRgb(vessel.accent);

  useEffect(() => {
    try {
      window.localStorage.setItem(GRAV_KEY, String(gravity));
    } catch {
      /* storage unavailable */
    }
  }, [gravity]);

  const nodes = useMemo<CamNode[]>(
    () =>
      rows.map((r) => {
        const p =
          coord === "LINEAR"
            ? linearPos(r.w)
            : coord === "CANON"
              ? // kb §9 canonical: the disc unrolled — fold-fraction ±180° lon,
                // |lat|/pole × 90° lat, the band-89 flip carrying the sign
                { lon: r.f * 180, lat: (r.south ? -1 : 1) * r.ln * 90 }
              : { lon: r.lon, lat: r.lat };
        return {
          addr: r.a,
          label: r.n.length > 0 ? r.n : r.a.slice(0, 10) + "…",
          sys: r.sys,
          mass: displayMass(r),
          phase: nodePhase(r),
          x: p.lon,
          y: p.lat,
          row: r,
        };
      }),
    [rows, coord]
  );

  const camera = useRef({
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
    zoom: 0.6,
    tZoom: 0.6,
    tilt: 0.8,
    tTilt: 0.8,
    rot: 0.5,
    tRot: 0.5,
  });

  const interaction = useRef({
    isDown: false,
    isDragging: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    mode: "PAN" as "PAN" | "ORBIT",
    currentX: -1e9,
    currentY: -1e9,
    pointers: new Map<number, { x: number; y: number }>(),
    pinchDist: 0,
  });

  const hoverRef = useRef<{ addr: string | null; sx: number; sy: number; label: string }>({
    addr: null,
    sx: 0,
    sy: 0,
    label: "",
  });

  // gravity field cache — rebuilt when nodes/gravity/projection change
  const fieldRef = useRef<{ key: string; lattice: Float32Array; z: Map<string, number> }>({
    key: "",
    lattice: new Float32Array(0),
    z: new Map(),
  });
  const fieldDirty = useRef(true);
  useEffect(() => {
    fieldDirty.current = true;
  }, [nodes, gravity, proj3d]);

  // 2D flattens the camera; 3D restores the old defaults
  useEffect(() => {
    const cam = camera.current;
    if (proj3d) {
      cam.tTilt = 0.8;
      cam.tRot = 0.5;
    } else {
      cam.tTilt = 0;
      cam.tRot = 0;
      cam.tilt = 0;
      cam.rot = 0;
    }
  }, [proj3d]);

  // selection (from the app-global store or a canvas click) focuses the camera
  useEffect(() => {
    const node = selectedAddr !== null ? nodes.find((n) => n.addr === selectedAddr) : undefined;
    if (!node || !containerRef.current) return;
    const cam = camera.current;
    const rect = containerRef.current.getBoundingClientRect();
    const scale = (Math.min(rect.width, rect.height) / 180) * cam.tZoom;
    // ground-position focus (ignore Z) — prevents jumping under strong gravity
    cam.tx = -node.x * scale;
    cam.ty = -node.y * scale;
  }, [selectedAddr, nodes]);

  // --- RENDER LOOP ---
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;

    const render = (time: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = container.clientWidth;
      const cssH = container.clientHeight;
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const width = cssW;
      const height = cssH;

      const cam = camera.current;
      const f = 0.1;
      cam.x = lerp(cam.x, cam.tx, f);
      cam.y = lerp(cam.y, cam.ty, f);
      cam.zoom = lerp(cam.zoom, cam.tZoom, f);
      cam.tilt = lerp(cam.tilt, cam.tTilt, f);
      cam.rot = lerp(cam.rot, cam.tRot, f);

      const cx = width / 2 + cam.x;
      const cy = height / 2 + cam.y;
      const scale = (Math.min(width, height) / 180) * cam.zoom;

      ctx.fillStyle = "#050505";
      ctx.fillRect(0, 0, width, height);

      const fieldKey = `${coord}|${gravity}|${proj3d}`;
      if (fieldDirty.current || fieldRef.current.key !== fieldKey) {
        fieldRef.current = { key: fieldKey, ...buildField(nodes, gravity, proj3d) };
        fieldDirty.current = false;
      }
      const lattice = fieldRef.current.lattice;
      const zMap = fieldRef.current.z;

      // lattice bilinear sample — the old getZ(), amortized
      const getZ = (x: number, y: number): number => {
        if (!proj3d || lattice.length === 0) return 0;
        const fc = (x + 180) / LON_STEP;
        const fr = (y + 90) / LAT_STEP;
        const c0 = Math.max(0, Math.min(LAT_COLS - 1, Math.floor(fc)));
        const r0 = Math.max(0, Math.min(LAT_ROWS - 1, Math.floor(fr)));
        const c1 = Math.min(LAT_COLS - 1, c0 + 1);
        const r1 = Math.min(LAT_ROWS - 1, r0 + 1);
        const tc = fc - c0;
        const tr = fr - r0;
        const v00 = lattice[r0 * LAT_COLS + c0]!;
        const v01 = lattice[r0 * LAT_COLS + c1]!;
        const v10 = lattice[r1 * LAT_COLS + c0]!;
        const v11 = lattice[r1 * LAT_COLS + c1]!;
        return v00 * (1 - tc) * (1 - tr) + v01 * tc * (1 - tr) + v10 * (1 - tc) * tr + v11 * tc * tr;
      };

      const cosRot = Math.cos(cam.rot);
      const sinRot = Math.sin(cam.rot);
      const cosTilt = Math.cos(cam.tilt);
      const sinTilt = Math.sin(cam.tilt);

      const project = (x: number, y: number, z: number) => {
        const rx = x * cosRot - y * sinRot;
        const ry = x * sinRot + y * cosRot;
        return {
          sx: cx + rx * scale,
          sy: cy + (ry * cosTilt - z * sinTilt) * scale,
        };
      };

      ctx.lineWidth = 1;
      const gridOpacity = 0.12;
      const drawPoly = (points: { x: number; y: number }[]) => {
        ctx.beginPath();
        let first = true;
        for (const p of points) {
          const z = getZ(p.x, p.y);
          const proj = project(p.x, p.y, z);
          if (proj.sx < -width || proj.sx > width * 2 || proj.sy < -height || proj.sy > height * 2) {
            first = true;
            continue;
          }
          if (first) {
            ctx.moveTo(proj.sx, proj.sy);
            first = false;
          } else {
            ctx.lineTo(proj.sx, proj.sy);
          }
        }
        ctx.stroke();
      };

      for (let lat = -90; lat <= 90; lat += 6) {
        const points: { x: number; y: number }[] = [];
        for (let lon = -180; lon <= 180; lon += 2) points.push({ x: lon, y: lat });
        ctx.strokeStyle = `rgba(0, 240, 255, ${Math.abs(lat) < 60 ? gridOpacity : 0.03})`;
        drawPoly(points);
      }
      for (let lon = -180; lon <= 180; lon += 6) {
        const points: { x: number; y: number }[] = [];
        for (let lat = -90; lat <= 90; lat += 2) points.push({ x: lon, y: lat });
        // accent meridians (the old purple lon lines re-pinned to the token
        // law; the vessel accent re-tints them under a sim/demo override)
        ctx.strokeStyle = `rgba(${accent}, ${Math.abs(lon) < 120 ? gridOpacity * 0.7 : 0.03})`;
        drawPoly(points);
      }

      let closest: CamNode | null = null;
      let closestSx = 0;
      let closestSy = 0;
      let minDescSq = Infinity;

      for (const node of nodes) {
        const z = proj3d ? (zMap.get(node.addr) ?? 0) : 0;
        const p = project(node.x, node.y, z);

        const mx = interaction.current.currentX;
        const my = interaction.current.currentY;
        const distSq = (mx - p.sx) ** 2 + (my - p.sy) ** 2;
        if (distSq < 225 && distSq < minDescSq) {
          minDescSq = distSq;
          closest = node;
          closestSx = p.sx;
          closestSy = p.sy;
        }

        if (p.sx < -50 || p.sx > width + 50 || p.sy < -50 || p.sy > height + 50) continue;

        const isHover = hoverRef.current.addr === node.addr;
        const isSelected = selectedAddr === node.addr;

        const wave = reduced ? 0 : Math.sin(node.x * 0.05 + time / 2000);
        const twinkle = reduced ? 0 : Math.sin(time / (800 + node.mass * 5) + node.phase);

        const baseSize = 2.5;
        const sizeMod = wave * 0.5 + twinkle * 0.3;
        let radius =
          isHover || isSelected ? 6 : (baseSize + sizeMod) * (cam.zoom < 1 ? 1 : cam.zoom * 0.8);
        radius = Math.max(0.8, radius);

        if (isSelected) {
          ctx.save();
          ctx.translate(p.sx, p.sy);
          ctx.rotate(reduced ? 0 : time / 1000);
          ctx.strokeStyle = "#00f0ff";
          ctx.lineWidth = 2;
          ctx.setLineDash([10, 5]);
          ctx.beginPath();
          ctx.arc(0, 0, 15 + wave * 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        ctx.beginPath();
        ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
        const baseAlpha = 0.7;
        const waveAlpha = 0.2 * wave;
        const finalAlpha = Math.max(0.2, Math.min(1, baseAlpha + waveAlpha));
        ctx.fillStyle = node.sys
          ? `rgba(${accent}, ${Math.min(1, finalAlpha + 0.2)})`
          : isSelected
            ? "#00f0ff"
            : // CANON carries the hemisphere: south (unflipped) white, the
              // band-89 north green — the session-32 atlas convention
              coord === "CANON" && !node.row.south
              ? `rgba(0, 255, 65, ${finalAlpha})`
              : `rgba(255, 255, 255, ${finalAlpha})`;
        ctx.fill();

        if (node.mass > 20 || wave > 0.8) {
          ctx.beginPath();
          const calculatedGlow = radius + node.mass / 20 + wave * 2;
          const glowSize = Math.max(radius + 0.5, calculatedGlow);
          ctx.arc(p.sx, p.sy, glowSize, 0, Math.PI * 2);
          const glowColor = node.sys
            ? `rgba(${accent}, 0.3)`
            : isSelected
              ? "rgba(0, 240, 255, 0.5)"
              : "rgba(0, 240, 255, 0.22)";
          ctx.strokeStyle = glowColor;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        if (cam.zoom > 2 || node.sys || isHover || isSelected) {
          ctx.font = '9px "JetBrains Mono", monospace';
          ctx.fillStyle = isHover || isSelected ? "#fff" : "rgba(255,255,255,0.5)";
          ctx.fillText(node.label, p.sx + 10, p.sy + 4);
        }
      }

      const prev = hoverRef.current;
      if ((closest?.addr ?? null) !== prev.addr) {
        hoverRef.current = {
          addr: closest?.addr ?? null,
          sx: closestSx,
          sy: closestSy,
          label: closest?.label ?? "",
        };
        setHoverAddr(hoverRef.current.addr);
      } else if (closest !== null) {
        hoverRef.current = { addr: closest.addr, sx: closestSx, sy: closestSy, label: closest.label };
      }

      if (hoverRef.current.addr !== null && !interaction.current.isDragging) {
        const hx = hoverRef.current.sx;
        const hy = hoverRef.current.sy;
        ctx.strokeStyle = "#00f0ff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + 15, hy - 15);
        ctx.lineTo(hx + 100, hy - 15);
        ctx.stroke();
        ctx.fillStyle = "rgba(0,0,0,0.8)";
        const label = hoverRef.current.label;
        const boxW = Math.max(120, ctx.measureText(label).width + 24);
        ctx.fillRect(hx + 15, hy - 35, boxW, 20);
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.fillStyle = "#00f0ff";
        ctx.fillText(label, hx + 20, hy - 22);
      }

      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = camera.current;
      const delta = -e.deltaY * 0.001 * cam.zoom;
      cam.tZoom = Math.min(Math.max(0.2, cam.tZoom + delta), 20);
    };
    container.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener("wheel", onWheel);
    };
  }, [nodes, gravity, proj3d, coord, selectedAddr, accent]);

  const pickRow = (addr: string | null): RenderRow | null => {
    if (addr === null) return null;
    return rows.find((r) => r.a === addr) ?? null;
  };

  const pointerPos = (e: React.PointerEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const it = interaction.current;
    containerRef.current?.setPointerCapture(e.pointerId);
    it.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (it.pointers.size === 2) {
      const [p1, p2] = [...it.pointers.values()];
      it.pinchDist = Math.hypot(p1!.x - p2!.x, p1!.y - p2!.y);
      return;
    }
    it.isDown = true;
    it.isDragging = false;
    it.startX = e.clientX;
    it.startY = e.clientY;
    it.lastX = e.clientX;
    it.lastY = e.clientY;
    it.mode = e.button === 1 || e.shiftKey || orbitLock ? "ORBIT" : "PAN";
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const it = interaction.current;
    const pos = pointerPos(e);
    it.currentX = pos.x;
    it.currentY = pos.y;
    it.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (it.pointers.size === 2) {
      const [p1, p2] = [...it.pointers.values()];
      const dist = Math.hypot(p1!.x - p2!.x, p1!.y - p2!.y);
      if (it.pinchDist > 0 && dist > 0) {
        const cam = camera.current;
        cam.tZoom = Math.min(Math.max(0.2, cam.tZoom * (dist / it.pinchDist)), 20);
      }
      it.pinchDist = dist;
      return;
    }

    if (!it.isDown) return;
    const dx = e.clientX - it.lastX;
    const dy = e.clientY - it.lastY;
    const distFromStart = Math.hypot(e.clientX - it.startX, e.clientY - it.startY);
    if (distFromStart > 5) it.isDragging = true;

    if (it.isDragging) {
      const cam = camera.current;
      if (it.mode === "PAN") {
        // immediate (no inertia) — the old map's pan feel
        cam.tx += dx;
        cam.ty += dy;
        cam.x += dx;
        cam.y += dy;
      } else {
        cam.tRot -= dx * 0.005;
        cam.rot -= dx * 0.005;
        cam.tTilt = Math.min(Math.max(0, cam.tTilt - dy * 0.005), Math.PI / 2.1);
        cam.tilt = cam.tTilt;
      }
    }
    it.lastX = e.clientX;
    it.lastY = e.clientY;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const it = interaction.current;
    it.pointers.delete(e.pointerId);
    if (it.pointers.size < 2) it.pinchDist = 0;
    if (!it.isDown) return;
    it.isDown = false;
    const wasDrag = it.isDragging;
    it.isDragging = false;
    if (!wasDrag) {
      const row = pickRow(hoverRef.current.addr);
      if (row) onSelect(row);
    }
  };

  const resetCam = () => {
    const cam = camera.current;
    cam.tx = 0;
    cam.ty = 0;
    cam.tZoom = 0.6;
    if (proj3d) {
      cam.tTilt = 0.8;
      cam.tRot = 0.5;
    }
  };

  const cycleCoord = () => {
    setCoord((c) => (c === "CANON" ? "HECKE" : c === "HECKE" ? "LINEAR" : "CANON"));
  };

  return (
    <>
      <div className={`atlas-wrap${compact ? " compact" : ""}`} data-testid="map-canvas">
      <div
        ref={containerRef}
        className={`atlas-container ${hoverAddr !== null ? "is-hover" : ""} ${
          interaction.current.isDown ? "is-grabbing" : ""
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          interaction.current.isDown = false;
          interaction.current.currentX = -1e9;
          interaction.current.currentY = -1e9;
        }}
        role="application"
        aria-label="venue atlas — drag to pan, shift-drag or orbit mode to rotate and tilt, wheel to zoom, click a node to select the venue"
      >
        <canvas ref={canvasRef} data-testid="atlas-canvas" />
      </div>

      {compact ? (
        <div className="atlas-hud" data-testid="atlas-hud-compact">
          <span className="atlas-chip">
            NODES: <span className="mono">{rows.length}</span>
          </span>
          <button
            className="atlas-btn"
            onClick={cycleCoord}
            title="cycle the coordinate framing — CANON (kb §9 canonical), HECKE (legacy equirect), LINEAR (waat grid). full controls live on the MAP page"
            data-testid="atlas-compact-coord"
          >
            {coord}
          </button>
          <button
            className={`atlas-btn ${proj3d ? "active" : ""}`}
            onClick={() => setProj3d((p) => !p)}
            title={proj3d ? "switch to the 2D grid" : "switch to the 3D tilt/orbit projection"}
            data-testid="atlas-compact-proj"
          >
            {proj3d ? "3D" : "2D"}
          </button>
          <button
            className={`atlas-btn ${orbitLock ? "lock" : ""}`}
            onClick={() => setOrbitLock((v) => !v)}
            title="orbit lock — makes touch/primary drag rotate instead of pan"
            aria-pressed={orbitLock}
            data-testid="atlas-compact-orbit"
          >
            ORBIT {orbitLock ? "ON" : "OFF"}
          </button>
          <button className="atlas-btn" onClick={resetCam} title="reset the camera" data-testid="atlas-compact-reset">
            ⟲
          </button>
        </div>
      ) : (
        <div className="atlas-hud atlas-hud-full" data-testid="atlas-hud">
          <span className="atlas-chip">
            NODES: <span className="mono">{rows.length}</span>
          </span>
          <div className="atlas-toggle" role="group" aria-label="coordinate system">
            {(["CANON", "HECKE", "LINEAR"] as const).map((c) => (
              <button
                key={c}
                className={`atlas-btn ${coord === c ? "active" : ""}`}
                onClick={() => setCoord(c)}
                data-testid={`atlas-${c.toLowerCase()}`}
                title={
                  c === "CANON"
                    ? "canonical framing (kb §9): fold-fraction ±180° × |lat|/pole — the onchain distribution's own space, uniform fill"
                    : c === "HECKE"
                      ? "the predecessor's equirectangular framing (band-as-longitude) — the venues bunch along a diagonal by construction; kept for reference"
                      : "linear waat grid"
                }
              >
                {c === "CANON" ? "CANON (STD)" : c === "HECKE" ? "HECKE (LEGACY)" : "LINEAR"}
              </button>
            ))}
          </div>
          <div className="atlas-toggle" role="group" aria-label="projection mode">
            <button
              className={`atlas-btn ${proj3d ? "active" : ""}`}
              onClick={() => setProj3d(true)}
              data-testid="atlas-3d"
            >
              PROJECTION: 3D
            </button>
            <button
              className={`atlas-btn ${!proj3d ? "active" : ""}`}
              onClick={() => setProj3d(false)}
              data-testid="atlas-2d"
            >
              GRID: 2D
            </button>
          </div>
          <button
            className={`atlas-btn ${orbitLock ? "lock" : ""}`}
            onClick={() => setOrbitLock((v) => !v)}
            title="orbit lock — makes touch/primary drag rotate instead of pan"
            aria-pressed={orbitLock}
            data-testid="atlas-orbit"
          >
            ORBIT {orbitLock ? "ON" : "OFF"}
          </button>
          {proj3d && (
            <label className="atlas-gravity" data-testid="atlas-gravity-box">
              <span>
                GRAVITY WELL <span className="mono">{(gravity * 100).toFixed(0)}%</span>
              </span>
              {/* integer track (0..100 × 5): React applies `value` before
                  min/max/step, and a fractional value sanitized against the
                  default step 1 snapped the knob to 0 — the latent bug the
                  session-60 default assertion caught */}
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(gravity * 100)}
                onChange={(e) => setGravity(Number(e.target.value) / 100)}
                aria-label="gravity well strength"
                data-testid="atlas-gravity"
              />
            </label>
          )}
          <button className="atlas-btn" onClick={resetCam} data-testid="atlas-reset">
            RESET CAM
          </button>
        </div>
      )}

      {/* session-78: the gesture legend is a BOTTOM overlay of the atlas
          container (never a top HUD row competing with the controls). The
          deck's compact variant keeps its trimmed HUD and no legend. */}
      {!compact && (
        <p className="atlas-help" data-testid="atlas-help">
          [DRAG] PAN · [SHIFT+DRAG / ORBIT] ROTATE+TILT · [WHEEL / PINCH] ZOOM · [CLICK] SELECT
        </p>
      )}
      </div>

      {!compact && (
        <p className="hint atlas-hint">
          seed render — {rows.length} venues, s32-exact. CANON = the canonical framing (kb §9:
          fold-fraction × |lat|/pole — uniform fill; green = band-89 north, white = south);
          visual node mass is address-derived, not onchain Entropy. live venue state renders in
          the panel on selection.
        </p>
      )}
    </>
  );
}
