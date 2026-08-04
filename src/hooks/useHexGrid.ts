// src/hooks/useHexGrid.ts
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Hex, Unit } from '@/types/gameProtocol';

// ---- Hex math (pointy-top) ----
export function hexToPixel(hex: Hex, size: number): { x: number; y: number } {
  const x = size * (Math.sqrt(3) * hex.q + Math.sqrt(3) / 2 * hex.r);
  const y = size * (1.5 * hex.r);
  return { x, y };
}

export function pixelToHex(point: { x: number; y: number }, size: number): Hex {
  const q = (Math.sqrt(3) / 3 * point.x - 1 / 3 * point.y) / size;
  const r = (2 / 3 * point.y) / size;
  return hexRound(q, r);
}

function hexRound(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  const qDiff = Math.abs(rq - q);
  const rDiff = Math.abs(rr - r);
  const sDiff = Math.abs(rs - s);
  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs;
  } else if (rDiff > sDiff) {
    rr = -rq - rs;
  } else {
    rs = -rq - rr;
  }
  return { q: rq, r: rr, s: rs };
}

export interface UseHexGridProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  size: number;
  gridRadius: number;
  units: Unit[];
  onUnitMove: (unitId: string, targetHex: Hex) => void;
  onHexClick?: (hex: Hex) => void;
  onHexRightClick?: (hex: Hex, unit: Unit | undefined, clientX: number, clientY: number) => void;
  onUnitHover?: (unit: Unit, screenX: number, screenY: number) => void;
  onUnitLeave?: () => void;
  onAttack?: (attackerId: string, targetId: string) => void;
  customDraw?: (ctx: CanvasRenderingContext2D, width: number, height: number, zoom: number, offsetX: number, offsetY: number) => void;
  autoCenter?: boolean;
  backgroundImage?: { url: string; offsetX: number; offsetY: number; scale: number } | null;
  overlayMap?: Record<string, string> | null;
  /** Read-only mode: pan/zoom/hover enabled, but unit drag-move, attack, and
   *  context menu are disabled (used by replay). */
  readOnly?: boolean;
}

