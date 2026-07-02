// src/hooks/useHexGrid.ts
import { useRef, useEffect, useState, useCallback } from 'react';
import { Hex, Unit } from '@/types/gameProtocol';

// --- Hex Math (Pointy-top, Cube Coordinates) ---
const SQRT3 = Math.sqrt(3);

export function hexToPixel(hex: Hex, size: number): { x: number; y: number } {
  const x = size * (SQRT3 * hex.q + (SQRT3 / 2) * hex.r);
  const y = size * (1.5 * hex.r);
  return { x, y };
}

export function pixelToHex(x: number, y: number, size: number): Hex {
  const q = (SQRT3 / 3 * x - 1 / 3 * y) / size;
  const r = (2 / 3 * y) / size;
  return hexRound({ q, r, s: -q - r });
}

function hexRound({ q, r, s }: { q: number; r: number; s: number }): Hex {
  let qi = Math.round(q);
  let ri = Math.round(r);
  let si = Math.round(s);
  const qDiff = Math.abs(qi - q);
  const rDiff = Math.abs(ri - r);
  const sDiff = Math.abs(si - s);
  if (qDiff > rDiff && qDiff > sDiff) qi = -ri - si;
  else if (rDiff > sDiff) ri = -qi - si;
  else si = -qi - ri;
  return { q: qi, r: ri, s: si };
}

export function hexNeighbor(hex: Hex, direction: number): Hex {
  const dirs = [
    { q: 1, r: 0, s: -1 }, // 0: East
    { q: 1, r: -1, s: 0 }, // 1: NorthEast
    { q: 0, r: -1, s: 1 }, // 2: NorthWest
    { q: -1, r: 0, s: 1 }, // 3: West
    { q: -1, r: 1, s: 0 }, // 4: SouthWest
    { q: 0, r: 1, s: -1 }, // 5: SouthEast
  ];
  const d = dirs[((direction % 6) + 6) % 6];
  return { q: hex.q + d.q, r: hex.r + d.r, s: hex.s + d.s };
}

// --- Hook ---
interface UseHexGridProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  size?: number;
  gridRadius?: number;
  units?: Unit[];
  onHexHover?: (hex: Hex | null) => void;
  onHexClick?: (hex: Hex, event: MouseEvent) => void;
  onHexRightClick?: (hex: Hex, event: MouseEvent) => void;
  onUnitMove?: (unitId: string, targetHex: Hex) => void;
}

