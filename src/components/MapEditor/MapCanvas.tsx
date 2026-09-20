// src/components/MapEditor/MapCanvas.tsx
'use client';
// ScenarioMap-style canvas for the Map Editor: draws the authored map (background
// image + hex grid + painted MP-cost shading + placed structures) and turns mouse
// painting into terrainCosts / structures edits. 1:1 buffer math (CSS pixels) so
// the pointer paints exactly where it points. Zoom/pan via wheel + drag; hovering
// shows the hex coordinate.

import { useCallback, useEffect, useRef, useState } from 'react';
import { hexToPixel, pixelToHex } from '@/hooks/useHexGrid';
import { HEX_SIZE, DEFAULT_GRID_RADIUS, TerrainCosts, costShade } from '@/components/ScenarioMap/mapGeometry';
import { edgeRef, nearestEdge, hexCorner } from '@/lib/walls';
import { MapStructures, isEdgeStructureKey, isHexStructureKey, structuresToWalls } from '@/lib/mapStructures';
import { StructureTemplate } from '@/types/structure';

export interface MapCanvasProps {
  imageUrl: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  gridRadius: number;
  terrainCosts: TerrainCosts;
  structures?: MapStructures;
  templates?: Record<string, StructureTemplate>;
  /** null = view/pan; { value } = paint hex entry costs (0..9) with left-drag. */
  paintValue: number | null;
  /** Armed structure palette anchor: clicks place/select structures of that kind. */
  structureAnchors?: 'edge' | 'hex' | null;
  /** Currently selected structure key (edge "q,r,dir" or hex "q,r"). */
  selectedStructureKey?: string | null;
  readOnly?: boolean;
  onPaintHex: (q: number, r: number) => void;
  /** Optional: right-click clears a hex back to the default 1 MP (paint mode). */
  onClearHex?: (q: number, r: number) => void;
  onPaintStructureEdge?: (q: number, r: number, dir: number) => void;
  onPaintStructureHex?: (q: number, r: number) => void;
  onClearStructure?: (key: string) => void;
}

type View = { zoom: number; ox: number; oy: number };

function hexCorners(cx: number, cy: number, size: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push({ x: cx + size * Math.cos(angle), y: cy + size * Math.sin(angle) });
  }
  return pts;
}

/** Square-wave crenellation path along an edge, offset to `outward` (+1/-1). */
function battlementPath(
  a: { x: number; y: number },
  b: { x: number; y: number },
  outward: { x: number; y: number },
  depth: number,
): string {
  const teeth = 5;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const ox = outward.x * depth;
  const oy = outward.y * depth;
  const step = len / (teeth * 2 - 1);
  let d = `M ${a.x} ${a.y} L ${a.x + ox} ${a.y + oy}`;
  for (let i = 0; i < teeth; i++) {
    const sx = a.x + ux * step * (i * 2);
    const sy = a.y + uy * step * (i * 2);
    const ex = sx + ux * step;
    const ey = sy + uy * step;
    d += ` L ${sx} ${sy} L ${sx + ox} ${sy + oy} L ${ex + ox} ${ey + oy} L ${ex} ${ey}`;
  }
  d += ` L ${b.x} ${b.y}`;
  return d;
}