export function useHexGrid({
  canvasRef,
  size,
  gridRadius,
  units,
  onUnitMove,
  onHexClick,
  onHexRightClick,
  onUnitHover,
  onUnitLeave,
  onAttack,
  customDraw,
  autoCenter = true,
  backgroundImage,
  overlayMap = null,
  readOnly = false,
}: UseHexGridProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [hoveredHex, setHoveredHex] = useState<Hex | null>(null);
  const [draggingUnitId, setDraggingUnitId] = useState<string | null>(null);
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);
  const [mouseDownTarget, setMouseDownTarget] = useState<'unit' | 'hex' | 'none'>('none');
  const [lastHoveredUnit, setLastHoveredUnit] = useState<Unit | null>(null);

  const rafIdRef = useRef<number | null>(null);

  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const [bgLoaded, setBgLoaded] = useState(false);

  useEffect(() => {
    if (!backgroundImage?.url) {
      bgImageRef.current = null;
      setBgLoaded(false);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      bgImageRef.current = img;
      setBgLoaded(true);
    };
    img.onerror = () => {
      bgImageRef.current = null;
      setBgLoaded(false);
    };
    img.src = backgroundImage.url;
  }, [backgroundImage?.url]);

  // ---- Center map ----
  const centerMap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const centerPixel = hexToPixel({ q: 0, r: 0, s: 0 }, size);
    setOffsetX(width / 2 - centerPixel.x * zoom);
    setOffsetY(height / 2 - centerPixel.y * zoom);
  }, [canvasRef, size, zoom]);

  useEffect(() => {
    if (autoCenter) {
      const timer = setTimeout(() => centerMap(), 50);
      return () => clearTimeout(timer);
    }
  }, [autoCenter, centerMap]);

  useEffect(() => {
    const handleResize = () => centerMap();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [centerMap]);

  // ---- Draw ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (!rect) return;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Draw background image
    if (bgImageRef.current && backgroundImage) {
      const img = bgImageRef.current;
      const imgW = img.naturalWidth * backgroundImage.scale * zoom;
      const imgH = img.naturalHeight * backgroundImage.scale * zoom;
      const imgX = backgroundImage.offsetX * zoom + offsetX - imgW / 2;
      const imgY = backgroundImage.offsetY * zoom + offsetY - imgH / 2;
      ctx.drawImage(img, imgX, imgY, imgW, imgH);
    }

    const hexes: Hex[] = [];
    for (let q = -gridRadius; q <= gridRadius; q++) {
      for (let r = -gridRadius; r <= gridRadius; r++) {
        const s = -q - r;
        if (Math.abs(s) <= gridRadius) hexes.push({ q, r, s });
      }
    }

    const drawHex = (hex: Hex, fillColor?: string, strokeColor?: string) => {
      const pos = hexToPixel(hex, size);
      const cx = pos.x * zoom + offsetX;
      const cy = pos.y * zoom + offsetY;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 180 * (60 * i - 30);
        const px = cx + size * zoom * Math.cos(angle);
        const py = cy + size * zoom * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      if (fillColor) {
        ctx.fillStyle = fillColor;
        ctx.fill();
      }
      ctx.strokeStyle = strokeColor || '#2a2a4a';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    };

    for (const hex of hexes) {
      const key = `${hex.q},${hex.r}`;
      const fill = overlayMap?.[key];
      drawHex(hex, fill || undefined);
    }

    if (customDraw) {
      customDraw(ctx, width, height, zoom, offsetX, offsetY);
    }
  }, [canvasRef, size, gridRadius, offsetX, offsetY, zoom, customDraw, bgLoaded, backgroundImage, overlayMap]);

  useEffect(() => {
    draw();
  }, [draw]);

  // ---- Apply zoom (shared logic) ----
  const applyZoom = useCallback((deltaY: number, clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    // World coordinates under mouse
    const worldX = (mouseX - offsetX) / zoom;
    const worldY = (mouseY - offsetY) / zoom;

    const delta = deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(Math.max(zoom * delta, 0.2), 3);

    const newOffsetX = mouseX - worldX * newZoom;
    const newOffsetY = mouseY - worldY * newZoom;

    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    rafIdRef.current = requestAnimationFrame(() => {
      setZoom(newZoom);
      setOffsetX(newOffsetX);
      setOffsetY(newOffsetY);
      rafIdRef.current = null;
      draw();
    });
  }, [canvasRef, offsetX, offsetY, zoom, draw]);

  // ---- Attach native wheel listener with passive:false ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      applyZoom(e.deltaY, e.clientX, e.clientY);
    };

    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, [applyZoom]);

  // ---- Mouse handlers (unchanged) ----
  const getHexFromScreen = useCallback((screenX: number, screenY: number): Hex | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (screenX - rect.left) || 0;
    const y = (screenY - rect.top) || 0;
    const worldX = (x - offsetX) / zoom;
    const worldY = (y - offsetY) / zoom;
    return pixelToHex({ x: worldX, y: worldY }, size);
  }, [canvasRef, offsetX, offsetY, zoom, size]);

  const getUnitAt = useCallback((hex: Hex): Unit | undefined => {
    return units.find(u => !u.isDeleted && !u.attachedToUnitId && u.currentUnitHp > 0 && u.hex.q === hex.q && u.hex.r === hex.r && u.hex.s === hex.s);
  }, [units]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const hex = getHexFromScreen(e.clientX, e.clientY);
    if (hex) setHoveredHex(hex);

    const unit = hex ? getUnitAt(hex) : undefined;
    if (unit && unit !== lastHoveredUnit) {
      setLastHoveredUnit(unit);
      if (onUnitHover) {
        const rect = canvasRef.current!.getBoundingClientRect();
        onUnitHover(unit, e.clientX - rect.left, e.clientY - rect.top);
      }
    } else if (!unit && lastHoveredUnit) {
      setLastHoveredUnit(null);
      if (onUnitLeave) onUnitLeave();
    }

    if (isPanning && panStart) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setOffsetX(prev => prev + dx);
      setOffsetY(prev => prev + dy);
      setPanStart({ x: e.clientX, y: e.clientY });
    }
  }, [getHexFromScreen, getUnitAt, isPanning, panStart, lastHoveredUnit, onUnitHover, onUnitLeave]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const hex = getHexFromScreen(e.clientX, e.clientY);
    if (!hex) return;

    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      setMouseDownTarget('hex');
      return;
    }

    // In read-only (replay) mode, left-click never starts a drag or a hex select;
    // pan (button 1) and hover still work. Right-click is handled separately.
    if (e.button !== 0 || readOnly) {
      setMouseDownTarget('none');
      return;
    }

    const unit = getUnitAt(hex);
    if (unit) {
      setDraggingUnitId(unit.id);
      setDragStartPos({ x: e.clientX, y: e.clientY });
      setMouseDownTarget('unit');
      return;
    }
    setMouseDownTarget('hex');
  }, [getHexFromScreen, getUnitAt, readOnly]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggingUnitId && dragStartPos) {
      const targetHex = getHexFromScreen(e.clientX, e.clientY);
      if (targetHex) {
        const unit = units.find(u => u.id === draggingUnitId);
        if (unit) {
          const targetUnit = getUnitAt(targetHex);
          if (targetUnit && targetUnit.id !== draggingUnitId) {
            if (onAttack) onAttack(draggingUnitId, targetUnit.id);
          } else if (!targetUnit) {
            if (unit.hex.q !== targetHex.q || unit.hex.r !== targetHex.r) {
              onUnitMove(draggingUnitId, targetHex);
            }
          }
        }
      }
      setDraggingUnitId(null);
      setDragStartPos(null);
    }

    if (mouseDownTarget === 'hex' && !draggingUnitId) {
      const hex = getHexFromScreen(e.clientX, e.clientY);
      if (hex && onHexClick) onHexClick(hex);
    }

    setIsPanning(false);
    setPanStart(null);
    setMouseDownTarget('none');
  }, [draggingUnitId, dragStartPos, getHexFromScreen, units, getUnitAt, onAttack, onUnitMove, mouseDownTarget, onHexClick]);

  const handleRightClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (readOnly) return;
    const hex = getHexFromScreen(e.clientX, e.clientY);
    if (hex) {
      const unit = getUnitAt(hex);
      if (onHexRightClick) onHexRightClick(hex, unit, e.clientX, e.clientY);
    }
  }, [getHexFromScreen, getUnitAt, onHexRightClick, readOnly]);

  return {
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleRightClick,
    // No handleWheel – it's internal now
    hoveredHex,
    draggingUnitId,
    offsetX,
    offsetY,
    zoom,
    getHexFromScreen,
    getUnitAt,
    centerMap,
  };
}