export function useHexGrid({
  canvasRef,
  size = 40,
  gridRadius = 15,
  units = [],
  onHexHover,
  onHexClick,
  onHexRightClick,
  onUnitMove,
}: UseHexGridProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [hoveredHex, setHoveredHex] = useState<Hex | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const animationRef = useRef<number | null>(null);

  // --- Drag State ---
  const [draggingUnitId, setDraggingUnitId] = useState<string | null>(null);
  const [dragStartHex, setDragStartHex] = useState<Hex | null>(null);
  const [dragTargetHex, setDragTargetHex] = useState<Hex | null>(null);

  // --- Drawing Functions ---
  const drawHex = useCallback(
    (ctx: CanvasRenderingContext2D, hex: Hex, fillColor: string, strokeColor: string, lineWidth: number = 1) => {
      const { x, y } = hexToPixel(hex, size * zoom);
      const cx = x + offsetX;
      const cy = y + offsetY;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 180 * (60 * i - 30);
        const px = cx + size * zoom * Math.cos(angle);
        const py = cy + size * zoom * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    },
    [size, zoom, offsetX, offsetY]
  );

  const teamColors: Record<string, string> = {
    blue: '#0072B2',
    yellow: '#F0E442',
    black: '#333333',
    violet: '#CC79A7',
  };

  const drawUnit = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      unit: Unit,
      renderHex: Hex,
      isGhost: boolean = false,
      opacity: number = 1.0
    ) => {
      const { x, y } = hexToPixel(renderHex, size * zoom);
      const cx = x + offsetX;
      const cy = y + offsetY;
      const radius = size * zoom * 0.4;

      const fillColor = teamColors[unit.team] || '#888';
      ctx.globalAlpha = opacity;

      if (isGhost) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1.0;
        return;
      }

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = `${Math.max(10, radius * 0.7)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(unit.name.substring(0, 4), cx, cy - radius - 2);

      const hpWidth = radius * 1.6;
      const hpX = cx - hpWidth / 2;
      const hpY = cy + radius + 4;
      const hpHeight = 4;
      ctx.fillStyle = '#222222';
      ctx.fillRect(hpX, hpY, hpWidth, hpHeight);
      const hpRatio = Math.max(0, unit.hp / unit.maxHp);
      ctx.fillStyle = hpRatio > 0.5 ? '#44ff44' : '#ff4444';
      ctx.fillRect(hpX, hpY, hpWidth * hpRatio, hpHeight);

      if (!unit.isHero && unit.formation !== 'Scattered') {
        const angle = (60 * unit.facing - 30) * Math.PI / 180;
        const tipX = cx + size * zoom * Math.cos(angle);
        const tipY = cy + size * zoom * Math.sin(angle);
        const baseRadius = size * zoom * 0.7;
        const halfSpread = 0.4;
        const baseX1 = cx + baseRadius * Math.cos(angle - halfSpread);
        const baseY1 = cy + baseRadius * Math.sin(angle - halfSpread);
        const baseX2 = cx + baseRadius * Math.cos(angle + halfSpread);
        const baseY2 = cy + baseRadius * Math.sin(angle + halfSpread);
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(baseX1, baseY1);
        ctx.lineTo(baseX2, baseY2);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.globalAlpha = 1.0;
    },
    [size, zoom, offsetX, teamColors]
  );

  const drawGrid = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, width, height);

      const hexes: Hex[] = [];
      for (let q = -gridRadius; q <= gridRadius; q++) {
        for (let r = -gridRadius; r <= gridRadius; r++) {
          const s = -q - r;
          if (Math.abs(s) <= gridRadius) {
            hexes.push({ q, r, s });
          }
        }
      }

      for (const hex of hexes) {
        const isHovered = hoveredHex && hex.q === hoveredHex.q && hex.r === hoveredHex.r && hex.s === hoveredHex.s;
        const isDragTarget = dragTargetHex && hex.q === dragTargetHex.q && hex.r === dragTargetHex.r && hex.s === dragTargetHex.s;
        
        let fill = 'rgba(255, 255, 255, 0.03)';
        let stroke = '#2a2a4a';
        let lineWidth = 0.8;

        if (isDragTarget) {
          fill = 'rgba(255, 255, 200, 0.25)';
          stroke = '#ffcc00';
          lineWidth = 3;
        } else if (isHovered) {
          fill = 'rgba(255, 255, 255, 0.15)';
          stroke = '#88ccff';
          lineWidth = 2;
        }

        drawHex(ctx, hex, fill, stroke, lineWidth);

        if (isHovered) {
          const { x, y } = hexToPixel(hex, size * zoom);
          ctx.fillStyle = '#88ccff';
          ctx.font = '12px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${hex.q},${hex.r}`, x + offsetX, y + offsetY);
        }
      }

      for (const unit of units) {
        const isDragging = draggingUnitId === unit.id;
        const renderHex = (isDragging && dragTargetHex) ? dragTargetHex : unit.hex;
        const isGhost = isDragging && !!dragTargetHex && 
          (dragTargetHex.q !== unit.hex.q || dragTargetHex.r !== unit.hex.r);

        if (isDragging && isGhost) {
          drawUnit(ctx, unit, unit.hex, true, 0.5);
        }
        drawUnit(ctx, unit, renderHex, false, isDragging ? 0.9 : 1.0);
      }
    },
    [gridRadius, size, zoom, offsetX, offsetY, drawHex, hoveredHex, dragTargetHex, draggingUnitId, units, drawUnit]
  );

  // --- Mouse Handling ---
  const getHexFromEvent = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Hex | null => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const x = (e.clientX - rect.left) * (canvasRef.current!.width / rect.width);
      const y = (e.clientY - rect.top) * (canvasRef.current!.height / rect.height);
      const worldX = (x - offsetX) / zoom;
      const worldY = (y - offsetY) / zoom;
      return pixelToHex(worldX, worldY, size);
    },
    [canvasRef, offsetX, offsetY, zoom, size]
  );

  const getUnitAtHex = useCallback(
    (hex: Hex): Unit | undefined => {
      return units.find(u => u.hex.q === hex.q && u.hex.r === hex.r && u.hex.s === hex.s);
    },
    [units]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // --- PAN LOGIC ---
      if (isPanning) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        setOffsetX((prev) => prev + dx);
        setOffsetY((prev) => prev + dy);
        setPanStart({ x: e.clientX, y: e.clientY });
        return;
      }

      // --- DRAG / HOVER LOGIC ---
      const hex = getHexFromEvent(e);
      if (hex) {
        setHoveredHex(hex);
        onHexHover?.(hex);

        if (draggingUnitId) {
          setDragTargetHex(hex);
        }
      } else {
        setHoveredHex(null);
        onHexHover?.(null);
      }
    },
    [isPanning, panStart, getHexFromEvent, onHexHover, draggingUnitId]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // --- MIDDLE BUTTON (1) = PAN ---
      if (e.button === 1) {
        e.preventDefault();
        setIsPanning(true);
        setPanStart({ x: e.clientX, y: e.clientY });
        canvasRef.current?.style.setProperty('cursor', 'grabbing');
        return;
      }

      // --- LEFT BUTTON (0) = SELECT / DRAG ---
      if (e.button !== 0) return;
      if (isPanning) return;

      const hex = getHexFromEvent(e);
      if (!hex) return;

      const unit = getUnitAtHex(hex);
      if (unit) {
        setDraggingUnitId(unit.id);
        setDragStartHex(hex);
        setDragTargetHex(hex);
        canvasRef.current?.style.setProperty('cursor', 'grabbing');
        e.preventDefault();
      } else {
        onHexClick?.(hex, e.nativeEvent);
      }
    },
    [isPanning, getHexFromEvent, getUnitAtHex, onHexClick, canvasRef]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // --- STOP PANNING ---
      if (isPanning) {
        setIsPanning(false);
        canvasRef.current?.style.setProperty('cursor', 'default');
        return;
      }

      // --- COMPLETE DRAG ---
      if (draggingUnitId && dragTargetHex && dragStartHex) {
        const isDifferent = dragTargetHex.q !== dragStartHex.q || 
                           dragTargetHex.r !== dragStartHex.r ||
                           dragTargetHex.s !== dragStartHex.s;
        
        if (isDifferent) {
          const targetUnit = getUnitAtHex(dragTargetHex);
          if (!targetUnit || targetUnit.id === draggingUnitId) {
            onUnitMove?.(draggingUnitId, dragTargetHex);
          } else {
            console.log('[Drag] Target hex occupied!');
          }
        }
      }

      // Clear drag state
      setDraggingUnitId(null);
      setDragStartHex(null);
      setDragTargetHex(null);
      canvasRef.current?.style.setProperty('cursor', 'default');
    },
    [isPanning, draggingUnitId, dragTargetHex, dragStartHex, getUnitAtHex, onUnitMove, canvasRef]
  );

  const handleRightClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const hex = getHexFromEvent(e);
      if (hex) onHexRightClick?.(hex, e.nativeEvent);
    },
    [getHexFromEvent, onHexRightClick]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom((prev) => Math.max(0.3, Math.min(2, prev + delta)));
    },
    []
  );

  // --- Render Loop ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.parentElement?.getBoundingClientRect();
    if (rect) {
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    const animate = () => {
      drawGrid(ctx, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
      animationRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [drawGrid, canvasRef]);

  return {
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleRightClick,
    handleWheel,
    hoveredHex,
    offsetX,
    offsetY,
    zoom,
    draggingUnitId,
  };
}