export function MapCanvas({
  imageUrl, offsetX, offsetY, scale, gridRadius, terrainCosts, structures, templates,
  paintValue, structureAnchors = null, selectedStructureKey = null, readOnly = false,
  onPaintHex, onClearHex, onPaintStructureEdge, onPaintStructureHex, onClearStructure,
}: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const view = useRef<View>({ zoom: 1, ox: 0, oy: 0 });
  const lastBg = useRef<HTMLImageElement | null>(null);
  const structImgs = useRef<Map<string, HTMLImageElement>>(new Map());
  const drag = useRef<{ mode: 'none' | 'paint' | 'pan' | 'structure'; lastHex: string; sx: number; sy: number }>({ mode: 'none', lastHex: '', sx: 0, sy: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const propsRef = useRef({
    imageUrl, offsetX, offsetY, scale, gridRadius, terrainCosts, structures, templates,
    paintValue, structureAnchors, selectedStructureKey, readOnly,
    onPaintHex, onClearHex, onPaintStructureEdge, onPaintStructureHex, onClearStructure,
  });
  propsRef.current = {
    imageUrl, offsetX, offsetY, scale, gridRadius, terrainCosts, structures, templates,
    paintValue, structureAnchors, selectedStructureKey, readOnly,
    onPaintHex, onClearHex, onPaintStructureEdge, onPaintStructureHex, onClearStructure,
  };

  // Cache the background image so draw is synchronous.
  useEffect(() => {
    if (!imageUrl) { lastBg.current = null; return; }
    const img = new Image();
    img.onload = () => { lastBg.current = img; requestAnimationFrame(draw); };
    img.src = imageUrl;
  }, [imageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const fitView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== cssW || canvas.height !== cssH) {
      canvas.width = Math.max(1, cssW);
      canvas.height = Math.max(1, cssH);
    }
    const R = gridRadius || DEFAULT_GRID_RADIUS;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let q = -R; q <= R; q++) {
      for (let r = -R; r <= R; r++) {
        const s = -q - r;
        if (Math.abs(s) > R) continue;
        const p = hexToPixel({ q, r, s }, HEX_SIZE);
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
    }
    const zoom = Math.min(cssW / Math.max(1, maxX - minX), cssH / Math.max(1, maxY - minY)) * 0.92;
    view.current.zoom = Math.max(0.05, Math.min(3, zoom));
    view.current.ox = cssW / 2;
    view.current.oy = cssH / 2;
  }, [gridRadius]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== cssW || canvas.height !== cssH) {
      canvas.width = Math.max(1, cssW);
      canvas.height = Math.max(1, cssH);
    }
    const p = propsRef.current;
    const { zoom, ox, oy } = view.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(zoom, zoom);

    const R = p.gridRadius || DEFAULT_GRID_RADIUS;
    const bg = lastBg.current;
    if (bg && p.imageUrl) {
      const imgW = bg.naturalWidth * p.scale;
      const imgH = bg.naturalHeight * p.scale;
      ctx.drawImage(bg, p.offsetX - imgW / 2, p.offsetY - imgH / 2, imgW, imgH);
    }

    const hexPath = (cx: number, cy: number) => {
      ctx.beginPath();
      const pts = hexCorners(cx, cy, HEX_SIZE);
      pts.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.closePath();
    };

    // Painted terrain shading (green free / grey cost ramp), then the grid over it.
    for (const [key, cost] of Object.entries(p.terrainCosts)) {
      const shade = costShade(cost);
      if (!shade) continue;
      const [q, r] = key.split(',').map(Number);
      if (Number.isNaN(q) || Number.isNaN(r)) continue;
      const pos = hexToPixel({ q, r, s: -q - r }, HEX_SIZE);
      hexPath(pos.x, pos.y);
      ctx.fillStyle = shade;
      ctx.fill();
    }
    // Hex structures: tint the hex + artwork/Cost badge (drawn under the grid).
    if (p.structures) {
      for (const [key, inst] of Object.entries(p.structures)) {
        if (!isHexStructureKey(key)) continue;
        const [q, r] = key.split(',').map(Number);
        if (Number.isNaN(q) || Number.isNaN(r)) continue;
        const t = p.templates?.[inst.templateId];
        const pos = hexToPixel({ q, r, s: -q - r }, HEX_SIZE);
        hexPath(pos.x, pos.y);
        ctx.fillStyle = t && /^#[0-9a-fA-F]{6}$/.test(t.color) ? `${t.color}55` : 'rgba(255,255,255,0.08)';
        ctx.fill();
        if (t?.imageUrl) {
          let img = structImgs.current.get(t.imageUrl);
          if (!img) {
            img = new Image();
            img.onload = () => requestAnimationFrame(draw);
            img.src = t.imageUrl;
            structImgs.current.set(t.imageUrl, img);
          }
          if (img.complete && img.naturalWidth > 0) {
            const h = 1.2 * HEX_SIZE;
            const w = (img.naturalWidth / img.naturalHeight) * h;
            ctx.drawImage(img, pos.x - w / 2, pos.y - h / 2, w, h);
          }
        }
        const hp = inst.maxHp ?? t?.maxHp ?? 0;
        if (hp > 0) {
          ctx.font = `bold ${Math.max(10 / zoom, 0.5)}px ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 3 / zoom;
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.strokeText(`${inst.hp ?? hp}`, pos.x, pos.y + HEX_SIZE * 0.62);
          ctx.fillStyle = '#ffe0b2';
          ctx.fillText(`${inst.hp ?? hp}`, pos.x, pos.y + HEX_SIZE * 0.62);
        }
        const doorMax = t?.doorHp ?? null;
        const door = doorMax !== null ? (inst.doorHp ?? doorMax) : null;
        const badge = inst.open ? 'open' : (door !== null && door > 0 ? `door ${door}` : null);
        if (badge) {
          ctx.font = `bold ${Math.max(10 / zoom, 0.5)}px ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 3 / zoom;
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.strokeText(badge, pos.x, pos.y - HEX_SIZE * 0.62);
          ctx.fillStyle = inst.open ? '#a5d6a7' : '#ffd9c9';
          ctx.fillText(badge, pos.x, pos.y - HEX_SIZE * 0.62);
        }
      }
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    for (let q = -R; q <= R; q++) {
      for (let r = -R; r <= R; r++) {
        const s = -q - r;
        if (Math.abs(s) > R) continue;
        const pos = hexToPixel({ q, r, s }, HEX_SIZE);
        hexPath(pos.x, pos.y);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    for (let q = -R; q <= R; q++) {
      for (let r = -R; r <= R; r++) {
        const s = -q - r;
        if (Math.abs(s) > R) continue;
        const pos = hexToPixel({ q, r, s }, HEX_SIZE);
        hexPath(pos.x, pos.y);
        ctx.stroke();
      }
    }

    // Edge structures: thick segment along the shared edge, styled by property,
    // with the battlement square-wave drawn on the outside side.
    const worldCorner = (q: number, r: number, i: number) => hexCorner({ q, r }, i, HEX_SIZE);
    if (p.structures) {
      const walls = structuresToWalls(p.structures, p.templates ?? {});
      ctx.lineCap = 'round';
      for (const key of Object.keys(p.structures)) {
        if (!isEdgeStructureKey(key)) continue;
        const [q, r, d] = key.split(',').map(Number);
        if (!Number.isFinite(q) || !Number.isFinite(r) || !Number.isFinite(d)) continue;
        const w = walls[key];
        const inst = p.structures[key];
        const t = p.templates?.[inst.templateId];
        const blocked = !!w?.a.block || !!w?.b.block;
        const hasCost = w?.a.moveCost !== undefined || w?.b.moveCost !== undefined;
        ctx.strokeStyle = blocked ? 'rgba(20,20,24,0.95)' : hasCost ? 'rgba(196,154,88,0.95)' : 'rgba(150,165,185,0.9)';
        ctx.lineWidth = blocked ? 7 : 5;
        const a = worldCorner(q, r, d);
        const b = worldCorner(q, r, d + 1);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        // Battlement on the outside side.
        if (t?.battlement) {
          const ref = edgeRef(q, r, d);
          const outsideIsA = (inst.outside ?? 'a') === 'a';
          const ox = outsideIsA ? ref.aq : ref.bq;
          const or = outsideIsA ? ref.ar : ref.br;
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          const hexCenterPt = hexToPixel({ q: ox, r: or, s: -ox - or }, HEX_SIZE);
          let nx = hexCenterPt.x - midX;
          let ny = hexCenterPt.y - midY;
          const nl = Math.hypot(nx, ny) || 1;
          nx /= nl; ny /= nl;
          ctx.strokeStyle = blocked ? 'rgba(60,60,70,0.95)' : 'rgba(196,154,88,0.95)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          const path = battlementPath(a, b, { x: nx, y: ny }, HEX_SIZE * 0.28);
          ctx.stroke(new Path2D(path));
        }
        // Move-cost labels on the edge, one per face that overrides the cost.
        const labelFor = (faceKey: 'a' | 'b') => {
          const face = faceKey === 'a' ? w?.a : w?.b;
          if (!face || face.moveCost === undefined) return null;
          const ref2 = edgeRef(q, r, d);
          const hq = faceKey === 'a' ? ref2.aq : ref2.bq;
          const hr = faceKey === 'a' ? ref2.ar : ref2.br;
          const c = hexToPixel({ q: hq, r: hr, s: -hq - hr }, HEX_SIZE);
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const lx = mx + (c.x - mx) * 0.3;
          const ly = my + (c.y - my) * 0.3;
          return { text: String(face.moveCost), x: lx, y: ly };
        };
        for (const lbl of [labelFor('a'), labelFor('b')]) {
          if (!lbl) continue;
          ctx.font = `bold ${Math.max(11 / zoom, 0.5)}px ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 3 / zoom;
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.strokeText(lbl.text, lbl.x, lbl.y);
          ctx.fillStyle = '#ffe0b2';
          ctx.fillText(lbl.text, lbl.x, lbl.y);
        }
      }
    }
    if (p.selectedStructureKey) {
      ctx.strokeStyle = 'rgba(255, 220, 80, 0.95)';
      ctx.lineWidth = 3;
      if (isEdgeStructureKey(p.selectedStructureKey)) {
        const [q, r, d] = p.selectedStructureKey.split(',').map(Number);
        const ref = edgeRef(q, r, d);
        const a = worldCorner(ref.aq, ref.ar, ref.dir);
        const b = worldCorner(ref.aq, ref.ar, ref.dir + 1);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else if (isHexStructureKey(p.selectedStructureKey)) {
        const [q, r] = p.selectedStructureKey.split(',').map(Number);
        const pos = hexToPixel({ q, r, s: -q - r }, HEX_SIZE);
        hexPath(pos.x, pos.y);
        ctx.stroke();
      }
    }

    // Cost labels: constant ~13px ON SCREEN (the ctx is zoom-scaled, so use
    // world sizes of screen/zoom) so they stay readable at any zoom.
    ctx.font = `bold ${Math.max(13 / zoom, 0.5)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 / zoom;
    for (const [key, cost] of Object.entries(p.terrainCosts)) {
      if (cost === 1) continue;
      const [q, r] = key.split(',').map(Number);
      if (Number.isNaN(q) || Number.isNaN(r)) continue;
      const pos = hexToPixel({ q, r, s: -q - r }, HEX_SIZE);
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(String(cost), pos.x, pos.y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(cost), pos.x, pos.y);
    }
    ctx.restore();
  }, []);

  // Fit only on mount / grid-radius / size change — NEVER on paint edits.
  useEffect(() => {
    fitView();
    requestAnimationFrame(draw);
  }, [fitView, draw]);

  // Redraw on prop edits without touching the view.
  useEffect(() => {
    requestAnimationFrame(draw);
  }, [draw, terrainCosts, structures, templates, selectedStructureKey, imageUrl, offsetX, offsetY, scale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => { requestAnimationFrame(draw); });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  const hexAtClient = (sx: number, sy: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = sx - rect.left;
    const py = sy - rect.top;
    const { zoom, ox, oy } = view.current;
    const hex = pixelToHex({ x: (px - ox) / zoom, y: (py - oy) / zoom }, HEX_SIZE);
    const R = propsRef.current.gridRadius || DEFAULT_GRID_RADIUS;
    if (Math.abs(hex.q) > R || Math.abs(hex.r) > R || Math.abs(hex.s) > R) return null;
    return hex;
  };

  const edgeAtClient = (sx: number, sy: number): { q: number; r: number; dir: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { zoom, ox, oy } = view.current;
    const world = { x: (sx - rect.left - ox) / zoom, y: (sy - rect.top - oy) / zoom };
    const hex = pixelToHex(world, HEX_SIZE);
    const R = propsRef.current.gridRadius || DEFAULT_GRID_RADIUS;
    if (Math.abs(hex.q) > R || Math.abs(hex.r) > R || Math.abs(hex.s) > R) return null;
    const { dir } = nearestEdge(hex, world, HEX_SIZE);
    return { q: hex.q, r: hex.r, dir };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const p = propsRef.current;
    if (e.button === 0 && p.structureAnchors === 'edge' && !p.readOnly && p.onPaintStructureEdge) {
      drag.current.mode = 'structure';
      const edge = edgeAtClient(e.clientX, e.clientY);
      if (edge) {
        drag.current.lastHex = `${edge.q},${edge.r},${edge.dir}`;
        p.onPaintStructureEdge(edge.q, edge.r, edge.dir);
      }
    } else if (e.button === 0 && p.structureAnchors === 'hex' && !p.readOnly && p.onPaintStructureHex) {
      drag.current.mode = 'structure';
      const hex = hexAtClient(e.clientX, e.clientY);
      if (hex) {
        drag.current.lastHex = `${hex.q},${hex.r}`;
        p.onPaintStructureHex(hex.q, hex.r);
      }
    } else if (e.button === 0 && p.paintValue !== null && !p.readOnly) {
      drag.current.mode = 'paint';
      const hex = hexAtClient(e.clientX, e.clientY);
      if (hex) {
        drag.current.lastHex = `${hex.q},${hex.r}`;
        p.onPaintHex(hex.q, hex.r);
      }
    } else if (e.button === 0 || e.button === 1) {
      drag.current.mode = 'pan';
      drag.current.sx = e.clientX;
      drag.current.sy = e.clientY;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const hex = hexAtClient(e.clientX, e.clientY);
    setHover(hex ? `${hex.q}, ${hex.r}` : null);
    if (d.mode === 'pan') {
      view.current.ox += e.clientX - d.sx;
      view.current.oy += e.clientY - d.sy;
      d.sx = e.clientX;
      d.sy = e.clientY;
      requestAnimationFrame(draw);
      return;
    }
    if (d.mode === 'structure') {
      const p = propsRef.current;
      if (p.structureAnchors === 'edge' && p.onPaintStructureEdge) {
        const edge = edgeAtClient(e.clientX, e.clientY);
        if (edge) {
          const k = `${edge.q},${edge.r},${edge.dir}`;
          if (k !== d.lastHex) { d.lastHex = k; p.onPaintStructureEdge(edge.q, edge.r, edge.dir); }
        }
      } else if (p.structureAnchors === 'hex' && p.onPaintStructureHex) {
        if (hex) {
          const k = `${hex.q},${hex.r}`;
          if (k !== d.lastHex) { d.lastHex = k; p.onPaintStructureHex(hex.q, hex.r); }
        }
      }
      return;
    }
    if (d.mode === 'paint') {
      const p = propsRef.current;
      if (hex) {
        const k = `${hex.q},${hex.r}`;
        if (k !== d.lastHex) { d.lastHex = k; p.onPaintHex(hex.q, hex.r); }
      }
    }
  };
  const endPointer = () => { drag.current.mode = 'none'; };
  const onWheel = (e: React.WheelEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const { zoom, ox, oy } = view.current;
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const nz = Math.max(0.05, Math.min(6, zoom * factor));
    const wx = (px - ox) / zoom;
    const wy = (py - oy) / zoom;
    view.current.zoom = nz;
    view.current.ox = px - wx * nz;
    view.current.oy = py - wy * nz;
    requestAnimationFrame(draw);
  };

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerLeave={endPointer}
        onPointerCancel={endPointer}
        onWheel={onWheel}
        onContextMenu={(e) => {
          e.preventDefault();
          const p = propsRef.current;
          if (p.readOnly) return;
          if (p.structureAnchors && p.onClearStructure) {
            if (p.structureAnchors === 'edge') {
              const edge = edgeAtClient(e.clientX, e.clientY);
              if (edge) { p.onClearStructure(edgeRef(edge.q, edge.r, edge.dir).key); return; }
            } else {
              const hex = hexAtClient(e.clientX, e.clientY);
              if (hex) { p.onClearStructure(`${hex.q},${hex.r}`); return; }
            }
          }
          if (p.paintValue === null || !p.onClearHex) return;
          const hex = hexAtClient(e.clientX, e.clientY);
          if (hex) p.onClearHex(hex.q, hex.r);
        }}
      />
      {hover && (
        <div className="absolute top-1 left-1 z-10 bg-black/60 border border-gray-600 rounded px-1.5 py-0.5 text-[10px] text-gray-200 pointer-events-none font-mono">
          ({hover})
        </div>
      )}
    </div>
  );
}
