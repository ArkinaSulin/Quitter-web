// src/components/MapEditor/MapCanvas.tsx
'use client';
// ScenarioMap-style canvas for the Map Editor: draws the authored map (background
// image + hex grid + painted MP-cost shading) and turns mouse painting into
// terrainCosts edits. 1:1 buffer math (CSS pixels) so the pointer paints exactly
// where it points. Zoom/pan via wheel + drag; hovering shows the hex coordinate.

import { useCallback, useEffect, useRef, useState } from 'react';
import { hexToPixel, pixelToHex } from '@/hooks/useHexGrid';
import { HEX_SIZE, DEFAULT_GRID_RADIUS, TerrainCosts, costShade } from '@/components/ScenarioMap/mapGeometry';

export interface MapCanvasProps {
  imageUrl: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  gridRadius: number;
  terrainCosts: TerrainCosts;
  /** null = view/pan; { value } = paint hex entry costs (0..9) with left-drag. */
  paintValue: number | null;
  readOnly?: boolean;
  onPaintHex: (q: number, r: number) => void;
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

export function MapCanvas({ imageUrl, offsetX, offsetY, scale, gridRadius, terrainCosts, paintValue, readOnly = false, onPaintHex }: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const view = useRef<View>({ zoom: 1, ox: 0, oy: 0 });
  const lastBg = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ mode: 'none' | 'paint' | 'pan'; lastHex: string; sx: number; sy: number }>({ mode: 'none', lastHex: '', sx: 0, sy: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const propsRef = useRef({ imageUrl, offsetX, offsetY, scale, gridRadius, terrainCosts, paintValue, readOnly, onPaintHex });
  propsRef.current = { imageUrl, offsetX, offsetY, scale, gridRadius, terrainCosts, paintValue, readOnly, onPaintHex };

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
      // Offset is a plain Cartesian world-pixel center (x moves X only, y moves Y
      // only) — matches how the scenario map renders the same snapshot.
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

    // Cost labels (white with a dark outline so they read on any shade/art).
    ctx.font = 'bold 13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
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
  }, [draw, terrainCosts, imageUrl, offsetX, offsetY, scale]);

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

  const onPointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const p = propsRef.current;
    if (e.button === 0 && p.paintValue !== null && !p.readOnly) {
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
        onContextMenu={(e) => e.preventDefault()}
      />
      {hover && (
        <div className="absolute top-1 left-1 z-10 bg-black/60 border border-gray-600 rounded px-1.5 py-0.5 text-[10px] text-gray-200 pointer-events-none font-mono">
          ({hover})
        </div>
      )}
    </div>
  );
}
