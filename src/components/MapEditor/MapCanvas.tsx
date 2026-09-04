// src/components/MapEditor/MapCanvas.tsx
'use client';
// ScenarioMap-style canvas for the Map Editor: draws the authored map (background
// image + hex grid + painted MP-cost tints) and turns mouse painting into
// terrainCosts edits. Self-contained zoom/pan + pixel→axial hit-testing that
// mirrors the live map's pointy-top geometry.

import React, { useCallback, useEffect, useRef } from 'react';
import { hexToPixel, pixelToHex } from '@/hooks/useHexGrid';
import { HEX_SIZE, DEFAULT_GRID_RADIUS, TerrainCosts } from '@/components/ScenarioMap/mapGeometry';

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
  const propsRef = useRef({ imageUrl, offsetX, offsetY, scale, gridRadius, terrainCosts, paintValue, readOnly, onPaintHex });
  propsRef.current = { imageUrl, offsetX, offsetY, scale, gridRadius, terrainCosts, paintValue, readOnly, onPaintHex };

  // Cache the background image so draw is synchronous.
  useEffect(() => {
    if (!imageUrl) { lastBg.current = null; return; }
    const img = new Image();
    img.onload = () => { lastBg.current = img; requestAnimationFrame(draw); };
    img.src = imageUrl;
  }, [imageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth);
    const h = Math.round(canvas.clientHeight);
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = Math.max(1, w * dpr);
      canvas.height = Math.max(1, h * dpr);
    }
  }, []);

  const fitView = useCallback(() => {
    sizeCanvas();
    const canvas = canvasRef.current;
    if (!canvas) return;
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
    const w = canvas.width, h = canvas.height;
    const zoom = Math.min(w / Math.max(1, maxX - minX), h / Math.max(1, maxY - minY)) * 0.92;
    view.current.zoom = Math.max(0.05, Math.min(3, zoom));
    view.current.ox = w / 2;
    view.current.oy = h / 2;
  }, [gridRadius, sizeCanvas]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    sizeCanvas();
    const p = propsRef.current;
    const { zoom, ox, oy } = view.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(ox * dpr, oy * dpr);
    ctx.scale(zoom * dpr, zoom * dpr);

    const R = p.gridRadius || DEFAULT_GRID_RADIUS;
    const bg = lastBg.current;
    if (bg && p.imageUrl) {
      const imgW = bg.naturalWidth * p.scale;
      const imgH = bg.naturalHeight * p.scale;
      const cp = hexToPixel({ q: p.offsetX, r: p.offsetY, s: -p.offsetX - p.offsetY }, HEX_SIZE);
      ctx.drawImage(bg, cp.x - imgW / 2, cp.y - imgH / 2, imgW, imgH);
    }

    const hexPath = (cx: number, cy: number) => {
      ctx.beginPath();
      const pts = hexCorners(cx, cy, HEX_SIZE);
      pts.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.closePath();
    };

    // Painted terrain fills
    for (const [key] of Object.entries(p.terrainCosts)) {
      const [q, r] = key.split(',').map(Number);
      if (Number.isNaN(q) || Number.isNaN(r)) continue;
      const pos = hexToPixel({ q, r, s: -q - r }, HEX_SIZE);
      hexPath(pos.x, pos.y);
      ctx.fillStyle = 'rgba(194, 163, 90, 0.55)';
      ctx.fill();
    }
    // Grid
    ctx.lineWidth = 1;
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
    // Cost labels
    ctx.font = `${Math.max(10, 13)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [key, cost] of Object.entries(p.terrainCosts)) {
      const [q, r] = key.split(',').map(Number);
      if (Number.isNaN(q) || Number.isNaN(r)) continue;
      const pos = hexToPixel({ q, r, s: -q - r }, HEX_SIZE);
      ctx.fillStyle = '#3b3118';
      ctx.fillText(String(cost), pos.x, pos.y);
    }
    ctx.restore();
  }, [sizeCanvas]);

  // Initial fit + draw when the entity/grid changes.
  useEffect(() => {
    fitView();
    requestAnimationFrame(draw);
  }, [fitView, draw, terrainCosts, gridRadius, imageUrl, offsetX, offsetY, scale]);

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
    const dpr = window.devicePixelRatio || 1;
    const px = (sx - rect.left) * dpr;
    const py = (sy - rect.top) * dpr;
    const { zoom, ox, oy } = view.current;
    const wx = (px - ox) / zoom;
    const wy = (py - oy) / zoom;
    const hex = pixelToHex({ x: wx, y: wy }, HEX_SIZE);
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
      const hex = hexAtClient(e.clientX, e.clientY);
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
    const dpr = window.devicePixelRatio || 1;
    const px = (e.clientX - rect.left) * dpr;
    const py = (e.clientY - rect.top) * dpr;
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
  );
}
